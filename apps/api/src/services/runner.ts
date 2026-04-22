import Dockerode from 'dockerode';
import { emitLog } from './logStore.js';
import { dbInsertLog } from '../db/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Container runner service
//
// Runs the built image as a Docker container via the DinD daemon.
// Each container listens on port 3000 internally (set via PORT env var —
// the Railpack convention). We map that to a sequentially-allocated host
// port on the DinD network (default starting at 4000).
//
// Since the DinD container is on the same Docker Compose network as Caddy,
// Caddy can reach deployed containers at `dind:<allocatedPort>`.
// ─────────────────────────────────────────────────────────────────────────────

const CONTAINER_APP_PORT = 3000; // Port apps listen on inside their container
const BASE_PORT = parseInt(process.env.DEPLOY_BASE_PORT ?? '4000', 10);

/** Simple in-process port counter. Persists only for the lifetime of the API process.
 *  On restart, we reload running deployments from SQLite in pipeline.ts which keeps
 *  track of the allocated ports.
 */
let portCounter = BASE_PORT;

function allocatePort(): number {
  return portCounter++;
}

function buildDockerClient(): Dockerode {
  const host = process.env.DOCKER_HOST;

  if (host?.startsWith('tcp://')) {
    const url = new URL(host);
    return new Dockerode({
      host: url.hostname,
      port: parseInt(url.port || '2375', 10),
      protocol: 'http',
    });
  }

  // Fallback to Unix socket (useful for local dev without DinD)
  return new Dockerode({
    socketPath: host?.replace('unix://', '') ?? '/var/run/docker.sock',
  });
}

export const docker = buildDockerClient();

export interface RunResult {
  containerId: string;
  containerName: string;
  port: number;
}

export async function startContainer(
  deploymentId: string,
  imageTag: string,
): Promise<RunResult> {
  const log = (line: string): void => {
    emitLog(deploymentId, line);
    dbInsertLog(deploymentId, line);
  };

  const port = allocatePort();
  const containerName = `brimble-app-${deploymentId}`;

  log(`[runner] Starting container: ${containerName}`);
  log(`[runner] Image: ${imageTag}`);
  log(`[runner] DinD port mapping: ${port} → container:${CONTAINER_APP_PORT}`);

  // Remove an existing container with the same name (handles redeploys)
  try {
    const existing = docker.getContainer(containerName);
    await existing.stop({ t: 3 }).catch(() => null);
    await existing.remove({ force: true }).catch(() => null);
  } catch {
    // No prior container — that's fine
  }

  const container = await docker.createContainer({
    Image: imageTag,
    name: containerName,
    Env: [`PORT=${CONTAINER_APP_PORT}`],
    ExposedPorts: { [`${CONTAINER_APP_PORT}/tcp`]: {} },
    HostConfig: {
      PortBindings: {
        [`${CONTAINER_APP_PORT}/tcp`]: [
          { HostIp: '0.0.0.0', HostPort: String(port) },
        ],
      },
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
    },
  });

  await container.start();

  const info = await container.inspect();
  const shortId = info.Id.slice(0, 12);
  log(`[runner] ✓ Container started (${shortId})`);

  return {
    containerId: info.Id,
    containerName,
    port,
  };
}

export async function stopContainer(containerId: string): Promise<void> {
  try {
    const container = docker.getContainer(containerId);
    await container.stop({ t: 5 });
    await container.remove({ force: true });
  } catch (err: unknown) {
    // Container may already be gone — log but don't throw
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[runner] Could not stop/remove container ${containerId.slice(0, 12)}: ${msg}`);
  }
}
