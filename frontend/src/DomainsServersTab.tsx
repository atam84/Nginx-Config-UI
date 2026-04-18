import { useState, useEffect, useCallback } from 'react'
import {
  type ConfigFile,
  type Node,
  type CertInfo,
  fetchSSLCertificates,
  requestSSLCertificate,
  renewSSLCertificate,
} from './api'
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
import InfoIcon from './InfoIcon'
import IfConditionBuilder from './IfConditionBuilder'
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

/** F1.5 — add_header presets (response headers) */
const ADD_HEADER_PRESETS: Array<{ key: string; value: string; always: boolean }> = [
  { key: 'Strict-Transport-Security', value: '"max-age=31536000; includeSubDomains"', always: true },
  { key: 'X-Frame-Options', value: 'DENY', always: false },
  { key: 'X-Content-Type-Options', value: 'nosniff', always: false },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin', always: false },
]

/** F1.6 — full security headers bundle */
const SECURITY_HEADERS_BUNDLE: Array<{ key: string; value: string; always: boolean }> = [
  { key: 'Strict-Transport-Security', value: '"max-age=31536000; includeSubDomains; preload"', always: true },
  { key: 'X-Frame-Options', value: 'DENY', always: false },
  { key: 'X-Content-Type-Options', value: 'nosniff', always: false },
  { key: 'X-XSS-Protection', value: '"1; mode=block"', always: false },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin', always: false },
  { key: 'Permissions-Policy', value: '"camera=(), microphone=(), geolocation=()"', always: false },
  { key: 'Content-Security-Policy', value: '"default-src \'self\'"', always: false },
]

function buildAddHeaderArgs(key: string, value: string, always: boolean): string[] {
  return always ? [key, value, 'always'] : [key, value]
}

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

export default function DomainsServersTab({ servers, upstreams = [], httpBlock, config, mode = 'all', onUpdate, readOnly }: Props) {
  const [expandedSsl, setExpandedSsl] = useState<Record<string, boolean>>({})
  const [expandedLoc, setExpandedLoc] = useState<Record<string, boolean>>({})
  const [expandedProxyDefaults, setExpandedProxyDefaults] = useState<Record<string, boolean>>({})
  const [expandedAddHeaders, setExpandedAddHeaders] = useState<Record<string, boolean>>({})
  const [expandedResolver, setExpandedResolver] = useState<Record<string, boolean>>({})
  const [expandedAccessControl, setExpandedAccessControl] = useState<Record<string, boolean>>({})
  const [expandedIfBlocks, setExpandedIfBlocks] = useState<Record<string, boolean>>({})
  const [expandedAuth, setExpandedAuth] = useState<Record<string, boolean>>({})
  const [expandedErrorPages, setExpandedErrorPages] = useState<Record<string, boolean>>({})
  // §42.2 — FastCGI section per-location collapse state; defaults to open when the location already uses fastcgi_pass
  const [expandedFcgi, setExpandedFcgi] = useState<Record<string, boolean>>({})
  // §43.1 — uWSGI section per-location collapse state; defaults to open when the location already uses uwsgi_pass
  const [expandedUwsgi, setExpandedUwsgi] = useState<Record<string, boolean>>({})
  // Collapse state for top-level block cards. Default behaviour: server/nested-location collapse state
  // lives in these maps; `undefined` means "default expanded" (since users usually want to see a
  // server's body on first load — contrast with the top-level location cards which default to collapsed).
  const [collapsedServer, setCollapsedServer] = useState<Record<string, boolean>>({})
  const [collapsedNestedLoc, setCollapsedNestedLoc] = useState<Record<string, boolean>>({})
  const [resolverIPInputs, setResolverIPInputs] = useState<Record<string, string>>({})
  // Draft row counts for row-based editors, keyed by `${blockId}:${editor}`.
  // Lets the UI show empty editable rows that aren't yet committed to the config
  // (which strips empty directives as invalid nginx).
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const draftKey = (blockId: string | undefined, editor: string) => `${blockId ?? ''}:${editor}`
  const getDrafts = (blockId: string | undefined, editor: string) => drafts[draftKey(blockId, editor)] ?? 0
  const addDraft = (blockId: string | undefined, editor: string) =>
    setDrafts((p) => ({ ...p, [draftKey(blockId, editor)]: (p[draftKey(blockId, editor)] ?? 0) + 1 }))
  const removeDraft = (blockId: string | undefined, editor: string, delta = 1) =>
    setDrafts((p) => ({ ...p, [draftKey(blockId, editor)]: Math.max(0, (p[draftKey(blockId, editor)] ?? 0) - delta) }))
  const syncDrafts = (blockId: string | undefined, editor: string, beforeCommitted: number, afterCommitted: number) => {
    if (afterCommitted > beforeCommitted) removeDraft(blockId, editor, afterCommitted - beforeCommitted)
  }
  // F4.1 — Let's Encrypt state
  const [certificates, setCertificates] = useState<CertInfo[]>([])
  const [certRequestId, setCertRequestId] = useState<string | null>(null)
  const [certEmail, setCertEmail] = useState('')
  const [certWebroot, setCertWebroot] = useState('')
  const [certBusy, setCertBusy] = useState<string | null>(null)
  const [certMsg, setCertMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null)

  const loadCertificates = useCallback(() => {
    fetchSSLCertificates()
      .then((r) => setCertificates(r.certificates))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadCertificates()
  }, [loadCertificates])
  const [contextMenu, setContextMenu] = useState<
    { node: Node; x: number; y: number; type: 'server' | 'location' } | null
  >(null)
  const upstreamNames = upstreams.map((u) => u.args?.[0]).filter(Boolean) as string[]

  // F2.1 — extract rate limit zone names from http block
  const reqZoneNames = (httpBlock?.directives ?? [])
    .filter((d) => d.name === 'limit_req_zone')
    .map((d) => {
      const za = (d.args ?? []).find((a) => a.startsWith('zone=')) ?? ''
      return za.replace('zone=', '').split(':')[0]
    })
    .filter(Boolean)
  const connZoneNames = (httpBlock?.directives ?? [])
    .filter((d) => d.name === 'limit_conn_zone')
    .map((d) => {
      const za = (d.args ?? []).find((a) => a.startsWith('zone=')) ?? ''
      return za.replace('zone=', '').split(':')[0]
    })
    .filter(Boolean)
  // F2.2 — extract cache zone names from http block
  const cacheZoneNames = (httpBlock?.directives ?? [])
    .filter((d) => d.name === 'proxy_cache_path')
    .map((d) => {
      const za = (d.args ?? []).find((a) => a.startsWith('keys_zone=')) ?? ''
      return za.replace('keys_zone=', '').split(':')[0]
    })
    .filter(Boolean)
  // §42.5 — fastcgi_cache zones; nginx accepts either proxy_* or fastcgi_* zones
  // for fastcgi_cache so we union both sources. fastcgi-declared zones come first.
  const fcgiCacheOwnZoneNames = (httpBlock?.directives ?? [])
    .filter((d) => d.name === 'fastcgi_cache_path')
    .map((d) => {
      const za = (d.args ?? []).find((a) => a.startsWith('keys_zone=')) ?? ''
      return za.replace('keys_zone=', '').split(':')[0]
    })
    .filter(Boolean)
  const fcgiCacheZoneNames = Array.from(new Set([...fcgiCacheOwnZoneNames, ...cacheZoneNames]))

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

  const handleRequestCert = async (server: Node, domains: string[]) => {
    const id = server.id ?? ''
    setCertBusy(id)
    setCertMsg(null)
    try {
      const res = await requestSSLCertificate(domains, certEmail, certWebroot || undefined)
      if (res.success && res.certificate) {
        // Auto-populate ssl_certificate and ssl_certificate_key on the server block
        const dirs0 = setBlockDirective(server.directives ?? [], 'ssl_certificate', [res.certificate.cert_path])
        const dirs1 = setBlockDirective(dirs0, 'ssl_certificate_key', [res.certificate.key_path])
        updateServer(id, (s) => ({ ...s, directives: dirs1 }))
        setCertMsg({ id, text: 'Certificate issued successfully.', ok: true })
        loadCertificates()
      } else {
        setCertMsg({ id, text: res.output || 'Certificate request failed.', ok: false })
      }
    } catch (e) {
      setCertMsg({ id, text: e instanceof Error ? e.message : 'Request failed', ok: false })
    } finally {
      setCertBusy(null)
      setCertRequestId(null)
    }
  }

  const handleRenewCert = async (certName: string, serverId: string) => {
    setCertBusy(serverId)
    setCertMsg(null)
    try {
      const res = await renewSSLCertificate(certName)
      setCertMsg({
        id: serverId,
        text: res.success ? 'Renewal successful.' : res.output || 'Renewal failed.',
        ok: res.success,
      })
      if (res.success) loadCertificates()
    } catch (e) {
      setCertMsg({ id: serverId, text: e instanceof Error ? e.message : 'Renew failed', ok: false })
    } finally {
      setCertBusy(null)
    }
  }

  const toggleLocExpand = (id: string) => {
    setExpandedLoc((p) => ({ ...p, [id]: !p[id] }))
  }

  const toggleProxyDefaultsExpand = (id: string) => {
    setExpandedProxyDefaults((p) => ({ ...p, [id]: !p[id] }))
  }

  const toggleAddHeadersExpand = (id: string) => {
    setExpandedAddHeaders((p) => ({ ...p, [id]: !p[id] }))
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

  const setAccessRules = (block: Node, rules: { action: 'allow' | 'deny'; value: string }[], isServer: boolean) => {
    const dirs = (block.directives ?? []).filter((d) => d.name !== 'allow' && d.name !== 'deny')
    const ruleNodes: Node[] = rules
      .filter((r) => r.value.trim())
      .map((r) => ({ type: 'directive' as const, name: r.action, args: [r.value], enabled: true }))
    const newDirs = [...dirs, ...ruleNodes]
    if (isServer) updateServer(block.id, (s) => ({ ...s, directives: newDirs }))
    else updateLocation(block.id, (l) => ({ ...l, directives: newDirs }))
  }

  const setBlockDirectivesMultiLoc = (loc: Node, name: string, items: { args: string[] }[]) => {
    const dirs = setBlockDirectivesMulti(loc.directives ?? [], name, items)
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

        // F1.2 — per-server log + body size
        const accessLogPath  = getDirectiveArg(server, 'access_log', 0)
        const accessLogFmt   = getDirectiveArg(server, 'access_log', 1)
        const errorLogPath   = getDirectiveArg(server, 'error_log', 0)
        const errorLogLevel  = getDirectiveArg(server, 'error_log', 1)
        const clientMaxBody  = getDirectiveArg(server, 'client_max_body_size', 0)

        // F1.3 — server-level proxy defaults
        const proxyConnTimeout  = getDirectiveArg(server, 'proxy_connect_timeout', 0)
        const proxyReadTimeout  = getDirectiveArg(server, 'proxy_read_timeout', 0)
        const proxySendTimeout  = getDirectiveArg(server, 'proxy_send_timeout', 0)
        const proxyHttpVersion  = getDirectiveArg(server, 'proxy_http_version', 0)
        const proxyReqBuf       = getDirectiveArg(server, 'proxy_request_buffering', 0)
        const ignoreInvalidHdrs = getDirectiveArg(server, 'ignore_invalid_headers', 0)
        const srvProxyHeadersCommitted = (server.directives ?? [])
          .filter((d) => d.name === 'proxy_set_header')
          .map((d) => ({ key: d.args?.[0] ?? '', value: d.args?.[1] ?? '' }))
        const srvProxyHeaderDraftCount = getDrafts(server.id, 'srvProxyHeader')
        const srvProxyHeaders = [
          ...srvProxyHeadersCommitted,
          ...Array.from({ length: srvProxyHeaderDraftCount }, () => ({ key: '', value: '' })),
        ]
        const proxyDefaultsOpen = expandedProxyDefaults[server.id ?? ''] ?? false

        // F1.5 / F1.6 — server-level add_header
        const srvAddHeadersCommitted = (server.directives ?? [])
          .filter((d) => d.name === 'add_header')
          .map((d) => ({ key: d.args?.[0] ?? '', value: d.args?.[1] ?? '', always: (d.args ?? []).includes('always') }))
        const srvAddHeaderDraftCount = getDrafts(server.id, 'srvAddHeader')
        const srvAddHeaders = [
          ...srvAddHeadersCommitted,
          ...Array.from({ length: srvAddHeaderDraftCount }, () => ({ key: '', value: '', always: false })),
        ]
        const addHeadersOpen = expandedAddHeaders[server.id ?? ''] ?? false

        // F2.9 — SSL enhancements
        const sslStapling       = getDirectiveArg(server, 'ssl_stapling', 0) === 'on'
        const sslStaplingVerify = getDirectiveArg(server, 'ssl_stapling_verify', 0) === 'on'
        const sslTrustedCert    = getDirectiveArg(server, 'ssl_trusted_certificate', 0)
        const sslDhparam        = getDirectiveArg(server, 'ssl_dhparam', 0)
        const sslSessionCache   = getDirectiveArg(server, 'ssl_session_cache', 0)
        const sslSessionTimeout = getDirectiveArg(server, 'ssl_session_timeout', 0)
        const sslSessionTickets = getDirectiveArg(server, 'ssl_session_tickets', 0)

        // F2.10 — resolver settings
        const resolverDir      = (server.directives ?? []).find((d) => d.name === 'resolver')
        const resolverIPs      = (resolverDir?.args ?? []).filter((a) => !a.startsWith('valid=') && a !== 'ipv6=off')
        const resolverValid    = ((resolverDir?.args ?? []).find((a) => a.startsWith('valid=')) ?? '').replace('valid=', '')
        const resolverIpv6Off  = (resolverDir?.args ?? []).includes('ipv6=off')
        const resolverTimeout  = getDirectiveArg(server, 'resolver_timeout', 0)

        // F2.8 — access control (allow/deny)
        const srvAccessRulesCommitted = (server.directives ?? [])
          .filter((d) => d.name === 'allow' || d.name === 'deny')
          .map((d) => ({ action: d.name as 'allow' | 'deny', value: d.args?.[0] ?? '' }))
        const srvAccessRuleDraftCount = getDrafts(server.id, 'srvAccessRule')
        const srvAccessRules: Array<{ action: 'allow' | 'deny'; value: string }> = [
          ...srvAccessRulesCommitted,
          ...Array.from({ length: srvAccessRuleDraftCount }, () => ({ action: 'allow' as const, value: '' })),
        ]

        // F2.6 — if blocks
        const srvIfBlocks = (server.directives ?? []).filter((d) => d.name === 'if' && d.type === 'block')

        // F2.1 — server-level rate limiting
        const srvLimitReqDir = (server.directives ?? []).find((d) => d.name === 'limit_req')
        const srvLimitReqZone = (() => {
          const za = (srvLimitReqDir?.args ?? []).find((a) => a.startsWith('zone='))
          return za ? za.replace('zone=', '') : ''
        })()
        const srvLimitReqBurst = (() => {
          const ba = (srvLimitReqDir?.args ?? []).find((a) => a.startsWith('burst='))
          return ba ? ba.replace('burst=', '') : ''
        })()
        const srvLimitReqNodelay = (srvLimitReqDir?.args ?? []).includes('nodelay')
        const srvLimitConnDir = (server.directives ?? []).find((d) => d.name === 'limit_conn')
        const srvLimitConnZone = srvLimitConnDir?.args?.[0] ?? ''
        const srvLimitConnN = srvLimitConnDir?.args?.[1] ?? ''
        // F5.4 — auth
        const authBasic         = getDirectiveArg(server, 'auth_basic', 0)
        const authBasicUserFile = getDirectiveArg(server, 'auth_basic_user_file', 0)
        const authRequest       = getDirectiveArg(server, 'auth_request', 0)
        // F5.5 — error pages
        const srvErrorPages = (server.directives ?? [])
          .filter((d) => d.name === 'error_page')
          .map((d) => {
            const args = d.args ?? []
            const uri = args[args.length - 1] ?? ''
            const maybeCode = args[args.length - 2] ?? ''
            if (maybeCode.startsWith('=')) {
              return { codes: args.slice(0, -2).join(' '), redirect: maybeCode.slice(1), uri }
            }
            return { codes: args.slice(0, -1).join(' '), redirect: '', uri }
          })

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
            {(() => {
              const serverKey = server.id ?? `server-${idx}`
              const serverOpen = !(collapsedServer[serverKey] ?? false)
              const listenSummary = getDirectiveArg(server, 'listen', 0)
              const sslOn = (listenSummary || '').includes('ssl')
              return (
                <>
                  <div className="server-card-header">
                    <button
                      type="button"
                      className="block-collapse-toggle"
                      onClick={() => setCollapsedServer((p) => ({ ...p, [serverKey]: serverOpen }))}
                      title={serverOpen ? 'Collapse server' : 'Expand server'}
                    >
                      {serverOpen ? '▾' : '▸'}
                    </button>
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
                    {!serverOpen && (
                      <span className="block-collapsed-summary">
                        {listenSummary && <>listen <code>{listenSummary}</code></>}
                        {serverNames.length > 1 && <> · {serverNames.length} names</>}
                        {locations.length > 0 && <> · {locations.length} location{locations.length === 1 ? '' : 's'}</>}
                        {sslOn && <> · SSL</>}
                      </span>
                    )}
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
                  {serverOpen && (
                    <>
            {/* 9.1 server_name — tag input */}
            <div className="server-field">
              <label>
                server_name
                <InfoIcon text="The domain(s) this server block matches. Multiple names space-separated. Supports wildcards (*.example.com) and regex (~^api\\d+\\.example\\.com$). Use '_' or a nonexistent name as a catch-all. First non-wildcard match wins." />
              </label>
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
              <label>
                listen
                <InfoIcon text="IP:port (or just port) where this server accepts connections. Enable `ssl` for HTTPS (then fill in ssl_certificate below). `http2` upgrades HTTPS connections to HTTP/2. A server can have multiple listen directives (e.g. listen 80 and listen 443 ssl)." />
              </label>
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
              <label>
                root
                <InfoIcon text="Filesystem directory served as the document root (only for static/non-proxy sites). The final file path is root + URI, e.g. root=/var/www/html + /foo.html → /var/www/html/foo.html. Leave empty for reverse-proxy-only servers." />
              </label>
              <input
                type="text"
                value={root}
                onChange={(e) => setServerDirective(server, 'root', [e.target.value])}
                placeholder="/var/www/html"
              />
            </div>
            <div className="server-field">
              <label>
                index
                <InfoIcon text="Default files nginx tries when the request URI maps to a directory. Space-separated list in order of preference (e.g. `index.html index.php`). Only relevant when serving static files — ignored on pure reverse-proxy servers." />
              </label>
              <input
                type="text"
                value={index}
                onChange={(e) => setServerDirective(server, 'index', e.target.value.split(/\s+/).filter(Boolean))}
                placeholder="index.html index.php"
              />
            </div>

            {/* F1.2 — access_log */}
            <div className="server-field">
              <label>
                access_log
                <InfoIcon text="Path + optional format name for this server's access log. Set to `off` to disable logging entirely. The format name must match a log_format defined in HTTP Settings → Logging (or use the built-in 'combined')." />
              </label>
              <div className="server-field-row">
                <input
                  type="text"
                  value={accessLogPath}
                  onChange={(e) => {
                    const path = e.target.value
                    setServerDirective(server, 'access_log', path ? (accessLogFmt ? [path, accessLogFmt] : [path]) : [])
                  }}
                  placeholder="/var/log/nginx/access.log"
                />
                <input
                  type="text"
                  className="input-narrow"
                  value={accessLogFmt}
                  onChange={(e) => {
                    const fmt = e.target.value
                    setServerDirective(server, 'access_log', accessLogPath ? (fmt ? [accessLogPath, fmt] : [accessLogPath]) : [])
                  }}
                  placeholder="format (optional)"
                />
              </div>
            </div>

            {/* F1.2 — error_log */}
            <div className="server-field">
              <label>
                error_log
                <InfoIcon text="Path + minimum severity for this server's error log. Levels from quiet→verbose: crit, error, warn, notice, info, debug. Use warn or error in production; info/debug are very verbose and can impact performance." />
              </label>
              <div className="server-field-row">
                <input
                  type="text"
                  value={errorLogPath}
                  onChange={(e) => {
                    const path = e.target.value
                    setServerDirective(server, 'error_log', path ? (errorLogLevel ? [path, errorLogLevel] : [path]) : [])
                  }}
                  placeholder="/var/log/nginx/error.log"
                />
                <select
                  value={errorLogLevel}
                  onChange={(e) => {
                    const level = e.target.value
                    setServerDirective(server, 'error_log', errorLogPath ? (level ? [errorLogPath, level] : [errorLogPath]) : [])
                  }}
                >
                  <option value="">default</option>
                  <option value="debug">debug</option>
                  <option value="info">info</option>
                  <option value="notice">notice</option>
                  <option value="warn">warn</option>
                  <option value="error">error</option>
                  <option value="crit">crit</option>
                </select>
              </div>
            </div>

            {/* F1.2 — client_max_body_size */}
            <div className="server-field">
              <label>
                client_max_body_size
                <InfoIcon text="Max request body size accepted from the client. Requests exceeding this get 413 (Payload Too Large). Set to `0` for no limit (useful for large file uploads). Must be ≥ the largest expected upload. Overrides the http-block default for this server only." />
              </label>
              <input
                type="text"
                value={clientMaxBody}
                onChange={(e) =>
                  setServerDirective(server, 'client_max_body_size', e.target.value ? [e.target.value] : [])
                }
                placeholder="1m (0 = unlimited)"
              />
            </div>

            {/* F1.5 + F1.6 — Response Headers (add_header) */}
            <div className="server-ssl-section">
              <button
                type="button"
                className="ssl-section-toggle"
                onClick={() => toggleAddHeadersExpand(server.id ?? '')}
              >
                Response Headers (add_header) {addHeadersOpen ? '▾' : '▸'}
              </button>
              {addHeadersOpen && (() => {
                const writeSrvAddHeaders = (rows: typeof srvAddHeaders) => {
                  const items = rows.map((x) => ({ args: buildAddHeaderArgs(x.key, x.value, x.always) }))
                  const dirs = setBlockDirectivesMulti(server.directives ?? [], 'add_header', items)
                  const afterCommitted = items.filter((it) => it.args.some((a) => a.trim() !== '')).length
                  syncDrafts(server.id, 'srvAddHeader', srvAddHeadersCommitted.length, afterCommitted)
                  updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                }
                return (
                <div className="ssl-fields">
                  <div className="header-list">
                    {srvAddHeaders.map((h, hi) => (
                      <div key={hi} className="header-row">
                        <input
                          type="text"
                          placeholder="Header"
                          value={h.key}
                          onChange={(e) => {
                            const next = [...srvAddHeaders]
                            next[hi] = { ...next[hi], key: e.target.value }
                            writeSrvAddHeaders(next)
                          }}
                        />
                        <input
                          type="text"
                          placeholder="Value"
                          value={h.value}
                          onChange={(e) => {
                            const next = [...srvAddHeaders]
                            next[hi] = { ...next[hi], value: e.target.value }
                            writeSrvAddHeaders(next)
                          }}
                        />
                        <label className="checkbox-label always-label">
                          <input
                            type="checkbox"
                            checked={h.always}
                            onChange={(e) => {
                              const next = [...srvAddHeaders]
                              next[hi] = { ...next[hi], always: e.target.checked }
                              writeSrvAddHeaders(next)
                            }}
                          />
                          always
                        </label>
                        <button
                          type="button"
                          className="btn-remove-header"
                          onClick={() => {
                            if (hi >= srvAddHeadersCommitted.length) {
                              removeDraft(server.id, 'srvAddHeader')
                            } else {
                              writeSrvAddHeaders(srvAddHeaders.filter((_, i) => i !== hi))
                            }
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
                        onClick={() => addDraft(server.id, 'srvAddHeader')}
                      >
                        + Add header
                      </button>
                      {ADD_HEADER_PRESETS.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          className="btn-preset"
                          onClick={() => writeSrvAddHeaders([...srvAddHeaders, { ...p }])}
                        >
                          + {p.key}
                        </button>
                      ))}
                      {/* F1.6 — one-click security bundle */}
                      <button
                        type="button"
                        className="btn-preset btn-security-bundle"
                        onClick={() => {
                          const existingKeys = new Set(srvAddHeaders.map((h) => h.key.toLowerCase()))
                          const toAdd = SECURITY_HEADERS_BUNDLE.filter((h) => !existingKeys.has(h.key.toLowerCase()))
                          writeSrvAddHeaders([...srvAddHeaders, ...toAdd])
                        }}
                      >
                        ⚡ Apply Security Headers
                      </button>
                    </div>
                  </div>
                </div>
                )
              })()}
            </div>

            {/* 9.4–9.7 SSL section */}
            <div className="server-ssl-section">
              <div className="ssl-section-head">
                <button
                  type="button"
                  className="ssl-section-toggle"
                  onClick={() => toggleSslExpand(server.id ?? '')}
                >
                  SSL / TLS {sslOpen ? '▾' : '▸'}
                </button>
                <InfoIcon text="Per-server TLS settings. ssl_certificate/ssl_certificate_key point at the fullchain PEM and private key. Protocols TLSv1.2 + TLSv1.3 are the modern choice; legacy ones have known weaknesses. OCSP stapling (ssl_stapling on + ssl_trusted_certificate) reduces client handshake latency." />
              </div>
              {sslOpen && (
                <div className="ssl-fields">
                  <div className="server-field">
                    <label>
                      ssl_certificate
                      <InfoIcon text="Path to the PEM-encoded fullchain certificate (your cert + any intermediates). Usually /etc/letsencrypt/live/&lt;domain&gt;/fullchain.pem for Let's Encrypt. Must be readable by the nginx master process." />
                    </label>
                    <input
                      type="text"
                      value={sslCert}
                      onChange={(e) => setServerDirective(server, 'ssl_certificate', [e.target.value])}
                      placeholder="/etc/ssl/certs/cert.pem"
                    />
                  </div>
                  <div className="server-field">
                    <label>
                      ssl_certificate_key
                      <InfoIcon text="Path to the PEM-encoded private key matching the certificate above. Keep this file mode 0600 and readable by the nginx master only. Usually /etc/letsencrypt/live/&lt;domain&gt;/privkey.pem for Let's Encrypt." />
                    </label>
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
                    <label>
                      ssl_protocols
                      <InfoIcon text="Enabled TLS versions. Modern default: TLSv1.2 + TLSv1.3. TLSv1 and TLSv1.1 have known weaknesses and are deprecated — only enable if you need compatibility with very old clients. TLSv1.3 is faster and safer; keep it on." />
                    </label>
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
                    <label>
                      ssl_ciphers
                      <InfoIcon text="TLSv1.2 cipher suite list (colon-separated). Presets: Modern (TLS 1.2+ ECDHE/GCM/CHACHA20 only, strongest) · Intermediate (Mozilla's broad-compat recommendation) · Old (very legacy, avoid). TLSv1.3 ciphers are negotiated separately and aren't controlled here." />
                    </label>
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
                  {/* F4.1 — Let's Encrypt / ACME */}
                  {(() => {
                    const sid = server.id ?? ''
                    const serverNames = parseServerNames(getDirectiveArgs(server, 'server_name'))
                    // Find any existing cert that covers this server's domains
                    const matchedCert = certificates.find((cert) =>
                      serverNames.some((d) => cert.domains.includes(d))
                    )
                    const isBusy = certBusy === sid
                    const msg = certMsg?.id === sid ? certMsg : null
                    return (
                      <div className="letsencrypt-section">
                        <div className="letsencrypt-header">
                          <label>
                            Let&apos;s Encrypt
                            <InfoIcon text="Request a free 90-day TLS certificate from Let's Encrypt via certbot. The backend runs `certbot --webroot` for the listed server_names, then auto-fills the ssl_certificate/ssl_certificate_key paths. Requires the domain's DNS to resolve to this server and port 80 reachable for the HTTP-01 challenge." />
                          </label>
                          {matchedCert && (
                            <span
                              className={`cert-badge cert-badge-${matchedCert.status}`}
                              title={`Expires: ${matchedCert.expires_at ?? 'unknown'} (${matchedCert.days_left} days)`}
                            >
                              {matchedCert.status === 'valid' && '✓ Valid'}
                              {matchedCert.status === 'expiring_soon' && `⚠ Expiring (${matchedCert.days_left}d)`}
                              {matchedCert.status === 'expired' && '✗ Expired'}
                            </span>
                          )}
                        </div>
                        {certRequestId === sid ? (
                          <div className="letsencrypt-form">
                            <input
                              type="email"
                              placeholder="admin@example.com (optional)"
                              value={certEmail}
                              onChange={(e) => setCertEmail(e.target.value)}
                              className="le-input"
                            />
                            <input
                              type="text"
                              placeholder="Webroot path (leave blank for standalone)"
                              value={certWebroot}
                              onChange={(e) => setCertWebroot(e.target.value)}
                              className="le-input"
                            />
                            <div className="letsencrypt-actions">
                              <button
                                type="button"
                                className="btn-le-request"
                                disabled={isBusy || serverNames.length === 0}
                                onClick={() => handleRequestCert(server, serverNames)}
                              >
                                {isBusy ? 'Requesting…' : `Request for ${serverNames.join(', ')}`}
                              </button>
                              <button
                                type="button"
                                className="btn-le-cancel"
                                onClick={() => { setCertRequestId(null); setCertMsg(null) }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="letsencrypt-actions">
                            {!readOnly && serverNames.length > 0 && (
                              <button
                                type="button"
                                className="btn-le-request"
                                disabled={isBusy}
                                onClick={() => setCertRequestId(sid)}
                              >
                                {matchedCert ? 'Re-request Certificate' : 'Request Certificate'}
                              </button>
                            )}
                            {matchedCert && (
                              <button
                                type="button"
                                className="btn-le-renew"
                                disabled={isBusy}
                                onClick={() => handleRenewCert(matchedCert.name, sid)}
                              >
                                {isBusy ? 'Renewing…' : 'Renew Now'}
                              </button>
                            )}
                          </div>
                        )}
                        {msg && (
                          <div className={`le-message ${msg.ok ? 'le-ok' : 'le-err'}`}>
                            {msg.text}
                          </div>
                        )}
                        {serverNames.length === 0 && (
                          <p className="note">Set server_name above before requesting a certificate.</p>
                        )}
                      </div>
                    )
                  })()}

                  {/* F2.9 — SSL enhancements */}
                  <div className="ssl-enhancements">
                    <div className="proxy-timeouts-row">
                      <div className="server-field">
                        <label>ssl_session_cache</label>
                        <input type="text" value={sslSessionCache} placeholder="shared:SSL:10m"
                          onChange={(e) => setServerDirective(server, 'ssl_session_cache', e.target.value ? e.target.value.split(/\s+/).filter(Boolean) : [])} />
                      </div>
                      <div className="server-field">
                        <label>ssl_session_timeout</label>
                        <input type="text" value={sslSessionTimeout} placeholder="10m"
                          onChange={(e) => setServerDirective(server, 'ssl_session_timeout', e.target.value ? [e.target.value] : [])} />
                      </div>
                    </div>
                    <div className="proxy-timeouts-row">
                      <div className="server-field">
                        <label>
                          ssl_trusted_certificate
                          <InfoIcon text="CA chain used to verify OCSP responses when ssl_stapling is on. For Let's Encrypt, this is usually the same fullchain.pem (or chain.pem). Required for ssl_stapling_verify to work." />
                        </label>
                        <input type="text" value={sslTrustedCert} placeholder="/etc/ssl/certs/ca.pem"
                          onChange={(e) => setServerDirective(server, 'ssl_trusted_certificate', e.target.value ? [e.target.value] : [])} />
                      </div>
                      <div className="server-field">
                        <label>
                          ssl_dhparam
                          <InfoIcon text="Path to a DH parameters file used for DHE cipher suites (TLSv1.2 only). Generate once with `openssl dhparam -out dhparam.pem 2048`. With modern cipher lists that only use ECDHE (no DHE), this is not required." />
                        </label>
                        <input type="text" value={sslDhparam} placeholder="/etc/ssl/dhparam.pem"
                          onChange={(e) => setServerDirective(server, 'ssl_dhparam', e.target.value ? [e.target.value] : [])} />
                      </div>
                    </div>
                    <div className="ssl-toggles-row">
                      <label className="checkbox-label">
                        <input type="checkbox" checked={sslStapling}
                          onChange={(e) => setServerDirective(server, 'ssl_stapling', [e.target.checked ? 'on' : 'off'])} />
                        ssl_stapling
                      </label>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={sslStaplingVerify}
                          onChange={(e) => setServerDirective(server, 'ssl_stapling_verify', [e.target.checked ? 'on' : 'off'])} />
                        ssl_stapling_verify
                      </label>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={sslSessionTickets !== 'off'}
                          onChange={(e) => setServerDirective(server, 'ssl_session_tickets', [e.target.checked ? 'on' : 'off'])} />
                        ssl_session_tickets
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* F2.10 — Resolver Settings */}
            <div className="server-ssl-section">
              <button type="button" className="ssl-section-toggle"
                onClick={() => setExpandedResolver((p) => ({ ...p, [server.id ?? '']: !p[server.id ?? ''] }))}>
                Resolver {expandedResolver[server.id ?? ''] ? '▾' : '▸'}
              </button>
              {expandedResolver[server.id ?? ''] && (
                <div className="ssl-fields">
                  <div className="server-field">
                    <label>
                      resolver IPs
                      <InfoIcon text="DNS servers nginx uses to resolve upstream names at runtime (needed when proxy_pass/resolver variables contain a hostname, or for OCSP stapling). Example: 1.1.1.1 8.8.8.8. Without this, nginx only resolves names at config load time." />
                    </label>
                    <div className="tags-container">
                      {resolverIPs.map((ip, i) => (
                        <span key={i} className="server-name-tag">
                          {ip}
                          {!readOnly && (
                            <button type="button" className="tag-remove-btn"
                              onClick={() => {
                                const next = resolverIPs.filter((_, j) => j !== i)
                                const args = [...next, ...(resolverValid ? [`valid=${resolverValid}`] : []), ...(resolverIpv6Off ? ['ipv6=off'] : [])]
                                setServerDirective(server, 'resolver', args.length ? args : [])
                              }}>×</button>
                          )}
                        </span>
                      ))}
                      {!readOnly && (
                        <input
                          type="text"
                          className="tag-inline-input"
                          value={resolverIPInputs[server.id ?? ''] ?? ''}
                          placeholder="8.8.8.8"
                          onChange={(e) => setResolverIPInputs((p) => ({ ...p, [server.id ?? '']: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              const v = (resolverIPInputs[server.id ?? ''] ?? '').trim()
                              if (!v) return
                              const next = [...resolverIPs, v]
                              const args = [...next, ...(resolverValid ? [`valid=${resolverValid}`] : []), ...(resolverIpv6Off ? ['ipv6=off'] : [])]
                              setServerDirective(server, 'resolver', args)
                              setResolverIPInputs((p) => ({ ...p, [server.id ?? '']: '' }))
                            }
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="proxy-timeouts-row">
                    <div className="server-field">
                      <label>valid=</label>
                      <input type="text" value={resolverValid} placeholder="300s"
                        onChange={(e) => {
                          const args = [...resolverIPs, ...(e.target.value ? [`valid=${e.target.value}`] : []), ...(resolverIpv6Off ? ['ipv6=off'] : [])]
                          setServerDirective(server, 'resolver', args.length ? args : [])
                        }} />
                    </div>
                    <div className="server-field">
                      <label>
                        resolver_timeout
                        <InfoIcon text="How long nginx waits for a DNS response before giving up. Default 30s. Lower (e.g. 5s) means faster failure when DNS is broken; higher is more tolerant." />
                      </label>
                      <input type="text" value={resolverTimeout} placeholder="30s"
                        onChange={(e) => setServerDirective(server, 'resolver_timeout', e.target.value ? [e.target.value] : [])} />
                    </div>
                    <label className="checkbox-label" style={{ alignSelf: 'flex-end', paddingBottom: '0.45rem' }}>
                      <input type="checkbox" checked={resolverIpv6Off}
                        onChange={(e) => {
                          const args = [...resolverIPs, ...(resolverValid ? [`valid=${resolverValid}`] : []), ...(e.target.checked ? ['ipv6=off'] : [])]
                          setServerDirective(server, 'resolver', args.length ? args : [])
                        }} />
                      ipv6=off
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* F1.3 — Server-level Proxy Defaults */}
            <div className="server-ssl-section">
              <div className="ssl-section-head">
                <button
                  type="button"
                  className="ssl-section-toggle"
                  onClick={() => toggleProxyDefaultsExpand(server.id ?? '')}
                >
                  Proxy Defaults {proxyDefaultsOpen ? '▾' : '▸'}
                </button>
                <InfoIcon text="Directives that apply to every location inside this server that does proxy_pass (unless the location overrides them). Good place to set timeouts, HTTP version, and identity headers (Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto) once instead of repeating them per location." />
                {!readOnly && (
                  <button
                    type="button"
                    className="btn-preset btn-proxy-defaults"
                    title="Sets reasonable timeouts, HTTP 1.1, Connection reuse, and the standard identity headers (Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto)."
                    onClick={() => {
                      const existingHeaderKeys = new Set(srvProxyHeaders.map((h) => h.key.toLowerCase()))
                      const desiredHeaders = [
                        { key: 'Host', value: '$host' },
                        { key: 'X-Real-IP', value: '$remote_addr' },
                        { key: 'X-Forwarded-For', value: '$proxy_add_x_forwarded_for' },
                        { key: 'X-Forwarded-Proto', value: '$scheme' },
                        { key: 'Connection', value: '' },
                      ]
                      const merged = [
                        ...srvProxyHeaders,
                        ...desiredHeaders.filter((h) => !existingHeaderKeys.has(h.key.toLowerCase())),
                      ]
                      let dirs = server.directives ?? []
                      dirs = setBlockDirectivesMulti(dirs, 'proxy_set_header', merged.map((x) => ({ args: x.value === '' ? [x.key, '""'] : [x.key, x.value] })))
                      if (!getDirectiveArg({ ...server, directives: dirs } as Node, 'proxy_connect_timeout', 0)) {
                        dirs = setBlockDirective(dirs, 'proxy_connect_timeout', ['60s'])
                      }
                      if (!getDirectiveArg({ ...server, directives: dirs } as Node, 'proxy_read_timeout', 0)) {
                        dirs = setBlockDirective(dirs, 'proxy_read_timeout', ['60s'])
                      }
                      if (!getDirectiveArg({ ...server, directives: dirs } as Node, 'proxy_send_timeout', 0)) {
                        dirs = setBlockDirective(dirs, 'proxy_send_timeout', ['60s'])
                      }
                      if (!getDirectiveArg({ ...server, directives: dirs } as Node, 'proxy_http_version', 0)) {
                        dirs = setBlockDirective(dirs, 'proxy_http_version', ['1.1'])
                      }
                      updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                      setExpandedProxyDefaults((prev) => ({ ...prev, [server.id ?? '']: true }))
                    }}
                  >
                    ⚡ Apply proxy defaults
                  </button>
                )}
              </div>
              {proxyDefaultsOpen && (
                <div className="ssl-fields">
                  {/* Timeouts row */}
                  <div className="proxy-timeouts-row">
                    <div className="server-field">
                      <label>
                        proxy_connect_timeout
                        <InfoIcon text="How long nginx waits to establish a TCP connection to the backend. Default 60s. Drop to 5s for fast-fail against healthy local backends; raise for distant or slow-to-accept services. Cannot exceed 75s in most OSes." />
                      </label>
                      <input
                        type="text"
                        value={proxyConnTimeout}
                        onChange={(e) =>
                          setServerDirective(server, 'proxy_connect_timeout', e.target.value ? [e.target.value] : [])
                        }
                        placeholder="60s"
                      />
                    </div>
                    <div className="server-field">
                      <label>
                        proxy_read_timeout
                        <InfoIcon text="Max time between two successive reads from the backend (not total request duration). Default 60s. If the backend streams slowly or takes time between chunks, raise this. Exceeding kills the connection with 504 Gateway Timeout." />
                      </label>
                      <input
                        type="text"
                        value={proxyReadTimeout}
                        onChange={(e) =>
                          setServerDirective(server, 'proxy_read_timeout', e.target.value ? [e.target.value] : [])
                        }
                        placeholder="60s"
                      />
                    </div>
                    <div className="server-field">
                      <label>
                        proxy_send_timeout
                        <InfoIcon text="Max time between two successive writes to the backend (not total request duration). Default 60s. Relevant for large uploads or slow backends accepting data slowly." />
                      </label>
                      <input
                        type="text"
                        value={proxySendTimeout}
                        onChange={(e) =>
                          setServerDirective(server, 'proxy_send_timeout', e.target.value ? [e.target.value] : [])
                        }
                        placeholder="60s"
                      />
                    </div>
                  </div>

                  {/* proxy_http_version */}
                  <div className="server-field">
                    <label>
                      proxy_http_version
                      <InfoIcon text="HTTP version used toward the backend. Default 1.0. Set 1.1 to enable keepalive/connection reuse (pair with `proxy_set_header Connection &quot;&quot;` and upstream `keepalive N`). Required for WebSocket upgrades." />
                    </label>
                    <select
                      value={proxyHttpVersion}
                      onChange={(e) =>
                        setServerDirective(server, 'proxy_http_version', e.target.value ? [e.target.value] : [])
                      }
                    >
                      <option value="">— not set —</option>
                      <option value="1.0">1.0</option>
                      <option value="1.1">1.1</option>
                    </select>
                  </div>

                  {/* Toggles */}
                  <div className="server-field">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={proxyReqBuf !== 'off'}
                        onChange={(e) =>
                          setServerDirective(server, 'proxy_request_buffering', [e.target.checked ? 'on' : 'off'])
                        }
                      />
                      proxy_request_buffering
                    </label>
                  </div>
                  <div className="server-field">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={ignoreInvalidHdrs !== 'off'}
                        onChange={(e) =>
                          setServerDirective(server, 'ignore_invalid_headers', [e.target.checked ? 'on' : 'off'])
                        }
                      />
                      ignore_invalid_headers
                    </label>
                  </div>

                  {/* Server-level proxy_set_header */}
                  {(() => {
                    const writeSrvProxyHeaders = (rows: typeof srvProxyHeaders) => {
                      const items = rows.map((x) => ({ args: [x.key, x.value] }))
                      const dirs = setBlockDirectivesMulti(server.directives ?? [], 'proxy_set_header', items)
                      const afterCommitted = items.filter((it) => it.args.some((a) => a.trim() !== '')).length
                      syncDrafts(server.id, 'srvProxyHeader', srvProxyHeadersCommitted.length, afterCommitted)
                      updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                    }
                    return (
                  <div className="server-field">
                    <label>
                      proxy_set_header (server-level)
                      <InfoIcon text="Headers to send to the backend, applying to every location in this server unless the location sets its own proxy_set_header (which replaces the server-level list entirely — nginx does not merge). Common values: Host $host · X-Real-IP $remote_addr · X-Forwarded-For $proxy_add_x_forwarded_for · X-Forwarded-Proto $scheme." />
                    </label>
                    <div className="header-list">
                      {srvProxyHeaders.map((h, hi) => (
                        <div key={hi} className="header-row">
                          <input
                            type="text"
                            placeholder="Header"
                            value={h.key}
                            onChange={(e) => {
                              const next = [...srvProxyHeaders]
                              next[hi] = { ...next[hi], key: e.target.value }
                              writeSrvProxyHeaders(next)
                            }}
                          />
                          <input
                            type="text"
                            placeholder="Value"
                            value={h.value}
                            onChange={(e) => {
                              const next = [...srvProxyHeaders]
                              next[hi] = { ...next[hi], value: e.target.value }
                              writeSrvProxyHeaders(next)
                            }}
                          />
                          <button
                            type="button"
                            className="btn-remove-header"
                            onClick={() => {
                              if (hi >= srvProxyHeadersCommitted.length) {
                                removeDraft(server.id, 'srvProxyHeader')
                              } else {
                                writeSrvProxyHeaders(srvProxyHeaders.filter((_, i) => i !== hi))
                              }
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
                          onClick={() => addDraft(server.id, 'srvProxyHeader')}
                        >
                          + Add header
                        </button>
                        {PROXY_HEADER_PRESETS.map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            className="btn-preset"
                            onClick={() => writeSrvProxyHeaders([...srvProxyHeaders, { key: p.key, value: p.value }])}
                          >
                            + {p.key}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                    )
                  })()}
                </div>
              )}
            </div>

            {/* F2.1 — Server-level Rate Limiting */}
            <div className="server-ssl-section">
              <div className="ssl-section-head">
                <div className="ssl-section-label">Rate Limiting</div>
                <InfoIcon text="Throttling at the server level. `limit_req` references a zone defined in HTTP Settings → Rate Limiting and enforces a request rate; `burst` allows short spikes before 503s, `nodelay` serves burst requests immediately. `limit_conn` caps concurrent connections per key." />
              </div>
              <div className="ssl-fields">
                <div className="server-field">
                  <label>
                    limit_req
                    <InfoIcon text="Enforces a request rate using a zone declared in HTTP Settings → Rate Limiting. `burst=N` lets short spikes queue (up to N requests) before rejecting with 503; `nodelay` serves burst requests immediately instead of pacing them." />
                  </label>
                  <div className="loc-rate-limit-row">
                    <select
                      value={srvLimitReqZone}
                      onChange={(e) => {
                        const zone = e.target.value
                        if (!zone) {
                          removeServerDirective(server, 'limit_req')
                        } else {
                          const args: string[] = [`zone=${zone}`]
                          if (srvLimitReqBurst) args.push(`burst=${srvLimitReqBurst}`)
                          if (srvLimitReqNodelay) args.push('nodelay')
                          setServerDirective(server, 'limit_req', args)
                        }
                      }}
                    >
                      <option value="">— off —</option>
                      {reqZoneNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    {srvLimitReqZone && (
                      <>
                        <input
                          type="text"
                          value={srvLimitReqBurst}
                          placeholder="burst"
                          className="loc-rate-short"
                          onChange={(e) => {
                            const args = [`zone=${srvLimitReqZone}`]
                            if (e.target.value) args.push(`burst=${e.target.value}`)
                            if (srvLimitReqNodelay) args.push('nodelay')
                            setServerDirective(server, 'limit_req', args)
                          }}
                        />
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={srvLimitReqNodelay}
                            onChange={(e) => {
                              const args = [`zone=${srvLimitReqZone}`]
                              if (srvLimitReqBurst) args.push(`burst=${srvLimitReqBurst}`)
                              if (e.target.checked) args.push('nodelay')
                              setServerDirective(server, 'limit_req', args)
                            }}
                          />
                          nodelay
                        </label>
                      </>
                    )}
                  </div>
                </div>
                <div className="server-field">
                  <label>
                    limit_conn
                    <InfoIcon text="Caps concurrent connections per key using a zone declared in HTTP Settings → Rate Limiting. Excess connections get 503. Useful for preventing single clients from hogging many connections." />
                  </label>
                  <div className="loc-rate-limit-row">
                    <select
                      value={srvLimitConnZone}
                      onChange={(e) => {
                        const zone = e.target.value
                        if (!zone) {
                          removeServerDirective(server, 'limit_conn')
                        } else {
                          setServerDirective(server, 'limit_conn', [zone, srvLimitConnN || '10'])
                        }
                      }}
                    >
                      <option value="">— off —</option>
                      {connZoneNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    {srvLimitConnZone && (
                      <input
                        type="number"
                        value={srvLimitConnN}
                        placeholder="10"
                        className="loc-rate-short"
                        min="1"
                        onChange={(e) => setServerDirective(server, 'limit_conn', [srvLimitConnZone, e.target.value])}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* F2.8 — Access Control */}
            <div className="server-ssl-section">
              <button type="button" className="ssl-section-toggle"
                onClick={() => setExpandedAccessControl((p) => ({ ...p, [server.id ?? '']: !p[server.id ?? ''] }))}>
                Access Control {expandedAccessControl[server.id ?? ''] ? '▾' : '▸'}
              </button>
              {expandedAccessControl[server.id ?? ''] && (() => {
                const writeSrvAccessRules = (rules: typeof srvAccessRules) => {
                  setAccessRules(server, rules, true)
                  const afterCommitted = rules.filter((r) => r.value.trim()).length
                  syncDrafts(server.id, 'srvAccessRule', srvAccessRulesCommitted.length, afterCommitted)
                }
                return (
                <div className="ssl-fields">
                  <div className="access-rules-list">
                    {srvAccessRules.map((rule, ri) => (
                      <div key={ri} className="access-rule-row">
                        <select value={rule.action}
                          onChange={(e) => {
                            const next = srvAccessRules.map((r, j) => j === ri ? { ...r, action: e.target.value as 'allow' | 'deny' } : r)
                            writeSrvAccessRules(next)
                          }}>
                          <option value="allow">allow</option>
                          <option value="deny">deny</option>
                        </select>
                        <input type="text" value={rule.value} placeholder="IP, CIDR, or all"
                          onChange={(e) => {
                            const next = srvAccessRules.map((r, j) => j === ri ? { ...r, value: e.target.value } : r)
                            writeSrvAccessRules(next)
                          }} />
                        <button type="button" className="btn-remove-header"
                          onClick={() => {
                            if (ri >= srvAccessRulesCommitted.length) {
                              removeDraft(server.id, 'srvAccessRule')
                            } else {
                              writeSrvAccessRules(srvAccessRules.filter((_, j) => j !== ri))
                            }
                          }}>×</button>
                        {ri > 0 && (
                          <button type="button" className="btn-reorder" title="Move up"
                            onClick={() => {
                              const next = [...srvAccessRules]
                              ;[next[ri - 1], next[ri]] = [next[ri], next[ri - 1]]
                              writeSrvAccessRules(next)
                            }}>↑</button>
                        )}
                        {ri < srvAccessRules.length - 1 && (
                          <button type="button" className="btn-reorder" title="Move down"
                            onClick={() => {
                              const next = [...srvAccessRules]
                              ;[next[ri], next[ri + 1]] = [next[ri + 1], next[ri]]
                              writeSrvAccessRules(next)
                            }}>↓</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="access-rule-presets">
                    <button type="button" className="btn-preset"
                      onClick={() => addDraft(server.id, 'srvAccessRule')}>
                      + Add rule
                    </button>
                    <button type="button" className="btn-preset"
                      onClick={() => writeSrvAccessRules([...srvAccessRules, { action: 'allow', value: 'all' }])}>
                      + Allow all
                    </button>
                    <button type="button" className="btn-preset"
                      onClick={() => writeSrvAccessRules([...srvAccessRules, { action: 'deny', value: 'all' }])}>
                      + Deny all
                    </button>
                    <button type="button" className="btn-preset"
                      onClick={() => writeSrvAccessRules([
                        ...srvAccessRules,
                        { action: 'allow', value: '10.0.0.0/8' },
                        { action: 'allow', value: '172.16.0.0/12' },
                        { action: 'allow', value: '192.168.0.0/16' },
                      ])}>
                      + Allow private
                    </button>
                  </div>
                </div>
                )
              })()}
            </div>

            {/* F2.6 — if Block Support */}
            <div className="server-ssl-section">
              <button type="button" className="ssl-section-toggle"
                onClick={() => setExpandedIfBlocks((p) => ({ ...p, [server.id ?? '']: !p[server.id ?? ''] }))}>
                If Conditions {expandedIfBlocks[server.id ?? ''] ? '▾' : '▸'}
              </button>
              {expandedIfBlocks[server.id ?? ''] && (
                <div className="ssl-fields">
                  {srvIfBlocks.map((ifBlock, ii) => {
                    const condition = (ifBlock.args ?? []).join(' ')
                    const innerDirs = (ifBlock.directives ?? []).map((d) => ({ name: d.name, args: (d.args ?? []).join(' ') }))
                    return (
                      <div key={ifBlock.id ?? ii} className="if-block-card">
                        <div className="if-block-header">
                          <span className="if-block-label">if</span>
                          <button type="button" className="btn-remove-header"
                            onClick={() => {
                              const rest = (server.directives ?? []).filter((d) => d.id !== ifBlock.id)
                              updateServer(server.id, (s) => ({ ...s, directives: rest }))
                            }}>×</button>
                        </div>
                        <IfConditionBuilder
                          value={condition}
                          readOnly={readOnly}
                          onChange={(v) => {
                            const next = srvIfBlocks.map((b, j) =>
                              j === ii ? { ...b, args: v ? [v] : [] } : b
                            )
                            const rest = (server.directives ?? []).filter((d) => !(d.name === 'if' && d.type === 'block'))
                            updateServer(server.id, (s) => ({ ...s, directives: [...rest, ...next] }))
                          }}
                        />
                        <div className="if-block-body">
                          {innerDirs.map((d, di) => (
                            <div key={di} className="if-directive-row">
                              <input type="text" value={d.name} placeholder="directive"
                                onChange={(e) => {
                                  const nextDirs = innerDirs.map((x, k) => k === di ? { ...x, name: e.target.value } : x)
                                  const next = srvIfBlocks.map((b, j) =>
                                    j === ii ? { ...b, directives: nextDirs.map((x) => ({ type: 'directive' as const, name: x.name, args: x.args ? x.args.split(/\s+/).filter(Boolean) : [], enabled: true })) } : b
                                  )
                                  const rest = (server.directives ?? []).filter((d2) => !(d2.name === 'if' && d2.type === 'block'))
                                  updateServer(server.id, (s) => ({ ...s, directives: [...rest, ...next] }))
                                }} />
                              <input type="text" value={d.args} placeholder="args"
                                onChange={(e) => {
                                  const nextDirs = innerDirs.map((x, k) => k === di ? { ...x, args: e.target.value } : x)
                                  const next = srvIfBlocks.map((b, j) =>
                                    j === ii ? { ...b, directives: nextDirs.map((x) => ({ type: 'directive' as const, name: x.name, args: x.args ? x.args.split(/\s+/).filter(Boolean) : [], enabled: true })) } : b
                                  )
                                  const rest = (server.directives ?? []).filter((d2) => !(d2.name === 'if' && d2.type === 'block'))
                                  updateServer(server.id, (s) => ({ ...s, directives: [...rest, ...next] }))
                                }} />
                              <button type="button" className="btn-remove-header"
                                onClick={() => {
                                  const nextDirs = innerDirs.filter((_, k) => k !== di)
                                  const next = srvIfBlocks.map((b, j) =>
                                    j === ii ? { ...b, directives: nextDirs.map((x) => ({ type: 'directive' as const, name: x.name, args: x.args ? x.args.split(/\s+/).filter(Boolean) : [], enabled: true })) } : b
                                  )
                                  const rest = (server.directives ?? []).filter((d2) => !(d2.name === 'if' && d2.type === 'block'))
                                  updateServer(server.id, (s) => ({ ...s, directives: [...rest, ...next] }))
                                }}>×</button>
                            </div>
                          ))}
                          <button type="button" className="btn-preset"
                            onClick={() => {
                              const nextDirs = [...innerDirs, { name: '', args: '' }]
                              const next = srvIfBlocks.map((b, j) =>
                                j === ii ? { ...b, directives: nextDirs.map((x) => ({ type: 'directive' as const, name: x.name, args: x.args ? x.args.split(/\s+/).filter(Boolean) : [], enabled: true })) } : b
                              )
                              const rest = (server.directives ?? []).filter((d2) => !(d2.name === 'if' && d2.type === 'block'))
                              updateServer(server.id, (s) => ({ ...s, directives: [...rest, ...next] }))
                            }}>+ Add directive</button>
                        </div>
                      </div>
                    )
                  })}
                  <button type="button" className="btn-preset"
                    onClick={() => {
                      const newIfBlock: Node = { type: 'block', name: 'if', args: ['($request_method = GET)'], enabled: true, id: `if-${Date.now()}`, directives: [] }
                      updateServer(server.id, (s) => ({ ...s, directives: [...(s.directives ?? []), newIfBlock] }))
                    }}>+ Add if condition</button>
                </div>
              )}
            </div>

            {/* F5.4 — Authentication */}
            <div className="server-ssl-section">
              <button type="button" className="ssl-section-toggle"
                onClick={() => setExpandedAuth((p) => ({ ...p, [server.id ?? '']: !p[server.id ?? ''] }))}>
                Authentication {expandedAuth[server.id ?? ''] ? '▾' : '▸'}
              </button>
              {expandedAuth[server.id ?? ''] && (
                <div className="ssl-fields">
                  <label className="ssl-label">auth_basic (realm)</label>
                  <input
                    type="text"
                    placeholder={'"Protected Area" or off'}
                    value={authBasic}
                    onChange={(e) => setServerDirective(server, 'auth_basic', e.target.value ? [e.target.value] : [])}
                  />
                  {authBasic && authBasic !== 'off' && (
                    <>
                      <label className="ssl-label">auth_basic_user_file</label>
                      <input
                        type="text"
                        placeholder="/etc/nginx/.htpasswd"
                        value={authBasicUserFile}
                        onChange={(e) => setServerDirective(server, 'auth_basic_user_file', e.target.value ? [e.target.value] : [])}
                      />
                    </>
                  )}
                  <label className="ssl-label">auth_request (sub-request URI)</label>
                  <input
                    type="text"
                    placeholder="/auth"
                    value={authRequest}
                    onChange={(e) => setServerDirective(server, 'auth_request', e.target.value ? [e.target.value] : [])}
                  />
                </div>
              )}
            </div>

            {/* F5.5 — Error Pages */}
            <div className="server-ssl-section">
              <button type="button" className="ssl-section-toggle"
                onClick={() => setExpandedErrorPages((p) => ({ ...p, [server.id ?? '']: !p[server.id ?? ''] }))}>
                Error Pages {expandedErrorPages[server.id ?? ''] ? '▾' : '▸'}
              </button>
              {expandedErrorPages[server.id ?? ''] && (
                <div className="ssl-fields">
                  <div className="header-list">
                    {srvErrorPages.map((row, ri) => (
                      <div key={ri} className="header-row">
                        <input
                          type="text"
                          placeholder="404 500 (codes)"
                          value={row.codes}
                          onChange={(e) => {
                            const next = srvErrorPages.map((r, j) => j === ri ? { ...r, codes: e.target.value } : r)
                            const dirs = setBlockDirectivesMulti(server.directives ?? [], 'error_page', next.map((r) => ({
                              args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                            })))
                            updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                          }}
                        />
                        <input
                          type="text"
                          placeholder="=302 (opt)"
                          value={row.redirect ? `=${row.redirect}` : ''}
                          className="loc-rate-short"
                          onChange={(e) => {
                            const val = e.target.value.replace(/^=+/, '')
                            const next = srvErrorPages.map((r, j) => j === ri ? { ...r, redirect: val } : r)
                            const dirs = setBlockDirectivesMulti(server.directives ?? [], 'error_page', next.map((r) => ({
                              args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                            })))
                            updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                          }}
                        />
                        <input
                          type="text"
                          placeholder="/error.html"
                          value={row.uri}
                          onChange={(e) => {
                            const next = srvErrorPages.map((r, j) => j === ri ? { ...r, uri: e.target.value } : r)
                            const dirs = setBlockDirectivesMulti(server.directives ?? [], 'error_page', next.map((r) => ({
                              args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                            })))
                            updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                          }}
                        />
                        <button type="button" className="btn-remove-header"
                          onClick={() => {
                            const next = srvErrorPages.filter((_, j) => j !== ri)
                            const dirs = setBlockDirectivesMulti(server.directives ?? [], 'error_page', next.map((r) => ({
                              args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                            })))
                            updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                          }}>×</button>
                      </div>
                    ))}
                    <button type="button" className="btn-preset"
                      onClick={() => {
                        const next = [...srvErrorPages, { codes: '404', redirect: '', uri: '/404.html' }]
                        const dirs = setBlockDirectivesMulti(server.directives ?? [], 'error_page', next.map((r) => ({
                          args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                        })))
                        updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                      }}>+ Add error page</button>
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
                const proxyHeadersCommitted = (loc.directives ?? [])
                  .filter((d) => d.name === 'proxy_set_header')
                  .map((d) => ({ key: d.args?.[0] ?? '', value: d.args?.[1] ?? '' }))
                const locProxyHeaderDraftCount = getDrafts(loc.id, 'locProxyHeader')
                const proxyHeaders = [
                  ...proxyHeadersCommitted,
                  ...Array.from({ length: locProxyHeaderDraftCount }, () => ({ key: '', value: '' })),
                ]
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

                // F1.4 — location proxy timeouts + cache/log controls
                const locConnTimeout = getDirectiveArg(loc, 'proxy_connect_timeout', 0)
                const locReadTimeout = getDirectiveArg(loc, 'proxy_read_timeout', 0)
                const locSendTimeout = getDirectiveArg(loc, 'proxy_send_timeout', 0)
                const locHttpVersion = getDirectiveArg(loc, 'proxy_http_version', 0)
                const cookiePath     = getDirectiveArg(loc, 'proxy_cookie_path', 0)
                const expiresVal     = getDirectiveArg(loc, 'expires', 0)
                const locAccessLog   = getDirectiveArg(loc, 'access_log', 0)
                const logNotFound    = getDirectiveArg(loc, 'log_not_found', 0)
                // F1.5 — location add_header
                const locAddHeadersCommitted = (loc.directives ?? [])
                  .filter((d) => d.name === 'add_header')
                  .map((d) => ({ key: d.args?.[0] ?? '', value: d.args?.[1] ?? '', always: (d.args ?? []).includes('always') }))
                const locAddHeaderDraftCount = getDrafts(loc.id, 'locAddHeader')
                const locAddHeaders = [
                  ...locAddHeadersCommitted,
                  ...Array.from({ length: locAddHeaderDraftCount }, () => ({ key: '', value: '', always: false })),
                ]
                // F2.1 — rate limiting
                const locLimitReqDir = (loc.directives ?? []).find((d) => d.name === 'limit_req')
                const locLimitReqZone = (() => {
                  const za = (locLimitReqDir?.args ?? []).find((a) => a.startsWith('zone='))
                  return za ? za.replace('zone=', '') : ''
                })()
                const locLimitReqBurst = (() => {
                  const ba = (locLimitReqDir?.args ?? []).find((a) => a.startsWith('burst='))
                  return ba ? ba.replace('burst=', '') : ''
                })()
                const locLimitReqNodelay = (locLimitReqDir?.args ?? []).includes('nodelay')
                const locLimitConnDir = (loc.directives ?? []).find((d) => d.name === 'limit_conn')
                const locLimitConnZone = locLimitConnDir?.args?.[0] ?? ''
                const locLimitConnN = locLimitConnDir?.args?.[1] ?? ''
                // F2.2 — proxy cache
                const locProxyCache = getDirectiveArg(loc, 'proxy_cache', 0)
                const locProxyCacheKey = getDirectiveArg(loc, 'proxy_cache_key', 0)
                const locProxyCacheBypass = getDirectiveArg(loc, 'proxy_cache_bypass', 0)
                const locProxyNoCache = getDirectiveArg(loc, 'proxy_no_cache', 0)
                const locProxyCacheValidDirs = (loc.directives ?? [])
                  .filter((d) => d.name === 'proxy_cache_valid')
                  .map((d) => ({ codes: (d.args ?? []).slice(0, -1).join(' '), duration: (d.args ?? []).slice(-1)[0] ?? '' }))
                const locProxyCacheUseStale = getDirectiveArgs(loc, 'proxy_cache_use_stale')
                // F2.8 — location access control
                const locAccessRulesCommitted = (loc.directives ?? [])
                  .filter((d) => d.name === 'allow' || d.name === 'deny')
                  .map((d) => ({ action: d.name as 'allow' | 'deny', value: d.args?.[0] ?? '' }))
                const locAccessRuleDraftCount = getDrafts(loc.id, 'locAccessRule')
                const locAccessRules: Array<{ action: 'allow' | 'deny'; value: string }> = [
                  ...locAccessRulesCommitted,
                  ...Array.from({ length: locAccessRuleDraftCount }, () => ({ action: 'allow' as const, value: '' })),
                ]
                // F2.6 — location if blocks
                const locIfBlocks = (loc.directives ?? []).filter((d) => d.name === 'if' && d.type === 'block')
                // F5.4 — auth
                const locAuthBasic         = getDirectiveArg(loc, 'auth_basic', 0)
                const locAuthBasicUserFile = getDirectiveArg(loc, 'auth_basic_user_file', 0)
                const locAuthRequest       = getDirectiveArg(loc, 'auth_request', 0)
                // F5.5 — error pages
                const locErrorPages = (loc.directives ?? [])
                  .filter((d) => d.name === 'error_page')
                  .map((d) => {
                    const args = d.args ?? []
                    const uri = args[args.length - 1] ?? ''
                    const maybeCode = args[args.length - 2] ?? ''
                    if (maybeCode.startsWith('=')) {
                      return { codes: args.slice(0, -2).join(' '), redirect: maybeCode.slice(1), uri }
                    }
                    return { codes: args.slice(0, -1).join(' '), redirect: '', uri }
                  })

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
                          <label>
                            proxy_pass
                            <InfoIcon text="Target URL to forward matching requests to. Use `http://&lt;upstream-name&gt;` to round-robin through an upstream pool, or `http://host:port` for a single backend. Trailing slash matters: `proxy_pass http://backend/` rewrites the URI, without slash it keeps the original path." />
                          </label>
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
                        {(() => {
                          const writeLocProxyHeaders = (rows: typeof proxyHeaders) => {
                            const items = rows.map((x) => ({ args: [x.key, x.value] }))
                            const dirs = setBlockDirectivesMulti(loc.directives ?? [], 'proxy_set_header', items)
                            const afterCommitted = items.filter((it) => it.args.some((a) => a.trim() !== '')).length
                            syncDrafts(loc.id, 'locProxyHeader', proxyHeadersCommitted.length, afterCommitted)
                            updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                          }
                          return (
                        <div className="location-field">
                          <label>
                            proxy_set_header
                            <InfoIcon text="Headers to send to the backend for requests matching this location. Setting any proxy_set_header at the location level REPLACES the full server-level list — nginx does not merge. If you override here, re-add the identity headers you need (Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto)." />
                          </label>
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
                                    writeLocProxyHeaders(next)
                                  }}
                                />
                                <input
                                  type="text"
                                  placeholder="Value"
                                  value={h.value}
                                  onChange={(e) => {
                                    const next = [...proxyHeaders]
                                    next[hi] = { ...next[hi], value: e.target.value }
                                    writeLocProxyHeaders(next)
                                  }}
                                />
                                <button
                                  type="button"
                                  className="btn-remove-header"
                                  onClick={() => {
                                    if (hi >= proxyHeadersCommitted.length) {
                                      removeDraft(loc.id, 'locProxyHeader')
                                    } else {
                                      writeLocProxyHeaders(proxyHeaders.filter((_, i) => i !== hi))
                                    }
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
                                onClick={() => addDraft(loc.id, 'locProxyHeader')}
                              >
                                + Add header
                              </button>
                              {PROXY_HEADER_PRESETS.map((p) => (
                                <button
                                  key={p.key}
                                  type="button"
                                  className="btn-preset"
                                  onClick={() => writeLocProxyHeaders([...proxyHeaders, { key: p.key, value: p.value }])}
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
                                  writeLocProxyHeaders([...proxyHeaders, ...toAdd])
                                }}
                              >
                                + Websocket
                              </button>
                            </div>
                          </div>
                        </div>
                          )
                        })()}
                        <div className="location-field">
                          <label>
                            rewrite
                            <InfoIcon text="Rewrites the URI using a regex → replacement. Flags: `last` (restart location matching with new URI), `break` (stop rewriting but keep processing in same location), `redirect` (302), `permanent` (301). Without a flag, processing continues through further rewrites." />
                          </label>
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
                          <label>
                            return
                            <InfoIcon text="Ends processing and returns a response immediately. Common uses: `return 301 https://$host$request_uri` (HTTP→HTTPS redirect), `return 403` (block), `return 200 'OK'` (health check). Faster than rewrite because no regex matching." />
                          </label>
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

                        {/* F1.4 — proxy timeouts */}
                        <div className="loc-timeouts-row">
                          <div className="location-field">
                            <label>
                        proxy_connect_timeout
                        <InfoIcon text="How long nginx waits to establish a TCP connection to the backend. Default 60s. Drop to 5s for fast-fail against healthy local backends; raise for distant or slow-to-accept services. Cannot exceed 75s in most OSes." />
                      </label>
                            <input
                              type="text"
                              value={locConnTimeout}
                              onChange={(e) => setLocationDirective(loc, 'proxy_connect_timeout', e.target.value ? [e.target.value] : [])}
                              placeholder="60s"
                            />
                          </div>
                          <div className="location-field">
                            <label>
                        proxy_read_timeout
                        <InfoIcon text="Max time between two successive reads from the backend (not total request duration). Default 60s. If the backend streams slowly or takes time between chunks, raise this. Exceeding kills the connection with 504 Gateway Timeout." />
                      </label>
                            <input
                              type="text"
                              value={locReadTimeout}
                              onChange={(e) => setLocationDirective(loc, 'proxy_read_timeout', e.target.value ? [e.target.value] : [])}
                              placeholder="60s"
                            />
                          </div>
                          <div className="location-field">
                            <label>
                        proxy_send_timeout
                        <InfoIcon text="Max time between two successive writes to the backend (not total request duration). Default 60s. Relevant for large uploads or slow backends accepting data slowly." />
                      </label>
                            <input
                              type="text"
                              value={locSendTimeout}
                              onChange={(e) => setLocationDirective(loc, 'proxy_send_timeout', e.target.value ? [e.target.value] : [])}
                              placeholder="60s"
                            />
                          </div>
                        </div>
                        <div className="location-field">
                          <label>
                      proxy_http_version
                      <InfoIcon text="HTTP version used toward the backend. Default 1.0. Set 1.1 to enable keepalive/connection reuse (pair with `proxy_set_header Connection &quot;&quot;` and upstream `keepalive N`). Required for WebSocket upgrades." />
                    </label>
                          <select
                            value={locHttpVersion}
                            onChange={(e) => setLocationDirective(loc, 'proxy_http_version', e.target.value ? [e.target.value] : [])}
                          >
                            <option value="">— not set —</option>
                            <option value="1.0">1.0</option>
                            <option value="1.1">1.1</option>
                          </select>
                        </div>
                        <div className="location-field">
                          <label>proxy_cookie_path</label>
                          <input
                            type="text"
                            value={cookiePath}
                            onChange={(e) => setLocationDirective(loc, 'proxy_cookie_path', e.target.value ? [e.target.value] : [])}
                            placeholder='/ "/; HttpOnly; Secure; SameSite=lax"'
                          />
                        </div>
                        <div className="location-field">
                          <label>
                            expires
                            <InfoIcon text="Sets the Expires and Cache-Control headers for responses from this location. Values: a duration (e.g. 30d, 1h), `max` (10 years), `off` (disable), or `epoch` (expired). Good for versioned static assets that never change." />
                          </label>
                          <input
                            type="text"
                            value={expiresVal}
                            onChange={(e) => setLocationDirective(loc, 'expires', e.target.value ? [e.target.value] : [])}
                            placeholder="30d, max, off, epoch"
                          />
                        </div>
                        <div className="location-field">
                          <label>
                access_log
                <InfoIcon text="Path + optional format name for this server's access log. Set to `off` to disable logging entirely. The format name must match a log_format defined in HTTP Settings → Logging (or use the built-in 'combined')." />
              </label>
                          <input
                            type="text"
                            value={locAccessLog}
                            onChange={(e) => setLocationDirective(loc, 'access_log', e.target.value ? [e.target.value] : [])}
                            placeholder="/path/to/access.log or off"
                          />
                        </div>
                        <div className="location-field">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={logNotFound !== 'off'}
                              onChange={(e) => setLocationDirective(loc, 'log_not_found', [e.target.checked ? 'on' : 'off'])}
                            />
                            log_not_found
                          </label>
                        </div>

                        {/* F1.5 — add_header (response headers) */}
                        {(() => {
                          const writeLocAddHeaders = (rows: typeof locAddHeaders) => {
                            const items = rows.map((x) => ({ args: buildAddHeaderArgs(x.key, x.value, x.always) }))
                            const dirs = setBlockDirectivesMulti(loc.directives ?? [], 'add_header', items)
                            const afterCommitted = items.filter((it) => it.args.some((a) => a.trim() !== '')).length
                            syncDrafts(loc.id, 'locAddHeader', locAddHeadersCommitted.length, afterCommitted)
                            updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                          }
                          return (
                        <div className="location-field">
                          <label>
                            add_header (response headers)
                            <InfoIcon text="Adds headers to responses this server sends. `always` applies to error responses too (4xx/5xx) — without it, only successful responses get the header. Use 'Apply Security Headers' below for a curated bundle (HSTS, CSP, X-Frame-Options, etc.)." />
                          </label>
                          <div className="header-list">
                            {locAddHeaders.map((h, hi) => (
                              <div key={hi} className="header-row">
                                <input
                                  type="text"
                                  placeholder="Header"
                                  value={h.key}
                                  onChange={(e) => {
                                    const next = [...locAddHeaders]
                                    next[hi] = { ...next[hi], key: e.target.value }
                                    writeLocAddHeaders(next)
                                  }}
                                />
                                <input
                                  type="text"
                                  placeholder="Value"
                                  value={h.value}
                                  onChange={(e) => {
                                    const next = [...locAddHeaders]
                                    next[hi] = { ...next[hi], value: e.target.value }
                                    writeLocAddHeaders(next)
                                  }}
                                />
                                <label className="checkbox-label always-label">
                                  <input
                                    type="checkbox"
                                    checked={h.always}
                                    onChange={(e) => {
                                      const next = [...locAddHeaders]
                                      next[hi] = { ...next[hi], always: e.target.checked }
                                      writeLocAddHeaders(next)
                                    }}
                                  />
                                  always
                                </label>
                                <button
                                  type="button"
                                  className="btn-remove-header"
                                  onClick={() => {
                                    if (hi >= locAddHeadersCommitted.length) {
                                      removeDraft(loc.id, 'locAddHeader')
                                    } else {
                                      writeLocAddHeaders(locAddHeaders.filter((_, i) => i !== hi))
                                    }
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
                                onClick={() => addDraft(loc.id, 'locAddHeader')}
                              >
                                + Add header
                              </button>
                              {ADD_HEADER_PRESETS.map((p) => (
                                <button
                                  key={p.key}
                                  type="button"
                                  className="btn-preset"
                                  onClick={() => writeLocAddHeaders([...locAddHeaders, { ...p }])}
                                >
                                  + {p.key}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                          )
                        })()}

                        {/* F2.1 — Rate Limiting */}
                        <div className="location-field">
                          <label>
                    limit_req
                    <InfoIcon text="Enforces a request rate using a zone declared in HTTP Settings → Rate Limiting. `burst=N` lets short spikes queue (up to N requests) before rejecting with 503; `nodelay` serves burst requests immediately instead of pacing them." />
                  </label>
                          <div className="loc-rate-limit-row">
                            <select
                              value={locLimitReqZone}
                              onChange={(e) => {
                                const zone = e.target.value
                                if (!zone) {
                                  removeLocationDirective(loc, 'limit_req')
                                } else {
                                  const args: string[] = [`zone=${zone}`]
                                  if (locLimitReqBurst) args.push(`burst=${locLimitReqBurst}`)
                                  if (locLimitReqNodelay) args.push('nodelay')
                                  setLocationDirective(loc, 'limit_req', args)
                                }
                              }}
                            >
                              <option value="">— off —</option>
                              {reqZoneNames.map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                            {locLimitReqZone && (
                              <>
                                <input
                                  type="text"
                                  value={locLimitReqBurst}
                                  placeholder="burst"
                                  className="loc-rate-short"
                                  onChange={(e) => {
                                    const args = [`zone=${locLimitReqZone}`]
                                    if (e.target.value) args.push(`burst=${e.target.value}`)
                                    if (locLimitReqNodelay) args.push('nodelay')
                                    setLocationDirective(loc, 'limit_req', args)
                                  }}
                                />
                                <label className="checkbox-label">
                                  <input
                                    type="checkbox"
                                    checked={locLimitReqNodelay}
                                    onChange={(e) => {
                                      const args = [`zone=${locLimitReqZone}`]
                                      if (locLimitReqBurst) args.push(`burst=${locLimitReqBurst}`)
                                      if (e.target.checked) args.push('nodelay')
                                      setLocationDirective(loc, 'limit_req', args)
                                    }}
                                  />
                                  nodelay
                                </label>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="location-field">
                          <label>
                    limit_conn
                    <InfoIcon text="Caps concurrent connections per key using a zone declared in HTTP Settings → Rate Limiting. Excess connections get 503. Useful for preventing single clients from hogging many connections." />
                  </label>
                          <div className="loc-rate-limit-row">
                            <select
                              value={locLimitConnZone}
                              onChange={(e) => {
                                const zone = e.target.value
                                if (!zone) {
                                  removeLocationDirective(loc, 'limit_conn')
                                } else {
                                  setLocationDirective(loc, 'limit_conn', [zone, locLimitConnN || '10'])
                                }
                              }}
                            >
                              <option value="">— off —</option>
                              {connZoneNames.map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                            {locLimitConnZone && (
                              <input
                                type="number"
                                value={locLimitConnN}
                                placeholder="10"
                                className="loc-rate-short"
                                min="1"
                                onChange={(e) => setLocationDirective(loc, 'limit_conn', [locLimitConnZone, e.target.value])}
                              />
                            )}
                          </div>
                        </div>

                        {/* F2.2 — Proxy Cache */}
                        <div className="location-field">
                          <label>
                            proxy_cache
                            <InfoIcon text="Name of a cache zone (declared in HTTP Settings → Cache Zones) that stores responses from this location. Set to `off` to disable caching here. Responses are keyed by proxy_cache_key (default: $scheme$proxy_host$request_uri)." />
                          </label>
                          <select
                            value={locProxyCache}
                            onChange={(e) => setLocationDirective(loc, 'proxy_cache', e.target.value ? [e.target.value] : [])}
                          >
                            <option value="">— not set —</option>
                            <option value="off">off</option>
                            {cacheZoneNames.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        {locProxyCache && locProxyCache !== 'off' && (
                          <>
                            <div className="location-field">
                              <label>
                                proxy_cache_valid
                                <InfoIcon text="How long to cache each response status. Common: 200 10m (success) · 301 1h (permanent redirect) · 404 1m (not-found negative cache). Multiple entries can coexist. Without this, nginx only caches responses that carry explicit Cache-Control/Expires headers." />
                              </label>
                              <div className="header-list">
                                {locProxyCacheValidDirs.map((row, ri) => (
                                  <div key={ri} className="header-row">
                                    <input
                                      type="text"
                                      placeholder="200 302 (or any)"
                                      value={row.codes}
                                      onChange={(e) => {
                                        const next = locProxyCacheValidDirs.map((r, j) =>
                                          j === ri ? { ...r, codes: e.target.value } : r
                                        )
                                        setBlockDirectivesMultiLoc(loc, 'proxy_cache_valid', next.map((r) =>
                                          ({ args: r.codes ? [...r.codes.split(/\s+/).filter(Boolean), r.duration] : [r.duration] })
                                        ))
                                      }}
                                    />
                                    <input
                                      type="text"
                                      placeholder="10m"
                                      value={row.duration}
                                      onChange={(e) => {
                                        const next = locProxyCacheValidDirs.map((r, j) =>
                                          j === ri ? { ...r, duration: e.target.value } : r
                                        )
                                        setBlockDirectivesMultiLoc(loc, 'proxy_cache_valid', next.map((r) =>
                                          ({ args: r.codes ? [...r.codes.split(/\s+/).filter(Boolean), r.duration] : [r.duration] })
                                        ))
                                      }}
                                    />
                                    <button
                                      type="button"
                                      className="btn-remove-header"
                                      onClick={() => {
                                        const next = locProxyCacheValidDirs.filter((_, j) => j !== ri)
                                        setBlockDirectivesMultiLoc(loc, 'proxy_cache_valid', next.map((r) =>
                                          ({ args: r.codes ? [...r.codes.split(/\s+/).filter(Boolean), r.duration] : [r.duration] })
                                        ))
                                      }}
                                    >×</button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  className="btn-preset"
                                  onClick={() => {
                                    const next = [...locProxyCacheValidDirs, { codes: '200 302', duration: '10m' }]
                                    setBlockDirectivesMultiLoc(loc, 'proxy_cache_valid', next.map((r) =>
                                      ({ args: r.codes ? [...r.codes.split(/\s+/).filter(Boolean), r.duration] : [r.duration] })
                                    ))
                                  }}
                                >+ Add rule</button>
                              </div>
                            </div>
                            <div className="location-field">
                              <label>proxy_cache_key</label>
                              <input
                                type="text"
                                value={locProxyCacheKey}
                                placeholder='$scheme$proxy_host$request_uri'
                                onChange={(e) => setLocationDirective(loc, 'proxy_cache_key', e.target.value ? [e.target.value] : [])}
                              />
                            </div>
                            <div className="location-field">
                              <label>proxy_cache_bypass</label>
                              <input
                                type="text"
                                value={locProxyCacheBypass}
                                placeholder='$http_pragma $http_authorization'
                                onChange={(e) => setLocationDirective(loc, 'proxy_cache_bypass', e.target.value ? e.target.value.split(/\s+/).filter(Boolean) : [])}
                              />
                            </div>
                            <div className="location-field">
                              <label>proxy_no_cache</label>
                              <input
                                type="text"
                                value={locProxyNoCache}
                                placeholder='$http_pragma $http_authorization'
                                onChange={(e) => setLocationDirective(loc, 'proxy_no_cache', e.target.value ? e.target.value.split(/\s+/).filter(Boolean) : [])}
                              />
                            </div>
                            <div className="location-field">
                              <label>proxy_cache_use_stale</label>
                              <div className="hs-checkbox-group">
                                {['error', 'timeout', 'invalid_header', 'updating', 'http_500', 'http_502', 'http_503', 'http_504'].map((opt) => (
                                  <label key={opt} className="checkbox-label">
                                    <input
                                      type="checkbox"
                                      checked={locProxyCacheUseStale.includes(opt)}
                                      onChange={(e) => {
                                        const next = e.target.checked
                                          ? [...locProxyCacheUseStale, opt]
                                          : locProxyCacheUseStale.filter((x) => x !== opt)
                                        setLocationDirective(loc, 'proxy_cache_use_stale', next)
                                      }}
                                    />
                                    {opt}
                                  </label>
                                ))}
                              </div>
                            </div>
                          </>
                        )}

                        {/* F2.8 — Location Access Control */}
                        {(() => {
                          const writeLocAccessRules = (rules: typeof locAccessRules) => {
                            setAccessRules(loc, rules, false)
                            const afterCommitted = rules.filter((r) => r.value.trim()).length
                            syncDrafts(loc.id, 'locAccessRule', locAccessRulesCommitted.length, afterCommitted)
                          }
                          return (
                        <div className="location-field">
                          <label>
                            Access Control (allow / deny)
                            <InfoIcon text="IP-based access rules evaluated in order — first match wins. Typically end with `deny all` to block anything not explicitly allowed. Rules take IPs, CIDR ranges, or `all`. Presets below insert common patterns (allow all, deny all, allow private networks)." />
                          </label>
                          <div className="access-rules-list">
                            {locAccessRules.map((rule, ri) => (
                              <div key={ri} className="access-rule-row">
                                <select value={rule.action}
                                  onChange={(e) => {
                                    const next = locAccessRules.map((r, j) => j === ri ? { ...r, action: e.target.value as 'allow' | 'deny' } : r)
                                    writeLocAccessRules(next)
                                  }}>
                                  <option value="allow">allow</option>
                                  <option value="deny">deny</option>
                                </select>
                                <input type="text" value={rule.value} placeholder="IP, CIDR, or all"
                                  onChange={(e) => {
                                    const next = locAccessRules.map((r, j) => j === ri ? { ...r, value: e.target.value } : r)
                                    writeLocAccessRules(next)
                                  }} />
                                <button type="button" className="btn-remove-header"
                                  onClick={() => {
                                    if (ri >= locAccessRulesCommitted.length) {
                                      removeDraft(loc.id, 'locAccessRule')
                                    } else {
                                      writeLocAccessRules(locAccessRules.filter((_, j) => j !== ri))
                                    }
                                  }}>×</button>
                                {ri > 0 && (
                                  <button type="button" className="btn-reorder" title="Move up"
                                    onClick={() => {
                                      const next = [...locAccessRules]
                                      ;[next[ri - 1], next[ri]] = [next[ri], next[ri - 1]]
                                      writeLocAccessRules(next)
                                    }}>↑</button>
                                )}
                                {ri < locAccessRules.length - 1 && (
                                  <button type="button" className="btn-reorder" title="Move down"
                                    onClick={() => {
                                      const next = [...locAccessRules]
                                      ;[next[ri], next[ri + 1]] = [next[ri + 1], next[ri]]
                                      writeLocAccessRules(next)
                                    }}>↓</button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="access-rule-presets">
                            <button type="button" className="btn-preset"
                              onClick={() => addDraft(loc.id, 'locAccessRule')}>
                              + Add rule
                            </button>
                            <button type="button" className="btn-preset"
                              onClick={() => writeLocAccessRules([...locAccessRules, { action: 'deny', value: 'all' }])}>
                              + Deny all
                            </button>
                          </div>
                        </div>
                          )
                        })()}

                        {/* F2.6 — Location if Blocks */}
                        <div className="location-field">
                          <label>
                            If Conditions
                            <InfoIcon text="Conditional directive blocks. ⚠ 'if is evil' inside location — use with care: only `return`, `rewrite`, `set`, and `add_header` are reliably safe there. For conditional routing prefer named locations, `map`, or moving the check to the server-level if block." />
                          </label>
                          <div className="if-blocks-warning">⚠ nginx "if is evil" — use carefully in location context</div>
                          {locIfBlocks.map((ifBlock, ii) => {
                            const condition = (ifBlock.args ?? []).join(' ')
                            const innerDirs = (ifBlock.directives ?? []).map((d) => ({ name: d.name, args: (d.args ?? []).join(' ') }))
                            return (
                              <div key={ifBlock.id ?? ii} className="if-block-card">
                                <div className="if-block-header">
                                  <span className="if-block-label">if</span>
                                  <button type="button" className="btn-remove-header"
                                    onClick={() => {
                                      const rest = (loc.directives ?? []).filter((d) => d.id !== ifBlock.id)
                                      updateLocation(loc.id, (l) => ({ ...l, directives: rest }))
                                    }}>×</button>
                                </div>
                                <IfConditionBuilder
                                  value={condition}
                                  readOnly={readOnly}
                                  onChange={(v) => {
                                    const next = locIfBlocks.map((b, j) => j === ii ? { ...b, args: v ? [v] : [] } : b)
                                    const rest = (loc.directives ?? []).filter((d) => !(d.name === 'if' && d.type === 'block'))
                                    updateLocation(loc.id, (l) => ({ ...l, directives: [...rest, ...next] }))
                                  }}
                                />
                                <div className="if-block-body">
                                  {innerDirs.map((d, di) => (
                                    <div key={di} className="if-directive-row">
                                      <input type="text" value={d.name} placeholder="directive"
                                        onChange={(e) => {
                                          const nextDirs = innerDirs.map((x, k) => k === di ? { ...x, name: e.target.value } : x)
                                          const next = locIfBlocks.map((b, j) => j === ii ? { ...b, directives: nextDirs.map((x) => ({ type: 'directive' as const, name: x.name, args: x.args ? x.args.split(/\s+/).filter(Boolean) : [], enabled: true })) } : b)
                                          const rest = (loc.directives ?? []).filter((d2) => !(d2.name === 'if' && d2.type === 'block'))
                                          updateLocation(loc.id, (l) => ({ ...l, directives: [...rest, ...next] }))
                                        }} />
                                      <input type="text" value={d.args} placeholder="args"
                                        onChange={(e) => {
                                          const nextDirs = innerDirs.map((x, k) => k === di ? { ...x, args: e.target.value } : x)
                                          const next = locIfBlocks.map((b, j) => j === ii ? { ...b, directives: nextDirs.map((x) => ({ type: 'directive' as const, name: x.name, args: x.args ? x.args.split(/\s+/).filter(Boolean) : [], enabled: true })) } : b)
                                          const rest = (loc.directives ?? []).filter((d2) => !(d2.name === 'if' && d2.type === 'block'))
                                          updateLocation(loc.id, (l) => ({ ...l, directives: [...rest, ...next] }))
                                        }} />
                                      <button type="button" className="btn-remove-header"
                                        onClick={() => {
                                          const nextDirs = innerDirs.filter((_, k) => k !== di)
                                          const next = locIfBlocks.map((b, j) => j === ii ? { ...b, directives: nextDirs.map((x) => ({ type: 'directive' as const, name: x.name, args: x.args ? x.args.split(/\s+/).filter(Boolean) : [], enabled: true })) } : b)
                                          const rest = (loc.directives ?? []).filter((d2) => !(d2.name === 'if' && d2.type === 'block'))
                                          updateLocation(loc.id, (l) => ({ ...l, directives: [...rest, ...next] }))
                                        }}>×</button>
                                    </div>
                                  ))}
                                  <button type="button" className="btn-preset"
                                    onClick={() => {
                                      const nextDirs = [...innerDirs, { name: '', args: '' }]
                                      const next = locIfBlocks.map((b, j) => j === ii ? { ...b, directives: nextDirs.map((x) => ({ type: 'directive' as const, name: x.name, args: x.args ? x.args.split(/\s+/).filter(Boolean) : [], enabled: true })) } : b)
                                      const rest = (loc.directives ?? []).filter((d2) => !(d2.name === 'if' && d2.type === 'block'))
                                      updateLocation(loc.id, (l) => ({ ...l, directives: [...rest, ...next] }))
                                    }}>+ Add directive</button>
                                </div>
                              </div>
                            )
                          })}
                          <button type="button" className="btn-preset"
                            onClick={() => {
                              const newIfBlock: Node = { type: 'block', name: 'if', args: ['($request_method = GET)'], enabled: true, id: `if-${Date.now()}`, directives: [] }
                              updateLocation(loc.id, (l) => ({ ...l, directives: [...(l.directives ?? []), newIfBlock] }))
                            }}>+ Add if condition</button>
                        </div>

                        {/* F5.4 — Auth */}
                        <div className="location-field">
                          <label>
                            auth_basic
                            <InfoIcon text="HTTP Basic Auth realm string shown in the browser prompt. Set to `off` to disable. Requires auth_basic_user_file (htpasswd). Credentials are sent base64-encoded, so only use over HTTPS." />
                          </label>
                          <input
                            type="text"
                            placeholder={'"Protected Area" or off'}
                            value={locAuthBasic}
                            onChange={(e) => setLocationDirective(loc, 'auth_basic', e.target.value ? [e.target.value] : [])}
                          />
                        </div>
                        {locAuthBasic && locAuthBasic !== 'off' && (
                          <div className="location-field">
                            <label>
                              auth_basic_user_file
                              <InfoIcon text="Path to an htpasswd-format file (`htpasswd -c /path .htpasswd user`). Must be readable by the nginx workers. Supports crypt, apr1, SHA, and SSHA password hashes." />
                            </label>
                            <input
                              type="text"
                              placeholder="/etc/nginx/.htpasswd"
                              value={locAuthBasicUserFile}
                              onChange={(e) => setLocationDirective(loc, 'auth_basic_user_file', e.target.value ? [e.target.value] : [])}
                            />
                          </div>
                        )}
                        <div className="location-field">
                          <label>
                            auth_request
                            <InfoIcon text="Delegates authentication to an internal URI (e.g. /auth). nginx makes a subrequest; if it returns 2xx the request proceeds, 401/403 rejects. Use for SSO/OAuth gateways like oauth2-proxy. The subrequest URI must be internal and forward original request info via proxy_set_header." />
                          </label>
                          <input
                            type="text"
                            placeholder="/auth"
                            value={locAuthRequest}
                            onChange={(e) => setLocationDirective(loc, 'auth_request', e.target.value ? [e.target.value] : [])}
                          />
                        </div>

                        {/* F5.5 — Error Pages */}
                        <div className="location-field">
                          <label>
                            error_page
                            <InfoIcon text="Custom handler for HTTP error codes. Examples: `error_page 404 /404.html` (show a static page), `error_page 500 502 503 504 /50x.html` (shared error page), `error_page 404 =200 /empty.json` (rewrite status to 200). The target URI can be a file or a proxied path." />
                          </label>
                          <div className="header-list">
                            {locErrorPages.map((row, ri) => (
                              <div key={ri} className="header-row">
                                <input
                                  type="text"
                                  placeholder="404 500 (codes)"
                                  value={row.codes}
                                  onChange={(e) => {
                                    const next = locErrorPages.map((r, j) => j === ri ? { ...r, codes: e.target.value } : r)
                                    setBlockDirectivesMultiLoc(loc, 'error_page', next.map((r) => ({
                                      args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                                    })))
                                  }}
                                />
                                <input
                                  type="text"
                                  placeholder="=302 (opt)"
                                  value={row.redirect ? `=${row.redirect}` : ''}
                                  className="loc-rate-short"
                                  onChange={(e) => {
                                    const val = e.target.value.replace(/^=+/, '')
                                    const next = locErrorPages.map((r, j) => j === ri ? { ...r, redirect: val } : r)
                                    setBlockDirectivesMultiLoc(loc, 'error_page', next.map((r) => ({
                                      args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                                    })))
                                  }}
                                />
                                <input
                                  type="text"
                                  placeholder="/error.html"
                                  value={row.uri}
                                  onChange={(e) => {
                                    const next = locErrorPages.map((r, j) => j === ri ? { ...r, uri: e.target.value } : r)
                                    setBlockDirectivesMultiLoc(loc, 'error_page', next.map((r) => ({
                                      args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                                    })))
                                  }}
                                />
                                <button type="button" className="btn-remove-header"
                                  onClick={() => {
                                    const next = locErrorPages.filter((_, j) => j !== ri)
                                    setBlockDirectivesMultiLoc(loc, 'error_page', next.map((r) => ({
                                      args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                                    })))
                                  }}>×</button>
                              </div>
                            ))}
                            <button type="button" className="btn-preset"
                              onClick={() => {
                                const next = [...locErrorPages, { codes: '404', redirect: '', uri: '/404.html' }]
                                setBlockDirectivesMultiLoc(loc, 'error_page', next.map((r) => ({
                                  args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                                })))
                              }}>+ Add error page</button>
                          </div>
                        </div>

                        {/* §42.2 / §42.3 — FastCGI / PHP-FPM */}
                        {(() => {
                          const fcgiPass = getDirectiveArg(loc, 'fastcgi_pass', 0)
                          const fcgiIndex = getDirectiveArg(loc, 'fastcgi_index', 0)
                          const fcgiSplit = getDirectiveArg(loc, 'fastcgi_split_path_info', 0)
                          const hasFcgiParams = (loc.directives ?? []).some(
                            (d) => d.name === 'include' && d.args?.[0] === 'fastcgi_params',
                          )
                          const fcgiParamsCommitted = (loc.directives ?? [])
                            .filter((d) => d.name === 'fastcgi_param')
                            .map((d) => ({
                              key: d.args?.[0] ?? '',
                              value: d.args?.[1] ?? '',
                              cond: d.args?.[2] ?? '',
                            }))
                          const fcgiParamDraftCount = getDrafts(loc.id, 'locFcgiParam')
                          const fcgiParams = [
                            ...fcgiParamsCommitted,
                            ...Array.from({ length: fcgiParamDraftCount }, () => ({ key: '', value: '', cond: '' })),
                          ]
                          const fcgiConnT = getDirectiveArg(loc, 'fastcgi_connect_timeout', 0)
                          const fcgiReadT = getDirectiveArg(loc, 'fastcgi_read_timeout', 0)
                          const fcgiSendT = getDirectiveArg(loc, 'fastcgi_send_timeout', 0)
                          // §42.4 — FastCGI buffers
                          const fcgiBufSize = getDirectiveArg(loc, 'fastcgi_buffer_size', 0)
                          const fcgiBuffersDir = (loc.directives ?? []).find((d) => d.name === 'fastcgi_buffers')
                          const fcgiBuffersNum = fcgiBuffersDir?.args?.[0] ?? ''
                          const fcgiBuffersSize = fcgiBuffersDir?.args?.[1] ?? ''
                          const fcgiBusyBufSize = getDirectiveArg(loc, 'fastcgi_busy_buffers_size', 0)
                          const fcgiMaxTempFile = getDirectiveArg(loc, 'fastcgi_max_temp_file_size', 0)
                          // §42.5 — FastCGI cache (location level)
                          const locFcgiCache = getDirectiveArg(loc, 'fastcgi_cache', 0)
                          const locFcgiCacheKey = getDirectiveArg(loc, 'fastcgi_cache_key', 0)
                          const locFcgiCacheValidDirs = (loc.directives ?? [])
                            .filter((d) => d.name === 'fastcgi_cache_valid')
                            .map((d) => ({ codes: (d.args ?? []).slice(0, -1).join(' '), duration: (d.args ?? []).slice(-1)[0] ?? '' }))
                          const locFcgiCacheUseStale = getDirectiveArgs(loc, 'fastcgi_cache_use_stale')
                          const fcgiKey = loc.id ?? `loc-${li}`
                          const fcgiOpen = expandedFcgi[fcgiKey] ?? Boolean(fcgiPass || fcgiIndex || fcgiSplit || hasFcgiParams || fcgiParamsCommitted.length > 0)

                          const writeFcgiParams = (rows: { key: string; value: string; cond: string }[]) => {
                            const items = rows.map((r) => {
                              const trimmedCond = r.cond?.trim() ?? ''
                              const args = [r.key, r.value]
                              if (trimmedCond) args.push(trimmedCond)
                              return { args }
                            })
                            const dirs = setBlockDirectivesMulti(loc.directives ?? [], 'fastcgi_param', items)
                            const afterCommitted = items.filter((it) => it.args.some((a) => a.trim() !== '')).length
                            syncDrafts(loc.id, 'locFcgiParam', fcgiParamsCommitted.length, afterCommitted)
                            updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                          }

                          const toggleInclude = (on: boolean) => {
                            const dirs = (loc.directives ?? []).filter(
                              (d) => !(d.name === 'include' && d.args?.[0] === 'fastcgi_params'),
                            )
                            if (on) {
                              dirs.push({ type: 'directive', name: 'include', args: ['fastcgi_params'], enabled: true })
                            }
                            updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                          }

                          return (
                            <div className="fcgi-section">
                              <button
                                type="button"
                                className="ssl-section-toggle"
                                onClick={() => setExpandedFcgi((p) => ({ ...p, [fcgiKey]: !fcgiOpen }))}
                              >
                                {fcgiOpen ? '▾' : '▸'} FastCGI / PHP-FPM
                                {Boolean(fcgiPass) && <span className="fcgi-badge"> {fcgiPass.startsWith('unix:') ? 'unix socket' : 'tcp'}</span>}
                              </button>
                              {fcgiOpen && (
                                <div className="ssl-fields">
                                  <div className="location-field">
                                    <label>
                                      fastcgi_pass
                                      <InfoIcon text="Target PHP-FPM (or other FastCGI) backend. Unix socket form: `unix:/run/php/php8.2-fpm.sock`. TCP form: `127.0.0.1:9000`. Mutually useful with — not exclusive of — `proxy_pass`, but typically a location uses one backend flow." />
                                    </label>
                                    <input
                                      type="text"
                                      value={fcgiPass}
                                      onChange={(e) =>
                                        setLocationDirective(loc, 'fastcgi_pass', e.target.value ? [e.target.value] : [])
                                      }
                                      placeholder="unix:/run/php/php8.2-fpm.sock or 127.0.0.1:9000"
                                      spellCheck={false}
                                    />
                                  </div>
                                  <div className="location-field">
                                    <label>
                                      fastcgi_index
                                      <InfoIcon text="Default index file appended to URIs that end with `/`. For PHP: `index.php`. Only takes effect when the URI maps to a directory." />
                                    </label>
                                    <input
                                      type="text"
                                      value={fcgiIndex}
                                      onChange={(e) =>
                                        setLocationDirective(loc, 'fastcgi_index', e.target.value ? [e.target.value] : [])
                                      }
                                      placeholder="index.php"
                                      spellCheck={false}
                                    />
                                  </div>
                                  <div className="location-field">
                                    <label>
                                      fastcgi_split_path_info
                                      <InfoIcon text="Regex that splits the URI into SCRIPT_NAME and PATH_INFO halves. The PHP canonical value is `^(.+\.php)(/.+)$` — first capture sets $fastcgi_script_name, second sets $fastcgi_path_info. Pair with a `fastcgi_param PATH_INFO $fastcgi_path_info` row." />
                                    </label>
                                    <input
                                      type="text"
                                      value={fcgiSplit}
                                      onChange={(e) =>
                                        setLocationDirective(loc, 'fastcgi_split_path_info', e.target.value ? [e.target.value] : [])
                                      }
                                      placeholder="^(.+\.php)(/.+)$"
                                      spellCheck={false}
                                    />
                                  </div>
                                  <div className="location-field">
                                    <label className="checkbox-label">
                                      <input
                                        type="checkbox"
                                        checked={hasFcgiParams}
                                        onChange={(e) => toggleInclude(e.target.checked)}
                                      />
                                      include fastcgi_params
                                      <InfoIcon text="Pulls in the standard bundle of CGI environment variables (SCRIPT_FILENAME, QUERY_STRING, REQUEST_METHOD, etc.) from /etc/nginx/fastcgi_params. Almost always required for PHP. Add per-request overrides below via fastcgi_param." />
                                    </label>
                                  </div>

                                  <div className="location-field">
                                    <label>
                                      fastcgi_param
                                      <InfoIcon text="Per-request environment variable passed to the FastCGI backend. First column is the variable name, second is the value (usually an nginx variable like `$document_root$fastcgi_script_name`). Third column is optional — use `if_not_empty` to skip sending the variable when empty (e.g. HTTPS)." />
                                    </label>
                                    <div className="header-list">
                                      {fcgiParams.map((p, pi) => (
                                        <div key={pi} className="header-row fcgi-param-row">
                                          <input
                                            type="text"
                                            placeholder="PARAM_NAME"
                                            value={p.key}
                                            onChange={(e) =>
                                              writeFcgiParams(
                                                fcgiParams.map((x, i) => (i === pi ? { ...x, key: e.target.value } : x)),
                                              )
                                            }
                                            spellCheck={false}
                                          />
                                          <input
                                            type="text"
                                            placeholder="$value"
                                            value={p.value}
                                            onChange={(e) =>
                                              writeFcgiParams(
                                                fcgiParams.map((x, i) => (i === pi ? { ...x, value: e.target.value } : x)),
                                              )
                                            }
                                            spellCheck={false}
                                          />
                                          <input
                                            type="text"
                                            placeholder="if_not_empty (optional)"
                                            value={p.cond}
                                            onChange={(e) =>
                                              writeFcgiParams(
                                                fcgiParams.map((x, i) => (i === pi ? { ...x, cond: e.target.value } : x)),
                                              )
                                            }
                                            spellCheck={false}
                                          />
                                          <button
                                            type="button"
                                            className="btn-remove-header"
                                            onClick={() =>
                                              writeFcgiParams(fcgiParams.filter((_, i) => i !== pi))
                                            }
                                            title="Remove param"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ))}
                                      <div className="fcgi-param-presets">
                                        <button
                                          type="button"
                                          className="btn-add-header"
                                          onClick={() => addDraft(loc.id, 'locFcgiParam')}
                                        >
                                          + Add param
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-preset"
                                          onClick={() => {
                                            const has = (k: string) => fcgiParamsCommitted.some((p) => p.key === k)
                                            const extra: { key: string; value: string; cond: string }[] = []
                                            if (!has('SCRIPT_FILENAME'))
                                              extra.push({ key: 'SCRIPT_FILENAME', value: '$document_root$fastcgi_script_name', cond: '' })
                                            if (!has('PATH_INFO'))
                                              extra.push({ key: 'PATH_INFO', value: '$fastcgi_path_info', cond: '' })
                                            if (!has('HTTPS'))
                                              extra.push({ key: 'HTTPS', value: '$https', cond: 'if_not_empty' })
                                            if (extra.length > 0) writeFcgiParams([...fcgiParamsCommitted, ...extra])
                                          }}
                                          title="Adds the common PHP params: SCRIPT_FILENAME, PATH_INFO, HTTPS"
                                        >
                                          + PHP defaults
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  {/* §42.3 — FastCGI timeouts */}
                                  <div className="loc-timeouts-row">
                                    <div className="location-field">
                                      <label>
                                        fastcgi_connect_timeout
                                        <InfoIcon text="How long nginx waits to establish the TCP/socket connection to the FastCGI backend. Default 60s. Cannot exceed 75s on most OSes. Lower for fast-fail on healthy local PHP-FPM; raise only if reaching the backend is slow." />
                                      </label>
                                      <input
                                        type="text"
                                        value={fcgiConnT}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'fastcgi_connect_timeout', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="60s"
                                      />
                                    </div>
                                    <div className="location-field">
                                      <label>
                                        fastcgi_read_timeout
                                        <InfoIcon text="Max time between two successive reads from the FastCGI backend (not total request duration). Default 60s. PHP apps that run long reports/exports often need 300s or more — exceeding kills the connection with 504." />
                                      </label>
                                      <input
                                        type="text"
                                        value={fcgiReadT}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'fastcgi_read_timeout', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="60s"
                                      />
                                    </div>
                                    <div className="location-field">
                                      <label>
                                        fastcgi_send_timeout
                                        <InfoIcon text="Max time between two successive writes to the FastCGI backend. Default 60s. Relevant for large file uploads posted to PHP." />
                                      </label>
                                      <input
                                        type="text"
                                        value={fcgiSendT}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'fastcgi_send_timeout', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="60s"
                                      />
                                    </div>
                                  </div>

                                  {/* §42.4 — FastCGI buffers */}
                                  <div className="loc-timeouts-row fcgi-buffers-row">
                                    <div className="location-field">
                                      <label>
                                        fastcgi_buffer_size
                                        <InfoIcon text="Size of the buffer used for the first part of the FastCGI response (headers). Default 4k/8k (page size). Raise to 16k or 32k if the backend sends large cookie sets or many response headers — otherwise the first read is truncated to the secondary buffers." />
                                      </label>
                                      <input
                                        type="text"
                                        value={fcgiBufSize}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'fastcgi_buffer_size', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="16k"
                                      />
                                    </div>
                                    <div className="location-field">
                                      <label>
                                        fastcgi_buffers
                                        <InfoIcon text="Number and size of the secondary buffers for the FastCGI response body. Default 8 × page-size. Two inputs: count and unit size (e.g. 16 × 16k = 256k window). Too small causes disk spilling; too large wastes RAM per connection." />
                                      </label>
                                      <div className="fcgi-buffers-pair">
                                        <input
                                          type="text"
                                          className="fcgi-buffers-num"
                                          value={fcgiBuffersNum}
                                          placeholder="16"
                                          onChange={(e) => {
                                            const num = e.target.value.trim()
                                            const size = fcgiBuffersSize.trim()
                                            if (!num && !size) {
                                              removeLocationDirective(loc, 'fastcgi_buffers')
                                            } else {
                                              setLocationDirective(loc, 'fastcgi_buffers', [num, size || '16k'])
                                            }
                                          }}
                                        />
                                        <span className="fcgi-buffers-x">×</span>
                                        <input
                                          type="text"
                                          value={fcgiBuffersSize}
                                          placeholder="16k"
                                          onChange={(e) => {
                                            const num = fcgiBuffersNum.trim()
                                            const size = e.target.value.trim()
                                            if (!num && !size) {
                                              removeLocationDirective(loc, 'fastcgi_buffers')
                                            } else {
                                              setLocationDirective(loc, 'fastcgi_buffers', [num || '16', size])
                                            }
                                          }}
                                        />
                                      </div>
                                    </div>
                                    <div className="location-field">
                                      <label>
                                        fastcgi_busy_buffers_size
                                        <InfoIcon text="Max size of buffers that can be busy sending data to the client while the backend is still writing. Typically 2 × fastcgi_buffer_size. Nginx rejects configs where this exceeds the total buffers minus one unit." />
                                      </label>
                                      <input
                                        type="text"
                                        value={fcgiBusyBufSize}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'fastcgi_busy_buffers_size', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="32k"
                                      />
                                    </div>
                                    <div className="location-field">
                                      <label>
                                        fastcgi_max_temp_file_size
                                        <InfoIcon text="Cap on how much of a response nginx will spill to a temp file when buffers are full. Default 1024m. Set `0` to disable on-disk buffering entirely (useful when responses must stream — e.g. downloads — but fastcgi_buffers must be large enough to hold peak backpressure)." />
                                      </label>
                                      <input
                                        type="text"
                                        value={fcgiMaxTempFile}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'fastcgi_max_temp_file_size', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="1024m or 0"
                                      />
                                    </div>
                                  </div>

                                  {/* §42.5 — FastCGI cache (location level) */}
                                  <div className="location-field">
                                    <label>
                                      fastcgi_cache
                                      <InfoIcon text="Name of a cache zone declared at HTTP level (see HTTP Settings → FastCGI Cache Zones, or any proxy_cache_path zone — nginx shares the on-disk format). Set to `off` to disable caching in this location. Responses are keyed by fastcgi_cache_key." />
                                    </label>
                                    <select
                                      value={locFcgiCache}
                                      onChange={(e) => setLocationDirective(loc, 'fastcgi_cache', e.target.value ? [e.target.value] : [])}
                                    >
                                      <option value="">— not set —</option>
                                      <option value="off">off</option>
                                      {fcgiCacheZoneNames.map((n) => (
                                        <option key={n} value={n}>
                                          {n}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  {locFcgiCache && locFcgiCache !== 'off' && (
                                    <>
                                      <div className="location-field">
                                        <label>
                                          fastcgi_cache_valid
                                          <InfoIcon text="How long to cache each response status. Common: 200 301 10m (success + permanent redirect) · 404 1m (negative cache). Multiple rows allowed. Without any row, nginx only caches responses that carry Cache-Control/Expires headers." />
                                        </label>
                                        <div className="header-list">
                                          {locFcgiCacheValidDirs.map((row, ri) => (
                                            <div key={ri} className="header-row fcgi-cache-valid-row">
                                              <input
                                                type="text"
                                                placeholder="200 301 302"
                                                value={row.codes}
                                                onChange={(e) => {
                                                  const next = locFcgiCacheValidDirs.map((r, j) =>
                                                    j === ri ? { ...r, codes: e.target.value } : r,
                                                  )
                                                  const items = next.map((r) => ({
                                                    args: [...r.codes.split(/\s+/).filter(Boolean), r.duration].filter(Boolean),
                                                  }))
                                                  const dirs = setBlockDirectivesMulti(loc.directives ?? [], 'fastcgi_cache_valid', items)
                                                  updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                                                }}
                                              />
                                              <input
                                                type="text"
                                                placeholder="10m"
                                                value={row.duration}
                                                onChange={(e) => {
                                                  const next = locFcgiCacheValidDirs.map((r, j) =>
                                                    j === ri ? { ...r, duration: e.target.value } : r,
                                                  )
                                                  const items = next.map((r) => ({
                                                    args: [...r.codes.split(/\s+/).filter(Boolean), r.duration].filter(Boolean),
                                                  }))
                                                  const dirs = setBlockDirectivesMulti(loc.directives ?? [], 'fastcgi_cache_valid', items)
                                                  updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                                                }}
                                              />
                                              <button
                                                type="button"
                                                className="btn-remove-header"
                                                onClick={() => {
                                                  const next = locFcgiCacheValidDirs.filter((_, j) => j !== ri)
                                                  const items = next.map((r) => ({
                                                    args: [...r.codes.split(/\s+/).filter(Boolean), r.duration].filter(Boolean),
                                                  }))
                                                  const dirs = setBlockDirectivesMulti(loc.directives ?? [], 'fastcgi_cache_valid', items)
                                                  updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                                                }}
                                                title="Remove row"
                                              >
                                                ×
                                              </button>
                                            </div>
                                          ))}
                                          <button
                                            type="button"
                                            className="btn-add-header"
                                            onClick={() => {
                                              const next = [...locFcgiCacheValidDirs, { codes: '200 301', duration: '10m' }]
                                              const items = next.map((r) => ({
                                                args: [...r.codes.split(/\s+/).filter(Boolean), r.duration].filter(Boolean),
                                              }))
                                              const dirs = setBlockDirectivesMulti(loc.directives ?? [], 'fastcgi_cache_valid', items)
                                              updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                                            }}
                                          >
                                            + Add cache_valid rule
                                          </button>
                                        </div>
                                      </div>
                                      <div className="location-field">
                                        <label>
                                          fastcgi_cache_key
                                          <InfoIcon text="The string used as the cache key. Standard PHP key: `$scheme$request_method$host$request_uri`. Include session or auth variables here only if you intend to segment cached responses per-user (usually you don't — pair with fastcgi_cache_bypass instead)." />
                                        </label>
                                        <input
                                          type="text"
                                          value={locFcgiCacheKey}
                                          onChange={(e) =>
                                            setLocationDirective(loc, 'fastcgi_cache_key', e.target.value ? [e.target.value] : [])
                                          }
                                          placeholder="$scheme$request_method$host$request_uri"
                                          spellCheck={false}
                                        />
                                      </div>
                                      <div className="location-field">
                                        <label>
                                          fastcgi_cache_use_stale
                                          <InfoIcon text="When the backend is failing, serve a stale cached copy under these conditions. `updating` alone gives cache-stampede protection; the error/timeout/http_5xx set turns nginx into a fallback layer that masks PHP-FPM outages." />
                                        </label>
                                        <div className="fcgi-use-stale-grid">
                                          {['error', 'timeout', 'invalid_header', 'updating', 'http_500', 'http_502', 'http_503', 'http_504', 'http_403', 'http_404'].map((opt) => (
                                            <label key={opt} className="checkbox-label">
                                              <input
                                                type="checkbox"
                                                checked={locFcgiCacheUseStale.includes(opt)}
                                                onChange={(e) => {
                                                  const next = e.target.checked
                                                    ? [...locFcgiCacheUseStale, opt]
                                                    : locFcgiCacheUseStale.filter((x) => x !== opt)
                                                  setLocationDirective(loc, 'fastcgi_cache_use_stale', next.length > 0 ? next : [])
                                                }}
                                              />
                                              {opt}
                                            </label>
                                          ))}
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })()}

                        {/* §43.1 — uWSGI / Python */}
                        {(() => {
                          const uwsgiPass = getDirectiveArg(loc, 'uwsgi_pass', 0)
                          const hasUwsgiParams = (loc.directives ?? []).some(
                            (d) => d.name === 'include' && d.args?.[0] === 'uwsgi_params',
                          )
                          const uwsgiParamsCommitted = (loc.directives ?? [])
                            .filter((d) => d.name === 'uwsgi_param')
                            .map((d) => ({
                              key: d.args?.[0] ?? '',
                              value: d.args?.[1] ?? '',
                              cond: d.args?.[2] ?? '',
                            }))
                          const uwsgiParamDraftCount = getDrafts(loc.id, 'locUwsgiParam')
                          const uwsgiParams = [
                            ...uwsgiParamsCommitted,
                            ...Array.from({ length: uwsgiParamDraftCount }, () => ({ key: '', value: '', cond: '' })),
                          ]
                          const uwsgiReadT = getDirectiveArg(loc, 'uwsgi_read_timeout', 0)
                          const uwsgiBuffersDir = (loc.directives ?? []).find((d) => d.name === 'uwsgi_buffers')
                          const uwsgiBuffersNum = uwsgiBuffersDir?.args?.[0] ?? ''
                          const uwsgiBuffersSize = uwsgiBuffersDir?.args?.[1] ?? ''
                          const uwsgiKey = loc.id ?? `loc-${li}`
                          const uwsgiOpen = expandedUwsgi[uwsgiKey] ?? Boolean(uwsgiPass || hasUwsgiParams || uwsgiParamsCommitted.length > 0)

                          const writeUwsgiParams = (rows: { key: string; value: string; cond: string }[]) => {
                            const items = rows.map((r) => {
                              const trimmedCond = r.cond?.trim() ?? ''
                              const args = [r.key, r.value]
                              if (trimmedCond) args.push(trimmedCond)
                              return { args }
                            })
                            const dirs = setBlockDirectivesMulti(loc.directives ?? [], 'uwsgi_param', items)
                            const afterCommitted = items.filter((it) => it.args.some((a) => a.trim() !== '')).length
                            syncDrafts(loc.id, 'locUwsgiParam', uwsgiParamsCommitted.length, afterCommitted)
                            updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                          }

                          const toggleUwsgiInclude = (on: boolean) => {
                            const dirs = (loc.directives ?? []).filter(
                              (d) => !(d.name === 'include' && d.args?.[0] === 'uwsgi_params'),
                            )
                            if (on) {
                              dirs.push({ type: 'directive', name: 'include', args: ['uwsgi_params'], enabled: true })
                            }
                            updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                          }

                          return (
                            <div className="fcgi-section">
                              <button
                                type="button"
                                className="ssl-section-toggle"
                                onClick={() => setExpandedUwsgi((p) => ({ ...p, [uwsgiKey]: !uwsgiOpen }))}
                              >
                                {uwsgiOpen ? '▾' : '▸'} uWSGI / Python
                                {Boolean(uwsgiPass) && <span className="fcgi-badge"> {uwsgiPass.startsWith('unix:') ? 'unix socket' : 'tcp'}</span>}
                              </button>
                              {uwsgiOpen && (
                                <div className="ssl-fields">
                                  <div className="location-field">
                                    <label>
                                      uwsgi_pass
                                      <InfoIcon text="uWSGI backend — either a unix socket (`unix:/run/uwsgi/django.sock`) or a TCP endpoint (`127.0.0.1:3031`). uWSGI's default protocol is NOT HTTP; point it at a uWSGI server configured with `socket` or `uwsgi-socket`, not `http-socket`. Use `proxy_pass http://…` instead for ASGI/HTTP backends like Gunicorn or Uvicorn." />
                                    </label>
                                    <input
                                      type="text"
                                      value={uwsgiPass}
                                      onChange={(e) =>
                                        setLocationDirective(loc, 'uwsgi_pass', e.target.value ? [e.target.value] : [])
                                      }
                                      placeholder="unix:/run/uwsgi/app.sock or 127.0.0.1:3031"
                                      spellCheck={false}
                                    />
                                  </div>
                                  <div className="location-field">
                                    <label className="checkbox-label">
                                      <input
                                        type="checkbox"
                                        checked={hasUwsgiParams}
                                        onChange={(e) => toggleUwsgiInclude(e.target.checked)}
                                      />
                                      include uwsgi_params
                                      <InfoIcon text="Pulls the standard uWSGI CGI-style environment bundle (REQUEST_METHOD, QUERY_STRING, PATH_INFO, SCRIPT_NAME, REMOTE_ADDR, etc.) from /etc/nginx/uwsgi_params. Required for Django/Flask/Pyramid apps run via uWSGI — without it WSGI apps won't see the request correctly." />
                                    </label>
                                  </div>

                                  <div className="location-field">
                                    <label>
                                      uwsgi_param
                                      <InfoIcon text="Per-request variable passed to the uWSGI backend. Typical overrides: `UWSGI_SCRIPT myproject.wsgi` (tells uWSGI which Python callable), or `HTTPS on if_not_empty` when TLS is terminated at nginx. Most standard variables come from include uwsgi_params — only add rows here for overrides." />
                                    </label>
                                    <div className="header-list">
                                      {uwsgiParams.map((p, pi) => (
                                        <div key={pi} className="header-row fcgi-param-row">
                                          <input
                                            type="text"
                                            placeholder="PARAM_NAME"
                                            value={p.key}
                                            onChange={(e) =>
                                              writeUwsgiParams(
                                                uwsgiParams.map((x, i) => (i === pi ? { ...x, key: e.target.value } : x)),
                                              )
                                            }
                                            spellCheck={false}
                                          />
                                          <input
                                            type="text"
                                            placeholder="$value"
                                            value={p.value}
                                            onChange={(e) =>
                                              writeUwsgiParams(
                                                uwsgiParams.map((x, i) => (i === pi ? { ...x, value: e.target.value } : x)),
                                              )
                                            }
                                            spellCheck={false}
                                          />
                                          <input
                                            type="text"
                                            placeholder="if_not_empty (optional)"
                                            value={p.cond}
                                            onChange={(e) =>
                                              writeUwsgiParams(
                                                uwsgiParams.map((x, i) => (i === pi ? { ...x, cond: e.target.value } : x)),
                                              )
                                            }
                                            spellCheck={false}
                                          />
                                          <button
                                            type="button"
                                            className="btn-remove-header"
                                            onClick={() =>
                                              writeUwsgiParams(uwsgiParams.filter((_, i) => i !== pi))
                                            }
                                            title="Remove param"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ))}
                                      <div className="fcgi-param-presets">
                                        <button
                                          type="button"
                                          className="btn-add-header"
                                          onClick={() => addDraft(loc.id, 'locUwsgiParam')}
                                        >
                                          + Add param
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-preset"
                                          onClick={() => {
                                            const has = (k: string) => uwsgiParamsCommitted.some((p) => p.key === k)
                                            const extra: { key: string; value: string; cond: string }[] = []
                                            if (!has('HTTPS'))
                                              extra.push({ key: 'HTTPS', value: '$https', cond: 'if_not_empty' })
                                            if (!has('UWSGI_SCHEME'))
                                              extra.push({ key: 'UWSGI_SCHEME', value: '$scheme', cond: '' })
                                            if (extra.length > 0) writeUwsgiParams([...uwsgiParamsCommitted, ...extra])
                                          }}
                                          title="Adds HTTPS + UWSGI_SCHEME, common when TLS terminates at nginx"
                                        >
                                          + Behind nginx TLS
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="loc-timeouts-row">
                                    <div className="location-field">
                                      <label>
                                        uwsgi_read_timeout
                                        <InfoIcon text="Max time between two successive reads from the uWSGI backend (not total request duration). Default 60s — far too short for most Django report endpoints, async Celery-triggered views, or PDF generation. 300s–600s is common; exceeding kills the connection with 504 Gateway Timeout." />
                                      </label>
                                      <input
                                        type="text"
                                        value={uwsgiReadT}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'uwsgi_read_timeout', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="300s"
                                      />
                                    </div>
                                    <div className="location-field">
                                      <label>
                                        uwsgi_buffers
                                        <InfoIcon text="Number and size of the buffers used for the uWSGI response body. Default 8 × page-size. Two inputs: count and unit size (e.g. 16 × 16k = 256k window). Raise for apps returning large JSON payloads or HTML with many cookies — otherwise nginx spills to disk or truncates." />
                                      </label>
                                      <div className="fcgi-buffers-pair">
                                        <input
                                          type="text"
                                          className="fcgi-buffers-num"
                                          value={uwsgiBuffersNum}
                                          placeholder="16"
                                          onChange={(e) => {
                                            const num = e.target.value.trim()
                                            const size = uwsgiBuffersSize.trim()
                                            if (!num && !size) {
                                              removeLocationDirective(loc, 'uwsgi_buffers')
                                            } else {
                                              setLocationDirective(loc, 'uwsgi_buffers', [num, size || '16k'])
                                            }
                                          }}
                                        />
                                        <span className="fcgi-buffers-x">×</span>
                                        <input
                                          type="text"
                                          value={uwsgiBuffersSize}
                                          placeholder="16k"
                                          onChange={(e) => {
                                            const num = uwsgiBuffersNum.trim()
                                            const size = e.target.value.trim()
                                            if (!num && !size) {
                                              removeLocationDirective(loc, 'uwsgi_buffers')
                                            } else {
                                              setLocationDirective(loc, 'uwsgi_buffers', [num || '16', size])
                                            }
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })()}

                        {/* F2.5 — Nested Location Blocks (depth 1) */}
                        {(() => {
                          const nestedLocs = (loc.directives ?? []).filter((d) => d.name === 'location')
                          return (
                            <div className="nested-locations">
                              <div className="nested-locations-header">
                                <span className="nested-locations-label">Nested Locations ({nestedLocs.length})</span>
                                {!readOnly && (
                                  <button type="button" className="btn-add-location"
                                    onClick={() => {
                                      const newNested: Node = { type: 'block', name: 'location', args: ['/nested'], enabled: true, id: `location-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, directives: [] }
                                      updateLocation(loc.id, (l) => ({ ...l, directives: [...(l.directives ?? []), newNested] }))
                                    }}>+ Add nested</button>
                                )}
                              </div>
                              {nestedLocs.map((nested, ni) => {
                                const { modifier: nm, path: np } = parseLocationArgs(nested.args ?? [])
                                const nProxyPass = getDirectiveArg(nested, 'proxy_pass', 0)
                                return (
                                  <div key={nested.id ?? ni} className="nested-location-card">
                                    <div className="nested-location-row">
                                      <select value={nm}
                                        onChange={(e) => updateLocation(nested.id, (l) => ({ ...l, args: buildLocationArgs(e.target.value, np) }))}>
                                        {LOC_MODIFIERS.map((m) => <option key={m || 'prefix'} value={m}>{(LOC_MODIFIER_LABELS[m] ?? m) || 'Prefix'}</option>)}
                                      </select>
                                      <input type="text" value={np} placeholder="/nested"
                                        onChange={(e) => updateLocation(nested.id, (l) => ({ ...l, args: buildLocationArgs(nm, e.target.value) }))} />
                                      <input type="text" value={nProxyPass} placeholder="proxy_pass"
                                        onChange={(e) => {
                                          const dirs = setBlockDirective(nested.directives ?? [], 'proxy_pass', e.target.value ? [normalizeProxyPass(e.target.value, upstreamNames)] : [])
                                          updateLocation(nested.id, (l) => ({ ...l, directives: dirs }))
                                        }} />
                                      {!readOnly && (
                                        <button type="button" className="btn-remove-location"
                                          onClick={() => updateLocation(loc.id, (l) => ({ ...l, directives: (l.directives ?? []).filter((d) => d.id !== nested.id) }))}>×</button>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
                    </>
                  )}
                </>
              )
            })()}
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
