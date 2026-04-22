# ──────────────────────────────────────────────
# Brimble Web — Dockerfile
#
# Stage 1: Build the Vite SPA
# Stage 2: Serve static files with Caddy
# ──────────────────────────────────────────────

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
# Copy built SPA assets
COPY --from=builder /app/dist /srv
# Minimal Caddyfile: serve static files, fallback to index.html for client-side routing
COPY Caddyfile.serve /etc/caddy/Caddyfile
EXPOSE 5173
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
