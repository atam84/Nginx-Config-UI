import { fetchWithAuth, clearToken } from './auth'

const API_BASE = ''

export const AUTH_REQUIRED_EVENT = 'auth-required'

async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetchWithAuth(url, opts)
  if (res.status === 401) {
    clearToken()
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT))
  }
  return res
}

export interface Node {
  id?: string
  type: string
  name: string
  args: string[]
  comment?: string
  line_number?: number
  enabled: boolean
  directives?: Node[]
}

export interface ConfigFile {
  file_path: string
  status: string
  directives: Node[]
}

export interface Stats {
  server_blocks: number
  upstreams: number
  config_files: number
}

export interface SystemStatus {
  active: boolean
  status: string
  last_reload_at: string | null
  last_error: string
}

export async function fetchStats(): Promise<Stats> {
  const res = await apiFetch(`${API_BASE}/api/stats`)
  if (!res.ok) throw new Error('Failed to fetch stats')
  return res.json()
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await apiFetch(`${API_BASE}/api/system/status`)
  if (!res.ok) throw new Error('Failed to fetch status')
  return res.json()
}

export async function reloadNginx(): Promise<{ success: boolean; message: string }> {
  const res = await apiFetch(`${API_BASE}/api/system/reload`, { method: 'POST' })
  const data = await res.json()
  return data
}

export interface ConfigFileInfo {
  path: string
  status: 'enabled' | 'disabled'
}

export interface ConfigRootInfo {
  config_root: string
}

export async function fetchConfigFiles(): Promise<{ files: ConfigFileInfo[] }> {
  const res = await apiFetch(`${API_BASE}/api/config`)
  if (!res.ok) throw new Error('Failed to fetch config files')
  return res.json()
}

export async function enableConfig(path: string): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/config/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  const data = await res.json()
  return { ...data, success: res.ok }
}

export async function disableConfig(path: string): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/config/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  const data = await res.json()
  return { ...data, success: res.ok }
}

export async function fetchConfig(path: string): Promise<ConfigFile> {
  const res = await apiFetch(`${API_BASE}/api/config/${path}`)
  if (!res.ok) throw new Error('Failed to fetch config')
  return res.json()
}

export async function saveConfig(path: string, cfg: ConfigFile): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/config/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  const data = await res.json()
  return { ...data, message: data.message ?? data.error ?? data.output, success: res.ok }
}

export async function deleteConfig(path: string): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/config/${path}`, { method: 'DELETE' })
  const data = await res.json()
  return { ...data, success: res.ok }
}

export async function createConfig(
  filename: string,
  targetDir?: 'conf.d' | 'sites-available'
): Promise<{ success: boolean; path?: string; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/config/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, target_dir: targetDir ?? 'conf.d' }),
  })
  const data = await res.json()
  return { ...data, success: res.ok }
}

export async function testConfig(content: string): Promise<{ success: boolean; output: string }> {
  const res = await apiFetch(`${API_BASE}/api/config/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: content,
  })
  const text = await res.text()
  let data: { success?: boolean; output?: string; error?: string }
  try {
    data = JSON.parse(text)
  } catch {
    return { success: false, output: text || `Request failed (${res.status})` }
  }
  const output = typeof data.output === 'string' ? data.output : (data.error ?? '')
  return { success: data.success === true, output }
}

export async function serializeConfig(cfg: ConfigFile): Promise<string> {
  const res = await apiFetch(`${API_BASE}/api/config/serialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!res.ok) throw new Error('Serialize failed')
  return res.text()
}

export async function downloadBackup(): Promise<Blob> {
  const res = await apiFetch(`${API_BASE}/api/backup`)
  if (!res.ok) throw new Error('Backup failed')
  return res.blob()
}

export async function uploadBackup(file: File): Promise<{ success: boolean; message?: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiFetch(`${API_BASE}/api/restore`, {
    method: 'POST',
    body: form,
  })
  const data = await res.json()
  return { ...data, success: res.ok }
}

export async function fetchConfigRoot(): Promise<ConfigRootInfo> {
  const res = await apiFetch(`${API_BASE}/api/config-root`)
  if (!res.ok) throw new Error('Failed to fetch config root')
  return res.json()
}

export async function setConfigRoot(configRoot: string): Promise<{ success: boolean; config_root?: string; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/config-root`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config_root: configRoot }),
  })
  const data = await res.json()
  return { ...data, success: res.ok }
}
