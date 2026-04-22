import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { DeployForm } from '../components/DeployForm';
import { DeploymentList } from '../components/DeploymentList';
import { LogViewer } from '../components/LogViewer';
import { useLogStream } from '../hooks/useLogStream';
import type { Deployment } from '../types';

// Statuses that don't change — no need to keep polling
const TERMINAL = new Set(['running', 'failed', 'stopped']);

export function IndexPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const qc = useQueryClient();

  // ── Deployments list — poll every 3s while any non-terminal deployments exist ──
  const { data: deployments = [], isLoading, error } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => api.deployments.list(),
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      const hasActive = data.some((d: Deployment) => !TERMINAL.has(d.status));
      return hasActive ? 2000 : 5000;
    },
  });

  // ── Auto-select the most recent deployment when the list first loads ──────
  useEffect(() => {
    if (!selectedId && deployments.length > 0) {
      setSelectedId(deployments[0].id);
    }
  }, [deployments, selectedId]);

  // ── Log stream for the selected deployment ────────────────────────────────
  const { lines, isStreaming, finalStatus, clear } = useLogStream(selectedId);

  function handleSelect(id: string) {
    if (id !== selectedId) {
      clear();
      setSelectedId(id);
    }
  }

  // ── Handle new deployment from the form ───────────────────────────────────
  function handleCreated(deployment: Deployment) {
    void qc.invalidateQueries({ queryKey: ['deployments'] });
    clear();
    setSelectedId(deployment.id);
  }

  const selectedDeployment = deployments.find((d: Deployment) => d.id === selectedId) ?? null;

  return (
    <div className="page">
      <div className="page-grid">
        {/* ── Left column: form + deployment list ─────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* New deployment form */}
          <div className="panel">
            <div className="panel-header">New Deployment</div>
            <div className="panel-body">
              <DeployForm onCreated={handleCreated} />
            </div>
          </div>

          {/* Deployment list */}
          <div className="panel">
            <div className="panel-header">
              Deployments
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.7rem' }}>
                {deployments.length} total
              </span>
            </div>

            {isLoading && (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <span className="spinner" />
              </div>
            )}

            {error && (
              <div className="panel-body">
                <div className="error-banner">
                  Failed to load deployments: {error instanceof Error ? error.message : 'Unknown error'}
                </div>
              </div>
            )}

            {!isLoading && !error && (
              <DeploymentList
                deployments={deployments}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
          </div>
        </div>

        {/* ── Right column: log viewer ─────────────────────────────────────── */}
        <LogViewer
          deployment={selectedDeployment}
          lines={lines}
          isStreaming={isStreaming}
          finalStatus={finalStatus}
        />
      </div>
    </div>
  );
}
