import { useState } from 'react'
import { type ConfigFile, type Node } from './api'
import {
  replaceNodeById,
  setBlockDirective,
  removeBlockDirective,
  removeNodeById,
} from './configUtils'
import './StreamTab.css'

interface Props {
  streamBlock?: Node
  config: ConfigFile
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  readOnly?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDirectiveArg(block: Node | undefined, name: string, idx = 0): string {
  return block?.directives?.find((d) => d.name === name)?.args?.[idx] ?? ''
}

/** Find or create the stream block, then apply fn to its directives. */
function applyToStream(c: ConfigFile, fn: (dirs: Node[]) => Node[]): ConfigFile {
  const dirs = c.directives ?? []
  const streamIdx = dirs.findIndex((d) => d.name === 'stream' && d.type === 'block')
  if (streamIdx >= 0) {
    const stream = dirs[streamIdx]
    return {
      ...c,
      directives: [
        ...dirs.slice(0, streamIdx),
        { ...stream, directives: fn(stream.directives ?? []) },
        ...dirs.slice(streamIdx + 1),
      ],
    }
  }
  // No stream block — create one
  const newStream: Node = {
    type: 'block',
    name: 'stream',
    args: [],
    enabled: true,
    id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    directives: fn([]),
  }
  return { ...c, directives: [...dirs, newStream] }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ─── Stream Upstream Card ─────────────────────────────────────────────────────

interface StreamUpstreamCardProps {
  upstream: Node
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  readOnly?: boolean
}

function StreamUpstreamCard({ upstream, onUpdate, readOnly }: StreamUpstreamCardProps) {
  const [newAddr, setNewAddr] = useState('')
  const name = upstream.args?.[0] ?? 'unnamed'
  const serverDirs = (upstream.directives ?? []).filter((d) => d.name === 'server')

  const updateUpstream = (fn: (u: Node) => Node) => {
    onUpdate((c) => replaceNodeById(c, upstream.id, fn))
  }

  const addServer = () => {
    const addr = newAddr.trim()
    if (!addr) return
    const newServer: Node = {
      type: 'directive',
      name: 'server',
      args: [addr],
      enabled: true,
      id: makeId('stream-srv'),
    }
    const other = (upstream.directives ?? []).filter((d) => d.name !== 'server')
    updateUpstream((u) => ({ ...u, directives: [...other, ...serverDirs, newServer] }))
    setNewAddr('')
  }

  const removeServer = (idx: number) => {
    const next = [...serverDirs]
    next.splice(idx, 1)
    const other = (upstream.directives ?? []).filter((d) => d.name !== 'server')
    updateUpstream((u) => ({ ...u, directives: [...other, ...next] }))
  }

  return (
    <div className={`stream-upstream-card ${!upstream.enabled ? 'block-disabled' : ''}`}>
      <div className="stream-card-header">
        {!readOnly && (
          <label className="stream-toggle-label" title="enabled">
            <input
              type="checkbox"
              checked={upstream.enabled}
              onChange={(e) =>
                updateUpstream((u) => ({ ...u, enabled: e.target.checked }))
              }
            />
          </label>
        )}
        <input
          type="text"
          className="stream-upstream-name-input"
          value={name}
          onChange={(e) =>
            updateUpstream((u) => ({ ...u, args: [e.target.value || 'backend'] }))
          }
          placeholder="upstream name"
          readOnly={readOnly}
        />
        {!readOnly && (
          <button
            type="button"
            className="btn-delete-stream"
            onClick={() => onUpdate((c) => removeNodeById(c, upstream.id))}
            title="Delete upstream"
          >
            Delete
          </button>
        )}
      </div>

      <div className="stream-field">
        <label>Servers</label>
        <ul className="stream-server-list">
          {serverDirs.map((s, i) => (
            <li key={s.id ?? i} className="stream-server-item">
              <input
                type="text"
                value={s.args?.[0] ?? ''}
                onChange={(e) => {
                  const next = [...serverDirs]
                  next[i] = { ...next[i], args: [e.target.value] }
                  const other = (upstream.directives ?? []).filter((d) => d.name !== 'server')
                  updateUpstream((u) => ({ ...u, directives: [...other, ...next] }))
                }}
                placeholder="10.0.0.1:8080"
                readOnly={readOnly}
              />
              {!readOnly && (
                <button
                  type="button"
                  className="btn-remove-stream-server"
                  onClick={() => removeServer(i)}
                  title="Remove server"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <div className="stream-server-add">
            <input
              type="text"
              value={newAddr}
              onChange={(e) => setNewAddr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addServer()}
              placeholder="10.0.0.1:8080"
            />
            <button type="button" onClick={addServer}>
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stream Server Card ───────────────────────────────────────────────────────

interface StreamServerCardProps {
  server: Node
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  readOnly?: boolean
}

function parseStreamListen(args: string[]): { port: string; udp: boolean; ssl: boolean } {
  const joined = args.join(' ')
  const parts = joined.split(/\s+/).filter(Boolean)
  const port = parts.filter((p) => p !== 'udp' && p !== 'ssl')[0] ?? ''
  return {
    port,
    udp: joined.includes('udp'),
    ssl: joined.includes('ssl'),
  }
}

function buildStreamListen(port: string, udp: boolean, ssl: boolean): string[] {
  const parts = [port || '']
  if (udp) parts.push('udp')
  if (ssl) parts.push('ssl')
  return [parts.filter(Boolean).join(' ')]
}

function StreamServerCard({ server, onUpdate, readOnly }: StreamServerCardProps) {
  const listenArgs = server.directives?.find((d) => d.name === 'listen')?.args ?? []
  const { port, udp, ssl } = parseStreamListen(listenArgs)
  const proxyPass = getDirectiveArg(server, 'proxy_pass')
  const proxyTimeout = getDirectiveArg(server, 'proxy_timeout')
  const proxyConnectTimeout = getDirectiveArg(server, 'proxy_connect_timeout')
  const proxyBufferSize = getDirectiveArg(server, 'proxy_buffer_size')
  const sslPrereadArg = getDirectiveArg(server, 'ssl_preread')
  const sslPreread = sslPrereadArg === 'on'

  const updateServer = (fn: (s: Node) => Node) => {
    onUpdate((c) => replaceNodeById(c, server.id, fn))
  }

  const setDir = (name: string, value: string) => {
    updateServer((s) => ({
      ...s,
      directives: setBlockDirective(s.directives ?? [], name, value ? [value] : []),
    }))
  }

  const setListen = (newPort: string, newUdp: boolean, newSsl: boolean) => {
    updateServer((s) => ({
      ...s,
      directives: setBlockDirective(
        s.directives ?? [],
        'listen',
        buildStreamListen(newPort, newUdp, newSsl)
      ),
    }))
  }

  const setSslPreread = (val: boolean) => {
    updateServer((s) => ({
      ...s,
      directives: val
        ? setBlockDirective(s.directives ?? [], 'ssl_preread', ['on'])
        : removeBlockDirective(s.directives ?? [], 'ssl_preread'),
    }))
  }

  const listenDisplay = listenArgs.join(' ') || '(no listen)'

  return (
    <div className={`stream-server-card ${!server.enabled ? 'block-disabled' : ''}`}>
      <div className="stream-card-header">
        {!readOnly && (
          <label className="stream-toggle-label" title="enabled">
            <input
              type="checkbox"
              checked={server.enabled}
              onChange={(e) =>
                updateServer((s) => ({ ...s, enabled: e.target.checked }))
              }
            />
          </label>
        )}
        <span className="stream-card-title">listen {listenDisplay}</span>
        {!readOnly && (
          <button
            type="button"
            className="btn-delete-stream"
            onClick={() => onUpdate((c) => removeNodeById(c, server.id))}
            title="Delete server"
          >
            Delete
          </button>
        )}
      </div>

      <div className="stream-fields-row">
        <div className="stream-field">
          <label>Listen port / address</label>
          <input
            type="text"
            value={port}
            onChange={(e) => setListen(e.target.value, udp, ssl)}
            placeholder="8080"
            readOnly={readOnly}
          />
        </div>
        <div className="stream-field">
          <label>proxy_pass</label>
          <input
            type="text"
            value={proxyPass}
            onChange={(e) => setDir('proxy_pass', e.target.value)}
            placeholder="backend:8080"
            readOnly={readOnly}
          />
        </div>
      </div>

      <div className="stream-toggle-row">
        <label className="stream-toggle-label">
          <input
            type="checkbox"
            checked={udp}
            disabled={readOnly}
            onChange={(e) => setListen(port, e.target.checked, ssl)}
          />
          UDP
        </label>
        <label className="stream-toggle-label">
          <input
            type="checkbox"
            checked={ssl}
            disabled={readOnly}
            onChange={(e) => setListen(port, udp, e.target.checked)}
          />
          SSL
        </label>
        <label className="stream-toggle-label">
          <input
            type="checkbox"
            checked={sslPreread}
            disabled={readOnly}
            onChange={(e) => setSslPreread(e.target.checked)}
          />
          ssl_preread
        </label>
      </div>

      <div className="stream-fields-row">
        <div className="stream-field">
          <label>proxy_timeout</label>
          <input
            type="text"
            value={proxyTimeout}
            onChange={(e) => setDir('proxy_timeout', e.target.value)}
            placeholder="10m"
            readOnly={readOnly}
          />
        </div>
        <div className="stream-field">
          <label>proxy_connect_timeout</label>
          <input
            type="text"
            value={proxyConnectTimeout}
            onChange={(e) => setDir('proxy_connect_timeout', e.target.value)}
            placeholder="60s"
            readOnly={readOnly}
          />
        </div>
        <div className="stream-field">
          <label>proxy_buffer_size</label>
          <input
            type="text"
            value={proxyBufferSize}
            onChange={(e) => setDir('proxy_buffer_size', e.target.value)}
            placeholder="32k"
            readOnly={readOnly}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Main StreamTab Component ─────────────────────────────────────────────────

export default function StreamTab({ streamBlock, config, onUpdate, readOnly }: Props) {
  const streamUpstreams = streamBlock?.directives?.filter((d) => d.name === 'upstream') ?? []
  const streamServers = streamBlock?.directives?.filter((d) => d.name === 'server') ?? []

  const accessLog = getDirectiveArg(streamBlock, 'access_log')
  const errorLog = getDirectiveArg(streamBlock, 'error_log')
  const errorLogLevel = streamBlock?.directives?.find((d) => d.name === 'error_log')?.args?.[1] ?? ''

  const setStreamDir = (name: string, args: string[]) => {
    onUpdate((c) =>
      applyToStream(c, (dirs) => setBlockDirective(dirs, name, args))
    )
  }

  const addUpstream = () => {
    const newUpstream: Node = {
      type: 'block',
      name: 'upstream',
      args: ['stream_backend'],
      enabled: true,
      id: makeId('stream-up'),
      directives: [],
    }
    onUpdate((c) =>
      applyToStream(c, (dirs) => [...dirs, newUpstream])
    )
  }

  const addServer = () => {
    const newServer: Node = {
      type: 'block',
      name: 'server',
      args: [],
      enabled: true,
      id: makeId('stream-server'),
      directives: [
        { type: 'directive', name: 'listen', args: [''], enabled: true, id: makeId('listen') },
        { type: 'directive', name: 'proxy_pass', args: [''], enabled: true, id: makeId('pp') },
      ],
    }
    onUpdate((c) =>
      applyToStream(c, (dirs) => [...dirs, newServer])
    )
  }

  return (
    <div className="stream-tab">
      {/* Upstreams section */}
      <div className="stream-section">
        <div className="stream-section-header">
          <h3>Stream Upstreams ({streamUpstreams.length})</h3>
          {!readOnly && (
            <button type="button" className="btn-add-stream" onClick={addUpstream}>
              + Add upstream
            </button>
          )}
        </div>
        {streamUpstreams.length === 0 && (
          <div className="stream-empty">No stream upstream blocks defined.</div>
        )}
        {streamUpstreams.map((up) => (
          <StreamUpstreamCard
            key={up.id ?? up.args?.[0]}
            upstream={up}
            onUpdate={onUpdate}
            readOnly={readOnly}
          />
        ))}
      </div>

      {/* Servers section */}
      <div className="stream-section">
        <div className="stream-section-header">
          <h3>Stream Servers ({streamServers.length})</h3>
          {!readOnly && (
            <button type="button" className="btn-add-stream" onClick={addServer}>
              + Add server
            </button>
          )}
        </div>
        {streamServers.length === 0 && (
          <div className="stream-empty">No stream server blocks defined.</div>
        )}
        {streamServers.map((srv) => (
          <StreamServerCard
            key={srv.id ?? Math.random()}
            server={srv}
            onUpdate={onUpdate}
            readOnly={readOnly}
          />
        ))}
      </div>

      {/* Logging section */}
      <div className="stream-section">
        <div className="stream-section-header">
          <h3>Logging</h3>
        </div>
        <div className="stream-logging-section">
          <div className="stream-fields-row">
            <div className="stream-field">
              <label>access_log</label>
              <input
                type="text"
                value={accessLog}
                onChange={(e) =>
                  setStreamDir('access_log', e.target.value ? [e.target.value] : [])
                }
                placeholder="/var/log/nginx/stream-access.log"
                readOnly={readOnly}
              />
            </div>
            <div className="stream-field">
              <label>error_log path</label>
              <input
                type="text"
                value={errorLog}
                onChange={(e) => {
                  const path = e.target.value
                  setStreamDir('error_log', path ? (errorLogLevel ? [path, errorLogLevel] : [path]) : [])
                }}
                placeholder="/var/log/nginx/stream-error.log"
                readOnly={readOnly}
              />
            </div>
            <div className="stream-field">
              <label>error_log level</label>
              <select
                value={errorLogLevel}
                onChange={(e) => {
                  const level = e.target.value
                  setStreamDir('error_log', errorLog ? (level ? [errorLog, level] : [errorLog]) : [])
                }}
                disabled={readOnly || !errorLog}
              >
                <option value="">default</option>
                <option value="debug">debug</option>
                <option value="info">info</option>
                <option value="notice">notice</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
                <option value="crit">crit</option>
                <option value="alert">alert</option>
                <option value="emerg">emerg</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
