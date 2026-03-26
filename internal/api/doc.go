// Package api provides HTTP handlers for the Nginx Configuration Manager.
//
// OpenAPI Documentation
//
// Full API specification is available at:
//   - /openapi.json - OpenAPI 3.0 JSON spec
//   - /docs - Swagger UI (interactive documentation)
//
// Endpoints
//
// Configuration:
//   - GET    /api/config          - List config files
//   - GET    /api/config/{path}   - Get parsed config file
//   - PUT    /api/config/{path}   - Save config (validates first)
//   - DELETE /api/config/{path}   - Delete config file
//   - POST   /api/config/parse    - Parse Nginx text to JSON AST
//   - POST   /api/config/serialize - Serialize JSON AST to Nginx text
//   - POST   /api/config/validate - Validate config (nginx -t -c)
//   - POST   /api/config/create   - Create new blank config file
//
// High-level:
//   - GET    /api/upstreams       - List upstream blocks for dropdowns
//   - POST   /api/server          - Add server block to config
//   - POST   /api/location        - Add location block to server
//
// System:
//   - POST   /api/system/test     - nginx -t
//   - POST   /api/system/reload   - Test + systemctl reload nginx
//   - GET    /api/system/status   - systemctl is-active nginx
//   - GET    /api/backup          - Download config tar.gz
//   - POST   /api/restore         - Upload tar.gz, extract, reload
package api
