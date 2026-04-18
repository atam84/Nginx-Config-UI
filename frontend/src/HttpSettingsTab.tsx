import { useState } from 'react'
import { type ConfigFile, type Node, resolveInclude } from './api'
import { setBlockDirective, setBlockDirectivesMulti } from './configUtils'
import LogFormatBuilder from './LogFormatBuilder'
import InfoIcon from './InfoIcon'
import './HttpSettingsTab.css'

// ─── Helpers for reading http block directives ────────────────────────────────

function getArg(block: Node | undefined, name: string, idx = 0): string {
  return block?.directives?.find((d) => d.name === name)?.args?.[idx] ?? ''
}

function getArgs(block: Node | undefined, name: string): string[] {
  return block?.directives?.find((d) => d.name === name)?.args ?? []
}

function getToggle(block: Node | undefined, name: string): boolean {
  return getArg(block, name) === 'on'
}

function getAllByName(block: Node | undefined, name: string): Node[] {
  return block?.directives?.filter((d) => d.name === name) ?? []
}

// ─── Helper for updating the http block inside the ConfigFile ─────────────────

function applyToHttp(c: ConfigFile, fn: (dirs: Node[]) => Node[]): ConfigFile {
  const dirs = c.directives ?? []
  const httpIdx = dirs.findIndex((d) => d.name === 'http' && d.type === 'block')
  if (httpIdx < 0) return c // nothing to do if http block absent
  const http = dirs[httpIdx]
  return {
    ...c,
    directives: [
      ...dirs.slice(0, httpIdx),
      { ...http, directives: fn(http.directives ?? []) },
      ...dirs.slice(httpIdx + 1),
    ],
  }
}

function ensureSingle(dirs: Node[], name: string, args: string[]): Node[] {
  if (dirs.some((d) => d.name === name)) return dirs
  return [...dirs, { type: 'directive', name, args, enabled: true }]
}

function forceSingle(dirs: Node[], name: string, args: string[]): Node[] {
  const idx = dirs.findIndex((d) => d.name === name)
  if (idx === -1) return [...dirs, { type: 'directive', name, args, enabled: true }]
  return dirs.map((d, i) => (i === idx ? { ...d, args, enabled: true } : d))
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SSL_PROTOCOLS = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']

const GZIP_PROXIED_OPTIONS = [
  'off', 'any', 'expired', 'no-cache', 'no-store', 'private',
  'no_last_modified', 'no_etag', 'auth',
]

const REAL_IP_HEADERS = ['X-Forwarded-For', 'X-Real-IP', 'X-Forwarded', 'Forwarded-For', 'True-Client-IP']

const PROXY_CACHE_USE_STALE_OPTIONS = ['error', 'timeout', 'invalid_header', 'updating', 'http_500', 'http_502', 'http_503', 'http_504', 'http_403', 'http_404', 'off']

function buildReqZoneArgs(z: { key: string; name: string; size: string; rate: string }): string[] {
  return [z.key, `zone=${z.name}:${z.size}`, `rate=${z.rate}`]
}

function buildConnZoneArgs(z: { key: string; name: string; size: string }): string[] {
  return [z.key, `zone=${z.name}:${z.size}`]
}

function buildCachePathArgs(z: { path: string; zoneName: string; zoneSize: string; levels: string; maxSize: string; inactive: string }): string[] {
  const args = [z.path]
  if (z.levels) args.push(`levels=${z.levels}`)
  args.push(`keys_zone=${z.zoneName}:${z.zoneSize}`)
  if (z.maxSize) args.push(`max_size=${z.maxSize}`)
  if (z.inactive) args.push(`inactive=${z.inactive}`)
  return args
}

type SectionId = 'performance' | 'compression' | 'ssl' | 'logging' | 'realip' | 'includes' | 'maps' | 'ratelimit' | 'cachezones' | 'geo'

// ─── Map block data ───────────────────────────────────────────────────────────

interface MapBlockData {
  id?: string
  sourceVar: string
  resultVar: string
  hostnames: boolean
  volatile: boolean
  entries: { pattern: string; value: string }[]
}

// ─── Geo block data ───────────────────────────────────────────────────────────

interface GeoBlockData {
  id?: string
  sourceVar: string   // optional source, e.g. "$http_x_forwarded_for"
  resultVar: string   // output variable, e.g. "$country"
  ranges: boolean
  defaultVal: string
  entries: { cidr: string; value: string }[]
}

interface GeoIP2BlockData {
  id?: string
  dbPath: string
  bindings: { variable: string; args: string }[]
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  httpBlock?: Node
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  readOnly?: boolean
}

export default function HttpSettingsTab({ httpBlock, onUpdate, readOnly }: Props) {
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set<SectionId>(['performance', 'compression', 'ssl', 'logging', 'realip', 'includes', 'maps', 'ratelimit', 'cachezones', 'geo'])
  )
  const [newRealIpEntry, setNewRealIpEntry] = useState('')
  const [newInclude, setNewInclude] = useState('')
  const [resolvedIncludes, setResolvedIncludes] = useState<Record<number, string[]>>({})
  const [resolvingInclude, setResolvingInclude] = useState<number | null>(null)
  const [newReqZone, setNewReqZone] = useState({ key: '$binary_remote_addr', name: '', size: '10m', rate: '10r/s' })
  const [newConnZone, setNewConnZone] = useState({ key: '$binary_remote_addr', name: '', size: '10m' })
  const [newCachePath, setNewCachePath] = useState({ path: '/var/cache/nginx', zoneName: '', zoneSize: '10m', levels: '1:2', maxSize: '1g', inactive: '60m' })

  const toggleSection = (s: SectionId) =>
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })

  // Shorthand updaters
  const setDir = (name: string, args: string[]) =>
    onUpdate((c) => applyToHttp(c, (dirs) => setBlockDirective(dirs, name, args)))

  const setToggle = (name: string, on: boolean) => setDir(name, [on ? 'on' : 'off'])

  const setMulti = (name: string, items: { args: string[] }[]) =>
    onUpdate((c) => applyToHttp(c, (dirs) => setBlockDirectivesMulti(dirs, name, items)))

  // ── Recommended-defaults presets ──
  const applyPerformancePreset = () => {
    onUpdate((c) => applyToHttp(c, (dirs) => {
      let d = dirs
      d = ensureSingle(d, 'sendfile', ['on'])
      d = ensureSingle(d, 'tcp_nopush', ['on'])
      d = ensureSingle(d, 'tcp_nodelay', ['on'])
      d = ensureSingle(d, 'types_hash_max_size', ['2048'])
      d = ensureSingle(d, 'keepalive_timeout', ['65'])
      d = ensureSingle(d, 'keepalive_requests', ['1000'])
      d = ensureSingle(d, 'client_max_body_size', ['10m'])
      // Gzip defaults
      d = forceSingle(d, 'gzip', ['on'])
      d = ensureSingle(d, 'gzip_vary', ['on'])
      d = ensureSingle(d, 'gzip_comp_level', ['5'])
      d = ensureSingle(d, 'gzip_min_length', ['256'])
      d = ensureSingle(d, 'gzip_proxied', ['any'])
      d = ensureSingle(d, 'gzip_types', [
        'text/plain', 'text/css', 'text/xml', 'application/json',
        'application/javascript', 'application/xml+rss', 'application/atom+xml',
        'image/svg+xml',
      ])
      return d
    }))
  }

  const applyHardeningPreset = () => {
    onUpdate((c) => applyToHttp(c, (dirs) => {
      let d = dirs
      d = forceSingle(d, 'server_tokens', ['off'])
      // Modern TLS: TLSv1.2 + TLSv1.3
      d = forceSingle(d, 'ssl_protocols', ['TLSv1.2', 'TLSv1.3'])
      d = forceSingle(d, 'ssl_prefer_server_ciphers', ['on'])
      d = ensureSingle(d, 'ssl_session_cache', ['shared:SSL:10m'])
      d = ensureSingle(d, 'ssl_session_timeout', ['1d'])
      d = ensureSingle(d, 'ssl_session_tickets', ['off'])
      d = ensureSingle(d, 'ssl_ciphers', [
        'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:' +
        'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:' +
        'ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305',
      ])
      return d
    }))
  }

  const applyLoggingPreset = () => {
    onUpdate((c) => applyToHttp(c, (dirs) => {
      let d = dirs
      // Add a named log_format 'main' if none exists
      const hasAnyLogFormat = d.some((x) => x.name === 'log_format')
      if (!hasAnyLogFormat) {
        d = [...d, {
          type: 'directive', name: 'log_format', enabled: true,
          args: [
            'main',
            '$remote_addr - $remote_user [$time_local] "$request" ' +
            '$status $body_bytes_sent "$http_referer" ' +
            '"$http_user_agent" "$http_x_forwarded_for" rt=$request_time uct=$upstream_connect_time',
          ],
        }]
      }
      d = ensureSingle(d, 'access_log', ['/var/log/nginx/access.log', 'main'])
      return d
    }))
  }

  // ── Performance ──
  const sendfile       = getToggle(httpBlock, 'sendfile')
  const tcpNopush      = getToggle(httpBlock, 'tcp_nopush')
  const tcpNodelay     = getToggle(httpBlock, 'tcp_nodelay')
  const serverTokens   = getToggle(httpBlock, 'server_tokens')
  const keepaliveTo    = getArg(httpBlock, 'keepalive_timeout')
  const keepaliveReqs  = getArg(httpBlock, 'keepalive_requests')
  const typesHashMax   = getArg(httpBlock, 'types_hash_max_size')
  const clientMaxBody  = getArg(httpBlock, 'client_max_body_size')
  const defaultType    = getArg(httpBlock, 'default_type')

  // ── Compression ──
  const gzipOn          = getToggle(httpBlock, 'gzip')
  const gzipCompLevel   = getArg(httpBlock, 'gzip_comp_level') || '6'
  const gzipMinLength   = getArg(httpBlock, 'gzip_min_length') || '256'
  const gzipTypesArgs   = getArgs(httpBlock, 'gzip_types')
  const gzipProxied     = getArgs(httpBlock, 'gzip_proxied')
  const gzipVary        = getToggle(httpBlock, 'gzip_vary')
  const gzipBuffers     = getArg(httpBlock, 'gzip_buffers')

  // ── SSL Defaults ──
  const sslProtocols          = getArgs(httpBlock, 'ssl_protocols')
  const sslPreferSrvCiphers   = getToggle(httpBlock, 'ssl_prefer_server_ciphers')
  const sslSessionCache       = getArg(httpBlock, 'ssl_session_cache')
  const sslSessionTimeout     = getArg(httpBlock, 'ssl_session_timeout')

  // ── Logging ──
  const accessLogPath   = getArg(httpBlock, 'access_log', 0)
  const accessLogFmt    = getArg(httpBlock, 'access_log', 1)
  const logFormats      = getAllByName(httpBlock, 'log_format')

  // ── Real IP ──
  const realIpHeader    = getArg(httpBlock, 'real_ip_header')
  const realIpRecursive = getToggle(httpBlock, 'real_ip_recursive')
  const realIpSources   = getAllByName(httpBlock, 'set_real_ip_from').map((d) => d.args?.[0] ?? '')

  // ── Includes ──
  const includes = getAllByName(httpBlock, 'include').map((d) => d.args?.[0] ?? '')

  // ── Rate Limiting ──
  const reqZones = getAllByName(httpBlock, 'limit_req_zone').map((d) => {
    const args = d.args ?? []
    const key = args[0] ?? '$binary_remote_addr'
    const zoneArg = args.find((a) => a.startsWith('zone=')) ?? ''
    const [zoneNamePart, zoneSizePart] = zoneArg.replace('zone=', '').split(':')
    const rateArg = args.find((a) => a.startsWith('rate=')) ?? ''
    return { key, name: zoneNamePart ?? '', size: zoneSizePart ?? '10m', rate: rateArg.replace('rate=', '') || '10r/s' }
  })
  const connZones = getAllByName(httpBlock, 'limit_conn_zone').map((d) => {
    const args = d.args ?? []
    const key = args[0] ?? '$binary_remote_addr'
    const zoneArg = args.find((a) => a.startsWith('zone=')) ?? ''
    const [zoneNamePart, zoneSizePart] = zoneArg.replace('zone=', '').split(':')
    return { key, name: zoneNamePart ?? '', size: zoneSizePart ?? '10m' }
  })
  const limitReqStatus = getArg(httpBlock, 'limit_req_status')

  // ── Cache Zones ──
  const cachePaths = getAllByName(httpBlock, 'proxy_cache_path').map((d) => {
    const args = d.args ?? []
    const path = args[0] ?? ''
    const keysZoneArg = args.find((a) => a.startsWith('keys_zone=')) ?? ''
    const [kzName, kzSize] = keysZoneArg.replace('keys_zone=', '').split(':')
    const levelsArg = args.find((a) => a.startsWith('levels=')) ?? ''
    const maxSizeArg = args.find((a) => a.startsWith('max_size=')) ?? ''
    const inactiveArg = args.find((a) => a.startsWith('inactive=')) ?? ''
    return {
      path,
      zoneName: kzName ?? '',
      zoneSize: kzSize ?? '10m',
      levels: levelsArg.replace('levels=', '') || '1:2',
      maxSize: maxSizeArg.replace('max_size=', '') || '',
      inactive: inactiveArg.replace('inactive=', '') || '',
    }
  })

  // ── Map blocks ──
  const mapBlocks = (httpBlock?.directives ?? []).filter((d) => d.name === 'map' && d.type === 'block')

  const mapBlocksData: MapBlockData[] = mapBlocks.map((block) => ({
    id: block.id,
    sourceVar: block.args?.[0] ?? '',
    resultVar: block.args?.[1] ?? '',
    hostnames: !!block.directives?.find((d) => d.name === 'hostnames'),
    volatile: !!block.directives?.find((d) => d.name === 'volatile'),
    entries: (block.directives ?? [])
      .filter((d) => d.name !== 'hostnames' && d.name !== 'volatile')
      .map((d) => ({ pattern: d.name, value: d.args?.[0] ?? '' })),
  }))

  const updateMapBlocks = (maps: MapBlockData[]) => {
    onUpdate((c) =>
      applyToHttp(c, (dirs) => {
        const rest = dirs.filter((d) => !(d.name === 'map' && d.type === 'block'))
        const nodes = maps.map((m) => ({
          type: 'block' as const,
          name: 'map',
          args: [m.sourceVar, m.resultVar],
          enabled: true,
          id: m.id || `map-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          directives: [
            ...(m.hostnames ? [{ type: 'directive' as const, name: 'hostnames', args: [] as string[], enabled: true }] : []),
            ...(m.volatile ? [{ type: 'directive' as const, name: 'volatile', args: [] as string[], enabled: true }] : []),
            ...m.entries.map((e) => ({ type: 'directive' as const, name: e.pattern, args: [e.value], enabled: true })),
          ],
        }))
        return [...rest, ...nodes]
      })
    )
  }

  // ── Geo blocks ──
  const geoBlocks = (httpBlock?.directives ?? []).filter((d) => d.name === 'geo' && d.type === 'block')
  const geoBlocksData: GeoBlockData[] = geoBlocks.map((block) => {
    const args = block.args ?? []
    const resultVar = args.length >= 2 ? args[1] : (args[0] ?? '')
    const sourceVar = args.length >= 2 ? args[0] : ''
    const defaultDir = block.directives?.find((d) => d.name === 'default')
    const rangesDir = block.directives?.find((d) => d.name === 'ranges')
    return {
      id: block.id,
      sourceVar,
      resultVar,
      ranges: !!rangesDir,
      defaultVal: defaultDir?.args?.[0] ?? '',
      entries: (block.directives ?? [])
        .filter((d) => d.name !== 'default' && d.name !== 'ranges')
        .map((d) => ({ cidr: d.name, value: d.args?.[0] ?? '' })),
    }
  })

  const updateGeoBlocks = (geos: GeoBlockData[]) => {
    onUpdate((c) =>
      applyToHttp(c, (dirs) => {
        const rest = dirs.filter((d) => !(d.name === 'geo' && d.type === 'block'))
        const nodes = geos.map((g) => ({
          type: 'block' as const,
          name: 'geo',
          args: g.sourceVar ? [g.sourceVar, g.resultVar] : [g.resultVar],
          enabled: true,
          id: g.id || `geo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          directives: [
            ...(g.ranges ? [{ type: 'directive' as const, name: 'ranges', args: [] as string[], enabled: true }] : []),
            ...(g.defaultVal !== '' ? [{ type: 'directive' as const, name: 'default', args: [g.defaultVal], enabled: true }] : []),
            ...g.entries.map((e) => ({ type: 'directive' as const, name: e.cidr, args: [e.value], enabled: true })),
          ],
        }))
        return [...rest, ...nodes]
      })
    )
  }

  // ── GeoIP2 blocks ──
  const geoip2Blocks = (httpBlock?.directives ?? []).filter((d) => d.name === 'geoip2' && d.type === 'block')
  const geoip2BlocksData: GeoIP2BlockData[] = geoip2Blocks.map((block) => ({
    id: block.id,
    dbPath: block.args?.[0] ?? '',
    bindings: (block.directives ?? []).map((d) => ({
      variable: d.name,
      args: (d.args ?? []).join(' '),
    })),
  }))

  const updateGeoIP2Blocks = (blocks: GeoIP2BlockData[]) => {
    onUpdate((c) =>
      applyToHttp(c, (dirs) => {
        const rest = dirs.filter((d) => !(d.name === 'geoip2' && d.type === 'block'))
        const nodes = blocks.map((g) => ({
          type: 'block' as const,
          name: 'geoip2',
          args: [g.dbPath],
          enabled: true,
          id: g.id || `geoip2-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          directives: g.bindings.map((b) => ({
            type: 'directive' as const,
            name: b.variable,
            args: b.args ? b.args.split(/\s+/).filter(Boolean) : [],
            enabled: true,
          })),
        }))
        return [...rest, ...nodes]
      })
    )
  }

  if (!httpBlock) {
    return (
      <div className="http-settings">
        <p className="http-no-block">
          No <code>http &#123;&#125;</code> block found in this config file. Add a server block first to auto-create the http context.
        </p>
      </div>
    )
  }

  return (
    <div className="http-settings">

      {!readOnly && (
        <div className="hs-presets">
          <div className="hs-presets-header">
            <span className="hs-presets-title">Recommended defaults</span>
            <InfoIcon text="One-click presets that add sensible directives into the http { } block. Existing values are preserved except where noted on each button. Safe to re-apply." />
          </div>
          <div className="hs-presets-buttons">
            <button
              type="button"
              className="hs-preset-btn"
              onClick={applyPerformancePreset}
              title="Sendfile/TCP tuning · keepalive · sensible body size · gzip on with common MIME types"
            >
              <span className="hs-preset-dot" style={{ background: '#22c55e' }} />
              Apply performance defaults
              <InfoIcon text="sendfile/tcp_nopush/tcp_nodelay on · types_hash_max_size 2048 · keepalive_timeout 65 · keepalive_requests 1000 · client_max_body_size 10m · gzip on with vary/comp_level 5/min_length 256/proxied any + common text MIME types. Existing values kept; gzip is forced on." />
            </button>
            <button
              type="button"
              className="hs-preset-btn"
              onClick={applyHardeningPreset}
              title="server_tokens off · TLS 1.2+1.3 only · modern ciphers · session cache tuning"
            >
              <span className="hs-preset-dot" style={{ background: '#f97316' }} />
              Apply hardening defaults
              <InfoIcon text="Forces: server_tokens off · ssl_protocols TLSv1.2 TLSv1.3 · ssl_prefer_server_ciphers on · modern ECDHE/GCM/CHACHA20 cipher list. Adds if missing: ssl_session_cache shared:SSL:10m · ssl_session_timeout 1d · ssl_session_tickets off." />
            </button>
            <button
              type="button"
              className="hs-preset-btn"
              onClick={applyLoggingPreset}
              title="Adds a 'main' log_format with timing fields · access_log → main"
            >
              <span className="hs-preset-dot" style={{ background: '#3b82f6' }} />
              Apply logging defaults
              <InfoIcon text="If no log_format exists, adds 'main' with request_time / upstream_connect_time fields useful for performance debugging, then sets access_log /var/log/nginx/access.log main (only if access_log is unset)." />
            </button>
          </div>
        </div>
      )}

      {/* ── Performance ───────────────────────────────────────────────────── */}
      <CollapsibleSection
        id="performance"
        title="Performance"
        info="Core http-block tuning: file-sending (sendfile), TCP framing (tcp_nopush, tcp_nodelay), keepalive, body-size limits, and hash table sizing. Most sites benefit from the performance preset above."
        open={openSections.has('performance')}
        onToggle={() => toggleSection('performance')}
      >
        <div className="hs-toggle-grid">
          <ToggleField label="sendfile"    value={sendfile}     onChange={(v) => setToggle('sendfile', v)}    readOnly={readOnly} />
          <ToggleField label="tcp_nopush"  value={tcpNopush}    onChange={(v) => setToggle('tcp_nopush', v)}  readOnly={readOnly} />
          <ToggleField label="tcp_nodelay" value={tcpNodelay}   onChange={(v) => setToggle('tcp_nodelay', v)} readOnly={readOnly} />
          <ToggleField label="server_tokens" hint="off recommended" value={serverTokens} onChange={(v) => setToggle('server_tokens', v)} readOnly={readOnly} />
        </div>
        <div className="hs-row">
          <TextField label="keepalive_timeout"   value={keepaliveTo}   placeholder="65"   onChange={(v) => setDir('keepalive_timeout',   v ? [v] : [])} readOnly={readOnly} />
          <TextField label="keepalive_requests"  value={keepaliveReqs} placeholder="100"  onChange={(v) => setDir('keepalive_requests',  v ? [v] : [])} readOnly={readOnly} />
          <TextField label="types_hash_max_size" value={typesHashMax}  placeholder="2048" onChange={(v) => setDir('types_hash_max_size', v ? [v] : [])} readOnly={readOnly} />
        </div>
        <div className="hs-row">
          <TextField label="client_max_body_size" value={clientMaxBody} placeholder="1m" onChange={(v) => setDir('client_max_body_size', v ? [v] : [])} readOnly={readOnly} />
          <TextField label="default_type"         value={defaultType}   placeholder="application/octet-stream" onChange={(v) => setDir('default_type', v ? [v] : [])} readOnly={readOnly} />
        </div>
      </CollapsibleSection>

      {/* ── Compression ───────────────────────────────────────────────────── */}
      <CollapsibleSection
        id="compression"
        title="Compression (Gzip)"
        info="Response compression (gzip). Compresses text-like bodies before sending. Higher gzip_comp_level = smaller payload but more CPU (5–6 is a good balance). gzip_types must explicitly list MIME types to compress — html is always included."
        open={openSections.has('compression')}
        onToggle={() => toggleSection('compression')}
      >
        <div className="hs-toggle-grid">
          <ToggleField label="gzip"      value={gzipOn}   onChange={(v) => setToggle('gzip', v)}       readOnly={readOnly} />
          <ToggleField label="gzip_vary" value={gzipVary} onChange={(v) => setToggle('gzip_vary', v)}  readOnly={readOnly} />
        </div>
        <div className="hs-row">
          <div className="hs-field">
            <label>gzip_comp_level <span className="hs-hint">1–9</span></label>
            <div className="hs-slider-row">
              <input
                type="range" min="1" max="9"
                value={gzipCompLevel}
                onChange={(e) => setDir('gzip_comp_level', [e.target.value])}
                disabled={readOnly}
              />
              <span className="hs-slider-val">{gzipCompLevel}</span>
            </div>
          </div>
          <TextField label="gzip_min_length" value={gzipMinLength} placeholder="256" onChange={(v) => setDir('gzip_min_length', v ? [v] : [])} readOnly={readOnly} />
          <TextField label="gzip_buffers"    value={gzipBuffers}   placeholder="16 8k" onChange={(v) => setDir('gzip_buffers', v ? v.split(/\s+/).filter(Boolean) : [])} readOnly={readOnly} />
        </div>
        <div className="hs-field">
          <label>gzip_proxied</label>
          <div className="hs-checkbox-group">
            {GZIP_PROXIED_OPTIONS.map((opt) => (
              <label key={opt} className="hs-check-label">
                <input
                  type="checkbox"
                  checked={gzipProxied.includes(opt)}
                  disabled={readOnly || (opt !== 'off' && gzipProxied.includes('off'))}
                  onChange={(e) => {
                    let next: string[]
                    if (opt === 'off') {
                      next = e.target.checked ? ['off'] : []
                    } else {
                      next = e.target.checked
                        ? [...gzipProxied.filter((x) => x !== 'off'), opt]
                        : gzipProxied.filter((x) => x !== opt)
                    }
                    setDir('gzip_proxied', next)
                  }}
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
        <div className="hs-field">
          <label>gzip_types <span className="hs-hint">space-separated MIME types</span></label>
          <textarea
            className="hs-textarea"
            value={gzipTypesArgs.join(' ')}
            onChange={(e) => {
              const types = e.target.value.split(/\s+/).filter(Boolean)
              setDir('gzip_types', types)
            }}
            readOnly={readOnly}
            placeholder="text/plain text/css application/json application/javascript"
            rows={3}
          />
        </div>
      </CollapsibleSection>

      {/* ── SSL Defaults ──────────────────────────────────────────────────── */}
      <CollapsibleSection
        id="ssl"
        title="SSL Defaults"
        info="Global TLS settings inherited by all server blocks unless overridden. Use TLSv1.2 + TLSv1.3 only — older protocols (TLSv1, 1.1) have known weaknesses. ssl_prefer_server_ciphers only matters for TLSv1.2 (TLSv1.3 negotiation is different)."
        open={openSections.has('ssl')}
        onToggle={() => toggleSection('ssl')}
      >
        <div className="hs-field">
          <label>ssl_protocols</label>
          <div className="hs-checkbox-group">
            {SSL_PROTOCOLS.map((proto) => (
              <label key={proto} className="hs-check-label">
                <input
                  type="checkbox"
                  checked={sslProtocols.includes(proto)}
                  disabled={readOnly}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...sslProtocols, proto]
                      : sslProtocols.filter((p) => p !== proto)
                    setDir('ssl_protocols', next)
                  }}
                />
                {proto}
              </label>
            ))}
          </div>
        </div>
        <div className="hs-toggle-grid">
          <ToggleField label="ssl_prefer_server_ciphers" value={sslPreferSrvCiphers} onChange={(v) => setToggle('ssl_prefer_server_ciphers', v)} readOnly={readOnly} />
        </div>
        <div className="hs-row">
          <TextField label="ssl_session_cache"   value={sslSessionCache}   placeholder="shared:SSL:10m" onChange={(v) => setDir('ssl_session_cache',   v ? v.split(/\s+/).filter(Boolean) : [])} readOnly={readOnly} />
          <TextField label="ssl_session_timeout" value={sslSessionTimeout} placeholder="10m"           onChange={(v) => setDir('ssl_session_timeout', v ? [v] : [])} readOnly={readOnly} />
        </div>
      </CollapsibleSection>

      {/* ── Logging ───────────────────────────────────────────────────────── */}
      <CollapsibleSection
        id="logging"
        title="Logging"
        info="Access log format and destination. Define named log_format entries (e.g. 'main') then reference them from access_log. Set access_log to 'off' to disable globally; individual locations can override. $request_time and $upstream_response_time are especially useful for latency debugging."
        open={openSections.has('logging')}
        onToggle={() => toggleSection('logging')}
      >
        <div className="hs-field">
          <label>access_log</label>
          <div className="hs-inline-row">
            <input
              type="text"
              value={accessLogPath}
              onChange={(e) => {
                const path = e.target.value
                const args = path ? (accessLogFmt ? [path, accessLogFmt] : [path]) : []
                setDir('access_log', args)
              }}
              readOnly={readOnly}
              placeholder="/var/log/nginx/access.log"
              className="hs-input-grow"
            />
            <input
              type="text"
              value={accessLogFmt}
              onChange={(e) => {
                const fmt = e.target.value
                const args = accessLogPath ? (fmt ? [accessLogPath, fmt] : [accessLogPath]) : []
                setDir('access_log', args)
              }}
              readOnly={readOnly}
              placeholder="format name (optional)"
              className="hs-input-shrink"
            />
          </div>
        </div>
        <div className="hs-field">
          <div className="hs-list-header">
            <label>log_format</label>
            {!readOnly && (
              <button
                type="button"
                className="hs-btn-add"
                onClick={() =>
                  setMulti('log_format', [
                    ...logFormats.map((d) => ({ args: d.args ?? [] })),
                    { args: ['custom', "'$remote_addr - $remote_user [$time_local] \"$request\" $status $body_bytes_sent'"] },
                  ])
                }
              >
                + Add format
              </button>
            )}
          </div>
          {logFormats.length === 0 ? (
            <p className="hs-empty">No custom log formats.</p>
          ) : (
            <div className="hs-list">
              {logFormats.map((fmt, i) => (
                <div key={fmt.id ?? i} className="hs-log-fmt-row">
                  <input
                    type="text"
                    value={fmt.args?.[0] ?? ''}
                    onChange={(e) => {
                      const items = logFormats.map((d, j) =>
                        j === i ? { args: [e.target.value, ...(d.args?.slice(1) ?? [])] } : { args: d.args ?? [] }
                      )
                      setMulti('log_format', items)
                    }}
                    readOnly={readOnly}
                    placeholder="name"
                    className="hs-input-name"
                  />
                  <div className="hs-log-fmt-builder">
                    <LogFormatBuilder
                      value={(fmt.args?.slice(1) ?? []).join(' ')}
                      onChange={(v) => {
                        const items = logFormats.map((d, j) =>
                          j === i ? { args: [d.args?.[0] ?? 'custom', v] } : { args: d.args ?? [] }
                        )
                        setMulti('log_format', items)
                      }}
                      readOnly={readOnly}
                    />
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      className="hs-btn-remove hs-log-fmt-del"
                      onClick={() =>
                        setMulti('log_format', logFormats.filter((_, j) => j !== i).map((d) => ({ args: d.args ?? [] })))
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* ── Real IP ───────────────────────────────────────────────────────── */}
      <CollapsibleSection
        id="realip"
        title="Real IP"
        info="When nginx sits behind another proxy/load balancer, use this to recover the original client IP. set_real_ip_from lists trusted upstream IPs/CIDRs, real_ip_header names the header to trust (usually X-Forwarded-For), real_ip_recursive on chooses the last non-trusted IP in a chain."
        open={openSections.has('realip')}
        onToggle={() => toggleSection('realip')}
      >
        <div className="hs-row">
          <div className="hs-field">
            <label>real_ip_header</label>
            <input
              type="text"
              list="hs-real-ip-headers"
              value={realIpHeader}
              onChange={(e) => setDir('real_ip_header', e.target.value ? [e.target.value] : [])}
              readOnly={readOnly}
              placeholder="X-Forwarded-For"
            />
            <datalist id="hs-real-ip-headers">
              {REAL_IP_HEADERS.map((h) => <option key={h} value={h} />)}
            </datalist>
          </div>
          <ToggleField label="real_ip_recursive" value={realIpRecursive} onChange={(v) => setToggle('real_ip_recursive', v)} readOnly={readOnly} />
        </div>
        <div className="hs-field">
          <div className="hs-list-header">
            <label>set_real_ip_from</label>
            {!readOnly && (
              <div className="hs-add-row">
                <input
                  type="text"
                  value={newRealIpEntry}
                  onChange={(e) => setNewRealIpEntry(e.target.value)}
                  placeholder="10.0.0.0/8"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newRealIpEntry.trim()) {
                      setMulti('set_real_ip_from', [...realIpSources, newRealIpEntry.trim()].map((ip) => ({ args: [ip] })))
                      setNewRealIpEntry('')
                    }
                  }}
                />
                <button
                  type="button"
                  className="hs-btn-add"
                  onClick={() => {
                    if (!newRealIpEntry.trim()) return
                    setMulti('set_real_ip_from', [...realIpSources, newRealIpEntry.trim()].map((ip) => ({ args: [ip] })))
                    setNewRealIpEntry('')
                  }}
                >
                  + Add
                </button>
              </div>
            )}
          </div>
          <div className="hs-tags">
            {realIpSources.map((ip, i) => (
              <span key={i} className="hs-tag">
                {ip}
                {!readOnly && (
                  <button
                    type="button"
                    className="hs-tag-remove"
                    onClick={() =>
                      setMulti('set_real_ip_from', realIpSources.filter((_, j) => j !== i).map((x) => ({ args: [x] })))
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {realIpSources.length === 0 && <span className="hs-empty">No trusted proxy IPs configured.</span>}
          </div>
        </div>
      </CollapsibleSection>

      {/* ── Maps ──────────────────────────────────────────────────────────── */}
      <CollapsibleSection
        id="maps"
        title="Maps"
        info="`map $source $result { pattern value; ... }` builds lookup tables from a variable to another variable. Evaluated lazily — cheaper than if/set chains. Common use: connection upgrade for WebSockets, or routing based on Host header."
        open={openSections.has('maps')}
        onToggle={() => toggleSection('maps')}
      >
        {mapBlocksData.length === 0 && <p className="hs-empty">No map blocks defined.</p>}
        {mapBlocksData.map((m, mi) => (
          <div key={m.id ?? mi} className="hs-map-card">
            <div className="hs-map-header">
              <div className="hs-field hs-input-grow">
                <label>source variable</label>
                <input
                  type="text"
                  value={m.sourceVar}
                  placeholder="$variable"
                  readOnly={readOnly}
                  onChange={(e) => {
                    const next = mapBlocksData.map((x, j) => j === mi ? { ...x, sourceVar: e.target.value } : x)
                    updateMapBlocks(next)
                  }}
                />
              </div>
              <div className="hs-field hs-input-grow">
                <label>result variable</label>
                <input
                  type="text"
                  value={m.resultVar}
                  placeholder="$result"
                  readOnly={readOnly}
                  onChange={(e) => {
                    const next = mapBlocksData.map((x, j) => j === mi ? { ...x, resultVar: e.target.value } : x)
                    updateMapBlocks(next)
                  }}
                />
              </div>
              {!readOnly && (
                <button
                  type="button"
                  className="hs-btn-remove"
                  title="Remove map"
                  onClick={() => updateMapBlocks(mapBlocksData.filter((_, j) => j !== mi))}
                >
                  ×
                </button>
              )}
            </div>
            <div className="hs-toggle-grid">
              <ToggleField
                label="hostnames"
                value={m.hostnames}
                onChange={(v) => {
                  const next = mapBlocksData.map((x, j) => j === mi ? { ...x, hostnames: v } : x)
                  updateMapBlocks(next)
                }}
                readOnly={readOnly}
              />
              <ToggleField
                label="volatile"
                value={m.volatile}
                onChange={(v) => {
                  const next = mapBlocksData.map((x, j) => j === mi ? { ...x, volatile: v } : x)
                  updateMapBlocks(next)
                }}
                readOnly={readOnly}
              />
            </div>
            <div className="hs-map-entries">
              <div className="hs-list-header">
                <label>entries</label>
              </div>
              {m.entries.length === 0 && <p className="hs-empty">No entries yet.</p>}
              {m.entries.map((entry, ei) => (
                <div key={ei} className="hs-map-entry-row">
                  <input
                    type="text"
                    value={entry.pattern}
                    placeholder="pattern"
                    readOnly={readOnly}
                    className="hs-input-grow"
                    onChange={(e) => {
                      const next = mapBlocksData.map((x, j) =>
                        j === mi
                          ? { ...x, entries: x.entries.map((en, k) => k === ei ? { ...en, pattern: e.target.value } : en) }
                          : x
                      )
                      updateMapBlocks(next)
                    }}
                  />
                  <input
                    type="text"
                    value={entry.value}
                    placeholder="value"
                    readOnly={readOnly}
                    className="hs-input-grow"
                    onChange={(e) => {
                      const next = mapBlocksData.map((x, j) =>
                        j === mi
                          ? { ...x, entries: x.entries.map((en, k) => k === ei ? { ...en, value: e.target.value } : en) }
                          : x
                      )
                      updateMapBlocks(next)
                    }}
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      className="hs-btn-remove"
                      onClick={() => {
                        const next = mapBlocksData.map((x, j) =>
                          j === mi ? { ...x, entries: x.entries.filter((_, k) => k !== ei) } : x
                        )
                        updateMapBlocks(next)
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <button
                  type="button"
                  className="hs-btn-add"
                  onClick={() => {
                    const next = mapBlocksData.map((x, j) =>
                      j === mi ? { ...x, entries: [...x.entries, { pattern: '', value: '' }] } : x
                    )
                    updateMapBlocks(next)
                  }}
                >
                  + Add entry
                </button>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            className="hs-btn-add"
            onClick={() =>
              updateMapBlocks([
                ...mapBlocksData,
                {
                  id: `map-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  sourceVar: '',
                  resultVar: '',
                  hostnames: false,
                  volatile: false,
                  entries: [],
                },
              ])
            }
          >
            + Add map
          </button>
        )}
      </CollapsibleSection>

      {/* ── Rate Limiting ─────────────────────────────────────────────────── */}
      <CollapsibleSection
        id="ratelimit"
        title="Rate Limiting"
        info="Defines shared memory zones for request throttling (`limit_req_zone`) and concurrency caps (`limit_conn_zone`). Zones declared here are then referenced from server/location blocks via limit_req / limit_conn. Key is typically $binary_remote_addr (≈16 KB per 1000 unique clients)."
        open={openSections.has('ratelimit')}
        onToggle={() => toggleSection('ratelimit')}
      >
        {/* limit_req_zone */}
        <div className="hs-field">
          <div className="hs-list-header">
            <label>limit_req_zone <span className="hs-hint">request rate zones</span></label>
          </div>
          {reqZones.length === 0 && <p className="hs-empty">No request rate zones defined.</p>}
          <div className="hs-list">
            {reqZones.map((z, i) => (
              <div key={i} className="hs-zone-row">
                <input
                  type="text"
                  value={z.key}
                  placeholder="$binary_remote_addr"
                  readOnly={readOnly}
                  className="hs-input-name"
                  onChange={(e) => {
                    const next = reqZones.map((r, j) => j === i ? { ...r, key: e.target.value } : r)
                    setMulti('limit_req_zone', next.map((r) => ({ args: buildReqZoneArgs(r) })))
                  }}
                  title="Key (e.g. $binary_remote_addr)"
                />
                <input
                  type="text"
                  value={z.name}
                  placeholder="zone name"
                  readOnly={readOnly}
                  className="hs-input-name"
                  onChange={(e) => {
                    const next = reqZones.map((r, j) => j === i ? { ...r, name: e.target.value } : r)
                    setMulti('limit_req_zone', next.map((r) => ({ args: buildReqZoneArgs(r) })))
                  }}
                  title="Zone name"
                />
                <input
                  type="text"
                  value={z.size}
                  placeholder="10m"
                  readOnly={readOnly}
                  className="hs-input-short"
                  onChange={(e) => {
                    const next = reqZones.map((r, j) => j === i ? { ...r, size: e.target.value } : r)
                    setMulti('limit_req_zone', next.map((r) => ({ args: buildReqZoneArgs(r) })))
                  }}
                  title="Zone size"
                />
                <input
                  type="text"
                  value={z.rate}
                  placeholder="10r/s"
                  readOnly={readOnly}
                  className="hs-input-short"
                  onChange={(e) => {
                    const next = reqZones.map((r, j) => j === i ? { ...r, rate: e.target.value } : r)
                    setMulti('limit_req_zone', next.map((r) => ({ args: buildReqZoneArgs(r) })))
                  }}
                  title="Rate (e.g. 10r/s or 100r/m)"
                />
                {!readOnly && (
                  <button
                    type="button"
                    className="hs-btn-remove"
                    onClick={() => setMulti('limit_req_zone', reqZones.filter((_, j) => j !== i).map((r) => ({ args: buildReqZoneArgs(r) })))}
                  >×</button>
                )}
              </div>
            ))}
          </div>
          {!readOnly && (
            <div className="hs-zone-add-row">
              <input
                type="text"
                value={newReqZone.key}
                placeholder="$binary_remote_addr"
                className="hs-input-name"
                onChange={(e) => setNewReqZone((z) => ({ ...z, key: e.target.value }))}
                title="Key"
              />
              <input
                type="text"
                value={newReqZone.name}
                placeholder="zone name"
                className="hs-input-name"
                onChange={(e) => setNewReqZone((z) => ({ ...z, name: e.target.value }))}
                title="Zone name"
              />
              <input
                type="text"
                value={newReqZone.size}
                placeholder="10m"
                className="hs-input-short"
                onChange={(e) => setNewReqZone((z) => ({ ...z, size: e.target.value }))}
                title="Size"
              />
              <input
                type="text"
                value={newReqZone.rate}
                placeholder="10r/s"
                className="hs-input-short"
                onChange={(e) => setNewReqZone((z) => ({ ...z, rate: e.target.value }))}
                title="Rate"
              />
              <button
                type="button"
                className="hs-btn-add"
                onClick={() => {
                  if (!newReqZone.name.trim()) return
                  setMulti('limit_req_zone', [...reqZones, newReqZone].map((r) => ({ args: buildReqZoneArgs(r) })))
                  setNewReqZone({ key: '$binary_remote_addr', name: '', size: '10m', rate: '10r/s' })
                }}
              >+ Add zone</button>
            </div>
          )}
        </div>

        {/* limit_conn_zone */}
        <div className="hs-field">
          <div className="hs-list-header">
            <label>limit_conn_zone <span className="hs-hint">connection limit zones</span></label>
          </div>
          {connZones.length === 0 && <p className="hs-empty">No connection limit zones defined.</p>}
          <div className="hs-list">
            {connZones.map((z, i) => (
              <div key={i} className="hs-zone-row">
                <input
                  type="text"
                  value={z.key}
                  placeholder="$binary_remote_addr"
                  readOnly={readOnly}
                  className="hs-input-name"
                  onChange={(e) => {
                    const next = connZones.map((r, j) => j === i ? { ...r, key: e.target.value } : r)
                    setMulti('limit_conn_zone', next.map((r) => ({ args: buildConnZoneArgs(r) })))
                  }}
                  title="Key"
                />
                <input
                  type="text"
                  value={z.name}
                  placeholder="zone name"
                  readOnly={readOnly}
                  className="hs-input-name"
                  onChange={(e) => {
                    const next = connZones.map((r, j) => j === i ? { ...r, name: e.target.value } : r)
                    setMulti('limit_conn_zone', next.map((r) => ({ args: buildConnZoneArgs(r) })))
                  }}
                  title="Zone name"
                />
                <input
                  type="text"
                  value={z.size}
                  placeholder="10m"
                  readOnly={readOnly}
                  className="hs-input-short"
                  onChange={(e) => {
                    const next = connZones.map((r, j) => j === i ? { ...r, size: e.target.value } : r)
                    setMulti('limit_conn_zone', next.map((r) => ({ args: buildConnZoneArgs(r) })))
                  }}
                  title="Size"
                />
                {!readOnly && (
                  <button
                    type="button"
                    className="hs-btn-remove"
                    onClick={() => setMulti('limit_conn_zone', connZones.filter((_, j) => j !== i).map((r) => ({ args: buildConnZoneArgs(r) })))}
                  >×</button>
                )}
              </div>
            ))}
          </div>
          {!readOnly && (
            <div className="hs-zone-add-row">
              <input
                type="text"
                value={newConnZone.key}
                placeholder="$binary_remote_addr"
                className="hs-input-name"
                onChange={(e) => setNewConnZone((z) => ({ ...z, key: e.target.value }))}
                title="Key"
              />
              <input
                type="text"
                value={newConnZone.name}
                placeholder="zone name"
                className="hs-input-name"
                onChange={(e) => setNewConnZone((z) => ({ ...z, name: e.target.value }))}
                title="Zone name"
              />
              <input
                type="text"
                value={newConnZone.size}
                placeholder="10m"
                className="hs-input-short"
                onChange={(e) => setNewConnZone((z) => ({ ...z, size: e.target.value }))}
                title="Size"
              />
              <button
                type="button"
                className="hs-btn-add"
                onClick={() => {
                  if (!newConnZone.name.trim()) return
                  setMulti('limit_conn_zone', [...connZones, newConnZone].map((r) => ({ args: buildConnZoneArgs(r) })))
                  setNewConnZone({ key: '$binary_remote_addr', name: '', size: '10m' })
                }}
              >+ Add zone</button>
            </div>
          )}
        </div>

        {/* limit_req_status */}
        <TextField
          label="limit_req_status"
          value={limitReqStatus}
          placeholder="503"
          onChange={(v) => setDir('limit_req_status', v ? [v] : [])}
          readOnly={readOnly}
        />
      </CollapsibleSection>

      {/* ── Cache Zones ───────────────────────────────────────────────────── */}
      <CollapsibleSection
        id="cachezones"
        title="Proxy Cache Zones"
        info="`proxy_cache_path` declares on-disk cache areas and named zones. Locations opt in with `proxy_cache <zone>`. keys_zone sizes the in-memory index (≈8000 keys per MB); max_size caps disk usage; inactive evicts entries not accessed in that window."
        open={openSections.has('cachezones')}
        onToggle={() => toggleSection('cachezones')}
      >
        <div className="hs-field">
          <div className="hs-list-header">
            <label>proxy_cache_path <span className="hs-hint">cache zone definitions</span></label>
          </div>
          {cachePaths.length === 0 && <p className="hs-empty">No cache zones defined.</p>}
          <div className="hs-list">
            {cachePaths.map((z, i) => (
              <div key={i} className="hs-cache-row">
                <div className="hs-cache-row-top">
                  <input
                    type="text"
                    value={z.path}
                    placeholder="/var/cache/nginx"
                    readOnly={readOnly}
                    className="hs-input-grow"
                    onChange={(e) => {
                      const next = cachePaths.map((r, j) => j === i ? { ...r, path: e.target.value } : r)
                      setMulti('proxy_cache_path', next.map((r) => ({ args: buildCachePathArgs(r) })))
                    }}
                    title="Cache path"
                  />
                  <input
                    type="text"
                    value={z.zoneName}
                    placeholder="zone name"
                    readOnly={readOnly}
                    className="hs-input-name"
                    onChange={(e) => {
                      const next = cachePaths.map((r, j) => j === i ? { ...r, zoneName: e.target.value } : r)
                      setMulti('proxy_cache_path', next.map((r) => ({ args: buildCachePathArgs(r) })))
                    }}
                    title="keys_zone name"
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      className="hs-btn-remove"
                      onClick={() => setMulti('proxy_cache_path', cachePaths.filter((_, j) => j !== i).map((r) => ({ args: buildCachePathArgs(r) })))}
                    >×</button>
                  )}
                </div>
                <div className="hs-cache-row-bottom">
                  <input
                    type="text"
                    value={z.zoneSize}
                    placeholder="10m"
                    readOnly={readOnly}
                    className="hs-input-short"
                    onChange={(e) => {
                      const next = cachePaths.map((r, j) => j === i ? { ...r, zoneSize: e.target.value } : r)
                      setMulti('proxy_cache_path', next.map((r) => ({ args: buildCachePathArgs(r) })))
                    }}
                    title="keys_zone size"
                  />
                  <input
                    type="text"
                    value={z.levels}
                    placeholder="1:2"
                    readOnly={readOnly}
                    className="hs-input-short"
                    onChange={(e) => {
                      const next = cachePaths.map((r, j) => j === i ? { ...r, levels: e.target.value } : r)
                      setMulti('proxy_cache_path', next.map((r) => ({ args: buildCachePathArgs(r) })))
                    }}
                    title="levels"
                  />
                  <input
                    type="text"
                    value={z.maxSize}
                    placeholder="max_size (e.g. 1g)"
                    readOnly={readOnly}
                    className="hs-input-name"
                    onChange={(e) => {
                      const next = cachePaths.map((r, j) => j === i ? { ...r, maxSize: e.target.value } : r)
                      setMulti('proxy_cache_path', next.map((r) => ({ args: buildCachePathArgs(r) })))
                    }}
                    title="max_size"
                  />
                  <input
                    type="text"
                    value={z.inactive}
                    placeholder="inactive (e.g. 60m)"
                    readOnly={readOnly}
                    className="hs-input-name"
                    onChange={(e) => {
                      const next = cachePaths.map((r, j) => j === i ? { ...r, inactive: e.target.value } : r)
                      setMulti('proxy_cache_path', next.map((r) => ({ args: buildCachePathArgs(r) })))
                    }}
                    title="inactive"
                  />
                </div>
              </div>
            ))}
          </div>
          {!readOnly && (
            <div className="hs-cache-add">
              <div className="hs-cache-row-top">
                <input
                  type="text"
                  value={newCachePath.path}
                  placeholder="/var/cache/nginx"
                  className="hs-input-grow"
                  onChange={(e) => setNewCachePath((z) => ({ ...z, path: e.target.value }))}
                  title="Cache path"
                />
                <input
                  type="text"
                  value={newCachePath.zoneName}
                  placeholder="zone name"
                  className="hs-input-name"
                  onChange={(e) => setNewCachePath((z) => ({ ...z, zoneName: e.target.value }))}
                  title="keys_zone name"
                />
              </div>
              <div className="hs-cache-row-bottom">
                <input
                  type="text"
                  value={newCachePath.zoneSize}
                  placeholder="10m"
                  className="hs-input-short"
                  onChange={(e) => setNewCachePath((z) => ({ ...z, zoneSize: e.target.value }))}
                  title="keys_zone size"
                />
                <input
                  type="text"
                  value={newCachePath.levels}
                  placeholder="1:2"
                  className="hs-input-short"
                  onChange={(e) => setNewCachePath((z) => ({ ...z, levels: e.target.value }))}
                  title="levels"
                />
                <input
                  type="text"
                  value={newCachePath.maxSize}
                  placeholder="max_size"
                  className="hs-input-name"
                  onChange={(e) => setNewCachePath((z) => ({ ...z, maxSize: e.target.value }))}
                  title="max_size"
                />
                <input
                  type="text"
                  value={newCachePath.inactive}
                  placeholder="inactive"
                  className="hs-input-name"
                  onChange={(e) => setNewCachePath((z) => ({ ...z, inactive: e.target.value }))}
                  title="inactive"
                />
                <button
                  type="button"
                  className="hs-btn-add"
                  onClick={() => {
                    if (!newCachePath.zoneName.trim()) return
                    setMulti('proxy_cache_path', [...cachePaths, newCachePath].map((r) => ({ args: buildCachePathArgs(r) })))
                    setNewCachePath({ path: '/var/cache/nginx', zoneName: '', zoneSize: '10m', levels: '1:2', maxSize: '1g', inactive: '60m' })
                  }}
                >+ Add cache zone</button>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* ── Includes ──────────────────────────────────────────────────────── */}
      <CollapsibleSection
        id="includes"
        title="Includes"
        info="`include` pulls in additional directives from other files using globs (e.g. /etc/nginx/conf.d/*.conf). Use this to split config by concern (sites, snippets, mime types) rather than one monolithic file."
        open={openSections.has('includes')}
        onToggle={() => toggleSection('includes')}
      >
        <div className="hs-field">
          <div className="hs-list-header">
            <label>include</label>
            {!readOnly && (
              <div className="hs-add-row">
                <input
                  type="text"
                  value={newInclude}
                  onChange={(e) => setNewInclude(e.target.value)}
                  placeholder="/etc/nginx/conf.d/*.conf"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newInclude.trim()) {
                      setMulti('include', [...includes, newInclude.trim()].map((p) => ({ args: [p] })))
                      setNewInclude('')
                    }
                  }}
                />
                <button
                  type="button"
                  className="hs-btn-add"
                  onClick={() => {
                    if (!newInclude.trim()) return
                    setMulti('include', [...includes, newInclude.trim()].map((p) => ({ args: [p] })))
                    setNewInclude('')
                  }}
                >
                  + Add
                </button>
              </div>
            )}
          </div>
          <div className="hs-include-list">
            {includes.map((path, i) => (
              <div key={i} className="hs-include-item">
                <div className="hs-include-row">
                  <input
                    type="text"
                    value={path}
                    onChange={(e) => {
                      const next = includes.map((p, j) => (j === i ? e.target.value : p))
                      setMulti('include', next.map((p) => ({ args: [p] })))
                      // Clear resolved when path changes
                      setResolvedIncludes((prev) => { const n = { ...prev }; delete n[i]; return n })
                    }}
                    readOnly={readOnly}
                  />
                  <button
                    type="button"
                    className="hs-btn-resolve"
                    title="Resolve matched files"
                    onClick={async () => {
                      if (resolvedIncludes[i]) {
                        setResolvedIncludes((prev) => { const n = { ...prev }; delete n[i]; return n })
                        return
                      }
                      setResolvingInclude(i)
                      try {
                        const res = await resolveInclude(path)
                        setResolvedIncludes((prev) => ({ ...prev, [i]: res.files ?? [] }))
                      } catch {
                        setResolvedIncludes((prev) => ({ ...prev, [i]: [] }))
                      } finally {
                        setResolvingInclude(null)
                      }
                    }}
                    disabled={resolvingInclude === i}
                  >
                    {resolvingInclude === i ? '…' : resolvedIncludes[i] ? '▲' : '?'}
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      className="hs-btn-remove"
                      onClick={() => setMulti('include', includes.filter((_, j) => j !== i).map((p) => ({ args: [p] })))}
                    >
                      ×
                    </button>
                  )}
                </div>
                {resolvedIncludes[i] !== undefined && (
                  <div className="hs-include-resolved">
                    {resolvedIncludes[i].length === 0
                      ? <span className="hs-include-resolved-empty">No matching files found</span>
                      : resolvedIncludes[i].map((f, j) => (
                          <span key={j} className="hs-include-resolved-file">{f}</span>
                        ))
                    }
                  </div>
                )}
              </div>
            ))}
            {includes.length === 0 && <span className="hs-empty">No include directives in http block.</span>}
          </div>
        </div>
      </CollapsibleSection>

      {/* ── F5.3 Geo / GeoIP ──────────────────────────────────────────────── */}
      <CollapsibleSection
        id="geo"
        title="Geo / GeoIP"
        info="`geo { }` maps IP/CIDR ranges to variables (pure config, no external data). `geoip2 { }` (ngx_http_geoip2_module) maps IPs to country/city using a MaxMind DB. Use the resulting variables in access rules, log formats, or routing maps."
        open={openSections.has('geo')}
        onToggle={() => toggleSection('geo')}
      >
        <div className="hs-map-list">
          <h4 className="hs-sub-heading">geo &#123;&#125; blocks</h4>
          {geoBlocksData.map((geo, gi) => (
            <div key={geo.id ?? gi} className="hs-map-card">
              <div className="hs-map-header">
                <div className="hs-map-vars">
                  <input
                    type="text"
                    className="hs-map-var"
                    placeholder="$source (optional)"
                    value={geo.sourceVar}
                    onChange={(e) => {
                      const next = geoBlocksData.map((g, j) => j === gi ? { ...g, sourceVar: e.target.value } : g)
                      updateGeoBlocks(next)
                    }}
                    readOnly={readOnly}
                  />
                  <span className="hs-map-arrow">→</span>
                  <input
                    type="text"
                    className="hs-map-var"
                    placeholder="$result"
                    value={geo.resultVar}
                    onChange={(e) => {
                      const next = geoBlocksData.map((g, j) => j === gi ? { ...g, resultVar: e.target.value } : g)
                      updateGeoBlocks(next)
                    }}
                    readOnly={readOnly}
                  />
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="hs-btn-remove"
                    onClick={() => updateGeoBlocks(geoBlocksData.filter((_, j) => j !== gi))}
                  >×</button>
                )}
              </div>
              <div className="hs-map-flags">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={geo.ranges}
                    onChange={(e) => {
                      const next = geoBlocksData.map((g, j) => j === gi ? { ...g, ranges: e.target.checked } : g)
                      updateGeoBlocks(next)
                    }}
                    disabled={readOnly}
                  />
                  ranges
                </label>
                <span className="hs-map-label">default</span>
                <input
                  type="text"
                  className="hs-map-default"
                  placeholder="0"
                  value={geo.defaultVal}
                  onChange={(e) => {
                    const next = geoBlocksData.map((g, j) => j === gi ? { ...g, defaultVal: e.target.value } : g)
                    updateGeoBlocks(next)
                  }}
                  readOnly={readOnly}
                />
              </div>
              <div className="hs-map-entries">
                {geo.entries.map((entry, ei) => (
                  <div key={ei} className="hs-map-entry">
                    <input
                      type="text"
                      placeholder="CIDR or IP"
                      value={entry.cidr}
                      onChange={(e) => {
                        const next = geoBlocksData.map((g, j) => j === gi ? {
                          ...g,
                          entries: g.entries.map((en, k) => k === ei ? { ...en, cidr: e.target.value } : en)
                        } : g)
                        updateGeoBlocks(next)
                      }}
                      readOnly={readOnly}
                    />
                    <input
                      type="text"
                      placeholder="value"
                      value={entry.value}
                      onChange={(e) => {
                        const next = geoBlocksData.map((g, j) => j === gi ? {
                          ...g,
                          entries: g.entries.map((en, k) => k === ei ? { ...en, value: e.target.value } : en)
                        } : g)
                        updateGeoBlocks(next)
                      }}
                      readOnly={readOnly}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        className="hs-btn-remove"
                        onClick={() => {
                          const next = geoBlocksData.map((g, j) => j === gi ? {
                            ...g, entries: g.entries.filter((_, k) => k !== ei)
                          } : g)
                          updateGeoBlocks(next)
                        }}
                      >×</button>
                    )}
                  </div>
                ))}
                {!readOnly && (
                  <button
                    type="button"
                    className="hs-btn-add-entry"
                    onClick={() => {
                      const next = geoBlocksData.map((g, j) => j === gi ? {
                        ...g, entries: [...g.entries, { cidr: '', value: '' }]
                      } : g)
                      updateGeoBlocks(next)
                    }}
                  >+ Add entry</button>
                )}
              </div>
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              className="hs-btn-add-map"
              onClick={() => updateGeoBlocks([
                ...geoBlocksData,
                { sourceVar: '', resultVar: '$geo_var', ranges: false, defaultVal: '0', entries: [] },
              ])}
            >+ Add geo block</button>
          )}
        </div>

        <div className="hs-map-list">
          <h4 className="hs-sub-heading">geoip2 &#123;&#125; blocks</h4>
          {geoip2BlocksData.map((g2, gi) => (
            <div key={g2.id ?? gi} className="hs-map-card">
              <div className="hs-map-header">
                <input
                  type="text"
                  className="hs-geoip2-db"
                  placeholder="/usr/share/GeoIP/GeoLite2-Country.mmdb"
                  value={g2.dbPath}
                  onChange={(e) => {
                    const next = geoip2BlocksData.map((g, j) => j === gi ? { ...g, dbPath: e.target.value } : g)
                    updateGeoIP2Blocks(next)
                  }}
                  readOnly={readOnly}
                />
                {!readOnly && (
                  <button
                    type="button"
                    className="hs-btn-remove"
                    onClick={() => updateGeoIP2Blocks(geoip2BlocksData.filter((_, j) => j !== gi))}
                  >×</button>
                )}
              </div>
              <div className="hs-map-entries">
                {g2.bindings.map((b, bi) => (
                  <div key={bi} className="hs-map-entry">
                    <input
                      type="text"
                      placeholder="$variable"
                      value={b.variable}
                      onChange={(e) => {
                        const next = geoip2BlocksData.map((g, j) => j === gi ? {
                          ...g, bindings: g.bindings.map((bn, k) => k === bi ? { ...bn, variable: e.target.value } : bn)
                        } : g)
                        updateGeoIP2Blocks(next)
                      }}
                      readOnly={readOnly}
                    />
                    <input
                      type="text"
                      placeholder="default=XX country iso_code"
                      value={b.args}
                      onChange={(e) => {
                        const next = geoip2BlocksData.map((g, j) => j === gi ? {
                          ...g, bindings: g.bindings.map((bn, k) => k === bi ? { ...bn, args: e.target.value } : bn)
                        } : g)
                        updateGeoIP2Blocks(next)
                      }}
                      readOnly={readOnly}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        className="hs-btn-remove"
                        onClick={() => {
                          const next = geoip2BlocksData.map((g, j) => j === gi ? {
                            ...g, bindings: g.bindings.filter((_, k) => k !== bi)
                          } : g)
                          updateGeoIP2Blocks(next)
                        }}
                      >×</button>
                    )}
                  </div>
                ))}
                {!readOnly && (
                  <button
                    type="button"
                    className="hs-btn-add-entry"
                    onClick={() => {
                      const next = geoip2BlocksData.map((g, j) => j === gi ? {
                        ...g, bindings: [...g.bindings, { variable: '', args: '' }]
                      } : g)
                      updateGeoIP2Blocks(next)
                    }}
                  >+ Add binding</button>
                )}
              </div>
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              className="hs-btn-add-map"
              onClick={() => updateGeoIP2Blocks([
                ...geoip2BlocksData,
                { dbPath: '/usr/share/GeoIP/GeoLite2-Country.mmdb', bindings: [] },
              ])}
            >+ Add geoip2 block</button>
          )}
        </div>
      </CollapsibleSection>
    </div>
  )
}

// ─── Reusable sub-components ─────────────────────────────────────────────────

function CollapsibleSection({
  id, title, info, open, onToggle, children,
}: {
  id: SectionId
  title: string
  info?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="hs-section" data-id={id}>
      <div className="hs-section-header">
        <button type="button" className="hs-section-btn" onClick={onToggle}>
          <span className={`hs-chevron ${open ? 'open' : ''}`}>▶</span>
          {title}
        </button>
        {info && <InfoIcon text={info} />}
      </div>
      {open && <div className="hs-section-body">{children}</div>}
    </section>
  )
}

function ToggleField({
  label, hint, value, onChange, readOnly,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
  readOnly?: boolean
}) {
  return (
    <div className="hs-toggle-field">
      <label className="hs-toggle-label">
        <span className="hs-toggle-wrap">
          <input
            type="checkbox"
            className="hs-toggle-input"
            checked={value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={readOnly}
          />
          <span className="hs-toggle-track" />
        </span>
        <span className="hs-toggle-name">{label}</span>
        {hint && <span className="hs-hint">{hint}</span>}
      </label>
    </div>
  )
}

function TextField({
  label, value, placeholder, onChange, readOnly,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
  readOnly?: boolean
}) {
  return (
    <div className="hs-field">
      <label>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={placeholder}
      />
    </div>
  )
}
