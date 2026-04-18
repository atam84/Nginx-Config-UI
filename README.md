# Nginx Configuration Manager

A web-based management tool to visually configure, backup, and control Nginx reverse proxy services.

## Tech Stack

- **Backend:** Go (Gin)
- **Frontend:** React + Vite + TypeScript

## Quick Start

### Backend (Go)

```bash
# Build
go build -o nginx-config-ui ./cmd/server

# Run (default port: 8081)
./nginx-config-ui

# Run on custom port
PORT=3000 ./nginx-config-ui
```

### Frontend (React)

```bash
# Development (with hot reload, proxies API to backend)
cd frontend && npm install && npm run dev

# Production build (served by backend when frontend/dist exists)
cd frontend && npm run build

# Override nginx paths (for non-default installs)
NGINX_CONFIG_ROOT=/etc/nginx NGINX_BIN=nginx NGINX_SERVICE=nginx ./nginx-config-ui

# Backup directory (default: /var/backups/nginx, or $TMPDIR/nginx-backups)
NGINX_BACKUP_DIR=/backups ./nginx-config-ui
```

### Authentication (single-user)

Auth is configured via environment variables: `AUTH_USERNAME` and `AUTH_PASSWORD_HASH` (bcrypt). Set `AUTH_DISABLED=1` for dev.

```bash
# Show the configured user (reads env, then /etc/default/nginx-config-ui, /etc/sysconfig/nginx-config-ui)
./scripts/list-user.sh

# Reset the password — prompts for a new one and prints the bcrypt hash to paste
./scripts/reset-password.sh [username]
```

`scripts/reset-password.sh` uses `cmd/hashpw` (a tiny Go helper that reuses `internal/auth`). After updating the env file or systemd unit, restart the service.

### API Documentation

- **OpenAPI 3.0:** `/openapi.json`
- **Swagger UI:** `/docs`

### API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| GET | `/health` | Health check |
| GET | `/api/config` | List config files |
| GET | `/api/config/*path` | Get parsed config file |
| PUT | `/api/config/*path` | Save config file |
| DELETE | `/api/config/*path` | Delete config file |
| POST | `/api/config/parse` | Parse Nginx text to JSON AST |
| POST | `/api/config/serialize` | Serialize JSON AST to Nginx text |
| POST | `/api/config/validate` | Validate config (`nginx -t -c`) |
| POST | `/api/config/create` | Create new config file |
| GET | `/api/upstreams` | List upstream blocks |
| POST | `/api/server` | Add server block |
| POST | `/api/location` | Add location block |
| POST | `/api/system/test` | Test config (`nginx -t`) |
| POST | `/api/system/reload` | Test + reload Nginx |
| GET | `/api/system/status` | Nginx service status |
| GET | `/api/backup` | Download config tar.gz |
| POST | `/api/restore` | Restore from tar.gz |

## Project Structure

```
nginx-config-ui/
├── cmd/server/        # Application entry point
├── internal/          # API, model, parser, serializer, system
├── frontend/          # React SPA (Vite)
│   └── src/
│       ├── Dashboard.tsx      # Dashboard with stats, status, reload
│       ├── ConfigEditor.tsx   # Config editor with tabs
│       ├── GlobalSettingsTab  # worker_processes, error_log, pid
│       ├── UpstreamsTab       # Upstream pool cards
│       ├── DomainsServersTab  # Server + location cards
│       └── api.ts             # API client
├── docs/              # Architecture & technical specs
└── tasks-status.md    # Task tracker
```
