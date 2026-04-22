import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/client';
import type { DeploymentStatus } from '../types';

export interface LogLine {
  text: string;
  timestamp: number;
}

export interface UseLogStreamResult {
  lines: LogLine[];
  isStreaming: boolean;
  finalStatus: DeploymentStatus | null;
  clear: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// useLogStream
//
// Opens an SSE connection to /api/deployments/:id/logs/stream.
// The SSE endpoint replays all historical logs first, then forwards live lines.
// This means the hook always shows a complete picture regardless of when the
// user opens the log viewer.
//
// Returns:
//   lines       — all log lines (historical + live)
//   isStreaming — true while the SSE connection is open
//   finalStatus — set when the `done` event is received
//   clear       — resets the log buffer (useful when switching deployments)
// ─────────────────────────────────────────────────────────────────────────────

export function useLogStream(deploymentId: string | null): UseLogStreamResult {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [finalStatus, setFinalStatus] = useState<DeploymentStatus | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const currentIdRef = useRef<string | null>(null);

  const clear = useCallback(() => {
    setLines([]);
    setIsStreaming(false);
    setFinalStatus(null);
  }, []);

  useEffect(() => {
    // Close any existing stream before opening a new one
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!deploymentId) {
      clear();
      return;
    }

    // Only re-open if the deployment ID changed
    if (currentIdRef.current !== deploymentId) {
      clear();
      currentIdRef.current = deploymentId;
    }

    const url = api.logs.streamUrl(deploymentId);
    const es = new EventSource(url);
    esRef.current = es;
    setIsStreaming(true);

    es.addEventListener('log', (e: MessageEvent<string>) => {
      const text = e.data;
      setLines((prev) => [...prev, { text, timestamp: Date.now() }]);
    });

    es.addEventListener('done', (e: MessageEvent<string>) => {
      setFinalStatus(e.data as DeploymentStatus);
      setIsStreaming(false);
      es.close();
      esRef.current = null;
    });

    es.onerror = () => {
      // EventSource reconnects automatically on transient errors.
      // If the connection is permanently closed (stream done), the server
      // will have sent a `done` event first, so we'd already be cleaned up.
      setIsStreaming(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [deploymentId, clear]);

  return { lines, isStreaming, finalStatus, clear };
}
