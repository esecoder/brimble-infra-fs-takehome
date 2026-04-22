// ─────────────────────────────────────────────
// Shared TypeScript types across the API
// ─────────────────────────────────────────────

export type DeploymentStatus =
  | 'pending'
  | 'cloning'
  | 'building'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped';

export type SourceType = 'git' | 'upload';

export interface Deployment {
  id: string;
  name: string;
  source_type: SourceType;
  source_url: string | null;
  image_tag: string | null;
  status: DeploymentStatus;
  container_id: string | null;
  port: number | null;
  live_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  id: number;
  deployment_id: string;
  line: string;
  created_at: string;
}

export interface CreateDeploymentBody {
  sourceType: SourceType;
  sourceUrl?: string;
  name?: string;
}
