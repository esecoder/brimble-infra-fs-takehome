import { describe, it, expect } from 'vitest';
import { parseTreeUrl } from '../services/source.js';

// ─────────────────────────────────────────────────────────────────────────────
// parseTreeUrl — unit tests
//
// This function is the entry point for the subdirectory-aware clone path.
// It parses GitHub and GitLab "tree" browser URLs into structured clone info
// so the pipeline can do a targeted sparse-checkout instead of a full clone.
//
// All tests are pure (no I/O) — parseTreeUrl only does regex matching.
// ─────────────────────────────────────────────────────────────────────────────

describe('parseTreeUrl', () => {
  // ── GitHub ────────────────────────────────────────────────────────────────

  it('parses a standard GitHub tree URL', () => {
    const result = parseTreeUrl(
      'https://github.com/esecoder/brimble-infra-fs-takehome/tree/main/sample-app',
    );
    expect(result).toEqual({
      cloneUrl: 'https://github.com/esecoder/brimble-infra-fs-takehome',
      branch: 'main',
      subdir: 'sample-app',
    });
  });

  it('parses a GitHub tree URL with a nested subdirectory path', () => {
    const result = parseTreeUrl(
      'https://github.com/myorg/monorepo/tree/main/apps/backend/api',
    );
    expect(result).toEqual({
      cloneUrl: 'https://github.com/myorg/monorepo',
      branch: 'main',
      subdir: 'apps/backend/api',
    });
  });

  it('parses a GitHub tree URL with a non-main branch', () => {
    const result = parseTreeUrl(
      'https://github.com/user/repo/tree/feature-xyz/packages/server',
    );
    expect(result).toEqual({
      cloneUrl: 'https://github.com/user/repo',
      branch: 'feature-xyz',
      subdir: 'packages/server',
    });
  });

  // ── GitLab ────────────────────────────────────────────────────────────────

  it('parses a standard GitLab tree URL', () => {
    const result = parseTreeUrl(
      'https://gitlab.com/mygroup/myproject/-/tree/develop/backend',
    );
    expect(result).toEqual({
      cloneUrl: 'https://gitlab.com/mygroup/myproject',
      branch: 'develop',
      subdir: 'backend',
    });
  });

  it('parses a GitLab tree URL with a nested path', () => {
    const result = parseTreeUrl(
      'https://gitlab.com/org/repo/-/tree/main/services/auth',
    );
    expect(result).toEqual({
      cloneUrl: 'https://gitlab.com/org/repo',
      branch: 'main',
      subdir: 'services/auth',
    });
  });

  // ── Non-tree URLs (should return null → triggers full clone) ──────────────

  it('returns null for a plain GitHub clone URL', () => {
    expect(parseTreeUrl('https://github.com/user/repo')).toBeNull();
  });

  it('returns null for a .git clone URL', () => {
    expect(parseTreeUrl('https://github.com/user/repo.git')).toBeNull();
  });

  it('returns null for a GitHub blob (file) URL', () => {
    // /blob/ URLs point to individual files, not directories
    expect(
      parseTreeUrl('https://github.com/user/repo/blob/main/index.js'),
    ).toBeNull();
  });

  it('returns null for a GitHub pull-request URL', () => {
    expect(
      parseTreeUrl('https://github.com/user/repo/pull/42'),
    ).toBeNull();
  });

  it('returns null for a non-GitHub/GitLab URL', () => {
    expect(parseTreeUrl('https://bitbucket.org/user/repo/src/main/app')).toBeNull();
    expect(parseTreeUrl('https://example.com/user/repo')).toBeNull();
  });
});
