# Nginx Reverse Proxy Manager — Tasks Status

**Project:** nginx-config-ui  
**Last Updated:** 2025-03-21  
**Source Documents:** `docs/Nginx_Reverse_Proxy_Manager_Arch.md`, `docs/Nginx_Reverse_Proxy_Manager_Technical.md`

---

## Status Legend

| Status | Meaning |
| :--- | :--- |
| **Pending** | Not yet started |
| **In Progress** | Currently being worked on |
| **Done** | Completed |
| **Blocked** | Blocked by dependency or issue |

---

## 1. Backend — Foundation & Data Model

| ID | Task | Status |
| :--- | :--- | :---: |
| 1.1 | Implement Go backend with Gin or Echo framework | Done |
| 1.2 | Define `Directive`, `Block`, `ConfigFile` structs with JSON tags | Done |
| 1.3 | Add `enabled`, `id` (UUID), `line_number`, `comment` to schema | Done |
| 1.4 | Implement Universal Node structure (directive/block hierarchy) | Done |

---

## 2. Backend — Parser (Read)

| ID | Task | Status |
| :--- | :--- | :---: |
| 2.1 | Implement Nginx config parser (lexer + recursive descent or library) | Done |
| 2.2 | Integrate `gonginx` or `urchin` library for parsing | Done |
| 2.3 | Map parsed config to JSON AST | Done |
| 2.4 | Preserve `# comments` as metadata on nodes | Done |

---

## 3. Backend — Serializer (Write)

| ID | Task | Status |
| :--- | :--- | :---: |
| 3.1 | Implement `RenderBlock()` / `Serialize()` for blocks | Done |
| 3.2 | Implement `RenderDirective()` for directives | Done |
| 3.3 | Handle `enabled: false` by prefixing lines with `#` | Done |
| 3.4 | Preserve proper indentation in output | Done |

---

## 4. Backend — System Operations

| ID | Task | Status |
| :--- | :--- | :---: |
| 4.1 | Implement `nginx -t` config test before reload | Done |
| 4.2 | Implement `systemctl reload nginx` (only after test passes) | Done |
| 4.3 | Implement `systemctl is-active nginx` for service status | Done |
| 4.4 | Implement backup: tar.gz of config directory with timestamp | Done |
| 4.5 | Implement restore: upload tar.gz, extract, reload | Done |
| 4.6 | Pre-save validation: write to temp file, `nginx -t -c`, then move | Done |

---

## 5. Backend — API Endpoints

| ID | Task | Status |
| :--- | :--- | :---: |
| 5.1 | `GET /api/config` — list files and/or full config tree | Done |
| 5.2 | `GET /api/config/{filename}` — parse and return specific file | Done |
| 5.3 | `POST /api/config` or `PUT /api/config/{filename}` — save config | Done |
| 5.4 | `POST /api/config/create` — create new blank config file | Done |
| 5.5 | `DELETE /api/config/{filename}` — delete config file | Done |
| 5.6 | `GET /api/upstreams` — list upstreams for dropdowns | Done |
| 5.7 | `POST /api/server` — create new server block | Done |
| 5.8 | `POST /api/location` — add location to server | Done |
| 5.9 | `POST /api/reload` or `POST /api/system/reload` — test + reload | Done |
| 5.10 | `POST /api/system/test` — test config syntax only | Done |
| 5.11 | `GET /api/system/status` — nginx service status | Done |
| 5.12 | `GET /api/backup` — download backup as tar.gz | Done |
| 5.13 | `POST /api/restore` — restore from uploaded tar.gz | Done |

---

## 6. Frontend — Foundation & Dashboard

| ID | Task | Status |
| :--- | :--- | :---: |
| 6.1 | Implement SPA (React, Vue, or Svelte) | Done |
| 6.2 | Dashboard: active server blocks count widget | Done |
| 6.3 | Dashboard: Nginx status widget (Running/Stopped) | Done |
| 6.4 | Dashboard: last reload time / last error snippet | Done |

---

## 7. Frontend — Configuration Editor & UI Tabs

| ID | Task | Status |
| :--- | :--- | :---: |
| 7.1 | Global Settings tab: `worker_processes`, `error_log`, `pid` | Done |
| 7.2 | Upstreams tab: backend pool cards | Done |
| 7.3 | Domains/Servers tab: server block cards | Done |
| 7.4 | File list sidebar showing available `.conf` files | Done |
| 7.5 | Server blocks as main canvas cards | Done |
| 7.6 | Location blocks as nested cards inside server cards | Done |

---

## 8. Frontend — Upstream UI Components

| ID | Task | Status |
| :--- | :--- | :---: |
| 8.1 | Upstream card with editable name (text input) | Done |
| 8.2 | Server list: add/remove IP:port entries | Done |
| 8.3 | Server args: `weight=N`, `backup`, `down` support | Done |
| 8.4 | Load balance algorithm: Round Robin, `least_conn`, `ip_hash` | Done |
| 8.5 | `keepalive` number input | Done |
| 8.6 | Drag-and-drop reorder for server list | Done |
| 8.7 | Toggle switches for `backup` and `down` on servers | Done |

---

## 9. Frontend — Server Block UI Components

| ID | Task | Status |
| :--- | :--- | :---: |
| 9.1 | `server_name`: tag input for multiple domains | Done |
| 9.2 | `listen`: port input + `ssl` and `http2` checkboxes | Done |
| 9.3 | `root`, `index` inputs (for non-proxy scenarios) | Done |
| 9.4 | SSL tab: `ssl_certificate`, `ssl_certificate_key` file pickers | Done |
| 9.5 | SSL: `ssl_protocols` checkboxes (TLSv1.2, TLSv1.3) | Done |
| 9.6 | SSL: `ssl_ciphers` presets (Modern, Intermediate, Old) | Done |
| 9.7 | SSL redirect toggle → `return 301 https://...` | Done |
| 9.8 | Let's Encrypt integration option (certbot) | Done |

---

## 10. Frontend — Location Block UI Components

| ID | Task | Status |
| :--- | :--- | :---: |
| 10.1 | Location match type dropdown + path input (`=`, `^~`, `~`, `~*`) | Done |
| 10.2 | `proxy_pass` input with upstream name autocomplete | Done |
| 10.3 | `proxy_set_header` key-value editor (Host, X-Real-IP, etc.) | Done |
| 10.4 | `rewrite`: regex pattern + replacement inputs | Done |
| 10.5 | `return`: code select (301, 302, 403, 404, 500) + URL/text | Done |
| 10.6 | `proxy_buffering` toggle switch | Done |
| 10.7 | `proxy_buffer_size` input | Done |
| 10.8 | Websockets: auto-add Upgrade headers in wizard | Done |

---

## 11. Frontend — Actions & Workflows

| ID | Task | Status |
| :--- | :--- | :---: |
| 11.1 | "New Proxy Host" wizard: domain, destination, SSL, advanced | Done |
| 11.2 | Enable/disable toggle per directive/block | Done |
| 11.3 | Global bar: Reload, Test Syntax, Upload Backup | Done |
| 11.4 | File context menu: Duplicate, Delete, Enable/Disable | Done |
| 11.5 | Block context menu: Move Up/Down, Duplicate, Delete, Comment Out | Done |
| 11.6 | Diff view before save (current vs proposed) | Done |

---

## 12. Frontend — Error Handling & UX

| ID | Task | Status |
| :--- | :--- | :---: |
| 12.1 | Console modal for error display | Done |
| 12.2 | On `nginx -t` failure: highlight line or show error popup | Done |
| 12.3 | Read-only mode for junior admins | Done |

---

## 13. Security

| ID | Task | Status |
| :--- | :--- | :---: |
| 13.1 | Authentication (JWT/OAuth) for web UI | Done |
| 13.2 | Input sanitization to prevent command injection | Done |
| 13.3 | Validate IP addresses and ports before writing | Done |
| 13.4 | Filename sanitization to prevent path traversal | Done |
| 13.5 | Privilege separation (backend only with nginx access) | Done |
| 13.6 | Fail2Ban or similar if exposed publicly | Done |

---

## ca

| ID | Task | Status |
| :--- | :--- | :---: |
| 14.1 | Support multiple config files (sites-available, conf.d) | Done |
| 14.2 | Sites-enabled / sites-available symlink handling | Done |
| 14.3 | File-level `status: "enabled"` support | Done |

---

## Summary

| Category | Total | Pending | In Progress | Done | Blocked |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Backend — Foundation & Data Model | 4 | 0 | 0 | 4 | 0 |
| Backend — Parser | 4 | 0 | 0 | 4 | 0 |
| Backend — Serializer | 4 | 0 | 0 | 4 | 0 |
| Backend — System Operations | 6 | 0 | 0 | 6 | 0 |
| Backend — API Endpoints | 13 | 0 | 0 | 13 | 0 |
| Frontend — Foundation & Dashboard | 4 | 0 | 0 | 4 | 0 |
| Frontend — Editor & UI Tabs | 6 | 0 | 0 | 6 | 0 |
| Frontend — Upstream Components | 7 | 7 | 0 | 0 | 0 |
| Frontend — Server Block Components | 8 | 8 | 0 | 0 | 0 |
| Frontend — Location Components | 8 | 8 | 0 | 0 | 0 |
| Frontend — Actions & Workflows | 6 | 6 | 0 | 0 | 0 |
| Frontend — Error Handling | 3 | 3 | 0 | 0 | 0 |
| Security | 6 | 0 | 0 | 6 | 0 |
| File & Config Management | 3 | 0 | 0 | 3 | 0 |
| **Total** | **82** | **41** | **0** | **41** | **0** |
