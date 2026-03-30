import { useState } from 'react'
import './LogFormatBuilder.css'

// ─── Variable palette data ─────────────────────────────────────────────────

const NGINX_VARS = [
  {
    group: 'Connection',
    vars: [
      { name: 'remote_addr',         sample: '192.168.1.100',              desc: 'Client IP address' },
      { name: 'remote_user',         sample: 'john',                       desc: 'HTTP basic auth username' },
      { name: 'connection',          sample: '42',                         desc: 'Connection sequence number' },
      { name: 'connection_requests', sample: '5',                          desc: 'Requests made on this connection' },
    ],
  },
  {
    group: 'Time',
    vars: [
      { name: 'time_local',   sample: '30/Mar/2026:12:00:00 +0000', desc: 'Local time in common log format' },
      { name: 'time_iso8601', sample: '2026-03-30T12:00:00+00:00',  desc: 'Time in ISO 8601 format' },
      { name: 'msec',         sample: '1743336000.123',             desc: 'Time in seconds with milliseconds' },
    ],
  },
  {
    group: 'Request',
    vars: [
      { name: 'request',        sample: 'GET /api/data HTTP/1.1', desc: 'Full original request line' },
      { name: 'request_method', sample: 'GET',                    desc: 'HTTP method (GET, POST, …)' },
      { name: 'request_uri',    sample: '/api/data?key=val',      desc: 'Full request URI including query string' },
      { name: 'uri',            sample: '/api/data',              desc: 'Request URI without query string' },
      { name: 'args',           sample: 'key=val',                desc: 'Query string arguments' },
      { name: 'http_host',      sample: 'example.com',           desc: 'Host request header' },
      { name: 'scheme',         sample: 'https',                  desc: 'Request scheme: http or https' },
      { name: 'server_name',    sample: 'example.com',           desc: 'Name of server handling the request' },
      { name: 'server_port',    sample: '443',                    desc: 'Port of server handling the request' },
      { name: 'request_length', sample: '512',                    desc: 'Request length in bytes (headers + body)' },
      { name: 'request_time',   sample: '0.042',                  desc: 'Request processing time in seconds' },
    ],
  },
  {
    group: 'Response',
    vars: [
      { name: 'status',          sample: '200',  desc: 'Response status code' },
      { name: 'body_bytes_sent', sample: '1523', desc: 'Bytes sent to client, excluding headers' },
      { name: 'bytes_sent',      sample: '1765', desc: 'Total bytes sent to client' },
      { name: 'pipe',            sample: '.',    desc: '"p" if pipelined, "." otherwise' },
    ],
  },
  {
    group: 'Headers',
    vars: [
      { name: 'http_referer',           sample: 'https://google.com/',  desc: 'Referer request header' },
      { name: 'http_user_agent',        sample: 'Mozilla/5.0 (Linux)',  desc: 'User-Agent request header' },
      { name: 'http_x_forwarded_for',   sample: '10.0.0.1',            desc: 'X-Forwarded-For request header' },
      { name: 'http_accept_encoding',   sample: 'gzip, deflate, br',   desc: 'Accept-Encoding request header' },
      { name: 'sent_http_content_type', sample: 'application/json',    desc: 'Content-Type response header sent' },
    ],
  },
  {
    group: 'Upstream',
    vars: [
      { name: 'upstream_addr',          sample: '10.0.0.2:8080', desc: 'Address of upstream server' },
      { name: 'upstream_status',        sample: '200',           desc: 'Response status from upstream' },
      { name: 'upstream_response_time', sample: '0.038',         desc: 'Time to receive response from upstream' },
      { name: 'upstream_cache_status',  sample: 'MISS',          desc: 'Cache status: HIT, MISS, BYPASS, …' },
      { name: 'upstream_connect_time',  sample: '0.001',         desc: 'Time to connect to upstream' },
    ],
  },
  {
    group: 'SSL',
    vars: [
      { name: 'ssl_protocol',    sample: 'TLSv1.3',                 desc: 'SSL/TLS protocol used' },
      { name: 'ssl_cipher',      sample: 'TLS_AES_256_GCM_SHA384', desc: 'SSL/TLS cipher suite' },
      { name: 'ssl_server_name', sample: 'example.com',            desc: 'SNI server name from TLS handshake' },
    ],
  },
] as const

type VarGroup = typeof NGINX_VARS[number]
type VarEntry = VarGroup['vars'][number]

const SAMPLE_MAP: Record<string, string> = {}
for (const g of NGINX_VARS) {
  for (const v of g.vars) {
    SAMPLE_MAP[v.name] = v.sample
  }
}

// ─── Preset formats ────────────────────────────────────────────────────────

const PRESETS = [
  {
    name: 'combined',
    format: "'$remote_addr - $remote_user [$time_local] \"$request\" $status $body_bytes_sent \"$http_referer\" \"$http_user_agent\"'",
  },
  {
    name: 'main',
    format: "'$remote_addr - $remote_user [$time_local] \"$request\" $status $body_bytes_sent \"$http_referer\" \"$http_user_agent\" \"$http_x_forwarded_for\"'",
  },
  {
    name: 'json',
    format: `'{"time":"$time_iso8601","remote_addr":"$remote_addr","method":"$request_method","uri":"$request_uri","status":$status,"bytes":$body_bytes_sent,"rt":$request_time,"ua":"$http_user_agent"}'`,
  },
  {
    name: 'upstream_timing',
    format: "'$remote_addr [$time_local] \"$request\" $status $body_bytes_sent rt=$request_time ua=$upstream_addr us=$upstream_status ut=$upstream_response_time uc=$upstream_cache_status'",
  },
]

// ─── Token model ──────────────────────────────────────────────────────────

type Token =
  | { type: 'var';     name: string }
  | { type: 'literal'; text: string }

function parseTokens(raw: string): Token[] {
  let s = raw.trim()
  // Strip surrounding quotes (single only — nginx uses single-quoted strings)
  if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1)
  const tokens: Token[] = []
  let pos = 0
  while (pos < s.length) {
    const rest = s.slice(pos)
    const m = rest.match(/^\$([a-zA-Z_][a-zA-Z_0-9]*)/)
    if (m) {
      tokens.push({ type: 'var', name: m[1] })
      pos += m[0].length
    } else {
      const next = rest.search(/\$[a-zA-Z_]/)
      if (next < 0) {
        tokens.push({ type: 'literal', text: rest })
        break
      }
      tokens.push({ type: 'literal', text: rest.slice(0, next) })
      pos += next
    }
  }
  return tokens.filter((t) => (t.type === 'var' ? t.name.length > 0 : t.text.length > 0))
}

function tokensToFormat(tokens: Token[]): string {
  return "'" + tokens.map((t) => (t.type === 'var' ? `$${t.name}` : t.text)).join('') + "'"
}

function renderPreview(tokens: Token[]): string {
  return tokens
    .map((t) => (t.type === 'var' ? (SAMPLE_MAP[t.name] ?? `$${t.name}`) : t.text))
    .join('')
}

// ─── Component ────────────────────────────────────────────────────────────

interface Props {
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
}

export default function LogFormatBuilder({ value, onChange, readOnly }: Props) {
  const [open, setOpen] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [newLiteral, setNewLiteral] = useState('')
  const [activeGroup, setActiveGroup] = useState<string>(NGINX_VARS[0].group)
  const [hoveredVar, setHoveredVar] = useState<VarEntry | null>(null)

  const tokens = parseTokens(value)
  const push = (next: Token[]) => onChange(tokensToFormat(next))

  const appendVar = (name: string) => {
    push([...tokens, { type: 'var', name }])
  }

  const appendLiteral = () => {
    const t = newLiteral
    if (!t) return
    push([...tokens, { type: 'literal', text: t }])
    setNewLiteral('')
  }

  const removeToken = (i: number) => {
    push(tokens.filter((_, j) => j !== i))
    if (editingIdx === i) setEditingIdx(null)
  }

  const updateLiteralText = (i: number, text: string) => {
    push(tokens.map((t, j) => (j === i ? { type: 'literal', text } : t)))
  }

  const moveToken = (i: number, dir: -1 | 1) => {
    const next = [...tokens]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    push(next)
    setEditingIdx(null)
  }

  const applyPreset = (fmt: string) => onChange(fmt)

  const activeVars = (NGINX_VARS.find((g) => g.group === activeGroup)?.vars ?? []) as readonly VarEntry[]

  return (
    <div className="lfb-wrap">
      {/* ── Raw input + toggle ── */}
      <div className="lfb-raw-row">
        <input
          type="text"
          className="lfb-raw-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          placeholder={"'$remote_addr [$time_local] \"$request\" $status $body_bytes_sent'"}
          spellCheck={false}
        />
        {!readOnly && (
          <button
            type="button"
            className={`lfb-toggle ${open ? 'lfb-toggle-open' : ''}`}
            onClick={() => setOpen((p) => !p)}
          >
            Builder {open ? '▾' : '▸'}
          </button>
        )}
      </div>

      {open && (
        <div className="lfb-panel">

          {/* ── Presets ── */}
          <div className="lfb-presets">
            <span className="lfb-section-label">Presets</span>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="lfb-preset-btn"
                onClick={() => applyPreset(p.format)}
                title={p.format}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* ── Token strip ── */}
          <div className="lfb-tokens-wrap">
            <span className="lfb-section-label">Tokens</span>
            <div className="lfb-tokens">
              {tokens.length === 0 && (
                <span className="lfb-tokens-empty">Empty — add variables or text below</span>
              )}
              {tokens.map((tok, i) => (
                <span
                  key={i}
                  className={`lfb-chip ${tok.type === 'var' ? 'lfb-chip-var' : 'lfb-chip-lit'}`}
                >
                  {tok.type === 'var' ? (
                    <span className="lfb-chip-name"><span className="lfb-dollar">$</span>{tok.name}</span>
                  ) : editingIdx === i ? (
                    <input
                      autoFocus
                      type="text"
                      className="lfb-chip-input"
                      value={tok.text}
                      onChange={(e) => updateLiteralText(i, e.target.value)}
                      onBlur={() => setEditingIdx(null)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingIdx(null) }}
                      size={Math.max(2, tok.text.length + 1)}
                    />
                  ) : (
                    <span
                      className="lfb-chip-name lfb-chip-editable"
                      onClick={() => setEditingIdx(i)}
                      title="Click to edit"
                    >
                      {tok.text}
                    </span>
                  )}
                  <span className="lfb-chip-actions">
                    {i > 0 && (
                      <button type="button" className="lfb-chip-move" onClick={() => moveToken(i, -1)} title="Move left">‹</button>
                    )}
                    {i < tokens.length - 1 && (
                      <button type="button" className="lfb-chip-move" onClick={() => moveToken(i, 1)} title="Move right">›</button>
                    )}
                    <button type="button" className="lfb-chip-del" onClick={() => removeToken(i)} title="Remove">×</button>
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* ── Add literal text ── */}
          <div className="lfb-add-row">
            <span className="lfb-section-label">Add text</span>
            <input
              type="text"
              className="lfb-literal-input"
              value={newLiteral}
              onChange={(e) => setNewLiteral(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') appendLiteral() }}
              placeholder='e.g.  - [  ]  "  "  '
              spellCheck={false}
            />
            <button
              type="button"
              className="lfb-add-btn"
              onClick={appendLiteral}
              disabled={!newLiteral}
            >
              + Add
            </button>
          </div>

          {/* ── Variable palette ── */}
          <div className="lfb-palette">
            <span className="lfb-section-label">Variables</span>
            <div className="lfb-palette-inner">
              <div className="lfb-group-tabs">
                {NGINX_VARS.map((g) => (
                  <button
                    key={g.group}
                    type="button"
                    className={`lfb-group-tab ${activeGroup === g.group ? 'active' : ''}`}
                    onClick={() => setActiveGroup(g.group)}
                  >
                    {g.group}
                  </button>
                ))}
              </div>
              <div className="lfb-var-grid">
                {activeVars.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    className="lfb-var-btn"
                    onClick={() => appendVar(v.name)}
                    onMouseEnter={() => setHoveredVar(v)}
                    onMouseLeave={() => setHoveredVar(null)}
                    title={v.desc}
                  >
                    <span className="lfb-dollar">$</span>{v.name}
                  </button>
                ))}
              </div>
              {hoveredVar && (
                <div className="lfb-var-desc">
                  <code>${hoveredVar.name}</code>
                  <span>{hoveredVar.desc}</span>
                  <span className="lfb-var-sample">e.g. {hoveredVar.sample}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Preview ── */}
          {tokens.length > 0 && (
            <div className="lfb-preview">
              <span className="lfb-section-label">Preview</span>
              <code className="lfb-preview-line">{renderPreview(tokens)}</code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
