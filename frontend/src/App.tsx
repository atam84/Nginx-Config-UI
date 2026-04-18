import { useState, useEffect } from 'react'
import Dashboard from './Dashboard'
import ConfigEditor from './ConfigEditor'
import Login from './Login'
import InfoModal from './InfoModal'
import { AUTH_REQUIRED_EVENT } from './api'
import './App.css'

type Theme = 'dark' | 'light'
const THEME_KEY = 'nginx-ui-theme'

function getReadOnlyFromUrl(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('readonly') === '1' || params.get('readonly') === 'true'
}

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
  return prefersLight ? 'light' : 'dark'
}

export default function App() {
  const [view, setView] = useState<'dashboard' | 'config'>('dashboard')
  const [readOnly, setReadOnly] = useState(getReadOnlyFromUrl)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [showAbout, setShowAbout] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { window.localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
  }, [theme])

  if (needsLogin) {
    return <Login onSuccess={() => setNeedsLogin(false)} />
  }

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

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
          <button onClick={() => setShowAbout(true)} title="About this app">
            About
          </button>
          <button onClick={() => setShowHelp(true)} title="Help & nginx compatibility">
            Help
          </button>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? '☀' : '☾'}
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

      {showAbout && (
        <InfoModal title="About Nginx Config Manager" onClose={() => setShowAbout(false)}>
          <p>
            A web-based tool to visually configure, back up, and control Nginx —
            parse existing configs, edit them through structured panels, validate
            with <code>nginx -t</code>, and reload safely.
          </p>
          <h4>Stack</h4>
          <ul>
            <li>Backend: Go (Gin) — parser, serializer, systemctl + nginx -t integration</li>
            <li>Frontend: React + Vite + TypeScript</li>
          </ul>
          <h4>What it covers</h4>
          <ul>
            <li>Global / HTTP / Server / Location / Upstream editing</li>
            <li>Stream (TCP/UDP) and Mail servers</li>
            <li>Topology view, search across all config files, history &amp; diff</li>
            <li>SSL / Let's Encrypt, backup &amp; restore, raw editor fallback</li>
          </ul>
          <h4>Links</h4>
          <ul>
            <li>
              Nginx directive reference:{' '}
              <a href="https://nginx.org/en/docs/dirindex.html" target="_blank" rel="noreferrer">
                nginx.org/en/docs/dirindex.html
              </a>
            </li>
          </ul>
        </InfoModal>
      )}

      {showHelp && (
        <InfoModal title="Help & Nginx Compatibility" onClose={() => setShowHelp(false)}>
          <h4>Getting started</h4>
          <ul>
            <li><b>Local</b> — browse files under <code>NGINX_CONFIG_ROOT</code> (default <code>/etc/nginx</code>).</li>
            <li><b>Open File</b> — load any absolute path, or upload/fetch a file not on the server.</li>
            <li><b>New Config</b> — start from a blank, HTTP, or reverse-proxy template.</li>
            <li>Right-click a file in the sidebar to enable/disable, duplicate, or delete.</li>
          </ul>

          <h4>Keyboard shortcuts</h4>
          <ul>
            <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> — Undo (up to 50 steps)</li>
            <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> — Redo</li>
            <li><kbd>Esc</kbd> — Close modals</li>
          </ul>

          <h4>Save workflow</h4>
          <p>
            Save shows a diff before writing. On Local files, the server runs
            <code> nginx -t</code> and rejects saves that break syntax. The
            <b> Test Syntax</b> and <b>Reload</b> buttons in the top bar work the same
            way as running <code>nginx -t</code> / <code>nginx -s reload</code> on the host.
          </p>

          <h4>Nginx version compatibility</h4>
          <p>
            The parser handles standard nginx syntax — directives, blocks, <code>if</code>,
            comments, and <code>include</code>. It isn't tied to a specific nginx build, so
            anything that conforms to the grammar will round-trip.
          </p>
          <table className="compat-table">
            <thead>
              <tr>
                <th>Nginx release</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1.18 (stable, legacy)</td>
                <td><span className="compat-badge ok">Supported</span></td>
                <td>Core directives + common modules.</td>
              </tr>
              <tr>
                <td>1.24 (stable)</td>
                <td><span className="compat-badge ok">Supported</span></td>
                <td>Recommended target for production.</td>
              </tr>
              <tr>
                <td>1.26 (stable)</td>
                <td><span className="compat-badge ok">Supported</span></td>
                <td>Tested against default Debian/Ubuntu builds.</td>
              </tr>
              <tr>
                <td>1.27.x (mainline)</td>
                <td><span className="compat-badge ok">Supported</span></td>
                <td>HTTP/3, QUIC directives parsed as raw when unknown.</td>
              </tr>
              <tr>
                <td>OpenResty / Tengine forks</td>
                <td><span className="compat-badge partial">Partial</span></td>
                <td>Custom directives (e.g. Lua) are preserved via the Raw editor but not modelled in structured tabs.</td>
              </tr>
              <tr>
                <td>nginx &lt; 1.18</td>
                <td><span className="compat-badge unknown">Untested</span></td>
                <td>Should parse; some modern directives in templates may be rejected by older builds.</td>
              </tr>
            </tbody>
          </table>
          <p style={{ marginTop: '0.75rem' }}>
            Unknown directives are preserved verbatim and reachable via the <b>Raw</b> tab, so
            third-party modules won't be lost on save.
          </p>
        </InfoModal>
      )}
    </div>
  )
}
