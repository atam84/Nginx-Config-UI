import { useState } from 'react'
import { type ConfigFile, type Node } from './api'
import InfoIcon from './InfoIcon'
import './GlobalSettingsTab.css'

// ─── Events block helpers ─────────────────────────────────────────────────────

function getEventsArg(eventsBlock: Node | undefined, name: string): string {
  return eventsBlock?.directives?.find((d) => d.name === name)?.args?.[0] ?? ''
}

function getEventsToggle(eventsBlock: Node | undefined, name: string): boolean {
  return getEventsArg(eventsBlock, name) === 'on'
}

function getEventsFlagPresent(eventsBlock: Node | undefined, name: string): boolean {
  return !!eventsBlock?.directives?.find((d) => d.name === name)
}

const GLOBAL_DIRECTIVE_PRESETS: Array<{ name: string; args: string[] }> = [
  { name: 'include', args: ['/etc/nginx/conf.d/*.conf'] },
  { name: 'include', args: ['/etc/nginx/sites-enabled/*'] },
  { name: 'user', args: ['www-data'] },
  { name: 'worker_rlimit_nofile', args: ['65535'] },
  { name: 'worker_cpu_affinity', args: ['auto'] },
  { name: 'events', args: [] },
  { name: 'stream', args: [] },
  { name: 'env', args: ['TZ=UTC'] },
  { name: 'load_module', args: ['/usr/lib/nginx/modules/ngx_stream_module.so'] },
]

function getArg(d: Node | undefined, i: number): string {
  return d?.args?.[i] ?? ''
}

function setDirectiveArg(directives: Node[], name: string, argIndex: number, value: string): Node[] {
  return directives.map((d) => {
    if (d.name !== name) return d
    const args = [...(d.args ?? [])]
    while (args.length <= argIndex) args.push('')
    args[argIndex] = value
    return { ...d, args }
  })
}

function ensureDirective(directives: Node[], name: string, defaultArgs: string[]): Node[] {
  const exists = directives.some((d) => d.name === name)
  if (exists) return directives
  return [...directives, { type: 'directive', name, args: defaultArgs, enabled: true }]
}

function mergeEventsBlock(directives: Node[], desired: Record<string, string[]>): Node[] {
  const idx = directives.findIndex((d) => d.name === 'events' && d.type === 'block')
  const desiredAsDirs = (existing: Node[] = []): Node[] => {
    const existingNames = new Set(existing.map((d) => d.name))
    const additions = Object.entries(desired)
      .filter(([n]) => !existingNames.has(n))
      .map(([n, args]) => ({ type: 'directive' as const, name: n, args, enabled: true }))
    return [...existing, ...additions]
  }
  if (idx === -1) {
    return [...directives, { type: 'block', name: 'events', args: [], enabled: true, directives: desiredAsDirs([]) }]
  }
  const existingBlock = directives[idx]
  return directives.map((d, i) =>
    i === idx ? { ...existingBlock, directives: desiredAsDirs(existingBlock.directives ?? []) } : d
  )
}


interface Props {
  workerProcesses?: Node
  errorLog?: Node
  pid?: Node
  directives: Node[]
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  readOnly?: boolean
}

export default function GlobalSettingsTab({ workerProcesses, errorLog, pid, directives, onUpdate, readOnly }: Props) {
  const [newDirectivePreset, setNewDirectivePreset] = useState('include:/etc/nginx/conf.d/*.conf')
  const [eventsOpen, setEventsOpen] = useState(true)

  // ── Events block ──
  const eventsBlock = directives.find((d) => d.name === 'events' && d.type === 'block')

  const updateEventsBlock = (updater: (dirs: Node[]) => Node[]) => {
    onUpdate((c) => {
      const existing = c.directives.find((d) => d.name === 'events' && d.type === 'block')
      if (existing) {
        return {
          ...c,
          directives: c.directives.map((d) =>
            d.name === 'events' && d.type === 'block'
              ? { ...d, directives: updater(d.directives ?? []) }
              : d
          ),
        }
      }
      return {
        ...c,
        directives: [
          ...c.directives,
          { type: 'block' as const, name: 'events', args: [], enabled: true, directives: updater([]) },
        ],
      }
    })
  }

  const setEventsDir = (name: string, args: string[]) => {
    updateEventsBlock((dirs) => {
      const without = dirs.filter((d) => d.name !== name)
      if (args.length === 0) return without
      return [...without, { type: 'directive' as const, name, args, enabled: true }]
    })
  }

  const setEventsToggle = (name: string, on: boolean) => setEventsDir(name, [on ? 'on' : 'off'])
  const extraDirectiveItems = directives
    .map((d, idx) => ({ d, idx }))
    .filter(
      ({ d }) =>
        d.type === 'directive' &&
        d.name !== 'worker_processes' &&
        d.name !== 'error_log' &&
        d.name !== 'pid'
    )

  const update = (name: string, argIndex: number, value: string) => {
    onUpdate((c) => {
      let d = ensureDirective(c.directives, name, name === 'worker_processes' ? ['auto'] : [''])
      d = setDirectiveArg(d, name, argIndex, value)
      return { ...c, directives: d }
    })
  }

  const updateExtraDirective = (idx: number, updater: (d: Node) => Node) => {
    onUpdate((c) => ({
      ...c,
      directives: c.directives.map((d, i) => (i === idx ? updater(d) : d)),
    }))
  }

  const removeExtraDirective = (idx: number) => {
    onUpdate((c) => ({
      ...c,
      directives: c.directives.filter((_, i) => i !== idx),
    }))
  }

  const applyPerformanceDefaults = () => {
    onUpdate((c) => {
      let dirs = c.directives
      dirs = ensureDirective(dirs, 'worker_processes', ['auto'])
      dirs = ensureDirective(dirs, 'worker_rlimit_nofile', ['65535'])
      dirs = mergeEventsBlock(dirs, {
        worker_connections: ['4096'],
        multi_accept: ['on'],
        use: ['epoll'],
      })
      return { ...c, directives: dirs }
    })
  }

  const applyHardeningDefaults = () => {
    onUpdate((c) => {
      let dirs = c.directives
      dirs = ensureDirective(dirs, 'user', ['www-data'])
      dirs = ensureDirective(dirs, 'pid', ['/run/nginx.pid'])
      dirs = ensureDirective(dirs, 'worker_shutdown_timeout', ['10s'])
      // Downgrade error_log severity if set to debug/info (too verbose for prod)
      dirs = dirs.map((d) => {
        if (d.name !== 'error_log') return d
        const level = d.args?.[1]
        if (level === 'debug' || level === 'info') {
          const args = [...(d.args ?? [])]
          args[1] = 'warn'
          return { ...d, args }
        }
        if (!level && d.args?.[0]) {
          return { ...d, args: [d.args[0], 'warn'] }
        }
        return d
      })
      // Ensure error_log exists at all
      dirs = ensureDirective(dirs, 'error_log', ['/var/log/nginx/error.log', 'warn'])
      return { ...c, directives: dirs }
    })
  }

  const addExtraDirective = () => {
    const [name, ...argParts] = newDirectivePreset.split(':')
    const args = argParts.join(':')
    onUpdate((c) => ({
      ...c,
      directives: [
        ...c.directives,
        {
          type: 'directive',
          name: name || 'include',
          args: args ? args.split(/\s+/).filter(Boolean) : [],
          enabled: true,
          id: `global-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      ],
    }))
  }

  return (
    <div className="global-settings">
      {!readOnly && (
        <div className="gs-presets">
          <div className="gs-presets-header">
            <span className="gs-presets-title">Recommended defaults</span>
            <InfoIcon text="One-click presets that add sensible directives if they're missing. Existing values are preserved — nothing is overwritten except an over-verbose error_log level (debug/info → warn)." />
          </div>
          <div className="gs-presets-buttons">
            <button
              type="button"
              className="gs-preset-btn"
              onClick={applyPerformanceDefaults}
              title="Adds: worker_processes auto · worker_rlimit_nofile 65535 · events{ worker_connections 4096, multi_accept on, use epoll }"
            >
              <span className="gs-preset-dot" style={{ background: '#22c55e' }} />
              Apply performance defaults
              <InfoIcon text="Sets worker_processes=auto, worker_rlimit_nofile=65535, and an events block with worker_connections=4096, multi_accept on, use epoll. Existing directives are kept." />
            </button>
            <button
              type="button"
              className="gs-preset-btn"
              onClick={applyHardeningDefaults}
              title="Adds: user www-data · pid /run/nginx.pid · worker_shutdown_timeout 10s · error_log …/error.log warn (lowers debug/info levels)"
            >
              <span className="gs-preset-dot" style={{ background: '#f97316' }} />
              Apply hardening defaults
              <InfoIcon text="Sets user=www-data (drops privileges), an explicit pid path, worker_shutdown_timeout=10s, and forces error_log severity to at least warn (overrides debug/info only — louder levels like error/crit are preserved)." />
            </button>
          </div>
        </div>
      )}

      <div className="field">
        <label>
          worker_processes
          <InfoIcon text="Number of worker processes. 'auto' = one per CPU core (recommended). Each worker handles connections independently in a single thread." />
        </label>
        <div className="field-control">
          <select
            value={getArg(workerProcesses, 0) || 'auto'}
            onChange={(e) => update('worker_processes', 0, e.target.value)}
            disabled={readOnly}
          >
            <option value="auto">auto</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="4">4</option>
            <option value="8">8</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label>
          error_log
          <InfoIcon text="Path + minimum severity. Use 'warn' or 'error' in production — 'debug' and 'info' are extremely verbose, fill disks quickly, and hurt performance." />
        </label>
        <div className="field-control">
          <input
            type="text"
            value={getArg(errorLog, 0)}
            onChange={(e) => update('error_log', 0, e.target.value)}
            readOnly={readOnly}
            placeholder="/var/log/nginx/error.log"
          />
          <select
            value={getArg(errorLog, 1) || 'warn'}
            onChange={(e) => update('error_log', 1, e.target.value)}
            disabled={readOnly}
          >
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="notice">notice</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
            <option value="crit">crit</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label>
          pid
          <InfoIcon text="Path where nginx writes the master process PID. systemd reads this to manage the service. Default: /run/nginx.pid (or /var/run/nginx.pid on older distros)." />
        </label>
        <div className="field-control">
          <input
            type="text"
            value={getArg(pid, 0)}
            onChange={(e) => update('pid', 0, e.target.value)}
            readOnly={readOnly}
            placeholder="/run/nginx.pid"
          />
        </div>
      </div>

      {/* ── Events block ──────────────────────────────────────────────────── */}
      <div className="gs-events-section">
        <button
          type="button"
          className="gs-events-header"
          onClick={() => setEventsOpen((v) => !v)}
        >
          <span className={`gs-events-chevron${eventsOpen ? ' open' : ''}`}>▶</span>
          Events
          <InfoIcon text="The `events { }` block controls how nginx accepts and processes connections. Settings here define capacity (worker_connections), the I/O method (use), and acceptance behavior (multi_accept, accept_mutex)." />
        </button>
        {eventsOpen && (
          <div className="gs-events-body">
            <div className="gs-events-row">
              <div className="field gs-events-field">
                <label>
                  worker_connections
                  <InfoIcon text="Max concurrent connections per worker. Total capacity ≈ worker_processes × worker_connections. 1024 is safe; raise to 4096–16384 for busy servers. Must not exceed the system open-file limit (worker_rlimit_nofile)." />
                </label>
                <div className="field-control">
                  <input
                    type="number"
                    value={getEventsArg(eventsBlock, 'worker_connections')}
                    onChange={(e) => setEventsDir('worker_connections', e.target.value ? [e.target.value] : [])}
                    readOnly={readOnly}
                    placeholder="1024"
                    min="1"
                  />
                </div>
              </div>
              <div className="field gs-events-field">
                <label>
                  use
                  <InfoIcon text="Connection-processing method. 'epoll' is the fastest on Linux (default on modern systems); 'kqueue' on BSD/macOS. Leave unset to let nginx auto-select the best method for the OS." />
                </label>
                <div className="field-control">
                  <select
                    value={getEventsArg(eventsBlock, 'use')}
                    onChange={(e) => setEventsDir('use', e.target.value ? [e.target.value] : [])}
                    disabled={readOnly}
                  >
                    <option value="">— not set —</option>
                    <option value="epoll">epoll</option>
                    <option value="kqueue">kqueue</option>
                    <option value="select">select</option>
                    <option value="poll">poll</option>
                    <option value="auto">auto</option>
                  </select>
                </div>
              </div>
              <div className="field gs-events-field">
                <label>
                  accept_mutex_delay
                  <InfoIcon text="When accept_mutex is on, how long a worker waits before trying to accept new connections again after another worker got the lock. Default: 500ms. Only relevant if accept_mutex is on." />
                </label>
                <div className="field-control">
                  <input
                    type="text"
                    value={getEventsArg(eventsBlock, 'accept_mutex_delay')}
                    onChange={(e) => setEventsDir('accept_mutex_delay', e.target.value ? [e.target.value] : [])}
                    readOnly={readOnly}
                    placeholder="500ms"
                  />
                </div>
              </div>
            </div>
            <div className="gs-events-toggles">
              <label className="gs-toggle-label">
                <span className="gs-toggle-wrap">
                  <input
                    type="checkbox"
                    className="gs-toggle-input"
                    checked={getEventsFlagPresent(eventsBlock, 'multi_accept') ? getEventsToggle(eventsBlock, 'multi_accept') : false}
                    onChange={(e) => setEventsToggle('multi_accept', e.target.checked)}
                    disabled={readOnly}
                  />
                  <span className="gs-toggle-track" />
                </span>
                <span className="gs-toggle-name">multi_accept</span>
                <InfoIcon text="If on, a worker accepts all pending connections in one go instead of one per event-loop iteration. Improves throughput under heavy concurrent load." />
              </label>
              <label className="gs-toggle-label">
                <span className="gs-toggle-wrap">
                  <input
                    type="checkbox"
                    className="gs-toggle-input"
                    checked={getEventsFlagPresent(eventsBlock, 'accept_mutex') ? getEventsToggle(eventsBlock, 'accept_mutex') : false}
                    onChange={(e) => setEventsToggle('accept_mutex', e.target.checked)}
                    disabled={readOnly}
                  />
                  <span className="gs-toggle-track" />
                </span>
                <span className="gs-toggle-name">accept_mutex</span>
                <InfoIcon text="Serializes which worker accepts new connections. Off by default on modern Linux — epoll + SO_REUSEPORT distributes connections more efficiently than a mutex." />
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="extra-directives">
        <div className="extra-directives-header">
          <label>
            Additional Global Directives
            <InfoIcon text="Top-level (main{}) directives not covered above — e.g. `user`, `worker_rlimit_nofile`, `include` to pull in conf.d/sites-enabled, `load_module` for dynamic modules, `env` for environment variables passed to workers." />
          </label>
          {!readOnly && (
            <div className="add-directive-controls">
              <select
                value={newDirectivePreset}
                onChange={(e) => setNewDirectivePreset(e.target.value)}
              >
                {GLOBAL_DIRECTIVE_PRESETS.map((p, i) => (
                  <option key={`${p.name}-${i}`} value={`${p.name}:${p.args.join(' ')}`}>
                    {p.name}{p.args.length ? ` ${p.args.join(' ')}` : ''}
                  </option>
                ))}
                <option value="custom:">custom (empty)</option>
              </select>
              <button type="button" className="btn-add-directive" onClick={addExtraDirective}>
                + Add directive
              </button>
            </div>
          )}
        </div>
        {extraDirectiveItems.length === 0 ? (
          <p className="extra-empty">No extra directives yet.</p>
        ) : (
          <div className="extra-list">
            {extraDirectiveItems.map(({ d, idx }) => (
              <div key={d.id ?? idx} className="extra-row">
                <input
                  type="text"
                  value={d.name}
                  onChange={(e) =>
                    updateExtraDirective(idx, (cur) => ({ ...cur, name: e.target.value || 'directive' }))
                  }
                  readOnly={readOnly}
                  placeholder="directive name"
                />
                <input
                  type="text"
                  value={(d.args ?? []).join(' ')}
                  onChange={(e) =>
                    updateExtraDirective(idx, (cur) => ({
                      ...cur,
                      args: e.target.value.split(/\s+/).filter(Boolean),
                    }))
                  }
                  readOnly={readOnly}
                  placeholder="arguments"
                />
                {!readOnly && (
                  <button
                    type="button"
                    className="btn-remove-directive"
                    onClick={() => removeExtraDirective(idx)}
                    title="Remove directive"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
