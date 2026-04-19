package api

import (
	"net"
	"sort"
	"strings"

	"github.com/xenos/nginx-config-ui/internal/model"
	"github.com/xenos/nginx-config-ui/internal/parser"
	"github.com/xenos/nginx-config-ui/internal/paths"
)

// PublishedEndpoint — one externally-reachable server_name:port/path row.
// Emitted by /api/topology/endpoints.
type PublishedEndpoint struct {
	ServerName string `json:"server_name"` // Primary host (first server_name token)
	AllNames   []string `json:"all_names"` // Full server_name list incl. wildcards / regex
	Port       string `json:"port"`        // Port from listen (e.g. "443")
	Address    string `json:"address"`     // Bind address from listen (empty = all)
	Path       string `json:"path"`        // Location prefix (e.g. "/", "/api")
	SSL        bool   `json:"ssl"`         // listen has `ssl` flag
	HTTP2      bool   `json:"http2"`       // listen has `http2` or http2 on;
	HTTP3      bool   `json:"http3"`       // listen has `quic` + server has http3 on
	Backend    string `json:"backend"`     // proxy_pass / fastcgi_pass / grpc_pass / uwsgi_pass target, or ""
	BackendKind string `json:"backend_kind"` // "proxy" | "fastcgi" | "grpc" | "uwsgi" | "return" | "static" | ""
	ReturnCode string `json:"return_code,omitempty"` // set if location is a pure return (no proxy)
	Enabled    bool   `json:"enabled"`
	FilePath   string `json:"file_path"` // Source file (e.g. "sites-enabled/api.conf")
	LineNumber int    `json:"line_number"`
}

// OutboundDependency — one proxy_pass / fastcgi_pass / grpc_pass / uwsgi_pass
// target with grouping metadata. Emitted by /api/topology/outbound.
type OutboundDependency struct {
	Kind             string `json:"kind"`               // "proxy" | "fastcgi" | "grpc" | "uwsgi"
	Target           string `json:"target"`             // Raw target string as written
	TargetKind       string `json:"target_kind"`        // "upstream" | "host" | "ip" | "unix" | "variable"
	Host             string `json:"host"`               // Host portion (when target_kind = host/ip)
	Port             string `json:"port"`               // Port portion
	UpstreamName     string `json:"upstream_name,omitempty"` // Set when target_kind = upstream
	UsesDNS          bool   `json:"uses_dns"`           // true if target is a hostname (not IP/unix/upstream)
	UsesTLS          bool   `json:"uses_tls"`           // https:// / grpcs:// scheme
	ResolverInScope  bool   `json:"resolver_in_scope"`  // resolver directive seen at or above this location
	ResolverMissing  bool   `json:"resolver_missing"`   // true when UsesDNS && !ResolverInScope (warning badge)
	ServerName       string `json:"server_name"`        // Primary server_name of the parent server block
	Path             string `json:"path"`               // Location path
	FilePath         string `json:"file_path"`
	LineNumber       int    `json:"line_number"`
}

// TopologyResponse wraps the Published Endpoints list.
type TopologyEndpointsResponse struct {
	Endpoints []PublishedEndpoint `json:"endpoints"`
	Warnings  []string            `json:"warnings"`
}

// TopologyOutboundResponse wraps the Outbound Dependencies list, plus an
// upstream lookup so the UI can group "upstream" targets to their server
// pool without re-walking the config.
type TopologyOutboundResponse struct {
	Outbound  []OutboundDependency `json:"outbound"`
	Upstreams map[string][]string  `json:"upstreams"` // upstream name → list of server addresses
	Warnings  []string             `json:"warnings"`
}

// CollectPublishedEndpoints walks every parsed config file and emits one
// PublishedEndpoint per (server block × location) that's reachable from
// outside — i.e. each location under each server, paired with each listen
// port. Disabled server blocks and disabled locations are still reported
// but flagged via `Enabled=false` so the UI can grey them out.
func CollectPublishedEndpoints(configRoot string, files []ConfigFileInfo) TopologyEndpointsResponse {
	resp := TopologyEndpointsResponse{Endpoints: []PublishedEndpoint{}, Warnings: []string{}}
	for _, f := range files {
		safePath := paths.SanitizeConfigPath(configRoot, f.Path)
		if safePath == "" {
			continue
		}
		cfg, err := parser.ParseFromFile(safePath)
		if err != nil {
			resp.Warnings = append(resp.Warnings, f.Path+": "+err.Error())
			continue
		}
		// Find every server block (including those nested inside http { }).
		for _, srv := range findServerBlocks(cfg.Directives) {
			rows := buildEndpointsForServer(srv, f.Path)
			resp.Endpoints = append(resp.Endpoints, rows...)
		}
	}
	// Stable sort: server_name ASC, port ASC, path ASC, file ASC.
	sort.SliceStable(resp.Endpoints, func(i, j int) bool {
		a, b := resp.Endpoints[i], resp.Endpoints[j]
		if a.ServerName != b.ServerName {
			return a.ServerName < b.ServerName
		}
		if a.Port != b.Port {
			return a.Port < b.Port
		}
		if a.Path != b.Path {
			return a.Path < b.Path
		}
		return a.FilePath < b.FilePath
	})
	return resp
}

// CollectOutboundDependencies walks every parsed config file and emits one
// OutboundDependency per proxy_pass / fastcgi_pass / grpc_pass / uwsgi_pass
// directive. Uses the surrounding scope chain to decide whether a resolver
// is in-scope (http > server > location) so the UI can flag DNS-based
// targets with no resolver as a "will fail at reload" warning.
func CollectOutboundDependencies(configRoot string, files []ConfigFileInfo) TopologyOutboundResponse {
	resp := TopologyOutboundResponse{
		Outbound:  []OutboundDependency{},
		Upstreams: map[string][]string{},
		Warnings:  []string{},
	}

	for _, f := range files {
		safePath := paths.SanitizeConfigPath(configRoot, f.Path)
		if safePath == "" {
			continue
		}
		cfg, err := parser.ParseFromFile(safePath)
		if err != nil {
			resp.Warnings = append(resp.Warnings, f.Path+": "+err.Error())
			continue
		}
		// Harvest upstream → member servers mapping.
		for _, up := range findUpstreamBlocks(cfg.Directives) {
			name := ""
			if len(up.Args) > 0 {
				name = up.Args[0]
			}
			if name == "" {
				continue
			}
			var members []string
			for _, d := range up.Directives {
				if d.Name == "server" && len(d.Args) > 0 {
					members = append(members, d.Args[0])
				}
			}
			resp.Upstreams[name] = members
		}
		// Walk server blocks and collect pass-directives with scope info.
		for _, srv := range findServerBlocks(cfg.Directives) {
			rows := buildOutboundForServer(srv, cfg.Directives, f.Path, resp.Upstreams)
			resp.Outbound = append(resp.Outbound, rows...)
		}
	}
	sort.SliceStable(resp.Outbound, func(i, j int) bool {
		a, b := resp.Outbound[i], resp.Outbound[j]
		if a.TargetKind != b.TargetKind {
			return a.TargetKind < b.TargetKind
		}
		if a.Target != b.Target {
			return a.Target < b.Target
		}
		return a.FilePath < b.FilePath
	})
	return resp
}

// -----------------------------------------------------------------------
// Tree walking helpers.

func findServerBlocks(nodes []model.Node) []model.Node {
	var out []model.Node
	for i := range nodes {
		n := &nodes[i]
		if n.Type == model.NodeTypeBlock && n.Name == "server" {
			out = append(out, *n)
		}
		out = append(out, findServerBlocks(n.Directives)...)
	}
	return out
}

func findUpstreamBlocks(nodes []model.Node) []model.Node {
	var out []model.Node
	for i := range nodes {
		n := &nodes[i]
		if n.Type == model.NodeTypeBlock && n.Name == "upstream" {
			out = append(out, *n)
		}
		out = append(out, findUpstreamBlocks(n.Directives)...)
	}
	return out
}

// findHttpBlock returns the first top-level http { } block (resolver
// directives placed there are in-scope for every server underneath).
func findHttpBlock(nodes []model.Node) *model.Node {
	for i := range nodes {
		n := &nodes[i]
		if n.Type == model.NodeTypeBlock && n.Name == "http" {
			return n
		}
		if r := findHttpBlock(n.Directives); r != nil {
			return r
		}
	}
	return nil
}

// hasDirective returns true if `name` appears as an enabled directive in the
// immediate directives list (non-recursive — scope is checked rung by rung).
func hasDirective(dirs []model.Node, name string) bool {
	for _, d := range dirs {
		if d.Name == name && d.Enabled {
			return true
		}
	}
	return false
}

// -----------------------------------------------------------------------
// Server-level endpoint extraction.

type listenInfo struct {
	address string
	port    string
	ssl     bool
	http2   bool
	quic    bool
}

func parseListen(args []string) listenInfo {
	li := listenInfo{}
	for _, a := range args {
		la := strings.ToLower(a)
		switch la {
		case "ssl":
			li.ssl = true
		case "http2":
			li.http2 = true
		case "quic":
			li.quic = true
		case "reuseport", "default_server", "default", "ipv6only=on", "ipv6only=off":
			// flags we don't surface
		default:
			// addr[:port] or just port
			if strings.HasPrefix(a, "[") {
				// [::]:443 or [::1]:80
				if idx := strings.LastIndex(a, "]:"); idx >= 0 {
					li.address = a[:idx+1]
					li.port = a[idx+2:]
				} else {
					li.address = a
				}
			} else if strings.Contains(a, ":") {
				if h, p, err := net.SplitHostPort(a); err == nil {
					li.address = h
					li.port = p
				}
			} else if _, err := stringToInt(a); err == nil {
				li.port = a
			}
		}
	}
	return li
}

func stringToInt(s string) (int, error) {
	n := 0
	if s == "" {
		return 0, errNotNumber
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, errNotNumber
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}

var errNotNumber = &topologyErr{"not a number"}

type topologyErr struct{ msg string }

func (e *topologyErr) Error() string { return e.msg }

// buildEndpointsForServer yields one endpoint per (listen × location).
// A server block with 2 listens and 3 locations produces 6 rows — that's
// intentional: operators want to see "api.example.com:443/foo" as a unique
// row to audit each reachable URL.
func buildEndpointsForServer(srv model.Node, filePath string) []PublishedEndpoint {
	serverNames := collectServerNames(srv.Directives)
	primary := ""
	if len(serverNames) > 0 {
		primary = serverNames[0]
	}
	// http2 can be a server-level directive too (http2 on;) which enables
	// HTTP/2 independently of the listen flag — merge both signals.
	serverHasHttp2On := false
	serverHasHttp3On := false
	for _, d := range srv.Directives {
		if d.Name == "http2" && len(d.Args) > 0 && strings.EqualFold(d.Args[0], "on") {
			serverHasHttp2On = true
		}
		if d.Name == "http3" && len(d.Args) > 0 && strings.EqualFold(d.Args[0], "on") {
			serverHasHttp3On = true
		}
	}

	var listens []listenInfo
	for _, d := range srv.Directives {
		if d.Name == "listen" {
			listens = append(listens, parseListen(d.Args))
		}
	}
	if len(listens) == 0 {
		listens = []listenInfo{{port: "80"}} // nginx default
	}

	locations := collectLocations(srv.Directives)
	if len(locations) == 0 {
		// A server with no explicit location still serves "/" (root-level
		// directives like return / root apply there). Synthesize one row.
		locations = []model.Node{{Type: model.NodeTypeBlock, Name: "location", Args: []string{"/"}, Enabled: true}}
	}

	var out []PublishedEndpoint
	for _, li := range listens {
		for _, loc := range locations {
			path := locationPath(loc)
			kind, target, retCode := summarizeLocationBackend(loc)
			out = append(out, PublishedEndpoint{
				ServerName:  primary,
				AllNames:    serverNames,
				Port:        li.port,
				Address:     li.address,
				Path:        path,
				SSL:         li.ssl,
				HTTP2:       li.http2 || serverHasHttp2On,
				HTTP3:       li.quic && serverHasHttp3On,
				Backend:     target,
				BackendKind: kind,
				ReturnCode:  retCode,
				Enabled:     srv.Enabled && loc.Enabled,
				FilePath:    filePath,
				LineNumber:  srv.LineNumber,
			})
		}
	}
	return out
}

func collectServerNames(dirs []model.Node) []string {
	// Return a non-nil slice so the JSON encoder emits `[]` instead of
	// `null` for server blocks without any `server_name` directive.
	out := []string{}
	for _, d := range dirs {
		if d.Name == "server_name" {
			out = append(out, d.Args...)
		}
	}
	return out
}

func collectLocations(dirs []model.Node) []model.Node {
	var out []model.Node
	for _, d := range dirs {
		if d.Type == model.NodeTypeBlock && d.Name == "location" {
			out = append(out, d)
		}
	}
	return out
}

func locationPath(loc model.Node) string {
	// location [= | ~ | ~* | ^~] PATH
	args := loc.Args
	if len(args) == 0 {
		return "/"
	}
	if len(args) == 1 {
		return args[0]
	}
	// Two or more: first is modifier, rest joined
	return args[0] + " " + strings.Join(args[1:], " ")
}

// summarizeLocationBackend returns (kind, target, returnCode) for display.
// Priority: proxy_pass > fastcgi_pass > grpc_pass > uwsgi_pass > return > (static).
func summarizeLocationBackend(loc model.Node) (string, string, string) {
	for _, d := range loc.Directives {
		switch d.Name {
		case "proxy_pass":
			if len(d.Args) > 0 {
				return "proxy", d.Args[0], ""
			}
		case "fastcgi_pass":
			if len(d.Args) > 0 {
				return "fastcgi", d.Args[0], ""
			}
		case "grpc_pass":
			if len(d.Args) > 0 {
				return "grpc", d.Args[0], ""
			}
		case "uwsgi_pass":
			if len(d.Args) > 0 {
				return "uwsgi", d.Args[0], ""
			}
		}
	}
	for _, d := range loc.Directives {
		if d.Name == "return" && len(d.Args) > 0 {
			if len(d.Args) > 1 {
				return "return", d.Args[1], d.Args[0]
			}
			return "return", "", d.Args[0]
		}
	}
	// Pure static / no-op location
	for _, d := range loc.Directives {
		if d.Name == "root" || d.Name == "alias" {
			return "static", d.Args[0], ""
		}
	}
	return "", "", ""
}

// -----------------------------------------------------------------------
// Outbound collection.

func buildOutboundForServer(srv model.Node, topLevel []model.Node, filePath string, upstreams map[string][]string) []OutboundDependency {
	serverNames := collectServerNames(srv.Directives)
	primary := ""
	if len(serverNames) > 0 {
		primary = serverNames[0]
	}
	// Determine resolver-in-scope: http block or server block level.
	httpBlock := findHttpBlock(topLevel)
	resolverAtHttp := false
	if httpBlock != nil {
		resolverAtHttp = hasDirective(httpBlock.Directives, "resolver")
	}
	resolverAtServer := hasDirective(srv.Directives, "resolver") || resolverAtHttp

	var out []OutboundDependency
	// Collect pass directives that appear directly in the server block
	// (i.e. outside any location — nginx does accept proxy_pass at the
	// server level when used with if-blocks, though rare).
	for _, d := range srv.Directives {
		if isPassDirective(d.Name) && len(d.Args) > 0 {
			out = append(out, makeOutboundRow(d, primary, "/", filePath, resolverAtServer, upstreams))
		}
	}
	// Walk locations.
	for _, loc := range collectLocations(srv.Directives) {
		resolverAtLoc := hasDirective(loc.Directives, "resolver") || resolverAtServer
		path := locationPath(loc)
		// Recurse into nested locations as well.
		collectPassRecursive(loc, primary, path, filePath, resolverAtLoc, upstreams, &out)
	}
	return out
}

// collectPassRecursive walks a location tree (locations may be nested or
// wrapped in `if { }` blocks) and emits one row per pass-directive.
func collectPassRecursive(node model.Node, serverName, path, filePath string, resolverInScope bool, upstreams map[string][]string, out *[]OutboundDependency) {
	for _, d := range node.Directives {
		if isPassDirective(d.Name) && len(d.Args) > 0 {
			*out = append(*out, makeOutboundRow(d, serverName, path, filePath, resolverInScope, upstreams))
		}
		if d.Type == model.NodeTypeBlock {
			nestedResolver := hasDirective(d.Directives, "resolver") || resolverInScope
			nestedPath := path
			if d.Name == "location" {
				nestedPath = locationPath(d)
			}
			collectPassRecursive(d, serverName, nestedPath, filePath, nestedResolver, upstreams, out)
		}
	}
}

func isPassDirective(name string) bool {
	switch name {
	case "proxy_pass", "fastcgi_pass", "grpc_pass", "uwsgi_pass":
		return true
	}
	return false
}

func passKind(name string) string {
	switch name {
	case "proxy_pass":
		return "proxy"
	case "fastcgi_pass":
		return "fastcgi"
	case "grpc_pass":
		return "grpc"
	case "uwsgi_pass":
		return "uwsgi"
	}
	return ""
}

func makeOutboundRow(d model.Node, serverName, path, filePath string, resolverInScope bool, upstreams map[string][]string) OutboundDependency {
	kind := passKind(d.Name)
	target := d.Args[0]
	info := classifyTarget(target, upstreams)
	dep := OutboundDependency{
		Kind:            kind,
		Target:          target,
		TargetKind:      info.kind,
		Host:            info.host,
		Port:            info.port,
		UpstreamName:    info.upstreamName,
		UsesDNS:         info.usesDNS,
		UsesTLS:         info.usesTLS,
		ResolverInScope: resolverInScope,
		ResolverMissing: info.usesDNS && !resolverInScope,
		ServerName:      serverName,
		Path:            path,
		FilePath:        filePath,
		LineNumber:      d.LineNumber,
	}
	return dep
}

type targetInfo struct {
	kind         string // "upstream" | "host" | "ip" | "unix" | "variable"
	host         string
	port         string
	upstreamName string
	usesDNS      bool
	usesTLS      bool
}

// classifyTarget takes the raw arg to proxy_pass / fastcgi_pass and figures
// out what kind of backend it is. Order matters: unix: first (unix sockets
// don't have ports), variable next ($backend_pool bypasses DNS scoping),
// then upstream-name lookup, then scheme://host:port parsing.
func classifyTarget(raw string, upstreams map[string][]string) targetInfo {
	t := targetInfo{}
	if raw == "" {
		return t
	}
	lower := strings.ToLower(raw)
	// TLS scheme?
	t.usesTLS = strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "grpcs://")

	// unix: socket
	if strings.HasPrefix(lower, "unix:") {
		t.kind = "unix"
		t.host = strings.TrimPrefix(raw, "unix:")
		return t
	}
	// Variable embedded (e.g. proxy_pass http://$backend;) — nginx
	// requires a resolver in scope for these to work at runtime. We still
	// try to extract literal portions for display.
	if strings.Contains(raw, "$") {
		t.kind = "variable"
		// If there's a literal host portion outside the variable we still
		// want the resolver warning, so usesDNS stays true.
		t.usesDNS = true
		t.host = stripScheme(raw)
		return t
	}
	// Strip scheme
	stripped := stripScheme(raw)
	// fastcgi / uwsgi / grpc can also take bare host:port without scheme
	// Check if it matches an upstream name (with or without "http://" wrapper).
	candidate := stripped
	if slash := strings.Index(candidate, "/"); slash >= 0 {
		candidate = candidate[:slash]
	}
	// host[:port]
	host, port := splitHostPort(candidate)
	if _, ok := upstreams[host]; ok {
		t.kind = "upstream"
		t.upstreamName = host
		t.host = host
		t.port = port
		return t
	}
	if host != "" {
		t.host = host
		t.port = port
		if isIPAddress(host) {
			t.kind = "ip"
		} else {
			t.kind = "host"
			t.usesDNS = true
		}
		return t
	}
	// Fallback
	t.kind = "host"
	t.host = candidate
	t.usesDNS = true
	return t
}

func stripScheme(s string) string {
	for _, sch := range []string{"https://", "http://", "grpcs://", "grpc://"} {
		if strings.HasPrefix(strings.ToLower(s), sch) {
			return s[len(sch):]
		}
	}
	return s
}

func splitHostPort(s string) (string, string) {
	if s == "" {
		return "", ""
	}
	// IPv6 bracketed: [::1]:8080
	if strings.HasPrefix(s, "[") {
		if idx := strings.LastIndex(s, "]:"); idx >= 0 {
			return s[:idx+1], s[idx+2:]
		}
		return s, ""
	}
	if idx := strings.LastIndex(s, ":"); idx >= 0 {
		return s[:idx], s[idx+1:]
	}
	return s, ""
}

func isIPAddress(s string) bool {
	// Strip IPv6 brackets for parsing
	h := s
	if strings.HasPrefix(h, "[") && strings.HasSuffix(h, "]") {
		h = h[1 : len(h)-1]
	}
	return net.ParseIP(h) != nil
}
