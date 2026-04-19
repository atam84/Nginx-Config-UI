import { useEffect, useMemo, useState } from 'react'
import {
  fetchPublishedEndpoints,
  fetchOutboundDependencies,
  type PublishedEndpoint,
  type OutboundDependency,
  type TopologyEndpointsResponse,
  type TopologyOutboundResponse,
} from './api'
import InfoIcon from './InfoIcon'
import './IngressEgressTab.css'

type ViewId = 'endpoints' | 'outbound'

// Per-column filter state for the Published Endpoints table. All string
// fields are case-insensitive substring matches. `protocol` is an
// enumeration; '' means "any".
interface EndpointColFilters {
  server_name: string
  listen: string
  protocol: '' | 'ssl' | 'plain' | 'h2' | 'h3'
  path: string
  backend: string
  source: string
}
const EMPTY_EP_FILTERS: EndpointColFilters = {
  server_name: '', listen: '', protocol: '', path: '', backend: '', source: '',
}

// Per-column filter state for the Outbound Dependencies tables. Both the
// Upstream and Direct tables share one state object — columns that only
// exist in one table (e.g. type/resolver) are simply ignored by the other.
interface OutboundColFilters {
  kind: '' | 'proxy' | 'fastcgi' | 'grpc' | 'uwsgi'
  target: string
  host: string
  type: '' | 'upstream' | 'host' | 'ip' | 'unix' | 'variable'
  resolver: '' | 'missing' | 'ok' | 'na'
  used_by: string
  source: string
}
const EMPTY_OB_FILTERS: OutboundColFilters = {
  kind: '', target: '', host: '', type: '', resolver: '', used_by: '', source: '',
}

const containsCI = (haystack: string, needle: string) =>
  !needle || haystack.toLowerCase().includes(needle.toLowerCase())

export default function IngressEgressTab() {
  const [view, setView] = useState<ViewId>('endpoints')
  const [endpoints, setEndpoints] = useState<TopologyEndpointsResponse | null>(null)
  const [outbound, setOutbound] = useState<TopologyOutboundResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [tlsOnly, setTlsOnly] = useState(false)
  const [warningOnly, setWarningOnly] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const [epFilters, setEpFilters] = useState<EndpointColFilters>(EMPTY_EP_FILTERS)
  const [obFilters, setObFilters] = useState<OutboundColFilters>(EMPTY_OB_FILTERS)
  const anyEpColFilter = Object.values(epFilters).some((v) => v !== '')
  const anyObColFilter = Object.values(obFilters).some((v) => v !== '')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    Promise.all([fetchPublishedEndpoints(), fetchOutboundDependencies()])
      .then(([ep, ob]) => {
        if (!active) return
        setEndpoints(ep)
        setOutbound(ob)
      })
      .catch((e: Error) => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [refreshCount])

  const refresh = () => setRefreshCount((n) => n + 1)

  // ── Published Endpoints filtering ─────────────────────────────────────────
  // Filters compose AND-wise: the global `filter` (quick free-form search
  // across all rendered columns), the TLS-only toggle, and each per-column
  // filter all must match for a row to survive.
  const filteredEndpoints = useMemo(() => {
    if (!endpoints) return []
    const q = filter.trim().toLowerCase()
    let rows = endpoints.endpoints
    if (q) {
      rows = rows.filter((e) =>
        e.server_name.toLowerCase().includes(q) ||
        (e.all_names ?? []).some((n) => n.toLowerCase().includes(q)) ||
        e.path.toLowerCase().includes(q) ||
        e.backend.toLowerCase().includes(q) ||
        e.file_path.toLowerCase().includes(q)
      )
    }
    if (tlsOnly) rows = rows.filter((e) => e.ssl)
    if (anyEpColFilter) {
      rows = rows.filter((e) => {
        const names = e.all_names ?? []
        const listen = `${e.address ? e.address + ':' : ''}${e.port}`
        const backendCell = `${e.backend_kind} ${e.backend} ${e.return_code ?? ''}`
        const src = `${e.file_path}:${e.line_number ?? ''}`
        if (epFilters.server_name) {
          const hit = containsCI(e.server_name, epFilters.server_name)
            || names.some((n) => containsCI(n, epFilters.server_name))
          if (!hit) return false
        }
        if (!containsCI(listen, epFilters.listen)) return false
        if (!containsCI(e.path, epFilters.path)) return false
        if (!containsCI(backendCell, epFilters.backend)) return false
        if (!containsCI(src, epFilters.source)) return false
        if (epFilters.protocol) {
          const isPlain = !e.ssl && !e.http2 && !e.http3
          if (epFilters.protocol === 'ssl'   && !e.ssl)   return false
          if (epFilters.protocol === 'h2'    && !e.http2) return false
          if (epFilters.protocol === 'h3'    && !e.http3) return false
          if (epFilters.protocol === 'plain' && !isPlain) return false
        }
        return true
      })
    }
    return rows
  }, [endpoints, filter, tlsOnly, epFilters, anyEpColFilter])

  // ── Outbound Dependencies filtering ──────────────────────────────────────
  const filteredOutbound = useMemo(() => {
    if (!outbound) return []
    const q = filter.trim().toLowerCase()
    let rows = outbound.outbound
    if (q) {
      rows = rows.filter((d) =>
        d.target.toLowerCase().includes(q) ||
        d.host.toLowerCase().includes(q) ||
        (d.upstream_name ?? '').toLowerCase().includes(q) ||
        d.server_name.toLowerCase().includes(q) ||
        d.path.toLowerCase().includes(q) ||
        d.file_path.toLowerCase().includes(q)
      )
    }
    if (warningOnly) rows = rows.filter((d) => d.resolver_missing)
    if (anyObColFilter) {
      rows = rows.filter((d) => {
        const usedBy = `${d.server_name} ${d.path}`
        const src = `${d.file_path}:${d.line_number ?? ''}`
        // Target column is the full target string for direct, the upstream
        // name for upstream rows — search both.
        const targetCell = `${d.target} ${d.upstream_name ?? ''}`
        const hostPort = `${d.host} ${d.port}`
        if (obFilters.kind && d.kind !== obFilters.kind) return false
        if (!containsCI(targetCell, obFilters.target)) return false
        if (!containsCI(hostPort, obFilters.host)) return false
        if (obFilters.type && d.target_kind !== obFilters.type) return false
        if (obFilters.resolver) {
          if (obFilters.resolver === 'missing' && !d.resolver_missing) return false
          if (obFilters.resolver === 'ok'      && (!d.uses_dns || d.resolver_missing)) return false
          if (obFilters.resolver === 'na'      && d.uses_dns) return false
        }
        if (!containsCI(usedBy, obFilters.used_by)) return false
        if (!containsCI(src, obFilters.source)) return false
        return true
      })
    }
    return rows
  }, [outbound, filter, warningOnly, obFilters, anyObColFilter])

  // ── CSV / JSON export ─────────────────────────────────────────────────────
  const downloadFile = (name: string, body: string, mime: string) => {
    const blob = new Blob([body], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const csvEscape = (s: string) => {
    if (s === '' || s == null) return ''
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }

  const exportEndpointsCsv = () => {
    const header = ['server_name', 'all_names', 'address', 'port', 'path', 'ssl', 'http2', 'http3', 'backend_kind', 'backend', 'return_code', 'enabled', 'file_path', 'line_number']
    const lines = [header.join(',')]
    for (const e of filteredEndpoints) {
      lines.push([
        csvEscape(e.server_name),
        csvEscape(e.all_names.join(' ')),
        csvEscape(e.address),
        csvEscape(e.port),
        csvEscape(e.path),
        e.ssl ? '1' : '0',
        e.http2 ? '1' : '0',
        e.http3 ? '1' : '0',
        csvEscape(e.backend_kind),
        csvEscape(e.backend),
        csvEscape(e.return_code ?? ''),
        e.enabled ? '1' : '0',
        csvEscape(e.file_path),
        String(e.line_number ?? ''),
      ].join(','))
    }
    downloadFile('published-endpoints.csv', lines.join('\n'), 'text/csv;charset=utf-8')
  }

  const exportEndpointsJson = () => {
    downloadFile(
      'published-endpoints.json',
      JSON.stringify({ endpoints: filteredEndpoints, warnings: endpoints?.warnings ?? [] }, null, 2),
      'application/json',
    )
  }

  const exportOutboundCsv = () => {
    const header = ['kind', 'target', 'target_kind', 'host', 'port', 'upstream_name', 'uses_dns', 'uses_tls', 'resolver_in_scope', 'resolver_missing', 'server_name', 'path', 'file_path', 'line_number']
    const lines = [header.join(',')]
    for (const d of filteredOutbound) {
      lines.push([
        csvEscape(d.kind),
        csvEscape(d.target),
        csvEscape(d.target_kind),
        csvEscape(d.host),
        csvEscape(d.port),
        csvEscape(d.upstream_name ?? ''),
        d.uses_dns ? '1' : '0',
        d.uses_tls ? '1' : '0',
        d.resolver_in_scope ? '1' : '0',
        d.resolver_missing ? '1' : '0',
        csvEscape(d.server_name),
        csvEscape(d.path),
        csvEscape(d.file_path),
        String(d.line_number ?? ''),
      ].join(','))
    }
    downloadFile('outbound-dependencies.csv', lines.join('\n'), 'text/csv;charset=utf-8')
  }

  const exportOutboundJson = () => {
    downloadFile(
      'outbound-dependencies.json',
      JSON.stringify({
        outbound: filteredOutbound,
        upstreams: outbound?.upstreams ?? {},
        warnings: outbound?.warnings ?? [],
      }, null, 2),
      'application/json',
    )
  }

  // ── Counts / summaries ────────────────────────────────────────────────────
  const resolverMissingCount = outbound?.outbound.filter((d) => d.resolver_missing).length ?? 0

  return (
    <div className="ing-tab">
      <div className="ing-header">
        <div className="ing-view-switch">
          <button
            type="button"
            className={view === 'endpoints' ? 'active' : ''}
            onClick={() => setView('endpoints')}
          >
            Published Endpoints
            <span className="ing-count">{endpoints?.endpoints.length ?? 0}</span>
          </button>
          <button
            type="button"
            className={view === 'outbound' ? 'active' : ''}
            onClick={() => setView('outbound')}
          >
            Outbound Dependencies
            <span className="ing-count">{outbound?.outbound.length ?? 0}</span>
            {resolverMissingCount > 0 && (
              <span className="ing-warn-badge" title={`${resolverMissingCount} DNS-based target(s) without a resolver directive in scope`}>
                ⚠ {resolverMissingCount}
              </span>
            )}
          </button>
        </div>
        <div className="ing-actions">
          <input
            type="text"
            className="ing-filter-input"
            placeholder="Filter… (server_name, path, backend, file)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {view === 'endpoints' ? (
            <label className="ing-toggle" title="Show only HTTPS / SSL-terminated endpoints">
              <input type="checkbox" checked={tlsOnly} onChange={(e) => setTlsOnly(e.target.checked)} />
              TLS only
            </label>
          ) : (
            <label className="ing-toggle" title="Show only rows with missing resolver (DNS-based proxy_pass with no resolver in scope)">
              <input type="checkbox" checked={warningOnly} onChange={(e) => setWarningOnly(e.target.checked)} />
              Warnings only
            </label>
          )}
          {(view === 'endpoints' ? anyEpColFilter : anyObColFilter) && (
            <button
              type="button"
              className="ing-btn"
              onClick={() => {
                if (view === 'endpoints') setEpFilters(EMPTY_EP_FILTERS)
                else setObFilters(EMPTY_OB_FILTERS)
              }}
              title="Clear the per-column filters in the table header below"
            >
              ✕ Clear column filters
            </button>
          )}
          <button type="button" className="ing-btn" onClick={refresh} title="Re-scan all config files and rebuild the aggregation">
            ↻ Refresh
          </button>
          {view === 'endpoints' ? (
            <>
              <button type="button" className="ing-btn ing-btn-export" onClick={exportEndpointsCsv} title="Download the filtered Published Endpoints table as CSV">
                Export CSV
              </button>
              <button type="button" className="ing-btn ing-btn-export" onClick={exportEndpointsJson} title="Download the filtered Published Endpoints table as JSON">
                Export JSON
              </button>
            </>
          ) : (
            <>
              <button type="button" className="ing-btn ing-btn-export" onClick={exportOutboundCsv} title="Download the filtered Outbound Dependencies table as CSV">
                Export CSV
              </button>
              <button type="button" className="ing-btn ing-btn-export" onClick={exportOutboundJson} title="Download the filtered Outbound Dependencies + upstreams map as JSON">
                Export JSON
              </button>
            </>
          )}
        </div>
      </div>

      {loading && <div className="ing-status">Loading topology…</div>}
      {error && <div className="ing-status ing-error">Error: {error}</div>}

      {!loading && view === 'endpoints' && endpoints && (
        <EndpointsView
          rows={filteredEndpoints}
          warnings={endpoints.warnings}
          total={endpoints.endpoints.length}
          filters={epFilters}
          setFilters={setEpFilters}
        />
      )}
      {!loading && view === 'outbound' && outbound && (
        <OutboundView
          rows={filteredOutbound}
          upstreams={outbound.upstreams}
          warnings={outbound.warnings}
          total={outbound.outbound.length}
          filters={obFilters}
          setFilters={setObFilters}
        />
      )}
    </div>
  )
}

// ── Published Endpoints table ───────────────────────────────────────────────
function EndpointsView({ rows, warnings, total, filters, setFilters }: {
  rows: PublishedEndpoint[]
  warnings: string[]
  total: number
  filters: EndpointColFilters
  setFilters: React.Dispatch<React.SetStateAction<EndpointColFilters>>
}) {
  const update = <K extends keyof EndpointColFilters>(k: K, v: EndpointColFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }))
  return (
    <>
      <div className="ing-banner">
        <InfoIcon text="Every externally-reachable URL derived from your nginx configs: one row per (server block × listen × location). Aggregated across nginx.conf, conf.d/*.conf, and sites-enabled/*. Disabled servers/locations show with reduced opacity. This is the 'what is exposed from the outside world' view — auditors and DNS/LB teams care about this list." />
        <span>
          Aggregated from all config files — <strong>{rows.length}</strong>
          {rows.length !== total && <> of <strong>{total}</strong></>} endpoint{rows.length === 1 ? '' : 's'}.
        </span>
      </div>
      {warnings.length > 0 && (
        <div className="ing-parse-warnings">
          <strong>Parse warnings ({warnings.length}):</strong>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <div className="ing-table-wrap">
        <table className="ing-table">
          <thead>
            <tr>
              <th>
                Server Name
                <InfoIcon text="Primary server_name (first token). Hover a row's server-name cell to see all aliases/wildcards/regex hosts registered on this server block." />
              </th>
              <th>
                Listen
                <InfoIcon text="Bind address + port from the `listen` directive. Empty address means all interfaces. A server block with multiple `listen` rows produces one endpoint per listen." />
              </th>
              <th>
                Protocol
                <InfoIcon text="SSL = `listen ... ssl` is present; H2 = http2 enabled (listen flag or `http2 on;`); H3 = HTTP/3 enabled (listen `quic` + `http3 on;`). Required by auditors to verify modern TLS adoption." />
              </th>
              <th>
                Path
                <InfoIcon text="Location path + modifier (e.g. `/`, `= /nginx_status`, `~* \\.php$`)." />
              </th>
              <th>
                Backend
                <InfoIcon text="What this location does: proxy / fastcgi / grpc / uwsgi target, `return CODE URL`, or a static `root`/`alias`. Empty means no terminating directive was found (request would match but fall through to nginx defaults)." />
              </th>
              <th>
                Source
                <InfoIcon text="Source file path relative to the config root, plus the line number of the `server` block." />
              </th>
            </tr>
            <tr className="ing-filter-row">
              <th>
                <input type="text" value={filters.server_name} placeholder="filter…" title="Substring match on primary server_name or any alias" onChange={(e) => update('server_name', e.target.value)} />
              </th>
              <th>
                <input type="text" value={filters.listen} placeholder="filter… (e.g. 443 or 10.0.0.1:)" title="Substring match on address:port from the listen directive" onChange={(e) => update('listen', e.target.value)} />
              </th>
              <th>
                <select value={filters.protocol} title="Filter by protocol flags on the listen" onChange={(e) => update('protocol', e.target.value as EndpointColFilters['protocol'])}>
                  <option value="">any</option>
                  <option value="ssl">SSL only</option>
                  <option value="plain">plain HTTP</option>
                  <option value="h2">HTTP/2</option>
                  <option value="h3">HTTP/3</option>
                </select>
              </th>
              <th>
                <input type="text" value={filters.path} placeholder="filter…" title="Substring match on the location path + modifier" onChange={(e) => update('path', e.target.value)} />
              </th>
              <th>
                <input type="text" value={filters.backend} placeholder="filter… (e.g. proxy, api_backend, 301)" title="Matches backend kind, target, or return code" onChange={(e) => update('backend', e.target.value)} />
              </th>
              <th>
                <input type="text" value={filters.source} placeholder="filter… (file.conf or :42)" title="Substring match on file path:line" onChange={(e) => update('source', e.target.value)} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="ing-empty-row">No endpoints match the current filter.</td></tr>
            ) : rows.map((e, i) => {
              const names = e.all_names ?? []
              return (
              <tr key={i} className={e.enabled ? '' : 'ing-row-disabled'}>
                <td title={names.join(', ')}>
                  <span className="ing-server-name">{e.server_name || <em>(unnamed)</em>}</span>
                  {names.length > 1 && <span className="ing-name-more"> +{names.length - 1}</span>}
                </td>
                <td>
                  <code>{e.address ? e.address + ':' : ''}{e.port || '?'}</code>
                </td>
                <td className="ing-protocol-cell">
                  {e.ssl && <span className="ing-chip ing-chip-tls" title="TLS/SSL termination enabled on this listen">SSL</span>}
                  {e.http2 && <span className="ing-chip ing-chip-h2" title="HTTP/2 enabled (requires SSL in practice)">H2</span>}
                  {e.http3 && <span className="ing-chip ing-chip-h3" title="HTTP/3 / QUIC enabled">H3</span>}
                  {!e.ssl && !e.http2 && !e.http3 && <span className="ing-chip ing-chip-plain" title="Plain HTTP/1.x — no TLS">HTTP</span>}
                </td>
                <td><code>{e.path}</code></td>
                <td>
                  {e.backend_kind === 'proxy' && <span className="ing-chip ing-chip-proxy" title="proxy_pass">proxy</span>}
                  {e.backend_kind === 'fastcgi' && <span className="ing-chip ing-chip-fastcgi" title="fastcgi_pass (PHP etc.)">fastcgi</span>}
                  {e.backend_kind === 'grpc' && <span className="ing-chip ing-chip-grpc" title="grpc_pass">grpc</span>}
                  {e.backend_kind === 'uwsgi' && <span className="ing-chip ing-chip-uwsgi" title="uwsgi_pass (Python etc.)">uwsgi</span>}
                  {e.backend_kind === 'return' && <span className="ing-chip ing-chip-return" title={`return ${e.return_code ?? ''}`}>return {e.return_code ?? ''}</span>}
                  {e.backend_kind === 'static' && <span className="ing-chip ing-chip-static" title="root/alias — served from local filesystem">static</span>}
                  {e.backend_kind === '' && <span className="ing-chip ing-chip-none" title="No terminating directive — falls through to nginx defaults">none</span>}
                  {e.backend && <code className="ing-backend-target">{e.backend}</code>}
                </td>
                <td>
                  <code className="ing-source">{e.file_path}:{e.line_number || '?'}</code>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Outbound Dependencies table ─────────────────────────────────────────────
function OutboundView({ rows, upstreams, warnings, total, filters, setFilters }: {
  rows: OutboundDependency[]
  upstreams: Record<string, string[]>
  warnings: string[]
  total: number
  filters: OutboundColFilters
  setFilters: React.Dispatch<React.SetStateAction<OutboundColFilters>>
}) {
  const update = <K extends keyof OutboundColFilters>(k: K, v: OutboundColFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }))
  // Group by upstream vs direct so operators can tell "real pool" from "direct host".
  const upstreamRows = rows.filter((r) => r.target_kind === 'upstream')
  const directRows = rows.filter((r) => r.target_kind !== 'upstream')
  // Shared Kind dropdown used in both table headers (tiny helper to avoid
  // repeating four option rows twice).
  const kindSelect = (
    <select
      value={filters.kind}
      title="Filter by pass-directive kind"
      onChange={(e) => update('kind', e.target.value as OutboundColFilters['kind'])}
    >
      <option value="">any</option>
      <option value="proxy">proxy_pass</option>
      <option value="fastcgi">fastcgi_pass</option>
      <option value="grpc">grpc_pass</option>
      <option value="uwsgi">uwsgi_pass</option>
    </select>
  )

  return (
    <>
      <div className="ing-banner">
        <InfoIcon text="Every outbound backend target declared anywhere in your nginx configs: proxy_pass, fastcgi_pass, grpc_pass, uwsgi_pass. Grouped by upstream (named pool) vs. direct (host:port). Each row is tagged with DNS vs. IP so you can audit what the outbound firewall or service mesh needs to allow. The ⚠ column flags DNS-based targets that have NO `resolver` directive in scope — nginx will fail `nginx -t` at reload for those." />
        <span>
          <strong>{rows.length}</strong>
          {rows.length !== total && <> of <strong>{total}</strong></>} outbound target{rows.length === 1 ? '' : 's'} · {Object.keys(upstreams).length} upstream pool{Object.keys(upstreams).length === 1 ? '' : 's'}.
        </span>
      </div>
      {warnings.length > 0 && (
        <div className="ing-parse-warnings">
          <strong>Parse warnings ({warnings.length}):</strong>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      {upstreamRows.length > 0 && (
        <div className="ing-group">
          <h3 className="ing-group-title">
            Upstream pools
            <InfoIcon text={'Backends reached via a named `upstream { }` block (load-balanced). Each target is the upstream name as written in proxy_pass, e.g. `http://api_backend`. The `Members` column lists the actual server addresses in the pool — if any member is a hostname, the upstream inherits DNS resolution concerns.'} />
          </h3>
          <div className="ing-table-wrap">
            <table className="ing-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Upstream</th>
                  <th>Members</th>
                  <th>Used by (server / path)</th>
                  <th>Source</th>
                </tr>
                <tr className="ing-filter-row">
                  <th>{kindSelect}</th>
                  <th>
                    <input type="text" value={filters.target} placeholder="filter upstream name…" title="Substring match on upstream name or proxy_pass target" onChange={(e) => update('target', e.target.value)} />
                  </th>
                  <th>
                    {/* Members is computed server-side; no column-level filter. Use the Kind/Upstream filters to narrow down. */}
                    <span className="ing-filter-muted" title="Filter Upstream or Used-by to narrow this column.">—</span>
                  </th>
                  <th>
                    <input type="text" value={filters.used_by} placeholder="filter server or path…" title="Substring match on the server block and location path that references this upstream" onChange={(e) => update('used_by', e.target.value)} />
                  </th>
                  <th>
                    <input type="text" value={filters.source} placeholder="filter file…" title="Substring match on file path:line" onChange={(e) => update('source', e.target.value)} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {upstreamRows.map((d, i) => (
                  <tr key={i}>
                    <td><KindChip kind={d.kind} /></td>
                    <td>
                      <code>{d.upstream_name}</code>
                      {d.uses_tls && <span className="ing-chip ing-chip-tls" title="scheme uses https:// or grpcs://">TLS</span>}
                    </td>
                    <td>
                      {(upstreams[d.upstream_name ?? ''] ?? []).map((m, mi) => (
                        <code key={mi} className="ing-member">{m}</code>
                      ))}
                    </td>
                    <td>
                      <span className="ing-used-by">{d.server_name || <em>(unnamed)</em>}</span>
                      <code className="ing-path-inline">{d.path}</code>
                    </td>
                    <td><code className="ing-source">{d.file_path}:{d.line_number || '?'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {directRows.length > 0 && (
        <div className="ing-group">
          <h3 className="ing-group-title">
            Direct targets
            <InfoIcon text={'Backends reached directly (not via a named upstream). DNS = hostname (needs `resolver`); IP = literal IP (no DNS); unix = unix socket (no DNS, no port); variable = contains $vars (dynamic — always needs a resolver). The ⚠ badge flags DNS-based rows without a resolver in scope — those will fail nginx -t.'} />
          </h3>
          <div className="ing-table-wrap">
            <table className="ing-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Target</th>
                  <th>Host / Port</th>
                  <th>Type</th>
                  <th>Resolver</th>
                  <th>Used by (server / path)</th>
                  <th>Source</th>
                </tr>
                <tr className="ing-filter-row">
                  <th>{kindSelect}</th>
                  <th>
                    <input type="text" value={filters.target} placeholder="filter…" title="Substring match on the raw target string (e.g. 'api.example.com', 'unix:/tmp')" onChange={(e) => update('target', e.target.value)} />
                  </th>
                  <th>
                    <input type="text" value={filters.host} placeholder="filter host/port…" title="Substring match on extracted host or port" onChange={(e) => update('host', e.target.value)} />
                  </th>
                  <th>
                    <select
                      value={filters.type}
                      title="Filter by target classification"
                      onChange={(e) => update('type', e.target.value as OutboundColFilters['type'])}
                    >
                      <option value="">any</option>
                      <option value="host">DNS (host)</option>
                      <option value="ip">IP</option>
                      <option value="unix">unix</option>
                      <option value="variable">$variable</option>
                    </select>
                  </th>
                  <th>
                    <select
                      value={filters.resolver}
                      title="Filter by resolver-in-scope status"
                      onChange={(e) => update('resolver', e.target.value as OutboundColFilters['resolver'])}
                    >
                      <option value="">any</option>
                      <option value="missing">⚠ missing</option>
                      <option value="ok">in scope</option>
                      <option value="na">not applicable (IP/unix)</option>
                    </select>
                  </th>
                  <th>
                    <input type="text" value={filters.used_by} placeholder="filter server or path…" title="Substring match on the referring server and location path" onChange={(e) => update('used_by', e.target.value)} />
                  </th>
                  <th>
                    <input type="text" value={filters.source} placeholder="filter file…" title="Substring match on file path:line" onChange={(e) => update('source', e.target.value)} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {directRows.map((d, i) => (
                  <tr key={i} className={d.resolver_missing ? 'ing-row-warn' : ''}>
                    <td><KindChip kind={d.kind} /></td>
                    <td>
                      <code className="ing-backend-target">{d.target}</code>
                      {d.uses_tls && <span className="ing-chip ing-chip-tls" title="https:// / grpcs://">TLS</span>}
                    </td>
                    <td>
                      {d.host && <code>{d.host}</code>}
                      {d.port && <><span className="ing-port-sep">:</span><code>{d.port}</code></>}
                    </td>
                    <td>
                      {d.target_kind === 'host' && <span className="ing-chip ing-chip-dns" title="Hostname — requires a resolver to be in scope">DNS</span>}
                      {d.target_kind === 'ip' && <span className="ing-chip ing-chip-ip" title="Literal IP — no DNS lookup at runtime">IP</span>}
                      {d.target_kind === 'unix' && <span className="ing-chip ing-chip-unix" title="Unix domain socket">unix</span>}
                      {d.target_kind === 'variable' && <span className="ing-chip ing-chip-var" title="Contains $variables — resolved at request time, needs resolver">var</span>}
                    </td>
                    <td>
                      {d.resolver_missing ? (
                        <span className="ing-warn" title="No `resolver` directive found in http/server scope. nginx will reject the config at reload because DNS targets must be resolvable. Fix: add `resolver 1.1.1.1 8.8.8.8 valid=30s;` to the http { } or server { } block.">
                          ⚠ missing
                        </span>
                      ) : d.uses_dns ? (
                        <span className="ing-ok" title="Resolver directive is in scope for this target.">✓ in scope</span>
                      ) : (
                        <span className="ing-muted" title="Not DNS-based — no resolver needed.">—</span>
                      )}
                    </td>
                    <td>
                      <span className="ing-used-by">{d.server_name || <em>(unnamed)</em>}</span>
                      <code className="ing-path-inline">{d.path}</code>
                    </td>
                    <td><code className="ing-source">{d.file_path}:{d.line_number || '?'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length === 0 && <div className="ing-empty">No outbound dependencies match the current filter.</div>}
    </>
  )
}

function KindChip({ kind }: { kind: string }) {
  const labelMap: Record<string, string> = {
    proxy: 'proxy_pass',
    fastcgi: 'fastcgi_pass',
    grpc: 'grpc_pass',
    uwsgi: 'uwsgi_pass',
  }
  return (
    <span className={`ing-chip ing-chip-${kind || 'none'}`} title={labelMap[kind] ?? kind}>
      {kind || '—'}
    </span>
  )
}
