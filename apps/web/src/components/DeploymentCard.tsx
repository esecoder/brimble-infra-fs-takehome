import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Deployment } from '../types';

interface Props {
  deployment: Deployment;
  selected: boolean;
  onSelect: (id: string) => void;
}

const STATUS_LABELS: Record<Deployment['status'], string> = {
  pending: 'Pending',
  cloning: 'Cloning',
  building: 'Building',
  deploying: 'Deploying',
  running: 'Running',
  failed: 'Failed',
  stopped: 'Stopped',
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function DeploymentCard({ deployment: d, selected, onSelect }: Props) {
  const qc = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => api.deployments.delete(d.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deployments'] });
    },
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Stop deployment "${d.name}"?`)) {
      deleteMutation.mutate();
    }
  };

  const shortTag = d.image_tag
    ? d.image_tag.split(':').pop()?.slice(-8) ?? null
    : null;

  return (
    <div
      className={`deployment-card${selected ? ' selected' : ''}`}
      onClick={() => onSelect(d.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(d.id)}
      aria-selected={selected}
      id={`card-${d.id}`}
    >
      <div className="card-top">
        <span className="card-name" title={d.name}>{d.name}</span>
        <div className="card-actions">
          <span className={`badge badge-${d.status}`}>
            {STATUS_LABELS[d.status]}
          </span>
          <button
            className="btn btn-danger"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            title="Stop deployment"
            id={`btn-delete-${d.id}`}
          >
            {deleteMutation.isPending ? '…' : '✕'}
          </button>
        </div>
      </div>

      <div className="card-meta">
        {d.source_url && (
          <span className="card-meta-item" title={d.source_url}>
            📦 {d.source_url.replace('https://', '').replace('http://', '')}
          </span>
        )}
        {d.source_type === 'upload' && !d.source_url && (
          <span className="card-meta-item">📤 Uploaded archive</span>
        )}
        {shortTag && (
          <span className="card-meta-item" title={d.image_tag ?? ''}>
            🏷️ :{shortTag}
          </span>
        )}
        {d.live_url && d.status === 'running' && (
          <span className="card-meta-item">
            🔗{' '}
            <a href={d.live_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              {d.live_url}
            </a>
          </span>
        )}
        <span className="card-meta-item">🕐 {formatRelativeTime(d.created_at)}</span>
      </div>

      {d.error && d.status === 'failed' && (
        <div style={{ fontSize: '0.72rem', color: 'var(--status-failed)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
          {d.error.slice(0, 100)}
        </div>
      )}
    </div>
  );
}
