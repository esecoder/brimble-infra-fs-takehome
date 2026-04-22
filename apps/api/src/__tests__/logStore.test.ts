import { describe, it, expect, beforeEach } from 'vitest';
import {
  getEmitter,
  emitLog,
  closeEmitter,
  hasActiveEmitter,
} from '../services/logStore.js';

// ─────────────────────────────────────────────────────────────────────────────
// logStore — unit tests
//
// The log store is the backbone of live SSE streaming. It manages per-deployment
// EventEmitters that bridge the pipeline (which writes log lines) to SSE
// connections (which read them). Getting this right matters — a bug here means
// lost log lines or hanging SSE connections.
//
// Each test uses a unique deployment ID so there is no shared state between runs.
// ─────────────────────────────────────────────────────────────────────────────

// Generate a unique ID per test to avoid cross-test state leakage
let idCounter = 0;
function uid(): string {
  return `test-deploy-${++idCounter}`;
}

describe('logStore', () => {
  describe('getEmitter', () => {
    it('creates a new emitter on first call', () => {
      const id = uid();
      expect(hasActiveEmitter(id)).toBe(false);
      getEmitter(id);
      expect(hasActiveEmitter(id)).toBe(true);
    });

    it('returns the same emitter instance on repeated calls', () => {
      const id = uid();
      const e1 = getEmitter(id);
      const e2 = getEmitter(id);
      expect(e1).toBe(e2);
    });
  });

  describe('emitLog', () => {
    it('delivers a log line to a subscribed listener', () => {
      const id = uid();
      const received: string[] = [];
      getEmitter(id).on('log', (line: string) => received.push(line));

      emitLog(id, 'build started');
      emitLog(id, 'installing dependencies');

      expect(received).toEqual(['build started', 'installing dependencies']);
    });

    it('delivers log lines to multiple concurrent subscribers', () => {
      const id = uid();
      const sub1: string[] = [];
      const sub2: string[] = [];

      getEmitter(id).on('log', (l: string) => sub1.push(l));
      getEmitter(id).on('log', (l: string) => sub2.push(l));

      emitLog(id, 'shared line');

      expect(sub1).toEqual(['shared line']);
      expect(sub2).toEqual(['shared line']);
    });

    it('does nothing when emitting to a non-existent deployment', () => {
      // Should not throw, just no-ops
      expect(() => emitLog('no-such-id', 'ignored')).not.toThrow();
    });
  });

  describe('closeEmitter', () => {
    it('fires the done event synchronously', () => {
      const id = uid();
      let doneCalled = false;
      getEmitter(id).once('done', () => { doneCalled = true; });

      closeEmitter(id);

      expect(doneCalled).toBe(true);
    });

    it('keeps the emitter alive immediately after close (for SSE drain)', () => {
      // closeEmitter schedules deletion after 60s — the emitter must still
      // exist right after the call so any pending SSE clients can finish draining.
      const id = uid();
      getEmitter(id); // create
      closeEmitter(id);
      expect(hasActiveEmitter(id)).toBe(true);
    });

    it('does nothing when closing a non-existent emitter', () => {
      expect(() => closeEmitter('ghost-deploy')).not.toThrow();
    });
  });
});
