import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { getDB } from './db/index.js';
import deploymentsRouter from './routes/deployments.js';
import { initCaddyConfig } from './services/caddy.js';
import { syncPortCounter } from './services/pipeline.js';

// ─────────────────────────────────────────────────────────────────────────────
// Brimble API — Entry Point
//
// Hono on @hono/node-server (Node.js 22).
// Startup sequence:
//   1. Initialise SQLite DB (creates schema if needed)
//   2. Sync port counter with highest in-use port (resilient to restarts)
//   3. Apply Caddy base config + restore routes for running deployments
//   4. Start HTTP server
// ─────────────────────────────────────────────────────────────────────────────

const app = new Hono();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use('*', cors({ origin: '*' }));
app.use('*', logger());

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

// ── Routes ─────────────────────────────────────────────────────────────────
app.route('/api/deployments', deploymentsRouter);

// ── Startup ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3001', 10);

function bootstrap(): void {
  // 1. DB
  getDB();
  console.log('[db] SQLite initialised');

  // 2. Port counter — prevent collisions after API restarts
  syncPortCounter();

  // 3. Caddy — async, non-blocking. If Caddy isn't ready yet (race during
  //    `docker compose up`), initCaddyConfig retries automatically.
  initCaddyConfig().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[caddy] Init error (deployments will route correctly once Caddy is ready):', msg);
  });

  // 4. HTTP server
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[api] Listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap();
