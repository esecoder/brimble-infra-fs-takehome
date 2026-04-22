import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  dbListDeployments,
  dbGetDeployment,
  dbGetLogs,
} from '../db/index.js';
import { createAndRunDeployment, teardownDeployment } from '../services/pipeline.js';
import { getEmitter, hasActiveEmitter } from '../services/logStore.js';

// ─────────────────────────────────────────────────────────────────────────────
// Deployment routes
//
// All routes live in one router to avoid ambiguity between /:id and /:id/logs.
// More-specific routes are registered first.
//
// Resource design:
//   GET    /api/deployments              list all
//   POST   /api/deployments              create + kick off pipeline (fire-and-forget)
//   GET    /api/deployments/:id          get single deployment
//   DELETE /api/deployments/:id          stop container, remove Caddy route
//   GET    /api/deployments/:id/logs     historical logs (JSON, for scroll-back)
//   GET    /api/deployments/:id/logs/stream  live SSE log stream
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['running', 'failed', 'stopped']);

const router = new Hono();

// ── Log routes (registered FIRST to avoid /:id swallowing them) ────────────

/**
 * GET /api/deployments/:id/logs/stream
 *
 * Server-Sent Events stream for live build + deploy logs.
 *
 * On connection:
 *   1. Replays all historical log lines from SQLite (so late joiners see the full history)
 *   2. If the deployment is still in-progress, subscribes to the in-memory EventEmitter
 *      and forwards new lines as they arrive
 *   3. When the pipeline finishes, emits a `done` event with the final status and closes
 *
 * A queue drains buffered log lines safely between async awaits so no events are dropped.
 */
router.get('/:id/logs/stream', async (c) => {
  const id = c.req.param('id');
  const deployment = dbGetDeployment(id);
  if (!deployment) return c.json({ error: 'Deployment not found' }, 404);

  return streamSSE(c, async (stream) => {
    // Step 1: Replay all persisted log lines so the client is fully caught up
    const historical = dbGetLogs(id);
    for (const entry of historical) {
      await stream.writeSSE({
        data: entry.line,
        event: 'log',
        id: String(entry.id),
      });
    }

    // Step 2: Check if there's anything live to subscribe to
    const current = dbGetDeployment(id)!;
    if (TERMINAL_STATUSES.has(current.status) && !hasActiveEmitter(id)) {
      // Already finished — just close the stream
      await stream.writeSSE({ data: current.status, event: 'done' });
      return;
    }

    if (TERMINAL_STATUSES.has(current.status)) {
      await stream.writeSSE({ data: current.status, event: 'done' });
      return;
    }

    // Step 3: Subscribe to live events via a thread-safe queue
    const queue: string[] = [];
    let finished = false;
    let wakeup: (() => void) | null = null;

    const emitter = getEmitter(id);

    const onLog = (line: string): void => {
      queue.push(line);
      wakeup?.();
    };

    const onDone = (): void => {
      finished = true;
      wakeup?.();
    };

    emitter.on('log', onLog);
    emitter.once('done', onDone);

    stream.onAbort(() => {
      emitter.off('log', onLog);
      emitter.off('done', onDone);
      finished = true;
      wakeup?.();
    });

    // Drain loop — process queued lines, yield when idle
    while (!finished || queue.length > 0) {
      while (queue.length > 0) {
        await stream.writeSSE({ data: queue.shift()!, event: 'log' });
      }
      if (!finished) {
        await new Promise<void>((resolve) => {
          wakeup = resolve;
        });
        wakeup = null;
      }
    }

    // Step 4: Send final status and close
    const final = dbGetDeployment(id);
    await stream.writeSSE({ data: final?.status ?? 'done', event: 'done' });

    emitter.off('log', onLog);
    emitter.off('done', onDone);
  });
});

/**
 * GET /api/deployments/:id/logs
 * Returns persisted log lines as a JSON array.
 * Used by the frontend to render scroll-back after a build completes.
 */
router.get('/:id/logs', (c) => {
  const id = c.req.param('id');
  const deployment = dbGetDeployment(id);
  if (!deployment) return c.json({ error: 'Deployment not found' }, 404);

  return c.json(dbGetLogs(id));
});

// ── Deployment CRUD ────────────────────────────────────────────────────────

/** GET /api/deployments — list all deployments, newest first */
router.get('/', (c) => {
  return c.json(dbListDeployments());
});

/** GET /api/deployments/:id — single deployment detail */
router.get('/:id', (c) => {
  const deployment = dbGetDeployment(c.req.param('id'));
  if (!deployment) return c.json({ error: 'Deployment not found' }, 404);
  return c.json(deployment);
});

/**
 * POST /api/deployments — create a deployment and start the pipeline
 *
 * Accepts two content types:
 *   application/json       → { sourceType: "git", sourceUrl: "https://..." }
 *   multipart/form-data    → file + optional name field (for .zip/.tar.gz uploads)
 */
router.post('/', async (c) => {
  const contentType = c.req.header('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    const name = form.get('name');

    if (!(file instanceof File)) {
      return c.json({ error: 'File is required for upload deployments' }, 400);
    }

    const deployment = createAndRunDeployment(
      {
        sourceType: 'upload',
        name: typeof name === 'string' ? name : undefined,
      },
      { buffer: await file.arrayBuffer(), filename: file.name },
    );

    return c.json(deployment, 201);
  }

  // JSON body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Request body must be a JSON object' }, 400);
  }

  const { sourceType, sourceUrl, name } = body as Record<string, unknown>;

  if (sourceType !== 'git' && sourceType !== 'upload') {
    return c.json({ error: 'sourceType must be "git" or "upload"' }, 400);
  }

  if (sourceType === 'git') {
    if (!sourceUrl || typeof sourceUrl !== 'string') {
      return c.json({ error: 'sourceUrl is required for git deployments' }, 400);
    }
    try {
      new URL(sourceUrl);
    } catch {
      return c.json({ error: 'sourceUrl must be a valid URL' }, 400);
    }
  }

  const deployment = createAndRunDeployment({
    sourceType: sourceType as 'git' | 'upload',
    sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : undefined,
    name: typeof name === 'string' ? name : undefined,
  });

  return c.json(deployment, 201);
});

/**
 * DELETE /api/deployments/:id — stop container and remove Caddy route
 */
router.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deployment = dbGetDeployment(id);
  if (!deployment) return c.json({ error: 'Deployment not found' }, 404);

  await teardownDeployment(id);
  return c.json({ success: true, id });
});

export default router;
