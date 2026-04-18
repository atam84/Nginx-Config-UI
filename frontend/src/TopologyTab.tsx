import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { type ConfigFile, type Node } from './api'
import InfoIcon from './InfoIcon'
import './TopologyTab.css'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TabId = 'global' | 'http' | 'upstreams' | 'proxy' | 'stream' | 'topology' | 'raw'

interface TopologyListener {
  id: string
  ip: string
  port: string
  protocol: string
}

interface TopologyServer {
  id: string
  name: string
  listenerId: string
  locations: string[]
}

interface TopologyLocation {
  id: string
  path: string
  target: string
  type: 'upstream' | 'direct' | 'return' | 'stream' | 'static'
}

interface TopologyUpstream {
  id: string
  name: string
  algo: string
  servers: { addr: string }[]
}

interface TopologyData {
  listeners: TopologyListener[]
  servers: TopologyServer[]
  locations: TopologyLocation[]
  upstreams: TopologyUpstream[]
}

interface Props {
  config: ConfigFile | null
  onNavigate: (tab: TabId, nodeId?: string) => void
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const COLORS = {
  bg: '#0a0e17',
  surface: '#111827',
  surfaceHover: '#1a2236',
  border: '#1e293b',
  borderActive: '#3b82f6',
  text: '#e2e8f0',
  textDim: '#64748b',
  textMuted: '#475569',
  listener: { bg: '#0c1a3a', border: '#1d4ed8', accent: '#3b82f6', text: '#93c5fd' },
  server: { bg: '#0a2416', border: '#15803d', accent: '#22c55e', text: '#86efac' },
  location: { bg: '#1a1708', border: '#a16207', accent: '#eab308', text: '#fde68a' },
  upstream: { bg: '#1c0f08', border: '#c2410c', accent: '#f97316', text: '#fed7aa' },
  backend: { bg: '#170e1e', border: '#7e22ce', accent: '#a855f7', text: '#d8b4fe' },
  stream: { bg: '#0c1a2e', border: '#0369a1', accent: '#0ea5e9', text: '#7dd3fc' },
  returnType: { bg: '#1a0a1a', border: '#86198f', accent: '#d946ef', text: '#f0abfc' },
  direct: { bg: '#1a0f0f', border: '#991b1b', accent: '#ef4444', text: '#fca5a5' },
}

// ─── Data conversion ──────────────────────────────────────────────────────────

function findNodes(nodes: Node[], name: string): Node[] {
  const out: Node[] = []
  function walk(n: Node) {
    if (n.type === 'block' && n.name === name) out.push(n)
    for (const c of n.directives ?? []) walk(c)
  }
  for (const n of nodes) walk(n)
  return out
}

function getArg(node: Node | undefined, name: string, idx = 0): string {
  return node?.directives?.find((d) => d.name === name)?.args?.[idx] ?? ''
}

let _idSeq = 0
function uid(prefix: string): string {
  return `${prefix}-${++_idSeq}`
}

function configToTopologyData(config: ConfigFile): TopologyData {
  _idSeq = 0
  const listeners: TopologyListener[] = []
  const servers: TopologyServer[] = []
  const locations: TopologyLocation[] = []
  const upstreams: TopologyUpstream[] = []

  const listenerMap = new Map<string, string>() // "ip:port" -> id

  function getOrCreateListener(ip: string, port: string, protocol: string): string {
    const key = `${ip}:${port}`
    if (listenerMap.has(key)) return listenerMap.get(key)!
    const id = uid('l')
    listeners.push({ id, ip, port, protocol })
    listenerMap.set(key, id)
    return id
  }

  // Process upstreams
  const allUpstreams = findNodes(config.directives ?? [], 'upstream')
  for (const u of allUpstreams) {
    const name = u.args?.[0] ?? ''
    if (!name) continue
    const algo =
      (u.directives ?? []).find((d) => d.name === 'least_conn') ? 'least_conn'
      : (u.directives ?? []).find((d) => d.name === 'ip_hash') ? 'ip_hash'
      : 'round_robin'
    const srvs = (u.directives ?? [])
      .filter((d) => d.name === 'server')
      .map((d) => ({ addr: d.args?.[0] ?? '' }))
      .filter((s) => s.addr)
    upstreams.push({ id: u.id ?? uid('u'), name, algo, servers: srvs })
  }

  const upstreamNames = new Set(upstreams.map((u) => u.name))

  // Process server blocks
  const allServers = findNodes(config.directives ?? [], 'server')
  for (const srv of allServers) {
    const listenDirs = (srv.directives ?? []).filter((d) => d.name === 'listen')
    const serverNameDir = (srv.directives ?? []).find((d) => d.name === 'server_name')
    const serverName = serverNameDir?.args?.[0] ?? '_'

    for (const listenDir of listenDirs) {
      const listenArgs = listenDir.args ?? []
      const raw = listenArgs[0] ?? '80'
      const isSsl = listenArgs.includes('ssl')

      let ip = '0.0.0.0'
      let port = '80'
      if (raw.includes(':')) {
        const parts = raw.split(':')
        ip = parts[0] || '0.0.0.0'
        port = parts[1] || '80'
      } else if (/^\d+$/.test(raw)) {
        port = raw
      } else {
        port = raw
      }

      const protocol = isSsl ? 'https' : 'http'
      const listenerId = getOrCreateListener(ip, port, protocol)

      const locationNodes = (srv.directives ?? []).filter((d) => d.name === 'location')
      const locationIds: string[] = []

      for (const loc of locationNodes) {
        const locPath = loc.args?.[0] ?? '/'
        const proxyPass = getArg(loc, 'proxy_pass')
        const returnDir = (loc.directives ?? []).find((d) => d.name === 'return')
        const rootDir = (loc.directives ?? []).find((d) => d.name === 'root')

        let target = ''
        let locType: TopologyLocation['type'] = 'static'

        if (proxyPass) {
          const normalized = proxyPass.replace(/^https?:\/\//, '')
          if (upstreamNames.has(normalized)) {
            target = normalized
            locType = 'upstream'
          } else {
            target = proxyPass
            locType = 'direct'
          }
        } else if (returnDir) {
          target = 'return ' + (returnDir.args ?? []).join(' ')
          locType = 'return'
        } else if (rootDir) {
          target = rootDir.args?.[0] ?? ''
          locType = 'static'
        }

        const locId = loc.id ?? uid('loc')
        locations.push({ id: locId, path: locPath, target, type: locType })
        locationIds.push(locId)
      }

      servers.push({
        id: srv.id ?? uid('s'),
        name: serverName,
        listenerId,
        locations: locationIds,
      })
    }

    // If no listen directives, add a default listener
    if (listenDirs.length === 0) {
      const listenerId = getOrCreateListener('0.0.0.0', '80', 'http')
      const locationNodes = (srv.directives ?? []).filter((d) => d.name === 'location')
      const locationIds: string[] = []
      for (const loc of locationNodes) {
        const locPath = loc.args?.[0] ?? '/'
        const locId = loc.id ?? uid('loc')
        locations.push({ id: locId, path: locPath, target: '', type: 'static' })
        locationIds.push(locId)
      }
      servers.push({
        id: srv.id ?? uid('s'),
        name: serverName,
        listenerId,
        locations: locationIds,
      })
    }
  }

  // Also check stream block
  const streamBlock = (config.directives ?? []).find((d) => d.name === 'stream')
  if (streamBlock) {
    const streamServers = (streamBlock.directives ?? []).filter((d) => d.name === 'server')
    for (const srv of streamServers) {
      const listenDir = (srv.directives ?? []).find((d) => d.name === 'listen')
      const raw = listenDir?.args?.[0] ?? '443'
      let ip = '0.0.0.0'
      let port = raw
      if (raw.includes(':')) {
        const parts = raw.split(':')
        ip = parts[0] || '0.0.0.0'
        port = parts[1] || raw
      }
      const listenerId = getOrCreateListener(ip, port, 'stream')
      const proxyPassDir = (srv.directives ?? []).find((d) => d.name === 'proxy_pass')
      const target = proxyPassDir?.args?.[0] ?? ''
      const locId = srv.id ? srv.id + '-loc' : uid('loc')
      locations.push({ id: locId, path: 'tcp-proxy', target, type: 'stream' })
      servers.push({
        id: srv.id ?? uid('s'),
        name: 'stream-proxy',
        listenerId,
        locations: [locId],
      })
    }
  }

  return { listeners, servers, locations, upstreams }
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function truncate(s: string, n = 28): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 9,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      padding: '2px 6px',
      borderRadius: 4,
      background: color + '22',
      color: color,
      border: `1px solid ${color}44`,
    }}>{children}</span>
  )
}

interface NodeCardProps {
  title: string
  subtitle?: string
  badge?: string
  badgeColor?: string
  color: typeof COLORS.listener
  icon: string
  active: boolean
  onClick: () => void
  onDoubleClick?: () => void
  tooltip?: string
  small?: boolean
  children?: React.ReactNode
}

function NodeCard({ title, subtitle, badge, badgeColor, color, icon, active, onClick, onDoubleClick, tooltip, small, children }: NodeCardProps) {
  return (
    <div
      onClick={(e) => { if (e.detail >= 2) return; onClick() }}
      onDoubleClick={onDoubleClick}
      title={tooltip}
      style={{
        background: active ? color.bg : COLORS.surface,
        border: `1.5px solid ${active ? color.accent : color.border + '60'}`,
        borderRadius: small ? 8 : 10,
        padding: small ? '8px 10px' : '12px 14px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: active ? `0 0 20px ${color.accent}20, inset 0 1px 0 ${color.accent}15` : '0 1px 4px #00000030',
        minWidth: small ? 130 : 180,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {active && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent, ${color.accent}, transparent)`,
        }} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: subtitle ? 4 : 0 }}>
        <span style={{ fontSize: small ? 14 : 16 }}>{icon}</span>
        <span style={{
          fontFamily: 'monospace',
          fontSize: small ? 11 : 12,
          fontWeight: 600,
          color: active ? color.text : COLORS.text,
          whiteSpace: 'nowrap',
        }}>{truncate(title, small ? 22 : 30)}</span>
      </div>
      {subtitle && (
        <div style={{ fontSize: 10, color: COLORS.textDim, fontFamily: 'monospace', marginLeft: small ? 22 : 24 }}>
          {subtitle}
        </div>
      )}
      {badge && (
        <div style={{ marginTop: 6, marginLeft: small ? 22 : 24 }}>
          <Badge color={badgeColor || color.accent}>{badge}</Badge>
        </div>
      )}
      {children}
    </div>
  )
}

interface ConnectionLineProps {
  from: Element | null
  to: Element | null
  color: string
  animated: boolean
  svgEl: SVGSVGElement | null
}

function ConnectionLine({ from, to, color, animated, svgEl }: ConnectionLineProps) {
  if (!from || !to || !svgEl) return null
  const svg = svgEl.getBoundingClientRect()
  const f = from.getBoundingClientRect()
  const t = to.getBoundingClientRect()
  const x1 = f.right - svg.left
  const y1 = f.top + f.height / 2 - svg.top
  const x2 = t.left - svg.left
  const y2 = t.top + t.height / 2 - svg.top
  const mx = (x1 + x2) / 2
  const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={animated ? 2 : 1.2}
      strokeOpacity={animated ? 0.8 : 0.2}
      strokeDasharray={animated ? '6 3' : undefined}
      style={animated ? { animation: 'topology-dash 1s linear infinite' } : {}}
    />
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TopologyTab({ config, onNavigate }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'topology' | 'matrix' | 'stats'>('topology')
  const [filterText, setFilterText] = useState('')
  const [yOffsets, setYOffsets] = useState<Record<string, number>>({})
  const [colGap, setColGap] = useState(48)
  const [rowGap, setRowGap] = useState(28)
  const nodeRefs = useRef<Record<string, Element | null>>({})
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ id: string; startY: number; startOffset: number } | null>(null)
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => forceUpdate((n) => n + 1), 100)
    return () => clearTimeout(timer)
  }, [viewMode, selected, colGap, rowGap])

  const onGripPointerDown = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    dragRef.current = { id, startY: e.clientY, startOffset: yOffsets[id] ?? 0 }
  }
  const onGripPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const { id, startY, startOffset } = dragRef.current
    setYOffsets((prev) => ({ ...prev, [id]: startOffset + (e.clientY - startY) }))
  }
  const onGripPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId) } catch { /* noop */ }
    dragRef.current = null
  }
  const resetLayout = () => { setYOffsets({}); setColGap(48); setRowGap(28) }
  const layoutTouched = Object.keys(yOffsets).length > 0 || colGap !== 48 || rowGap !== 28

  const setRef = useCallback((id: string) => (el: Element | null) => {
    nodeRefs.current[id] = el
  }, [])

  const topologyData = useMemo(() => {
    if (!config) return { listeners: [], servers: [], locations: [], upstreams: [] }
    return configToTopologyData(config)
  }, [config])

  const select = (type: string, id: string) => {
    if (selected === id && selectedType === type) {
      setSelected(null)
      setSelectedType(null)
    } else {
      setSelected(id)
      setSelectedType(type)
    }
  }

  const cardHandlers = (type: string, id: string, navigateTo?: TabId) => ({
    onClick: () => select(type, id),
    onDoubleClick: navigateTo
      ? () => { if (selected !== id || selectedType !== type) { setSelected(id); setSelectedType(type) } onNavigate(navigateTo, id) }
      : undefined,
  })

  const highlightPath = useMemo(() => {
    if (!selected) return new Set<string>()
    const ids = new Set<string>([selected])
    if (selectedType === 'listener') {
      topologyData.servers.filter((s) => s.listenerId === selected).forEach((s) => {
        ids.add(s.id)
        s.locations.forEach((lid) => {
          ids.add(lid)
          const loc = topologyData.locations.find((l) => l.id === lid)
          if (loc?.type === 'upstream') {
            const u = topologyData.upstreams.find((u) => u.name === loc.target)
            if (u) { ids.add(u.id); u.servers.forEach((_, i) => ids.add(`${u.id}-s${i}`)) }
          }
        })
      })
    } else if (selectedType === 'server') {
      const srv = topologyData.servers.find((s) => s.id === selected)
      if (srv) {
        ids.add(srv.listenerId)
        srv.locations.forEach((lid) => {
          ids.add(lid)
          const loc = topologyData.locations.find((l) => l.id === lid)
          if (loc?.type === 'upstream') {
            const u = topologyData.upstreams.find((u) => u.name === loc.target)
            if (u) { ids.add(u.id); u.servers.forEach((_, i) => ids.add(`${u.id}-s${i}`)) }
          }
        })
      }
    } else if (selectedType === 'location') {
      const loc = topologyData.locations.find((l) => l.id === selected)
      if (loc) {
        const srv = topologyData.servers.find((s) => s.locations.includes(selected))
        if (srv) { ids.add(srv.id); ids.add(srv.listenerId) }
        if (loc.type === 'upstream') {
          const u = topologyData.upstreams.find((u) => u.name === loc.target)
          if (u) { ids.add(u.id); u.servers.forEach((_, i) => ids.add(`${u.id}-s${i}`)) }
        }
      }
    } else if (selectedType === 'upstream') {
      const u = topologyData.upstreams.find((u) => u.id === selected)
      if (u) {
        u.servers.forEach((_, i) => ids.add(`${u.id}-s${i}`))
        topologyData.locations.filter((l) => l.target === u.name).forEach((l) => {
          ids.add(l.id)
          const srv = topologyData.servers.find((s) => s.locations.includes(l.id))
          if (srv) { ids.add(srv.id); ids.add(srv.listenerId) }
        })
      }
    }
    return ids
  }, [selected, selectedType, topologyData])

  const isActive = (id: string) => highlightPath.has(id)

  const connections = useMemo(() => {
    const conns: { from: string; to: string; color: string }[] = []
    topologyData.servers.forEach((s) => {
      conns.push({ from: s.listenerId, to: s.id, color: COLORS.listener.accent })
      s.locations.forEach((lid) => {
        conns.push({ from: s.id, to: lid, color: COLORS.server.accent })
        const loc = topologyData.locations.find((l) => l.id === lid)
        if (loc?.type === 'upstream') {
          const u = topologyData.upstreams.find((u) => u.name === loc.target)
          if (u) conns.push({ from: lid, to: u.id, color: COLORS.upstream.accent })
        }
      })
    })
    return conns
  }, [topologyData])

  const stats = useMemo(() => ({
    listeners: new Set(topologyData.listeners.map((l) => `${l.ip}:${l.port}`)).size,
    servers: topologyData.servers.length,
    locations: topologyData.locations.length,
    upstreams: topologyData.upstreams.length,
    backends: topologyData.upstreams.reduce((a, u) => a + u.servers.length, 0),
    streamBlocks: topologyData.servers.filter((s) => topologyData.listeners.find((l) => l.id === s.listenerId)?.protocol === 'stream').length,
  }), [topologyData])

  const filteredServers = filterText
    ? topologyData.servers.filter((s) => s.name.toLowerCase().includes(filterText.toLowerCase()))
    : topologyData.servers

  const DraggableCardWrapper = ({ id, children }: { id: string; children: React.ReactNode }) => (
    <div
      ref={(el) => { nodeRefs.current[id] = el }}
      className="topology-draggable"
      style={yOffsets[id] ? { transform: `translateY(${yOffsets[id]}px)` } : undefined}
    >
      <div
        className="topology-grip"
        title="Drag to move this card vertically"
        onPointerDown={onGripPointerDown(id)}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onPointerCancel={onGripPointerUp}
      >
        <span>⋮⋮</span>
      </div>
      {children}
    </div>
  )

  if (!config) {
    return (
      <div className="topology-empty">
        Load a config file to see the topology view.
      </div>
    )
  }

  if (topologyData.servers.length === 0 && topologyData.upstreams.length === 0) {
    return (
      <div className="topology-empty">
        No server blocks or upstreams found in this config file.
      </div>
    )
  }

  return (
    <div className="topology-root">
      <style>{`
        @keyframes topology-dash { to { stroke-dashoffset: -9; } }
      `}</style>

      {/* Header */}
      <div className="topology-header">
        <div>
          <h2 className="topology-title">Configuration Topology</h2>
          <p className="topology-subtitle">Click a node to trace its full traffic path · Double-click to open it · Drag the ⋮⋮ handle to reposition a card</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Filter servers…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="topology-filter-input"
          />
          {(['topology', 'matrix', 'stats'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`topology-view-btn${viewMode === m ? ' active' : ''}`}
            >{m}</button>
          ))}
          {viewMode === 'topology' && (
            <>
              <label className="topology-spacing" title="Horizontal gap between columns (Listeners → Servers → Locations → Upstreams)">
                <span>Cols</span>
                <input
                  type="range"
                  min={16}
                  max={160}
                  step={4}
                  value={colGap}
                  onChange={(e) => setColGap(Number(e.target.value))}
                />
                <span className="topology-spacing-val">{colGap}</span>
              </label>
              <label className="topology-spacing" title="Vertical gap between cards within a column">
                <span>Rows</span>
                <input
                  type="range"
                  min={8}
                  max={80}
                  step={2}
                  value={rowGap}
                  onChange={(e) => setRowGap(Number(e.target.value))}
                />
                <span className="topology-spacing-val">{rowGap}</span>
              </label>
              {layoutTouched && (
                <button
                  onClick={resetLayout}
                  className="topology-view-btn"
                  title="Clear manual offsets and restore default spacing"
                >Reset layout</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="topology-stats-bar">
        {[
          { label: 'Listeners', value: stats.listeners, color: COLORS.listener.accent },
          { label: 'Servers', value: stats.servers, color: COLORS.server.accent },
          { label: 'Locations', value: stats.locations, color: COLORS.location.accent },
          { label: 'Upstreams', value: stats.upstreams, color: COLORS.upstream.accent },
          { label: 'Backends', value: stats.backends, color: COLORS.backend.accent },
          { label: 'Stream', value: stats.streamBlocks, color: COLORS.stream.accent },
        ].map((s) => (
          <div key={s.label} className="topology-stat-cell">
            <div className="topology-stat-label">{s.label}</div>
            <div className="topology-stat-value" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Topology view */}
      {viewMode === 'topology' && (
        <div className="topology-canvas-wrap">
          <svg
            ref={(el) => { svgRef.current = el }}
            className="topology-svg"
          >
            {connections.map((c, i) => (
              <ConnectionLine
                key={i}
                from={nodeRefs.current[c.from] ?? null}
                to={nodeRefs.current[c.to] ?? null}
                color={c.color}
                animated={isActive(c.from) && isActive(c.to)}
                svgEl={svgRef.current}
              />
            ))}
          </svg>

          <div className="topology-columns" style={{ gap: colGap }}>
            {/* Listeners */}
            <div className="topology-column" style={{ gap: rowGap }}>
              <div className="topology-col-header" style={{ color: COLORS.listener.accent }}>
                Listeners
                <InfoIcon text="Sockets where nginx accepts connections (from each server block's `listen` directive). Shows IP:port plus protocol — http, https (with ssl), or stream (TCP/UDP). Click to see every server that binds to this listener." />
              </div>
              {topologyData.listeners.map((l) => (
                <DraggableCardWrapper key={l.id} id={l.id}>
                  <NodeCard
                    title={`${l.ip === '0.0.0.0' ? '*' : l.ip}:${l.port}`}
                    badge={l.protocol}
                    badgeColor={l.protocol === 'stream' ? COLORS.stream.accent : l.protocol === 'https' ? '#22c55e' : COLORS.listener.accent}
                    color={l.protocol === 'stream' ? COLORS.stream : COLORS.listener}
                    icon="S"
                    active={isActive(l.id)}
                    tooltip="Listener — click to highlight every server bound to this IP:port."
                    {...cardHandlers('listener', l.id)}
                    small
                  />
                </DraggableCardWrapper>
              ))}
            </div>

            {/* Servers */}
            <div className="topology-column" style={{ gap: rowGap }}>
              <div className="topology-col-header" style={{ color: COLORS.server.accent }}>
                Server Blocks
                <InfoIcon text="An http `server { }` block. Matches an incoming request by listen + server_name, then dispatches to its `location` blocks. Double-click to open this server in the Proxy Hosts tab." />
              </div>
              {filteredServers.map((s) => (
                <DraggableCardWrapper key={s.id} id={s.id}>
                  <NodeCard
                    title={s.name}
                    subtitle={`${s.locations.length} location${s.locations.length !== 1 ? 's' : ''}`}
                    color={COLORS.server}
                    icon="H"
                    active={isActive(s.id)}
                    tooltip="Server block — click to trace its path, double-click to edit."
                    {...cardHandlers('server', s.id, 'proxy')}
                  />
                </DraggableCardWrapper>
              ))}
            </div>

            {/* Locations */}
            <div className="topology-column" style={{ gap: rowGap }}>
              <div className="topology-col-header" style={{ color: COLORS.location.accent }}>
                Locations
                <InfoIcon text="A `location` block inside a server. Decides how requests matching a URL pattern are handled — `proxy_pass` to an upstream or URL, `return` a status, serve a static `root`, etc. Badge shows the routing type." />
              </div>
              {topologyData.locations.map((l) => (
                <DraggableCardWrapper key={l.id} id={l.id}>
                  <NodeCard
                    title={l.path}
                    subtitle={l.target ? `→ ${truncate(l.target, 26)}` : undefined}
                    badge={l.type}
                    badgeColor={
                      l.type === 'upstream' ? COLORS.upstream.accent
                      : l.type === 'return' ? COLORS.returnType.accent
                      : l.type === 'stream' ? COLORS.stream.accent
                      : COLORS.direct.accent
                    }
                    color={
                      l.type === 'return' ? COLORS.returnType
                      : l.type === 'stream' ? COLORS.stream
                      : l.type === 'direct' ? COLORS.direct
                      : COLORS.location
                    }
                    icon="L"
                    active={isActive(l.id)}
                    tooltip="Location — click to see the parent server and downstream target."
                    {...cardHandlers('location', l.id, 'proxy')}
                    small
                  />
                </DraggableCardWrapper>
              ))}
            </div>

            {/* Upstreams */}
            {topologyData.upstreams.length > 0 && (
              <div className="topology-column" style={{ gap: rowGap }}>
                <div className="topology-col-header" style={{ color: COLORS.upstream.accent }}>
                  Upstreams
                  <InfoIcon text="A named backend pool (`upstream { }`). Locations reach it via `proxy_pass http://<name>`. Badge shows the load-balancing algorithm (round robin, least_conn, ip_hash, …). Double-click to open the Upstreams tab." />
                </div>
                {topologyData.upstreams.map((u) => (
                  <DraggableCardWrapper key={u.id} id={u.id}>
                    <NodeCard
                      title={u.name}
                      subtitle={`${u.servers.length} server${u.servers.length > 1 ? 's' : ''}`}
                      badge={u.algo}
                      color={COLORS.upstream}
                      icon="U"
                      active={isActive(u.id)}
                      tooltip="Upstream — click to highlight every location that proxies to this pool."
                      {...cardHandlers('upstream', u.id, 'upstreams')}
                    >
                      {isActive(u.id) && (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {u.servers.map((s, i) => (
                            <div
                              key={i}
                              ref={(el) => { nodeRefs.current[`${u.id}-s${i}`] = el }}
                              style={{
                                fontSize: 10,
                                fontFamily: 'monospace',
                                padding: '3px 6px',
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
                  </DraggableCardWrapper>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Matrix view */}
      {viewMode === 'matrix' && (
        <div className="topology-matrix-wrap">
          <table className="topology-matrix-table">
            <thead>
              <tr>
                {['Server', 'Listen', 'Locations', 'Upstreams', 'Backends', 'SSL'].map((h) => (
                  <th key={h} className="topology-matrix-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topologyData.servers.map((s) => {
                const listener = topologyData.listeners.find((l) => l.id === s.listenerId)
                const locs = s.locations.map((lid) => topologyData.locations.find((l) => l.id === lid)).filter(Boolean) as TopologyLocation[]
                const ups = [...new Set(locs.filter((l) => l.type === 'upstream').map((l) => l.target))]
                const backends = ups.flatMap((uName) => {
                  const u = topologyData.upstreams.find((u) => u.name === uName)
                  return u ? u.servers.map((s) => s.addr) : []
                })
                const hasSSL = listener?.protocol === 'https'
                return (
                  <tr
                    key={s.id}
                    className="topology-matrix-row"
                    style={{ background: isActive(s.id) ? COLORS.server.bg : 'transparent' }}
                    onClick={() => select('server', s.id)}
                  >
                    <td style={{ padding: '10px 12px', color: COLORS.server.text, fontWeight: 600 }}>
                      {truncate(s.name, 32)}
                    </td>
                    <td style={{ padding: '10px 12px', color: COLORS.listener.text }}>
                      {listener ? `${listener.ip === '0.0.0.0' ? '*' : listener.ip}:${listener.port}` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>{locs.length}</td>
                    <td style={{ padding: '10px 12px', color: COLORS.upstream.text }}>{ups.join(', ') || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>{backends.length || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {hasSSL ? <Badge color="#22c55e">SSL</Badge> : <Badge color={COLORS.textMuted}>HTTP</Badge>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Stats view */}
      {viewMode === 'stats' && (
        <div className="topology-stats-grid">
          {/* Upstream breakdown */}
          <div className="topology-stats-card">
            <h3 style={{ fontSize: 14, fontWeight: 700, color: COLORS.upstream.text, marginBottom: 16 }}>
              Upstream Pools
            </h3>
            {topologyData.upstreams.length === 0 && (
              <div style={{ color: COLORS.textDim, fontSize: 12 }}>No upstreams configured.</div>
            )}
            {topologyData.upstreams.map((u) => {
              const locCount = topologyData.locations.filter((l) => l.target === u.name).length
              return (
                <div key={u.id} className="topology-stats-row">
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: COLORS.text }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>
                      {u.servers.length} backends · {locCount} location{locCount !== 1 ? 's' : ''} ·{' '}
                      <Badge color={COLORS.upstream.accent}>{u.algo}</Badge>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {u.servers.map((_, i) => (
                      <div key={i} style={{ width: 8, height: 20, borderRadius: 2, background: COLORS.server.accent, opacity: 0.7 }} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Listener breakdown */}
          <div className="topology-stats-card">
            <h3 style={{ fontSize: 14, fontWeight: 700, color: COLORS.listener.text, marginBottom: 16 }}>
              Listener Distribution
            </h3>
            {topologyData.listeners.map((l) => {
              const srvCount = topologyData.servers.filter((s) => s.listenerId === l.id).length
              return (
                <div key={l.id} className="topology-stats-row">
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: COLORS.text }}>
                      {l.ip === '0.0.0.0' ? '*' : l.ip}:{l.port}
                    </div>
                    <div style={{ fontSize: 10, color: COLORS.textDim, marginTop: 2 }}>
                      <Badge color={l.protocol === 'stream' ? COLORS.stream.accent : l.protocol === 'https' ? '#22c55e' : COLORS.listener.accent}>
                        {l.protocol}
                      </Badge>{' '}
                      {srvCount} server{srvCount !== 1 ? 's' : ''}
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
              )
            })}
          </div>
        </div>
      )}

      {/* Selection detail panel */}
      {selected && (
        <div className="topology-selection-bar">
          <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
            <span style={{ color: COLORS.textDim }}>Selected: </span>
            <span style={{ color: COLORS.borderActive, fontWeight: 700 }}>{selectedType}</span>
            <span style={{ color: COLORS.textDim }}> → </span>
            <span style={{ color: COLORS.text }}>
              {selectedType === 'listener' && (() => {
                const l = topologyData.listeners.find((l) => l.id === selected)
                return l ? `${l.ip}:${l.port}` : selected
              })()}
              {selectedType === 'server' && topologyData.servers.find((s) => s.id === selected)?.name}
              {selectedType === 'location' && topologyData.locations.find((l) => l.id === selected)?.path}
              {selectedType === 'upstream' && topologyData.upstreams.find((u) => u.id === selected)?.name}
            </span>
            <span style={{ color: COLORS.textDim, marginLeft: 12 }}>{highlightPath.size - 1} connected nodes</span>
          </div>
          <button
            onClick={() => { setSelected(null); setSelectedType(null) }}
            className="topology-clear-btn"
          >Clear</button>
        </div>
      )}
    </div>
  )
}
