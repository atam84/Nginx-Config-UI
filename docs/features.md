# Nginx Config UI — Feature Implementation Plan

**Project:** nginx-config-ui
**Date:** 2026-03-29
**Reference:** `gaps.md` for gap analysis, `tasks-status.md` for current progress

---

## Document Structure

Features are organized into **phases**. Each phase is self-contained and delivers user-visible value. Phases are ordered by impact and dependency — Phase 1 should be completed before Phase 2, and so on.

Each feature has:
- **ID** for cross-referencing with `gaps.md`
- **Scope** indicating which layer is affected (Frontend, Backend, or Both)
- **Dependencies** listing prerequisite features
- **Acceptance criteria** defining when the feature is done

---

## Phase 1 — Close Critical Gaps (Parity with Own Samples)

These features address the embarrassing gaps where the project's own `config-samples/` directory uses Nginx directives that the UI cannot manage.

### F1.1 HTTP Block Settings Panel
**Scope:** Both · **Gap Ref:** 1.1, 1.2, 1.4 · **Dependencies:** None

**Description:**
Add a new "HTTP Settings" tab (or sub-tab inside the config editor) that exposes all http-level directives with grouped form controls.

**Sections and Fields:**

**Performance**
| Directive | Control Type | Default |
|-----------|-------------|---------|
| `sendfile` | toggle | on |
| `tcp_nopush` | toggle | off |
| `tcp_nodelay` | toggle | on |
| `types_hash_max_size` | number input | 2048 |
| `server_tokens` | toggle (off recommended) | on |
| `keepalive_timeout` | duration input | 65 |
| `keepalive_requests` | number input | 100 |
| `client_max_body_size` | size input (with unit dropdown: k/m/g) | 1m |
| `default_type` | text input | application/octet-stream |

**SSL Defaults**
| Directive | Control Type | Default |
|-----------|-------------|---------|
| `ssl_protocols` | checkboxes (TLSv1.2, TLSv1.3) | TLSv1.2 TLSv1.3 |
| `ssl_prefer_server_ciphers` | toggle | on |
| `ssl_session_cache` | text input | shared:SSL:10m |
| `ssl_session_timeout` | duration input | 10m |

**Logging**
| Directive | Control Type |
|-----------|-------------|
| `access_log` | path input + format name dropdown |
| `log_format` | list of { name, format string textarea } |

**Real IP**
| Directive | Control Type |
|-----------|-------------|
| `real_ip_header` | dropdown (X-Forwarded-For, X-Real-IP, custom) |
| `real_ip_recursive` | toggle |
| `set_real_ip_from` | tag-input list of IPs/CIDRs |

**Includes**
| Directive | Control Type |
|-----------|-------------|
| `include` | list of path inputs with glob preview |

**Compression (Gzip)**
| Directive | Control Type | Default |
|-----------|-------------|---------|
| `gzip` | toggle | off |
| `gzip_comp_level` | slider 1–9 | 6 |
| `gzip_min_length` | number input | 256 |
| `gzip_types` | tag-input (text/css, application/json, etc.) | — |
| `gzip_proxied` | multi-select (any, expired, no-cache, etc.) | — |
| `gzip_vary` | toggle | off |
| `gzip_buffers` | text input | 16 8k |

**Acceptance Criteria:**
- All directives from the sample `nginx.conf` http block can be viewed and edited via the UI.
- Changes round-trip correctly: UI → AST → serializer → nginx text → parser → UI.
- `nginx -t` validation still runs before save.

---

### F1.2 Server-Level Log and Body Size Fields
**Scope:** Frontend · **Gap Ref:** 2.1, 2.2 · **Dependencies:** None

**Description:**
Add three fields to the server block card UI:

| Field | Control |
|-------|---------|
| `access_log` | path input + optional format name input |
| `error_log` | path input + level dropdown (debug/info/notice/warn/error/crit) |
| `client_max_body_size` | size input with unit selector (bytes/k/m/g) or `0` for unlimited |

**Acceptance Criteria:**
- Existing server blocks with these directives display their current values.
- New values serialize correctly.
- A "0" value for `client_max_body_size` is valid and means unlimited.

---

### F1.3 Server-Level Proxy Defaults Section
**Scope:** Frontend · **Gap Ref:** 2.5 · **Dependencies:** None

**Description:**
Add an "Advanced Proxy Defaults" collapsible section to the server card, positioned between the SSL section and the Locations section.

| Field | Control |
|-------|---------|
| `proxy_connect_timeout` | duration input |
| `proxy_read_timeout` | duration input |
| `proxy_send_timeout` | duration input |
| `proxy_http_version` | dropdown (1.0, 1.1) |
| `proxy_request_buffering` | toggle |
| `ignore_invalid_headers` | toggle |
| `proxy_set_header` (server-level) | key-value editor (same component as locations) |

**Acceptance Criteria:**
- Directives set at server level appear in the server card, not duplicated in every location.
- Parser correctly distinguishes server-level vs. location-level `proxy_set_header`.

---

### F1.4 Location Proxy Timeout Controls
**Scope:** Frontend · **Gap Ref:** 3.1, 3.2, 3.3, 3.4 · **Dependencies:** None

**Description:**
Extend the location card's expanded view with additional proxy and caching fields:

| Field | Control |
|-------|---------|
| `proxy_connect_timeout` | duration input |
| `proxy_read_timeout` | duration input |
| `proxy_send_timeout` | duration input |
| `proxy_http_version` | dropdown (1.0, 1.1) |
| `proxy_cookie_path` | text input |
| `expires` | text input (30d, max, off, epoch, etc.) |
| `access_log` | path input or `off` |
| `log_not_found` | toggle |

**Acceptance Criteria:**
- All directives from `global_config.conf` sample locations are editable.

---

### F1.5 Response Headers (`add_header`) Support
**Scope:** Frontend · **Gap Ref:** 2.3 · **Dependencies:** None

**Description:**
Add an `add_header` key-value editor to both server and location cards. Separate from `proxy_set_header` (which sets request headers to the upstream).

**UI Design:**
- Section title: "Response Headers (add_header)"
- Key-value rows with an optional `always` checkbox per row.
- Preset buttons: "+ HSTS", "+ X-Frame-Options", "+ X-Content-Type-Options", "+ Referrer-Policy".

**Acceptance Criteria:**
- `add_header` directives serialize with the correct `always` flag when checked.
- Presets insert recommended values (e.g., HSTS with `max-age=31536000; includeSubDomains`).

---

### F1.6 Security Headers Quick-Apply
**Scope:** Frontend · **Gap Ref:** 9.1 · **Dependencies:** F1.5

**Description:**
Add a "Apply Security Headers" button to the server card that inserts a standard set of `add_header` directives in one click:

| Header | Value |
|--------|-------|
| Strict-Transport-Security | max-age=31536000; includeSubDomains; preload |
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| X-XSS-Protection | 1; mode=block |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera=(), microphone=(), geolocation=() |
| Content-Security-Policy | default-src 'self' (template, editable) |

**Acceptance Criteria:**
- One-click apply adds all headers that are not already present.
- Existing headers are not duplicated.

---

## Phase 2 — Complete Nginx Feature Coverage

### F2.1 Rate Limiting UI
**Scope:** Both · **Gap Ref:** 1.3 · **Dependencies:** F1.1

**Description:**

**HTTP-level — Zone Definitions:**
- Add a "Rate Limiting" section to the HTTP Settings panel.
- Each zone: key input (e.g., `$binary_remote_addr`), zone name, shared memory size, rate (e.g., `10r/s`).
- Creates `limit_req_zone` directives.

**Server / Location-level — Zone Application:**
- Add `limit_req` field: zone name dropdown, `burst` number input, `nodelay` toggle.
- Add `limit_req_status` number input (default 503).
- Add `limit_conn_zone` and `limit_conn` support in the same pattern.

**Acceptance Criteria:**
- Can define zones in HTTP settings and apply them in any server/location.
- Rate limit directives round-trip correctly.

---

### F2.2 Proxy Cache Configuration
**Scope:** Both · **Gap Ref:** 8.1 · **Dependencies:** F1.1

**Description:**

**HTTP-level — Cache Zone Definitions:**
- Add a "Cache Zones" section to HTTP Settings.
- Each zone: path, zone name, keys_zone size, levels (e.g., `1:2`), max_size, inactive duration.
- Creates `proxy_cache_path` directives.

**Location-level — Cache Usage:**
| Field | Control |
|-------|---------|
| `proxy_cache` | dropdown (zone names + "off") |
| `proxy_cache_valid` | list of { status codes, duration } rows |
| `proxy_cache_key` | text input (default `$scheme$proxy_host$request_uri`) |
| `proxy_cache_bypass` | text input for conditions |
| `proxy_cache_use_stale` | multi-select (error, timeout, updating, http_500, etc.) |
| `proxy_no_cache` | text input for conditions |

**Acceptance Criteria:**
- Can define cache zones and apply them to locations.
- Cache bypass and stale policies are configurable.

---

### F2.3 Stream / TCP-UDP Proxy Module
**Scope:** Both · **Gap Ref:** 5.1, 11.1 · **Dependencies:** None

**Description:**
Full support for Nginx's stream module (L4 load balancing).

**Backend:**
- Add `POST /api/stream/server` — create stream server block inside `stream {}`.
- Add `POST /api/stream/upstream` — create stream upstream block.
- Add `GET /api/stream/servers` — list stream servers.
- Generalize `AddServerToConfig` to accept a target context name (http, stream).

**Frontend:**
- Add a "Stream / TCP-UDP" tab in the config editor.
- Stream server card fields: `listen` (port + `udp` toggle + `ssl` toggle), `proxy_pass`, `proxy_timeout`, `proxy_connect_timeout`, `proxy_buffer_size`, `ssl_preread` toggle, `access_log`, `error_log`.
- Stream upstream card: reuse the existing upstream card component, with stream-specific context flag.
- Stream log format editor.

**Acceptance Criteria:**
- Can create, edit, delete stream server blocks and stream upstreams via the UI.
- The sample `stream-proxy-6443.conf` can be fully managed.

---

### F2.4 `map` Block Editor
**Scope:** Both · **Gap Ref:** 6.1 · **Dependencies:** None

**Description:**
Add support for creating and editing `map` directives in both http and stream contexts.

**UI Design:**
- "Maps" section/tab.
- Each map: source variable input, result variable input, `hostnames` toggle, `volatile` toggle.
- Table of entries: pattern column + value column.
- Support `default`, exact, prefix (`*.example.com`), regex (`~^(.+)\.example\.com$`).

**Acceptance Criteria:**
- Map blocks serialize to valid Nginx config.
- The stream sample `map $ssl_preread_protocol $upstream { ... }` can be created in the UI.

---

### F2.5 Nested Location Blocks
**Scope:** Frontend · **Gap Ref:** 3.5 · **Dependencies:** None

**Description:**
Allow location blocks to contain child locations. Render recursively.

**UI Design:**
- Inside an expanded location card, show an "+ Add nested location" button.
- Nested locations render indented with a visual connector line.
- Same fields as top-level locations.
- Maximum nesting depth: 3 (Nginx has no hard limit but deeper is unusual).

**Backend:**
- `AddLocationToServer` API already adds to a server by index. Add `AddLocationToLocation` that targets a parent location by ID.

**Acceptance Criteria:**
- The sample nested location (`location ~* \.(css|js|...)$ {}` inside `location /esign {}`) can be created and edited.

---

### F2.6 `if` Block Support
**Scope:** Frontend · **Gap Ref:** 3.6 · **Dependencies:** None

**Description:**
Allow creating `if` blocks inside server and location contexts.

**UI Design:**
- "If Conditions" sub-section with "+ Add condition" button.
- Condition builder: variable dropdown (`$query_string`, `$request_uri`, `$http_*`, custom) + operator (`~`, `~*`, `=`, `!=`, `-f`, `-d`, `!-f`, `!-d`) + value input.
- Inside the if block: a mini-editor for directives (rewrite, return, proxy_pass, set, add_header).

**Important:** Display a warning that `if` in location context has known gotchas ("if is evil" in Nginx community). Link to the Nginx wiki page.

**Acceptance Criteria:**
- The sample `if ($query_string ~ "page=") { rewrite ^ /esign?$args last; }` can be created.

---

### F2.7 Events Block Settings
**Scope:** Frontend · **Gap Ref:** 7.1 · **Dependencies:** None

**Description:**
Add an "Events" section to the Global Settings tab.

| Field | Control |
|-------|---------|
| `worker_connections` | number input (default 768) |
| `multi_accept` | toggle |
| `use` | dropdown (epoll, kqueue, select, poll, auto) |
| `accept_mutex` | toggle |
| `accept_mutex_delay` | duration input |

**Acceptance Criteria:**
- Events block directives round-trip correctly.
- If no events block exists, one is created when settings are changed.

---

### F2.8 Access Control (`allow` / `deny`)
**Scope:** Frontend · **Gap Ref:** 9.2 · **Dependencies:** None

**Description:**
Add an "Access Control" section in server and location cards.

**UI Design:**
- Ordered list of rules. Each rule: action dropdown (`allow` / `deny`) + value input (IP, CIDR, `all`).
- Drag-and-drop reorder (order matters in Nginx — first match wins).
- Preset buttons: "+ Allow all", "+ Deny all", "+ Allow private networks" (adds 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).

**Acceptance Criteria:**
- Rules serialize in the correct order.
- `deny all` can be combined with specific `allow` entries.

---

### F2.9 SSL Enhancements
**Scope:** Frontend · **Gap Ref:** 9.3 · **Dependencies:** None

**Description:**
Extend the SSL section of server cards with:

| Field | Control |
|-------|---------|
| `ssl_stapling` | toggle |
| `ssl_stapling_verify` | toggle |
| `ssl_trusted_certificate` | path input |
| `ssl_dhparam` | path input |
| `ssl_session_cache` | text input |
| `ssl_session_timeout` | duration input |
| `ssl_session_tickets` | toggle |

**Acceptance Criteria:**
- All Mozilla "Modern" SSL configuration directives can be set via the UI.

---

### F2.10 Resolver Settings
**Scope:** Frontend · **Gap Ref:** 2.4 · **Dependencies:** None

**Description:**
Add `resolver` fields to server cards.

| Field | Control |
|-------|---------|
| `resolver` | tag-input for IPs + `valid=` duration input + `ipv6=off` toggle |
| `resolver_timeout` | duration input |

**Acceptance Criteria:**
- The sample `resolver 8.8.8.8 1.1.1.1 valid=300s` can be created from the UI.

---

## Phase 3 — Visual Topology & Advanced UX

### F3.1 Configuration Topology View
**Scope:** Frontend · **Gap Ref:** 10.1 · **Dependencies:** F1.1, F2.3

**Description:**
A full-screen interactive diagram that visualizes the traffic flow of the entire Nginx configuration.

**Node Types:**
| Node | Visual | Data Shown |
|------|--------|-----------|
| **Listener** | Rounded rectangle, blue | IP:port, protocol (http/https/stream) |
| **Server Block** | Card, green | server_name, listen address |
| **Location** | Pill shape, yellow | path, match type |
| **Upstream** | Hexagon, orange | name, algorithm |
| **Backend Server** | Circle, gray | IP:port, status (up/down/backup) |
| **Static Root** | Folder icon, teal | root path |

**Edges:**
- Listener → Server (labeled with server_name match)
- Server → Location (labeled with path)
- Location → Upstream (labeled with proxy_pass)
- Upstream → Backend Server (labeled with weight)
- Location → Static Root (when root is set instead of proxy_pass)

**Interactions:**
- Click any node to jump to its card in the structured editor.
- Hover to highlight the full traffic path from listener to backend.
- Color-code edges by protocol: green = HTTPS, gray = HTTP, blue = stream/TCP.
- Filter by config file to isolate per-file topology.

**Technology:**
- Use React Flow (dagre layout) or D3.js force-directed graph.
- Auto-layout with manual drag override.
- Export as SVG/PNG for documentation.

**Acceptance Criteria:**
- All server blocks, locations, upstreams, and backends from the loaded config appear as nodes.
- Clicking a node navigates to the corresponding card in the editor.
- The topology updates live as the user edits the config.

---

### F3.2 Raw Text Editor with Syntax Highlighting
**Scope:** Frontend · **Gap Ref:** 10.4 · **Dependencies:** None

**Description:**
Add a "Raw Editor" toggle/tab alongside the structured editor tabs.

**Implementation:**
- Embed CodeMirror 6 or Monaco Editor.
- Nginx syntax highlighting (keywords, blocks, variables, comments).
- Line numbers matching the parser's `line_number` metadata.
- Bidirectional sync: editing raw text re-parses to AST; editing structured view re-serializes.
- Warning banner when raw edits would override unsaved structured changes.

**Acceptance Criteria:**
- Toggle between structured and raw view without data loss.
- Syntax errors in the raw editor are highlighted inline.
- `nginx -t` can be triggered from the raw editor.

---

### F3.3 Include Directive Navigation
**Scope:** Both · **Gap Ref:** 10.3 · **Dependencies:** None

**Description:**
Make `include` directives interactive.

**Backend:**
- Add `GET /api/config/resolve-include?glob=...` that returns the list of files matched by an include glob.

**Frontend:**
- Render `include` directives as clickable chips/links.
- On click, show a popover listing matched files; clicking a file navigates to its editor tab.
- In the sidebar file list, show a tree view grouped by which include pulls them in.

**Acceptance Criteria:**
- `include /etc/nginx/conf.d/*.conf` shows all `.conf` files in that directory as clickable links.

---

### F3.4 Config Change History
**Scope:** Both · **Gap Ref:** 10.2 · **Dependencies:** None

**Description:**
Track per-file change history with diffs.

**Backend:**
- Before each save, store the previous content as a versioned snapshot.
- Store in a `history/` directory: `{filename}.{timestamp}.bak`.
- Add `GET /api/config/history/*path` → list of versions with timestamps.
- Add `GET /api/config/history/*path/{timestamp}` → content of that version.

**Frontend:**
- Add a "History" button per config file.
- Show a timeline of saves with unified diffs.
- "Restore this version" button.

**Acceptance Criteria:**
- Every save creates a history entry.
- Users can view diffs between any two versions.
- Restoring a version creates a new history entry (non-destructive).

---

### F3.5 Undo / Redo
**Scope:** Frontend · **Gap Ref:** 11.3 · **Dependencies:** None

**Description:**
Implement an in-memory undo/redo stack for config editing.

**Implementation:**
- Store ConfigFile snapshots in an array (max 50 entries).
- Push a snapshot on every user-initiated change.
- Wire Ctrl+Z (undo) and Ctrl+Shift+Z (redo).
- Show undo/redo buttons in the toolbar.

**Acceptance Criteria:**
- At least 50 levels of undo.
- Undo/redo works across all tabs (global settings, servers, upstreams, locations).

---

### F3.6 Global Search
**Scope:** Both · **Gap Ref:** 10.5 · **Dependencies:** None

**Description:**
Add a search bar to the main toolbar that searches across all config files.

**Backend:**
- Add `GET /api/config/search?q=...` that searches directive names, args, and comments across all loaded config files.
- Return matching nodes with file path, line number, and context snippet.

**Frontend:**
- Instant search as user types.
- Results grouped by file, showing directive name + args + line number.
- Click result to open the file and scroll to/highlight the matching node.

**Acceptance Criteria:**
- Searching "minio" finds all server blocks and upstreams related to minio.
- Searching "ssl_certificate" finds all SSL certificate paths across all files.

---

## Phase 4 — Production Hardening

### F4.1 Let's Encrypt / ACME Integration
**Scope:** Backend · **Gap Ref:** 2.6 · **Dependencies:** F1.2

**Description:**
Replace the placeholder with actual certbot integration.

**Backend:**
- Add `POST /api/ssl/request` — runs certbot for a given domain list.
- Add `GET /api/ssl/certificates` — lists certificates with expiry dates.
- Add `POST /api/ssl/renew` — force-renews a certificate.
- Auto-populate `ssl_certificate` and `ssl_certificate_key` on the server block after successful issuance.

**Frontend:**
- "Request Certificate" button in the SSL section of server cards.
- Certificate status badge (valid/expiring soon/expired).
- Auto-renewal status indicator.

**Acceptance Criteria:**
- Can obtain a certificate for a domain via the UI (requires DNS/HTTP validation).
- Certificate paths are auto-filled in the server block.

---

### F4.2 Multi-File Atomic Save
**Scope:** Backend · **Gap Ref:** 11.4 · **Dependencies:** None

**Description:**
Add a "Save All & Test" workflow for cross-file consistency.

**Backend:**
- Add `POST /api/config/save-all` that accepts multiple file payloads.
- Write all files to temp locations, run `nginx -t`, then atomically move to final paths.
- On failure, roll back all files to their previous content.

**Frontend:**
- Track "dirty" state per file.
- "Save All" button in the global toolbar (active when any file is dirty).
- On failure, show which file/line caused the error.

**Acceptance Criteria:**
- Cross-file references (e.g., upstream defined in one file, used in another) are validated together.
- Failed validation rolls back all changes.

---

### F4.3 Serializer Formatting Preservation
**Scope:** Backend · **Gap Ref:** 11.2 · **Dependencies:** None

**Description:**
Preserve original formatting on round-trip.

**Implementation:**
- Add `BlankLinesBefore int` field to the Node struct.
- Parser records blank lines between directives.
- Serializer emits blank lines accordingly.
- Optionally add a "Format Config" button that normalizes formatting.

**Acceptance Criteria:**
- Editing a single directive does not reformat the entire file.
- Blank lines and comment groupings are preserved.

---

## Phase 5 — Optional / Niche Features

### F5.1 Mail Proxy Module
**Scope:** Both · **Dependencies:** F2.3 (reuse stream UI patterns)

Support for `mail {}` blocks (IMAP, POP3, SMTP proxying). Low priority unless specifically needed.

### F5.2 Upstream Advanced Algorithms
**Scope:** Frontend · **Dependencies:** None

Add `random` algorithm to the upstream dropdown. Add Nginx Plus indicators for `least_time`, `queue`, and `ntlm`.

### F5.3 GeoIP / Geo Module Support
**Scope:** Both · **Dependencies:** F2.4 (map editor)

UI for `geo {}` and `geoip2 {}` blocks — IP-to-variable mapping for geographic routing.

### F5.4 Auth Basic / Auth Request
**Scope:** Frontend · **Dependencies:** None

Add `auth_basic` (realm + htpasswd path) and `auth_request` (sub-request URI) fields to server/location cards.

### F5.5 Custom Error Pages
**Scope:** Frontend · **Dependencies:** None

Add `error_page` field to server/location cards: status code(s) + URI or `=code` redirect.

---

## Implementation Priority Matrix

```
Impact ▲
       │
  HIGH │  F1.1  F1.2  F1.3  F3.1
       │  F1.4  F1.5  F2.1  F2.2
       │
  MED  │  F2.3  F2.5  F2.6  F3.2
       │  F2.7  F2.8  F2.9  F3.4
       │  F1.6  F2.4  F3.3  F3.5
       │
  LOW  │  F5.1  F5.2  F5.3  F5.4
       │  F5.5  F4.3
       │
       └──────────────────────────► Effort
          S       M       L     XL
```

---

## Task Tracking Template

For each feature, create a tracking entry:

```
### F{X.Y} — {Feature Name}
- [ ] Design UI mockup
- [ ] Implement backend API (if needed)
- [ ] Implement frontend component
- [ ] Add to parser/serializer (if new directive type)
- [ ] Write unit tests
- [ ] Write integration test (round-trip: UI → API → nginx -t)
- [ ] Update OpenAPI spec
- [ ] Update README
```
