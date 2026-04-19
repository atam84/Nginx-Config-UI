import { useEffect, useRef } from 'react'
import './ConfirmModal.css'

interface Props {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    confirmBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="confirm-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-header">
          <h3 id="confirm-modal-title">{title}</h3>
          <button type="button" className="confirm-close" onClick={onCancel} aria-label="Cancel">×</button>
        </div>
        <div className="confirm-body">{message}</div>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            ref={confirmBtnRef}
            className={`confirm-ok${danger ? ' confirm-danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
