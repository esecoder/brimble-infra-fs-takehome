import { useEffect, useRef } from 'react';
import type { LogLine } from '../hooks/useLogStream';
import type { Deployment } from '../types';

interface Props {
  deployment: Deployment | null;
  lines: LogLine[];
  isStreaming: boolean;
  finalStatus: Deployment['status'] | null;
}

/** Colour-code log lines based on their content */
function classifyLine(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('✗') || t.includes('error') || t.includes('failed') || t.includes('fatal')) {
    return 'error';
  }
  if (t.includes('✓') || t.includes('success') || t.includes('complete') || t.includes('live!')) {
    return 'success';
  }
  if (t.includes('[pipeline]') || t.includes('[caddy]') || t.includes('[runner]')) {
    return 'info';
  }
  return '';
}

export function LogViewer({ deployment, lines, isStreaming, finalStatus }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // Track whether the user has scrolled away from the bottom
  function handleScroll() {
    const el = bodyRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  // Auto-scroll only when the user is at (or near) the bottom
  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!deployment) {
    return (
      <div className="panel log-panel">
        <div className="log-placeholder">
          <span style={{ fontSize: '2rem' }}>📋</span>
          <p>Select a deployment to view logs</p>
        </div>
      </div>
    );
  }

  const statusColor =
    finalStatus === 'running' ? 'var(--status-running)'
    : finalStatus === 'failed' ? 'var(--status-failed)'
    : 'var(--text-secondary)';

  return (
    <div className="panel log-panel">
      <div className="log-header">
        <span className="log-title">
          Logs — <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{deployment.name}</span>
        </span>

        {isStreaming && (
          <span className="log-stream-badge" title="Live stream active">LIVE</span>
        )}

        {!isStreaming && finalStatus && (
          <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: statusColor, fontWeight: 600 }}>
            {finalStatus.toUpperCase()}
          </span>
        )}
      </div>

      <div
        className="log-body"
        ref={bodyRef}
        onScroll={handleScroll}
        id="log-body"
        aria-label="Deployment logs"
        aria-live="polite"
      >
        {lines.length === 0 ? (
          <span className="log-empty">Waiting for logs{isStreaming ? '…' : ''}</span>
        ) : (
          lines.map((line, i) => (
            <span key={i} className={`log-line${classifyLine(line.text) ? ` ${classifyLine(line.text)}` : ''}`}>
              {line.text}
            </span>
          ))
        )}

        {!isStreaming && lines.length > 0 && (
          <span style={{ display: 'block', marginTop: 8, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.72rem' }}>
            — end of log —
          </span>
        )}
      </div>
    </div>
  );
}
