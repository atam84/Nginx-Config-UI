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
  blank_lines_before?: number
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
  const res = await apiFetch(`${API_BASE}/api/config-file?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error('Failed to fetch config')
  return res.json()
}

export async function saveConfig(path: string, cfg: ConfigFile): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/config-file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  const data = await res.json()
  return { ...data, message: data.message ?? data.error ?? data.output, success: res.ok }
}

export async function deleteConfig(path: string): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/config-file?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
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

export async function openFileByPath(path: string): Promise<ConfigFile> {
  const res = await apiFetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Failed to open file')
  }
  return res.json()
}

export async function saveFileByPath(path: string, cfg: ConfigFile): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
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

export async function createStreamServer(req: {
  file_path: string
  listen: string
  udp: boolean
  ssl: boolean
  proxy_pass: string
  proxy_timeout?: string
  proxy_connect_timeout?: string
  proxy_buffer_size?: string
  ssl_preread?: boolean
}): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/stream/server`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? 'Failed to create stream server')
  }
}

export async function createStreamUpstream(req: {
  file_path: string
  name: string
  servers: string[]
}): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/stream/upstream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? 'Failed to create stream upstream')
  }
}

export async function fetchStreamServers(filename: string): Promise<{ servers: Node[]; upstreams: Node[] }> {
  const res = await apiFetch(`${API_BASE}/api/stream/servers?file=${encodeURIComponent(filename)}`)
  if (!res.ok) throw new Error('Failed to fetch stream servers')
  return res.json()
}

// ─── History API ─────────────────────────────────────────────────────────────

export async function fetchConfigHistory(path: string): Promise<{ ts: number; size: number }[]> {
  const res = await apiFetch(`${API_BASE}/api/config/history?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error('Failed to fetch history')
  return res.json()
}

export async function fetchConfigVersion(path: string, ts: number): Promise<string> {
  const res = await apiFetch(`${API_BASE}/api/config/version?path=${encodeURIComponent(path)}&ts=${ts}`)
  if (!res.ok) throw new Error('Failed to fetch version')
  return res.text()
}

export async function restoreConfigVersion(path: string, ts: number): Promise<{ success: boolean; message?: string }> {
  const res = await apiFetch(`${API_BASE}/api/config/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, ts }),
  })
  const data = await res.json()
  return { ...data, success: res.ok }
}

// ─── Search API ───────────────────────────────────────────────────────────────

export interface SearchResult {
  file_path: string
  node_id: string
  directive: string
  args: string[]
  line_number: number
  context: string
}

export async function searchConfigs(q: string): Promise<{ results: SearchResult[] }> {
  const res = await apiFetch(`${API_BASE}/api/config/search?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error('Failed to search')
  return res.json()
}

// ─── Include Navigation API ───────────────────────────────────────────────────

export async function resolveInclude(glob: string): Promise<{ files: string[] }> {
  const res = await apiFetch(`${API_BASE}/api/config/resolve-include?glob=${encodeURIComponent(glob)}`)
  if (!res.ok) throw new Error('Failed to resolve include')
  return res.json()
}

// ─── SSL / Let's Encrypt API ──────────────────────────────────────────────────

export interface CertInfo {
  name: string
  domains: string[]
  cert_path: string
  key_path: string
  expires_at?: string
  days_left: number
  status: 'valid' | 'expiring_soon' | 'expired' | 'unknown'
}

export async function fetchSSLCertificates(): Promise<{ certificates: CertInfo[] }> {
  const res = await apiFetch(`${API_BASE}/api/ssl/certificates`)
  if (!res.ok) throw new Error('Failed to fetch certificates')
  return res.json()
}

export async function requestSSLCertificate(
  domains: string[],
  email: string,
  webroot?: string
): Promise<{ success: boolean; output: string; certificate?: CertInfo }> {
  const res = await apiFetch(`${API_BASE}/api/ssl/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domains, email, webroot: webroot ?? '' }),
  })
  const data = await res.json()
  return { ...data, success: res.ok }
}

export async function renewSSLCertificate(
  certName: string
): Promise<{ success: boolean; output: string }> {
  const res = await apiFetch(`${API_BASE}/api/ssl/renew`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cert_name: certName }),
  })
  const data = await res.json()
  return { ...data, success: res.ok }
}

// ─── Parse from text API ──────────────────────────────────────────────────────

// ─── Multi-file Atomic Save ───────────────────────────────────────────────────

export interface SaveAllFileEntry {
  path: string
  config: ConfigFile
}

export interface SaveAllError {
  path: string
  error: string
  output?: string
}

export async function saveAllConfigs(
  files: SaveAllFileEntry[]
): Promise<{ success: boolean; errors?: SaveAllError[] }> {
  const res = await apiFetch(`${API_BASE}/api/config/save-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  })
  const data = await res.json()
  return { success: res.ok && !data.errors?.length, errors: data.errors }
}

export async function formatConfig(cfg: ConfigFile): Promise<ConfigFile> {
  const res = await apiFetch(`${API_BASE}/api/config/format`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
  if (!res.ok) throw new Error('Format failed')
  return res.json()
}

export async function parseConfigFromText(text: string): Promise<ConfigFile> {
  const res = await apiFetch(`${API_BASE}/api/config/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Failed to parse config')
  }
  return res.json()
}

// ── §53 — Topology aggregation (Published Endpoints / Outbound Dependencies) ──

export interface PublishedEndpoint {
  server_name: string
  all_names: string[]
  port: string
  address: string
  path: string
  ssl: boolean
  http2: boolean
  http3: boolean
  backend: string
  backend_kind: string
  return_code?: string
  enabled: boolean
  file_path: string
  line_number: number
}

export interface OutboundDependency {
  kind: string
  target: string
  target_kind: string
  host: string
  port: string
  upstream_name?: string
  uses_dns: boolean
  uses_tls: boolean
  resolver_in_scope: boolean
  resolver_missing: boolean
  server_name: string
  path: string
  file_path: string
  line_number: number
}

export interface TopologyEndpointsResponse {
  endpoints: PublishedEndpoint[]
  warnings: string[]
}

export interface TopologyOutboundResponse {
  outbound: OutboundDependency[]
  upstreams: Record<string, string[]>
  warnings: string[]
}

export async function fetchPublishedEndpoints(): Promise<TopologyEndpointsResponse> {
  const res = await apiFetch(`${API_BASE}/api/topology/endpoints`)
  if (!res.ok) throw new Error('Failed to fetch published endpoints')
  return res.json()
}

export async function fetchOutboundDependencies(): Promise<TopologyOutboundResponse> {
  const res = await apiFetch(`${API_BASE}/api/topology/outbound`)
  if (!res.ok) throw new Error('Failed to fetch outbound dependencies')
  return res.json()
}
