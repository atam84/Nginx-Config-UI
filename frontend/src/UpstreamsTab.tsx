import { useState } from 'react'
import { type ConfigFile, type Node } from './api'
import {
  replaceNodeById,
  moveNodeInParent,
  duplicateNode,
  removeNodeById,
  addUpstreamToConfig,
} from './configUtils'
import BlockContextMenu, { type BlockAction } from './BlockContextMenu'
import InfoIcon from './InfoIcon'
import './UpstreamsTab.css'

interface Props {
  upstreams: Node[]
  servers?: Node[]
  config: ConfigFile
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  onAddProxyHost?: (upstreamName?: string) => void
  readOnly?: boolean
}

function serverTitle(server: Node): string {
  const names = (server.directives ?? []).find((d) => d.name === 'server_name')?.args ?? []
  if (names.length > 0) return names[0]
  const listen = (server.directives ?? []).find((d) => d.name === 'listen')?.args?.[0]
  return listen || 'unnamed proxy host'
}

function linksUpstream(server: Node, upstreamName: string): boolean {
  const locations = (server.directives ?? []).filter((d) => d.name === 'location')
  for (const loc of locations) {
    const proxyPass = (loc.directives ?? []).find((d) => d.name === 'proxy_pass')?.args?.[0] ?? ''
    const normalized = proxyPass.replace(/^https?:\/\//, '')
    if (normalized === upstreamName || proxyPass === upstreamName) return true
  }
  return false
}

function getServerDirectives(up: Node): Node[] {
  return (up.directives ?? []).filter((d) => d.name === 'server')
}

type AlgoType = 'round_robin' | 'least_conn' | 'ip_hash' | 'hash' | 'random' | 'least_time' | 'queue' | 'ntlm'

function getAlgo(up: Node): AlgoType {
  if (up.directives?.some((d) => d.name === 'least_conn')) return 'least_conn'
  if (up.directives?.some((d) => d.name === 'ip_hash')) return 'ip_hash'
  if (up.directives?.some((d) => d.name === 'random')) return 'random'
  if (up.directives?.some((d) => d.name === 'least_time')) return 'least_time'
  if (up.directives?.some((d) => d.name === 'queue')) return 'queue'
  if (up.directives?.some((d) => d.name === 'ntlm')) return 'ntlm'
  const hashDir = up.directives?.find((d) => d.name === 'hash')
  if (hashDir) return 'hash'
  return 'round_robin'
}

function getHashKey(up: Node): string {
  const hashDir = up.directives?.find((d) => d.name === 'hash')
  return hashDir?.args?.[0] ?? '$request_uri'
}

function getHashConsistent(up: Node): boolean {
  const hashDir = up.directives?.find((d) => d.name === 'hash')
  return hashDir?.args?.includes('consistent') ?? false
}

function getKeepalive(up: Node): string {
  const k = up.directives?.find((d) => d.name === 'keepalive')
  return k?.args?.[0] ?? ''
}

function getZone(up: Node): { name: string; size: string } {
  const z = up.directives?.find((d) => d.name === 'zone')
  return { name: z?.args?.[0] ?? '', size: z?.args?.[1] ?? '' }
}

/**
 * §54.4 — parse health_check's kw=value arguments. Returns all known fields
 * plus a `matchName` that references a top-level `match { }` block for
 * response-body / header assertions. An empty name means no active health
 * check is configured on this upstream.
 */
interface HealthCheckArgs {
  enabled: boolean
  interval: string
  fails: string
  passes: string
  uri: string
  matchName: string
  port: string
  type: string // '' (http — default) | 'grpc' | 'udp' | 'tcp' — only http is widely used
  mandatory: boolean
  persistent: boolean
}

function getHealthCheck(up: Node): HealthCheckArgs {
  const dir = up.directives?.find((d) => d.name === 'health_check')
  const res: HealthCheckArgs = {
    enabled: !!dir,
    interval: '', fails: '', passes: '', uri: '', matchName: '',
    port: '', type: '', mandatory: false, persistent: false,
  }
  if (!dir) return res
  for (const a of dir.args ?? []) {
    if (a.startsWith('interval=')) res.interval = a.slice(9)
    else if (a.startsWith('fails=')) res.fails = a.slice(6)
    else if (a.startsWith('passes=')) res.passes = a.slice(7)
    else if (a.startsWith('uri=')) res.uri = a.slice(4)
    else if (a.startsWith('match=')) res.matchName = a.slice(6)
    else if (a.startsWith('port=')) res.port = a.slice(5)
    else if (a.startsWith('type=')) res.type = a.slice(5)
    else if (a === 'mandatory') res.mandatory = true
    else if (a === 'persistent') res.persistent = true
  }
  return res
}

function buildHealthCheckArgs(hc: HealthCheckArgs): string[] {
  if (!hc.enabled) return []
  const a: string[] = []
  if (hc.interval) a.push(`interval=${hc.interval}`)
  if (hc.fails) a.push(`fails=${hc.fails}`)
  if (hc.passes) a.push(`passes=${hc.passes}`)
  if (hc.uri) a.push(`uri=${hc.uri}`)
  if (hc.matchName) a.push(`match=${hc.matchName}`)
  if (hc.port) a.push(`port=${hc.port}`)
  if (hc.type) a.push(`type=${hc.type}`)
  if (hc.mandatory) a.push('mandatory')
  if (hc.persistent) a.push('persistent')
  return a
}

interface MatchBlock {
  id?: string
  name: string
  status: string   // e.g. "200", "200-399", "! 500"
  bodyPattern: string // body ~ "regex"
  headers: { name: string; pattern: string }[]
}

/** Read every match { } block at the http-level (sibling of upstream). */
function getMatchBlocks(http: Node | undefined): MatchBlock[] {
  if (!http) return []
  const out: MatchBlock[] = []
  for (const d of http.directives ?? []) {
    if (d.type === 'block' && d.name === 'match') {
      const name = d.args?.[0] ?? ''
      const m: MatchBlock = { id: d.id, name, status: '', bodyPattern: '', headers: [] }
      for (const dd of d.directives ?? []) {
        if (dd.name === 'status' && dd.args && dd.args.length) m.status = dd.args.join(' ')
        else if (dd.name === 'body' && dd.args && dd.args.length >= 2 && dd.args[0] === '~') {
          m.bodyPattern = dd.args.slice(1).join(' ')
        }
        else if (dd.name === 'header' && dd.args && dd.args.length) {
          const parts = dd.args.join(' ').match(/^(\S+)\s*~\s*(.*)$/)
          if (parts) m.headers.push({ name: parts[1], pattern: parts[2] })
          else m.headers.push({ name: dd.args[0], pattern: dd.args.slice(1).join(' ') })
        }
      }
      out.push(m)
    }
  }
  return out
}

interface ServerArgs {
  addr: string
  weight?: string
  maxFails?: string
  failTimeout?: string
  slowStart?: string
  maxConns?: string
  backup: boolean
  down: boolean
  resolve: boolean
}

function parseServerArgs(args: string[]): ServerArgs {
  let addr = args[0] ?? ''
  let weight: string | undefined
  let maxFails: string | undefined
  let failTimeout: string | undefined
  let slowStart: string | undefined
  let maxConns: string | undefined
  let backup = false
  let down = false
  let resolve = false
  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('weight=')) weight = a.slice(7)
    else if (a.startsWith('max_fails=')) maxFails = a.slice(10)
    else if (a.startsWith('fail_timeout=')) failTimeout = a.slice(13)
    else if (a.startsWith('slow_start=')) slowStart = a.slice(11)
    else if (a.startsWith('max_conns=')) maxConns = a.slice(10)
    else if (a === 'backup') backup = true
    else if (a === 'down') down = true
    else if (a === 'resolve') resolve = true
  }
  return { addr, weight, maxFails, failTimeout, slowStart, maxConns, backup, down, resolve }
}

function buildServerArgs(s: ServerArgs): string[] {
  const a = [s.addr]
  if (s.weight) a.push(`weight=${s.weight}`)
  if (s.maxFails) a.push(`max_fails=${s.maxFails}`)
  if (s.failTimeout) a.push(`fail_timeout=${s.failTimeout}`)
  if (s.slowStart) a.push(`slow_start=${s.slowStart}`)
  if (s.maxConns) a.push(`max_conns=${s.maxConns}`)
  if (s.backup) a.push('backup')
  if (s.down) a.push('down')
  if (s.resolve) a.push('resolve')
  return a
}

function findUpstreamIndex(config: ConfigFile, up: Node): { index: number; total: number } | null {
  const http = config.directives?.find((d) => d.name === 'http' && d.type === 'block')
  const siblings = http?.directives ?? []
  const idx = siblings.findIndex((s) => s.id === up.id)
  if (idx < 0) return null
  return { index: idx, total: siblings.length }
}

export default function UpstreamsTab({ upstreams, servers = [], config, onUpdate, onAddProxyHost, readOnly }: Props) {
  const [newServerAddrByUpstream, setNewServerAddrByUpstream] = useState<Record<string, string>>({})
  const [draggedIndex, setDraggedIndex] = useState<{ upId: string; i: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ up: Node; x: number; y: number } | null>(null)
  // Upstream card collapse state; default expanded (undefined → open).
  const [collapsedUpstream, setCollapsedUpstream] = useState<Record<string, boolean>>({})

  const getNewServerAddr = (upId: string) => newServerAddrByUpstream[upId] ?? ''
  const setNewServerAddr = (upId: string, v: string) =>
    setNewServerAddrByUpstream((prev) => ({ ...prev, [upId]: v }))

  const addUpstream = () => {
    const newUpstream: Node = {
      type: 'block',
      name: 'upstream',
      args: ['backend'],
      enabled: true,
      id: `upstream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      directives: [],
    }
    onUpdate((c) => addUpstreamToConfig(c, newUpstream))
  }

  const addRecommendedUpstream = () => {
    const newUpstream: Node = {
      type: 'block',
      name: 'upstream',
      args: ['backend'],
      enabled: true,
      id: `upstream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      directives: [
        { type: 'directive', name: 'least_conn', args: [], enabled: true },
        { type: 'directive', name: 'keepalive', args: ['32'], enabled: true },
        { type: 'directive', name: 'keepalive_requests', args: ['1000'], enabled: true },
        { type: 'directive', name: 'keepalive_timeout', args: ['60s'], enabled: true },
      ],
    }
    onUpdate((c) => addUpstreamToConfig(c, newUpstream))
  }

  if (upstreams.length === 0) {
    return (
      <div className="upstreams-empty">
        <p>No upstream blocks in this config. Upstreams are typically defined inside the http block.</p>
        {!readOnly && (
          <div className="upstreams-empty-actions">
            <button type="button" className="btn-add-upstream" onClick={addUpstream}>
              + Add upstream
            </button>
            {onAddProxyHost && (
              <button type="button" className="btn-add-proxy" onClick={onAddProxyHost}>
                + Add server (proxy_pass…)
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const updateUpstream = (upId: string | undefined, fn: (u: Node) => Node) => {
    onUpdate((c) => replaceNodeById(c, upId, fn))
  }

  const ALGO_DIRECTIVES: AlgoType[] = ['least_conn', 'ip_hash', 'hash', 'random', 'least_time', 'queue', 'ntlm']

  const setAlgo = (up: Node, algo: AlgoType) => {
    const dirs = (up.directives ?? []).filter((d) => !ALGO_DIRECTIVES.includes(d.name as AlgoType))
    if (algo === 'least_conn') dirs.unshift({ type: 'directive', name: 'least_conn', args: [], enabled: true })
    else if (algo === 'ip_hash') dirs.unshift({ type: 'directive', name: 'ip_hash', args: [], enabled: true })
    else if (algo === 'hash') dirs.unshift({ type: 'directive', name: 'hash', args: ['$request_uri', 'consistent'], enabled: true })
    else if (algo === 'random') dirs.unshift({ type: 'directive', name: 'random', args: [], enabled: true })
    else if (algo === 'least_time') dirs.unshift({ type: 'directive', name: 'least_time', args: ['header'], enabled: true })
    else if (algo === 'queue') dirs.unshift({ type: 'directive', name: 'queue', args: ['100'], enabled: true })
    else if (algo === 'ntlm') dirs.unshift({ type: 'directive', name: 'ntlm', args: [], enabled: true })
    updateUpstream(up.id, (u) => ({ ...u, directives: dirs }))
  }

  const setHashKey = (up: Node, key: string, consistent: boolean) => {
    const dirs = (up.directives ?? []).filter((d) => d.name !== 'hash')
    const args = key ? [key, ...(consistent ? ['consistent'] : [])] : []
    if (args.length) dirs.unshift({ type: 'directive', name: 'hash', args, enabled: true })
    updateUpstream(up.id, (u) => ({ ...u, directives: dirs }))
  }

  const setKeepalive = (up: Node, value: string) => {
    let dirs = (up.directives ?? []).filter((d) => d.name !== 'keepalive')
    if (value) {
      dirs = [...dirs, { type: 'directive', name: 'keepalive', args: [value], enabled: true }]
    }
    updateUpstream(up.id, (u) => ({ ...u, directives: dirs }))
  }

  const setZone = (up: Node, name: string, size: string) => {
    let dirs = (up.directives ?? []).filter((d) => d.name !== 'zone')
    if (name) {
      const args = size ? [name, size] : [name]
      dirs = [...dirs, { type: 'directive', name: 'zone', args, enabled: true }]
    }
    updateUpstream(up.id, (u) => ({ ...u, directives: dirs }))
  }

  /**
   * §54.4 — write the health_check directive back to the upstream. An empty
   * HealthCheckArgs {enabled:false} removes the directive (so a plain round-
   * trip of a non-Plus config stays bit-for-bit identical).
   */
  const setHealthCheck = (up: Node, hc: HealthCheckArgs) => {
    let dirs = (up.directives ?? []).filter((d) => d.name !== 'health_check')
    if (hc.enabled) {
      dirs = [...dirs, { type: 'directive', name: 'health_check', args: buildHealthCheckArgs(hc), enabled: true }]
    }
    updateUpstream(up.id, (u) => ({ ...u, directives: dirs }))
  }

  /**
   * §54.4 — upsert (or delete) a match { } block at the http level. Name is
   * the block's single positional arg; pass a blank `body.name` to delete.
   * Editing the body/headers/status rebuilds the block's directive list
   * from scratch to avoid surprise re-ordering on re-edit.
   */
  const upsertMatchBlock = (m: MatchBlock) => {
    onUpdate((c) => {
      const cfg = { ...c, directives: [...(c.directives ?? [])] }
      const httpIdx = cfg.directives.findIndex((d) => d.name === 'http' && d.type === 'block')
      if (httpIdx < 0) return cfg
      const http = { ...cfg.directives[httpIdx], directives: [...(cfg.directives[httpIdx].directives ?? [])] }
      const idx = http.directives.findIndex((d) => d.type === 'block' && d.name === 'match' && d.args?.[0] === m.name)
      if (!m.name) {
        // delete
        if (idx >= 0) http.directives.splice(idx, 1)
      } else {
        const body: Node[] = []
        if (m.status) body.push({ type: 'directive', name: 'status', args: m.status.split(/\s+/).filter(Boolean), enabled: true })
        if (m.bodyPattern) body.push({ type: 'directive', name: 'body', args: ['~', m.bodyPattern], enabled: true })
        for (const h of m.headers) {
          if (!h.name && !h.pattern) continue
          const args = h.pattern ? [h.name, '~', h.pattern] : [h.name]
          body.push({ type: 'directive', name: 'header', args, enabled: true })
        }
        const node: Node = {
          type: 'block', name: 'match', args: [m.name], enabled: true,
          id: m.id ?? `match-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          directives: body,
        }
        if (idx >= 0) http.directives[idx] = node
        else http.directives.push(node)
      }
      cfg.directives[httpIdx] = http
      return cfg
    })
  }

  const addServer = (up: Node, addr: string) => {
    if (!addr.trim()) return
    const servers = getServerDirectives(up)
    const newServer: Node = {
      type: 'directive',
      name: 'server',
      args: [addr.trim()],
      enabled: true,
      id: `server-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    }
    const other = (up.directives ?? []).filter((d) => d.name !== 'server')
    const newDirs = [...other, ...servers, newServer]
    updateUpstream(up.id, (u) => ({ ...u, directives: newDirs }))
    setNewServerAddr(up.id ?? '', '')
  }

  const removeServer = (up: Node, idx: number) => {
    const servers = [...getServerDirectives(up)]
    const other = (up.directives ?? []).filter((d) => d.name !== 'server')
    servers.splice(idx, 1)
    updateUpstream(up.id, (u) => ({ ...u, directives: [...other, ...servers] }))
  }

  const updateServer = (up: Node, idx: number, updater: (s: Node) => Node) => {
    const servers = [...getServerDirectives(up)]
    const other = (up.directives ?? []).filter((d) => d.name !== 'server')
    servers[idx] = updater(servers[idx])
    updateUpstream(up.id, (u) => ({ ...u, directives: [...other, ...servers] }))
  }

  const moveServer = (up: Node, from: number, to: number) => {
    const servers = [...getServerDirectives(up)]
    if (to < 0 || to >= servers.length) return
    const [s] = servers.splice(from, 1)
    servers.splice(to, 0, s)
    const other = (up.directives ?? []).filter((d) => d.name !== 'server')
    updateUpstream(up.id, (u) => ({ ...u, directives: [...other, ...servers] }))
  }

  const handleDragStart = (e: React.DragEvent, upId: string, i: number) => {
    setDraggedIndex({ upId, i })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `${upId}:${i}`)
  }
  const handleDragEnd = () => setDraggedIndex(null)
  const handleDragOver = (e: React.DragEvent) => e.preventDefault()
  const handleDrop = (up: Node, toIdx: number) => {
    if (!draggedIndex || draggedIndex.upId !== up.id) return
    if (draggedIndex.i === toIdx) {
      setDraggedIndex(null)
      return
    }
    moveServer(up, draggedIndex.i, toIdx)
    setDraggedIndex(null)
  }

  const handleBlockAction = (up: Node, action: BlockAction) => {
    setContextMenu(null)
    if (action === 'moveUp') onUpdate((c) => moveNodeInParent(c, up.id, 'up'))
    else if (action === 'moveDown') onUpdate((c) => moveNodeInParent(c, up.id, 'down'))
    else if (action === 'duplicate') onUpdate((c) => duplicateNode(c, up.id))
    else if (action === 'delete') onUpdate((c) => removeNodeById(c, up.id))
    else if (action === 'toggleEnabled') {
      onUpdate((c) => replaceNodeById(c, up.id, (n) => ({ ...n, enabled: !n.enabled })))
    }
  }

  return (
    <div className="upstreams-list">
      {!readOnly && (
        <div className="upstreams-add-bar">
          <button type="button" className="btn-add-upstream" onClick={addUpstream}>
            + Add upstream
          </button>
          <button
            type="button"
            className="btn-add-upstream btn-add-upstream-recommended"
            onClick={addRecommendedUpstream}
            title="Creates an upstream pre-configured with: least_conn · keepalive 32 · keepalive_requests 1000 · keepalive_timeout 60s"
          >
            + Add upstream (recommended defaults)
            <InfoIcon text="Creates a new upstream named 'backend' with a tuned default set: least_conn load balancing (fairer than round robin for uneven request durations), plus keepalive 32 + keepalive_requests 1000 + keepalive_timeout 60s to reuse TCP connections to the backend. Add your server entries after." />
          </button>
          {onAddProxyHost && (
            <button type="button" className="btn-add-proxy" onClick={() => onAddProxyHost()}>
              + Add server (proxy_pass…)
            </button>
          )}
        </div>
      )}
      {(() => {
        const http = config.directives?.find((d) => d.name === 'http' && d.type === 'block')
        const matchBlocks = getMatchBlocks(http)
        const matchNames = matchBlocks.map((m) => m.name).filter(Boolean)
        return upstreams.map((up) => {
        const servers = getServerDirectives(up)
        const algo = getAlgo(up)
        const keepalive = getKeepalive(up)
        const zone = getZone(up)
        const hc = getHealthCheck(up)
        const matchForThis = matchBlocks.find((m) => m.name === hc.matchName)
        const name = up.args?.[0] ?? 'unnamed'
        const linkedProxyHosts = servers.filter((s) => linksUpstream(s, name))

        const pos = findUpstreamIndex(config, up)
        const canMoveUp = pos ? pos.index > 0 : false
        const canMoveDown = pos ? pos.index < pos.total - 1 : false

        return (
          <div
            key={up.id ?? name}
            className={`upstream-card ${!up.enabled ? 'block-disabled' : ''}`}
            onContextMenu={
              readOnly
                ? undefined
                : (e) => {
                    e.preventDefault()
                    setContextMenu({ up, x: e.clientX, y: e.clientY })
                  }
            }
          >
            {(() => {
              const upKey = up.id ?? name
              const upOpen = !(collapsedUpstream[upKey] ?? false)
              const upServerCount = getServerDirectives(up).length
              return (
                <>
                  <div className="upstream-card-header">
                    <button
                      type="button"
                      className="block-collapse-toggle"
                      onClick={() => setCollapsedUpstream((p) => ({ ...p, [upKey]: upOpen }))}
                      title={upOpen ? 'Collapse upstream' : 'Expand upstream'}
                    >
                      {upOpen ? '▾' : '▸'}
                    </button>
                    {!readOnly && (
                      <label className="block-enabled-toggle">
                        <input
                          type="checkbox"
                          checked={up.enabled}
                          onChange={(e) =>
                            onUpdate((c) =>
                              replaceNodeById(c, up.id, (n) => ({ ...n, enabled: e.target.checked }))
                            )
                          }
                        />
                      </label>
                    )}
                    <input
                      type="text"
                      className="upstream-name-input"
                      value={name}
                      onChange={(e) =>
                        updateUpstream(up.id, (u) => ({
                          ...u,
                          args: [e.target.value || 'backend'],
                        }))
                      }
                      placeholder="upstream name"
                      readOnly={readOnly}
                    />
                    {!upOpen && (
                      <span className="block-collapsed-summary">
                        <code>{algo}</code> · {upServerCount} server{upServerCount === 1 ? '' : 's'}
                        {linkedProxyHosts.length > 0 && <> · used by {linkedProxyHosts.length}</>}
                      </span>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className="btn-delete-upstream"
                        onClick={() => onUpdate((c) => removeNodeById(c, up.id))}
                        title="Delete upstream"
                      >
                        Delete
                      </button>
                    )}
                    {!readOnly && onAddProxyHost && (
                      <button
                        type="button"
                        className="btn-add-proxy inline"
                        title="Create proxy host using this upstream"
                        onClick={() => onAddProxyHost(name)}
                      >
                        + proxy host
                      </button>
                    )}
                  </div>
                  {upOpen && (
                    <>
            <div className="upstream-field">
              <label>
                Load Balancing
                <InfoIcon text="How nginx distributes requests across upstream servers. round_robin is the default (weighted); least_conn sends to the server with fewest active connections — good for uneven request durations; ip_hash pins clients to a specific server; hash and random are for custom/consistent hashing. least_time/queue/ntlm require Nginx Plus." />
              </label>
              <select
                value={algo}
                onChange={(e) => setAlgo(up, e.target.value as AlgoType)}
                disabled={readOnly}
              >
                <option value="round_robin">Round Robin</option>
                <option value="least_conn">Least Connections</option>
                <option value="ip_hash">IP Hash</option>
                <option value="hash">Hash</option>
                <option value="random">Random</option>
                <optgroup label="Nginx Plus">
                  <option value="least_time">Least Time (Plus)</option>
                  <option value="queue">Queue (Plus)</option>
                  <option value="ntlm">NTLM (Plus)</option>
                </optgroup>
              </select>
              {['least_time', 'queue', 'ntlm'].includes(algo) && (
                <span className="nginx-plus-badge" title="Requires Nginx Plus">Nginx Plus</span>
              )}
              {algo === 'hash' && (
                <div className="hash-options">
                  <input
                    type="text"
                    value={getHashKey(up)}
                    onChange={(e) => setHashKey(up, e.target.value, getHashConsistent(up))}
                    placeholder="$request_uri"
                    readOnly={readOnly}
                  />
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={getHashConsistent(up)}
                      disabled={readOnly}
                      onChange={(e) => setHashKey(up, getHashKey(up), e.target.checked)}
                    />
                    consistent
                  </label>
                </div>
              )}
            </div>

            <div className="upstream-field">
              <label>
                zone (status + shared state)
                <span className="nginx-plus-badge" title="Nginx Plus required for per-server live stats; open-source nginx supports the directive for zone_sync / dynamic config but ignores the stats side.">Nginx Plus</span>
                <InfoIcon text={'Declares a shared-memory zone that holds runtime state for this upstream: per-server stats (requests, active conns, response counts) visible via the Plus /api & dashboard, plus state for dynamic reconfiguration APIs and zone_sync clustering. Size: 64k is enough for ~128 servers of state; rule of thumb is ~256 bytes per server. Open-source nginx parses the directive (no error) but does not expose the stats. Name it after the upstream (e.g. `backend 64k`). Required before you can use health_check, sticky, or the /api PATCH endpoints on this upstream.'} />
              </label>
              <div className="zone-row">
                <input
                  type="text"
                  value={zone.name}
                  onChange={(e) => setZone(up, e.target.value, zone.size)}
                  placeholder="zone name (e.g. backend)"
                  readOnly={readOnly}
                  title="Shared-memory zone name — usually matches the upstream name"
                />
                <input
                  type="text"
                  className="zone-size-input"
                  value={zone.size}
                  onChange={(e) => setZone(up, zone.name, e.target.value)}
                  placeholder="64k"
                  readOnly={readOnly}
                  title="Zone size — 64k fits ~128 servers (~256 bytes each). Required when a name is set."
                />
              </div>
            </div>

            <div className="upstream-field">
              <label>
                keepalive
                <InfoIcon text={'Max idle connections to each upstream server that each worker keeps open. Reusing TCP/TLS connections drastically reduces latency and CPU. Start at 16–32 per server. Requires `proxy_http_version 1.1` and `proxy_set_header Connection ""` in the location block.'} />
              </label>
              <input
                type="number"
                min={0}
                value={keepalive}
                onChange={(e) => setKeepalive(up, e.target.value)}
                placeholder="0"
                readOnly={readOnly}
              />
            </div>

            {/* §54.4 — Active health check (Nginx Plus) */}
            <div className="upstream-health-check-section">
              <div className="uhc-head">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={hc.enabled}
                    disabled={readOnly}
                    onChange={(e) => setHealthCheck(up, { ...hc, enabled: e.target.checked })}
                  />
                  Active health_check
                </label>
                <span className="nginx-plus-badge" title={'Requires Nginx Plus — open-source nginx fails nginx -t with \'unknown directive "health_check"\' if this is set.'}>Nginx Plus</span>
                <InfoIcon text={'Nginx Plus only: proactive health checks run independently of client requests. Each worker sends a probe on the configured interval to every upstream server; failing the probe N times in a row (`fails=N`) marks the server unhealthy (no traffic), and passing M times (`passes=M`) re-adds it. Requires `zone` to be set on this upstream (shared state). Open-source nginx only supports PASSIVE checks (server-level `max_fails` / `fail_timeout`). Typical probe: `health_check interval=5s fails=3 passes=2 uri=/healthz`.'} />
              </div>
              {hc.enabled && (
                <>
                  <div className="uhc-row">
                    <label>
                      interval
                      <InfoIcon text="How often to probe each upstream server. Time units: s/m/h. Shorter intervals detect failures faster but add load. Default 5s." />
                    </label>
                    <input
                      type="text"
                      className="uhc-short"
                      value={hc.interval}
                      placeholder="5s"
                      readOnly={readOnly}
                      onChange={(e) => setHealthCheck(up, { ...hc, interval: e.target.value })}
                    />
                    <label>
                      fails
                      <InfoIcon text="Consecutive failed probes before a server is marked unhealthy. Default 1 (flaky probes cause flapping — set to 2–3 for stability)." />
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="uhc-short"
                      value={hc.fails}
                      placeholder="1"
                      readOnly={readOnly}
                      onChange={(e) => setHealthCheck(up, { ...hc, fails: e.target.value })}
                    />
                    <label>
                      passes
                      <InfoIcon text="Consecutive successful probes before an unhealthy server is re-added to rotation. Default 1. Setting 2 avoids flapping after a brief outage." />
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="uhc-short"
                      value={hc.passes}
                      placeholder="1"
                      readOnly={readOnly}
                      onChange={(e) => setHealthCheck(up, { ...hc, passes: e.target.value })}
                    />
                    <label>
                      port
                      <InfoIcon text="Override probe port (default: the server's port). Useful when your app has a separate health-check port distinct from traffic." />
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      className="uhc-short"
                      value={hc.port}
                      placeholder="(server port)"
                      readOnly={readOnly}
                      onChange={(e) => setHealthCheck(up, { ...hc, port: e.target.value })}
                    />
                  </div>
                  <div className="uhc-row">
                    <label>
                      uri
                      <InfoIcon text="Path requested by the probe (HTTP health checks only). Typical: /healthz, /health, /ping. The upstream must return a 2xx/3xx status (unless a match block is referenced)." />
                    </label>
                    <input
                      type="text"
                      className="uhc-wide"
                      value={hc.uri}
                      placeholder="/healthz"
                      readOnly={readOnly}
                      onChange={(e) => setHealthCheck(up, { ...hc, uri: e.target.value })}
                    />
                    <label>
                      type
                      <InfoIcon text="Probe protocol. Empty (default) = HTTP. grpc = gRPC health check. tcp/udp = connect-only probe (for stream upstreams)." />
                    </label>
                    <select
                      value={hc.type}
                      disabled={readOnly}
                      onChange={(e) => setHealthCheck(up, { ...hc, type: e.target.value })}
                    >
                      <option value="">http (default)</option>
                      <option value="grpc">grpc</option>
                      <option value="tcp">tcp</option>
                      <option value="udp">udp</option>
                    </select>
                    <label>
                      match
                      <InfoIcon text={'Reference a `match { }` block to assert richer conditions than just the HTTP status (e.g. body contains "ok", specific headers). Leave blank to accept any 2xx/3xx.'} />
                    </label>
                    <select
                      value={hc.matchName}
                      disabled={readOnly}
                      onChange={(e) => setHealthCheck(up, { ...hc, matchName: e.target.value })}
                    >
                      <option value="">(none — any 2xx/3xx)</option>
                      {matchNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    {!readOnly && (
                      <button
                        type="button"
                        className="btn-preset"
                        title="Create a new match { } block at the http level and link this health_check to it."
                        onClick={() => {
                          const base = `${name}_healthy`
                          let nm = base
                          let i = 2
                          while (matchNames.includes(nm)) { nm = `${base}_${i++}` }
                          upsertMatchBlock({ name: nm, status: '200-399', bodyPattern: '', headers: [] })
                          setHealthCheck(up, { ...hc, matchName: nm })
                        }}
                      >
                        + New match
                      </button>
                    )}
                  </div>
                  <div className="uhc-row">
                    <label className="toggle-label" title="When set, the upstream starts in the 'failed' state until the first probe succeeds — requests to this upstream get 502 during startup.">
                      <input
                        type="checkbox"
                        checked={hc.mandatory}
                        disabled={readOnly}
                        onChange={(e) => setHealthCheck(up, { ...hc, mandatory: e.target.checked })}
                      />
                      mandatory
                      <InfoIcon text="Start upstream servers in the 'unhealthy' state; they only begin accepting traffic after the first successful probe. Prevents sending requests to servers whose readiness is unverified after a restart/reload. Pairs with `persistent` to retain health state across reloads." />
                    </label>
                    <label className="toggle-label" title="Preserve health state across nginx reloads.">
                      <input
                        type="checkbox"
                        checked={hc.persistent}
                        disabled={readOnly}
                        onChange={(e) => setHealthCheck(up, { ...hc, persistent: e.target.checked })}
                      />
                      persistent
                      <InfoIcon text="Retain each server's health status (up/down) across `nginx -s reload`. Without this, every reload resets state and all servers start 'healthy' until probed — briefly sending traffic to still-down backends." />
                    </label>
                  </div>

                  {hc.matchName && (
                    <div className="upstream-match-section">
                      <div className="uhc-subhead">
                        <strong>match {hc.matchName} {'{ }'}</strong>
                        <InfoIcon text={'The linked match block. Rules are AND-ed: ALL rules must pass for the upstream to be considered healthy. Empty `status` + empty body + no headers → probe passes on any response (rarely useful; use `status 200` for strict HTTP-200-only).'} />
                        {!readOnly && (
                          <button
                            type="button"
                            className="btn-preset"
                            onClick={() => {
                              // unlink and delete the block if not used elsewhere
                              const stillUsed = upstreams.some((u) => u.id !== up.id && getHealthCheck(u).matchName === hc.matchName)
                              setHealthCheck(up, { ...hc, matchName: '' })
                              if (!stillUsed) upsertMatchBlock({ name: '', status: '', bodyPattern: '', headers: [] } as MatchBlock)
                            }}
                            title={`Unlink from this health_check. The match block itself is deleted if not referenced elsewhere.`}
                          >
                            Unlink
                          </button>
                        )}
                      </div>
                      {matchForThis && (
                        <>
                          <div className="uhc-row">
                            <label>
                              status
                              <InfoIcon text={'Accepted status codes. Examples: "200" · "200-399" (ranges allowed) · "! 500" (negation — accept anything except 500) · "200 204". Space-separated list.'} />
                            </label>
                            <input
                              type="text"
                              className="uhc-wide"
                              value={matchForThis.status}
                              placeholder="200"
                              readOnly={readOnly}
                              onChange={(e) => upsertMatchBlock({ ...matchForThis, status: e.target.value })}
                            />
                          </div>
                          <div className="uhc-row">
                            <label>
                              body ~
                              <InfoIcon text={'PCRE pattern matched against the response body. Typical: `"healthy"` — probe passes only if the body contains that string. Expensive for large bodies (nginx buffers the whole response), so keep health endpoints small.'} />
                            </label>
                            <input
                              type="text"
                              className="uhc-wide"
                              value={matchForThis.bodyPattern}
                              placeholder={'"healthy"'}
                              readOnly={readOnly}
                              onChange={(e) => upsertMatchBlock({ ...matchForThis, bodyPattern: e.target.value })}
                            />
                          </div>
                          <div className="uhc-row">
                            <label>
                              headers
                              <InfoIcon text={'Header assertions. Each row is `header-name ~ pattern` (PCRE). Probe passes only if every listed header matches. Use to check e.g. `X-Health ~ "ok"` or `Content-Type ~ "application/json"`.'} />
                            </label>
                          </div>
                          {matchForThis.headers.map((h, hi) => (
                            <div key={hi} className="uhc-row">
                              <input
                                type="text"
                                className="uhc-short"
                                placeholder="Header-Name"
                                value={h.name}
                                readOnly={readOnly}
                                onChange={(e) => {
                                  const next = [...matchForThis.headers]
                                  next[hi] = { ...h, name: e.target.value }
                                  upsertMatchBlock({ ...matchForThis, headers: next })
                                }}
                              />
                              <span>~</span>
                              <input
                                type="text"
                                className="uhc-wide"
                                placeholder='"ok"'
                                value={h.pattern}
                                readOnly={readOnly}
                                onChange={(e) => {
                                  const next = [...matchForThis.headers]
                                  next[hi] = { ...h, pattern: e.target.value }
                                  upsertMatchBlock({ ...matchForThis, headers: next })
                                }}
                              />
                              {!readOnly && (
                                <button
                                  type="button"
                                  className="btn-preset"
                                  onClick={() => upsertMatchBlock({ ...matchForThis, headers: matchForThis.headers.filter((_, j) => j !== hi) })}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                          {!readOnly && (
                            <button
                              type="button"
                              className="btn-preset"
                              onClick={() => upsertMatchBlock({ ...matchForThis, headers: [...matchForThis.headers, { name: '', pattern: '' }] })}
                            >
                              + Header rule
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {!zone.name && (
                    <div className="satisfy-orphan-warning" style={{ marginTop: '0.5rem' }}>
                      <InfoIcon text="health_check requires a shared-memory zone (the `zone` directive above) because probe results are shared across workers via that zone. Add one, otherwise nginx -t will reject the config." />
                      Missing <code>zone</code> — health_check requires shared-memory zone (above).
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="upstream-links">
              <div className="upstream-links-label">Linked proxy hosts</div>
              {linkedProxyHosts.length === 0 ? (
                <div className="upstream-links-empty">No proxy host linked to this upstream.</div>
              ) : (
                <div className="upstream-links-list">
                  {linkedProxyHosts.map((s) => (
                    <span key={s.id} className="linked-host-chip">{serverTitle(s)}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="upstream-servers">
              <div className="upstream-servers-label">Servers</div>
              {!readOnly && (
              <div className="server-add">
                <input
                  type="text"
                  placeholder="10.0.0.1:8080"
                  value={getNewServerAddr(up.id ?? '')}
                  onChange={(e) => setNewServerAddr(up.id ?? '', e.target.value)}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && addServer(up, getNewServerAddr(up.id ?? ''))
                  }
                />
                <button
                  type="button"
                  onClick={() => addServer(up, getNewServerAddr(up.id ?? ''))}
                >
                  Add
                </button>
              </div>
              )}
              <ul className="server-list">
                {servers.map((s, i) => {
                  const args = parseServerArgs(s.args ?? [])
                  const updateArgs = (next: Partial<ServerArgs>) =>
                    updateServer(up, i, (n) => ({ ...n, args: buildServerArgs({ ...args, ...next }) }))
                  return (
                    <li
                      key={i}
                      className={`server-item ${!s.enabled ? 'disabled' : ''} ${draggedIndex?.upId === up.id && draggedIndex?.i === i ? 'dragging' : ''}`}
                      draggable={!readOnly}
                      onDragStart={(e) => handleDragStart(e, up.id ?? '', i)}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDrop(up, i)}
                    >
                      <span className="drag-handle" title="Drag to reorder">⋮⋮</span>
                      <input
                        type="text"
                        className="server-addr"
                        value={args.addr}
                        onChange={(e) => updateArgs({ addr: e.target.value })}
                        placeholder="10.0.0.1:8080 or unix:/tmp/sock"
                        readOnly={readOnly}
                      />
                      <input
                        type="number"
                        className="server-opt weight-input"
                        min={1}
                        value={args.weight ?? ''}
                        onChange={(e) => updateArgs({ weight: e.target.value || undefined })}
                        placeholder="weight"
                        readOnly={readOnly}
                        title="weight"
                      />
                      <input
                        type="number"
                        className="server-opt"
                        min={0}
                        value={args.maxFails ?? ''}
                        onChange={(e) => updateArgs({ maxFails: e.target.value || undefined })}
                        placeholder="max_fails"
                        readOnly={readOnly}
                        title="max_fails"
                      />
                      <input
                        type="text"
                        className="server-opt"
                        value={args.failTimeout ?? ''}
                        onChange={(e) => updateArgs({ failTimeout: e.target.value || undefined })}
                        placeholder="fail_timeout"
                        readOnly={readOnly}
                        title="fail_timeout (e.g. 30s)"
                      />
                      <input
                        type="text"
                        className="server-opt"
                        value={args.slowStart ?? ''}
                        onChange={(e) => updateArgs({ slowStart: e.target.value || undefined })}
                        placeholder="slow_start"
                        readOnly={readOnly}
                        title="slow_start (e.g. 10s)"
                      />
                      <input
                        type="number"
                        className="server-opt"
                        min={0}
                        value={args.maxConns ?? ''}
                        onChange={(e) => updateArgs({ maxConns: e.target.value || undefined })}
                        placeholder="max_conns"
                        readOnly={readOnly}
                        title="max_conns"
                      />
                      <label className="toggle-label" title="backup">
                        <input
                          type="checkbox"
                          checked={args.backup}
                          disabled={readOnly}
                          onChange={(e) => updateArgs({ backup: e.target.checked })}
                        />
                        backup
                      </label>
                      <label className="toggle-label" title="down">
                        <input
                          type="checkbox"
                          checked={args.down}
                          disabled={readOnly}
                          onChange={(e) => updateArgs({ down: e.target.checked })}
                        />
                        down
                      </label>
                      <label
                        className="toggle-label"
                        title={'Re-resolve the server\'s hostname from DNS at runtime (Nginx Plus re-resolves based on TTL; OSS nginx only re-resolves on reload). Requires the address to be a hostname (not IP or unix:) AND a `resolver` directive in scope. Example: `server api.example.com:8080 resolve;` — without the `resolver` at http or server level, nginx -t will reject the config at load.'}
                      >
                        <input
                          type="checkbox"
                          checked={args.resolve}
                          disabled={readOnly}
                          onChange={(e) => updateArgs({ resolve: e.target.checked })}
                        />
                        resolve
                        <span
                          className="nginx-plus-badge"
                          title="Nginx Plus: honours the DNS TTL and re-resolves without a reload. Open-source nginx parses `resolve` but only re-resolves at reload time, so the flag has limited value on OSS."
                          style={{ marginLeft: '0.25rem' }}
                        >
                          Plus
                        </span>
                      </label>
                      <button
                        type="button"
                        className="btn-remove"
                        onClick={() => removeServer(up, i)}
                        title="Remove"
                        disabled={readOnly}
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
                    </>
                  )}
                </>
              )
            })()}
          </div>
        )
      })
      })()}
      {contextMenu && (() => {
        const ctxPos = findUpstreamIndex(config, contextMenu.up)
        return (
          <>
            <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} />
            <BlockContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              canMoveUp={ctxPos ? ctxPos.index > 0 : false}
              canMoveDown={ctxPos ? ctxPos.index < ctxPos.total - 1 : false}
              enabled={contextMenu.up.enabled}
              onAction={(a) => handleBlockAction(contextMenu.up, a)}
              onClose={() => setContextMenu(null)}
            />
          </>
        )
      })()}
    </div>
  )
}
