import { useState, useRef, type FormEvent, type DragEvent } from 'react';
import { api } from '../api/client';
import type { Deployment } from '../types';

interface Props {
  onCreated: (deployment: Deployment) => void;
}

type Mode = 'git' | 'upload';

export function DeployForm({ onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('git');
  const [gitUrl, setGitUrl] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let deployment: Deployment;

      if (mode === 'git') {
        if (!gitUrl.trim()) throw new Error('Please enter a Git URL');
        deployment = await api.deployments.createGit(gitUrl.trim(), name.trim() || undefined);
      } else {
        if (!file) throw new Error('Please select a file to upload');
        deployment = await api.deployments.createUpload(file, name.trim() || undefined);
      }

      onCreated(deployment);
      // Reset form
      setGitUrl('');
      setName('');
      setFile(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  return (
    <form className="form" onSubmit={handleSubmit} id="deploy-form">
      {/* Source mode toggle */}
      <div className="form-group">
        <label className="form-label">Source</label>
        <div className="tab-row">
          <button
            type="button"
            id="tab-git"
            className={`tab-btn${mode === 'git' ? ' active' : ''}`}
            onClick={() => { setMode('git'); setError(null); }}
          >
            Git URL
          </button>
          <button
            type="button"
            id="tab-upload"
            className={`tab-btn${mode === 'upload' ? ' active' : ''}`}
            onClick={() => { setMode('upload'); setError(null); }}
          >
            Upload Archive
          </button>
        </div>
      </div>

      {/* Git URL input */}
      {mode === 'git' && (
        <div className="form-group">
          <label className="form-label" htmlFor="git-url">Repository URL</label>
          <input
            id="git-url"
            className="form-input mono"
            type="url"
            placeholder="https://github.com/user/repo"
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            required
          />
        </div>
      )}

      {/* File upload */}
      {mode === 'upload' && (
        <div className="form-group">
          <label className="form-label">Archive</label>
          <div
            className={`file-drop${dragging ? ' has-file' : ''}${file ? ' has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.tar.gz,.tgz"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ display: 'none' }}
            />
            {file ? (
              <span style={{ color: 'var(--text-secondary)' }}>📦 {file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
            ) : (
              <span>Drop a <strong>.zip</strong> or <strong>.tar.gz</strong> here, or click to browse</span>
            )}
          </div>
        </div>
      )}

      {/* Optional name */}
      <div className="form-group">
        <label className="form-label" htmlFor="deploy-name">Name (optional)</label>
        <input
          id="deploy-name"
          className="form-input"
          type="text"
          placeholder="my-app"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
        />
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <button
        id="btn-deploy"
        type="submit"
        className="btn btn-primary btn-full"
        disabled={loading}
      >
        {loading ? (
          <><span className="spinner" /> Deploying…</>
        ) : (
          '🚀 Deploy'
        )}
      </button>
    </form>
  );
}
