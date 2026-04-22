import type { Deployment } from '../types';
import { DeploymentCard } from './DeploymentCard';

interface Props {
  deployments: Deployment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function DeploymentList({ deployments, selectedId, onSelect }: Props) {
  if (deployments.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-icon">🚀</span>
        <p>No deployments yet.</p>
        <p style={{ fontSize: '0.75rem' }}>Submit a Git URL or upload an archive to get started.</p>
      </div>
    );
  }

  return (
    <div className="deployment-list">
      {deployments.map((d) => (
        <DeploymentCard
          key={d.id}
          deployment={d}
          selected={d.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
