import { spawn } from 'child_process';
import { emitLog } from './logStore.js';
import { dbInsertLog } from '../db/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Railpack builder service
//
// Calls the `railpack` CLI as a child process. Railpack auto-detects the
// language/framework and produces a standard OCI image via BuildKit.
//
// The DOCKER_HOST environment variable (set to tcp://dind:2375 in compose)
// is inherited by the spawned process, so Railpack's BuildKit calls go to
// the DinD daemon — not the host Docker socket.
//
// stdout and stderr are streamed line-by-line to:
//   1. The in-memory EventEmitter (for live SSE delivery)
//   2. The SQLite logs table (for post-build scroll-back)
// ─────────────────────────────────────────────────────────────────────────────

export function buildImage(
  deploymentId: string,
  sourceDir: string,
  imageTag: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const log = (line: string): void => {
      emitLog(deploymentId, line);
      dbInsertLog(deploymentId, line);
    };

    log(`[builder] Starting Railpack build`);
    log(`[builder] Source: ${sourceDir}`);
    log(`[builder] Image tag: ${imageTag}`);
    log(`[builder] Docker host: ${process.env.DOCKER_HOST ?? 'unix:///var/run/docker.sock'}`);

    const proc = spawn('railpack', ['build', sourceDir, '--name', imageTag], {
      // Inherit full environment so DOCKER_HOST propagates to Railpack/BuildKit
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (data: Buffer) => {
      data
        .toString()
        .split('\n')
        .filter(Boolean)
        .forEach(log);
    });

    proc.stderr.on('data', (data: Buffer) => {
      data
        .toString()
        .split('\n')
        .filter(Boolean)
        .forEach(log);
    });

    proc.on('error', (err) => {
      const msg = `[builder] Failed to start railpack: ${err.message}`;
      log(msg);
      reject(new Error(msg));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        log('[builder] ✓ Build succeeded');
        resolve();
      } else {
        const msg = `[builder] ✗ Railpack exited with code ${code}`;
        log(msg);
        reject(new Error(msg));
      }
    });
  });
}
