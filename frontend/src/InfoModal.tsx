import { useEffect, type ReactNode } from 'react'
import './InfoModal.css'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
}

export default function InfoModal({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="info-modal-overlay" onClick={onClose}>
      <div className="info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="info-modal-header">
          <h3>{title}</h3>
          <button type="button" className="info-modal-close" onClick={onClose} title="Close">×</button>
        </div>
        <div className="info-modal-body">{children}</div>
        <div className="info-modal-footer">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
