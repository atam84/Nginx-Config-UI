import { useState } from 'react'
import './ErrorModal.css'

export interface ErrorDetails {
  title?: string
  message: string
  /** Parsed line number from nginx -t output (e.g. "10") */
  lineNumber?: number
  /** File path from nginx -t output */
  filePath?: string
  /** Config source text for line highlight (e.g. serialized config) */
  sourceText?: string
}

interface Props {
  error: ErrorDetails | string | null
  onDismiss: () => void
}

/** Parse nginx -t error output for file path and line number */
export function parseNginxError(output: string): { lineNumber?: number; filePath?: string } {
  const result: { lineNumber?: number; filePath?: string } = {}
  // Match "in /path/to/file.conf:42" or "in /etc/nginx/conf.d/default.conf:10"
  const inMatch = output.match(/in\s+([^\s:]+):(\d+)/)
  if (inMatch) {
    result.filePath = inMatch[1]
    result.lineNumber = parseInt(inMatch[2], 10)
  }
  // Fallback: match ":42" at end of a path
  const colonMatch = output.match(/:(\d+)\s*$/m)
  if (colonMatch && !result.lineNumber) {
    result.lineNumber = parseInt(colonMatch[1], 10)
  }
  return result
}

export default function ErrorModal({ error, onDismiss }: Props) {
  const [copied, setCopied] = useState(false)

  if (!error) return null

  const details: ErrorDetails =
    typeof error === 'string' ? { message: error } : error

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(details.message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="error-modal-overlay" onClick={onDismiss}>
      <div
        className="error-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="error-modal-header">
          <h3>{details.title ?? 'Error'}</h3>
          <button
            type="button"
            className="error-modal-close"
            onClick={onDismiss}
            title="Dismiss"
          >
            ×
          </button>
        </div>
        {(details.lineNumber !== undefined || details.filePath) && (
          <div className="error-modal-location">
            {details.filePath && (
              <span className="error-file">{details.filePath}</span>
            )}
            {details.lineNumber !== undefined && (
              <span className="error-line">Line {details.lineNumber}</span>
            )}
          </div>
        )}
        <pre className="error-modal-body">{details.message}</pre>
        {details.lineNumber !== undefined &&
          details.sourceText &&
          (() => {
            const lines = details.sourceText.split('\n')
            const ln = details.lineNumber
            const start = Math.max(0, ln - 3)
            const end = Math.min(lines.length, ln + 2)
            return (
              <div className="error-modal-context">
                <div className="error-modal-context-title">Around line {ln}:</div>
                <pre className="error-modal-context-code">
                  {lines.slice(start, end).map((line, i) => (
                    <div
                      key={i}
                      className={
                        start + i + 1 === ln ? 'error-line-highlight' : ''
                      }
                    >
                      <span className="error-line-num">{start + i + 1}</span>
                      {line || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            )
          })()}
        <div className="error-modal-actions">
          <button type="button" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button type="button" className="error-modal-dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
