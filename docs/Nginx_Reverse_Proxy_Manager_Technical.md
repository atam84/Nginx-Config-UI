# Nginx Reverse Proxy Manager: Technical Specification Document

**Version:** 1.0  
**Target Stack:** Golang Backend, Modern SPA Frontend (React/Vue)  
**Objective:** Create a web-based management tool to visually configure, backup, and control Nginx reverse proxy services.

---

## 1. System Architecture

### 1.1 Technology Stack
*   **Backend:** Golang (Recommended framework: Gin or Echo).
    *   *Responsibilities:* File I/O, config parsing/serialization, system commands (shell execution), backup compression.
*   **Frontend:** Single Page Application (React, Vue, or Svelte).
    *   *Responsibilities:* Visual representation of configuration blocks, form validation, state management.
*   **Data Format:** JSON (Intermediate representation between UI and Nginx Config).

### 1.2 Application Flow
1.  **Read:** Backend parses `.conf` files $\rightarrow$ Converts to JSON AST (Abstract Syntax Tree).
2.  **Display:** Frontend renders JSON AST into visual cards/blocks.
3.  **Modify:** User edits forms $\rightarrow$ Frontend updates JSON $\rightarrow$ Sends to Backend.
4.  **Write:** Backend serializes JSON back to Nginx syntax $\rightarrow$ Writes to disk.
5.  **Apply:** Backend runs `nginx -t` (validation) $\rightarrow$ runs `systemctl reload nginx`.

---

## 2. Data Model & Schema

To bridge the gap between Nginx's text format and a Web UI, we define a Universal Node structure. Every line in Nginx is a **Directive**. If a directive contains other directives, it is a **Block**.

### 2.1 JSON Configuration Schema
This is the contract between the Frontend and Backend.

```json
{
  "file_path": "/etc/nginx/conf.d/default.conf",
  "status": "enabled",
  "directives": [
    {
      "id": "uuid-1",
      "type": "directive",
      "name": "worker_processes",
      "args": ["auto"],
      "comment": "",
      "line_number": 1,
      "enabled": true
    },
    {
      "id": "uuid-2",
      "type": "block",
      "name": "upstream",
      "args": ["my_backend"],
      "enabled": true,
      "directives": [
        {
          "id": "uuid-2a",
          "type": "directive",
          "name": "server",
          "args": ["10.0.0.1:8080", "weight=5"],
          "enabled": true
        }
      ]
    }
  ]
}
```

### 2.2 Key Concepts for UI State
*   **`enabled` (Boolean):** If `false`, the backend prefixes the line with `#` (comment) during serialization.
*   **`args` (Array):** Nginx arguments are space-separated. The UI must handle splitting/joining strings.
*   **`type` (Enum):** `directive` (single line ending in `;`) vs `block` (multi-line ending in `{}`).

---

## 3. Feature Configuration Mapping

This section details how specific Nginx features map to UI components and configuration logic.

### 3.1 Upstream Blocks (Load Balancing)
**UI Component:** "Backend Pools" or "Upstreams" Manager.

| Nginx Directive | UI Control | Options/Logic |
| :--- | :--- | :--- |
| `upstream` | Text Input | Name of the backend group (e.g., `nodejs_app`). |
| `server` | Repeating List | Input: IP/Port string. Supports arguments like `weight=N`, `backup`, `down`. |
| `least_conn` | Radio/Select | Load Balancing Algorithm. Default: Round Robin. Options: `least_conn`, `ip_hash`. |
| `keepalive` | Number Input | Number of keepalive connections to upstream. |

**UI Implementation Logic:**
*   Allow adding/removing servers dynamically.
*   Toggle switches for `backup` (appends `backup` to args) and `down` (comments out the server line).

### 3.2 Server Blocks (Virtual Hosts)
**UI Component:** "Domains" or "Hosts" Dashboard.

| Nginx Directive | UI Control | Options/Logic |
| :--- | :--- | :--- |
| `server_name` | Tag Input | Allow multiple domains (e.g., `example.com`, `www.example.com`). |
| `listen` | Composite Input | Port (Number), Checkbox for `ssl`, Checkbox for `http2`. |
| `root` | Text Input | File path to static files (if not proxying). |
| `index` | Text Input | Default files (e.g., `index.html index.php`). |

### 3.3 Location Blocks (Routing Logic)
**UI Component:** Nested Cards inside a Server Block.

**Matching Types (Dropdown):**
1.  **Prefix Match:** `location /path` (No modifier).
2.  **Exact Match:** `location = /path` (Dropdown value: `=`).
3.  **Preferential Prefix:** `location ^~ /path` (Dropdown value: `^~`).
4.  **Regex (Case Sensitive):** `location ~ /path` (Dropdown value: `~`).
5.  **Regex (Case Insensitive):** `location ~* /path` (Dropdown value: `~*`).

**Common Location Directives:**
*   `proxy_pass`: Text Input (should auto-complete Upstream names).
*   `rewrite`: Two inputs: Regex Pattern and Replacement.
*   `return`: Select Code (301, 302, 403, 404, 500) + Text/URL input.

### 3.4 SSL/TLS Configuration
**UI Component:** "SSL" Tab within a Server Block.

| Nginx Directive | UI Control | Logic |
| :--- | :--- | :--- |
| `ssl_certificate` | File Picker | Path to `.crt` or `.pem`. |
| `ssl_certificate_key` | File Picker | Path to `.key`. |
| `ssl_protocols` | Checkbox Group | Options: `TLSv1.2`, `TLSv1.3`. |
| `ssl_ciphers` | Text Area / Presets | Dropdown with presets like "Modern", "Intermediate", "Old". |
| `ssl_redirect` | Toggle Switch | If ON, adds a `return 301 https://$host$request_uri;` server block. |

### 3.5 Proxy Headers & Buffering
**UI Component:** "Advanced" or "Headers" Accordion section.

*   **Headers Table:** Key-Value pair editor.
    *   *Key:* `Host`, *Value:* `$host` (Preset).
    *   *Key:* `X-Real-IP`, *Value:* `$remote_addr` (Preset).
    *   *Key:* `X-Forwarded-For`, *Value:* `$proxy_add_x_forwarded_for`.
    *   *Key:* `X-Forwarded-Proto`, *Value:* `$scheme`.
*   **Buffering:**
    *   `proxy_buffering`: Toggle Switch (on/off).
    *   `proxy_buffer_size`: Text Input (e.g., `128k`).

---

## 4. Backend API Specification (Golang)

### 4.1 Configuration Management Endpoints

| Method | Endpoint | Description | Request Body / Response |
| :--- | :--- | :--- | :--- |
| **GET** | `/api/config` | List all available config files. | `{"files": ["default.conf", "app.conf"]}` |
| **GET** | `/api/config/{filename}` | Read and parse a specific config file. | Returns the JSON Schema (see 2.1). |
| **PUT** | `/api/config/{filename}` | Save changes to a file. | Body: JSON Schema. <br> Returns: `{ "success": true, "message": "Saved" }` |
| **POST** | `/api/config/create` | Create a new blank config file. | `{ "filename": "new-site.conf" }` |
| **DELETE** | `/api/config/{filename}` | Delete a config file. | *Requires confirmation headers.* |

### 4.2 System Operations Endpoints

| Method | Endpoint | Description | Logic Implementation |
| :--- | :--- | :--- | :--- |
| **POST** | `/api/system/test` | Test configuration syntax. | Executes `nginx -t`. Returns STDERR/STDOUT. |
| **POST** | `/api/system/reload` | Reload Nginx service. | Calls `/api/system/test` first. If pass: `systemctl reload nginx`. |
| **GET** | `/api/system/status` | Get service status. | Executes `systemctl is-active nginx`. |
| **GET** | `/api/backup` | Download backup. | Archives `/etc/nginx` into `.tar.gz`. Returns file stream. |
| **POST** | `/api/restore` | Restore from backup. | Accepts `.tar.gz` file upload, extracts, and reloads. |

---

## 5. Implementation Details

### 5.1 Parser Strategy (Reading)
Nginx config syntax is not standard JSON. You must implement a parser.

**Recommended Approach:**
Use a lexical scanner. Since Nginx syntax is simple (Token, Arguments, Block), a recursive descent parser works best.

1.  **Lexer:** Tokenizes file into `WORD`, `SEMICOLON (;)`, `OPEN_BRACE ({)`, `CLOSE_BRACE (})`.
2.  **Parser:** Reads tokens.
    *   If token ends with `{`, start a Block node, recurse inside.
    *   If token ends with `;`, finish Directive node.
    *   Store `# comments` as metadata on the next node or a separate field.

**Go Library Suggestion:** `github.com/tufanbarisyildirim/gonginx` or `github.com/yosida95/urchin`.

### 5.2 Serializer Strategy (Writing)
You must convert the JSON back to text.

**Pseudo-code Logic:**
```go
func Serialize(node Node, indentLevel int) string {
    indent := strings.Repeat("    ", indentLevel)
    output := ""

    if !node.Enabled {
        output += indent + "# " // Comment out disabled blocks
    }

    if node.Type == "directive" {
        output += indent + node.Name + " " + strings.Join(node.Args, " ") + ";\n"
    } else if node.Type == "block" {
        output += indent + node.Name + " " + strings.Join(node.Args, " ") + " {\n"
        for _, child := range node.Directives {
            output += Serialize(child, indentLevel+1)
        }
        output += indent + "}\n"
    }
    return output
}
```

### 5.3 Enabling/Disabling Logic
The UI provides a simple "Active" toggle switch.
*   **Active (True):** Config is written normally.
*   **Active (False):** Config is written with `#` prefix. Nginx ignores it.
*   *Alternative Implementation:* Rename file from `site.conf` to `site.conf.disabled`. (Less granular, easier to implement but harder to edit while disabled). **Recommendation:** Use the comment method for granular control.

### 5.4 Safety Mechanisms
The application must prevent bricking the server.

1.  **Pre-Save Validation:** Before writing to disk, the backend writes the content to a temporary file (e.g., `/tmp/nginx_test.conf`).
2.  **Syntax Check:** Run `nginx -t -c /tmp/nginx_test.conf`.
3.  **Result Handling:**
    *   If `exit code 0`: Proceed to write actual file.
    *   If `exit code != 0`: Return the error message to the UI and **abort saving**.

---

## 6. UI/UX Guidelines

### 6.1 Visual Hierarchy
1.  **File List:** Sidebar showing available `.conf` files.
2.  **Server Block View:** Main canvas. Each `server` is a large card.
3.  **Location Block View:** Nested cards inside the Server card.

### 6.2 Actions Placement
*   **Global Bar:** Reload Nginx, Check Syntax, Upload Backup.
*   **File Context Menu:** Duplicate File, Delete File, Enable/Disable File.
*   **Block Context Menu:** Move Up/Down, Duplicate, Delete, Comment Out.

### 6.3 Error Handling
*   Display a "Console" modal at the bottom of the screen.
*   If `nginx -t` fails, highlight the line number in the editor view (if a raw editor view is provided) or show the error popup.

---

## 7. Security Considerations

1.  **Privilege Separation:** The Go backend must run with permissions to read/write `/etc/nginx`. Do not run the frontend as root. Ideally, use a systemd capability binding or a sudoers entry specifically for the backend binary.
2.  **Input Sanitization:** Sanitize filenames to prevent Path Traversal (e.g., `../../etc/passwd`). Allow only alphanumeric and `.` characters for filenames.
3.  **Authentication:** The Web UI must be behind a Login screen. If exposed publicly, use Fail2Ban or OAuth.
4.  **ReadOnly Mode:** Option to set the app to "Read Only" to prevent accidental changes by junior admins.