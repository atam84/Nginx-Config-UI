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
import PromptModal from './PromptModal'
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

// §55.1 — canonical condition set for proxy_next_upstream. Order follows the
// nginx docs so the generated directive is predictable across saves. `off`
// disables failover entirely and is mutually exclusive with the others.
// `non_idempotent` additionally allows retrying POST/PUT/DELETE/PATCH/LOCK —
// dangerous for non-idempotent actions, so it's opt-in.
const PROXY_NEXT_UPSTREAM_CONDS: { key: string; label: string; info: string }[] = [
  { key: 'error',          label: 'error',          info: 'Connection error or an error communicating with the upstream (dropped TCP, RST, etc). Enabled by default.' },
  { key: 'timeout',        label: 'timeout',        info: 'Timeout while establishing a connection, sending a request, or reading the response header. Enabled by default.' },
  { key: 'invalid_header', label: 'invalid_header', info: 'Upstream returned an empty or invalid response (malformed HTTP). Usually means the backend is crashing or mis-configured.' },
  { key: 'http_500',       label: 'http_500',       info: 'Retry on 500 Internal Server Error from the upstream. Opt-in — many 500s are real app errors that should NOT be retried.' },
  { key: 'http_502',       label: 'http_502',       info: 'Retry on 502 Bad Gateway. Almost always safe — the current upstream is unreachable or returned garbage.' },
  { key: 'http_503',       label: 'http_503',       info: 'Retry on 503 Service Unavailable. Often a graceful-shutdown or overload signal from the upstream — retrying routes around it.' },
  { key: 'http_504',       label: 'http_504',       info: 'Retry on 504 Gateway Timeout (upstream exceeded proxy_read_timeout). Opt-in — retrying a slow endpoint may just hit the same problem on the next server.' },
  { key: 'http_403',       label: 'http_403',       info: 'Retry on 403 Forbidden. Rare to enable — usually 403 is a real authorization response, not a transient failure.' },
  { key: 'http_404',       label: 'http_404',       info: 'Retry on 404 Not Found. Useful when object storage / CDN origins have eventually-consistent replicas.' },
  { key: 'non_idempotent', label: 'non_idempotent', info: 'Allow retrying requests with non-idempotent methods (POST, LOCK, PATCH…). ⚠ Can cause duplicate side effects (double orders, duplicate emails). Only enable if the backend is idempotent or you accept the risk.' },
  { key: 'off',            label: 'off',            info: 'Disable failover entirely — a failed request is returned to the client with no retry. Mutually exclusive with every other condition. Use to make a location explicitly non-retrying.' },
]

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

/**
 * Parse listen directive: "443 ssl http2 quic reuseport" -> parsed flags.
 * §50.1 adds quic + reuseport. nginx canonical HTTP/3 uses two separate
 * `listen` directives (one TCP+TLS, one UDP+QUIC), but for UX simplicity we
 * expose all four flags on a single row — the server card warns when the
 * combination would need splitting.
 */
function parseListen(args: string[]): { port: string; ssl: boolean; http2: boolean; quic: boolean; reuseport: boolean } {
  const parts = args.flatMap((a) => a.split(/\s+/)).filter(Boolean)
  const port = parts[0] ?? '80'
  const rest = parts.slice(1).join(' ').toLowerCase()
  return {
    port,
    ssl: /\bssl\b/.test(rest),
    http2: /\bhttp2\b/.test(rest),
    quic: /\bquic\b/.test(rest),
    reuseport: /\breuseport\b/.test(rest),
  }
}

function buildListen(port: string, ssl: boolean, http2: boolean, quic = false, reuseport = false): string[] {
  const parts = [port || '80']
  if (ssl) parts.push('ssl')
  if (http2) parts.push('http2')
  if (quic) parts.push('quic')
  if (reuseport) parts.push('reuseport')
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

/**
 * §48.1 / §48.3 — CORS preset. Three origin-policy modes share the same
 * "shape" (methods / headers / max-age / credentials) and differ only on the
 * `Access-Control-Allow-Origin` (and `Vary`) values. The `always` flag is set
 * so CORS headers also apply to 4xx responses — a 401/403 without ACAO is the
 * classic "my preflight works but the app can't read the error body" bug.
 */
type CorsOriginMode = 'any' | 'echo' | 'explicit'

const CORS_COMMON: Array<{ key: string; value: string; always: boolean }> = [
  { key: 'Access-Control-Allow-Methods', value: '"GET, POST, PUT, PATCH, DELETE, OPTIONS"', always: true },
  { key: 'Access-Control-Allow-Headers', value: '"Authorization, Content-Type, X-Requested-With, Accept, Origin"', always: true },
  { key: 'Access-Control-Max-Age', value: '3600', always: true },
]

function buildCorsHeaders(mode: CorsOriginMode, explicitOrigin?: string): Array<{ key: string; value: string; always: boolean }> {
  const rows: Array<{ key: string; value: string; always: boolean }> = []
  if (mode === 'any') {
    // `*` is incompatible with credentials per the CORS spec, so we deliberately
    // omit Allow-Credentials in this mode.
    rows.push({ key: 'Access-Control-Allow-Origin', value: '"*"', always: true })
  } else if (mode === 'echo') {
    rows.push({ key: 'Access-Control-Allow-Origin', value: '$http_origin', always: true })
    rows.push({ key: 'Access-Control-Allow-Credentials', value: '"true"', always: true })
    rows.push({ key: 'Vary', value: 'Origin', always: true })
  } else {
    const origin = (explicitOrigin ?? '').trim() || 'https://example.com'
    const quoted = origin.startsWith('"') && origin.endsWith('"') ? origin : `"${origin}"`
    rows.push({ key: 'Access-Control-Allow-Origin', value: quoted, always: true })
    rows.push({ key: 'Access-Control-Allow-Credentials', value: '"true"', always: true })
    rows.push({ key: 'Vary', value: 'Origin', always: true })
  }
  return [...rows, ...CORS_COMMON.map((h) => ({ ...h }))]
}

/**
 * Applies a CORS preset idempotently. Strips any existing Access-Control-*
 * rows (case-insensitive) so re-clicking swaps modes instead of stacking
 * duplicates. Leaves existing non-CORS Vary rows alone when the new preset
 * doesn't need Vary: Origin (mode === 'any').
 */
function applyCorsPreset(
  existing: Array<{ key: string; value: string; always: boolean }>,
  mode: CorsOriginMode,
  explicitOrigin?: string,
): Array<{ key: string; value: string; always: boolean }> {
  const isCorsKey = (k: string) => k.toLowerCase().startsWith('access-control-')
  const newRows = buildCorsHeaders(mode, explicitOrigin)
  const addsVary = newRows.some((r) => r.key.toLowerCase() === 'vary')
  const kept = existing.filter((h) => {
    if (isCorsKey(h.key)) return false
    // Drop an existing `Vary: Origin` so the new preset owns it (avoids
    // duplicate `Vary: Origin` rows when toggling between echo/explicit modes).
    if (addsVary && h.key.toLowerCase() === 'vary' && h.value.replace(/"/g, '').trim().toLowerCase() === 'origin') {
      return false
    }
    return true
  })
  return [...kept, ...newRows]
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
  // §44.1 — gRPC section per-location collapse state; defaults to open when the location already uses grpc_pass
  const [expandedGrpc, setExpandedGrpc] = useState<Record<string, boolean>>({})
  // §45.5 — types {} block subsection per-location collapse state
  const [expandedTypes, setExpandedTypes] = useState<Record<string, boolean>>({})
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
  // §48.3 — pending CORS "explicit" origin prompt. `onConfirm` is the
  // scope-specific write function (either writeSrvAddHeaders or
  // writeLocAddHeaders), captured when the button was clicked.
  const [corsPrompt, setCorsPrompt] = useState<{ onConfirm: (origin: string) => void } | null>(null)
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

  const addStubStatusLocation = (server: Node) => {
    // If a stub_status location already exists, expand it instead of adding another.
    const existing = (server.directives ?? []).find(
      (d) => d.type === 'block' && d.name === 'location' &&
        (d.directives ?? []).some((x) => x.name === 'stub_status')
    )
    if (existing) {
      setExpandedLoc((prev) => ({ ...prev, [existing.id ?? '']: true }))
      return
    }
    const newLoc: Node = {
      type: 'block',
      name: 'location',
      args: ['=', '/nginx_status'],
      enabled: true,
      id: `location-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      directives: [
        { type: 'directive', name: 'stub_status', args: [], enabled: true },
        { type: 'directive', name: 'access_log', args: ['off'], enabled: true },
        { type: 'directive', name: 'allow', args: ['127.0.0.1'], enabled: true },
        { type: 'directive', name: 'allow', args: ['::1'], enabled: true },
        { type: 'directive', name: 'deny', args: ['all'], enabled: true },
      ],
    }
    const dirs = [...(server.directives ?? []), newLoc]
    updateServer(server.id, (s) => ({ ...s, directives: dirs }))
    setExpandedLoc((prev) => ({ ...prev, [newLoc.id ?? '']: true }))
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
        const { port, ssl, http2, quic, reuseport } = parseListen(listenArgs)
        // §50.2 / §50.5 — HTTP/3 + advanced QUIC toggles (server-level directives)
        const http3On = getDirectiveArg(server, 'http3', 0) === 'on'
        const http3HqOn = getDirectiveArg(server, 'http3_hq', 0) === 'on'
        const quicRetryOn = getDirectiveArg(server, 'quic_retry', 0) === 'on'
        // §50.3 — ssl_early_data toggle
        const sslEarlyData = getDirectiveArg(server, 'ssl_early_data', 0) === 'on'
        // §50.5 — ssl_reject_handshake (safety net for "default server rejects unknown SNI")
        const sslRejectHandshake = getDirectiveArg(server, 'ssl_reject_handshake', 0) === 'on'
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
        const statusZone     = getDirectiveArg(server, 'status_zone', 0)

        // F1.3 — server-level proxy defaults
        const proxyConnTimeout  = getDirectiveArg(server, 'proxy_connect_timeout', 0)
        const proxyReadTimeout  = getDirectiveArg(server, 'proxy_read_timeout', 0)
        const proxySendTimeout  = getDirectiveArg(server, 'proxy_send_timeout', 0)
        const proxyHttpVersion  = getDirectiveArg(server, 'proxy_http_version', 0)
        const proxyReqBuf       = getDirectiveArg(server, 'proxy_request_buffering', 0)
        const ignoreInvalidHdrs = getDirectiveArg(server, 'ignore_invalid_headers', 0)
        // §55.1 / §55.2 — proxy_next_upstream condition set + tries/timeout
        const srvNextUpstreamConds = getDirectiveArgs(server, 'proxy_next_upstream')
        const srvNextUpstreamTries = getDirectiveArg(server, 'proxy_next_upstream_tries', 0)
        const srvNextUpstreamTimeout = getDirectiveArg(server, 'proxy_next_upstream_timeout', 0)
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
        // §54.2 — optional `delay=N` modifier: excess requests wait until the
        // queue holds N, then `nodelay` kicks in for the rest. Mutually
        // exclusive with bare `nodelay`.
        const srvLimitReqDelay = (() => {
          const da = (srvLimitReqDir?.args ?? []).find((a) => a.startsWith('delay='))
          return da ? da.replace('delay=', '') : ''
        })()
        const srvLimitReqStatus = getDirectiveArg(server, 'limit_req_status', 0)
        const srvLimitConnDir = (server.directives ?? []).find((d) => d.name === 'limit_conn')
        const srvLimitConnZone = srvLimitConnDir?.args?.[0] ?? ''
        const srvLimitConnN = srvLimitConnDir?.args?.[1] ?? ''
        const srvLimitConnStatus = getDirectiveArg(server, 'limit_conn_status', 0)
        // F5.4 — auth
        const authBasic         = getDirectiveArg(server, 'auth_basic', 0)
        const authBasicUserFile = getDirectiveArg(server, 'auth_basic_user_file', 0)
        const authRequest       = getDirectiveArg(server, 'auth_request', 0)
        // §54.1 — satisfy any|all (only meaningful when mixing auth_basic/auth_request + allow/deny)
        const srvSatisfy        = getDirectiveArg(server, 'satisfy', 0)
        const srvHasAccessRules = srvAccessRulesCommitted.length > 0
        const srvHasAuth        = !!(authBasic && authBasic !== 'off') || !!authRequest
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

            {/* 9.2 / §50.1 — listen (port + ssl + http2 + quic + reuseport) */}
            <div className="server-field">
              <label>
                listen
                <InfoIcon text="IP:port where this server accepts connections. `ssl` enables HTTPS (TCP+TLS for HTTP/1.1 & HTTP/2). `http2` negotiates HTTP/2 over the ssl listen. `quic` enables HTTP/3 (UDP+QUIC) — nginx 1.25+ required; `reuseport` is recommended with quic to let nginx distribute UDP across worker processes. A production HTTP/3 server typically needs TWO listen directives: `listen 443 ssl;` and `listen 443 quic reuseport;` — use the HTTP/3 section below to manage the UDP listen automatically once your config splits them." />
              </label>
              <div className="listen-row">
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) =>
                    setServerDirective(server, 'listen', buildListen(e.target.value, ssl, http2, quic, reuseport))
                  }
                  placeholder="80"
                />
                <label className="checkbox-label" title="TCP + TLS. Required for HTTPS / HTTP/2.">
                  <input
                    type="checkbox"
                    checked={ssl}
                    onChange={(e) =>
                      setServerDirective(server, 'listen', buildListen(port, e.target.checked, http2, quic, reuseport))
                    }
                  />
                  ssl
                </label>
                <label className="checkbox-label" title="HTTP/2 over TLS. Requires ssl (nginx rejects http2 without ssl since 1.25).">
                  <input
                    type="checkbox"
                    checked={http2}
                    onChange={(e) =>
                      setServerDirective(server, 'listen', buildListen(port, ssl, e.target.checked, quic, reuseport))
                    }
                  />
                  http2
                </label>
                <label className="checkbox-label" title="UDP + QUIC (HTTP/3 transport). nginx 1.25+ only. Typically paired with a separate ssl listen on the same port.">
                  <input
                    type="checkbox"
                    checked={quic}
                    onChange={(e) =>
                      setServerDirective(server, 'listen', buildListen(port, ssl, http2, e.target.checked, reuseport))
                    }
                  />
                  quic
                </label>
                <label className="checkbox-label" title="SO_REUSEPORT — lets multiple worker processes bind the same UDP port in parallel. Strongly recommended with quic; harmless otherwise.">
                  <input
                    type="checkbox"
                    checked={reuseport}
                    onChange={(e) =>
                      setServerDirective(server, 'listen', buildListen(port, ssl, http2, quic, e.target.checked))
                    }
                  />
                  reuseport
                </label>
              </div>
              {quic && ssl && (
                <div className="listen-warning">
                  ⚠ <strong>Mixed ssl + quic on one listen:</strong> nginx requires separate listen directives for TCP (<code>ssl</code>) and UDP (<code>quic</code>). The current single-row setup will fail <code>nginx -t</code>. Split into two listens manually, or toggle <code>quic</code> off and let the HTTP/3 section below manage the UDP listen for you.
                </div>
              )}
            </div>

            {/* §44.2 — HTTP/2 enforcement warning when any nested location uses grpc_pass */}
            {(() => {
              const hasGrpc = (() => {
                const walk = (nodes: Node[]): boolean => {
                  for (const n of nodes) {
                    if (n.name === 'grpc_pass') return true
                    if (n.directives && walk(n.directives)) return true
                  }
                  return false
                }
                return walk(server.directives ?? [])
              })()
              if (!hasGrpc || http2) return null
              return (
                <div className="grpc-http2-warning" role="alert">
                  <div className="grpc-http2-warning-text">
                    <strong>gRPC requires HTTP/2.</strong> This server has a <code>grpc_pass</code>
                    {' '}but its <code>listen</code> directive doesn't carry the <code>http2</code> flag —
                    clients will get stream errors or connection resets.
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-preset"
                      onClick={() => setServerDirective(server, 'listen', buildListen(port, ssl, true, quic, reuseport))}
                    >
                      Enable HTTP/2
                    </button>
                  )}
                </div>
              )
            })()}

            {/* §50.2 / §50.4 / §50.5 — HTTP/3 + QUIC advanced toggles */}
            {(() => {
              // §50.4 — Alt-Svc auto-emit. Canonical value depends on the
              // current listen port; we only auto-remove a row that still
              // matches what we wrote, so user edits are preserved.
              const altSvcValue = `'h3=":${port || '443'}"; ma=86400'`
              const existingAltSvc = (server.directives ?? []).find(
                (d) => d.name === 'add_header' && (d.args?.[0] ?? '').toLowerCase() === 'alt-svc'
              )
              const hasAltSvc = !!existingAltSvc
              const altSvcIsOurs = existingAltSvc?.args?.[1] === altSvcValue

              const toggleHttp3 = (on: boolean) => {
                // 1) http3 on|off — always emit explicit on/off so the state is visible on disk.
                // 2) When turning on, also ensure an Alt-Svc add_header row exists.
                // 3) When turning off, remove ONLY our canonical Alt-Svc row (leave user edits alone).
                const base = (server.directives ?? []).filter((d) => d.name !== 'http3')
                let next: Node[] = on
                  ? [...base, { type: 'directive', name: 'http3', args: ['on'], enabled: true }]
                  : base
                if (on && !hasAltSvc) {
                  next = [
                    ...next,
                    { type: 'directive', name: 'add_header', args: ['Alt-Svc', altSvcValue, 'always'], enabled: true },
                  ]
                }
                if (!on && altSvcIsOurs) {
                  next = next.filter(
                    (d) => !(d.name === 'add_header' && (d.args?.[0] ?? '').toLowerCase() === 'alt-svc' && d.args?.[1] === altSvcValue)
                  )
                }
                updateServer(server.id, (s) => ({ ...s, directives: next }))
              }

              return (
                <div className="server-field http3-section">
                  <label>
                    HTTP/3 &amp; QUIC
                    <InfoIcon text="HTTP/3 runs over QUIC (UDP+TLS). To fully enable HTTP/3 on this server you need: (1) a quic-flagged UDP listen on the same port as your ssl listen (use the quic + reuseport checkboxes above — nginx requires TWO separate listen directives for TCP and UDP transports), (2) http3 on, (3) the Alt-Svc response header advertising h3 (auto-emitted when the http3 toggle below goes on), and (4) a valid TLS certificate (QUIC mandates TLS 1.3). The http3_hq toggle enables the legacy HTTP-over-QUIC prototype — only flip this on if you specifically need wire-level HTTP/0.9-style testing. quic_retry forces a stateless retry on every new connection (DoS mitigation, ~1 extra round-trip per handshake). ssl_reject_handshake makes this server reject TLS handshakes whose SNI doesn't match any server_name — the safe pattern for a catch-all default server that should not serve responses." />
                  </label>
                  <div className="http3-toggles">
                    <label className="checkbox-label" title="Enables HTTP/3 response handling. Auto-emits an Alt-Svc response header advertising h3 on the current port (86400s max-age).">
                      <input
                        type="checkbox"
                        checked={http3On}
                        onChange={(e) => toggleHttp3(e.target.checked)}
                        disabled={readOnly}
                      />
                      http3 <code>on</code>
                      <InfoIcon text={'Server-level directive enabling HTTP/3. Requires nginx ≥ 1.25 built with --with-http_v3_module. Toggling this on auto-appends `add_header Alt-Svc \'h3=":<port>"; ma=86400\' always;` so clients can upgrade to HTTP/3 on subsequent requests. Toggling off removes the Alt-Svc row only when it still matches the canonical value — if you\'ve customized it, we leave it alone.'} />
                    </label>
                    <label className="checkbox-label" title="Enables the HQ (HTTP-over-QUIC prototype) protocol — mostly for testing, rarely used in production.">
                      <input
                        type="checkbox"
                        checked={http3HqOn}
                        onChange={(e) => {
                          if (e.target.checked) setServerDirective(server, 'http3_hq', ['on'])
                          else removeServerDirective(server, 'http3_hq')
                        }}
                        disabled={readOnly}
                      />
                      http3_hq <code>on</code>
                      <InfoIcon text="Enables the experimental HQ prototype (HTTP/0.9-style framing over QUIC streams). Almost never needed — leave off unless you're interop-testing with a specific HQ client." />
                    </label>
                    <label className="checkbox-label" title="Forces a stateless Retry on every new QUIC connection. Mitigates address-spoofing attacks but adds a round-trip to every handshake.">
                      <input
                        type="checkbox"
                        checked={quicRetryOn}
                        onChange={(e) => {
                          if (e.target.checked) setServerDirective(server, 'quic_retry', ['on'])
                          else removeServerDirective(server, 'quic_retry')
                        }}
                        disabled={readOnly}
                      />
                      quic_retry <code>on</code>
                      <InfoIcon text="When on, nginx sends a QUIC Retry packet for every new connection, forcing the client to prove ownership of its source address before the handshake proceeds. Useful against amplification and spoofed source-address attacks but adds a full RTT to every initial handshake — measure before enabling in production." />
                    </label>
                  </div>
                  {http3On && hasAltSvc && !altSvcIsOurs && (
                    <div className="listen-warning">
                      <strong>Alt-Svc header detected with a custom value</strong> — left unchanged. When you toggle <code>http3</code> off, we will NOT remove this row (since we didn't write it).
                      Current value: <code>{existingAltSvc?.args?.[1] ?? ''}</code>
                    </div>
                  )}
                </div>
              )
            })()}

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
                <InfoIcon text={'Path + minimum severity for this server\'s error log. Levels quietest→noisiest: emerg, alert, crit, error, warn, notice, info, debug (choosing a level includes it and everything more severe). Use warn or error in production; info/debug can flood disk and impact performance. For debug level, nginx must be built with --with-debug. Tip: instead of turning on debug globally, use the `debug_connection <ip|cidr>;` directive in the events block to enable debug-level logging for one client IP/subnet only.'} />
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
                  title="Minimum severity to log. Includes the chosen level and everything more severe."
                >
                  <option value="">default (error)</option>
                  <option value="debug">debug (requires --with-debug; pair with debug_connection for per-IP)</option>
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

            {/* F8.4 §52.2 — status_zone (Nginx Plus) */}
            <div className="server-field">
              <label>
                status_zone
                <span className="nginx-plus-badge" title="Requires Nginx Plus">Nginx Plus</span>
                <InfoIcon text={'Nginx Plus only: registers this server block in a shared-memory zone so its traffic stats (requests, responses by code, received/sent bytes, SSL handshakes) are exposed via the /api or /status endpoint and aggregated in the Plus dashboard. Open source nginx silently ignores this directive — safe to leave blank. Typical naming convention is the primary server_name (e.g. `api.example.com`). Stats from multiple server blocks sharing the same zone name are summed.'} />
              </label>
              <input
                type="text"
                value={statusZone}
                onChange={(e) =>
                  setServerDirective(server, 'status_zone', e.target.value ? [e.target.value] : [])
                }
                placeholder="zone name (Plus only — e.g. api.example.com)"
                title="Nginx Plus only — registers this server in a traffic statistics zone. Ignored by open-source nginx."
              />
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
                    {/* §48.1 / §48.3 — CORS preset group with three origin-policy modes */}
                    <div className="cors-preset-group">
                      <span className="cors-preset-label">
                        CORS preset
                        <InfoIcon text="Inserts the five Access-Control-* headers needed for cross-origin requests: Allow-Origin, Allow-Methods, Allow-Headers, Max-Age, and (for echo/explicit modes) Allow-Credentials + Vary: Origin. Origin modes: (1) Any (*) — browser-wide access; credentials are disabled because `*` + credentials is forbidden by the spec. (2) Echo ($http_origin) — reflects whatever origin the browser sent. ⚠ Without a whitelist `map` in HTTP Settings, this allows ANY site to call your API with credentials — use only behind a whitelist or for public read-only endpoints. (3) Explicit — pins a single trusted origin. For multiple explicit origins, define a `map $http_origin $cors_allowed_origin { … }` in HTTP Settings and set Allow-Origin to `$cors_allowed_origin`. Re-clicking a mode swaps (does not stack). Does NOT handle preflight — add an `if ($request_method = OPTIONS) { return 204; }` block separately if needed." />
                      </span>
                      <button
                        type="button"
                        className="btn-preset btn-cors"
                        title="Access-Control-Allow-Origin: *  —  public API, no credentials"
                        onClick={() => writeSrvAddHeaders(applyCorsPreset(srvAddHeaders, 'any'))}
                      >
                        + CORS (any <code>*</code>)
                      </button>
                      <button
                        type="button"
                        className="btn-preset btn-cors"
                        title="Access-Control-Allow-Origin: $http_origin  —  reflects the caller's Origin (requires a whitelist map for safety)"
                        onClick={() => writeSrvAddHeaders(applyCorsPreset(srvAddHeaders, 'echo'))}
                      >
                        + CORS (echo <code>$http_origin</code>)
                      </button>
                      <button
                        type="button"
                        className="btn-preset btn-cors"
                        title="Access-Control-Allow-Origin: <your origin>  —  pins one trusted site"
                        onClick={() => {
                          setCorsPrompt({
                            onConfirm: (origin) => writeSrvAddHeaders(applyCorsPreset(srvAddHeaders, 'explicit', origin)),
                          })
                        }}
                      >
                        + CORS (explicit…)
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
                      <InfoIcon text="Emits a server-level `return 301 https://$host$request_uri` that forces every request on this server block to HTTPS. Use this on an HTTP :80 server that shares a domain with an HTTPS :443 server. Differs from 'Redirect all traffic to …' below, which sends traffic to a DIFFERENT host (domain move / consolidation)." />
                    </label>
                  </div>
                  {/* §47.2 — Redirect all traffic to a different host (canonical domain-move helper) */}
                  {(() => {
                    const rootLoc = (server.directives ?? []).find(
                      (d) => d.type === 'block' && d.name === 'location' && d.args?.length === 1 && d.args?.[0] === '/'
                    )
                    const rootReturn = rootLoc?.directives?.find((d) => d.name === 'return' && d.enabled !== false)
                    const rootReturnCode = rootReturn?.args?.[0] ?? ''
                    const rootReturnUrl = rootReturn?.args?.[1] ?? ''
                    const rootOtherDirs = (rootLoc?.directives ?? []).filter(
                      (d) => d.enabled !== false && d.name !== 'return'
                    )
                    const isRedirectAllActive =
                      !!rootLoc && !!rootReturn && rootOtherDirs.length === 0 &&
                      ['301', '302', '307', '308'].includes(rootReturnCode) &&
                      !!rootReturnUrl
                    const rootHasProxyPass = rootOtherDirs.some((d) => d.name === 'proxy_pass')
                    const hasConflictingRoot = !!rootLoc && rootOtherDirs.length > 0

                    const preserveUri = rootReturnUrl.endsWith('$request_uri')
                    const bareUrl = preserveUri
                      ? rootReturnUrl.slice(0, -'$request_uri'.length)
                      : rootReturnUrl

                    const writeRedirect = (code: string, target: string, preserve: boolean) => {
                      const finalUrl = preserve ? `${target}$request_uri` : target
                      const newLoc: Node = {
                        type: 'block',
                        name: 'location',
                        args: ['/'],
                        enabled: true,
                        id: rootLoc?.id ?? `location-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                        directives: [
                          { type: 'directive', name: 'return', args: [code, finalUrl], enabled: true },
                        ],
                      }
                      const others = (server.directives ?? []).filter(
                        (d) => !(d.type === 'block' && d.name === 'location' && d.args?.length === 1 && d.args?.[0] === '/')
                      )
                      updateServer(server.id, (s) => ({ ...s, directives: [...others, newLoc] }))
                    }

                    const clearRedirect = () => {
                      const others = (server.directives ?? []).filter(
                        (d) => !(d.type === 'block' && d.name === 'location' && d.args?.length === 1 && d.args?.[0] === '/')
                      )
                      updateServer(server.id, (s) => ({ ...s, directives: others }))
                    }

                    return (
                      <div className="server-field">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={isRedirectAllActive}
                            disabled={hasConflictingRoot && !isRedirectAllActive}
                            onChange={(e) => {
                              if (e.target.checked) {
                                writeRedirect('301', bareUrl || 'https://example.com', true)
                              } else {
                                clearRedirect()
                              }
                            }}
                          />
                          Redirect all traffic to …
                          <InfoIcon text="Emits `location / { return <code> <target>$request_uri; }` — sends every request for this server block to a different host. Use when moving a domain (example.com → example.org) or retiring a service. Differs from: (1) 'SSL redirect' above, which only forces HTTP→HTTPS on the same host; (2) `rewrite ... permanent`, which uses regex matching and is slower / more error-prone. The $request_uri suffix preserves the request path and query string on the target." />
                        </label>
                        {hasConflictingRoot && !isRedirectAllActive && (
                          <div className="redirect-all-warning">
                            The <code>location /</code> block already contains {rootHasProxyPass ? <><code>proxy_pass</code> and </> : null}other directives — the redirect-all helper is disabled. Remove or disable those directives first, or edit the <code>return</code> directly in the location block below.
                          </div>
                        )}
                        {isRedirectAllActive && (
                          <div className="redirect-all-fields">
                            <select
                              value={rootReturnCode}
                              onChange={(e) => writeRedirect(e.target.value, bareUrl, preserveUri)}
                              title="Redirect status code"
                            >
                              <option value="301">301 Moved Permanently</option>
                              <option value="302">302 Found (Temporary)</option>
                              <option value="307">307 Temporary (method preserved)</option>
                              <option value="308">308 Permanent (method preserved)</option>
                            </select>
                            <input
                              type="text"
                              placeholder="https://new.example.com"
                              value={bareUrl}
                              onChange={(e) => writeRedirect(rootReturnCode, e.target.value, preserveUri)}
                              spellCheck={false}
                            />
                            <label className="checkbox-label" title="Appends $request_uri so the path + query string are preserved on the target (recommended)">
                              <input
                                type="checkbox"
                                checked={preserveUri}
                                onChange={(e) => writeRedirect(rootReturnCode, bareUrl, e.target.checked)}
                              />
                              preserve URI
                            </label>
                          </div>
                        )}
                      </div>
                    )
                  })()}
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
                        <InfoIcon text="Staples an OCSP response from the CA into the TLS handshake so clients don't have to contact the CA to check cert revocation. Requires ssl_stapling_verify + ssl_trusted_certificate. Eliminates the client-side OCSP fetch (~100 ms on cold DNS cache)." />
                      </label>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={sslStaplingVerify}
                          onChange={(e) => setServerDirective(server, 'ssl_stapling_verify', [e.target.checked ? 'on' : 'off'])} />
                        ssl_stapling_verify
                        <InfoIcon text="When on, nginx verifies the OCSP response signature against ssl_trusted_certificate before stapling it. Safe default; turn off only if you're debugging staple errors against a broken CA." />
                      </label>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={sslSessionTickets !== 'off'}
                          onChange={(e) => setServerDirective(server, 'ssl_session_tickets', [e.target.checked ? 'on' : 'off'])} />
                        ssl_session_tickets
                        <InfoIcon text="RFC 5077 session tickets let clients resume TLS sessions without server-side state. Keep on for performance; turn off if you're concerned about ticket-key rotation / forward secrecy across server restarts." />
                      </label>
                      {/* §50.3 — ssl_early_data (TLS 1.3 0-RTT) */}
                      <label className="checkbox-label">
                        <input type="checkbox" checked={sslEarlyData}
                          onChange={(e) => setServerDirective(server, 'ssl_early_data', [e.target.checked ? 'on' : 'off'])} />
                        ssl_early_data
                        <InfoIcon text="TLS 1.3 0-RTT — lets resumed sessions send application data in the first flight (saves a full RTT on reconnects). ⚠ Replay-able: nginx sets $ssl_early_data=1 on such requests; you MUST make your upstream idempotent-or-read-only for 0-RTT, or reject early-data on non-GET routes. Requires TLS 1.3 in ssl_protocols. Big win for HTTP/3 where 0-RTT is already common." />
                      </label>
                      {/* §50.5 — ssl_reject_handshake (safe default-server guard) */}
                      <label className="checkbox-label">
                        <input type="checkbox" checked={sslRejectHandshake}
                          onChange={(e) => setServerDirective(server, 'ssl_reject_handshake', [e.target.checked ? 'on' : 'off'])} />
                        ssl_reject_handshake
                        <InfoIcon text="When on, this server rejects the TLS handshake with unrecognized_name for any SNI that doesn't match its server_name. The safe default-server pattern: scanners hitting the bare IP get a TLS-level rejection instead of a generic 'Welcome to nginx' page that leaks the default cert. Pair with a bare `server { listen 443 ssl default_server; ssl_reject_handshake on; }` — the default server needs no cert but nginx still requires ssl on the listen." />
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

                  {/* §55.1 / §55.2 — proxy_next_upstream + tries/timeout */}
                  <div className="server-field">
                    <label>
                      proxy_next_upstream
                      <InfoIcon text={'Conditions under which nginx will retry the same request on the next upstream server in the pool (only applies when you\'ve proxied to a named upstream with >1 server). Defaults when unset: error + timeout. Check boxes below to enable additional failover scenarios. `off` disables failover entirely (mutually exclusive with the others). For non-idempotent methods (POST/PATCH/DELETE/LOCK), retries are refused UNLESS you also enable `non_idempotent` — be careful of double-side-effect hazards.'} />
                    </label>
                    <div className="next-upstream-grid">
                      {PROXY_NEXT_UPSTREAM_CONDS.map((c) => {
                        const checked = srvNextUpstreamConds.includes(c.key)
                        return (
                          <label key={c.key} className="checkbox-label" title={c.info}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                let next: string[]
                                if (c.key === 'off') {
                                  next = e.target.checked ? ['off'] : []
                                } else if (e.target.checked) {
                                  next = [...srvNextUpstreamConds.filter((x) => x !== 'off'), c.key]
                                } else {
                                  next = srvNextUpstreamConds.filter((x) => x !== c.key)
                                }
                                setServerDirective(server, 'proxy_next_upstream', next)
                              }}
                            />
                            {c.label}
                            <InfoIcon text={c.info} />
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  <div className="server-field-row">
                    <div className="server-field">
                      <label>
                        proxy_next_upstream_tries
                        <InfoIcon text={'Max number of times nginx attempts the request (total across all upstream servers). Default 0 = unlimited (try every server in the pool before giving up). Setting 3 is a sane cap — protects against cascade retries when every backend is unhealthy.'} />
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={srvNextUpstreamTries}
                        placeholder="0 (unlimited)"
                        onChange={(e) =>
                          setServerDirective(server, 'proxy_next_upstream_tries', e.target.value ? [e.target.value] : [])
                        }
                      />
                    </div>
                    <div className="server-field">
                      <label>
                        proxy_next_upstream_timeout
                        <InfoIcon text={'Wall-clock budget for the entire failover sequence (from first attempt to final error). Default 0 = no overall cap. Setting a value (e.g. 10s) bounds tail-latency — if one slow backend is eating the budget, nginx stops trying rather than serving a 60s-response.'} />
                      </label>
                      <input
                        type="text"
                        value={srvNextUpstreamTimeout}
                        placeholder="0 (no cap)"
                        onChange={(e) =>
                          setServerDirective(server, 'proxy_next_upstream_timeout', e.target.value ? [e.target.value] : [])
                        }
                      />
                    </div>
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

            {/* F2.1 / §54.2 / §54.3 — Server-level Rate Limiting */}
            <div className="server-ssl-section">
              <div className="ssl-section-head">
                <div className="ssl-section-label">Rate Limiting</div>
                <InfoIcon text={'Throttling at the server level. Both directives reference zones declared in HTTP Settings → Rate Limiting (must exist there first). `limit_req` enforces a request rate with optional burst/delay/nodelay. `limit_conn` caps concurrent connections per key. Applies to every location in this server unless overridden. Server-level rules inherit down to locations — add a zero-zone limit on a location to exempt it.'} />
              </div>
              <div className="ssl-fields">
                <div className="server-field">
                  <label>
                    limit_req
                    <InfoIcon text={'References a zone declared via `limit_req_zone` in HTTP Settings. Three excess-traffic modes: (1) neither burst nor nodelay → excess requests are rejected immediately with `limit_req_status` (default 503); (2) `burst=N` → up to N excess requests are QUEUED and served at the zone rate (smooth but adds latency); (3) `burst=N nodelay` → burst requests are served IMMEDIATELY, the counter is filled, subsequent requests over limit are rejected; (4) `burst=N delay=M` → first M of the burst are served immediately, requests M+1..N are queued, excess rejected. nodelay and delay are mutually exclusive.'} />
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
                          else if (srvLimitReqDelay) args.push(`delay=${srvLimitReqDelay}`)
                          setServerDirective(server, 'limit_req', args)
                        }
                      }}
                      title="Pick a zone from HTTP Settings → Rate Limiting (limit_req_zone). Empty disables limit_req on this server."
                    >
                      <option value="">— off —</option>
                      {reqZoneNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    {srvLimitReqZone && (
                      <>
                        <input
                          type="number"
                          min="0"
                          value={srvLimitReqBurst}
                          placeholder="burst"
                          className="loc-rate-short"
                          title="Max number of extra requests the zone will hold beyond the steady rate before rejecting. 0/blank = no burst (strict rate)."
                          onChange={(e) => {
                            const args = [`zone=${srvLimitReqZone}`]
                            if (e.target.value) args.push(`burst=${e.target.value}`)
                            if (srvLimitReqNodelay) args.push('nodelay')
                            else if (srvLimitReqDelay) args.push(`delay=${srvLimitReqDelay}`)
                            setServerDirective(server, 'limit_req', args)
                          }}
                        />
                        <select
                          className="loc-rate-short"
                          value={srvLimitReqNodelay ? 'nodelay' : (srvLimitReqDelay ? 'delay' : 'queue')}
                          title="How burst requests are served. queue (default): throttle burst at zone rate. nodelay: serve burst immediately. delay=N: serve first N of burst immediately, queue the rest."
                          onChange={(e) => {
                            const mode = e.target.value
                            const args = [`zone=${srvLimitReqZone}`]
                            if (srvLimitReqBurst) args.push(`burst=${srvLimitReqBurst}`)
                            if (mode === 'nodelay') args.push('nodelay')
                            else if (mode === 'delay') args.push(`delay=${srvLimitReqDelay || '1'}`)
                            setServerDirective(server, 'limit_req', args)
                          }}
                        >
                          <option value="queue">queue</option>
                          <option value="nodelay">nodelay</option>
                          <option value="delay">delay=N</option>
                        </select>
                        {!srvLimitReqNodelay && srvLimitReqDelay && (
                          <input
                            type="number"
                            min="1"
                            value={srvLimitReqDelay}
                            placeholder="N"
                            className="loc-rate-short"
                            title="Number of burst requests served immediately before delay kicks in."
                            onChange={(e) => {
                              const args = [`zone=${srvLimitReqZone}`]
                              if (srvLimitReqBurst) args.push(`burst=${srvLimitReqBurst}`)
                              if (e.target.value) args.push(`delay=${e.target.value}`)
                              setServerDirective(server, 'limit_req', args)
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="server-field">
                  <label>
                    limit_req_status
                    <InfoIcon text={'HTTP status returned when a request is rejected by `limit_req`. Default 503 (Service Unavailable). Many operators prefer 429 (Too Many Requests) since that is the RFC-6585 semantically-correct status for rate limiting — it also lets CDNs and API clients distinguish throttling from a real outage. Accepts 400–599.'} />
                  </label>
                  <input
                    type="number"
                    min="400"
                    max="599"
                    className="loc-rate-short"
                    value={srvLimitReqStatus}
                    placeholder="503"
                    onChange={(e) =>
                      setServerDirective(server, 'limit_req_status', e.target.value ? [e.target.value] : [])
                    }
                  />
                </div>
                <div className="server-field">
                  <label>
                    limit_conn
                    <InfoIcon text={'Caps concurrent (not total) connections per key using a zone declared via `limit_conn_zone`. When a client opens >N simultaneous connections, excess ones are rejected with `limit_conn_status` (default 503). Pair with `limit_conn_zone $binary_remote_addr zone=perip:10m` for per-IP quotas, or `$server_name` for per-vhost quotas. Does NOT count requests — only live connections.'} />
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
                      title="Pick a zone from HTTP Settings → Rate Limiting (limit_conn_zone). Empty disables limit_conn on this server."
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
                        title="Max concurrent connections per key. Connections exceeding this get rejected with limit_conn_status."
                        onChange={(e) => setServerDirective(server, 'limit_conn', [srvLimitConnZone, e.target.value])}
                      />
                    )}
                  </div>
                </div>
                <div className="server-field">
                  <label>
                    limit_conn_status
                    <InfoIcon text={'HTTP status returned when a connection is rejected by `limit_conn`. Default 503. Recommended: 429 (Too Many Requests, matches RFC-6585) so clients can distinguish rate-limiting from server failure.'} />
                  </label>
                  <input
                    type="number"
                    min="400"
                    max="599"
                    className="loc-rate-short"
                    value={srvLimitConnStatus}
                    placeholder="503"
                    onChange={(e) =>
                      setServerDirective(server, 'limit_conn_status', e.target.value ? [e.target.value] : [])
                    }
                  />
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
                  {/* §54.1 — satisfy any|all. Only meaningful when mixing auth with allow/deny. */}
                  {(srvHasAuth && srvHasAccessRules) ? (
                    <>
                      <label className="ssl-label">
                        satisfy
                        <InfoIcon text={'Controls how nginx combines `allow`/`deny` rules with auth (`auth_basic` / `auth_request`). `all` (default): client must pass BOTH — they must be in an allowed IP range AND present valid credentials. `any`: client passes if EITHER succeeds — common pattern is "office IPs bypass the login prompt, everyone else gets the auth dialog." Only has effect when both an access-rule chain and an auth mechanism are present in the same scope.'} />
                      </label>
                      <select
                        value={srvSatisfy || 'all'}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === 'all') {
                            // default — omit the directive so the output stays clean
                            setServerDirective(server, 'satisfy', [])
                          } else {
                            setServerDirective(server, 'satisfy', [v])
                          }
                        }}
                        title="all = must pass both auth AND access rules (default). any = must pass at least one."
                      >
                        <option value="all">all (default — must pass both)</option>
                        <option value="any">any (pass either auth OR access rule)</option>
                      </select>
                    </>
                  ) : (srvSatisfy && (
                    <div className="satisfy-orphan-warning">
                      <InfoIcon text={'`satisfy ' + srvSatisfy + '` is set but this server has no auth + access-rules combination — the directive has no effect until both are present. Remove it or add the missing piece.'} />
                      satisfy {srvSatisfy} (no effect — needs both auth + allow/deny)
                      <button
                        type="button"
                        className="btn-preset"
                        onClick={() => setServerDirective(server, 'satisfy', [])}
                        title="Remove the orphan satisfy directive"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* F5.5 / §45.3 — Error Pages */}
            <div className="server-ssl-section">
              <button type="button" className="ssl-section-toggle"
                onClick={() => setExpandedErrorPages((p) => ({ ...p, [server.id ?? '']: !p[server.id ?? ''] }))}>
                Error Pages {expandedErrorPages[server.id ?? ''] ? '▾' : '▸'}
                <InfoIcon text="Map one or more error/status codes to a target. Three columns: (1) status codes, space-separated — e.g. `404 500 502`; (2) optional response rewrite — `=200` forces a 200 status when the target is served, `=code` maps to any other code; (3) target — can be a URI (`/404.html`), a named location (`@fallback`), or even an internal URL. Pair with matching `location = /404.html { internal; }` blocks for custom error pages." />
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
                    <div className="fcgi-param-presets">
                      <button type="button" className="btn-add-header"
                        onClick={() => {
                          const next = [...srvErrorPages, { codes: '404', redirect: '', uri: '/404.html' }]
                          const dirs = setBlockDirectivesMulti(server.directives ?? [], 'error_page', next.map((r) => ({
                            args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                          })))
                          updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                        }}>+ Add error page</button>
                      <button type="button" className="btn-preset"
                        title="Adds 404 → /404.html and 500 502 503 504 → /50x.html; skips rows already present"
                        onClick={() => {
                          const has = (codes: string) =>
                            srvErrorPages.some((r) => r.codes.trim() === codes)
                          const extra: { codes: string; redirect: string; uri: string }[] = []
                          if (!has('404')) extra.push({ codes: '404', redirect: '', uri: '/404.html' })
                          if (!has('500 502 503 504'))
                            extra.push({ codes: '500 502 503 504', redirect: '', uri: '/50x.html' })
                          if (extra.length === 0) return
                          const next = [...srvErrorPages, ...extra]
                          const dirs = setBlockDirectivesMulti(server.directives ?? [], 'error_page', next.map((r) => ({
                            args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                          })))
                          updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                        }}>+ Standard 4xx/5xx bundle</button>
                      <button type="button" className="btn-preset"
                        title="error_page 404 =200 /empty.json — converts misses to a flat 200 response, useful for API endpoints that should never leak 404 semantics"
                        onClick={() => {
                          const next = [...srvErrorPages, { codes: '404', redirect: '200', uri: '/empty.json' }]
                          const dirs = setBlockDirectivesMulti(server.directives ?? [], 'error_page', next.map((r) => ({
                            args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                          })))
                          updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                        }}>+ 404 → =200 rewrite</button>
                      <button type="button" className="btn-preset"
                        title="error_page 502 503 504 @fallback — route upstream errors to a named location"
                        onClick={() => {
                          const next = [...srvErrorPages, { codes: '502 503 504', redirect: '', uri: '@fallback' }]
                          const dirs = setBlockDirectivesMulti(server.directives ?? [], 'error_page', next.map((r) => ({
                            args: [...r.codes.split(/\s+/).filter(Boolean), ...(r.redirect ? [`=${r.redirect}`] : []), r.uri].filter(Boolean)
                          })))
                          updateServer(server.id, (s) => ({ ...s, directives: dirs }))
                        }}>+ 5xx → @fallback</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Section 10: Location Block UI */}
            <div className="locations">
              <div className="locations-header">
                <span className="locations-label">Locations</span>
                {!readOnly && (
                  <div className="locations-header-actions">
                    <button
                      type="button"
                      className="btn-add-location"
                      onClick={() => addLocation(server)}
                    >
                      + Add location
                    </button>
                    <button
                      type="button"
                      className="btn-add-location btn-add-stub-status"
                      onClick={() => addStubStatusLocation(server)}
                      title="Adds location = /nginx_status { stub_status; access_log off; allow 127.0.0.1/::1; deny all; } — the built-in metrics endpoint (requests/conn count)."
                    >
                      + Stub status endpoint
                      <InfoIcon text="Creates a locked-down location at /nginx_status that exposes nginx's built-in metrics page (active connections, accepts/handled/requests counters, reading/writing/waiting). Pre-fills: stub_status; · access_log off; (metrics scrapes would flood the log) · allow 127.0.0.1 + ::1 + deny all (localhost-only by default — widen the ACL to your monitoring subnet). Intended to be scraped by Prometheus' nginx-prometheus-exporter or similar. Only created once per server — if a stub_status location already exists, this button expands it." />
                    </button>
                  </div>
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
                // §55.1 / §55.2 — per-location proxy_next_upstream + tries/timeout
                const locNextUpstreamConds = getDirectiveArgs(loc, 'proxy_next_upstream')
                const locNextUpstreamTries = getDirectiveArg(loc, 'proxy_next_upstream_tries', 0)
                const locNextUpstreamTimeout = getDirectiveArg(loc, 'proxy_next_upstream_timeout', 0)
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
                const locLimitReqDelay = (() => {
                  const da = (locLimitReqDir?.args ?? []).find((a) => a.startsWith('delay='))
                  return da ? da.replace('delay=', '') : ''
                })()
                const locLimitReqStatus = getDirectiveArg(loc, 'limit_req_status', 0)
                const locLimitConnDir = (loc.directives ?? []).find((d) => d.name === 'limit_conn')
                const locLimitConnZone = locLimitConnDir?.args?.[0] ?? ''
                const locLimitConnN = locLimitConnDir?.args?.[1] ?? ''
                const locLimitConnStatus = getDirectiveArg(loc, 'limit_conn_status', 0)
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
                // §54.1 — satisfy toggle (any|all) only meaningful when mixing auth + access rules
                const locSatisfy           = getDirectiveArg(loc, 'satisfy', 0)
                const locHasAccessRules    = locAccessRulesCommitted.length > 0
                const locHasAuth           = !!(locAuthBasic && locAuthBasic !== 'off') || !!locAuthRequest
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
                            <InfoIcon text="Regex-based URI rewrite. Flags: `last` (restart location matching with new URI), `break` (stop rewriting but keep processing in same location), `redirect` (302 response), `permanent` (301 response). Without a flag, processing continues through further rewrites. For simple redirects prefer `return <code> <url>` — it's faster (no regex), clearer, and avoids the common `rewrite … permanent` footgun where the server ends up in a redirect loop. Use `rewrite` only when you need to rewrite the URI path for further processing, not for issuing redirects." />
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
                            <InfoIcon text="Ends processing and returns a response immediately. Prefer this over `rewrite ... permanent|redirect` for redirects — return evaluates in the rewrite phase without regex matching, so it's faster and less error-prone. Codes: 200 (OK with body), 301 (permanent redirect, method may change to GET), 302 (temporary redirect, method may change), 307 (temporary, method preserved — use for POST/PUT redirects), 308 (permanent, method preserved), 403 (forbidden), 404 (not found), 410 (gone — permanently removed), 444 (nginx-specific: close connection with no response, useful for blocking bots/scanners)." />
                          </label>
                          <div className="return-row">
                            <select
                              value={returnCode}
                              onChange={(e) => {
                                const code = e.target.value
                                if (code) {
                                  setLocationDirective(loc, 'return', returnUrl ? [code, returnUrl] : [code])
                                } else {
                                  removeLocationDirective(loc, 'return')
                                }
                              }}
                            >
                              <option value="">—</option>
                              <option value="200">200</option>
                              <option value="301">301</option>
                              <option value="302">302</option>
                              <option value="307">307</option>
                              <option value="308">308</option>
                              <option value="403">403</option>
                              <option value="404">404</option>
                              <option value="410">410</option>
                              <option value="444">444</option>
                              {/* Keep 500 as an option so older configs using it still round-trip cleanly. */}
                              {returnCode === '500' && <option value="500">500</option>}
                            </select>
                            {returnCode && returnCode !== '444' && (
                              <input
                                type="text"
                                placeholder={
                                  ['301', '302', '307', '308'].includes(returnCode)
                                    ? 'https://example.com$request_uri'
                                    : returnCode === '200'
                                    ? '"OK" (response body)'
                                    : 'URL or text (optional)'
                                }
                                value={returnUrl}
                                onChange={(e) =>
                                  setLocationDirective(loc, 'return', e.target.value
                                    ? [returnCode, e.target.value]
                                    : [returnCode]
                                  )
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
                        {/* §55.1 / §55.2 — per-location proxy_next_upstream + tries/timeout */}
                        <div className="location-field">
                          <label>
                            proxy_next_upstream
                            <InfoIcon text={'Per-location override of the server-level failover policy. Same semantics: check conditions under which nginx will retry on the next upstream server. Location-level values REPLACE (not merge with) the server-level set — so if server has `error timeout` and you check only `http_502` here, the location\'s effective set is just `http_502` (you lose error/timeout retry). To keep inheritance leave every checkbox unchecked.'} />
                          </label>
                          <div className="next-upstream-grid">
                            {PROXY_NEXT_UPSTREAM_CONDS.map((c) => {
                              const checked = locNextUpstreamConds.includes(c.key)
                              return (
                                <label key={c.key} className="checkbox-label" title={c.info}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      let next: string[]
                                      if (c.key === 'off') {
                                        next = e.target.checked ? ['off'] : []
                                      } else if (e.target.checked) {
                                        next = [...locNextUpstreamConds.filter((x) => x !== 'off'), c.key]
                                      } else {
                                        next = locNextUpstreamConds.filter((x) => x !== c.key)
                                      }
                                      setLocationDirective(loc, 'proxy_next_upstream', next)
                                    }}
                                  />
                                  {c.label}
                                  <InfoIcon text={c.info} />
                                </label>
                              )
                            })}
                          </div>
                        </div>
                        <div className="server-field-row">
                          <div className="location-field">
                            <label>
                              proxy_next_upstream_tries
                              <InfoIcon text={'Max total retry attempts across upstream pool members. Default 0 = unlimited. Cap at 2–3 to prevent cascade retries during an outage.'} />
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={locNextUpstreamTries}
                              placeholder="0 (unlimited)"
                              onChange={(e) =>
                                setLocationDirective(loc, 'proxy_next_upstream_tries', e.target.value ? [e.target.value] : [])
                              }
                            />
                          </div>
                          <div className="location-field">
                            <label>
                              proxy_next_upstream_timeout
                              <InfoIcon text={'Wall-clock budget for the entire retry sequence. Default 0 = no cap. Set e.g. 10s to bound tail latency when every backend is slow.'} />
                            </label>
                            <input
                              type="text"
                              value={locNextUpstreamTimeout}
                              placeholder="0 (no cap)"
                              onChange={(e) =>
                                setLocationDirective(loc, 'proxy_next_upstream_timeout', e.target.value ? [e.target.value] : [])
                              }
                            />
                          </div>
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
                            <InfoIcon text="Sets the Expires and Cache-Control headers for responses from this location. Values: a duration (e.g. 30d, 1h), `max` (10 years), `off` (disable), or `epoch` (expired). Good for versioned static assets that never change. Pair with an explicit `Cache-Control` add_header for finer control (e.g. `public, max-age=…, immutable`)." />
                          </label>
                          <input
                            type="text"
                            value={expiresVal}
                            onChange={(e) => setLocationDirective(loc, 'expires', e.target.value ? [e.target.value] : [])}
                            placeholder="30d, max, off, epoch"
                          />
                          {/* §45.4 — expires + Cache-Control presets */}
                          {!readOnly && (() => {
                            const applyCachePreset = (expires: string, cacheControl: string) => {
                              const existing = (loc.directives ?? [])
                                .filter((d) => d.name === 'add_header')
                                .map((d) => ({ key: d.args?.[0] ?? '', value: d.args?.[1] ?? '', always: (d.args ?? []).includes('always') }))
                              // Replace any existing Cache-Control row (case-insensitive), append otherwise.
                              const cleaned = existing.filter((r) => r.key.toLowerCase() !== 'cache-control')
                              const next = [...cleaned, { key: 'Cache-Control', value: cacheControl, always: true }]
                              const items = next.map((x) => ({ args: buildAddHeaderArgs(x.key, x.value, x.always) }))
                              let dirs = setBlockDirectivesMulti(loc.directives ?? [], 'add_header', items)
                              dirs = setBlockDirective(dirs, 'expires', [expires])
                              updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                            }
                            return (
                              <div className="fcgi-param-presets cache-preset-row">
                                <button
                                  type="button"
                                  className="btn-preset"
                                  title={`expires 30d + Cache-Control "public, max-age=2592000, immutable" — for content-hashed static assets that never change`}
                                  onClick={() => applyCachePreset('30d', 'public, max-age=2592000, immutable')}
                                >
                                  Static asset cache (30d, immutable)
                                </button>
                                <button
                                  type="button"
                                  className="btn-preset"
                                  title={`expires 1y + Cache-Control "public, max-age=31536000, immutable" — aggressive long-term cache`}
                                  onClick={() => applyCachePreset('1y', 'public, max-age=31536000, immutable')}
                                >
                                  Long-term (1y)
                                </button>
                                <button
                                  type="button"
                                  className="btn-preset"
                                  title={`expires off + Cache-Control "no-store, no-cache, must-revalidate" — for HTML entry points and API responses that must not be cached`}
                                  onClick={() => applyCachePreset('off', 'no-store, no-cache, must-revalidate')}
                                >
                                  No cache
                                </button>
                              </div>
                            )
                          })()}
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
                            {/* §48.1 / §48.3 — CORS preset group at location scope */}
                            <div className="cors-preset-group">
                              <span className="cors-preset-label">
                                CORS preset
                                <InfoIcon text="Inserts Access-Control-* headers scoped to this location only. Origin modes: (1) Any (*) — public access without credentials. (2) Echo ($http_origin) — reflects the caller's Origin; ⚠ unsafe without a whitelist map when Allow-Credentials is on. (3) Explicit — pins a single origin. Re-clicking a mode swaps it (does not stack). For multi-origin whitelists, define a `map $http_origin $cors_allowed_origin { … }` in HTTP Settings and use the explicit mode with `$cors_allowed_origin` as the origin value. The Preflight button below inserts a separate `if ($request_method = OPTIONS)` block that short-circuits OPTIONS requests with a 204 — without it, nginx forwards OPTIONS to the upstream which may not handle it correctly." />
                              </span>
                              <button
                                type="button"
                                className="btn-preset btn-cors"
                                title="Access-Control-Allow-Origin: *  —  public, no credentials"
                                onClick={() => writeLocAddHeaders(applyCorsPreset(locAddHeaders, 'any'))}
                              >
                                + CORS (any <code>*</code>)
                              </button>
                              <button
                                type="button"
                                className="btn-preset btn-cors"
                                title="Access-Control-Allow-Origin: $http_origin  —  echoes caller Origin (requires whitelist for safety)"
                                onClick={() => writeLocAddHeaders(applyCorsPreset(locAddHeaders, 'echo'))}
                              >
                                + CORS (echo <code>$http_origin</code>)
                              </button>
                              <button
                                type="button"
                                className="btn-preset btn-cors"
                                title="Access-Control-Allow-Origin: <your origin>  —  pins one trusted site"
                                onClick={() => {
                                  setCorsPrompt({
                                    onConfirm: (origin) => writeLocAddHeaders(applyCorsPreset(locAddHeaders, 'explicit', origin)),
                                  })
                                }}
                              >
                                + CORS (explicit…)
                              </button>
                              {/* §48.2 — Preflight OPTIONS handler (separate if-block, not an add_header row) */}
                              <button
                                type="button"
                                className="btn-preset btn-cors btn-cors-preflight"
                                title="Adds `if ($request_method = OPTIONS) { …cors headers…; return 204; }` — short-circuits preflight at nginx, never reaches upstream. ⚠ Uses `if` (see 'if is evil' warning below)."
                                onClick={() => {
                                  // Pick up the current Allow-Origin if the user has already applied a CORS
                                  // mode above; otherwise fall back to `*`. This keeps the preflight and
                                  // main-request headers in sync without a second prompt.
                                  const existingOriginRow = locAddHeaders.find((h) => h.key.toLowerCase() === 'access-control-allow-origin')
                                  const origin = existingOriginRow?.value ?? '"*"'
                                  const hasCreds = locAddHeaders.some((h) => h.key.toLowerCase() === 'access-control-allow-credentials')
                                  const preflightDirs: Node[] = [
                                    { type: 'directive', name: 'add_header', args: ['Access-Control-Allow-Origin', origin, 'always'], enabled: true },
                                    { type: 'directive', name: 'add_header', args: ['Access-Control-Allow-Methods', '"GET, POST, PUT, PATCH, DELETE, OPTIONS"', 'always'], enabled: true },
                                    { type: 'directive', name: 'add_header', args: ['Access-Control-Allow-Headers', '"Authorization, Content-Type, X-Requested-With, Accept, Origin"', 'always'], enabled: true },
                                    { type: 'directive', name: 'add_header', args: ['Access-Control-Max-Age', '3600', 'always'], enabled: true },
                                    { type: 'directive', name: 'add_header', args: ['Content-Type', '"text/plain; charset=utf-8"', 'always'], enabled: true },
                                    { type: 'directive', name: 'add_header', args: ['Content-Length', '0', 'always'], enabled: true },
                                  ]
                                  if (hasCreds) {
                                    preflightDirs.splice(1, 0, { type: 'directive', name: 'add_header', args: ['Access-Control-Allow-Credentials', '"true"', 'always'], enabled: true })
                                  }
                                  preflightDirs.push({ type: 'directive', name: 'return', args: ['204'], enabled: true })
                                  const preflightBlock: Node = {
                                    type: 'block',
                                    name: 'if',
                                    args: ['($request_method = OPTIONS)'],
                                    enabled: true,
                                    id: `if-preflight-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                    directives: preflightDirs,
                                  }
                                  // Idempotent: strip any existing preflight if-block before inserting the fresh one.
                                  const isPreflightIf = (d: Node) =>
                                    d.type === 'block' &&
                                    d.name === 'if' &&
                                    (d.args ?? []).join(' ').replace(/\s+/g, '').toLowerCase() === '($request_method=options)'
                                  const rest = (loc.directives ?? []).filter((d) => !isPreflightIf(d))
                                  updateLocation(loc.id, (l) => ({ ...l, directives: [...rest, preflightBlock] }))
                                }}
                              >
                                + Preflight handler (<code>if</code> OPTIONS → 204)
                              </button>
                            </div>
                            {/* §48.2 — "if is evil" disclaimer for the preflight button */}
                            <div className="cors-preflight-warning">
                              ⚠ <strong>nginx "if is evil" caveat:</strong> the preflight handler uses an <code>if</code> block. This pattern is safe because only <code>add_header</code> + <code>return</code> are used (both reliably work inside <code>if</code>), but avoid combining it with <code>proxy_pass</code>, <code>rewrite</code>, or other phase-sensitive directives in the same block. For high-traffic APIs, prefer moving preflight to a dedicated <code>location @preflight</code> via a named-location match or solving it at the app layer.
                            </div>
                          </div>
                        </div>
                          )
                        })()}

                        {/* F2.1 / §54.2 / §54.3 — Rate Limiting */}
                        <div className="location-field">
                          <label>
                            limit_req
                            <InfoIcon text={'References a zone declared via `limit_req_zone` in HTTP Settings → Rate Limiting. Behaviour without burst: excess requests are rejected immediately. With `burst=N`: up to N extra requests queue. `nodelay` (mutually exclusive with `delay`): serve all burst immediately. `delay=M`: serve first M of burst immediately, queue the rest. Location-level limit REPLACES the server-level limit_req for this location; to exempt a location from an inherited limit, set zone to "off" (empty here).'} />
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
                                  else if (locLimitReqDelay) args.push(`delay=${locLimitReqDelay}`)
                                  setLocationDirective(loc, 'limit_req', args)
                                }
                              }}
                              title="Pick a zone from HTTP Settings → Rate Limiting. Empty disables limit_req for this location."
                            >
                              <option value="">— off —</option>
                              {reqZoneNames.map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                            {locLimitReqZone && (
                              <>
                                <input
                                  type="number"
                                  min="0"
                                  value={locLimitReqBurst}
                                  placeholder="burst"
                                  className="loc-rate-short"
                                  title="Max extra requests the zone will hold beyond the steady rate before rejecting."
                                  onChange={(e) => {
                                    const args = [`zone=${locLimitReqZone}`]
                                    if (e.target.value) args.push(`burst=${e.target.value}`)
                                    if (locLimitReqNodelay) args.push('nodelay')
                                    else if (locLimitReqDelay) args.push(`delay=${locLimitReqDelay}`)
                                    setLocationDirective(loc, 'limit_req', args)
                                  }}
                                />
                                <select
                                  className="loc-rate-short"
                                  value={locLimitReqNodelay ? 'nodelay' : (locLimitReqDelay ? 'delay' : 'queue')}
                                  title="How burst requests are served. queue: throttle at zone rate. nodelay: serve immediately. delay=N: first N immediate, rest queue."
                                  onChange={(e) => {
                                    const mode = e.target.value
                                    const args = [`zone=${locLimitReqZone}`]
                                    if (locLimitReqBurst) args.push(`burst=${locLimitReqBurst}`)
                                    if (mode === 'nodelay') args.push('nodelay')
                                    else if (mode === 'delay') args.push(`delay=${locLimitReqDelay || '1'}`)
                                    setLocationDirective(loc, 'limit_req', args)
                                  }}
                                >
                                  <option value="queue">queue</option>
                                  <option value="nodelay">nodelay</option>
                                  <option value="delay">delay=N</option>
                                </select>
                                {!locLimitReqNodelay && locLimitReqDelay && (
                                  <input
                                    type="number"
                                    min="1"
                                    value={locLimitReqDelay}
                                    placeholder="N"
                                    className="loc-rate-short"
                                    title="Number of burst requests served immediately before delay kicks in."
                                    onChange={(e) => {
                                      const args = [`zone=${locLimitReqZone}`]
                                      if (locLimitReqBurst) args.push(`burst=${locLimitReqBurst}`)
                                      if (e.target.value) args.push(`delay=${e.target.value}`)
                                      setLocationDirective(loc, 'limit_req', args)
                                    }}
                                  />
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {(locLimitReqZone || locLimitReqStatus) && (
                          <div className="location-field">
                            <label>
                              limit_req_status
                              <InfoIcon text={'Override the HTTP status returned when `limit_req` rejects a request (default 503). 429 (Too Many Requests) is the RFC-6585 canonical code for rate limiting — API clients and CDNs use it to trigger their backoff logic.'} />
                            </label>
                            <input
                              type="number"
                              min="400"
                              max="599"
                              value={locLimitReqStatus}
                              placeholder="503"
                              className="loc-rate-short"
                              onChange={(e) =>
                                setLocationDirective(loc, 'limit_req_status', e.target.value ? [e.target.value] : [])
                              }
                            />
                          </div>
                        )}
                        <div className="location-field">
                          <label>
                            limit_conn
                            <InfoIcon text={'Caps concurrent (live) connections per key using a zone declared via `limit_conn_zone`. Excess connections get limit_conn_status (default 503). Location-level limit REPLACES an inherited server/http-level limit for this location.'} />
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
                              title="Pick a zone from HTTP Settings → Rate Limiting. Empty disables limit_conn for this location."
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
                                title="Max concurrent connections per zone key."
                                onChange={(e) => setLocationDirective(loc, 'limit_conn', [locLimitConnZone, e.target.value])}
                              />
                            )}
                          </div>
                        </div>
                        {(locLimitConnZone || locLimitConnStatus) && (
                          <div className="location-field">
                            <label>
                              limit_conn_status
                              <InfoIcon text={'Override the HTTP status returned when `limit_conn` rejects a connection (default 503). Recommended: 429 (matches RFC-6585 Too Many Requests).'} />
                            </label>
                            <input
                              type="number"
                              min="400"
                              max="599"
                              value={locLimitConnStatus}
                              placeholder="503"
                              className="loc-rate-short"
                              onChange={(e) =>
                                setLocationDirective(loc, 'limit_conn_status', e.target.value ? [e.target.value] : [])
                              }
                            />
                          </div>
                        )}

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
                        {/* §54.1 — satisfy any|all — only shown when auth + access rules coexist in this location */}
                        {(locHasAuth && locHasAccessRules) ? (
                          <div className="location-field">
                            <label>
                              satisfy
                              <InfoIcon text={'Controls how nginx combines `allow`/`deny` with the auth mechanism (`auth_basic` / `auth_request`). `all` (default): client must pass BOTH. `any`: client passes if EITHER succeeds — the canonical "office IPs bypass login, internet users get the auth dialog" recipe.'} />
                            </label>
                            <select
                              value={locSatisfy || 'all'}
                              onChange={(e) => {
                                const v = e.target.value
                                if (v === 'all') setLocationDirective(loc, 'satisfy', [])
                                else setLocationDirective(loc, 'satisfy', [v])
                              }}
                              title="all = must pass both auth AND access rules. any = must pass at least one."
                            >
                              <option value="all">all (default — must pass both)</option>
                              <option value="any">any (pass either auth OR access rule)</option>
                            </select>
                          </div>
                        ) : (locSatisfy && (
                          <div className="location-field">
                            <div className="satisfy-orphan-warning">
                              <InfoIcon text={'`satisfy ' + locSatisfy + '` is set but this location has no auth + access-rules combination — the directive has no effect. Remove it or add the missing piece.'} />
                              satisfy {locSatisfy} (no effect — needs both auth + allow/deny)
                              <button
                                type="button"
                                className="btn-preset"
                                onClick={() => setLocationDirective(loc, 'satisfy', [])}
                                title="Remove the orphan satisfy directive"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}

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

                        {/* §45.1 / §45.2 — Static files (root / alias / index / try_files) */}
                        {(() => {
                          const locRoot  = getDirectiveArg(loc, 'root', 0)
                          const locAlias = getDirectiveArg(loc, 'alias', 0)
                          const locIndex = getDirectiveArgs(loc, 'index').join(' ')
                          const tryFilesArgs = (loc.directives ?? []).find((d) => d.name === 'try_files')?.args ?? []
                          const rootAliasConflict = Boolean(locRoot) && Boolean(locAlias)

                          const writeTryFiles = (tokens: string[]) => {
                            const trimmed = tokens.map((t) => t.trim())
                            const hasAny = trimmed.some((t) => t !== '')
                            if (!hasAny) {
                              removeLocationDirective(loc, 'try_files')
                            } else {
                              setLocationDirective(loc, 'try_files', trimmed.filter(Boolean))
                            }
                          }

                          const moveToken = (from: number, delta: number) => {
                            const to = from + delta
                            if (to < 0 || to >= tryFilesArgs.length) return
                            const next = [...tryFilesArgs]
                            const [v] = next.splice(from, 1)
                            next.splice(to, 0, v)
                            writeTryFiles(next)
                          }

                          return (
                            <>
                              <div className="loc-timeouts-row">
                                <div className="location-field">
                                  <label>
                                    root
                                    <InfoIcon text="Filesystem directory served by this location. The final path is `root + URI` (e.g. root=/var/www + URI /foo.html → /var/www/foo.html). Mutually exclusive with `alias` — setting both is a config error nginx reports at reload time." />
                                  </label>
                                  <input
                                    type="text"
                                    value={locRoot}
                                    onChange={(e) =>
                                      setLocationDirective(loc, 'root', e.target.value ? [e.target.value] : [])
                                    }
                                    placeholder="/var/www/html"
                                    spellCheck={false}
                                  />
                                </div>
                                <div className="location-field">
                                  <label>
                                    alias
                                    <InfoIcon text="Filesystem directory that REPLACES the matched location prefix. For `location /static/ { alias /var/www/assets/; }`, URI /static/foo.png resolves to /var/www/assets/foo.png — the /static/ prefix is stripped. Use when the on-disk layout doesn't match the URL path. Must end with `/` when the location ends with `/`. Mutually exclusive with `root`." />
                                  </label>
                                  <input
                                    type="text"
                                    value={locAlias}
                                    onChange={(e) =>
                                      setLocationDirective(loc, 'alias', e.target.value ? [e.target.value] : [])
                                    }
                                    placeholder="/var/www/assets/"
                                    spellCheck={false}
                                  />
                                </div>
                                <div className="location-field">
                                  <label>
                                    index
                                    <InfoIcon text="Default files nginx looks for when the URI maps to a directory. Space-separated list; first match wins. Common values: `index.html index.htm`, or add `index.php` for PHP sites. Only applies to requests ending in `/`." />
                                  </label>
                                  <input
                                    type="text"
                                    value={locIndex}
                                    onChange={(e) =>
                                      setLocationDirective(loc, 'index', e.target.value ? e.target.value.split(/\s+/).filter(Boolean) : [])
                                    }
                                    placeholder="index.html index.htm"
                                    spellCheck={false}
                                  />
                                </div>
                              </div>
                              {rootAliasConflict && (
                                <div className="static-conflict-warning" role="alert">
                                  <strong>root and alias are mutually exclusive.</strong>
                                  {' '}Nginx will refuse the config at reload. Pick one — usually <code>alias</code> when the URL prefix needs to be stripped before mapping to disk, <code>root</code> otherwise.
                                </div>
                              )}

                              <div className="location-field">
                                <label>
                                  try_files
                                  <InfoIcon text="Ordered list of paths nginx tries; the first one that resolves to an existing file (or directory, when a token ends with /) is served. The LAST token is the fallback — it can be a URI (like /index.html for SPAs), a named location (@fallback), or an HTTP status code (=404). Without a fallback, nginx returns 404 if nothing matches. Powers SPA routing, PHP clean-URLs, and static-with-graceful-404 patterns." />
                                </label>
                                <div className="try-files-list">
                                  {tryFilesArgs.map((tok, ti) => (
                                    <div key={ti} className="try-files-row">
                                      <input
                                        type="text"
                                        value={tok}
                                        placeholder={ti === tryFilesArgs.length - 1 ? 'fallback (/index.html, @name, =404)' : '$uri, $uri/, /path'}
                                        onChange={(e) => {
                                          const next = [...tryFilesArgs]
                                          next[ti] = e.target.value
                                          writeTryFiles(next)
                                        }}
                                        spellCheck={false}
                                      />
                                      <button
                                        type="button"
                                        className="try-files-move"
                                        onClick={() => moveToken(ti, -1)}
                                        disabled={ti === 0}
                                        title="Move up"
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        className="try-files-move"
                                        onClick={() => moveToken(ti, 1)}
                                        disabled={ti === tryFilesArgs.length - 1}
                                        title="Move down"
                                      >
                                        ↓
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-remove-header"
                                        onClick={() => writeTryFiles(tryFilesArgs.filter((_, j) => j !== ti))}
                                        title="Remove token"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                  <div className="fcgi-param-presets">
                                    <button
                                      type="button"
                                      className="btn-add-header"
                                      onClick={() => writeTryFiles([...tryFilesArgs, ''])}
                                    >
                                      + Add token
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-preset"
                                      onClick={() => writeTryFiles(['$uri', '$uri/', '/index.html'])}
                                      title="try_files $uri $uri/ /index.html — SPA client-side routing"
                                    >
                                      SPA fallback
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-preset"
                                      onClick={() => writeTryFiles(['$uri', '$uri/', '/index.php?$query_string'])}
                                      title="try_files $uri $uri/ /index.php?$query_string — PHP clean URLs"
                                    >
                                      PHP clean URLs
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-preset"
                                      onClick={() => writeTryFiles(['$uri', '=404'])}
                                      title="try_files $uri =404 — static assets, explicit 404 on miss"
                                    >
                                      Static with 404
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-preset"
                                      onClick={() => writeTryFiles(['$uri', '@fallback'])}
                                      title="try_files $uri @fallback — delegate misses to a named location"
                                    >
                                      Named-location fallback
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </>
                          )
                        })()}

                        {/* §45.5 — types {} per-location MIME overrides */}
                        {(() => {
                          const typesBlock = (loc.directives ?? []).find((d) => d.name === 'types' && d.type === 'block')
                          const typesRowsCommitted = (typesBlock?.directives ?? []).map((d) => ({
                            mime: d.name,
                            exts: (d.args ?? []).join(' '),
                          }))
                          const typesDraftCount = getDrafts(loc.id, 'locTypesRow')
                          const typesRows = [
                            ...typesRowsCommitted,
                            ...Array.from({ length: typesDraftCount }, () => ({ mime: '', exts: '' })),
                          ]
                          const typesKey = loc.id ?? `loc-${li}`
                          const typesOpen = expandedTypes[typesKey] ?? typesRowsCommitted.length > 0

                          const writeTypesRows = (rows: { mime: string; exts: string }[]) => {
                            const directives = rows
                              .filter((r) => r.mime.trim() !== '' && r.exts.trim() !== '')
                              .map((r) => ({
                                type: 'directive' as const,
                                name: r.mime.trim(),
                                args: r.exts.trim().split(/\s+/).filter(Boolean),
                                enabled: true,
                              }))
                            const others = (loc.directives ?? []).filter((d) => !(d.name === 'types' && d.type === 'block'))
                            if (directives.length === 0) {
                              const afterCommitted = 0
                              syncDrafts(loc.id, 'locTypesRow', typesRowsCommitted.length, afterCommitted)
                              updateLocation(loc.id, (l) => ({ ...l, directives: others }))
                              return
                            }
                            const newTypesBlock = {
                              type: 'block' as const,
                              name: 'types',
                              args: [] as string[],
                              enabled: true,
                              id: typesBlock?.id ?? `types-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                              directives,
                            }
                            const afterCommitted = directives.length
                            syncDrafts(loc.id, 'locTypesRow', typesRowsCommitted.length, afterCommitted)
                            updateLocation(loc.id, (l) => ({ ...l, directives: [...others, newTypesBlock] }))
                          }

                          return (
                            <div className="fcgi-section">
                              <button
                                type="button"
                                className="ssl-section-toggle"
                                onClick={() => setExpandedTypes((p) => ({ ...p, [typesKey]: !typesOpen }))}
                              >
                                {typesOpen ? '▾' : '▸'} MIME types override (<code>types {'{ }'}</code>)
                                {typesRowsCommitted.length > 0 && (
                                  <span className="fcgi-badge"> {typesRowsCommitted.length} row{typesRowsCommitted.length === 1 ? '' : 's'}</span>
                                )}
                              </button>
                              {typesOpen && (
                                <div className="ssl-fields">
                                  <p className="open-file-hint">
                                    Declares a <code>types {'{…}'}</code> block scoped to this location, overriding the
                                    global MIME map (usually <code>/etc/nginx/mime.types</code>). Useful for serving
                                    <code> .mjs</code> / <code>.wasm</code> / <code>.webmanifest</code> with correct
                                    <code> Content-Type</code>, or forcing <code>text/plain</code> for a specific path.
                                    Unset rows are ignored on save.
                                  </p>
                                  <div className="header-list">
                                    {typesRows.map((row, ri) => (
                                      <div key={ri} className="header-row types-row">
                                        <input
                                          type="text"
                                          placeholder="application/javascript"
                                          value={row.mime}
                                          onChange={(e) =>
                                            writeTypesRows(
                                              typesRows.map((x, i) => (i === ri ? { ...x, mime: e.target.value } : x)),
                                            )
                                          }
                                          spellCheck={false}
                                        />
                                        <input
                                          type="text"
                                          placeholder="js mjs"
                                          value={row.exts}
                                          onChange={(e) =>
                                            writeTypesRows(
                                              typesRows.map((x, i) => (i === ri ? { ...x, exts: e.target.value } : x)),
                                            )
                                          }
                                          spellCheck={false}
                                        />
                                        <button
                                          type="button"
                                          className="btn-remove-header"
                                          onClick={() =>
                                            writeTypesRows(typesRows.filter((_, i) => i !== ri))
                                          }
                                          title="Remove row"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                    <div className="fcgi-param-presets">
                                      <button
                                        type="button"
                                        className="btn-add-header"
                                        onClick={() => addDraft(loc.id, 'locTypesRow')}
                                      >
                                        + Add row
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-preset"
                                        onClick={() => {
                                          const has = (m: string) =>
                                            typesRowsCommitted.some((r) => r.mime.toLowerCase() === m.toLowerCase())
                                          const extra: { mime: string; exts: string }[] = []
                                          if (!has('application/javascript'))
                                            extra.push({ mime: 'application/javascript', exts: 'js mjs' })
                                          if (!has('application/wasm'))
                                            extra.push({ mime: 'application/wasm', exts: 'wasm' })
                                          if (!has('application/manifest+json'))
                                            extra.push({ mime: 'application/manifest+json', exts: 'webmanifest' })
                                          if (extra.length > 0) writeTypesRows([...typesRowsCommitted, ...extra])
                                        }}
                                        title="Seeds application/javascript (js, mjs), application/wasm, and application/manifest+json — the MIME types nginx's default map gets wrong or misses"
                                      >
                                        + Modern web defaults
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })()}

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

                        {/* §44.1 — gRPC */}
                        {(() => {
                          const grpcPass = getDirectiveArg(loc, 'grpc_pass', 0)
                          const grpcReadT = getDirectiveArg(loc, 'grpc_read_timeout', 0)
                          const grpcSendT = getDirectiveArg(loc, 'grpc_send_timeout', 0)
                          const grpcHeadersCommitted = (loc.directives ?? [])
                            .filter((d) => d.name === 'grpc_set_header')
                            .map((d) => ({ key: d.args?.[0] ?? '', value: d.args?.[1] ?? '' }))
                          const grpcHeaderDraftCount = getDrafts(loc.id, 'locGrpcHeader')
                          const grpcHeaders = [
                            ...grpcHeadersCommitted,
                            ...Array.from({ length: grpcHeaderDraftCount }, () => ({ key: '', value: '' })),
                          ]
                          const grpcSslCert         = getDirectiveArg(loc, 'grpc_ssl_certificate', 0)
                          const grpcSslKey          = getDirectiveArg(loc, 'grpc_ssl_certificate_key', 0)
                          const grpcSslServerName   = getDirectiveArg(loc, 'grpc_ssl_server_name', 0)
                          const grpcSslVerify       = getDirectiveArg(loc, 'grpc_ssl_verify', 0) === 'on'
                          const grpcSslTrustedCert  = getDirectiveArg(loc, 'grpc_ssl_trusted_certificate', 0)
                          const grpcKey = loc.id ?? `loc-${li}`
                          const grpcUsesTLS = grpcPass.startsWith('grpcs://')
                          const grpcOpen = expandedGrpc[grpcKey] ?? Boolean(grpcPass || grpcHeadersCommitted.length > 0)

                          const writeGrpcHeaders = (rows: { key: string; value: string }[]) => {
                            const items = rows.map((r) => ({ args: [r.key, r.value] }))
                            const dirs = setBlockDirectivesMulti(loc.directives ?? [], 'grpc_set_header', items)
                            const afterCommitted = items.filter((it) => it.args.some((a) => a.trim() !== '')).length
                            syncDrafts(loc.id, 'locGrpcHeader', grpcHeadersCommitted.length, afterCommitted)
                            updateLocation(loc.id, (l) => ({ ...l, directives: dirs }))
                          }

                          return (
                            <div className="fcgi-section">
                              <button
                                type="button"
                                className="ssl-section-toggle"
                                onClick={() => setExpandedGrpc((p) => ({ ...p, [grpcKey]: !grpcOpen }))}
                              >
                                {grpcOpen ? '▾' : '▸'} gRPC
                                {Boolean(grpcPass) && <span className="fcgi-badge"> {grpcUsesTLS ? 'grpcs (TLS)' : 'grpc (h2c)'}</span>}
                              </button>
                              {grpcOpen && (
                                <div className="ssl-fields">
                                  <div className="location-field">
                                    <label>
                                      grpc_pass
                                      <InfoIcon text="Target gRPC backend. Use `grpc://host:port` for plaintext HTTP/2 (h2c — common on a private network) or `grpcs://host:port` for TLS. The enclosing server MUST listen with the `http2` flag — gRPC is HTTP/2-only. Without it, clients will get stream errors and connection resets." />
                                    </label>
                                    <input
                                      type="text"
                                      value={grpcPass}
                                      onChange={(e) =>
                                        setLocationDirective(loc, 'grpc_pass', e.target.value ? [e.target.value] : [])
                                      }
                                      placeholder="grpc://127.0.0.1:50051 or grpcs://service.internal:443"
                                      spellCheck={false}
                                    />
                                  </div>

                                  <div className="location-field">
                                    <label>
                                      grpc_set_header
                                      <InfoIcon text="Headers nginx forwards to the gRPC backend on every request. Common uses: pinning authority with `Host $host`, forwarding the client IP via `X-Real-IP $remote_addr`, propagating tracing headers. Unlike proxy_set_header, these go on HTTP/2 frames." />
                                    </label>
                                    <div className="header-list">
                                      {grpcHeaders.map((h, hi) => (
                                        <div key={hi} className="header-row">
                                          <input
                                            type="text"
                                            placeholder="Header"
                                            value={h.key}
                                            onChange={(e) =>
                                              writeGrpcHeaders(
                                                grpcHeaders.map((x, i) => (i === hi ? { ...x, key: e.target.value } : x)),
                                              )
                                            }
                                            spellCheck={false}
                                          />
                                          <input
                                            type="text"
                                            placeholder="$value"
                                            value={h.value}
                                            onChange={(e) =>
                                              writeGrpcHeaders(
                                                grpcHeaders.map((x, i) => (i === hi ? { ...x, value: e.target.value } : x)),
                                              )
                                            }
                                            spellCheck={false}
                                          />
                                          <button
                                            type="button"
                                            className="btn-remove-header"
                                            onClick={() =>
                                              writeGrpcHeaders(grpcHeaders.filter((_, i) => i !== hi))
                                            }
                                            title="Remove header"
                                          >
                                            ×
                                          </button>
                                        </div>
                                      ))}
                                      <div className="fcgi-param-presets">
                                        <button
                                          type="button"
                                          className="btn-add-header"
                                          onClick={() => addDraft(loc.id, 'locGrpcHeader')}
                                        >
                                          + Add header
                                        </button>
                                        <button
                                          type="button"
                                          className="btn-preset"
                                          onClick={() => {
                                            const has = (k: string) =>
                                              grpcHeadersCommitted.some((h) => h.key.toLowerCase() === k.toLowerCase())
                                            const extra: { key: string; value: string }[] = []
                                            if (!has('Host')) extra.push({ key: 'Host', value: '$host' })
                                            if (!has('X-Real-IP')) extra.push({ key: 'X-Real-IP', value: '$remote_addr' })
                                            if (extra.length > 0) writeGrpcHeaders([...grpcHeadersCommitted, ...extra])
                                          }}
                                          title="Adds Host and X-Real-IP identity headers"
                                        >
                                          + Identity headers
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="loc-timeouts-row">
                                    <div className="location-field">
                                      <label>
                                        grpc_read_timeout
                                        <InfoIcon text="Max time between two successive reads on the gRPC response stream. Default 60s. For long streaming RPCs (server-streaming, bidirectional) raise to 3600s or more — nginx closes the HTTP/2 stream with a RST_STREAM on timeout." />
                                      </label>
                                      <input
                                        type="text"
                                        value={grpcReadT}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'grpc_read_timeout', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="60s"
                                      />
                                    </div>
                                    <div className="location-field">
                                      <label>
                                        grpc_send_timeout
                                        <InfoIcon text="Max time between two successive writes to the gRPC backend (not total request duration). Default 60s. Relevant for large client-streaming uploads." />
                                      </label>
                                      <input
                                        type="text"
                                        value={grpcSendT}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'grpc_send_timeout', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="60s"
                                      />
                                    </div>
                                  </div>

                                  <div className="grpc-ssl-subsection">
                                    <div className="grpc-ssl-title">
                                      gRPC TLS (applies when <code>grpc_pass</code> uses <code>grpcs://</code>)
                                    </div>
                                    <div className="location-field">
                                      <label>
                                        grpc_ssl_server_name
                                        <InfoIcon text="SNI hostname sent on the TLS handshake to the backend. Usually matches the certificate's CN/SAN. Useful when `grpc_pass` targets an IP or an upstream name but the backend cert is issued for a specific DNS name." />
                                      </label>
                                      <input
                                        type="text"
                                        value={grpcSslServerName}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'grpc_ssl_server_name', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="service.internal"
                                        disabled={!grpcUsesTLS}
                                      />
                                    </div>
                                    <div className="location-field">
                                      <label className="checkbox-label">
                                        <input
                                          type="checkbox"
                                          checked={grpcSslVerify}
                                          disabled={!grpcUsesTLS}
                                          onChange={(e) =>
                                            setLocationDirective(loc, 'grpc_ssl_verify', [e.target.checked ? 'on' : 'off'])
                                          }
                                        />
                                        grpc_ssl_verify
                                        <InfoIcon text="Validate the backend's certificate chain against grpc_ssl_trusted_certificate. Off by default — leaving it off is dangerous on untrusted networks. Turn on for any traffic leaving the trusted perimeter." />
                                      </label>
                                    </div>
                                    <div className="location-field">
                                      <label>
                                        grpc_ssl_trusted_certificate
                                        <InfoIcon text="CA bundle used to verify the backend's certificate when grpc_ssl_verify is on. Point to the CA that signed the backend cert (self-signed internal CA, Let's Encrypt chain, etc.)." />
                                      </label>
                                      <input
                                        type="text"
                                        value={grpcSslTrustedCert}
                                        onChange={(e) =>
                                          setLocationDirective(loc, 'grpc_ssl_trusted_certificate', e.target.value ? [e.target.value] : [])
                                        }
                                        placeholder="/etc/ssl/certs/ca-certificates.crt"
                                        spellCheck={false}
                                        disabled={!grpcUsesTLS}
                                      />
                                    </div>
                                    <div className="loc-timeouts-row">
                                      <div className="location-field">
                                        <label>
                                          grpc_ssl_certificate
                                          <InfoIcon text="Client certificate nginx presents to the gRPC backend during mTLS. Pair with grpc_ssl_certificate_key. Leave blank unless the backend requires client auth." />
                                        </label>
                                        <input
                                          type="text"
                                          value={grpcSslCert}
                                          onChange={(e) =>
                                            setLocationDirective(loc, 'grpc_ssl_certificate', e.target.value ? [e.target.value] : [])
                                          }
                                          placeholder="/etc/ssl/client/client.crt"
                                          spellCheck={false}
                                          disabled={!grpcUsesTLS}
                                        />
                                      </div>
                                      <div className="location-field">
                                        <label>
                                          grpc_ssl_certificate_key
                                          <InfoIcon text="Private key matching grpc_ssl_certificate. Must be readable by the nginx worker user." />
                                        </label>
                                        <input
                                          type="text"
                                          value={grpcSslKey}
                                          onChange={(e) =>
                                            setLocationDirective(loc, 'grpc_ssl_certificate_key', e.target.value ? [e.target.value] : [])
                                          }
                                          placeholder="/etc/ssl/client/client.key"
                                          spellCheck={false}
                                          disabled={!grpcUsesTLS}
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
      {corsPrompt && (
        <PromptModal
          title="Explicit CORS origin"
          message={<>Enter the single origin allowed to make cross-origin requests. The value is written as <code>Access-Control-Allow-Origin</code> and paired with <code>Access-Control-Allow-Credentials: true</code>. For multiple origins, use a <code>map $http_origin $cors_allowed_origin</code> in HTTP Settings instead.</>}
          placeholder="https://app.example.com"
          initialValue="https://app.example.com"
          inputType="url"
          confirmLabel="Apply CORS"
          validate={(v) => /^https?:\/\/[^\s/]+/.test(v) ? null : 'Must be a full origin URL (http:// or https://)'}
          onConfirm={(v) => { corsPrompt.onConfirm(v); setCorsPrompt(null) }}
          onCancel={() => setCorsPrompt(null)}
        />
      )}
    </div>
  )
}
