import { useEffect, useRef, useState } from 'react'
import './ConfirmModal.css'

interface Props {
  title: string
  message?: React.ReactNode
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  inputType?: 'text' | 'url'
  validate?: (value: string) => string | null // return error message or null if OK
  onConfirm: (value: string) => void
  onCancel: () => void
}

export default function PromptModal({
  title,
  message,
  initialValue = '',
  placeholder,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  inputType = 'text',
  validate,
  onConfirm,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const v = value.trim()
    if (!v) { setError('Required'); return }
    if (validate) {
      const err = validate(v)
      if (err) { setError(err); return }
    }
    onConfirm(v)
  }

  return (
    <div className="confirm-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="prompt-modal-title">
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="confirm-header">
            <h3 id="prompt-modal-title">{title}</h3>
            <button type="button" className="confirm-close" onClick={onCancel} aria-label="Cancel">×</button>
          </div>
          <div className="confirm-body">
            {message}
            <input
              ref={inputRef}
              type={inputType}
              value={value}
              placeholder={placeholder}
              onChange={(e) => { setValue(e.target.value); setError(null) }}
              spellCheck={false}
              autoComplete="off"
            />
            {error && <div className="confirm-error">{error}</div>}
          </div>
          <div className="confirm-actions">
            <button type="button" onClick={onCancel}>{cancelLabel}</button>
            <button type="submit" className="confirm-ok">{confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
