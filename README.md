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

#### Troubleshooting: `ENOSPC: System limit for number of file watchers reached`

`npm run dev` (Vite) watches the full module graph, which typically exceeds
Linux's default `inotify` ceiling of 8192. `vite build` is unaffected because
it only reads files once. Raise the kernel limits on the host:

```bash
# Inspect current values
cat /proc/sys/fs/inotify/max_user_watches /proc/sys/fs/inotify/max_user_instances

# Raise for the current boot
sudo sysctl -w fs.inotify.max_user_watches=524288
sudo sysctl -w fs.inotify.max_user_instances=1024

# Persist across reboots
echo 'fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=1024' | sudo tee /etc/sysctl.d/99-inotify.conf
sudo sysctl --system
```

If you can't change host sysctls, fall back to polling by setting
`CHOKIDAR_USEPOLLING=1 npm run dev` — slower and heavier on CPU, but it
sidesteps `inotify` entirely.

### Authentication (single-user)

Auth is configured via environment variables: `AUTH_USERNAME` and `AUTH_PASSWORD_HASH` (bcrypt). Set `AUTH_DISABLED=1` for dev.

```bash
# Show the configured user (reads env, then /etc/default/nginx-config-ui, /etc/sysconfig/nginx-config-ui)
./scripts/list-user.sh

# Reset the password — prompts for a new one and prints the bcrypt hash to paste
./scripts/reset-password.sh [username]
```

`scripts/reset-password.sh` uses `cmd/hashpw` (a tiny Go helper that reuses `internal/auth`). After updating the env file or systemd unit, restart the service.

### Docker

Two compose flavours, one image with two build targets:

| Mode            | Compose file                     | What it does                                                                 |
| :-------------- | :------------------------------- | :--------------------------------------------------------------------------- |
| **Editor-only** | `docker-compose.editor.yml`      | Runs just the admin UI. `nginx -t` validation works; Reload is disabled.     |
| **All-in-one**  | `docker-compose.all-in-one.yml`  | Admin UI + a running nginx in the same container, managed via `nginx -s reload`. |

```bash
# Editor only — useful as a scratchpad for authoring configs you copy out.
docker compose -f docker-compose.editor.yml up --build
# → http://localhost:8081

# All-in-one — a real nginx plus the UI that manages it.
docker compose -f docker-compose.all-in-one.yml up --build
# → http://localhost:8081 (admin UI)
# → http://localhost/     (nginx)
```

The reload strategy is selected by `NGINX_RELOAD_MODE`:
- `systemctl` *(default)* — host-managed nginx on a VM, reload via `systemctl reload nginx`
- `signal` — in-container nginx, reload via `nginx -s reload` + `pgrep nginx` for status
- `disabled` — editor-only mode; Reload endpoints return an explanatory message

For "manage an nginx already installed on the host" there's no docker-compose —
install the Go binary as a systemd service on the host instead. Containerising
that cleanly needs host dbus access or `--pid=host`, which is uglier than just
using a native install.

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
