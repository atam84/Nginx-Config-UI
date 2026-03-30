# Nginx Config UI — Gap Analysis

**Project:** nginx-config-ui
**Date:** 2026-03-29
**Scope:** Comprehensive audit of missing, incomplete, or broken functionality compared to Nginx's full feature set and the project's own config samples.

---

## How to Read This Document

Each gap is tagged with a **severity** and an **effort estimate**:

| Severity | Meaning |
|----------|---------|
| **CRITICAL** | The UI cannot manage configs that the project's own samples use |
| **HIGH** | A mainstream Nginx feature has zero UI support |
| **MEDIUM** | Feature exists partially or only via raw text editing |
| **LOW** | Nice-to-have; edge-case or niche Nginx module |

| Effort | Meaning |
|--------|---------|
| **S** | < 1 day — add a form field or toggle |
| **M** | 1–3 days — new panel, API endpoint, or component |
| **L** | 3–7 days — new subsystem (e.g., stream proxy, caching) |
| **XL** | 1–2 weeks — cross-cutting change (e.g., visual topology) |

---

## 1. Gaps in HTTP Block Management

### 1.1 No HTTP-level Settings Panel
**Severity:** CRITICAL · **Effort:** M

The `http {}` block in the project's own `nginx.conf` sample contains ~20 directives (`sendfile`, `tcp_nopush`, `types_hash_max_size`, `server_tokens`, `default_type`, `include mime.types`, `real_ip_header`, `set_real_ip_from`, `log_format`, `access_log`, `ssl_protocols`, `ssl_prefer_server_ciphers`). None of these are editable in the UI. The Global Settings tab only covers three main-context directives (`worker_processes`, `error_log`, `pid`).

**What needs to change:**
- Add an "HTTP Settings" tab or sub-panel inside the config editor.
- Group directives into logical sections: Performance, Logging, SSL Defaults, Real IP, Includes.
- Provide typed controls (toggles for `sendfile`/`tcp_nopush`/`server_tokens`, dropdowns for `default_type`).
- Expose a key-value editor for `set_real_ip_from` entries.

### 1.2 Gzip / Compression Settings Missing
**Severity:** HIGH · **Effort:** S

The sample config has gzip directives (commented out). The `technical_stack.conf` sample actively uses `gzip on`, `gzip_min_length`, `gzip_types`, `gzip_proxied`, `gzip_vary`. No UI exists.

**What needs to change:**
- Add a "Compression" card/section inside the HTTP settings panel.
- Fields: `gzip` toggle, `gzip_comp_level` slider (1–9), `gzip_min_length` input, `gzip_types` multi-select/tag input, `gzip_proxied` dropdown, `gzip_vary` toggle, `gzip_buffers` input.

### 1.3 Rate Limiting Has No UI
**Severity:** HIGH · **Effort:** M

`limit_req_zone` is defined in the sample `nginx.conf` http block. `limit_req` can be applied per-server or per-location. There is no UI to define zones or apply rate limits.

**What needs to change:**
- Add a "Rate Limiting" section in HTTP settings to define `limit_req_zone` entries (key, zone name, size, rate).
- Add a `limit_req` field in server and location cards (zone dropdown, burst input, `nodelay` toggle).
- Also support `limit_conn_zone` and `limit_conn` for connection limiting.

### 1.4 `log_format` Definition Not Editable
**Severity:** MEDIUM · **Effort:** S

The sample defines custom `log_format custom '...'` in the http block. No UI to create or edit named log formats.

**What needs to change:**
- Add a "Log Formats" section in HTTP settings: name + format string textarea.
- Expose these names as dropdown options in `access_log` fields.

---

## 2. Gaps in Server Block Management

### 2.1 Per-Server `access_log` / `error_log` Missing
**Severity:** CRITICAL · **Effort:** S

Almost every server block in the project's samples sets per-server log paths. The server card UI has no fields for these.

**What needs to change:**
- Add `access_log` (path + optional format name) and `error_log` (path + level dropdown) fields to the server card.

### 2.2 `client_max_body_size` Not Exposed
**Severity:** CRITICAL · **Effort:** S

Used in at least 5 server blocks in the samples (`0`, `512M`). No UI field exists at server or location level.

**What needs to change:**
- Add an input field for `client_max_body_size` in server cards and location cards.

### 2.3 `add_header` (Response Headers) Not Supported
**Severity:** HIGH · **Effort:** S

Samples use `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always` on multiple servers. The UI only manages `proxy_set_header` (request headers).

**What needs to change:**
- Add a key-value editor for `add_header` directives on server and location cards.
- Include presets for common security headers: HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`.

### 2.4 `resolver` Directive Missing
**Severity:** MEDIUM · **Effort:** S

Used in `proxy.conf` samples (`resolver 8.8.8.8 1.1.1.1 valid=300s`). No UI.

**What needs to change:**
- Add `resolver` input (IP list + `valid=` duration) and `resolver_timeout` to server cards.

### 2.5 Server-level Proxy Defaults Not Editable
**Severity:** HIGH · **Effort:** S

Samples set `proxy_set_header`, `proxy_connect_timeout`, `proxy_http_version`, `proxy_request_buffering`, `ignore_invalid_headers` at the server level (inherited by all locations). The UI only exposes proxy settings inside location cards.

**What needs to change:**
- Add an "Advanced Proxy Defaults" collapsible section to the server card with fields for: `proxy_connect_timeout`, `proxy_read_timeout`, `proxy_send_timeout`, `proxy_http_version` (dropdown: 1.0 / 1.1), `proxy_request_buffering` toggle, `ignore_invalid_headers` toggle, server-level `proxy_set_header` key-value list.

### 2.6 Let's Encrypt Integration is a Placeholder
**Severity:** MEDIUM · **Effort:** L

Task 9.8 is marked "Done" but the UI shows only a static text note. No actual certbot/ACME integration exists.

**What needs to change:**
- Implement a "Request Certificate" button that calls certbot (or an ACME client library) via the backend.
- Auto-populate `ssl_certificate` and `ssl_certificate_key` paths on success.
- Add a certificate status/expiry display.

---

## 3. Gaps in Location Block Management

### 3.1 Proxy Timeout Controls Missing
**Severity:** HIGH · **Effort:** S

Samples use `proxy_connect_timeout 300`, `proxy_read_timeout 120s`, `proxy_send_timeout`. Only `proxy_buffering` and `proxy_buffer_size` are in the location UI.

**What needs to change:**
- Add inputs for `proxy_connect_timeout`, `proxy_read_timeout`, `proxy_send_timeout` to the location card.

### 3.2 `proxy_http_version` Not Exposed
**Severity:** MEDIUM · **Effort:** S

Used in nearly every sample server block (`proxy_http_version 1.1`). No UI control.

**What needs to change:**
- Add a dropdown (1.0 / 1.1) in the location or server proxy settings.

### 3.3 `proxy_cookie_path` Not Supported
**Severity:** MEDIUM · **Effort:** S

Used in geoserver sample (`proxy_cookie_path / "/; HttpOnly; Secure; SameSite=lax"`). No UI.

**What needs to change:**
- Add a `proxy_cookie_path` input in the location card advanced section.

### 3.4 `expires` and Cache-Control Headers Missing
**Severity:** MEDIUM · **Effort:** S

Samples use `expires 30d` on static asset locations. No UI support.

**What needs to change:**
- Add an `expires` input field in the location card.

### 3.5 Nested Location Blocks Not Supported
**Severity:** HIGH · **Effort:** M

The `global_config.conf` sample has a location nested inside another location (`location ~* \.(css|js|png|...)$ {}` inside `location /esign {}`). The UI renders locations flat.

**What needs to change:**
- Allow location cards to contain child location cards (recursive rendering).
- Update the `AddLocationToServer` API to support targeting a parent location.

### 3.6 `if` Blocks Not Editable
**Severity:** MEDIUM · **Effort:** M

Sample uses `if ($query_string ~ "page=") { rewrite ^ /esign?$args last; }` inside a location. The parser may preserve these as blocks, but the UI cannot create or meaningfully edit `if` conditions.

**What needs to change:**
- Add an "If Conditions" sub-section in the location card.
- Provide a condition builder: variable dropdown + operator + value input.
- Allow nesting directives (rewrite, return, proxy_pass) inside the if block.

---

## 4. Gaps in Upstream Management

### 4.1 `zone` (Shared Memory) Not Supported
**Severity:** MEDIUM · **Effort:** S

Required for active health checks and runtime upstream modification. No UI field.

**What needs to change:**
- Add `zone` name + size input to the upstream card.

### 4.2 `least_time` and `random` Algorithms Missing
**Severity:** LOW · **Effort:** S

The algorithm dropdown supports `round_robin`, `least_conn`, `ip_hash`, `hash`. Nginx also supports `least_time` (commercial) and `random two least_conn`.

**What needs to change:**
- Add `random` to the algorithm dropdown (with optional `two` parameter and method sub-dropdown).

### 4.3 `queue` Directive Not Supported
**Severity:** LOW · **Effort:** S

Nginx Plus feature for queuing requests when all upstream servers are busy.

**What needs to change:**
- Add optional `queue` input (timeout + number) to upstream card, clearly labeled as Nginx Plus only.

---

## 5. Gaps in Stream (L4) Proxy Support

### 5.1 No Stream Block UI at All
**Severity:** HIGH · **Effort:** L

The project's own samples include a `stream {}` block with TCP/UDP proxying, stream upstreams, `ssl_preread`, `map`, and stream log formats. The UI has zero support. The `CreateServerBlock` API only targets `http {}`.

**What needs to change:**
- Add a "Stream / TCP-UDP" tab in the config editor.
- Support stream-level directives: `log_format`, `access_log`.
- Support stream server blocks: `listen` (with `udp` flag), `proxy_pass`, `proxy_timeout`, `proxy_connect_timeout`, `ssl_preread`.
- Support stream upstream blocks (reuse the upstream card component with stream context).
- Update backend API to add/remove blocks inside `stream {}`.

---

## 6. Gaps in `map` and Variable Support

### 6.1 `map` Blocks Not Supported
**Severity:** MEDIUM · **Effort:** M

Samples use `map` in stream context. `map` is also heavily used in http context for A/B testing, redirects, variable routing, and header manipulation.

**What needs to change:**
- Add a "Maps" section or tab.
- Provide a table-style editor: source variable, target variable, and key-value pairs for mapping rules.
- Support `default`, `~` (regex), `~*` (case-insensitive regex) entries.

---

## 7. Gaps in Events Block

### 7.1 Events Block Not Editable
**Severity:** MEDIUM · **Effort:** S

`worker_connections`, `multi_accept`, `use` (epoll/kqueue) are core tuning parameters. Currently only accessible via the generic "Additional Global Directives" mechanism.

**What needs to change:**
- Add an "Events" section to Global Settings: `worker_connections` (number input), `multi_accept` (toggle), `use` (dropdown: epoll, kqueue, select, poll).

---

## 8. Gaps in Caching

### 8.1 Proxy Cache Configuration Missing
**Severity:** HIGH · **Effort:** M

`proxy_cache_path`, `proxy_cache`, `proxy_cache_valid`, `proxy_cache_key`, `proxy_cache_bypass`, `proxy_cache_use_stale`, `proxy_no_cache` are major performance features with no UI.

**What needs to change:**
- Add a "Cache Zones" section in HTTP settings to define `proxy_cache_path` entries (path, zone name, size, levels, keys_zone, max_size, inactive).
- Add cache fields in location cards: `proxy_cache` (zone dropdown), `proxy_cache_valid` (status code + duration pairs), `proxy_cache_key`, `proxy_cache_bypass` (conditions), `proxy_cache_use_stale` (checkboxes: error, timeout, updating, etc.).

---

## 9. Gaps in Security

### 9.1 No Security Headers Bundle
**Severity:** HIGH · **Effort:** S

No quick-apply mechanism for standard security headers. Admins must manually add each `add_header` directive.

**What needs to change:**
- Add a "Security Headers" preset button to server cards that auto-adds: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy, Content-Security-Policy (template).

### 9.2 `allow` / `deny` Access Control Missing
**Severity:** MEDIUM · **Effort:** S

No UI for IP-based access control at server or location level.

**What needs to change:**
- Add an "Access Control" section in server and location cards: ordered list of `allow` / `deny` entries (IP/CIDR or `all`).

### 9.3 `ssl_stapling` and OCSP Settings Missing
**Severity:** MEDIUM · **Effort:** S

`ssl_stapling`, `ssl_stapling_verify`, `ssl_trusted_certificate` are best practices for SSL. Not in the UI.

**What needs to change:**
- Add these toggles and path inputs to the SSL section of server cards.

---

## 10. Gaps in Visual / UX

### 10.1 No Visual Topology / Architecture View
**Severity:** HIGH · **Effort:** XL

There is no way to visualize how traffic flows: listener → server → location → upstream → backend servers. Admins must mentally reconstruct the topology from individual cards.

**What needs to change:**
- Add a "Topology" or "Architecture" view that renders the config as a flow diagram.
- Show: listen addresses → server_name matching → location routing → upstream pools → backend server IPs.
- Use an interactive graph (e.g., React Flow, D3, or Mermaid) with click-to-edit navigation.

### 10.2 No Config Diff History
**Severity:** MEDIUM · **Effort:** M

The diff modal shows current vs. proposed before save, but there is no history of past changes. Backups are full tar.gz snapshots with no per-file diff.

**What needs to change:**
- Store a changelog (timestamp + diff) per save operation.
- Add a "History" tab per config file showing diffs over time.

### 10.3 `include` Directives Not Navigable
**Severity:** MEDIUM · **Effort:** M

`include /etc/nginx/conf.d/*.conf` appears as raw text. Users cannot click through to see which files are included or navigate to them.

**What needs to change:**
- Resolve include globs and render them as clickable links in the UI.
- Show an "Included Files" panel that lists all files pulled in by include directives.

### 10.4 No Raw Text / Code Editor Mode
**Severity:** MEDIUM · **Effort:** M

Power users sometimes need to edit the raw Nginx config text directly. The UI only offers structured form editing.

**What needs to change:**
- Add a "Raw Editor" tab with syntax highlighting (CodeMirror or Monaco) alongside the structured tabs.
- Sync changes bidirectionally: raw text ↔ structured AST.

### 10.5 No Search / Filter Across Configs
**Severity:** LOW · **Effort:** M

With many config files and server blocks, there is no way to search for a domain, upstream name, or directive across all configs.

**What needs to change:**
- Add a global search bar that searches across all config files and highlights matching directives/blocks.

---

## 11. Gaps in Backend / API

### 11.1 No API for Stream Block Management
**Severity:** HIGH · **Effort:** M

`AddServerToConfig` only targets the `http` block. There is no equivalent for `stream`.

**What needs to change:**
- Add `POST /api/stream/server` and `POST /api/stream/upstream` endpoints.
- Generalize `AddServerToConfig` to accept a target block name.

### 11.2 Serializer Loses Blank Lines and Formatting
**Severity:** MEDIUM · **Effort:** M

The serializer produces compact output. Original formatting (blank lines between blocks, aligned comments) is lost on round-trip.

**What needs to change:**
- Preserve blank-line metadata in the AST (e.g., `blank_lines_before` count on each node).
- Optionally re-emit blank lines in the serializer.

### 11.3 No Undo / Redo
**Severity:** MEDIUM · **Effort:** M

Editing is destructive. There is no undo stack in the frontend or versioning in the backend.

**What needs to change:**
- Implement an undo/redo stack in the React state (array of ConfigFile snapshots).
- Wire Ctrl+Z / Ctrl+Shift+Z.

### 11.4 No Multi-File Atomic Operations
**Severity:** LOW · **Effort:** M

When nginx.conf includes conf.d/*.conf, editing one file can break references in another. There is no cross-file validation or atomic multi-file save.

**What needs to change:**
- Add a "Save All & Test" action that writes all modified files, runs `nginx -t`, and rolls back on failure.

---

## 12. Summary: Gap Count by Severity

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| HIGH | 12 |
| MEDIUM | 15 |
| LOW | 4 |
| **Total** | **35** |
