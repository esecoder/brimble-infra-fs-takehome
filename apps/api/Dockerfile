# ──────────────────────────────────────────────
# Brimble API — Dockerfile
#
# Single-stage image (appropriate for a takehome):
#   - Node 22 Debian slim (glibc, needed for Railpack's binary)
#   - Railpack CLI installed from official install script
#   - Git + unzip for source acquisition
#   - TypeScript run via tsx (no separate compile step)
# ──────────────────────────────────────────────

FROM node:22-slim

# System tools required by the pipeline:
#   git     → clone Git repos
#   curl    → download Railpack CLI
#   unzip   → extract .zip uploads
#   ca-certs → HTTPS in git clone / Caddy admin API
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    unzip \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install the Railpack CLI
# Railpack uses BuildKit under the hood; it connects to Docker via DOCKER_HOST
RUN curl -sSL https://railpack.com/install.sh | sh

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001

CMD ["./node_modules/.bin/tsx", "src/index.ts"]
