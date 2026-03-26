package docs

import (
	_ "embed"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
)

//go:embed openapi.yaml
var openapiYAML []byte

// OpenAPI spec HTML for Swagger UI
const swaggerHTML = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/openapi.json",
      dom_id: '#swagger-ui',
    });
  </script>
</body>
</html>
`

// ServeOpenAPIJSON serves the OpenAPI spec as JSON.
func ServeOpenAPIJSON() gin.HandlerFunc {
	var spec map[string]interface{}
	if err := yaml.Unmarshal(openapiYAML, &spec); err != nil {
		return func(c *gin.Context) {
			c.String(http.StatusInternalServerError, "failed to parse OpenAPI spec")
		}
	}
	jsonBytes, _ := json.Marshal(spec)
	return func(c *gin.Context) {
		c.Header("Content-Type", "application/json")
		c.Writer.Write(jsonBytes)
	}
}

// ServeSwaggerUI serves the Swagger UI HTML page.
func ServeSwaggerUI() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusOK, swaggerHTML)
	}
}
