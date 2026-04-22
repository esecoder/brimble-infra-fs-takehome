import { v4 as uuid } from 'uuid';
import {
  dbCreateDeployment,
  dbGetDeployment,
  dbUpdateDeployment,
  dbListDeployments,
  dbInsertLog,
} from '../db/index.js';
import { buildImage } from './builder.js';
import { startContainer, stopContainer } from './runner.js';
import { addDeploymentRoute, removeDeploymentRoute } from './caddy.js';
import { resolveGitSource, resolveUploadSource, cleanupSource } from './source.js';
import { emitLog, closeEmitter } from './logStore.js';
import type { CreateDeploymentBody, Deployment } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline orchestrator
//
// Flow:
//   pending → cloning → building → deploying → running
//                                              ↘ failed (on any error)
//
// createAndRunDeployment() creates the DB record synchronously and kicks off
// the async pipeline in the background. The API immediately returns the record
// with status "pending" — the UI polls/streams to track progress.
// ─────────────────────────────────────────────────────────────────────────────

export interface UploadFile {
  buffer: ArrayBuffer;
  filename: string;
}

export function createAndRunDeployment(
  body: CreateDeploymentBody,
  uploadFile?: UploadFile,
): Deployment {
  const id = uuid();
  const name = body.name?.trim() || `deploy-${id.slice(0, 8)}`;
  const imageTag = `brimble/${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}:${Date.now()}`;

  const deployment = dbCreateDeployment({
    id,
    name,
    source_type: body.sourceType,
    source_url: body.sourceUrl ?? null,
    image_tag: null,
    status: 'pending',
    container_id: null,
    port: null,
    live_url: null,
    error: null,
  });

  // Fire-and-forget — does not block the HTTP response
  runPipeline(id, imageTag, body, uploadFile).catch((err: unknown) => {
    console.error(`[pipeline] Unhandled top-level error for ${id}:`, err);
  });

  return deployment;
}

async function runPipeline(
  deploymentId: string,
  imageTag: string,
  body: CreateDeploymentBody,
  uploadFile?: UploadFile,
): Promise<void> {
  const log = (line: string): void => {
    emitLog(deploymentId, line);
    dbInsertLog(deploymentId, line);
  };

  try {
    // ── Step 1: Acquire source ──────────────────────────────────────────────
    setStatus(deploymentId, 'cloning');
    log('[pipeline] ── Step 1/4: Acquiring source ──────────────────────────');

    let sourceDir: string;

    if (body.sourceType === 'git') {
      if (!body.sourceUrl) throw new Error('sourceUrl is required for git deployments');
      sourceDir = await resolveGitSource(deploymentId, body.sourceUrl, log);
    } else {
      if (!uploadFile) throw new Error('uploadFile is required for upload deployments');
      sourceDir = await resolveUploadSource(deploymentId, uploadFile.buffer, uploadFile.filename, log);
    }

    // ── Step 2: Build image with Railpack ───────────────────────────────────
    setStatus(deploymentId, 'building', { image_tag: imageTag });
    log('[pipeline] ── Step 2/4: Building container image (Railpack) ────────');

    await buildImage(deploymentId, sourceDir, imageTag);

    // ── Step 3: Start container ─────────────────────────────────────────────
    setStatus(deploymentId, 'deploying');
    log('[pipeline] ── Step 3/4: Starting container ──────────────────────────');

    const { containerId, port } = await startContainer(deploymentId, imageTag);

    // ── Step 4: Register Caddy route ────────────────────────────────────────
    log('[pipeline] ── Step 4/4: Registering Caddy route ─────────────────────');

    const liveUrl = await addDeploymentRoute(deploymentId, port);
    log(`[pipeline] Route registered: /deploys/${deploymentId}/`);

    // ── Done ─────────────────────────────────────────────────────────────────
    setStatus(deploymentId, 'running', { container_id: containerId, port, live_url: liveUrl });
    log('[pipeline] ────────────────────────────────────────────────────────');
    log('[pipeline] ✓ Deployment is live!');
    log(`[pipeline] ✓ URL: ${liveUrl}`);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] Deployment ${deploymentId} failed:`, error);
    log(`[pipeline] ✗ Deployment failed: ${error}`);
    setStatus(deploymentId, 'failed', { error });
  } finally {
    // Always: signal SSE stream to close and clean up source files
    closeEmitter(deploymentId);
    await cleanupSource(deploymentId);
  }
}

function setStatus(
  id: string,
  status: Deployment['status'],
  extra?: Partial<Deployment>,
): void {
  dbUpdateDeployment(id, { status, ...extra });
}

// ── Lifecycle management ───────────────────────────────────────────────────

export async function teardownDeployment(deploymentId: string): Promise<void> {
  const deployment = dbGetDeployment(deploymentId);
  if (!deployment) return;

  if (deployment.container_id) {
    await stopContainer(deployment.container_id);
  }

  if (deployment.status === 'running') {
    await removeDeploymentRoute(deploymentId).catch((err: unknown) =>
      console.warn('[pipeline] Caddy route removal failed:', err),
    );
  }

  dbUpdateDeployment(deploymentId, { status: 'stopped' });
}

/**
 * Called on API startup to re-sync the port counter with the highest
 * port currently in use. Prevents collisions after a restart.
 */
export function syncPortCounter(): void {
  const running = dbListDeployments().filter((d) => d.port != null);
  if (running.length === 0) return;

  const maxPort = Math.max(...running.map((d) => d.port!));
  // The runner module allocates ports starting at BASE_PORT; we set the counter
  // to maxPort + 1 by monkey-patching the runner's state via the exported setter.
  // In a production codebase this would live in a shared port-registry module.
  process.env._BRIMBLE_NEXT_PORT = String(maxPort + 1);
}
