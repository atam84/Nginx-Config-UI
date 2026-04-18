# Nginx Reverse Proxy Manager — Tasks Status

**Project:** nginx-config-ui  
**Last Updated:** 2026-04-18 (Phase 6 complete — top-nav polish, theme toggle, remote Open File, full theme-var migration; Phases 7–9 scoped and ready)
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

---

## Phase 7 — Application Backend Activation & Configuration

**Driver:** Today the UI can only configure HTTP reverse-proxy flows (`proxy_pass`). The sample repo already ships a `fastcgi.conf` that is **only editable via Raw**. Real deployments need first-class support for PHP-FPM, Python (uWSGI + ASGI), Node.js, gRPC, and static/SPA serving.

## 42. PHP / FastCGI Support (F7.1)

**Gap Ref:** (new) — closes the PHP configuration gap identified in the 2026-04-18 audit · **Scope:** Both · **Sample:** `config-samples/fastcgi.conf`

| ID | Task | Status |
| :--- | :--- | :---: |
| 42.1 | Parser/serializer round-trip test for `fastcgi_*` directives (unknown-directive preservation) | Pending |
| 42.2 | Location card **FastCGI** section: `fastcgi_pass` (unix socket / tcp), `fastcgi_index`, `fastcgi_split_path_info`, `include fastcgi_params`, repeated `fastcgi_param` key-value editor | Pending |
| 42.3 | FastCGI timeouts: `fastcgi_connect_timeout`, `fastcgi_read_timeout`, `fastcgi_send_timeout` | Pending |
| 42.4 | FastCGI buffers: `fastcgi_buffer_size`, `fastcgi_buffers`, `fastcgi_busy_buffers_size`, `fastcgi_max_temp_file_size` | Pending |
| 42.5 | FastCGI cache: HTTP-level `fastcgi_cache_path` zones + per-location `fastcgi_cache`, `fastcgi_cache_valid`, `fastcgi_cache_key`, `fastcgi_cache_use_stale` | Pending |
| 42.6 | New Proxy Wizard: **"PHP / PHP-FPM site"** template — emits `root`, `index index.php`, `try_files $uri $uri/ /index.php?$query_string`, and a `location ~ \.php$ { fastcgi_pass … }` block | Pending |

---

## 43. Python uWSGI Support (F7.2)

**Gap Ref:** (new) · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 43.1 | Location card **uWSGI** section: `uwsgi_pass`, `include uwsgi_params`, `uwsgi_param` key-value editor, `uwsgi_read_timeout`, `uwsgi_buffers` | Pending |
| 43.2 | New Proxy Wizard: **"Python / uWSGI (Django/Flask)"** template | Pending |

---

## 44. gRPC Support (F7.3)

**Gap Ref:** (new) · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 44.1 | Location card **gRPC** section: `grpc_pass`, `grpc_set_header`, `grpc_read_timeout`, `grpc_send_timeout`, `grpc_ssl_*` | Pending |
| 44.2 | Auto-enforce `http2` flag on `listen` when a server contains `grpc_pass` (UI warning if missing) | Pending |
| 44.3 | New Proxy Wizard: **"gRPC service"** template | Pending |

---

## 45. Static Site / SPA Support (F7.4)

**Gap Ref:** (new) — covers the highest-frequency missing pattern · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 45.1 | Location card: `root`, `alias`, `index` fields (root currently only at server level; `alias` missing) | Pending |
| 45.2 | Location card: `try_files` arg-list editor with reorderable entries (`$uri`, `$uri/`, `/index.html`, `=404`, etc.) | Pending |
| 45.3 | Server card: `error_page` table — status-code list + target URI/URL, including `=200` / `=code` rewrite form | Pending |
| 45.4 | Location card: `expires` + `Cache-Control add_header` preset for static-asset caching | Pending |
| 45.5 | Optional: per-location `types {}` override editor for MIME corrections | Pending |
| 45.6 | New Proxy Wizard: **"Static site"** template (root + `try_files $uri $uri/ /index.html`) | Pending |
| 45.7 | New Proxy Wizard: **"SPA (SSR + static)"** template (proxy SSR backend + `location /_next/static { … }` passthrough) | Pending |

---

## 46. Node.js / ASGI Wizard Templates (F7.5)

**Gap Ref:** (new) · **Scope:** Frontend · **Dependencies:** 11.1 (wizard), 45

| ID | Task | Status |
| :--- | :--- | :---: |
| 46.1 | Wizard template: **"Node.js (Next.js/Nuxt/Remix)"** — proxy_pass + WebSocket upgrade + `/_next/static` pass-through + HMR-safe timeouts | Pending |
| 46.2 | Wizard template: **"Python ASGI (FastAPI / Django Channels / Starlette)"** — proxy_pass + WebSocket upgrade + long `proxy_read_timeout` preset | Pending |
| 46.3 | Wizard template: **"Go / generic HTTP service"** — minimal proxy_pass with sensible timeouts | Pending |

---

## 47. `return` / Redirect Helper at Location Level (F7.6)

**Gap Ref:** (new) — partial at server level via SSL-redirect toggle (9.7); missing at location level · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 47.1 | Location card **Return** section: code select (200, 301, 302, 307, 308, 403, 404, 410, 444) + URL/text body | Pending |
| 47.2 | Server card: **"Redirect all traffic to …"** helper (emits canonical `location / { return 301 $scheme://host$request_uri; }`) | Pending |
| 47.3 | Disambiguate `return` vs. `rewrite ... redirect/permanent` in the UI with inline help | Pending |

---

## 48. CORS Preset (F7.7)

**Gap Ref:** (new) · **Scope:** Frontend · **Dependencies:** 19 (F1.5 add_header)

| ID | Task | Status |
| :--- | :--- | :---: |
| 48.1 | "Apply CORS" preset on server/location: `Access-Control-Allow-Origin`, `-Methods`, `-Headers`, `-Credentials`, `-Max-Age` | Pending |
| 48.2 | Preflight OPTIONS handler insertion: `if ($request_method = OPTIONS) { add_header ...; return 204; }` with warning about "if is evil" | Pending |
| 48.3 | Origin policy modes: Any (`*`), Echo (`$http_origin` w/ whitelist var), Explicit list | Pending |

---

## Phase 8 — Security, Routing Variants & Modern Protocols

## 49. `geo` & `split_clients` Block Editors (F8.1)

**Gap Ref:** (new) — complements `map` editor from F2.4 · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 49.1 | `geo {}` editor: source variable (default `$remote_addr`) + CIDR → value rows | Pending |
| 49.2 | `split_clients {}` editor: source key + percentage → value rows (A/B testing) | Pending |
| 49.3 | Cross-validate: variables defined in `geo` / `split_clients` appear in variable picker when editing downstream directives | Pending |

---

## 50. HTTP/3 & QUIC Support (F8.2)

**Gap Ref:** (new) · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 50.1 | `listen` editor gains `quic` + `reuseport` flags (alongside existing `ssl`, `http2`) | Pending |
| 50.2 | `http3 on/off`, `http3_hq` toggles on server card | Pending |
| 50.3 | `ssl_early_data` toggle in SSL section | Pending |
| 50.4 | Auto-emit `add_header Alt-Svc 'h3=":443"; ma=86400'` when HTTP/3 enabled | Pending |
| 50.5 | `quic_retry`, `ssl_reject_handshake` advanced options | Pending |

---

## 51. Advanced Compression (F8.3)

**Gap Ref:** (new) · **Scope:** Frontend · **Dependencies:** 15.7 (gzip panel)

| ID | Task | Status |
| :--- | :--- | :---: |
| 51.1 | Brotli section (ngx_brotli): `brotli on`, `brotli_comp_level`, `brotli_types`, `brotli_static` | Pending |
| 51.2 | `gzip_static` + `gunzip` toggles | Pending |
| 51.3 | Compression preset: "Web-optimized" enables gzip + brotli with web MIME types | Pending |

---

## 52. Observability & Status (F8.4)

**Gap Ref:** (new) · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 52.1 | `stub_status` location builder (path + `allow` / `deny` ACL + `access_log off`) | Pending |
| 52.2 | `status_zone` fields on server/upstream (Nginx Plus badge) | Pending |
| 52.3 | Preset: JSON `access_log` (log_format with `escape=json` + structured fields) | Pending |
| 52.4 | `error_log` per-server severity dropdown already covered in 16.2 — verify it exposes `debug_connection` option | Pending |

---

## Phase 9 — Ingress / Egress Management

**Driver:** Nginx doesn't model "ingress/egress" natively, but operators think that way. These views aggregate across files to answer "what's exposed?" and "what backends does this nginx talk to?".

## 53. Ingress / Egress Dashboards (F9.1)

**Gap Ref:** (new) · **Scope:** Both

| ID | Task | Status |
| :--- | :--- | :---: |
| 53.1 | **Published Endpoints** view: aggregated table of every externally-reachable `server_name:port/path` across all config files with SSL/HTTP-version/backend columns | Pending |
| 53.2 | **Outbound Dependencies** view: every `proxy_pass` / `fastcgi_pass` / `grpc_pass` / `uwsgi_pass` target, grouped by upstream name vs. direct host, with DNS vs. IP indicator | Pending |
| 53.3 | Warning badge on `proxy_pass` to a hostname when no `resolver` directive exists in scope | Pending |
| 53.4 | Export Published Endpoints and Outbound Dependencies as CSV / JSON for audits | Pending |
| 53.5 | Backend API: `GET /api/topology/endpoints` and `GET /api/topology/outbound` (aggregations across all parsed configs) | Pending |

---

## 54. Ingress Advanced — Access & Traffic Controls (F9.2)

**Gap Ref:** (new) — complements F2.1 rate limiting and F2.8 allow/deny · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 54.1 | `satisfy any|all` toggle on server/location when mixing `auth_basic` + `allow`/`deny` | Pending |
| 54.2 | Per-location / per-server `limit_req` apply UI: zone dropdown (defined at HTTP level) + `burst` + `nodelay` | Pending |
| 54.3 | Per-location / per-server `limit_conn` apply UI | Pending |
| 54.4 | Active `health_check` + `match { }` fields inside upstream cards (clearly badged Nginx Plus only) | Pending |

---

## 55. Egress Tuning (F9.3)

**Gap Ref:** (new) · **Scope:** Frontend

| ID | Task | Status |
| :--- | :--- | :---: |
| 55.1 | `proxy_next_upstream` condition checkboxes (error, timeout, invalid_header, http_500/502/503/504, http_403/404, non_idempotent, off) | Pending |
| 55.2 | `proxy_next_upstream_tries` + `proxy_next_upstream_timeout` inputs | Pending |
| 55.3 | Per-upstream-server `resolve` parameter (DNS-based dynamic upstreams — Nginx Plus badge) | Pending |
| 55.4 | `resolver` + `resolver_timeout` at server/http level (F2.10 added per-server; surface at http too for egress DNS) | Pending |

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
| 41. Top-Nav, Theming, Remote File Sources (F6.1) | 6 | 0 | 0 | 6 | 0 |
| | | | | | |
| **Phase 7 — Application Backend Activation** | | | | | |
| 42. PHP / FastCGI Support (F7.1) | 6 | 6 | 0 | 0 | 0 |
| 43. Python uWSGI Support (F7.2) | 2 | 2 | 0 | 0 | 0 |
| 44. gRPC Support (F7.3) | 3 | 3 | 0 | 0 | 0 |
| 45. Static Site / SPA Support (F7.4) | 7 | 7 | 0 | 0 | 0 |
| 46. Node.js / ASGI Wizard Templates (F7.5) | 3 | 3 | 0 | 0 | 0 |
| 47. `return` / Redirect Helper at Location (F7.6) | 3 | 3 | 0 | 0 | 0 |
| 48. CORS Preset (F7.7) | 3 | 3 | 0 | 0 | 0 |
| | | | | | |
| **Phase 8 — Security, Routing, Modern Protocols** | | | | | |
| 49. `geo` & `split_clients` Block Editors (F8.1) | 3 | 3 | 0 | 0 | 0 |
| 50. HTTP/3 & QUIC Support (F8.2) | 5 | 5 | 0 | 0 | 0 |
| 51. Advanced Compression (F8.3) | 3 | 3 | 0 | 0 | 0 |
| 52. Observability & Status (F8.4) | 4 | 4 | 0 | 0 | 0 |
| | | | | | |
| **Phase 9 — Ingress / Egress Management** | | | | | |
| 53. Ingress / Egress Dashboards (F9.1) | 5 | 5 | 0 | 0 | 0 |
| 54. Ingress Advanced — Access & Traffic (F9.2) | 4 | 4 | 0 | 0 | 0 |
| 55. Egress Tuning (F9.3) | 4 | 4 | 0 | 0 | 0 |
| **Subtotal (Phases 6–9 — 2026-04-18 audit)** | **61** | **55** | **0** | **6** | **0** |
| | | | | | |
| **Grand Total** | **274** | **55** | **0** | **219** | **0** |
