import { dbListDeployments } from '../db/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Caddy Admin API client
//
// Caddy exposes a JSON admin API at :2019 that accepts a full config object.
// We maintain the authoritative config in-memory, mutate it when deployments
// are created/deleted, and POST /load to apply the update atomically.
//
// Caddy validates the new config before applying — if it's invalid, the
// current config keeps running (zero-downtime updates are guaranteed by Caddy).
//
// Route structure injected for each deployment:
//   /deploys/:id      → rewrite to /  → reverse_proxy dind:<port>
//   /deploys/:id/*    → rewrite to /* → reverse_proxy dind:<port>
//
// On API restart, `initCaddyConfig()` rebuilds all routes from the SQLite
// `running` deployments so Caddy stays in sync.
// ─────────────────────────────────────────────────────────────────────────────

const CADDY_ADMIN = process.env.CADDY_ADMIN_URL ?? 'http://localhost:2019';

// ── Caddy JSON Config Types (subset) ──────────────────────────────────────

interface CaddyRoute {
  match?: Array<Record<string, unknown>>;
  handle: Array<Record<string, unknown>>;
  terminal?: boolean;
}

interface CaddyConfig {
  apps: {
    http: {
      servers: {
        main: {
          listen: string[];
          routes: CaddyRoute[];
        };
      };
    };
  };
}

// ── Config State ───────────────────────────────────────────────────────────

let config: CaddyConfig = buildBaseConfig();

/**
 * The base config includes the two static routes:
 *   /api/* → api:3001
 *   catch-all → web:5173
 *
 * Deployment routes are spliced in before the catch-all at runtime.
 */
function buildBaseConfig(): CaddyConfig {
  return {
    apps: {
      http: {
        servers: {
          main: {
            listen: [':80'],
            routes: [
              // ① API back-end
              {
                match: [{ path: ['/api/*'] }],
                handle: [
                  {
                    handler: 'reverse_proxy',
                    upstreams: [{ dial: 'api:3001' }],
                  },
                ],
                terminal: true,
              },
              // ② Catch-all → SPA (deployment routes are inserted before this)
              {
                handle: [
                  {
                    handler: 'reverse_proxy',
                    upstreams: [{ dial: 'web:5173' }],
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────

function buildDeploymentRoute(deploymentId: string, dindPort: number): CaddyRoute {
  return {
    // Match both /deploys/:id and /deploys/:id/*
    match: [{ path: [`/deploys/${deploymentId}`, `/deploys/${deploymentId}/*`] }],
    handle: [
      {
        handler: 'subroute',
        routes: [
          {
            // Strip /deploys/:id prefix so the app receives a clean request path
            handle: [
              {
                handler: 'rewrite',
                strip_path_prefix: `/deploys/${deploymentId}`,
              },
            ],
          },
          {
            handle: [
              {
                handler: 'reverse_proxy',
                upstreams: [{ dial: `dind:${dindPort}` }],
              },
            ],
          },
        ],
      },
    ],
    terminal: true,
  };
}

function _upsertRoute(deploymentId: string, dindPort: number): void {
  const routes = config.apps.http.servers.main.routes;

  // Remove existing route for this deployment (handles redeploys)
  const existingIdx = routes.findIndex((r) =>
    r.match?.[0] &&
    'path' in r.match[0] &&
    (r.match[0].path as string[])[0]?.includes(`/deploys/${deploymentId}`),
  );
  if (existingIdx !== -1) routes.splice(existingIdx, 1);

  // Insert before the catch-all (last route)
  const catchAllIdx = routes.findIndex((r) => !r.match);
  const insertAt = catchAllIdx === -1 ? routes.length : catchAllIdx;
  routes.splice(insertAt, 0, buildDeploymentRoute(deploymentId, dindPort));
}

function _removeRoute(deploymentId: string): void {
  const routes = config.apps.http.servers.main.routes;
  const idx = routes.findIndex(
    (r) =>
      r.match?.[0] &&
      'path' in r.match[0] &&
      (r.match[0].path as string[])[0]?.includes(`/deploys/${deploymentId}`),
  );
  if (idx !== -1) routes.splice(idx, 1);
}

async function postConfig(): Promise<void> {
  const res = await fetch(`${CADDY_ADMIN}/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Caddy Admin API error (${res.status}): ${body}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Called once at API startup.
 * Rebuilds running deployment routes from SQLite and applies the full config to Caddy.
 * Retries with backoff in case Caddy isn't ready yet.
 */
export async function initCaddyConfig(): Promise<void> {
  // Rebuild in-memory config from persisted running deployments
  const running = dbListDeployments().filter((d) => d.status === 'running' && d.port != null);
  for (const d of running) {
    _upsertRoute(d.id, d.port!);
  }

  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      await postConfig();
      console.log(`[caddy] Config applied (${running.length} existing deployment routes restored)`);
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[caddy] Apply attempt ${attempt}/12 failed: ${msg}`);
      await sleep(2500);
    }
  }

  throw new Error('[caddy] Could not apply config after 12 attempts — is Caddy running?');
}

/**
 * Adds a reverse-proxy route for a new deployment.
 * Returns the live URL that can be accessed via the browser.
 */
export async function addDeploymentRoute(deploymentId: string, dindPort: number): Promise<string> {
  _upsertRoute(deploymentId, dindPort);
  await postConfig();
  return `http://localhost/deploys/${deploymentId}/`;
}

/**
 * Removes the route for a stopped/deleted deployment.
 */
export async function removeDeploymentRoute(deploymentId: string): Promise<void> {
  _removeRoute(deploymentId);
  await postConfig();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
