import { useState, useMemo } from 'react'
import InfoIcon from './InfoIcon'
import './IfConditionBuilder.css'

interface Props {
  value: string
  onChange: (next: string) => void
  readOnly?: boolean
}

const COMMON_VARIABLES = [
  '$request_method',
  '$request_uri',
  '$uri',
  '$args',
  '$query_string',
  '$scheme',
  '$host',
  '$http_host',
  '$http_user_agent',
  '$http_referer',
  '$http_x_forwarded_for',
  '$remote_addr',
  '$server_name',
  '$server_port',
  '$cookie_name',
  '$arg_name',
  '$request_filename',
  '$https',
]

interface Op {
  key: string
  label: string
  hint: string
  takesValue: boolean
  isFileTest: boolean
}

const OPERATORS: Op[] = [
  { key: '=',   label: '=',   hint: 'equals (case-sensitive)', takesValue: true, isFileTest: false },
  { key: '!=',  label: '!=',  hint: 'does not equal', takesValue: true, isFileTest: false },
  { key: '~',   label: '~',   hint: 'matches regex (case-sensitive)', takesValue: true, isFileTest: false },
  { key: '~*',  label: '~*',  hint: 'matches regex (case-insensitive)', takesValue: true, isFileTest: false },
  { key: '!~',  label: '!~',  hint: 'does not match regex (case-sensitive)', takesValue: true, isFileTest: false },
  { key: '!~*', label: '!~*', hint: 'does not match regex (case-insensitive)', takesValue: true, isFileTest: false },
  { key: 'truthy', label: '(truthy)', hint: 'variable is set and not "0" or empty', takesValue: false, isFileTest: false },
  { key: '-f',  label: '-f',  hint: 'file exists',              takesValue: true, isFileTest: true  },
  { key: '!-f', label: '!-f', hint: 'file does not exist',      takesValue: true, isFileTest: true  },
  { key: '-d',  label: '-d',  hint: 'directory exists',         takesValue: true, isFileTest: true  },
  { key: '!-d', label: '!-d', hint: 'directory does not exist', takesValue: true, isFileTest: true  },
  { key: '-e',  label: '-e',  hint: 'file or directory exists', takesValue: true, isFileTest: true  },
  { key: '!-e', label: '!-e', hint: 'does not exist',           takesValue: true, isFileTest: true  },
  { key: '-x',  label: '-x',  hint: 'executable',               takesValue: true, isFileTest: true  },
  { key: '!-x', label: '!-x', hint: 'not executable',           takesValue: true, isFileTest: true  },
]

interface Parsed {
  variable: string
  operator: string
  value: string
}

function parseCondition(raw: string): Parsed {
  const trimmed = raw.trim().replace(/^\(/, '').replace(/\)$/, '').trim()
  if (!trimmed) return { variable: '', operator: 'truthy', value: '' }
  // File tests: (-f path), (!-f path), etc.
  const fileMatch = trimmed.match(/^(!?-[fdex])\s+(.+)$/)
  if (fileMatch) return { variable: fileMatch[2].trim(), operator: fileMatch[1], value: '' }
  // $var OP value (order of operators matters — longest first)
  const opMatch = trimmed.match(/^(\$?[\w.-]+)\s*(!~\*|~\*|!~|!=|=|~)\s*(.*)$/)
  if (opMatch) {
    const v = opMatch[3].trim().replace(/^["']/, '').replace(/["']$/, '')
    return { variable: opMatch[1], operator: opMatch[2], value: v }
  }
  // Just a variable — truthy test
  return { variable: trimmed, operator: 'truthy', value: '' }
}

function buildCondition(p: Parsed): string {
  const op = OPERATORS.find((o) => o.key === p.operator)
  if (!op) return ''
  if (op.isFileTest) {
    if (!p.variable.trim()) return ''
    return `(${p.operator} ${p.variable})`
  }
  if (p.operator === 'truthy') {
    if (!p.variable.trim()) return ''
    return `(${p.variable})`
  }
  if (!p.variable.trim()) return ''
  const val = p.value
  const needsQuote = /\s|["']/.test(val) || val === ''
  const q = needsQuote ? `"${val.replace(/"/g, '\\"')}"` : val
  return `(${p.variable} ${p.operator} ${q})`
}

export default function IfConditionBuilder({ value, onChange, readOnly }: Props) {
  const [rawMode, setRawMode] = useState(false)
  const parsed = useMemo(() => parseCondition(value), [value])
  const op = OPERATORS.find((o) => o.key === parsed.operator) ?? OPERATORS[0]

  const update = (patch: Partial<Parsed>) => {
    const next = { ...parsed, ...patch }
    // Reset value when switching to a no-value operator
    const nextOp = OPERATORS.find((o) => o.key === next.operator) ?? OPERATORS[0]
    if (!nextOp.takesValue) next.value = ''
    onChange(buildCondition(next))
  }

  return (
    <div className="ifcb">
      <div className="ifcb-header">
        <span className="ifcb-title">
          Condition builder
          <InfoIcon text="Compose an nginx if condition using: a variable (or file path for -f/-d/-e/-x tests), an operator, and an optional value. The raw string is synced — toggle 'Raw' to edit it directly. See nginx.org/en/docs/http/ngx_http_rewrite_module.html#if for full grammar." />
        </span>
        <div className="ifcb-mode">
          <button type="button" className={`ifcb-mode-btn${!rawMode ? ' active' : ''}`} onClick={() => setRawMode(false)}>Builder</button>
          <button type="button" className={`ifcb-mode-btn${rawMode ? ' active' : ''}`} onClick={() => setRawMode(true)}>Raw</button>
        </div>
      </div>

      {!rawMode ? (
        <div className="ifcb-fields">
          <label className="ifcb-field">
            <span>{op.isFileTest ? 'Path' : 'Variable'}</span>
            {op.isFileTest ? (
              <input
                type="text"
                value={parsed.variable}
                onChange={(e) => update({ variable: e.target.value })}
                readOnly={readOnly}
                placeholder="/path/to/file"
              />
            ) : (
              <input
                type="text"
                list="ifcb-vars"
                value={parsed.variable}
                onChange={(e) => update({ variable: e.target.value })}
                readOnly={readOnly}
                placeholder="$request_method"
              />
            )}
            <datalist id="ifcb-vars">
              {COMMON_VARIABLES.map((v) => <option key={v} value={v} />)}
            </datalist>
          </label>

          <label className="ifcb-field ifcb-op">
            <span>Operator</span>
            <select
              value={parsed.operator}
              onChange={(e) => update({ operator: e.target.value })}
              disabled={readOnly}
              title={op.hint}
            >
              {OPERATORS.map((o) => (
                <option key={o.key} value={o.key} title={o.hint}>{o.label} — {o.hint}</option>
              ))}
            </select>
          </label>

          {op.takesValue && !op.isFileTest && (
            <label className="ifcb-field">
              <span>Value</span>
              <input
                type="text"
                value={parsed.value}
                onChange={(e) => update({ value: e.target.value })}
                readOnly={readOnly}
                placeholder={parsed.operator.includes('~') ? 'regex pattern' : 'POST, GET, foo.example.com, …'}
              />
            </label>
          )}
        </div>
      ) : (
        <input
          type="text"
          className="ifcb-raw-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          placeholder="($request_method = POST)"
        />
      )}

      <div className="ifcb-preview">
        <span className="ifcb-preview-label">Emits:</span>
        <code>{value.trim() ? `if ${value.trim().startsWith('(') ? value.trim() : `(${value.trim()})`} { … }` : 'if (…) { … }'}</code>
      </div>
    </div>
  )
}
