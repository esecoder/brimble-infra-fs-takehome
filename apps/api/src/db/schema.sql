-- ──────────────────────────────────────────────────────
-- Brimble DB Schema
-- SQLite with WAL mode for concurrent reads during builds
-- ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deployments (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  source_type  TEXT NOT NULL
               CHECK (source_type IN ('git', 'upload')),
  source_url   TEXT,
  image_tag    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN (
                 'pending', 'cloning', 'building',
                 'deploying', 'running', 'failed', 'stopped'
               )),
  container_id TEXT,
  port         INTEGER,
  live_url     TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Log lines written during build and deploy phases.
-- Persisted so the UI can scroll back after a build completes.
CREATE TABLE IF NOT EXISTS logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id  TEXT    NOT NULL,
  line           TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_logs_deployment    ON logs(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_created ON deployments(created_at DESC);
