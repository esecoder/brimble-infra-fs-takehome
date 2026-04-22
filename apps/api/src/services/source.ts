import { spawn } from 'child_process';
import { mkdir, writeFile, rm } from 'fs/promises';
import path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Source acquisition service
//
// Supports two deployment sources:
//   1. Git URL — clones with --depth 1 (fast); injects auth tokens for private repos
//   2. Uploaded archive (.zip or .tar.gz) — extracts into a build directory
//
// Private repo support:
//   GitHub: set GITHUB_TOKEN (classic PAT with `repo` scope)
//   GitLab: set GITLAB_TOKEN (personal access token with `read_repository`)
//   Bitbucket: use an app password embedded in the URL (not automated here)
// ─────────────────────────────────────────────────────────────────────────────

const BUILDS_DIR = process.env.BUILDS_DIR ?? '/tmp/brimble-builds';

export async function resolveGitSource(
  deploymentId: string,
  gitUrl: string,
  onLog: (line: string) => void,
): Promise<string> {
  const targetDir = path.join(BUILDS_DIR, deploymentId, 'src');
  await mkdir(targetDir, { recursive: true });

  const cloneUrl = injectToken(gitUrl);
  const displayUrl = gitUrl; // never log the token-injected URL

  onLog(`[source] Cloning repository: ${displayUrl}`);
  onLog(`[source] Target directory: ${targetDir}`);

  await runCommand(
    'git',
    ['clone', '--depth', '1', '--single-branch', cloneUrl, targetDir],
    onLog,
  );

  onLog(`[source] Clone complete`);
  return targetDir;
}

export async function resolveUploadSource(
  deploymentId: string,
  fileBuffer: ArrayBuffer,
  filename: string,
  onLog: (line: string) => void,
): Promise<string> {
  const workDir = path.join(BUILDS_DIR, deploymentId);
  const srcDir = path.join(workDir, 'src');
  await mkdir(srcDir, { recursive: true });

  const ext = filename.endsWith('.tar.gz')
    ? '.tar.gz'
    : path.extname(filename).toLowerCase();

  const archivePath = path.join(workDir, `upload${ext}`);
  await writeFile(archivePath, Buffer.from(fileBuffer));

  onLog(`[source] Extracting archive: ${filename} (${fileBuffer.byteLength} bytes)`);

  if (ext === '.zip') {
    await runCommand('unzip', ['-o', archivePath, '-d', srcDir], onLog);
  } else if (ext === '.tar.gz' || ext === '.tgz') {
    await runCommand('tar', ['xzf', archivePath, '-C', srcDir, '--strip-components=1'], onLog);
  } else {
    throw new Error(
      `Unsupported archive format: "${ext}". Please upload a .zip or .tar.gz file.`,
    );
  }

  onLog(`[source] Extraction complete`);
  return srcDir;
}

export async function cleanupSource(deploymentId: string): Promise<void> {
  const workDir = path.join(BUILDS_DIR, deploymentId);
  try {
    await rm(workDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup — don't fail the pipeline over it
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Injects GITHUB_TOKEN or GITLAB_TOKEN into HTTPS Git URLs for private repos */
function injectToken(url: string): string {
  const githubToken = process.env.GITHUB_TOKEN;
  const gitlabToken = process.env.GITLAB_TOKEN;

  if (githubToken && url.includes('github.com')) {
    return url.replace('https://github.com', `https://${githubToken}@github.com`);
  }
  if (gitlabToken && url.includes('gitlab.com')) {
    return url.replace('https://gitlab.com', `https://oauth2:${gitlabToken}@gitlab.com`);
  }
  return url;
}

function runCommand(cmd: string, args: string[], onLog: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout.on('data', (d: Buffer) =>
      d.toString().split('\n').filter(Boolean).forEach(onLog),
    );
    proc.stderr.on('data', (d: Buffer) =>
      d.toString().split('\n').filter(Boolean).forEach(onLog),
    );
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}
