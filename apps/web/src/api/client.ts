import type { Deployment, LogEntry } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// API client
// All paths are relative so they work with both the Vite dev proxy
// (/api → localhost:3001) and in production behind Caddy.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  deployments: {
    list(): Promise<Deployment[]> {
      return fetch(`${BASE}/deployments`).then((r) => handleResponse<Deployment[]>(r));
    },

    get(id: string): Promise<Deployment> {
      return fetch(`${BASE}/deployments/${id}`).then((r) => handleResponse<Deployment>(r));
    },

    createGit(sourceUrl: string, name?: string): Promise<Deployment> {
      return fetch(`${BASE}/deployments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'git', sourceUrl, name }),
      }).then((r) => handleResponse<Deployment>(r));
    },

    createUpload(file: File, name?: string): Promise<Deployment> {
      const form = new FormData();
      form.append('file', file);
      if (name) form.append('name', name);
      return fetch(`${BASE}/deployments`, {
        method: 'POST',
        body: form,
      }).then((r) => handleResponse<Deployment>(r));
    },

    delete(id: string): Promise<{ success: boolean; id: string }> {
      return fetch(`${BASE}/deployments/${id}`, { method: 'DELETE' }).then((r) =>
        handleResponse(r),
      );
    },
  },

  logs: {
    list(deploymentId: string): Promise<LogEntry[]> {
      return fetch(`${BASE}/deployments/${deploymentId}/logs`).then((r) =>
        handleResponse<LogEntry[]>(r),
      );
    },

    /** Returns the URL for an SSE log stream — used by useLogStream hook */
    streamUrl(deploymentId: string): string {
      return `${BASE}/deployments/${deploymentId}/logs/stream`;
    },
  },
};
