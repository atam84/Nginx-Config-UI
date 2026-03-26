import { useState } from 'react'
import { type ConfigFile, type Node } from './api'
import {
  replaceNodeById,
  setBlockDirective,
  removeBlockDirective,
  setBlockDirectivesMulti,
  moveNodeInParent,
  duplicateNode,
  removeNodeById,
  getBlockPosition,
} from './configUtils'
import BlockContextMenu, { type BlockAction } from './BlockContextMenu'
import './DomainsServersTab.css'

interface Props {
  servers: Node[]
  upstreams?: Node[]
  httpBlock?: Node
  config: ConfigFile
  mode?: 'all' | 'with_upstream' | 'without_upstream'
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  readOnly?: boolean
}

function getDirective(block: Node, name: string): Node | undefined {
  return block.directives?.find((d) => d.name === name)
}

function getDirectiveArgs(block: Node, name: string): string[] {
  return getDirective(block, name)?.args ?? []
}

function getDirectiveArg(block: Node, name: string, idx: number): string {
  return getDirectiveArgs(block, name)[idx] ?? ''
}

function normalizeProxyPass(input: string, upstreamNames: string[]): string {
  const v = (input ?? '').trim()
  if (!v) return ''
  if (v.includes('://') || v.startsWith('$')) return v
  // If user selected an upstream name, nginx expects http://<upstream>
  if (upstreamNames.includes(v)) return `http://${v}`
  // If user typed host:port (or hostname), assume http:// unless they provided a scheme
  return `http://${v}`
}

/** Parse listen directive: "443 ssl http2" or ["443","ssl","http2"] -> { port, ssl, http2 } */
function parseListen(args: string[]): { port: string; ssl: boolean; http2: boolean } {
  const parts = args.flatMap((a) => a.split(/\s+/)).filter(Boolean)
  const port = parts[0] ?? '80'
  const rest = parts.slice(1).join(' ').toLowerCase()
  return {
    port,
    ssl: rest.includes('ssl'),
    http2: rest.includes('http2'),
  }
}

function buildListen(port: string, ssl: boolean, http2: boolean): string[] {
  const parts = [port || '80']
  if (ssl) parts.push('ssl')
  if (http2) parts.push('http2')
  return [parts.join(' ')]
}

/** Parse server_name into array of domains */
function parseServerNames(args: string[]): string[] {
  const joined = args.join(' ')
  if (!joined.trim()) return []
  return joined.split(/[\s,]+/).filter(Boolean)
}

/** ssl_ciphers presets (simplified Mozilla-style) */
const SSL_CIPHER_PRESETS: Record<string, string> = {
  '': '',
  Modern:
    'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384',
  Intermediate:
    'ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256',
  Old: 'ECDHE-ECDSA-AES128-SHA:ECDHE-RSA-AES128-SHA:AES128-SHA',
}

function findPresetForCiphers(ciphers: string): string {
  for (const [name, value] of Object.entries(SSL_CIPHER_PRESETS)) {
    if (name && value === ciphers) return name
  }
  return ''
}

/** Location match modifiers */
const LOC_MODIFIERS = ['', '=', '^~', '~', '~*'] as const
const LOC_MODIFIER_LABELS: Record<string, string> = {
  '': 'Prefix',
  '=': 'Exact (=)',
  '^~': 'Preferential (^~)',
  '~': 'Regex case-sensitive (~)',
  '~*': 'Regex case-insensitive (~*)',
}

/** Parse location args to { modifier, path } */
function parseLocationArgs(args: string[]): { modifier: string; path: string } {
  const a0 = args[0] ?? ''
  if (['=', '^~', '~', '~*'].includes(a0)) {
    return { modifier: a0, path: args[1] ?? '' }
  }
  return { modifier: '', path: a0 || '/' }
}

/** Build location args from modifier + path */
function buildLocationArgs(modifier: string, path: string): string[] {
  if (!path.trim()) return ['/']
  if (modifier) return [modifier, path]
  return [path]
}

/** Common proxy header presets */
const PROXY_HEADER_PRESETS: Array<{ key: string; value: string }> = [
  { key: 'Host', value: '$host' },
  { key: 'X-Real-IP', value: '$remote_addr' },
  { key: 'X-Forwarded-For', value: '$proxy_add_x_forwarded_for' },
  { key: 'X-Forwarded-Proto', value: '$scheme' },
]

/** Websocket headers */
const WEBSOCKET_HEADERS: Array<{ key: string; value: string }> = [
  { key: 'Upgrade', value: '$http_upgrade' },
  { key: 'Connection', value: '"upgrade"' },
]

function usesUpstream(server: Node, upstreamNames: string[]): boolean {
  const locations = (server.directives ?? []).filter((d) => d.name === 'location')
  for (const loc of locations) {
    const proxyPass = getDirectiveArg(loc, 'proxy_pass', 0).trim()
    if (!proxyPass) continue
    const normalized = proxyPass.replace(/^https?:\/\//, '')
    if (upstreamNames.includes(normalized) || upstreamNames.includes(proxyPass)) {
      return true
    }
  }
  return false
}

export default function DomainsServersTab({ servers, upstreams = [], config, mode = 'all', onUpdate, readOnly }: Props) {
  const [expandedSsl, setExpandedSsl] = useState<Record<string, boolean>>({})
  const [expandedLoc, setExpandedLoc] = useState<Record<string, boolean>>({})
  const [contextMenu, setContextMenu] = useState<
    { node: Node; x: number; y: number; type: 'server' | 'location' } | null
  >(null)
  const upstreamNames = upstreams.map((u) => u.args?.[0]).filter(Boolean) as string[]

  const updateServer = (serverId: string | undefined, fn: (s: Node) => Node) => {
    if (!serverId) return
    onUpdate((c) => replaceNodeById(c, serverId, fn))
  }

  const setServerDirective = (server: Node, name: string, args: string[]) => {
    const dirs = setBlockDirective(server.directives ?? [], name, args)
    updateServer(server.id, (s) => ({ ...s, directives: dirs }))
  }

  const removeServerDirective = (server: Node, name: string) => {
    const dirs = removeBlockDirective(server.directives ?? [], name)
    updateServer(server.id, (s) => ({ ...s, directives: dirs }))
  }

  const toggleSslExpand = (id: string) => {
    setExpandedSsl((p) => ({ ...p, [id]: !p[id] }))
  }

  const toggleLocExpand = (id: string) => {
    setExpandedLoc((p) => ({ ...p, [id]: !p[id] }))
  }

  const updateLocation = (locId: string | undefined, fn: (loc: Node) => Node) => {
    if (!locId) return
    onUpdate((c) => replaceNodeById(c, locId, fn))
  }

  const setLocationDirective = (loc: Node, name: string, args: string[]) => {
    const dirs = setBlockDirective(loc.directives ?? [], name, args)
    updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
  }

  const removeLocationDirective = (loc: Node, name: string) => {
    const dirs = removeBlockDirective(loc.directives ?? [], name)
    updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
  }

  const setLocationArgs = (loc: Node, modifier: string, path: string) => {
    updateLocation(loc.id, (l) => ({
      ...l,
      args: buildLocationArgs(modifier, path),
    }))
  }

  const addLocation = (server: Node) => {
    const newLoc: Node = {
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: `location-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      directives: [],
    }
    const dirs = [...(server.directives ?? []), newLoc]
    updateServer(server.id, (s) => ({ ...s, directives: dirs }))
  }

  const removeLocation = (server: Node, loc: Node) => {
    updateServer(server.id, (s) => ({
      ...s,
      directives: (s.directives ?? []).filter((d) => d.id !== loc.id),
    }))
  }

  const handleBlockAction = (node: Node, action: BlockAction) => {
    setContextMenu(null)
    if (action === 'moveUp') onUpdate((c) => moveNodeInParent(c, node.id, 'up'))
    else if (action === 'moveDown') onUpdate((c) => moveNodeInParent(c, node.id, 'down'))
    else if (action === 'duplicate') onUpdate((c) => duplicateNode(c, node.id))
    else if (action === 'delete') onUpdate((c) => removeNodeById(c, node.id))
    else if (action === 'toggleEnabled') {
      onUpdate((c) => replaceNodeById(c, node.id, (n) => ({ ...n, enabled: !n.enabled })))
    }
  }

  const filteredServers = servers.filter((s) => {
    const linked = usesUpstream(s, upstreamNames)
    if (mode === 'with_upstream') return linked
    if (mode === 'without_upstream') return !linked
    return true
  })

  if (filteredServers.length === 0) {
    return (
      <div className="servers-empty">
        <p>
          {mode === 'with_upstream'
            ? 'No proxy hosts linked to upstreams yet.'
            : mode === 'without_upstream'
              ? 'No direct proxy hosts yet (without upstream).'
              : 'No proxy hosts yet. Define upstreams, then click + New Proxy Host.'}
        </p>
      </div>
    )
  }

  return (
    <div className={`servers-list ${readOnly ? 'read-only' : ''}`}>
      <fieldset disabled={readOnly} className="servers-fieldset">
      {filteredServers.map((server, idx) => {
        const listenArgs = getDirectiveArgs(server, 'listen')
        const { port, ssl, http2 } = parseListen(listenArgs)
        const serverNames = parseServerNames(getDirectiveArgs(server, 'server_name'))
        const root = getDirectiveArg(server, 'root', 0)
        const index = getDirectiveArg(server, 'index', 0)
        const sslCert = getDirectiveArg(server, 'ssl_certificate', 0)
        const sslKey = getDirectiveArg(server, 'ssl_certificate_key', 0)
        const sslProtocols = getDirectiveArgs(server, 'ssl_protocols').join(' ')
        const tls12 = sslProtocols.toLowerCase().includes('tlsv1.2')
        const tls13 = sslProtocols.toLowerCase().includes('tlsv1.3')
        const sslCiphers = getDirectiveArg(server, 'ssl_ciphers', 0)
        const cipherPreset = findPresetForCiphers(sslCiphers) || ''
        const redirectReturn = (server.directives ?? []).find(
          (d) =>
            d.name === 'return' &&
            d.args?.[0] === '301' &&
            String(d.args?.[1] ?? '').includes('https')
        )
        const hasRedirect = !!redirectReturn
        const locations = (server.directives ?? []).filter((d) => d.name === 'location')
        const sslOpen = expandedSsl[server.id ?? ''] ?? false
        const titleName = serverNames[0] || `${getDirectiveArg(server, 'listen', 0) || 'unnamed'}`

        return (
          <div
            key={server.id ?? idx}
            className={`server-card ${!server.enabled ? 'block-disabled' : ''}`}
            onContextMenu={
              readOnly
                ? undefined
                : (e) => {
                    e.preventDefault()
                    setContextMenu({ node: server, x: e.clientX, y: e.clientY, type: 'server' })
                  }
            }
          >
            <div className="server-card-header">
              <label className="block-enabled-toggle">
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={(e) =>
                    onUpdate((c) =>
                      replaceNodeById(c, server.id, (n) => ({ ...n, enabled: e.target.checked }))
                    )
                  }
                />
              </label>
              <span className="server-card-title">{titleName}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="btn-delete-server"
                  onClick={() => onUpdate((c) => removeNodeById(c, server.id))}
                  title="Delete proxy host"
                >
                  Delete
                </button>
              )}
            </div>

            {/* 9.1 server_name — tag input */}
            <div className="server-field">
              <label>server_name</label>
              <div className="server-name-tags">
                {serverNames.map((name, i) => (
                  <span key={i} className="tag">
                    {name}
                    <button
                      type="button"
                      className="tag-remove"
                      onClick={() => {
                        const next = [...serverNames]
                        next.splice(i, 1)
                        setServerDirective(server, 'server_name', next)
                      }}
                      title="Remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  className="tag-input"
                  placeholder="Add domain..."
                  onKeyDown={(e) => {
                    const v = (e.target as HTMLInputElement).value.trim()
                    if ((e.key === 'Enter' || e.key === ',') && v) {
                      e.preventDefault()
                      setServerDirective(server, 'server_name', [...serverNames, v])
                      ;(e.target as HTMLInputElement).value = ''
                    }
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v) {
                      setServerDirective(server, 'server_name', [...serverNames, v])
                      e.target.value = ''
                    }
                  }}
                />
              </div>
            </div>

            {/* 9.2 listen — port + ssl + http2 */}
            <div className="server-field">
              <label>listen</label>
              <div className="listen-row">
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) =>
                    setServerDirective(server, 'listen', buildListen(e.target.value, ssl, http2))
                  }
                  placeholder="80"
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={ssl}
                    onChange={(e) =>
                      setServerDirective(server, 'listen', buildListen(port, e.target.checked, http2))
                    }
                  />
                  ssl
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={http2}
                    onChange={(e) =>
                      setServerDirective(server, 'listen', buildListen(port, ssl, e.target.checked))
                    }
                  />
                  http2
                </label>
              </div>
            </div>

            {/* 9.3 root, index */}
            <div className="server-field">
              <label>root</label>
              <input
                type="text"
                value={root}
                onChange={(e) => setServerDirective(server, 'root', [e.target.value])}
                placeholder="/var/www/html"
              />
            </div>
            <div className="server-field">
              <label>index</label>
              <input
                type="text"
                value={index}
                onChange={(e) => setServerDirective(server, 'index', e.target.value.split(/\s+/).filter(Boolean))}
                placeholder="index.html index.php"
              />
            </div>

            {/* 9.4–9.7 SSL section */}
            <div className="server-ssl-section">
              <button
                type="button"
                className="ssl-section-toggle"
                onClick={() => toggleSslExpand(server.id ?? '')}
              >
                SSL / TLS {sslOpen ? '▾' : '▸'}
              </button>
              {sslOpen && (
                <div className="ssl-fields">
                  <div className="server-field">
                    <label>ssl_certificate</label>
                    <input
                      type="text"
                      value={sslCert}
                      onChange={(e) => setServerDirective(server, 'ssl_certificate', [e.target.value])}
                      placeholder="/etc/ssl/certs/cert.pem"
                    />
                  </div>
                  <div className="server-field">
                    <label>ssl_certificate_key</label>
                    <input
                      type="text"
                      value={sslKey}
                      onChange={(e) =>
                        setServerDirective(server, 'ssl_certificate_key', [e.target.value])
                      }
                      placeholder="/etc/ssl/private/key.pem"
                    />
                  </div>
                  <div className="server-field">
                    <label>ssl_protocols</label>
                    <div className="checkbox-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={tls12}
                          onChange={(e) => {
                            const protocols: string[] = []
                            if (e.target.checked) protocols.push('TLSv1.2')
                            if (tls13) protocols.push('TLSv1.3')
                            setServerDirective(server, 'ssl_protocols', protocols)
                          }}
                        />
                        TLSv1.2
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={tls13}
                          onChange={(e) => {
                            const protocols: string[] = []
                            if (tls12) protocols.push('TLSv1.2')
                            if (e.target.checked) protocols.push('TLSv1.3')
                            setServerDirective(server, 'ssl_protocols', protocols)
                          }}
                        />
                        TLSv1.3
                      </label>
                    </div>
                  </div>
                  <div className="server-field">
                    <label>ssl_ciphers</label>
                    <select
                      value={cipherPreset}
                      onChange={(e) => {
                        const preset = e.target.value
                        const val = preset ? SSL_CIPHER_PRESETS[preset] : ''
                        setServerDirective(server, 'ssl_ciphers', val ? [val] : [])
                      }}
                    >
                      <option value="">Custom</option>
                      <option value="Modern">Modern</option>
                      <option value="Intermediate">Intermediate</option>
                      <option value="Old">Old</option>
                    </select>
                    {cipherPreset === '' && (
                      <input
                        type="text"
                        className="ssl-ciphers-custom"
                        value={sslCiphers}
                        onChange={(e) =>
                          setServerDirective(server, 'ssl_ciphers', [e.target.value])
                        }
                        placeholder="Custom cipher string"
                      />
                    )}
                  </div>
                  <div className="server-field">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={hasRedirect}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const others = (server.directives ?? []).filter((d) => d.name !== 'return')
                            const dirs = [
                              ...others,
                              {
                                type: 'directive' as const,
                                name: 'return',
                                args: ['301', 'https://$host$request_uri'],
                                enabled: true,
                              },
                            ]
                            updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                          } else {
                            const dirs = (server.directives ?? []).filter(
                              (d) =>
                                !(
                                  d.name === 'return' &&
                                  d.args?.[0] === '301' &&
                                  String(d.args?.[1] ?? '').includes('https')
                                )
                            )
                            updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                          }
                        }}
                      />
                      SSL redirect (return 301 https://...)
                    </label>
                  </div>
                  {/* 9.8 Let's Encrypt */}
                  <div className="server-field letsencrypt-note">
                    <label>Let&apos;s Encrypt</label>
                    <p className="note">
                      Use certbot to obtain certificates, then set the paths above. Full certbot
                      integration planned.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Section 10: Location Block UI */}
            <div className="locations">
              <div className="locations-header">
                <span className="locations-label">Locations</span>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn-add-location"
                    onClick={() => addLocation(server)}
                  >
                    + Add location
                  </button>
                )}
              </div>
              {locations.map((loc, li) => {
                const { modifier, path } = parseLocationArgs(loc.args ?? [])
                const proxyPassVal = getDirectiveArg(loc, 'proxy_pass', 0)
                const proxyHeaders = (loc.directives ?? [])
                  .filter((d) => d.name === 'proxy_set_header')
                  .map((d) => ({ key: d.args?.[0] ?? '', value: d.args?.[1] ?? '' }))
                const rewrite = getDirective(loc, 'rewrite')
                const rewritePattern = rewrite?.args?.[0] ?? ''
                const rewriteReplacement = rewrite?.args?.[1] ?? ''
                const returnDir = getDirective(loc, 'return')
                const returnCode = returnDir?.args?.[0] ?? ''
                const returnUrl = returnDir?.args?.[1] ?? ''
                const proxyBuffering = getDirective(loc, 'proxy_buffering')
                const bufferingOn = (proxyBuffering?.args?.[0] ?? 'on').toLowerCase() !== 'off'
                const bufferSize = getDirectiveArg(loc, 'proxy_buffer_size', 0)
                const locOpen = expandedLoc[loc.id ?? `loc-${li}`] ?? false

                return (
                  <div
                    key={loc.id ?? li}
                    className={`location-card ${!loc.enabled ? 'location-disabled' : ''}`}
                    onContextMenu={
                      readOnly
                        ? undefined
                        : (e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setContextMenu({ node: loc, x: e.clientX, y: e.clientY, type: 'location' })
                          }
                    }
                  >
                    <div className="location-header">
                      <button
                        type="button"
                        className="location-toggle"
                        onClick={() => toggleLocExpand(loc.id ?? `loc-${li}`)}
                      >
                        {locOpen ? '▾' : '▸'} location
                      </button>
                      <div className="location-path-row">
                        <select
                          value={modifier}
                          onChange={(e) =>
                            setLocationArgs(loc, e.target.value, path)
                          }
                        >
                          {LOC_MODIFIERS.map((m) => (
                            <option key={m || 'prefix'} value={m}>
                              {(LOC_MODIFIER_LABELS[m] ?? m) || 'Prefix'}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          className="location-path-input"
                          value={path}
                          onChange={(e) => setLocationArgs(loc, modifier, e.target.value)}
                          placeholder="/ or regex"
                        />
                        <label className="checkbox-label location-enabled">
                          <input
                            type="checkbox"
                            checked={loc.enabled}
                            onChange={(e) =>
                              updateLocation(loc.id, (l) => ({
                                ...l,
                                enabled: e.target.checked,
                              }))
                            }
                          />
                          enabled
                        </label>
                        <button
                          type="button"
                          className="btn-remove-location"
                          onClick={() => removeLocation(server, loc)}
                          title="Remove location"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    {locOpen && (
                      <div className="location-fields">
                        <div className="location-field">
                          <label>proxy_pass</label>
                          <input
                            type="text"
                            list={`proxy-pass-${loc.id}`}
                            value={proxyPassVal}
                            onChange={(e) =>
                              setLocationDirective(loc, 'proxy_pass', [
                                normalizeProxyPass(e.target.value, upstreamNames),
                              ])
                            }
                            placeholder="http://backend or upstream_name"
                          />
                          <datalist id={`proxy-pass-${loc.id}`}>
                            {upstreamNames.map((n) => (
                              <option key={n} value={n} />
                            ))}
                          </datalist>
                        </div>
                        <div className="location-field">
                          <label>proxy_set_header</label>
                          <div className="header-list">
                            {proxyHeaders.map((h, hi) => (
                              <div key={hi} className="header-row">
                                <input
                                  type="text"
                                  placeholder="Header"
                                  value={h.key}
                                  onChange={(e) => {
                                    const next = [...proxyHeaders]
                                    next[hi] = { ...next[hi], key: e.target.value }
                                    const dirs = setBlockDirectivesMulti(
                                      loc.directives ?? [],
                                      'proxy_set_header',
                                      next.map((x) => ({ args: [x.key, x.value] }))
                                    )
                                    updateLocation(loc.id, (l) => ({
                                      ...l,
                                      directives: dirs,
                                    }))
                                  }}
                                />
                                <input
                                  type="text"
                                  placeholder="Value"
                                  value={h.value}
                                  onChange={(e) => {
                                    const next = [...proxyHeaders]
                                    next[hi] = { ...next[hi], value: e.target.value }
                                    const dirs = setBlockDirectivesMulti(
                                      loc.directives ?? [],
                                      'proxy_set_header',
                                      next.map((x) => ({ args: [x.key, x.value] }))
                                    )
                                    updateLocation(loc.id, (l) => ({
                                      ...l,
                                      directives: dirs,
                                    }))
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn-remove-header"
                                  onClick={() => {
                                    const next = proxyHeaders.filter((_, i) => i !== hi)
                                    const dirs = setBlockDirectivesMulti(
                                      loc.directives ?? [],
                                      'proxy_set_header',
                                      next.map((x) => ({ args: [x.key, x.value] }))
                                    )
                                    updateLocation(loc.id, (l) => ({
                                      ...l,
                                      directives: dirs,
                                    }))
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                            <div className="header-presets">
                              <button
                                type="button"
                                className="btn-preset"
                                onClick={() => {
                                  const next = [...proxyHeaders, { key: 'X-Custom-Header', value: '' }]
                                  const dirs = setBlockDirectivesMulti(
                                    loc.directives ?? [],
                                    'proxy_set_header',
                                    next.map((x) => ({ args: [x.key, x.value] }))
                                  )
                                  updateLocation(loc.id, (l) => Object.assign({}, l, { directives: dirs }))
                                }}
                              >
                                + Add header
                              </button>
                              {PROXY_HEADER_PRESETS.map((p) => (
                                <button
                                  key={p.key}
                                  type="button"
                                  className="btn-preset"
                                  onClick={() => {
                                    const next = [...proxyHeaders, { key: p.key, value: p.value }]
                                    const dirs = setBlockDirectivesMulti(
                                      loc.directives ?? [],
                                      'proxy_set_header',
                                      next.map((x) => ({ args: [x.key, x.value] }))
                                    )
                                    updateLocation(loc.id, (l) => Object.assign({}, l, { directives: dirs }))
                                  }}
                                >
                                  {'+ '}{p.key}
                                </button>
                              ))}
                              <button
                                type="button"
                                className="btn-preset btn-websocket"
                                onClick={() => {
                                  const existing = new Set(proxyHeaders.map((h) => h.key.toLowerCase()))
                                  const toAdd = WEBSOCKET_HEADERS.filter((h) => !existing.has(h.key.toLowerCase()))
                                  const next = [...proxyHeaders, ...toAdd]
                                  const dirs = setBlockDirectivesMulti(
                                    loc.directives ?? [],
                                    'proxy_set_header',
                                    next.map((x) => ({ args: [x.key, x.value] }))
                                  )
                                  updateLocation(loc.id, (l) => Object.assign({}, l, { directives: dirs }))
                                }}
                              >
                                + Websocket
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="location-field">
                          <label>rewrite</label>
                          <div className="rewrite-row">
                            <input
                              type="text"
                              placeholder="regex"
                              value={rewritePattern}
                              onChange={(e) => {
                                const repl = e.target.value
                                  ? [e.target.value, rewriteReplacement]
                                  : []
                                setLocationDirective(loc, 'rewrite', repl)
                              }}
                            />
                            <input
                              type="text"
                              placeholder="replacement"
                              value={rewriteReplacement}
                              onChange={(e) => {
                                const repl =
                                  rewritePattern || e.target.value
                                    ? [rewritePattern, e.target.value]
                                    : []
                                setLocationDirective(loc, 'rewrite', repl)
                              }}
                            />
                          </div>
                        </div>
                        <div className="location-field">
                          <label>return</label>
                          <div className="return-row">
                            <select
                              value={returnCode}
                              onChange={(e) => {
                                const code = e.target.value
                                if (code) {
                                  setLocationDirective(loc, 'return', [code, returnUrl])
                                } else {
                                  removeLocationDirective(loc, 'return')
                                }
                              }}
                            >
                              <option value="">—</option>
                              <option value="301">301</option>
                              <option value="302">302</option>
                              <option value="403">403</option>
                              <option value="404">404</option>
                              <option value="500">500</option>
                            </select>
                            {returnCode && (
                              <input
                                type="text"
                                placeholder="URL or text"
                                value={returnUrl}
                                onChange={(e) =>
                                  setLocationDirective(loc, 'return', [
                                    returnCode,
                                    e.target.value,
                                  ])
                                }
                              />
                            )}
                          </div>
                        </div>
                        <div className="location-field">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={bufferingOn}
                              onChange={(e) =>
                                setLocationDirective(loc, 'proxy_buffering', [
                                  e.target.checked ? 'on' : 'off',
                                ])
                              }
                            />
                            proxy_buffering
                          </label>
                        </div>
                        <div className="location-field">
                          <label>proxy_buffer_size</label>
                          <input
                            type="text"
                            value={bufferSize}
                            onChange={(e) =>
                              setLocationDirective(loc, 'proxy_buffer_size', [
                                e.target.value,
                              ])
                            }
                            placeholder="128k"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      </fieldset>
      {!readOnly && contextMenu && (() => {
        const pos = getBlockPosition(config, contextMenu.node.id)
        return (
          <>
            <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} />
            <BlockContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              canMoveUp={pos ? pos.index > 0 : false}
              canMoveDown={pos ? pos.index < pos.total - 1 : false}
              enabled={contextMenu.node.enabled}
              onAction={(a) => handleBlockAction(contextMenu!.node, a)}
              onClose={() => setContextMenu(null)}
            />
          </>
        )
      })()}
    </div>
  )
}
