import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Deployment, LogEntry } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.DATABASE_URL ?? './brimble.db';
  _db = new Database(dbPath);

  // Performance + safety settings
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');

  // Apply schema (idempotent — uses IF NOT EXISTS)
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  _db.exec(schema);

  return _db;
}

// ── Deployments ────────────────────────────────────────────────────────────

export function dbCreateDeployment(
  d: Omit<Deployment, 'created_at' | 'updated_at'>,
): Deployment {
  const stmt = getDB().prepare<Omit<Deployment, 'created_at' | 'updated_at'>, Deployment>(`
    INSERT INTO deployments
      (id, name, source_type, source_url, image_tag, status, container_id, port, live_url, error)
    VALUES
      (@id, @name, @source_type, @source_url, @image_tag, @status, @container_id, @port, @live_url, @error)
    RETURNING *
  `);
  return stmt.get(d)!;
}

export function dbGetDeployment(id: string): Deployment | undefined {
  return getDB()
    .prepare<string, Deployment>('SELECT * FROM deployments WHERE id = ?')
    .get(id);
}

export function dbListDeployments(): Deployment[] {
  return getDB()
    .prepare<[], Deployment>('SELECT * FROM deployments ORDER BY created_at DESC')
    .all();
}

export function dbUpdateDeployment(
  id: string,
  updates: Partial<Omit<Deployment, 'id' | 'created_at'>>,
): Deployment | undefined {
  const fields = (Object.keys(updates) as Array<keyof typeof updates>)
    .map((k) => `${k} = @${k}`)
    .join(', ');

  return getDB()
    .prepare<{ id: string } & typeof updates, Deployment>(
      `UPDATE deployments SET ${fields}, updated_at = datetime('now') WHERE id = @id RETURNING *`,
    )
    .get({ id, ...updates });
}

export function dbDeleteDeployment(id: string): void {
  getDB().prepare('DELETE FROM deployments WHERE id = ?').run(id);
}

// ── Logs ───────────────────────────────────────────────────────────────────

export function dbInsertLog(deploymentId: string, line: string): void {
  getDB()
    .prepare('INSERT INTO logs (deployment_id, line) VALUES (?, ?)')
    .run(deploymentId, line);
}

export function dbGetLogs(deploymentId: string): LogEntry[] {
  return getDB()
    .prepare<string, LogEntry>('SELECT * FROM logs WHERE deployment_id = ? ORDER BY id ASC')
    .all(deploymentId);
}
