import { useState, useEffect } from 'react'
import Dashboard from './Dashboard'
import ConfigEditor from './ConfigEditor'
import Login from './Login'
import { AUTH_REQUIRED_EVENT } from './api'
import './App.css'

function getReadOnlyFromUrl(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('readonly') === '1' || params.get('readonly') === 'true'
}

export default function App() {
  const [view, setView] = useState<'dashboard' | 'config'>('dashboard')
  const [readOnly, setReadOnly] = useState(getReadOnlyFromUrl)
  const [needsLogin, setNeedsLogin] = useState(false)

  useEffect(() => {
    const onAuthRequired = () => setNeedsLogin(true)
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
  }, [])

  useEffect(() => {
    const onPopState = () => setReadOnly(getReadOnlyFromUrl())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  if (needsLogin) {
    return <Login onSuccess={() => setNeedsLogin(false)} />
  }

  return (
    <div className="app">
      <nav className="app-nav">
        <h1 className="app-title" onClick={() => setView('dashboard')}>
          Nginx Config Manager
        </h1>
        <div className="app-nav-links">
          <button
            className={view === 'dashboard' ? 'active' : ''}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={view === 'config' ? 'active' : ''}
            onClick={() => setView('config')}
          >
            Config Editor
          </button>
          <label className="app-readonly-toggle">
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(e) => setReadOnly(e.target.checked)}
            />
            Read-only
          </label>
        </div>
      </nav>
      {view === 'dashboard' && <Dashboard />}
      {view === 'config' && <ConfigEditor readOnly={readOnly} />}
    </div>
  )
}
