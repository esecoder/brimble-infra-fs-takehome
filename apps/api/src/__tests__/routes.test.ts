import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─────────────────────────────────────────────────────────────────────────────
// API route validation — unit tests
//
// These tests verify that the deployments router correctly validates input and
// returns well-formed error responses before touching the DB or starting the
// pipeline. Tests that exercise happy paths mock the DB/pipeline so we don't
// need a live SQLite file or Docker daemon.
//
// vi.mock() calls are hoisted by vitest above all imports automatically.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../db/index.js', () => ({
  dbListDeployments: vi.fn(),
  dbGetDeployment: vi.fn(),
  dbGetLogs: vi.fn(),
  dbInsertLog: vi.fn(),
  dbUpdateDeployment: vi.fn(),
  getDB: vi.fn(),
}));

vi.mock('../services/pipeline.js', () => ({
  createAndRunDeployment: vi.fn(),
  teardownDeployment: vi.fn(),
}));

vi.mock('../services/logStore.js', () => ({
  getEmitter: vi.fn(),
  hasActiveEmitter: vi.fn().mockReturnValue(false),
}));

// Import after mocks are registered
import { dbListDeployments, dbGetDeployment } from '../db/index.js';
import { createAndRunDeployment, teardownDeployment } from '../services/pipeline.js';
import deploymentsRouter from '../routes/deployments.js';

// Build a minimal Hono app for testing — mirrors apps/api/src/index.ts setup
function buildTestApp() {
  const app = new Hono();
  app.route('/api/deployments', deploymentsRouter);
  return app;
}

const MOCK_DEPLOYMENT = {
  id: 'abc-123',
  name: 'my-app',
  source_type: 'git',
  source_url: 'https://github.com/user/repo',
  image_tag: null,
  status: 'pending',
  container_id: null,
  port: null,
  live_url: null,
  error: null,
  created_at: '2024-01-01T00:00:00',
  updated_at: '2024-01-01T00:00:00',
};

describe('POST /api/deployments — input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAndRunDeployment).mockReturnValue(MOCK_DEPLOYMENT as never);
  });

  it('rejects a request with no body', async () => {
    const app = buildTestApp();
    const res = await app.request('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid sourceType', async () => {
    const app = buildTestApp();
    const res = await app.request('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'docker', sourceUrl: 'https://example.com' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/sourceType/);
  });

  it('rejects a git deployment with no sourceUrl', async () => {
    const app = buildTestApp();
    const res = await app.request('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'git' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('sourceUrl');
  });

  it('rejects a git deployment with a non-URL sourceUrl', async () => {
    const app = buildTestApp();
    const res = await app.request('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'git', sourceUrl: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts a valid git deployment and calls createAndRunDeployment', async () => {
    const app = buildTestApp();
    const res = await app.request('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'git',
        sourceUrl: 'https://github.com/user/repo',
        name: 'my-app',
      }),
    });
    expect(res.status).toBe(201);
    expect(createAndRunDeployment).toHaveBeenCalledOnce();
    expect(createAndRunDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'git',
        sourceUrl: 'https://github.com/user/repo',
        name: 'my-app',
      }),
    );
  });

  it('accepts a valid subdirectory tree URL', async () => {
    const app = buildTestApp();
    const res = await app.request('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'git',
        sourceUrl: 'https://github.com/esecoder/brimble-infra-fs-takehome/tree/main/sample-app',
      }),
    });
    // The URL is valid (new URL() parses it fine) → should go to pipeline
    expect(res.status).toBe(201);
  });
});

describe('GET /api/deployments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty array when no deployments exist', async () => {
    vi.mocked(dbListDeployments).mockReturnValue([]);
    const app = buildTestApp();
    const res = await app.request('/api/deployments');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns the deployment list from the database', async () => {
    vi.mocked(dbListDeployments).mockReturnValue([MOCK_DEPLOYMENT] as never);
    const app = buildTestApp();
    const res = await app.request('/api/deployments');
    expect(res.status).toBe(200);
    const body = await res.json() as typeof MOCK_DEPLOYMENT[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('abc-123');
  });
});

describe('GET /api/deployments/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for an unknown deployment ID', async () => {
    vi.mocked(dbGetDeployment).mockReturnValue(undefined);
    const app = buildTestApp();
    const res = await app.request('/api/deployments/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns the deployment when it exists', async () => {
    vi.mocked(dbGetDeployment).mockReturnValue(MOCK_DEPLOYMENT as never);
    const app = buildTestApp();
    const res = await app.request('/api/deployments/abc-123');
    expect(res.status).toBe(200);
    const body = await res.json() as typeof MOCK_DEPLOYMENT;
    expect(body.id).toBe('abc-123');
    expect(body.status).toBe('pending');
  });
});

describe('DELETE /api/deployments/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when deleting a non-existent deployment', async () => {
    vi.mocked(dbGetDeployment).mockReturnValue(undefined);
    const app = buildTestApp();
    const res = await app.request('/api/deployments/ghost', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('calls teardownDeployment and returns success', async () => {
    vi.mocked(dbGetDeployment).mockReturnValue(MOCK_DEPLOYMENT as never);
    vi.mocked(teardownDeployment).mockResolvedValue(undefined);
    const app = buildTestApp();
    const res = await app.request('/api/deployments/abc-123', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(teardownDeployment).toHaveBeenCalledWith('abc-123');
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
