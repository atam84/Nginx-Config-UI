import { useState } from 'react'
import { type ConfigFile, type Node } from './api'
import './GlobalSettingsTab.css'

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
      <div className="field">
        <label>worker_processes</label>
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
        <label>error_log</label>
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
        <label>pid</label>
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

      <div className="extra-directives">
        <div className="extra-directives-header">
          <label>Additional Global Directives</label>
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
