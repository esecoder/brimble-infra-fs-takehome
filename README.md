# Brimble Take-Home — Deployment Pipeline

A one-page deployment pipeline that builds container images with **Railpack**, runs them via **Docker**, and routes traffic through **Caddy** — all driven by a TypeScript API and a Vite + TanStack frontend.

---

## Quick Start

```bash
# 1. Clone
git clone <your-repo-url>
cd brimble-infra-fs-takehome

# 2. (Optional) Configure env vars — all have sensible defaults
cp .env.example .env

# 3. Bring everything up
docker compose up --build
```

Open **http://localhost** in your browser.

> **That's it.** No external accounts, no DNS setup, no cloud credentials needed.

---

## Using the UI

1. **Deploy from Git** — paste any public Git URL (e.g. `https://github.com/you/repo`) and click **Deploy**
2. **Deploy from Upload** — switch to "Upload Archive" and drop a `.zip` or `.tar.gz` of your project
3. **Watch logs stream live** — the log panel on the right streams build output in real time while Railpack builds the image
4. **Access your deployment** — once the status flips to `running`, click the live URL: `http://localhost/deploys/<id>/`
5. **Stop a deployment** — click the **✕** button on any deployment card

### Demo deployment (no git required)

The `sample-app/` directory at the repo root is a zero-dependency Node.js server. To deploy it:

```bash
# Create a zip of the sample app and POST it via curl
cd sample-app && zip -r ../sample.zip . && cd ..

curl -X POST http://localhost/api/deployments \
  -F "file=@sample.zip" \
  -F "name=hello-world"
```

Or just paste `https://github.com/<your-fork>/blob/main/sample-app` into the Git URL field.

---

## Architecture

```
Browser
  │
  ▼
Caddy :80 ─────────────────────────────────────────────────────────────
  │                                                                     │
  │  /api/*                                             /deploys/:id/* │
  │                                                                     │
  ▼                                                                     ▼
Hono API :3001                                         DinD daemon
  │                                                    (deployed containers)
  ├── SQLite (WAL)     ← deployment state + log history
  ├── Railpack CLI     ← builds OCI images (DOCKER_HOST=tcp://dind:2375)
  ├── Dockerode        ← starts/stops containers in DinD
  └── Caddy Admin API  ← injects /deploys/:id/* routes dynamically
```

### Services

| Service | Image | Purpose |
|---|---|---|
| `caddy` | `caddy:2-alpine` | Single point of ingress; static routes + dynamic deployment routes via Admin API |
| `api` | Custom (Node 22 + Railpack) | Hono HTTP server; pipeline orchestrator |
| `web` | Custom (Vite build + Caddy) | Static SPA served on port 5173 |
| `dind` | `docker:27-dind` | Docker-in-Docker daemon — builds and runs deployed containers without touching host socket |

### Why Docker-in-Docker?

Railpack drives Docker's **BuildKit** to produce container images. Running the API container with access to the host Docker socket (`/var/run/docker.sock`) would work, but introduces host coupling and security concerns. DinD gives us a fully isolated Docker daemon scoped to the compose network — no socket mount, no host prerequisites beyond Docker itself.

Container images built by Railpack are stored in DinD's image store. When we start a deployed container with `-p <port>:3000`, that port is bound on the DinD container's network interfaces, which are reachable by Caddy (on the same bridge network) at `dind:<port>`.

### Why Caddy over nginx?

- **JSON Admin API** — we POST the full config to `:2019/load` and Caddy swaps it atomically with zero-downtime. No reload commands, no restart, no race conditions.
- **In-memory config** — the API owns the authoritative config object, mutates it on each deployment event, and POSTs it. Simple and predictable.
- **Readable config format** — the `Caddyfile` is human-readable and the JSON is well-documented.

### Why Hono?

- First-class SSE support via `streamSSE` — the log streaming endpoint is 30 lines of clean async code
- Tiny runtime surface, proper TypeScript types throughout
- `@hono/node-server` is a thin Node.js wrapper — no framework lock-in

### Log streaming design

```
Railpack spawns process
  → emits stdout/stderr line-by-line
      ├── dbInsertLog()       — persists to SQLite
      └── emitLog()           — fires EventEmitter keyed by deployment ID

SSE /logs/stream:
  1. Replays all existing SQLite log rows  (catch-up for late joiners)
  2. Subscribes to EventEmitter           (live tail)
  3. Queue drains async                   (no lost lines during await)
  4. On `done` event → writes final status and closes stream
```

This means:
- A client connecting mid-build sees everything from the beginning
- A client connecting after a build sees the full history replayed instantly, then the stream closes
- Logs persist in SQLite forever — you can always scroll back

---

## Pipeline State Machine

```
POST /api/deployments
        │
    [pending]
        │
    [cloning]   ← git clone --depth 1 / extract zip
        │
    [building]  ← railpack build <dir> --name <tag>  (streams logs live)
        │
   [deploying]  ← docker.createContainer + container.start()
        │
    [running]   ← Caddy route injected → live URL available
        │
   (on error) → [failed]
   (on delete) → [stopped]
```

---

## Prerequisites

- **Docker Engine ≥ 24** with **Docker Compose v2** (`docker compose`, not `docker-compose`)
- No other local tools required — everything runs inside containers

### Private repositories (optional)

Set environment variables before running compose:

```bash
# GitHub — classic PAT with `repo` scope
GITHUB_TOKEN=ghp_xxx docker compose up

# GitLab — personal access token with `read_repository`
GITLAB_TOKEN=glpat-xxx docker compose up
```

The API automatically injects the token into the HTTPS clone URL. The token is never logged.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/deployments` | List all deployments |
| `POST` | `/api/deployments` | Create deployment (JSON or multipart) |
| `GET` | `/api/deployments/:id` | Get single deployment |
| `DELETE` | `/api/deployments/:id` | Stop deployment |
| `GET` | `/api/deployments/:id/logs` | Historical logs (JSON array) |
| `GET` | `/api/deployments/:id/logs/stream` | **Live SSE log stream** |

### Create via JSON
```bash
curl -X POST http://localhost/api/deployments \
  -H "Content-Type: application/json" \
  -d '{"sourceType":"git","sourceUrl":"https://github.com/user/repo","name":"my-app"}'
```

### Create via file upload
```bash
curl -X POST http://localhost/api/deployments \
  -F "file=@./my-app.zip" \
  -F "name=my-app"
```

### Stream logs (SSE)
```bash
curl -N http://localhost/api/deployments/<id>/logs/stream
```

---

## Project Structure

```
.
├── docker-compose.yml
├── Caddyfile                 # base static routes; deployment routes injected at runtime
├── .env.example
├── apps/
│   ├── api/                  # Hono TypeScript API
│   │   └── src/
│   │       ├── index.ts      # entry point
│   │       ├── db/           # SQLite schema + query functions
│   │       ├── routes/       # deployments.ts (all routes incl. SSE)
│   │       └── services/     # pipeline, builder, runner, caddy, source, logStore
│   └── web/                  # Vite + TanStack frontend
│       └── src/
│           ├── api/          # typed fetch wrappers
│           ├── components/   # DeployForm, DeploymentCard, DeploymentList, LogViewer
│           ├── hooks/        # useLogStream (EventSource)
│           └── routes/       # index.tsx (the one page)
└── sample-app/               # zero-dependency Node.js hello-world for demo
```

---

## Rough Time Spent

| Phase | Hours |
|---|---|
| Architecture research (Railpack, Caddy Admin API, DinD networking) | ~2h |
| API + pipeline + services | ~4h |
| Frontend (components, TanStack wiring, SSE hook, CSS) | ~3h |
| Docker Compose + Caddy config iteration | ~1h |
| README + polish | ~1h |
| **Total** | **~11h** |

---

## What I'd Do With More Time

**High value:**
- **Graceful zero-downtime redeploys** — keep the old container running until the new one passes a health check, then swap the Caddy route atomically
- **Rollback** — store all image tags per deployment in SQLite; expose a `POST /api/deployments/:id/rollback?imageTag=xxx` endpoint
- **Build cache** — use Railpack's BuildKit frontend with a cache volume mounted into DinD (`--cache-from`, `--cache-to`) for dramatically faster rebuilds

**Nice to have:**
- Replace the port counter with a DB-backed port registry (safe for concurrent deploys)
- Proper health check per deployed container before marking `running` (`GET /` with timeout)
- Clean up old Docker images on a schedule (DinD storage is unbounded right now)
- Replace SQLite with Postgres for true concurrent write safety under load
- Structured JSON logging (Winston/Pino) instead of `console.log`

**What I'd rip out:**
- The `syncPortCounter` hack in `pipeline.ts` — it patches `process.env` to avoid circular imports. A proper `portRegistry.ts` module would be much cleaner
- The in-memory Caddy config store — it's lost on API restart. It recovers via SQLite on boot, but a persistent config (Redis or serialized to disk) would be safer

---

## Brimble Deploy Experience

> *(To be filled in after deploying to Brimble)*

Link: [your deployment URL here]

Write-up: [your honest feedback here]
