import { useEffect, useState } from 'react'
import { fetchConfigHistory, fetchConfigVersion, restoreConfigVersion } from './api'
import './HistoryModal.css'

interface Props {
  filePath: string
  onClose: () => void
  onRestore: (content: string) => void
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function HistoryModal({ filePath, onClose, onRestore }: Props) {
  const [entries, setEntries] = useState<{ ts: number; size: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTs, setSelectedTs] = useState<number | null>(null)
  const [versionContent, setVersionContent] = useState<string | null>(null)
  const [loadingVersion, setLoadingVersion] = useState(false)
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetchConfigHistory(filePath)
      .then((data) => {
        setEntries(data)
        setLoading(false)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load history')
        setLoading(false)
      })
  }, [filePath])

  const handleSelectVersion = async (ts: number) => {
    setSelectedTs(ts)
    setLoadingVersion(true)
    setVersionContent(null)
    try {
      const content = await fetchConfigVersion(filePath, ts)
      setVersionContent(content)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load version')
    } finally {
      setLoadingVersion(false)
    }
  }

  const handleRestore = async () => {
    if (!selectedTs) return
    setRestoring(true)
    try {
      const res = await restoreConfigVersion(filePath, selectedTs)
      if (res.success) {
        onRestore(versionContent ?? '')
      } else {
        setError(res.message ?? 'Restore failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="history-modal">
        <div className="history-modal-header">
          <h3>History — {filePath}</h3>
          <button type="button" className="history-close-btn" onClick={onClose}>×</button>
        </div>

        {error && <div className="history-error">{error}</div>}

        <div className="history-modal-body">
          <div className="history-list">
            <div className="history-list-title">Saved versions</div>
            {loading && <div className="history-loading">Loading…</div>}
            {!loading && entries.length === 0 && (
              <div className="history-empty">No history yet. Save the file to create history entries.</div>
            )}
            {entries.map((e) => (
              <div
                key={e.ts}
                className={`history-entry${selectedTs === e.ts ? ' selected' : ''}`}
                onClick={() => handleSelectVersion(e.ts)}
              >
                <div className="history-entry-time">{formatTs(e.ts)}</div>
                <div className="history-entry-size">{formatSize(e.size)}</div>
              </div>
            ))}
          </div>

          <div className="history-content">
            {!selectedTs && (
              <div className="history-content-placeholder">Select a version on the left to preview it.</div>
            )}
            {selectedTs && loadingVersion && <div className="history-loading">Loading version…</div>}
            {selectedTs && !loadingVersion && versionContent !== null && (
              <>
                <div className="history-content-actions">
                  <span className="history-content-label">Version from {formatTs(selectedTs)}</span>
                  <button
                    type="button"
                    className="btn-save"
                    onClick={handleRestore}
                    disabled={restoring}
                  >
                    {restoring ? 'Restoring…' : 'Restore this version'}
                  </button>
                </div>
                <pre className="history-content-text">{versionContent}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
