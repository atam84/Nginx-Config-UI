import { useEffect, useState } from 'react'
import { type ConfigFile } from './api'
import { serializeConfigToText, diffLines } from './configUtils'
import './DiffModal.css'

interface Props {
  original: ConfigFile
  proposed: ConfigFile
  onConfirm: () => void
  onCancel: () => void
}

export default function DiffModal({ original, proposed, onConfirm, onCancel }: Props) {
  const [diff, setDiff] = useState<{ type: 'add' | 'remove' | 'unchanged'; line: string }[]>([])

  useEffect(() => {
    const oldText = serializeConfigToText(original)
    const newText = serializeConfigToText(proposed)
    setDiff(diffLines(oldText, newText))
  }, [original, proposed])

  return (
    <div className="diff-overlay" onClick={onCancel}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-header">
          <h3>Changes before save</h3>
          <button type="button" className="diff-close" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="diff-body">
          <pre className="diff-content">
            {diff.map((d, i) => (
              <div key={i} className={`diff-line diff-${d.type}`}>
                <span className="diff-line-num">{d.type === 'add' ? '+' : d.type === 'remove' ? '-' : ' '}</span>
                {d.line || ' '}
              </div>
            ))}
          </pre>
        </div>
        <div className="diff-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="diff-confirm" onClick={onConfirm}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
