import { useEffect, useState } from 'react'
import { fetchStats, fetchSystemStatus, reloadNginx, type Stats, type SystemStatus } from './api'
import ErrorModal from './ErrorModal'
import './Dashboard.css'

function StatCard({ title, value, subtitle }: { title: string; value: React.ReactNode; subtitle?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-title">{title}</div>
      <div className="stat-value">{value}</div>
      {subtitle && <div className="stat-subtitle">{subtitle}</div>}
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, st] = await Promise.all([fetchStats(), fetchSystemStatus()])
      setStats(s)
      setStatus(st)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  const handleReload = async () => {
    setReloading(true)
    try {
      const res = await reloadNginx()
      await load()
      if (!res.success) {
        setError(res.message)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reload failed')
    } finally {
      setReloading(false)
    }
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return '—'
    try {
      const d = new Date(iso)
      return d.toLocaleString()
    } catch {
      return iso
    }
  }

  if (loading && !stats) {
    return (
      <div className="dashboard">
        <header className="header">
          <h1>Dashboard</h1>
        </header>
        <div className="loading">Loading…</div>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <header className="header">
        <h1>Dashboard</h1>
        <button className="btn-reload" onClick={handleReload} disabled={reloading}>
          {reloading ? 'Reloading…' : 'Reload Nginx'}
        </button>
      </header>

      {error && (
        <ErrorModal
          error={{ title: 'Error', message: error }}
          onDismiss={() => setError(null)}
        />
      )}

      <div className="widgets">
        <StatCard
          title="Active Server Blocks"
          value={stats?.server_blocks ?? '—'}
          subtitle={`${stats?.config_files ?? 0} config files`}
        />
        <StatCard
          title="Nginx Status"
          value={
            <span className={status?.active ? 'status-active' : 'status-inactive'}>
              {status?.active ? 'Running' : status?.status || 'Stopped'}
            </span>
          }
        />
        <StatCard
          title="Last Reload"
          value={formatTime(status?.last_reload_at ?? null)}
          subtitle={status?.last_error ? `Error: ${status.last_error}` : undefined}
        />
      </div>

      {stats && (
        <div className="stats-row">
          <div className="stat-extra">Upstreams: {stats.upstreams}</div>
        </div>
      )}
    </div>
  )
}
