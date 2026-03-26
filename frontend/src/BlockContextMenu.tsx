import { useEffect, useRef } from 'react'
import './BlockContextMenu.css'

export type BlockAction = 'moveUp' | 'moveDown' | 'duplicate' | 'delete' | 'toggleEnabled'

interface Props {
  x: number
  y: number
  canMoveUp: boolean
  canMoveDown: boolean
  enabled: boolean
  onAction: (action: BlockAction) => void
  onClose: () => void
}

export default function BlockContextMenu({
  x,
  y,
  canMoveUp,
  canMoveDown,
  enabled,
  onAction,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="block-context-menu"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        disabled={!canMoveUp}
        onClick={() => onAction('moveUp')}
      >
        Move up
      </button>
      <button
        type="button"
        disabled={!canMoveDown}
        onClick={() => onAction('moveDown')}
      >
        Move down
      </button>
      <button type="button" onClick={() => onAction('duplicate')}>
        Duplicate
      </button>
      <button type="button" onClick={() => onAction('toggleEnabled')}>
        {enabled ? 'Comment out' : 'Enable'}
      </button>
      <button type="button" className="danger" onClick={() => onAction('delete')}>
        Delete
      </button>
    </div>
  )
}
