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

type AlgoType = 'round_robin' | 'least_conn' | 'ip_hash' | 'hash'

function getAlgo(up: Node): AlgoType {
  if (up.directives?.some((d) => d.name === 'least_conn')) return 'least_conn'
  if (up.directives?.some((d) => d.name === 'ip_hash')) return 'ip_hash'
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

  const setAlgo = (up: Node, algo: AlgoType) => {
    const dirs = (up.directives ?? []).filter(
      (d) => d.name !== 'least_conn' && d.name !== 'ip_hash' && d.name !== 'hash'
    )
    if (algo === 'least_conn') dirs.unshift({ type: 'directive', name: 'least_conn', args: [], enabled: true })
    else if (algo === 'ip_hash') dirs.unshift({ type: 'directive', name: 'ip_hash', args: [], enabled: true })
    else if (algo === 'hash') dirs.unshift({ type: 'directive', name: 'hash', args: ['$request_uri', 'consistent'], enabled: true })
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
          {onAddProxyHost && (
            <button type="button" className="btn-add-proxy" onClick={() => onAddProxyHost()}>
              + Add server (proxy_pass…)
            </button>
          )}
        </div>
      )}
      {upstreams.map((up) => {
        const servers = getServerDirectives(up)
        const algo = getAlgo(up)
        const keepalive = getKeepalive(up)
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
            <div className="upstream-card-header">
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

            <div className="upstream-field">
              <label>Load Balancing</label>
              <select
                value={algo}
                onChange={(e) => setAlgo(up, e.target.value as AlgoType)}
                disabled={readOnly}
              >
                <option value="round_robin">Round Robin</option>
                <option value="least_conn">Least Connections</option>
                <option value="ip_hash">IP Hash</option>
                <option value="hash">Hash</option>
              </select>
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
              <label>keepalive</label>
              <input
                type="number"
                min={0}
                value={keepalive}
                onChange={(e) => setKeepalive(up, e.target.value)}
                placeholder="0"
                readOnly={readOnly}
              />
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
                      <label className="toggle-label" title="resolve">
                        <input
                          type="checkbox"
                          checked={args.resolve}
                          disabled={readOnly}
                          onChange={(e) => updateArgs({ resolve: e.target.checked })}
                        />
                        resolve
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
          </div>
        )
      })}
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
