# Nginx Reverse Proxy Manager — Tasks Status

**Project:** nginx-config-ui  
**Last Updated:** 2026-04-18 (Phase 8 §51 advanced compression complete — Brotli subsection (on/comp_level 0–11/types/static tri-state) with ngx_brotli module warning, gzip_static tri-state + gunzip toggle for pre-compressed assets and upstream decompression, and an **Apply web-optimized compression** preset that enables gzip + Brotli side-by-side with a curated MIME list excluding pre-compressed formats; backend round-trip test covers all seven directives.)
**Source Documents:** `docs/Nginx_Reverse_Proxy_Manager_Arch.md`, `docs/Nginx_Reverse_Proxy_Manager_Technical.md`, `docs/gaps.md`, `docs/features.md`, `docs/nginx-topology.jsx`

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

## 14. File & Config Management

| ID | Task | Status |
| :--- | :--- | :---: |
| 14.1 | Support multiple config files (sites-available, conf.d) | Done |
| 14.2 | Sites-enabled / sites-available symlink handling | Done |
| 14.3 | File-level `status: "enabled"` support | Done |

---

## Phase 1 — Close Critical Gaps (Parity with Own Samples)

## 15. HTTP Block Settings Panel (F1.1)

**Gap Ref:** 1.1, 1.2, 1.4 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 15.1 | Add "HTTP Settings" tab/sub-panel to the config editor | Done |
| 15.2 | Performance section: `sendfile`, `tcp_nopush`, `tcp_nodelay`, `types_hash_max_size`, `server_tokens`, `keepalive_timeout`, `keepalive_requests`, `client_max_body_size`, `default_type` | Done |
| 15.3 | SSL Defaults section: `ssl_protocols` checkboxes, `ssl_prefer_server_ciphers`, `ssl_session_cache`, `ssl_session_timeout` | Done |
| 15.4 | Logging section: `access_log` path + format dropdown, `log_format` name + format textarea list | Done |
| 15.5 | Real IP section: `real_ip_header` dropdown, `real_ip_recursive` toggle, `set_real_ip_from` tag-input | Done |
| 15.6 | Includes section: `include` path list with glob preview | Done |
| 15.7 | Compression (Gzip) section: `gzip` toggle, `gzip_comp_level` slider, `gzip_min_length`, `gzip_types` tag-input, `gzip_proxied` multi-select, `gzip_vary` toggle, `gzip_buffers` | Done |
| 15.8 | Backend API: support reading/writing http-block directives | Done |
| 15.9 | Round-trip validation: UI → AST → serializer → nginx text → parser → UI | Done |

---

## 16. Server-Level Log and Body Size Fields (F1.2)

**Gap Ref:** 2.1, 2.2 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 16.1 | Add `access_log` field (path + optional format name) to server card | Done |
| 16.2 | Add `error_log` field (path + level dropdown) to server card | Done |
| 16.3 | Add `client_max_body_size` field (size input with unit selector or `0`) to server card | Done |
| 16.4 | Display existing values from parsed server blocks | Done |

---

## 17. Server-Level Proxy Defaults (F1.3)

**Gap Ref:** 2.5 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 17.1 | Add collapsible "Advanced Proxy Defaults" section to server card | Done |
| 17.2 | Fields: `proxy_connect_timeout`, `proxy_read_timeout`, `proxy_send_timeout` | Done |
| 17.3 | Fields: `proxy_http_version` dropdown (1.0/1.1), `proxy_request_buffering` toggle, `ignore_invalid_headers` toggle | Done |
| 17.4 | Server-level `proxy_set_header` key-value editor | Done |
| 17.5 | Distinguish server-level vs. location-level proxy directives in parser | Done |

---

## 18. Location Proxy Timeout Controls (F1.4)

**Gap Ref:** 3.1, 3.2, 3.3, 3.4 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 18.1 | Add `proxy_connect_timeout`, `proxy_read_timeout`, `proxy_send_timeout` to location card | Done |
| 18.2 | Add `proxy_http_version` dropdown (1.0/1.1) to location card | Done |
| 18.3 | Add `proxy_cookie_path` text input to location card | Done |
| 18.4 | Add `expires` text input to location card | Done |
| 18.5 | Add `access_log` (path or `off`) and `log_not_found` toggle to location card | Done |

---

## 19. Response Headers — `add_header` Support (F1.5)

**Gap Ref:** 2.3 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 19.1 | Add `add_header` key-value editor to server cards (separate from `proxy_set_header`) | Done |
| 19.2 | Add `add_header` key-value editor to location cards | Done |
| 19.3 | Add `always` checkbox per `add_header` row | Done |
| 19.4 | Preset buttons: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy | Done |

---

## 20. Security Headers Quick-Apply (F1.6)

**Gap Ref:** 9.1 · **Scope:** Frontend · **Dependencies:** 19 (F1.5)

| ID | Task | Status |
| :--- | :--- | :---: |
| 20.1 | Add "Apply Security Headers" button to server card | Done |
| 20.2 | One-click insert: HSTS, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, CSP template | Done |
| 20.3 | Skip headers already present (no duplicates) | Done |

---

## Phase 2 — Complete Nginx Feature Coverage

## 21. Rate Limiting UI (F2.1)

**Gap Ref:** 1.3 · **Scope:** Both · **Dependencies:** 15 (F1.1)

| ID | Task | Status |
| :--- | :--- | :---: |
| 21.1 | HTTP-level: "Rate Limiting" section with `limit_req_zone` definitions (key, zone name, size, rate) | Done |
| 21.2 | Server/Location-level: `limit_req` field (zone dropdown, `burst`, `nodelay` toggle) | Done |
| 21.3 | `limit_req_status` number input (default 503) | Done |
| 21.4 | `limit_conn_zone` and `limit_conn` support | Done |
| 21.5 | Backend API: support rate limit directive serialization | Done |

---

## 22. Proxy Cache Configuration (F2.2)

**Gap Ref:** 8.1 · **Scope:** Both · **Dependencies:** 15 (F1.1)

| ID | Task | Status |
| :--- | :--- | :---: |
| 22.1 | HTTP-level: "Cache Zones" section with `proxy_cache_path` definitions (path, zone, keys_zone, levels, max_size, inactive) | Done |
| 22.2 | Location-level: `proxy_cache` dropdown (zone names + off) | Done |
| 22.3 | Location-level: `proxy_cache_valid` list (status code + duration rows) | Done |
| 22.4 | Location-level: `proxy_cache_key`, `proxy_cache_bypass`, `proxy_no_cache` text inputs | Done |
| 22.5 | Location-level: `proxy_cache_use_stale` multi-select (error, timeout, updating, http_500, etc.) | Done |

---

## 23. Stream / TCP-UDP Proxy Module (F2.3)

**Gap Ref:** 5.1, 11.1 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 23.1 | Backend: `POST /api/stream/server` — create stream server block inside `stream {}` | Done |
| 23.2 | Backend: `POST /api/stream/upstream` — create stream upstream block | Done |
| 23.3 | Backend: `GET /api/stream/servers` — list stream servers | Done |
| 23.4 | Backend: Generalize `AddServerToConfig` to accept target context (http, stream) | Done |
| 23.5 | Frontend: Add "Stream / TCP-UDP" tab in config editor | Done |
| 23.6 | Frontend: Stream server card — `listen` (port + `udp`/`ssl` toggles), `proxy_pass`, `proxy_timeout`, `proxy_connect_timeout`, `proxy_buffer_size`, `ssl_preread` toggle | Done |
| 23.7 | Frontend: Stream upstream card (reuse upstream component with stream context flag) | Done |
| 23.8 | Frontend: Stream log format editor and `access_log`/`error_log` fields | Done |

---

## 24. `map` Block Editor (F2.4)

**Gap Ref:** 6.1 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 24.1 | Add "Maps" section/tab for http and stream contexts | Done |
| 24.2 | Map editor: source variable, result variable, `hostnames` toggle, `volatile` toggle | Done |
| 24.3 | Table of entries: pattern + value columns, support `default`, exact, prefix, regex | Done |
| 24.4 | Backend API: serialize/deserialize `map` blocks | Done |

---

## 25. Nested Location Blocks (F2.5)

**Gap Ref:** 3.5 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 25.1 | Frontend: Recursive location card rendering (nested inside parent location) | Done |
| 25.2 | Frontend: "+ Add nested location" button inside expanded location card | Done |
| 25.3 | Frontend: Indented rendering with visual connector lines (max depth: 3) | Done |
| 25.4 | Backend: `AddLocationToLocation` API targeting parent location by ID | Done |

---

## 26. `if` Block Support (F2.6)

**Gap Ref:** 3.6 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 26.1 | "If Conditions" sub-section with "+ Add condition" button in server/location cards | Done |
| 26.2 | Condition builder: variable dropdown + operator (`~`, `~*`, `=`, `!=`, `-f`, `-d`, `!-f`, `!-d`) + value input | Done |
| 26.3 | Nested directive editor inside if block (rewrite, return, proxy_pass, set, add_header) | Done |
| 26.4 | Warning banner about "if is evil" gotchas in location context | Done |

---

## 27. Events Block Settings (F2.7)

**Gap Ref:** 7.1 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 27.1 | Add "Events" section to Global Settings tab | Done |
| 27.2 | Fields: `worker_connections` number, `multi_accept` toggle, `use` dropdown (epoll/kqueue/select/poll/auto) | Done |
| 27.3 | Fields: `accept_mutex` toggle, `accept_mutex_delay` duration input | Done |
| 27.4 | Auto-create events block if none exists when settings are changed | Done |

---

## 28. Access Control — `allow` / `deny` (F2.8)

**Gap Ref:** 9.2 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 28.1 | "Access Control" section in server and location cards | Done |
| 28.2 | Ordered rule list: action dropdown (`allow`/`deny`) + value input (IP, CIDR, `all`) | Done |
| 28.3 | Drag-and-drop reorder (order matters — first match wins) | Done |
| 28.4 | Presets: "+ Allow all", "+ Deny all", "+ Allow private networks" | Done |

---

## 29. SSL Enhancements (F2.9)

**Gap Ref:** 9.3 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 29.1 | Add `ssl_stapling` and `ssl_stapling_verify` toggles to server SSL section | Done |
| 29.2 | Add `ssl_trusted_certificate` and `ssl_dhparam` path inputs | Done |
| 29.3 | Add `ssl_session_cache`, `ssl_session_timeout`, `ssl_session_tickets` fields | Done |

---

## 30. Resolver Settings (F2.10)

**Gap Ref:** 2.4 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 30.1 | Add `resolver` tag-input for IPs + `valid=` duration + `ipv6=off` toggle to server cards | Done |
| 30.2 | Add `resolver_timeout` duration input | Done |

---

## Phase 3 — Visual Topology & Advanced UX

## 31. Configuration Topology View (F3.1)

**Gap Ref:** 10.1 · **Scope:** Frontend · **Dependencies:** 15 (F1.1), 23 (F2.3)
**Reference:** `docs/nginx-topology.jsx` (prototype implementation)

| ID | Task | Status |
| :--- | :--- | :---: |
| 31.1 | Integrate topology view as full-screen "Topology" tab | Done |
| 31.2 | Node types: Listener (blue), Server Block (green), Location (yellow), Upstream (orange), Backend Server (purple), Static Root (teal) | Done |
| 31.3 | Edge rendering: Listener→Server→Location→Upstream→Backend with labeled connections | Done |
| 31.4 | Click-to-navigate: clicking a node jumps to its card in the structured editor | Done |
| 31.5 | Hover-to-highlight: trace full traffic path from listener to backend | Done |
| 31.6 | Protocol color-coding: green=HTTPS, gray=HTTP, blue=stream/TCP | Done |
| 31.7 | Filter by config file to isolate per-file topology | Done |
| 31.8 | Matrix view: tabular server overview (listen, locations, upstreams, backends, SSL) | Done |
| 31.9 | Stats view: upstream pool breakdown, listener distribution, gap coverage | Done |
| 31.10 | Connect to live config data (replace SAMPLE_CONFIG with parsed config state) | Done |
| 31.11 | Auto-layout with manual drag override, SVG/PNG export | Done |

---

## 32. Raw Text Editor with Syntax Highlighting (F3.2)

**Gap Ref:** 10.4 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 32.1 | Embed CodeMirror 6 or Monaco Editor with Nginx syntax highlighting | Done |
| 32.2 | Add "Raw Editor" toggle/tab alongside structured editor tabs | Done |
| 32.3 | Bidirectional sync: raw text ↔ structured AST | Done |
| 32.4 | Warning banner when raw edits would override unsaved structured changes | Done |
| 32.5 | Inline syntax error highlighting and `nginx -t` trigger from raw editor | Done |

---

## 33. Include Directive Navigation (F3.3)

**Gap Ref:** 10.3 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 33.1 | Backend: `GET /api/config/resolve-include?glob=...` returning matched file list | Done |
| 33.2 | Frontend: Render `include` directives as clickable chips/links | Done |
| 33.3 | Frontend: Popover listing matched files, click to navigate to editor tab | Done |
| 33.4 | Frontend: "Included Files" tree view in sidebar grouped by include directive | Done |

---

## 34. Config Change History (F3.4)

**Gap Ref:** 10.2 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 34.1 | Backend: Store previous content as versioned snapshot before each save | Done |
| 34.2 | Backend: `GET /api/config/history/*path` — list versions with timestamps | Done |
| 34.3 | Backend: `GET /api/config/history/*path/{timestamp}` — content of a version | Done |
| 34.4 | Frontend: "History" button per config file with timeline of saves | Done |
| 34.5 | Frontend: Unified diff view between any two versions | Done |
| 34.6 | Frontend: "Restore this version" button (creates new history entry) | Done |

---

## 35. Undo / Redo (F3.5)

**Gap Ref:** 11.3 · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 35.1 | Implement in-memory undo/redo stack (ConfigFile snapshots, max 50 entries) | Done |
| 35.2 | Push snapshot on every user-initiated change | Done |
| 35.3 | Wire Ctrl+Z (undo) and Ctrl+Shift+Z (redo) keyboard shortcuts | Done |
| 35.4 | Undo/redo buttons in the toolbar | Done |

---

## 36. Global Search (F3.6)

**Gap Ref:** 10.5 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 36.1 | Backend: `GET /api/config/search?q=...` searching directive names, args, comments across all files | Done |
| 36.2 | Frontend: Search bar in main toolbar with instant-search | Done |
| 36.3 | Frontend: Results grouped by file with directive name, args, line number | Done |
| 36.4 | Frontend: Click result to open file and scroll to/highlight matching node | Done |

---

## Phase 4 — Production Hardening

## 37. Let's Encrypt / ACME Integration (F4.1)

**Gap Ref:** 2.6 · **Scope:** Backend · **Dependencies:** 16 (F1.2)

| ID | Task | Status |
| :--- | :--- | :---: |
| 37.1 | Backend: `POST /api/ssl/request` — run certbot for given domain list | Done |
| 37.2 | Backend: `GET /api/ssl/certificates` — list certificates with expiry dates | Done |
| 37.3 | Backend: `POST /api/ssl/renew` — force-renew a certificate | Done |
| 37.4 | Auto-populate `ssl_certificate` and `ssl_certificate_key` on server block after issuance | Done |
| 37.5 | Frontend: "Request Certificate" button in SSL section of server cards | Done |
| 37.6 | Frontend: Certificate status badge (valid/expiring soon/expired) and auto-renewal indicator | Done |

---

## 38. Multi-File Atomic Save (F4.2)

**Gap Ref:** 11.4 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 38.1 | Backend: `POST /api/config/save-all` accepting multiple file payloads | Done |
| 38.2 | Backend: Write to temp locations, run `nginx -t`, atomically move on success, rollback on failure | Done |
| 38.3 | Frontend: Track "dirty" state per file | Done |
| 38.4 | Frontend: "Save All" button in global toolbar (active when any file is dirty) | Done |
| 38.5 | Frontend: On failure, show which file/line caused the error | Done |

---

## 39. Serializer Formatting Preservation (F4.3)

**Gap Ref:** 11.2 · **Scope:** Backend

| ID | Task | Status |
| :--- | :--- | :---: |
| 39.1 | Add `BlankLinesBefore int` field to Node struct | Done |
| 39.2 | Parser: record blank lines between directives | Done |
| 39.3 | Serializer: emit blank lines based on metadata | Done |
| 39.4 | Optional "Format Config" button to normalize formatting | Done |

---

## Phase 5 — Optional / Niche Features

## 40. Optional Features (F5.x)

| ID | Task | Status |
| :--- | :--- | :---: |
| 40.1 | Mail Proxy Module: `mail {}` block support (IMAP, POP3, SMTP) (F5.1) | Done |
| 40.2 | Upstream: Add `random` algorithm to dropdown, Nginx Plus indicators for `least_time`, `queue`, `ntlm` (F5.2) | Done |
| 40.3 | GeoIP/Geo Module: UI for `geo {}` and `geoip2 {}` blocks (F5.3) | Done |
| 40.4 | Auth: `auth_basic` (realm + htpasswd path) and `auth_request` (sub-request URI) fields (F5.4) | Done |
| 40.5 | Custom Error Pages: `error_page` field — status codes + URI or `=code` redirect (F5.5) | Done |

---

## Phase 6 — UX & Top-Nav Polish

## 41. Top-Nav, Theming, Remote File Sources (F6.1)

**Scope:** Frontend · **Driver:** In-app ergonomics (theme, About, Help, open remote files).

| ID | Task | Status |
| :--- | :--- | :---: |
| 41.1 | Top-nav **About** button + modal (app description, stack, docs link) | Done |
| 41.2 | Top-nav **Help** button + modal with nginx version compatibility table (1.18 / 1.24 / 1.26 / 1.27 mainline; OpenResty/Tengine partial via Raw) | Done |
| 41.3 | Dark / Light **theme toggle** in top-nav, persisted in `localStorage`, honours `prefers-color-scheme` on first visit | Done |
| 41.4 | "Open File" sidebar panel sub-modes: **Path** (server-local absolute), **Upload** (browser file picker → `parseConfigFromText`), **URL** (http/https fetch → parse) | Done |
| 41.5 | Editor render gate: show structured tabs when an uploaded/URL config is loaded even without `selectedFile`/`openFilePath`; header label falls back to `Uploaded: <name>` / `URL: <url>` | Done |
| 41.6 | Migrate hard-coded hovers (`rgba(255,255,255,…)`) and semantic colors (`#e3a008`, `#ef4444`, `#2ea043`, `#f85149`) to `--bg-hover` / `--warning` / `--error` / `--success` / `--accent-soft` vars across `ConfigEditor.css`, `DomainsServersTab.css`, `LogFormatBuilder.css`, `BlockContextMenu.css`, `NewProxyWizard.css`, `ErrorModal.css`, `HttpSettingsTab.css` | Done |
| 41.7 | **Collapsible block cards everywhere**. Added `.block-collapse-toggle` + `.block-collapsed-summary` utility classes in `index.css` (always loaded). Wired a ▾/▸ toggle on: server cards (DomainsServersTab — collapsed summary shows `listen`, names count, locations count, SSL badge), upstream cards (UpstreamsTab — algorithm + server count + linked proxy hosts), stream upstream cards (server count), stream server cards (→ proxy target, UDP/SSL/ssl_preread flags), and mail server cards (ssl_protocols list). Default-expanded; state is per-card, not persisted. Nested-location cards deliberately skipped — they're already single-row editors with nothing to collapse. | Done |
| 41.8 | **Docker packaging** — multi-stage `Dockerfile` with two runtime targets both on `nginx:1.27-alpine` (so `nginx -t` works in either mode). `editor` target runs just the admin with `NGINX_RELOAD_MODE=disabled` + `AUTH_DISABLED=1`. `all-in-one` target runs nginx daemonized + admin in foreground, with `docker/entrypoint-all-in-one.sh` orchestrating startup (nginx -t preflight, trap-based graceful nginx -s quit on shutdown). Backend gains `NGINX_RELOAD_MODE=systemctl\|signal\|disabled` env var in `internal/system/nginx.go`; `Reload` and `Status` branch on it (`systemctl reload` / `systemctl is-active`, `nginx -s reload` / `pgrep -x nginx`, or short-circuit with "editor-only" message). Two compose files — `docker-compose.editor.yml` (port 8081) and `docker-compose.all-in-one.yml` (ports 80/443/8081 + named volumes for `/etc/nginx`, `/var/log/nginx`, `/usr/share/nginx/html`). `.dockerignore` excludes node_modules, dist, img, docs, git, local binaries. README gains a Docker section covering both modes and explaining why "manage host nginx" deliberately ships as a native systemd unit, not a compose file. | Done |

---

## Phase 7 — Application Backend Activation & Configuration

**Driver:** Today the UI can only configure HTTP reverse-proxy flows (`proxy_pass`). The sample repo already ships a `fastcgi.conf` that is **only editable via Raw**. Real deployments need first-class support for PHP-FPM, Python (uWSGI + ASGI), Node.js, gRPC, and static/SPA serving.

## 42. PHP / FastCGI Support (F7.1)

**Gap Ref:** (new) — closes the PHP configuration gap identified in the 2026-04-18 audit · **Scope:** Both · **Sample:** `config-samples/fastcgi.conf`

| ID | Task | Status |
| :--- | :--- | :---: |
| 42.1 | Parser/serializer round-trip test for `fastcgi_*` directives (unknown-directive preservation); covers `fastcgi_pass` (unix/tcp), `fastcgi_param` with `if_not_empty` trailing arg, `fastcgi_cache_valid` with multi-status, quoted `fastcgi_cache_key`, and regex `fastcgi_split_path_info` — `TestParseSerializeRoundtrip_FastCGI` in `internal/serializer/serializer_test.go` | Done |
| 42.2 | Location card **FastCGI** section (collapsible, auto-opens when `fastcgi_pass` or params already present): `fastcgi_pass` (unix socket / tcp), `fastcgi_index`, `fastcgi_split_path_info`, `include fastcgi_params` toggle, repeated `fastcgi_param` key-value editor (with optional `if_not_empty` third column), and a **+ PHP defaults** preset that seeds SCRIPT_FILENAME / PATH_INFO / HTTPS | Done |
| 42.3 | FastCGI timeouts inside the same section: `fastcgi_connect_timeout`, `fastcgi_read_timeout`, `fastcgi_send_timeout` (three-column row matching the proxy timeouts layout) | Done |
| 42.4 | FastCGI buffers row in Location FastCGI section: `fastcgi_buffer_size`, `fastcgi_buffers` (number × size pair widget), `fastcgi_busy_buffers_size`, `fastcgi_max_temp_file_size` | Done |
| 42.5 | FastCGI cache: HTTP-level `fastcgi_cache_path` zones section (mirrors Proxy Cache Zones, sectionId `fcgicachezones`) + per-location `fastcgi_cache` dropdown (union of proxy_cache_path + fastcgi_cache_path zones), `fastcgi_cache_valid` row list, `fastcgi_cache_key`, `fastcgi_cache_use_stale` checkbox grid | Done |
| 42.6 | NewProxyWizard gains **Template** step-1 selector (Reverse Proxy / PHP-FPM site). PHP path replaces Destination step with webroot + `fastcgi_pass` + index inputs and emits: `root`, `index`, `location / { try_files $uri $uri/ /index.php?$query_string; }`, `location ~ \.php$ { fastcgi_split_path_info, fastcgi_pass, fastcgi_index, include fastcgi_params, SCRIPT_FILENAME + PATH_INFO + HTTPS params, 300s read timeout, 16 × 16k buffers }`, and a `location ~ /\.` deny block. SSL step shared; WebSocket advanced step skipped in PHP mode. | Done |

---

## 43. Python uWSGI Support (F7.2)

**Gap Ref:** (new) · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 43.1 | Location card **uWSGI** section (collapsible, auto-opens when `uwsgi_pass` / params already present): `uwsgi_pass` with unix/tcp badge, `include uwsgi_params` toggle, repeated `uwsgi_param` editor with optional `if_not_empty` column, `uwsgi_read_timeout`, `uwsgi_buffers` (count × size pair widget). Preset **+ Behind nginx TLS** seeds `HTTPS $https if_not_empty` and `UWSGI_SCHEME $scheme`. Parser round-trip locked in via `TestParseSerializeRoundtrip_Uwsgi` in `internal/serializer/serializer_test.go`. | Done |
| 43.2 | NewProxyWizard gains a third Template option **Python / uWSGI**. Step 2 collects uwsgi backend (unix/tcp), `uwsgi_read_timeout`, and an optional `/static/` alias (URL prefix + `alias` root). Emits: `listen`, `server_name`, optional `location /static/ { alias; expires 30d; access_log off; }`, and a `location / { include uwsgi_params; uwsgi_pass; uwsgi_param HTTPS if_not_empty; uwsgi_read_timeout; uwsgi_buffers 16 16k; client_max_body_size 25m; }`. Template card grid switched to `auto-fit minmax(12rem, 1fr)` to accommodate three cards cleanly. | Done |

---

## 44. gRPC Support (F7.3)

**Gap Ref:** (new) · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 44.1 | Location card **gRPC** section (collapsible, auto-opens when `grpc_pass` / headers already present): `grpc_pass` with `grpc (h2c)` / `grpcs (TLS)` badge, `grpc_set_header` editor with `+ Identity headers` preset, `grpc_read_timeout` / `grpc_send_timeout` row, and a nested mTLS subsection with `grpc_ssl_server_name`, `grpc_ssl_verify` toggle, `grpc_ssl_trusted_certificate`, `grpc_ssl_certificate` + `grpc_ssl_certificate_key`. TLS fields auto-disable when `grpc_pass` is not `grpcs://`. Parser round-trip locked in via `TestParseSerializeRoundtrip_Grpc` in `internal/serializer/serializer_test.go`. | Done |
| 44.2 | HTTP/2 enforcement warning banner inside server card: when any nested location carries `grpc_pass` and the `listen` directive lacks `http2`, render a yellow banner under the listen row explaining gRPC is HTTP/2-only, plus a one-click **Enable HTTP/2** button that rewrites the listen args via `buildListen`. | Done |
| 44.3 | NewProxyWizard gains a fourth Template option **gRPC service**. Step 2 collects backend (`grpc://` / `grpcs://`), `grpc_read_timeout`, and conditional TLS fields (SNI, verify toggle) that show only when the backend uses `grpcs://`. Auto-forces `http2` on via `useEffect` when the template is selected, and the builder unconditionally emits `http2` on the listen line regardless of the wizard toggle. Emits: listen + server_name + a `location / { grpc_pass; grpc_set_header Host / X-Real-IP; grpc_read_timeout; grpc_send_timeout; client_max_body_size 0; optional grpc_ssl_* }`. | Done |

---

## 45. Static Site / SPA Support (F7.4)

**Gap Ref:** (new) — covers the highest-frequency missing pattern · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 45.1 | Location card: **Static files** row adds `root`, `alias`, `index` inputs inline (three-column layout). Inline warning banner when both `root` and `alias` are set (mutually exclusive per nginx; we surface it rather than auto-clear to avoid destroying user intent). | Done |
| 45.2 | Location card: `try_files` reorderable token editor with per-row **↑/↓** buttons, **× remove**, and presets — **SPA fallback** (`$uri $uri/ /index.html`), **PHP clean URLs** (`$uri $uri/ /index.php?$query_string`), **Static with 404** (`$uri =404`), **Named-location fallback** (`$uri @fallback`). Last token placeholder reads "fallback (/index.html, @name, =404)" so the semantics are obvious. | Done |
| 45.3 | Server card `error_page` editor enhanced with an InfoIcon explaining codes list + `=code` rewrite column + URI/@named-location target. Preset row adds **+ Standard 4xx/5xx bundle** (seeds 404 and 500/502/503/504, skipping rows already present), **+ 404 → =200 rewrite** (API endpoints that hide 404s), and **+ 5xx → @fallback** (route upstream errors to a named location). Codes + redirect + URI columns already existed — this task completes the discoverability and preset coverage. | Done |
| 45.4 | Three preset buttons next to the existing Location `expires` field — **Static asset cache (30d, immutable)**, **Long-term (1y)**, and **No cache** — each in one click sets `expires` and replaces the existing `Cache-Control` `add_header` (case-insensitive lookup) with the matching value (`public, max-age=…, immutable` or `no-store, no-cache, must-revalidate`). Idempotent on repeat clicks. | Done |
| 45.5 | Per-location `types {}` block editor as a collapsible subsection. Reads existing block child directives as `{mime, exts}` rows, writes back a single `types` block with one directive per row (name = MIME type, args = extensions). Auto-removes the block when all rows are cleared. **+ Modern web defaults** preset seeds `application/javascript js mjs` / `application/wasm wasm` / `application/manifest+json webmanifest` — the MIME types nginx's default map gets wrong or misses. Round-trip safe via the generic unknown-block preservation path. | Done |
| 45.6 | NewProxyWizard **"Static site"** template. Step 2: webroot, index filenames, SPA-fallback toggle (`try_files $uri $uri/ /<first-index>`), optional long-cache asset prefix. Emits `listen` + `server_name` + `root` + `index` + optional `location <prefix> { expires 1y; add_header Cache-Control immutable; access_log off; }` + main `location / { try_files … }` + hidden-files deny block (`location ~ /\.(?!well-known)`). | Done |
| 45.7 | NewProxyWizard **"SPA (SSR + static)"** template. Step 2: SSR backend, static URL prefix + alias root (e.g. `/_next/static/` → disk), optional `/public/`-style second prefix. Emits a `location <static_prefix> { alias; expires 1y; Cache-Control immutable; try_files $uri =404; }`, optional matching `/public/` block, and a main `location / { proxy_pass; proxy_http_version 1.1; Host/X-Real-IP/X-Forwarded-* headers; Upgrade/Connection WebSocket pair (for Next.js dev + HMR); proxy_read_timeout 60s; }`. | Done |

---

## 46. Node.js / ASGI Wizard Templates (F7.5)

**Gap Ref:** (new) · **Scope:** Frontend · **Dependencies:** 11.1 (wizard), 45

| ID | Task | Status |
| :--- | :--- | :---: |
| 46.1 | Wizard template: **"Node.js (Next.js/Nuxt/Remix)"** — adds a sixth template card. Step 2 collects the Node backend URL, `proxy_read_timeout` / `proxy_send_timeout` (HMR/SSE-safe default `3600s`), and an optional static-asset pass-through (URL prefix + disk alias). Emits: listen + server_name + optional `location /_next/static/ { alias; expires 1y; Cache-Control immutable; access_log off; try_files $uri =404; }` + main `location / { proxy_pass; proxy_http_version 1.1; Host/X-Real-IP/X-Forwarded-* headers; Upgrade/Connection WebSocket pair; proxy_read_timeout; proxy_send_timeout; proxy_buffering off; }` so HMR, React Server Components, and SSE flush without buffering. | Done |
| 46.2 | Wizard template: **"Python ASGI (FastAPI / Django Channels / Starlette)"** — adds a seventh template card. Step 2 collects the ASGI backend URL and `proxy_read_timeout` / `proxy_send_timeout` (default `300s` for long-poll / streaming). Emits: listen + server_name + `location / { proxy_pass; proxy_http_version 1.1; forwarding headers; Upgrade/Connection WebSocket pair (FastAPI WebSockets / Channels / Starlette); proxy_read_timeout; proxy_send_timeout; proxy_buffering off (so StreamingResponse / SSE flush immediately); client_max_body_size 25m; }`. | Done |
| 46.3 | Wizard template: **"Go / generic HTTP service"** — adds an eighth template card. Step 2 collects the backend URL and `proxy_read_timeout` / `proxy_send_timeout` (default `60s`). Emits a minimal `location / { proxy_pass; proxy_http_version 1.1; Host/X-Real-IP/X-Forwarded-* headers; proxy_connect_timeout 5s; proxy_read_timeout; proxy_send_timeout; }` suitable for Go / Rust / Java / .NET services. Explicitly steers users to the Node or ASGI template when they need WebSockets, SSE, or long-poll. | Done |

---

## 47. `return` / Redirect Helper at Location Level (F7.6)

**Gap Ref:** (new) — partial at server level via SSL-redirect toggle (9.7); missing at location level · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 47.1 | Location card **Return** section expanded to the full working set: 200, 301, 302, 307, 308, 403, 404, 410, 444 (plus legacy 500 preserved for round-trip when already in config). Placeholder text adapts to the selected code (`https://example.com$request_uri` for 30x, `"OK"` body for 200, plain URL/text otherwise). 444 is rendered without the URL/text input since nginx closes the connection with no response body. Empty URL/text now writes a single-arg `return <code>` directive (e.g. `return 444;` or `return 403;`) rather than forcing an empty second arg. | Done |
| 47.2 | Server card: **"Redirect all traffic to …"** helper — IIFE below the existing SSL-redirect row. Detects whether the server already has a redirect-only `location /` block (single `return` with 30x code + URL, no other enabled directives) and toggles accordingly. When enabled shows: code select (301 Moved Permanently / 302 Found / 307 Temporary, method preserved / 308 Permanent, method preserved), target URL input (e.g. `https://new.example.com`), and **preserve URI** checkbox (default on — appends `$request_uri` to the target). Emits `location / { return <code> <target>$request_uri; }`. If `location /` already contains other directives (including `proxy_pass`), the checkbox is disabled and a warning banner explains how to clear the conflict first. Survives round-trip: reading back, the suffix `$request_uri` is stripped for display so re-editing doesn't double-append. | Done |
| 47.3 | Inline help disambiguating `return` vs. `rewrite ... redirect/permanent` wired into three tooltips: (a) location `return` — enumerates code semantics (301 vs 307, 308 vs 302, 444 nginx-specific close) and explicitly calls out that `return` is faster and clearer than `rewrite ... permanent` for redirects; (b) location `rewrite` — contrasts flags (`last`/`break`/`redirect`/`permanent`) with `return` and warns about the common `rewrite … permanent` redirect-loop footgun; (c) server **SSL redirect** — contrasts with the new **Redirect all traffic to …** helper (same-host force-HTTPS vs. cross-host domain-move). | Done |

---

## 48. CORS Preset (F7.7)

**Gap Ref:** (new) · **Scope:** Frontend · **Dependencies:** 19 (F1.5 add_header)

| ID | Task | Status |
| :--- | :--- | :---: |
| 48.1 | "Apply CORS" preset on server/location — new `cors-preset-group` row appended to the existing `header-presets` block on both server and location cards. Inserts the five CORS headers via `applyCorsPreset()`: `Access-Control-Allow-Methods` (GET/POST/PUT/PATCH/DELETE/OPTIONS), `Access-Control-Allow-Headers` (Authorization/Content-Type/X-Requested-With/Accept/Origin), `Access-Control-Max-Age` (3600), plus origin + credentials rows (see §48.3). All headers are written with `always` so they apply to 4xx/5xx responses (fixes the "preflight works but client can't read error body" bug). Preset is idempotent: re-clicking any mode strips existing `Access-Control-*` rows case-insensitively before appending the new set, so switching modes swaps instead of stacking. | Done |
| 48.2 | Preflight OPTIONS handler — new **+ Preflight handler (`if` OPTIONS → 204)** button in the location CORS preset group. Inserts an `if ($request_method = OPTIONS) { … }` block containing the 5 CORS headers + `Content-Type: text/plain; charset=utf-8` + `Content-Length: 0` + `return 204;`. Smart inheritance: reads the current location's existing `Access-Control-Allow-Origin` row (written by one of the CORS mode buttons) and reuses its value in the preflight block, so origin stays in sync across preflight and main response. If `Access-Control-Allow-Credentials` is already present in the location, it's also copied into the preflight. Idempotent — re-clicking strips any prior preflight `if` block (matched by normalized `($request_method = OPTIONS)` args, whitespace-insensitive) before inserting fresh. A dedicated `cors-preflight-warning` banner appears below the preset row explaining the "if is evil" caveat: the pattern is safe here because only `add_header` + `return` are used (both reliably work inside `if`), but the banner warns against combining preflight `if` with `proxy_pass` / `rewrite` in the same block and suggests named-location (`@preflight`) or app-layer handling for high-traffic APIs. Button gets the warning border accent via `btn-cors-preflight` to signal its structural difference from the origin-mode buttons. | Done |
| 48.3 | Origin policy modes: three distinct buttons in the CORS preset group — **CORS (any `*`)** emits `Access-Control-Allow-Origin "*"` and deliberately omits `Allow-Credentials` (illegal per spec when combined with `*`); **CORS (echo `$http_origin`)** emits `Access-Control-Allow-Origin $http_origin` + `Access-Control-Allow-Credentials "true"` + `Vary: Origin` (critical for cache correctness); **CORS (explicit…)** opens a `window.prompt` for a single trusted origin, emits it quoted + credentials + `Vary: Origin`. The group has an InfoIcon tooltip enumerating all three modes with safety warnings (the echo-mode whitelist requirement is called out explicitly), and each button has a `title` tooltip summarizing its behavior. Multi-origin whitelists are steered to the HTTP Settings `map $http_origin $cors_allowed_origin { … }` editor. | Done |

---

## Phase 8 — Security, Routing Variants & Modern Protocols

## 49. `geo` & `split_clients` Block Editors (F8.1)

**Gap Ref:** (new) — complements `map` editor from F2.4 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 49.1 | `geo {}` editor polished — new geo blocks now default the source variable to `$remote_addr` (not empty), and the source/result inputs gain `title` tooltips + a top-of-section `InfoIcon` explaining when to override the source (e.g. `$http_x_forwarded_for` behind a trusted proxy). CIDR placeholder adapts to the `ranges` toggle (switches between `CIDR (e.g. 10.0.0.0/8)` and `10.0.0.1-10.0.0.255` range notation). Added a **+ Private networks** preset that seeds 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 with value=1 (RFC1918 + loopback); idempotent — rows already present are skipped. Source input supports autocomplete via the new shared `hs-defined-vars` datalist (§49.3). Inline `hs-var-collision` warning fires when the result variable clashes with another block's result variable (nginx refuses duplicate variables on reload). | Done |
| 49.2 | `split_clients {}` editor — new collapsible **"Split Clients (A/B testing)"** section between Maps and Rate Limiting in HttpSettingsTab, mirroring the `map {}` editor shape. Per block: source key input (typically `"${remote_addr}AAA"` with salt suffix), result variable (e.g. `$variant`), and a bucket table with percentage + value columns. Live inline summary shows sum of numeric percentages; inline warnings fire when the sum exceeds 100% or when no `*` fallback row is present (the fallback covers the remainder of traffic, and its absence leaves some clients with an empty result variable). One-click **+ Add `*` fallback** button appears when the fallback is missing. Seed defaults on new block creation: `5% "v1"` + `* "v0"`. CollapsibleSection header carries an InfoIcon explaining hash-based stable bucketing, first-match-wins semantics, and the rebalancing trick (change the salt suffix). Backend round-trip verified by new `TestParseSerializeRoundtrip_SplitClients` — preserves quoted source keys with variable interpolation (`${remote_addr}`), fractional percentages (`0.5%`), and the `*` fallback. | Done |
| 49.3 | Cross-validation across map / split_clients / geo / geoip2 — new derived state `definedVariables` (collects all result-variable bindings across the four block types, tagged with origin and human-readable detail string) plus `variableCounts` (per-name count for collision detection). Rendered as three coordinated UI pieces: (a) a top-of-tab **Defined Variables** panel with pill chips for every variable, each chip carrying a `title` tooltip showing origin block + source→result; duplicates rendered with warning border. (b) a shared `<datalist id="hs-defined-vars">` wired to the `source variable` inputs on map / geo blocks — users can type `$` and the browser auto-suggests all defined variables plus a curated set of nginx built-ins (`$remote_addr`, `$http_x_forwarded_for`, `$http_origin`, `$host`, `$uri`, `$request_uri`, `$args`, `$scheme`, `$request_method`, `$binary_remote_addr`). (c) per-block inline `hs-var-collision` warnings on map / split_clients / geo that flag duplicate result variables before the user hits Save (avoids the "nginx -t: duplicate variable" footgun). Each new control carries an InfoIcon or `title` tooltip explaining the semantics. | Done |

---

## 50. HTTP/3 & QUIC Support (F8.2)

**Gap Ref:** (new) · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 50.1 | `parseListen`/`buildListen` extended to five flags: `ssl`, `http2`, `quic`, `reuseport`. New listen-row checkboxes each carry a `title` tooltip (ssl=TCP+TLS, http2=HTTP/2-over-TLS, quic=UDP+QUIC for HTTP/3, reuseport=SO_REUSEPORT for UDP worker distribution). Detection uses word-boundary regex (`/\bquic\b/`) so substrings in neighbouring tokens don't misfire. When both `ssl` + `quic` are checked on the same listen row, an inline `.listen-warning` banner explains nginx requires separate listen directives for TCP and UDP transports and steers users to either split manually or use the HTTP/3 section below. | Done |
| 50.2 | New **HTTP/3 & QUIC** server-field section below the listen row. Toggles for `http3 on`, `http3_hq on`, `quic_retry on` — each rendered as a checkbox with both a hover `title` and a dedicated `InfoIcon`. The section header carries an InfoIcon explaining the four-step HTTP/3 setup (UDP listen + http3 + Alt-Svc + TLS 1.3 cert). Section gets a left-accent-bar visual treatment via `.http3-section` CSS so it's distinguishable from the standard server-field rows. | Done |
| 50.3 | `ssl_early_data` toggle added to the SSL toggles row (next to ssl_stapling / ssl_session_tickets) with an `InfoIcon` flagging the 0-RTT replay hazard: the tooltip explicitly calls out the need for idempotent/read-only upstreams and the `$ssl_early_data=1` variable check. Also gains preconditions note (TLS 1.3 required in ssl_protocols). While here, added explanatory InfoIcons to the three existing SSL toggles (stapling / stapling_verify / session_tickets) so the whole row is now documented. | Done |
| 50.4 | Alt-Svc auto-emit wired into the `http3` toggle handler. Canonical value depends on the current listen port: `'h3=":<port>"; ma=86400'` with `always` flag so the header also goes out on 4xx/5xx responses. Toggling `http3` on appends the Alt-Svc row only when no existing Alt-Svc header is present. Toggling off removes the row **only when the current value still matches what we wrote** (exact string compare) — if the user has customized the Alt-Svc (different `ma=`, extra versions like `h3-29`, etc.) we leave it alone and render a warning banner noting the override. Prevents clobbering admin edits while still keeping the add/remove paired with http3 for the common case. | Done |
| 50.5 | `quic_retry on` toggle sits alongside http3/http3_hq in the HTTP/3 section (DoS-mitigation tradeoff explained in the InfoIcon: stateless retry at the cost of +1 RTT per handshake). `ssl_reject_handshake on` toggle added to the SSL toggles row with an InfoIcon describing the canonical "safe default-server" pattern — reject TLS handshakes whose SNI doesn't match any server_name, so scanners hitting the bare IP see an `unrecognized_name` alert instead of a fallback cert/Welcome page. Backend round-trip locked in by new `TestParseSerializeRoundtrip_Http3` covering all five §50 directives plus the tricky quoted Alt-Svc value (`'h3=":443"; ma=86400'` — mixed quote levels that the generic unknown-directive preservation path handles). | Done |

---

## 51. Advanced Compression (F8.3)

**Gap Ref:** (new) · **Scope:** Frontend · **Dependencies:** 15.7 (gzip panel)

| ID | Task | Status |
| :--- | :--- | :---: |
| 51.1 | Brotli subsection added inside the Compression collapsible in HttpSettingsTab. Reads `brotliOn` / `brotliCompLevel` (0–11, wider than gzip's 1–9) / `brotliTypes` / `brotliStatic` via the same helpers as gzip. UI: **brotli** on/off toggle + **brotli_static** tri-state select (off/on/always matching gzip_static semantics) + **brotli_comp_level** 0–11 slider + **brotli_types** space-separated MIME textarea. Sub-heading carries a prominent InfoIcon warning that ngx_brotli is a third-party module (not shipped with stock nginx) — if the module is absent, `nginx -t` will reject with "unknown directive \"brotli\"" on Save + Reload; tooltip points users to `libnginx-mod-brotli` (Debian/Ubuntu) and `nginx-mod-http-brotli` (Alpine). Every field has its own InfoIcon: slider tooltip explains 11 is only worthwhile at build time for brotli_static pre-compressed files; brotli_static tooltip describes the build-pipeline pattern (webpack/esbuild outputting `.br` alongside `.js`). | Done |
| 51.2 | `gzip_static` + `gunzip` exposed as a new "Pre-compressed & upstream decompression" sub-row in the Compression section (right before the Brotli sub-heading, separated by a dashed divider via `hs-compression-subrow`). `gzip_static` is a tri-state select (off/on/always) rather than a bool toggle so the "always serve .gz regardless of Accept-Encoding" mode is explicitly reachable. `gunzip` is a simple on/off toggle. Group InfoIcon explains the two use cases: (a) build-time compression of static assets to eliminate per-request CPU, (b) on-the-fly decompression of gzip-encoded upstream responses for clients that don't advertise gzip support (or when you need to run `subs_filter` / `addition` on the body). Toggling off clears the directive entirely (writes `[]`) so it round-trips as absent rather than `gunzip off`. | Done |
| 51.3 | **Apply web-optimized compression** preset button added to the top-of-tab presets row with a purple dot (`#8b5cf6`) to distinguish from performance/hardening/logging. Uses `forceSingle` on the enable flags (`gzip`, `brotli`) so re-clicking is authoritative, and `ensureSingle` on tuning values (comp_level, types, proxied, vary, min_length, static) so existing user overrides survive. MIME set lives in a new `WEB_OPTIMIZED_COMPRESSION_TYPES` constant — deliberately covers text/CSS/JS/JSON/XML/SVG/WASM/manifests but OMITS font formats (WOFF2 is already Brotli-compressed internally; WOFF1 is gzip-compressed — recompressing burns CPU for ~0 byte savings) and images/media (already compressed). Preset seeds `gzip_static on` + `brotli_static on` so once pre-compressed artifacts are on disk the entire stack kicks in. Button's `title` attribute gives a quick one-liner; the paired InfoIcon enumerates exact directives written, the re-apply semantics, and the ⚠ ngx_brotli prerequisite. Backend round-trip locked in by new `TestParseSerializeRoundtrip_Compression` covering gzip + gunzip + gzip_static + all four Brotli directives through the generic unknown-directive preservation path. | Done |

---

## 52. Observability & Status (F8.4)

**Gap Ref:** (new) · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 52.1 | **+ Stub status endpoint** button added to the per-server locations header (sits next to "+ Add location"). One click creates `location = /nginx_status { stub_status; access_log off; allow 127.0.0.1; allow ::1; deny all; }` — the exact-match location modifier (`=`) avoids prefix-match ambiguity with `/nginx_statusextras`, `access_log off` prevents Prometheus scrape lines flooding the access log, and the allow/deny ACL is localhost-only by default (IPv4 + IPv6 loopback) with a broad `deny all` fallback that operators can widen to their monitoring subnet. If a stub_status location already exists on this server the button expands the existing one rather than creating a duplicate. Button + InfoIcon spell out the scraping use case (nginx-prometheus-exporter) and the ACL widening pattern. | Done |
| 52.2 | `status_zone` (server) and `zone <name> <size>` (upstream) exposed as new fields with **Nginx Plus** badges: server card gains `status_zone` text input right after error_log; upstream card gains a two-input row (zone name + zone size, default placeholder `64k`) above the keepalive row. Both carry the orange `.nginx-plus-badge` visual indicator so operators see at a glance the directive is Plus-only — open-source nginx parses the directive without error but doesn't expose the live stats, making the field safe to populate speculatively on an OSS deployment (won't fail `nginx -t`). InfoIcons explain: server `status_zone` aggregates traffic stats in the Plus `/api` + dashboard, zone-name collisions across servers are intentionally summed; upstream `zone` declares the shared-memory zone that also unlocks health_check / sticky / `/api` PATCH on the upstream. Sizing guidance (64k ≈ 128 servers, ~256 bytes each) goes in the InfoIcon body. Round-trip locked in by new `TestParseSerializeRoundtrip_Observability`. | Done |
| 52.3 | **Apply JSON access logging** preset button added to the HttpSettingsTab presets row (cyan dot `#06b6d4`, next to performance/hardening/logging/web-optimized-compression). Generates `log_format main_json escape=json '{ ...22 fields... }'` with a fixed-order field set tuned for centralised log shippers (Loki, Fluent Bit, Filebeat, Datadog, ELK): time (ISO 8601), remote_addr/user, full `$request` + decomposed method+uri, status, bytes_sent + body_bytes_sent, referer, user_agent, X-Forwarded-For, host, server_name, request_time, upstream addr/status/connect_time/response_time, scheme, ssl_protocol/cipher, request_id. Wraps the whole JSON body in single quotes (critical — otherwise the outer `{` looks like a block-open to nginx's tokenizer) and uses `escape=json` so embedded control chars / quotes in variable values don't break ingestion. Sets `access_log /var/log/nginx/access.log main_json` via ensureSingle (user overrides preserved). Re-applying the preset is safe: if `main_json` already exists, user edits are kept. InfoIcon spells out why `escape=json` matters and the field-ordering contract with downstream parsers. Round-trip covered by `TestParseSerializeRoundtrip_Observability`. | Done |
| 52.4 | `error_log` per-server severity dropdown completed: added missing `alert` and `emerg` options so the full nginx level set (emerg/alert/crit/error/warn/notice/info/debug) is reachable. Default option relabeled to `default (error)` so the implicit severity is explicit. Tooltips on the select + the `debug` option itself call out that `debug` requires nginx to be compiled with `--with-debug` and suggest the canonical alternative of `debug_connection <ip|cidr>;` in the `events` block — turning on debug-level logging for a single client IP/subnet rather than globally, which is usually what the operator actually wants (debug level at scale floods the disk). InfoIcon body now documents severity ordering and the debug_connection recipe. | Done |

---

## Phase 9 — Ingress / Egress Management

**Driver:** Nginx doesn't model "ingress/egress" natively, but operators think that way. These views aggregate across files to answer "what's exposed?" and "what backends does this nginx talk to?".

## 53. Ingress / Egress Dashboards (F9.1)

**Gap Ref:** (new) · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 53.1 | New **Ingress / Egress** top-level tab added next to Topology in ConfigEditor. Its **Published Endpoints** view renders one row per (server × listen × location) aggregated across `nginx.conf` + `conf.d/*.conf` + `sites-enabled/*` (using the same ListConfigFiles walker as the file browser). Columns: Server Name (primary + aliases count badge with full list on hover), Listen (bind address + port from `parseListen`), Protocol (SSL / H2 / H3 chips — H2 honours both the listen flag and the server-level `http2 on;` form; H3 needs listen-quic + server-level `http3 on;`), Path (location path with modifier), Backend (kind chip + target — proxy / fastcgi / grpc / uwsgi / return CODE / static root-alias / none), Source (file:line jump hint). Disabled server or location rows render at 0.45 opacity so operators can tell what's actually reachable. Every column header has its own InfoIcon tooltip explaining derivation logic. | Done |
| 53.2 | **Outbound Dependencies** view aggregates every `proxy_pass` / `fastcgi_pass` / `grpc_pass` / `uwsgi_pass` target across all configs, split into two grouped tables: **Upstream pools** (targets resolved to a named `upstream { }` block — shows the pool name, its member server addresses, and which server/path uses it) and **Direct targets** (everything else: literal host:port, IP:port, unix sockets, `$variable`-bearing targets). Each row is classified via `classifyTarget`: `upstream` (matches an upstream name), `host` (hostname — needs DNS), `ip` (literal IPv4/IPv6 — no DNS needed), `unix` (local socket — no DNS, no port), `variable` (contains `$` — always needs a resolver at runtime). TLS scheme (https:// or grpcs://) surfaces as a TLS chip. Each group has an InfoIcon explaining the grouping logic + classification categories. Filter input searches target, host, upstream_name, server, path, and file. | Done |
| 53.3 | Resolver-missing warning: backend walks the scope chain (http block → server block → location) looking for a `resolver` directive when evaluating a pass directive; `ResolverMissing = UsesDNS && !ResolverInScope`. IP and unix targets never flag missing; hostnames + variable-bearing targets do. The Outbound Dependencies table renders a red `⚠ missing` badge in the Resolver column, the row background tints red (`ing-row-warn`), and a count badge `⚠ N` appears on the view-switch button so the warning is discoverable even from the Published Endpoints view. Hovering the warning explains the fix (`resolver 1.1.1.1 8.8.8.8 valid=30s;` in the http or server block) and why nginx rejects it (`nginx -t` fails at reload because DNS targets must be resolvable at config load time). "Warnings only" toggle filters the list to just the problematic rows. | Done |
| 53.4 | CSV / JSON export buttons for both views. CSV uses RFC-4180 quoting (`csvEscape` double-quotes fields containing `,`, `"`, or newlines and escapes embedded quotes as `""`) and emits the full column set — including derived booleans as `0/1` and the resolver-missing flag — so the file is Excel/Google Sheets friendly and auditable. JSON export preserves the full structured response (including the upstream → members lookup map and any parse warnings from the backend) so it can feed a downstream compliance/audit tool directly. Exports respect the active filter so operators can produce a focused CSV for one team (e.g. filter to `api.example.com`, then Export) rather than the whole config corpus. Button tooltips spell out which data is exported + the filter-aware behaviour. | Done |
| 53.5 | Backend topology aggregation APIs at `GET /api/topology/endpoints` and `GET /api/topology/outbound` (in a new `internal/api/topology.go`). Both walk the full config file set (`ListConfigFiles` → `parser.ParseFromFile` per file) and emit JSON structured for UI consumption. Endpoints response: `{endpoints: [...], warnings: [...]}` with PublishedEndpoint per (server × listen × location), stable-sorted by `server_name,port,path,file_path`. Outbound response: `{outbound: [...], upstreams: {name: [members]}, warnings: [...]}` — the upstreams lookup is computed once server-side so the frontend can render the "Members" column without re-walking the config. Scope resolution is implemented rung-by-rung (http→server→location) to avoid false-positive resolver warnings when the directive is set on a parent scope. Target classification handles IPv6-bracketed addresses, unix sockets, variable interpolation, and scheme stripping (http://, https://, grpc://, grpcs://). Unit tests in `topology_test.go` cover: happy path with mixed upstream/direct/unix/grpcs targets, resolver-in-scope case (no warnings), and resolver-missing case (warning fires for DNS only, not IP). All tests pass. | Done |

---

## 54. Ingress Advanced — Access & Traffic Controls (F9.2)

**Gap Ref:** (new) — complements F2.1 rate limiting and F2.8 allow/deny · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 54.1 | `satisfy any\|all` toggle added on both server and location scope in the Authentication section. Rendered CONDITIONALLY — only when both an auth mechanism (`auth_basic` with a non-"off" realm OR `auth_request`) AND one or more access rules (`allow` / `deny`) are present in the same scope, since `satisfy` has no effect otherwise. When the user has a dangling `satisfy` from a previous config but neither prerequisite is set, a warning row shows with a "Remove" button so it can be cleaned up. InfoIcon explains the semantics in plain English: `all` (default) = must pass both checks; `any` = "office IPs bypass the login prompt, everyone else gets the auth dialog" (the canonical use case). Writes `[]` when the user picks the default `all` so the output stays clean / round-trips as absent rather than explicit `satisfy all`. | Done |
| 54.2 | Server + location `limit_req` UI extended: (1) a 3-way burst-mode dropdown (queue / nodelay / delay=N) replacing the old single nodelay checkbox — `delay=N` serves the first N of burst requests immediately then queues the rest, the middle-ground between pure queuing (smooth but slow) and nodelay (fast but spiky), (2) numeric input for burst changed from text to type=number min=0 with tooltip on what "queue overflow" means, (3) new `limit_req_status` field (400–599, default 503) so ops can switch to 429 (RFC-6585 Too Many Requests) which is the semantically correct code for rate limiting and what API clients / CDNs expect for backoff logic. InfoIcons on every field spell out the four behaviour combinations (no burst / burst+queue / burst+nodelay / burst+delay) and the inheritance rule (location limit REPLACES server limit — not additive). Round-trip locked in by new `TestParseSerializeRoundtrip_IngressAdvanced` covering all three burst modes. | Done |
| 54.3 | Server + location `limit_conn` UI completed: existing zone-dropdown + max-conns input gained explanatory tooltips (what "concurrent" means vs `limit_req`'s rate, the `$binary_remote_addr` zone-key recipe), plus a new `limit_conn_status` field for the same reason as 54.2 — 429 is the canonical response for throttling, 503 is misleading because it signals outage. Field only renders when a zone is selected OR an orphan status is set (keeps the card compact for unused locations). Inheritance InfoIcon calls out that a location-level `limit_conn` overrides an inherited server-level one. Round-trip covered by `TestParseSerializeRoundtrip_IngressAdvanced`. | Done |
| 54.4 | New **Active health_check** collapsible section added below the upstream zone field in UpstreamsTab, with a prominent Nginx Plus badge (Plus-only — OSS nginx fails `nginx -t` with "unknown directive \"health_check\""). Directive is parsed via `getHealthCheck` into 9 typed fields: enabled (toggle), interval/fails/passes (probe timing — all tooltips explain sensible values), port (override probe port), uri (default /, typical /healthz or /health), type dropdown (http default / grpc / tcp / udp), match (dropdown of sibling match blocks + "+ New match" creates one), mandatory (start unhealthy until first probe — prevents zero-traffic window after restart), persistent (retain state across reloads). Zone prerequisite check: renders an inline warning when health_check is enabled but `zone` is empty (required for shared-worker state). **match { } block editor** is rendered inline when a match is linked: status (space-separated list of codes or ranges — supports negation `! 500`), body `~` PCRE pattern, header `~` rules (name + pattern pairs, add/remove buttons). "+ New match" auto-names the block `<upstream>_healthy` with collision-avoidance suffix. Unlink button removes the link and deletes the block if not referenced by any other upstream. All 9 health_check args + all match body directives round-trip through `TestParseSerializeRoundtrip_IngressAdvanced`. | Done |

---

## 55. Egress Tuning (F9.3)

**Gap Ref:** (new) · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 55.1 | `proxy_next_upstream` exposed as a checkbox grid on both server and location scope. The 11-condition canonical set lives in a single `PROXY_NEXT_UPSTREAM_CONDS` constant (error / timeout / invalid_header / http_500/502/503/504 / http_403/404 / non_idempotent / off) so the emitted order is stable across saves and diffs stay small. `off` is treated specially: checking it clears every other condition (mutually exclusive per nginx semantics) and unchecking goes back to the empty default. `non_idempotent` carries a ⚠ tooltip about double-side-effect hazards for POST/PATCH/DELETE retries. Every condition has its own InfoIcon explaining when retry-on-that-condition is safe vs dangerous (e.g. `http_500` is opt-in because most 500s are real app errors; `http_502` is almost always safe since the current upstream is unreachable). Location-level list REPLACES (not merges with) the server-level one — called out in the location InfoIcon so ops know not to leave it half-filled. | Done |
| 55.2 | `proxy_next_upstream_tries` (number, 0 = unlimited) and `proxy_next_upstream_timeout` (time, 0 = no cap) surfaced as a two-input row right next to the condition grid, at both server and location scope. InfoIcons explain the tail-latency implication: unlimited tries + slow backends can cause cascading retries that eat every pool member; unlimited timeout can let one request consume a worker for 60s+. Sane recommended caps (2–3 tries, 10s timeout) called out in the tooltips. Round-trip locked in by new `TestParseSerializeRoundtrip_EgressTuning` covering multi-condition lists, `off`, and both tuning knobs at server + location scope. | Done |
| 55.3 | Per-upstream-server `resolve` checkbox audited and polished. Added an orange **Plus** badge inline in the label (the directive is parsed by open-source nginx too, but OSS only re-resolves on `nginx -s reload` — honoring the DNS TTL is a Plus-only feature). Tooltip on the label spells out the three preconditions: (1) the server address must be a hostname, not an IP or unix: socket; (2) a `resolver` directive must be in scope at http or server level (otherwise `nginx -t` rejects the config at load); (3) on OSS nginx, dynamic re-resolution doesn't actually happen — the flag is kept for compatibility and zero-downtime upgrade paths to Plus. Badge tooltip separately calls out the OSS-vs-Plus behaviour difference so ops don't expect dynamic failover on the free edition. | Done |
| 55.4 | New **DNS Resolver** collapsible section added to HttpSettingsTab (below Real IP). Parses the http-level `resolver` directive into five distinct fields: a tag list of DNS server IPs (add/remove with Enter or the +Add button), a `valid=` TTL override, `resolver_timeout` (separate directive), `status_zone=` (Plus badge — parsed by OSS but only Plus exposes the stats), and `ipv6=off` checkbox. Add-row UI mirrors the existing `set_real_ip_from` tag list for consistency. InfoIcons on every field explain: why resolver is needed (egress proxy_pass to hostnames, OCSP stapling, `$variable` targets — all fail at load time without it), sane public resolver recipes (1.1.1.1 / 8.8.8.8 / 9.9.9.9), cloud-specific VPC resolver IPs (AWS `169.254.169.253`, Azure `168.63.129.16`), and the `ipv6=off` tail-latency trap when running IPv4-only. Server-level resolver (F2.10) continues to override. Round-trip covered by `TestParseSerializeRoundtrip_EgressTuning` — full http-level directive with all four tags + server-level override + `resolver_timeout` at both scopes. | Done |

---

## Summary

| Category | Total | Pending | In Progress | Done | Blocked |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 1. Backend — Foundation & Data Model | 4 | 0 | 0 | 4 | 0 |
| 2. Backend — Parser | 4 | 0 | 0 | 4 | 0 |
| 3. Backend — Serializer | 4 | 0 | 0 | 4 | 0 |
| 4. Backend — System Operations | 6 | 0 | 0 | 6 | 0 |
| 5. Backend — API Endpoints | 13 | 0 | 0 | 13 | 0 |
| 6. Frontend — Foundation & Dashboard | 4 | 0 | 0 | 4 | 0 |
| 7. Frontend — Editor & UI Tabs | 6 | 0 | 0 | 6 | 0 |
| 8. Frontend — Upstream Components | 7 | 0 | 0 | 7 | 0 |
| 9. Frontend — Server Block Components | 8 | 0 | 0 | 8 | 0 |
| 10. Frontend — Location Components | 8 | 0 | 0 | 8 | 0 |
| 11. Frontend — Actions & Workflows | 6 | 0 | 0 | 6 | 0 |
| 12. Frontend — Error Handling | 3 | 0 | 0 | 3 | 0 |
| 13. Security | 6 | 0 | 0 | 6 | 0 |
| 14. File & Config Management | 3 | 0 | 0 | 3 | 0 |
| **Subtotal (Existing)** | **82** | **0** | **0** | **82** | **0** |
| | | | | | |
| **Phase 1 — Critical Gaps** | | | | | |
| 15. HTTP Block Settings Panel (F1.1) | 9 | 0 | 0 | 9 | 0 |
| 16. Server-Level Log & Body Size (F1.2) | 4 | 0 | 0 | 4 | 0 |
| 17. Server-Level Proxy Defaults (F1.3) | 5 | 0 | 0 | 5 | 0 |
| 18. Location Proxy Timeout Controls (F1.4) | 5 | 0 | 0 | 5 | 0 |
| 19. Response Headers — add_header (F1.5) | 4 | 0 | 0 | 4 | 0 |
| 20. Security Headers Quick-Apply (F1.6) | 3 | 0 | 0 | 3 | 0 |
| **Phase 2 — Feature Coverage** | | | | | |
| 21. Rate Limiting UI (F2.1) | 5 | 0 | 0 | 5 | 0 |
| 22. Proxy Cache Configuration (F2.2) | 5 | 0 | 0 | 5 | 0 |
| 23. Stream / TCP-UDP Proxy (F2.3) | 8 | 0 | 0 | 8 | 0 |
| 24. Map Block Editor (F2.4) | 4 | 0 | 0 | 4 | 0 |
| 25. Nested Location Blocks (F2.5) | 4 | 0 | 0 | 4 | 0 |
| 26. If Block Support (F2.6) | 4 | 0 | 0 | 4 | 0 |
| 27. Events Block Settings (F2.7) | 4 | 0 | 0 | 4 | 0 |
| 28. Access Control — allow/deny (F2.8) | 4 | 0 | 0 | 4 | 0 |
| 29. SSL Enhancements (F2.9) | 3 | 0 | 0 | 3 | 0 |
| 30. Resolver Settings (F2.10) | 2 | 0 | 0 | 2 | 0 |
| **Phase 3 — Visual & Advanced UX** | | | | | |
| 31. Configuration Topology View (F3.1) | 11 | 0 | 0 | 11 | 0 |
| 32. Raw Text Editor (F3.2) | 5 | 0 | 0 | 5 | 0 |
| 33. Include Directive Navigation (F3.3) | 4 | 0 | 0 | 4 | 0 |
| 34. Config Change History (F3.4) | 6 | 0 | 0 | 6 | 0 |
| 35. Undo / Redo (F3.5) | 4 | 0 | 0 | 4 | 0 |
| 36. Global Search (F3.6) | 4 | 0 | 0 | 4 | 0 |
| **Phase 4 — Production Hardening** | | | | | |
| 37. Let's Encrypt / ACME (F4.1) | 6 | 0 | 0 | 6 | 0 |
| 38. Multi-File Atomic Save (F4.2) | 5 | 0 | 0 | 5 | 0 |
| 39. Serializer Formatting (F4.3) | 4 | 0 | 0 | 4 | 0 |
| **Phase 5 — Optional** | | | | | |
| 40. Optional Features (F5.x) | 5 | 0 | 0 | 5 | 0 |
| **Subtotal (New)** | **131** | **0** | **0** | **131** | **0** |
| | | | | | |
| **Phase 6 — UX & Top-Nav Polish** | | | | | |
| 41. Top-Nav, Theming, Remote File Sources (F6.1) | 8 | 0 | 0 | 8 | 0 |
| | | | | | |
| **Phase 7 — Application Backend Activation** | | | | | |
| 42. PHP / FastCGI Support (F7.1) | 6 | 0 | 0 | 6 | 0 |
| 43. Python uWSGI Support (F7.2) | 2 | 0 | 0 | 2 | 0 |
| 44. gRPC Support (F7.3) | 3 | 0 | 0 | 3 | 0 |
| 45. Static Site / SPA Support (F7.4) | 7 | 0 | 0 | 7 | 0 |
| 46. Node.js / ASGI Wizard Templates (F7.5) | 3 | 0 | 0 | 3 | 0 |
| 47. `return` / Redirect Helper at Location (F7.6) | 3 | 0 | 0 | 3 | 0 |
| 48. CORS Preset (F7.7) | 3 | 0 | 0 | 3 | 0 |
| | | | | | |
| **Phase 8 — Security, Routing, Modern Protocols** | | | | | |
| 49. `geo` & `split_clients` Block Editors (F8.1) | 3 | 0 | 0 | 3 | 0 |
| 50. HTTP/3 & QUIC Support (F8.2) | 5 | 0 | 0 | 5 | 0 |
| 51. Advanced Compression (F8.3) | 3 | 0 | 0 | 3 | 0 |
| 52. Observability & Status (F8.4) | 4 | 0 | 0 | 4 | 0 |
| | | | | | |
| **Phase 9 — Ingress / Egress Management** | | | | | |
| 53. Ingress / Egress Dashboards (F9.1) | 5 | 0 | 0 | 5 | 0 |
| 54. Ingress Advanced — Access & Traffic (F9.2) | 4 | 0 | 0 | 4 | 0 |
| 55. Egress Tuning (F9.3) | 4 | 0 | 0 | 4 | 0 |
| **Subtotal (Phases 6–9 — 2026-04-18 audit)** | **63** | **0** | **0** | **63** | **0** |
| | | | | | |
| **Grand Total** | **276** | **0** | **0** | **276** | **0** |
