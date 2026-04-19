# syntax=docker/dockerfile:1.7
#
# Multi-stage build with two runtime targets:
#   --target editor       → admin app only, nginx binary bundled for -t validation,
#                           reload endpoints disabled (NGINX_RELOAD_MODE=disabled).
#   --target all-in-one   → admin app + running nginx in the same container, managed
#                           via SIGHUP / nginx -s reload (NGINX_RELOAD_MODE=signal).
#
# Both runtime stages share the same nginx:alpine base so `nginx -t` works in
# either mode — the Test Syntax button is useful even in editor-only mode.

# ── Stage 1: Frontend build ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Backend build ────────────────────────────────────────────────────
FROM golang:1.25-alpine AS backend
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath -ldflags="-s -w" \
    -o /out/nginx-config-ui ./cmd/server

# ── Stage 3: Shared runtime base ──────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime-base
RUN apk add --no-cache ca-certificates tini
WORKDIR /app
COPY --from=backend  /out/nginx-config-ui        /app/nginx-config-ui
COPY --from=frontend /app/frontend/dist          /app/frontend/dist
ENV PORT=8081 \
    NGINX_CONFIG_ROOT=/etc/nginx

# ── Stage 4: Editor-only runtime ──────────────────────────────────────────────
# Starts just the admin app. nginx binary is present (for nginx -t validation)
# but no nginx process runs. Reload endpoints short-circuit with a clear
# message. Defaults to AUTH_DISABLED=1 so the user can kick the tyres without
# wrangling bcrypt hashes — override in production.
FROM runtime-base AS editor
ENV NGINX_RELOAD_MODE=disabled \
    AUTH_DISABLED=1
EXPOSE 8081
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/nginx-config-ui"]

# ── Stage 5: All-in-one runtime ───────────────────────────────────────────────
# Boots nginx (daemonized) and runs the admin app in the foreground. The admin
# manages its sibling nginx via signals (nginx -s reload, pgrep nginx).
FROM runtime-base AS all-in-one
COPY docker/entrypoint-all-in-one.sh /usr/local/bin/entrypoint-all-in-one.sh
RUN chmod +x /usr/local/bin/entrypoint-all-in-one.sh
ENV NGINX_RELOAD_MODE=signal
EXPOSE 80 443 8081
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint-all-in-one.sh"]
