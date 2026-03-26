This document outlines the architecture, data structures, and configuration mapping required to build a **Nginx Configuration Manager** in Go. This guide is designed to serve as the backend specification for a modern Single Page Application (SPA) UI.

## 1. Project Architecture

### Technology Stack
*   **Backend:** Golang (Gin or Echo framework recommended).
*   **Frontend:** React.js, Vue.js, or Svelte (Modern SPA).
*   **Nginx Interaction:** Go `os/exec` for CLI commands (reload, test), `os` package for file I/O.
*   **Security:** Sudo privileges for the Go binary (to allow editing root-owned nginx files) or running the backend as root (with caution).

### Core Functionalities
1.  **Read/Parse:** Convert raw Nginx config files into a JSON Abstract Syntax Tree (AST).
2.  **Write/Serialize:** Convert the JSON AST back into valid Nginx configuration syntax.
3.  **System Commands:** Test config syntax (`nginx -t`) and reload service.
4.  **File Management:** Backup (tar.gz) and Restore.

---

## 2. Configuration Data Model (JSON Schema)

To create a visual editor, you must standardize the Nginx config format into JSON. Nginx configurations are hierarchical (Directives $\rightarrow$ Blocks).

### The Universal Node Structure
Every line in Nginx is essentially a "Directive". If a directive contains curly braces `{}`, it is a "Block".

```json
{
  "file_path": "/etc/nginx/sites-available/default",
  "directives": [
    {
      "type": "directive",
      "name": "worker_processes",
      "args": ["auto"],
      "line_number": 1,
      "comment": ""
    },
    {
      "type": "block",
      "name": "http",
      "args": [],
      "directives": [
        {
          "type": "block",
          "name": "server",
          "args": [],
          "directives": [
            {
              "type": "directive",
              "name": "listen",
              "args": ["80"],
              "enabled": true
            }
          ]
        }
      ]
    }
  ]
}
```

### Feature-to-UI Mapping Schema
This is the reference for your UI form generators.

#### A. Global/Main Context
*   **UI Tab:** "Global Settings"
*   **Fields:**
    *   `worker_processes`: (Select: auto, or Number Input).
    *   `error_log`: (File Picker, Select: warn/error/notice).
    *   `pid`: (Text Input).

#### B. Upstream Context (Load Balancing)
*   **UI Tab:** "Upstreams" (Visual Server Pools)
*   **JSON Object:**
    ```json
    {
      "type": "block",
      "name": "upstream",
      "args": ["my_backend"],
      "directives": [
        { "name": "least_conn", "type": "directive", "args": [] }, 
        { "name": "server", "args": ["10.0.0.1:8080", "weight=3"] },
        { "name": "server", "args": ["10.0.0.2:8080", "backup"] }
      ]
    }
    ```
*   **UI Representation:** A card titled "my_backend" with a drag-and-drop list of server IPs.

#### C. Server Context (Virtual Hosts)
*   **UI Tab:** "Domains / Servers"
*   **JSON Object:**
    ```json
    {
      "type": "block",
      "name": "server",
      "directives": [
        { "name": "listen", "args": ["443", "ssl"] },
        { "name": "server_name", "args": ["example.com", "www.example.com"] },
        { "name": "ssl_certificate", "args": ["/path/to/cert.pem"] },
        
        // Location Block
        {
          "type": "block",
          "name": "location",
          "args": ["/", "api"], 
          "directives": [
             { "name": "proxy_pass", "args": ["http://my_backend"] },
             { "name": "proxy_set_header", "args": ["Host", "$host"] }
          ]
        }
      ]
    }
    ```

#### D. Special UI Controls Mapping

| Nginx Concept | UI Component Type | Options/Logic |
| :--- | :--- | :--- |
| **Load Balance** | Radio Button / Select | Options: `Round Robin` (empty), `least_conn`, `ip_hash`. |
| **Proxy Pass** | Text Input + Dropdown | Dropdown suggests existing `upstream` names. |
| **SSL Certs** | File Browser | Upload button or path input. |
| **Location Match** | Composite Input | Input 1: Match Type (`=`, `^~`, `~`, `~*`, empty). Input 2: Path. |
| **Boolean Flags** | Toggle Switch | e.g., `proxy_buffering` (on/off). UI sends `on` or `off` string. |
| **Enabled/Disabled** | Checkbox "Enabled" | If unchecked, UI prepends `# ` to the line in the config file. |

---

## 3. Go Backend Implementation Guide

### Step 1: The Parser (Reading)
Since Nginx config syntax is complex, writing a parser from scratch is difficult. It is recommended to use a library like `github.com/tufanbarisyildirim/gonginx` or build a recursive descent parser.

**Go Struct Example:**
```go
package main

type Directive struct {
	Name      string      `json:"name"`
	Args      []string    `json:"args"`
	Comment   string      `json:"comment"`
	Enabled   bool        `json:"enabled"` // Used for UI toggle
}

type Block struct {
	Directive
	Directives []interface{} `json:"directives"` // Can be *Directive or *Block
}

type ConfigFile struct {
    FilePath string      `json:"file_path"`
    Root     *Block      `json:"root"`
}
```

### Step 2: The Serializer (Writing)
You need a function to convert the struct back to text.

**Pseudo-code for Serializer:**
```go
func RenderBlock(block *Block, indentLevel int) string {
    var sb strings.Builder
    indent := strings.Repeat("    ", indentLevel)
    
    // Handle Enabled/Disabled (Comments)
    if !block.Enabled {
        sb.WriteString(indent + "# ")
    }

    // Write Header: upstream name { ...
    sb.WriteString(indent + block.Name + " " + strings.Join(block.Args, " ") + " {\n")

    // Write Children
    for _, child := range block.Directives {
        switch v := child.(type) {
        case *Directive:
            sb.WriteString(RenderDirective(v, indentLevel+1))
        case *Block:
            sb.WriteString(RenderBlock(v, indentLevel+1))
        }
    }

    sb.WriteString(indent + "}\n")
    return sb.String()
}

func RenderDirective(d *Directive, indentLevel int) string {
    indent := strings.Repeat("    ", indentLevel)
    prefix := ""
    if !d.Enabled {
        prefix = "# "
    }
    return indent + prefix + d.Name + " " + strings.Join(d.Args, " ") + ";\n"
}
```

### Step 3: System Operations (CRUD)

**Reload Nginx (Safe Pattern):**
Always test before reload to prevent crashing the server.

```go
func ReloadNginx() error {
    // 1. Test Config
    cmd := exec.Command("nginx", "-t")
    var out bytes.Buffer
    cmd.Stderr = &out
    if err := cmd.Run(); err != nil {
        return fmt.Errorf("Config Test Failed: %s", out.String())
    }

    // 2. Reload if test passed
    reloadCmd := exec.Command("systemctl", "reload", "nginx")
    return reloadCmd.Run()
}
```

**Backup Configuration:**
```go
func BackupConfig(sourcePath string) (string, error) {
    timestamp := time.Now().Format("20060102-150405")
    backupFile := fmt.Sprintf("/var/backups/nginx/nginx-backup-%s.tar.gz", timestamp)
    
    // Use archive/tar in Go or exec "tar"
    cmd := exec.Command("tar", "-czf", backupFile, sourcePath)
    return backupFile, cmd.Run()
}
```

---

## 4. API Endpoints Design

The SPA will consume these REST endpoints.

| Endpoint | Method | Description | JSON Payload/Response |
| :--- | :--- | :--- | :--- |
| `/api/config` | **GET** | Get full parsed config tree. | `{ "files": [...] }` |
| `/api/config` | **POST** | Save full configuration. | `{ "files": [...] }` |
| `/api/upstreams` | **GET** | List all upstreams (for dropdowns). | `[{ "name": "backend1", ... }]` |
| `/api/server` | **POST** | Create a new server block. | `{ "listen": "80", "server_name": "..." }` |
| `/api/location` | **POST** | Add location to a server. | `{ "path": "/api", "proxy_pass": "..." }` |
| `/api/reload` | **POST** | Test and Reload Nginx. | `{ "success": bool, "message": "..." }` |
| `/api/backup` | **GET** | Download current config as tar.gz. | Binary File Stream. |
| `/api/restore` | **POST** | Upload tar.gz to restore. | Form File Upload. |

---

## 5. Frontend UI Workflow (The "Possibilities")

### Dashboard View
*   **Widget:** Active Server Blocks count.
*   **Widget:** Nginx Status (Running / Stopped).
*   **Widget:** Last Reload Time / Last Error log snippet.

### Configuration Editor (Visual)

#### 1. Creating a Reverse Proxy (The Wizard)
1.  **User clicks:** "New Proxy Host".
2.  **Modal Form:**
    *   **Domain:** Input `app.example.com`.
    *   **Destination:** Input `http://192.168.1.50:3000`.
    *   **SSL:** Checkbox "Request SSL (Let's Encrypt)" (requires certbot integration) or "Upload Certs".
    *   **Advanced:** Toggle "Websockets Support" (Auto-adds Upgrade headers).
3.  **Action:** Frontend constructs the JSON object (Server Block) and POSTs to `/api/server`.

#### 2. Enabling/Disabling Rules
*   **UI:** A toggle switch next to a `location` block.
*   **Logic:** When User toggles OFF, Frontend updates JSON `enabled: false`. Backend converts this to `# location / { ... }` in the config file.

#### 3. Modifying Load Balancing
*   **UI:** Edit Upstream Card.
*   **User Action:** Drag server IP order (reordering array in JSON).
*   **User Action:** Select "Least Connections" from dropdown.
*   **Backend:** Writes `least_conn;` as the first line inside the upstream block.

---

## 6. Security Considerations for the App

Since this app modifies system configuration:
1.  **Authentication:** The Web UI MUST have robust authentication (JWT/OAuth) because anyone with access can modify server routing.
2.  **Input Sanitization:** Sanitize inputs to prevent Command Injection. Do not pass raw user input directly into shell commands; use Go's `exec.Command` argument passing which handles escaping.
3.  **Validation:** Ensure IP addresses and Ports are valid formats before writing to config.
4.  **Diff View:** Before saving, show a "Diff" view (Current File vs. Proposed File) so the admin knows exactly what is changing.