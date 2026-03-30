import { useEffect, useRef, useState } from 'react'
import { searchConfigs, type SearchResult } from './api'
import './SearchPanel.css'

interface Props {
  onNavigate: (filePath: string) => void
  onClose: () => void
}

function groupByFile(results: SearchResult[]): Map<string, SearchResult[]> {
  const map = new Map<string, SearchResult[]>()
  for (const r of results) {
    const group = map.get(r.file_path) ?? []
    group.push(r)
    map.set(r.file_path, group)
  }
  return map
}

export default function SearchPanel({ onNavigate, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchConfigs(query.trim())
        setResults(data.results ?? [])
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const grouped = groupByFile(results)

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="search-panel">
        <div className="search-panel-header">
          <div className="search-input-wrap">
            <span className="search-icon">🔍</span>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search directives, values, comments…"
              spellCheck={false}
            />
            {loading && <span className="search-spinner">…</span>}
          </div>
          <button type="button" className="search-close-btn" onClick={onClose}>×</button>
        </div>

        {error && <div className="search-error">{error}</div>}

        <div className="search-results">
          {!query.trim() && (
            <div className="search-placeholder">Type to search across all config files.</div>
          )}
          {query.trim() && !loading && results.length === 0 && (
            <div className="search-placeholder">No results found for "{query}"</div>
          )}
          {Array.from(grouped.entries()).map(([file, items]) => (
            <div key={file} className="search-file-group">
              <div className="search-file-header" onClick={() => onNavigate(file)}>
                <span className="search-file-icon">📄</span>
                <span className="search-file-name">{file}</span>
                <span className="search-file-count">{items.length}</span>
              </div>
              {items.map((r, i) => (
                <div
                  key={i}
                  className="search-result-item"
                  onClick={() => onNavigate(r.file_path)}
                >
                  <div className="search-result-directive">
                    <span className="search-result-name">{r.directive}</span>
                    {r.args && r.args.length > 0 && (
                      <span className="search-result-args">{r.args.join(' ')}</span>
                    )}
                    {r.line_number > 0 && (
                      <span className="search-result-line">line {r.line_number}</span>
                    )}
                  </div>
                  {r.context && (
                    <div className="search-result-context">{r.context}</div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
