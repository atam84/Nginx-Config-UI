import { useState, useMemo, useCallback, useRef, useEffect } from "react";

const SAMPLE_CONFIG = {
  listeners: [
    { id: "l1", ip: "192.168.9.170", port: "80", protocol: "http" },
    { id: "l2", ip: "192.168.9.160", port: "80", protocol: "http" },
    { id: "l3", ip: "192.168.9.120", port: "80", protocol: "http" },
    { id: "l4", ip: "192.168.9.150", port: "80", protocol: "http" },
    { id: "l5", ip: "192.168.9.80", port: "80", protocol: "http" },
    { id: "l6", ip: "192.168.9.80", port: "9000", protocol: "http" },
    { id: "l7", ip: "192.168.9.80", port: "6443", protocol: "https" },
    { id: "l8", ip: "192.168.9.120", port: "9443", protocol: "stream" },
  ],
  servers: [
    { id: "s1", name: "api-prod.testing-config.com", listenerId: "l1", locations: ["loc1","loc2"] },
    { id: "s2", name: "stm-api-prod.testing-config.com", listenerId: "l2", locations: ["loc3","loc4"] },
    { id: "s3", name: "next.testing-config.com", listenerId: "l3", locations: ["loc5","loc6","loc7","loc8","loc9","loc10"] },
    { id: "s4", name: "gestion.testing-config.com", listenerId: "l4", locations: ["loc11","loc12","loc13","loc14","loc15","loc16"] },
    { id: "s5", name: "p-airflow.internal", listenerId: "l5", locations: ["loc17"] },
    { id: "s6", name: "p-geoserver.internal", listenerId: "l5", locations: ["loc18"] },
    { id: "s7", name: "p-minio-api.internal", listenerId: "l6", locations: ["loc19"] },
    { id: "s8", name: "p-minio.internal", listenerId: "l5", locations: ["loc20"] },
    { id: "s9", name: "jenkins.tools.internal", listenerId: "l5", locations: ["loc21"] },
    { id: "s10", name: "gitea.tools.internal", listenerId: "l5", locations: ["loc22"] },
    { id: "s11", name: "mantisbt.tools.internal", listenerId: "l5", locations: ["loc23"] },
    { id: "s12", name: "grafana.tools.internal", listenerId: "l5", locations: ["loc24"] },
    { id: "s13", name: "alertmanager.tools.internal", listenerId: "l5", locations: ["loc25"] },
    { id: "s14", name: "stream-proxy", listenerId: "l8", locations: ["loc26"] },
  ],
  locations: [
    { id: "loc1", path: "~ ^/(|validate-connection)$", target: "return 200", type: "return" },
    { id: "loc2", path: "~ ^/(backend/api|crui-invest)/", target: "nodes_backend", type: "upstream" },
    { id: "loc3", path: "~ ^/(|validate-connection)$", target: "return 200", type: "return" },
    { id: "loc4", path: "~ ^/(backend/api|crui-invest)/", target: "nodes_backend", type: "upstream" },
    { id: "loc5", path: "/", target: "nodes_frontend", type: "upstream" },
    { id: "loc6", path: "~ ^/(backend/api|crui-invest)/", target: "nodes_backend", type: "upstream" },
    { id: "loc7", path: "/foncier", target: "m-nodes_frontend", type: "upstream" },
    { id: "loc8", path: "/foncier/api", target: "m-nodes_backend", type: "upstream" },
    { id: "loc9", path: "~* ^/(assets|themes)/", target: "node-signature", type: "direct" },
    { id: "loc10", path: "/esign", target: "node-signature", type: "direct" },
    { id: "loc11", path: "/", target: "nodes_frontend", type: "upstream" },
    { id: "loc12", path: "~ ^/(backend/api|crui-invest)/", target: "nodes_backend", type: "upstream" },
    { id: "loc13", path: "/foncier/api", target: "m-nodes_backend", type: "upstream" },
    { id: "loc14", path: "= /validate-connection", target: "return 200", type: "return" },
    { id: "loc15", path: "/incidents/", target: "mantisbt:8099", type: "direct" },
    { id: "loc16", path: "~* ^/(assets|themes)/", target: "node-signature", type: "direct" },
    { id: "loc17", path: "/", target: "airflow_cluster", type: "upstream" },
    { id: "loc18", path: "/geoserver/", target: "geoserver_cluster", type: "upstream" },
    { id: "loc19", path: "/", target: "minio_s3", type: "upstream" },
    { id: "loc20", path: "/", target: "minio_console", type: "upstream" },
    { id: "loc21", path: "/", target: "jenkins:8090", type: "direct" },
    { id: "loc22", path: "/", target: "gitea:3000", type: "direct" },
    { id: "loc23", path: "/", target: "mantisbt:8099", type: "direct" },
    { id: "loc24", path: "/", target: "grafana:3000", type: "direct" },
    { id: "loc25", path: "/", target: "alertmanager:9093", type: "direct" },
    { id: "loc26", path: "tcp-proxy", target: "192.168.9.100:9443", type: "stream" },
  ],
  upstreams: [
    { id: "u1", name: "nodes_frontend", algo: "least_conn", servers: [
      { addr: "node-01:80" }, { addr: "node-02:80" }, { addr: "node-03:80" }
    ]},
    { id: "u2", name: "nodes_backend", algo: "ip_hash", servers: [
      { addr: "node-01:8080" }, { addr: "node-02:8080" }, { addr: "node-03:8080" }
    ]},
    { id: "u3", name: "m-nodes_frontend", algo: "least_conn", servers: [
      { addr: "m-node-01:80" }, { addr: "m-node-02:80" }
    ]},
    { id: "u4", name: "m-nodes_backend", algo: "ip_hash", servers: [
      { addr: "m-node-01:8080" }, { addr: "m-node-02:8080" }
    ]},
    { id: "u5", name: "airflow_cluster", algo: "ip_hash", servers: [
      { addr: "192.168.14.97:8080" }, { addr: "192.168.14.88:8080" }, { addr: "192.168.14.141:8080" }
    ]},
    { id: "u6", name: "minio_s3", algo: "least_conn", servers: [
      { addr: "p-minio-01:9000" }, { addr: "p-minio-02:9000" }, { addr: "p-minio-03:9000" }, { addr: "p-minio-04:9000" }
    ]},
    { id: "u7", name: "minio_console", algo: "least_conn", servers: [
      { addr: "p-minio-01:9001" }, { addr: "p-minio-02:9001" }, { addr: "p-minio-03:9001" }, { addr: "p-minio-04:9001" }
    ]},
    { id: "u8", name: "geoserver_cluster", algo: "ip_hash", servers: [
      { addr: "192.168.13.210:8080" }, { addr: "192.168.13.219:8080" }
    ]},
  ],
};

const COLORS = {
  bg: "#0a0e17",
  surface: "#111827",
  surfaceHover: "#1a2236",
  border: "#1e293b",
  borderActive: "#3b82f6",
  text: "#e2e8f0",
  textDim: "#64748b",
  textMuted: "#475569",
  listener: { bg: "#0c1a3a", border: "#1d4ed8", accent: "#3b82f6", text: "#93c5fd" },
  server: { bg: "#0a2416", border: "#15803d", accent: "#22c55e", text: "#86efac" },
  location: { bg: "#1a1708", border: "#a16207", accent: "#eab308", text: "#fde68a" },
  upstream: { bg: "#1c0f08", border: "#c2410c", accent: "#f97316", text: "#fed7aa" },
  backend: { bg: "#170e1e", border: "#7e22ce", accent: "#a855f7", text: "#d8b4fe" },
  stream: { bg: "#0c1a2e", border: "#0369a1", accent: "#0ea5e9", text: "#7dd3fc" },
  returnType: { bg: "#1a0a1a", border: "#86198f", accent: "#d946ef", text: "#f0abfc" },
  direct: { bg: "#1a0f0f", border: "#991b1b", accent: "#ef4444", text: "#fca5a5" },
};

function truncate(s, n = 28) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function Badge({ children, color }) {
  return (
    <span style={{
      display: "inline-block",
      fontSize: 9,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      padding: "2px 6px",
      borderRadius: 4,
      background: color + "22",
      color: color,
      border: `1px solid ${color}44`,
    }}>{children}</span>
  );
}

function NodeCard({ title, subtitle, badge, badgeColor, color, icon, active, onClick, small, children }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? color.bg : COLORS.surface,
        border: `1.5px solid ${active ? color.accent : color.border + "60"}`,
        borderRadius: small ? 8 : 10,
        padding: small ? "8px 10px" : "12px 14px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        boxShadow: active ? `0 0 20px ${color.accent}20, inset 0 1px 0 ${color.accent}15` : "0 1px 4px #00000030",
        minWidth: small ? 130 : 180,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {active && <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${color.accent}, transparent)`,
      }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: subtitle ? 4 : 0 }}>
        <span style={{ fontSize: small ? 14 : 16 }}>{icon}</span>
        <span style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: small ? 11 : 12,
          fontWeight: 600,
          color: active ? color.text : COLORS.text,
          whiteSpace: "nowrap",
        }}>{truncate(title, small ? 22 : 30)}</span>
      </div>
      {subtitle && <div style={{
        fontSize: 10,
        color: COLORS.textDim,
        fontFamily: "'JetBrains Mono', monospace",
        marginLeft: small ? 22 : 24,
      }}>{subtitle}</div>}
      {badge && <div style={{ marginTop: 6, marginLeft: small ? 22 : 24 }}><Badge color={badgeColor || color.accent}>{badge}</Badge></div>}
      {children}
    </div>
  );
}

function ConnectionLine({ from, to, color, animated, svgRef }) {
  if (!from || !to || !svgRef) return null;
  const svg = svgRef.getBoundingClientRect();
  const f = from.getBoundingClientRect();
  const t = to.getBoundingClientRect();
  const x1 = f.right - svg.left;
  const y1 = f.top + f.height / 2 - svg.top;
  const x2 = t.left - svg.left;
  const y2 = t.top + t.height / 2 - svg.top;
  const mx = (x1 + x2) / 2;
  const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={animated ? 2 : 1.2}
      strokeOpacity={animated ? 0.8 : 0.2}
      strokeDasharray={animated ? "6 3" : "none"}
      style={animated ? { animation: "dash 1s linear infinite" } : {}}
    />
  );
}

export default function NginxTopology() {
  const [selected, setSelected] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [viewMode, setViewMode] = useState("topology");
  const [filterText, setFilterText] = useState("");
  const nodeRefs = useRef({});
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => forceUpdate(n => n + 1), 100);
    return () => clearTimeout(timer);
  }, [viewMode, selected]);

  const setRef = useCallback((id) => (el) => { nodeRefs.current[id] = el; }, []);
  const config = SAMPLE_CONFIG;

  const select = (type, id) => {
    if (selected === id && selectedType === type) {
      setSelected(null);
      setSelectedType(null);
    } else {
      setSelected(id);
      setSelectedType(type);
    }
  };

  const highlightPath = useMemo(() => {
    if (!selected) return new Set();
    const ids = new Set([selected]);
    if (selectedType === "listener") {
      config.servers.filter(s => s.listenerId === selected).forEach(s => {
        ids.add(s.id);
        s.locations.forEach(lid => {
          ids.add(lid);
          const loc = config.locations.find(l => l.id === lid);
          if (loc?.type === "upstream") {
            const u = config.upstreams.find(u => u.name === loc.target);
            if (u) { ids.add(u.id); u.servers.forEach((_, i) => ids.add(`${u.id}-s${i}`)); }
          }
        });
      });
    } else if (selectedType === "server") {
      const srv = config.servers.find(s => s.id === selected);
      if (srv) {
        ids.add(srv.listenerId);
        srv.locations.forEach(lid => {
          ids.add(lid);
          const loc = config.locations.find(l => l.id === lid);
          if (loc?.type === "upstream") {
            const u = config.upstreams.find(u => u.name === loc.target);
            if (u) { ids.add(u.id); u.servers.forEach((_, i) => ids.add(`${u.id}-s${i}`)); }
          }
        });
      }
    } else if (selectedType === "location") {
      const loc = config.locations.find(l => l.id === selected);
      if (loc) {
        const srv = config.servers.find(s => s.locations.includes(selected));
        if (srv) { ids.add(srv.id); ids.add(srv.listenerId); }
        if (loc.type === "upstream") {
          const u = config.upstreams.find(u => u.name === loc.target);
          if (u) { ids.add(u.id); u.servers.forEach((_, i) => ids.add(`${u.id}-s${i}`)); }
        }
      }
    } else if (selectedType === "upstream") {
      const u = config.upstreams.find(u => u.id === selected);
      if (u) {
        u.servers.forEach((_, i) => ids.add(`${u.id}-s${i}`));
        config.locations.filter(l => l.target === u.name).forEach(l => {
          ids.add(l.id);
          const srv = config.servers.find(s => s.locations.includes(l.id));
          if (srv) { ids.add(srv.id); ids.add(srv.listenerId); }
        });
      }
    }
    return ids;
  }, [selected, selectedType, config]);

  const isActive = (id) => highlightPath.has(id);

  const connections = useMemo(() => {
    const conns = [];
    config.servers.forEach(s => {
      conns.push({ from: s.listenerId, to: s.id, color: COLORS.listener.accent });
      s.locations.forEach(lid => {
        conns.push({ from: s.id, to: lid, color: COLORS.server.accent });
        const loc = config.locations.find(l => l.id === lid);
        if (loc?.type === "upstream") {
          const u = config.upstreams.find(u => u.name === loc.target);
          if (u) conns.push({ from: lid, to: u.id, color: COLORS.upstream.accent });
        }
      });
    });
    return conns;
  }, [config]);

  const stats = useMemo(() => ({
    listeners: new Set(config.listeners.map(l => `${l.ip}:${l.port}`)).size,
    servers: config.servers.length,
    locations: config.locations.length,
    upstreams: config.upstreams.length,
    backends: config.upstreams.reduce((a, u) => a + u.servers.length, 0),
    streamBlocks: config.servers.filter(s => config.listeners.find(l => l.id === s.listenerId)?.protocol === "stream").length,
  }), [config]);

  const filteredServers = filterText
    ? config.servers.filter(s => s.name.toLowerCase().includes(filterText.toLowerCase()))
    : config.servers;

  return (
    <div style={{
      background: COLORS.bg,
      color: COLORS.text,
      minHeight: "100vh",
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes dash { to { stroke-dashoffset: -9; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${COLORS.bg}; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <div style={{
        padding: "20px 28px",
        borderBottom: `1px solid ${COLORS.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
      }}>
        <div>
          <h1 style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            background: "linear-gradient(135deg, #3b82f6, #22c55e)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>Nginx Configuration Topology</h1>
          <p style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>
            Interactive traffic flow visualization — click any node to trace connections
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Filter servers…"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              padding: "6px 12px",
              color: COLORS.text,
              fontSize: 12,
              outline: "none",
              width: 180,
            }}
          />
          {["topology", "matrix", "stats"].map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: `1px solid ${viewMode === m ? COLORS.borderActive : COLORS.border}`,
                background: viewMode === m ? COLORS.borderActive + "20" : COLORS.surface,
                color: viewMode === m ? "#93c5fd" : COLORS.textDim,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >{m}</button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        display: "flex",
        gap: 0,
        borderBottom: `1px solid ${COLORS.border}`,
        overflowX: "auto",
      }}>
        {[
          { label: "Listeners", value: stats.listeners, color: COLORS.listener.accent, icon: "📡" },
          { label: "Servers", value: stats.servers, color: COLORS.server.accent, icon: "🖥" },
          { label: "Locations", value: stats.locations, color: COLORS.location.accent, icon: "📍" },
          { label: "Upstreams", value: stats.upstreams, color: COLORS.upstream.accent, icon: "⬡" },
          { label: "Backends", value: stats.backends, color: COLORS.backend.accent, icon: "●" },
          { label: "Stream", value: stats.streamBlocks, color: COLORS.stream.accent, icon: "🔌" },
        ].map(s => (
          <div key={s.label} style={{
            flex: 1,
            padding: "12px 16px",
            borderRight: `1px solid ${COLORS.border}`,
            minWidth: 100,
          }}>
            <div style={{ fontSize: 10, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {s.icon} {s.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Main content */}
      {viewMode === "topology" && (
        <div ref={containerRef} style={{ position: "relative", overflow: "auto", padding: "24px 20px" }}>
          <svg
            ref={el => { svgRef.current = el; }}
            style={{
              position: "absolute",
              top: 0, left: 0,
              width: "100%", height: "100%",
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            {connections.map((c, i) => (
              <ConnectionLine
                key={i}
                from={nodeRefs.current[c.from]}
                to={nodeRefs.current[c.to]}
                color={c.color}
                animated={isActive(c.from) && isActive(c.to)}
                svgRef={svgRef.current}
              />
            ))}
          </svg>

          <div style={{ display: "flex", gap: 20, position: "relative", zIndex: 1, minWidth: "fit-content" }}>
            {/* Column: Listeners */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 170 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: COLORS.listener.accent, fontWeight: 700, marginBottom: 4 }}>
                Listeners
              </div>
              {config.listeners.map(l => (
                <div key={l.id} ref={setRef(l.id)}>
                  <NodeCard
                    title={`${l.ip}:${l.port}`}
                    badge={l.protocol}
                    badgeColor={l.protocol === "stream" ? COLORS.stream.accent : l.protocol === "https" ? "#22c55e" : COLORS.listener.accent}
                    color={l.protocol === "stream" ? COLORS.stream : COLORS.listener}
                    icon="📡"
                    active={isActive(l.id)}
                    onClick={() => select("listener", l.id)}
                    small
                  />
                </div>
              ))}
            </div>

            {/* Column: Servers */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 220 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: COLORS.server.accent, fontWeight: 700, marginBottom: 4 }}>
                Server Blocks
              </div>
              {filteredServers.map(s => (
                <div key={s.id} ref={setRef(s.id)}>
                  <NodeCard
                    title={s.name}
                    subtitle={`${s.locations.length} location${s.locations.length !== 1 ? "s" : ""}`}
                    color={COLORS.server}
                    icon="🖥"
                    active={isActive(s.id)}
                    onClick={() => select("server", s.id)}
                  />
                </div>
              ))}
            </div>

            {/* Column: Locations */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 230 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: COLORS.location.accent, fontWeight: 700, marginBottom: 4 }}>
                Locations
              </div>
              {config.locations.map(l => (
                <div key={l.id} ref={setRef(l.id)}>
                  <NodeCard
                    title={l.path}
                    subtitle={`→ ${truncate(l.target, 26)}`}
                    badge={l.type}
                    badgeColor={
                      l.type === "upstream" ? COLORS.upstream.accent
                      : l.type === "return" ? COLORS.returnType.accent
                      : l.type === "stream" ? COLORS.stream.accent
                      : COLORS.direct.accent
                    }
                    color={
                      l.type === "return" ? COLORS.returnType
                      : l.type === "stream" ? COLORS.stream
                      : l.type === "direct" ? COLORS.direct
                      : COLORS.location
                    }
                    icon="📍"
                    active={isActive(l.id)}
                    onClick={() => select("location", l.id)}
                    small
                  />
                </div>
              ))}
            </div>

            {/* Column: Upstreams */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: COLORS.upstream.accent, fontWeight: 700, marginBottom: 4 }}>
                Upstreams
              </div>
              {config.upstreams.map(u => (
                <div key={u.id} ref={setRef(u.id)}>
                  <NodeCard
                    title={u.name}
                    subtitle={`${u.servers.length} server${u.servers.length > 1 ? "s" : ""}`}
                    badge={u.algo}
                    color={COLORS.upstream}
                    icon="⬡"
                    active={isActive(u.id)}
                    onClick={() => select("upstream", u.id)}
                  >
                    {isActive(u.id) && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                        {u.servers.map((s, i) => (
                          <div
                            key={i}
                            ref={setRef(`${u.id}-s${i}`)}
                            style={{
                              fontSize: 10,
                              fontFamily: "'JetBrains Mono', monospace",
                              padding: "3px 6px",
                              borderRadius: 4,
                              background: COLORS.backend.bg,
                              border: `1px solid ${COLORS.backend.border}40`,
                              color: COLORS.backend.text,
                            }}
                          >● {s.addr}</div>
                        ))}
                      </div>
                    )}
                  </NodeCard>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {viewMode === "matrix" && (
        <div style={{ padding: 24, overflow: "auto" }}>
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            <thead>
              <tr>
                {["Server", "Listen", "Locations", "Upstreams", "Backends", "SSL", "Logs"].map(h => (
                  <th key={h} style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderBottom: `2px solid ${COLORS.border}`,
                    color: COLORS.textDim,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.servers.map(s => {
                const listener = config.listeners.find(l => l.id === s.listenerId);
                const locs = s.locations.map(lid => config.locations.find(l => l.id === lid)).filter(Boolean);
                const ups = [...new Set(locs.filter(l => l.type === "upstream").map(l => l.target))];
                const backends = ups.flatMap(uName => {
                  const u = config.upstreams.find(u => u.name === uName);
                  return u ? u.servers.map(s => s.addr) : [];
                });
                const hasSSL = listener?.protocol === "https";
                return (
                  <tr key={s.id} style={{
                    borderBottom: `1px solid ${COLORS.border}`,
                    cursor: "pointer",
                    background: isActive(s.id) ? COLORS.server.bg : "transparent",
                  }} onClick={() => select("server", s.id)}>
                    <td style={{ padding: "10px 12px", color: COLORS.server.text, fontWeight: 600 }}>{truncate(s.name, 32)}</td>
                    <td style={{ padding: "10px 12px", color: COLORS.listener.text }}>{listener ? `${listener.ip}:${listener.port}` : "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{locs.length}</td>
                    <td style={{ padding: "10px 12px", color: COLORS.upstream.text }}>{ups.join(", ") || "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{backends.length || "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{hasSSL ? <Badge color="#22c55e">SSL</Badge> : <Badge color={COLORS.textMuted}>HTTP</Badge>}</td>
                    <td style={{ padding: "10px 12px" }}><Badge color={COLORS.textMuted}>default</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === "stats" && (
        <div style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          {/* Upstream breakdown */}
          <div style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: 20,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: COLORS.upstream.text, marginBottom: 16 }}>⬡ Upstream Pools</h3>
            {config.upstreams.map(u => {
              const locCount = config.locations.filter(l => l.target === u.name).length;
              return (
                <div key={u.id} style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: `1px solid ${COLORS.border}`,
                }}>
                  <div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: COLORS.text }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>
                      {u.servers.length} backends · {locCount} location{locCount !== 1 ? "s" : ""} · <Badge color={COLORS.upstream.accent}>{u.algo}</Badge>
                    </div>
                  </div>
                  <div style={{
                    display: "flex",
                    gap: 2,
                  }}>
                    {u.servers.map((_, i) => (
                      <div key={i} style={{
                        width: 8,
                        height: 20,
                        borderRadius: 2,
                        background: COLORS.server.accent,
                        opacity: 0.7,
                      }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Listener breakdown */}
          <div style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: 20,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: COLORS.listener.text, marginBottom: 16 }}>📡 Listener Distribution</h3>
            {config.listeners.map(l => {
              const srvCount = config.servers.filter(s => s.listenerId === l.id).length;
              return (
                <div key={l.id} style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: `1px solid ${COLORS.border}`,
                }}>
                  <div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: COLORS.text }}>
                      {l.ip}:{l.port}
                    </div>
                    <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>
                      <Badge color={l.protocol === "stream" ? COLORS.stream.accent : l.protocol === "https" ? "#22c55e" : COLORS.listener.accent}>{l.protocol}</Badge>
                      {" "}{srvCount} server{srvCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{
                    width: Math.max(srvCount * 18, 18),
                    height: 24,
                    borderRadius: 4,
                    background: `linear-gradient(90deg, ${COLORS.listener.accent}, ${COLORS.server.accent})`,
                    opacity: 0.6,
                  }} />
                </div>
              );
            })}
          </div>

          {/* Gap coverage */}
          <div style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: 20,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fbbf24", marginBottom: 16 }}>⚠ Feature Coverage Gaps</h3>
            {[
              { feature: "HTTP Block Settings", done: false, severity: "CRITICAL" },
              { feature: "Server access_log / error_log", done: false, severity: "CRITICAL" },
              { feature: "client_max_body_size", done: false, severity: "CRITICAL" },
              { feature: "add_header (response)", done: false, severity: "HIGH" },
              { feature: "Proxy Timeouts", done: false, severity: "HIGH" },
              { feature: "Rate Limiting", done: false, severity: "HIGH" },
              { feature: "Gzip / Compression", done: false, severity: "HIGH" },
              { feature: "Stream / L4 Proxy", done: false, severity: "HIGH" },
              { feature: "Proxy Cache", done: false, severity: "HIGH" },
              { feature: "Topology View", done: true, severity: "HIGH" },
              { feature: "Security Headers", done: false, severity: "HIGH" },
              { feature: "map Blocks", done: false, severity: "MEDIUM" },
              { feature: "Nested Locations", done: false, severity: "HIGH" },
            ].map(g => (
              <div key={g.feature} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: `1px solid ${COLORS.border}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14 }}>{g.done ? "✅" : "⬜"}</span>
                  <span style={{ fontSize: 12, color: g.done ? COLORS.textDim : COLORS.text }}>{g.feature}</span>
                </div>
                <Badge color={
                  g.severity === "CRITICAL" ? "#ef4444"
                  : g.severity === "HIGH" ? "#f97316"
                  : "#eab308"
                }>{g.severity}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selection detail panel */}
      {selected && (
        <div style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: COLORS.surface,
          borderTop: `2px solid ${COLORS.borderActive}`,
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 100,
          animation: "fadeIn 0.2s ease",
        }}>
          <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
            <span style={{ color: COLORS.textDim }}>Selected: </span>
            <span style={{ color: COLORS.borderActive, fontWeight: 700 }}>{selectedType}</span>
            <span style={{ color: COLORS.textDim }}> → </span>
            <span style={{ color: COLORS.text }}>{
              selectedType === "listener" ? config.listeners.find(l => l.id === selected)?.ip + ":" + config.listeners.find(l => l.id === selected)?.port
              : selectedType === "server" ? config.servers.find(s => s.id === selected)?.name
              : selectedType === "location" ? config.locations.find(l => l.id === selected)?.path
              : selectedType === "upstream" ? config.upstreams.find(u => u.id === selected)?.name
              : selected
            }</span>
            <span style={{ color: COLORS.textDim, marginLeft: 12 }}>
              {highlightPath.size - 1} connected nodes
            </span>
          </div>
          <button onClick={() => { setSelected(null); setSelectedType(null); }} style={{
            background: "transparent",
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            color: COLORS.textDim,
            padding: "4px 12px",
            fontSize: 11,
            cursor: "pointer",
          }}>Clear</button>
        </div>
      )}
    </div>
  );
}
