import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory log broadcast store
//
// When the pipeline is running, it emits log lines via `emitLog()`.
// SSE connections subscribe to the EventEmitter for that deployment ID.
// Once the pipeline finishes (success or failure), `closeEmitter()` fires
// a 'done' event and schedules cleanup.
//
// Historical logs are persisted in SQLite and replayed to late-joining
// SSE clients — see routes/deployments.ts for the full handshake.
// ─────────────────────────────────────────────────────────────────────────────

const emitters = new Map<string, EventEmitter>();

export function getEmitter(deploymentId: string): EventEmitter {
  if (!emitters.has(deploymentId)) {
    const e = new EventEmitter();
    e.setMaxListeners(200); // allow many concurrent SSE viewers
    emitters.set(deploymentId, e);
  }
  return emitters.get(deploymentId)!;
}

export function emitLog(deploymentId: string, line: string): void {
  emitters.get(deploymentId)?.emit('log', line);
}

export function closeEmitter(deploymentId: string): void {
  const e = emitters.get(deploymentId);
  if (!e) return;
  e.emit('done');
  // Keep alive briefly so SSE clients can consume the 'done' event
  setTimeout(() => emitters.delete(deploymentId), 60_000);
}

export function hasActiveEmitter(deploymentId: string): boolean {
  return emitters.has(deploymentId);
}
