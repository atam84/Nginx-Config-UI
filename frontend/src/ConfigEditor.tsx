import { useEffect, useState, useRef } from 'react'
import {
  fetchConfigFiles,
  fetchConfig,
  saveConfig,
  deleteConfig,
  createConfig,
  enableConfig,
  disableConfig,
  testConfig,
  downloadBackup,
  uploadBackup,
  reloadNginx,
  fetchConfigRoot,
  setConfigRoot,
  type ConfigFile,
  type ConfigFileInfo,
  type Node,
} from './api'
import { addServerToConfig, addUpstreamToConfig, serializeConfigToText } from './configUtils'
import GlobalSettingsTab from './GlobalSettingsTab'
import UpstreamsTab from './UpstreamsTab'
import DomainsServersTab from './DomainsServersTab'
import NewProxyWizard from './NewProxyWizard'
import DiffModal from './DiffModal'
import ErrorModal, { parseNginxError, type ErrorDetails } from './ErrorModal'
import './ConfigEditor.css'

type TabId = 'global' | 'upstreams' | 'proxy'

function findNode(nodes: Node[], name: string): Node | undefined {
  for (const n of nodes) {
    if (n.name === name) return n
  }
  return undefined
}

function findNodesInTree(nodes: Node[], name: string): Node[] {
  const out: Node[] = []
  function walk(n: Node) {
    if (n.name === name) out.push(n)
    for (const c of n.directives ?? []) walk(c)
  }
  for (const n of nodes) walk(n)
  return out
}

function serverUsesAnyUpstream(server: Node, upstreamNames: string[]): boolean {
  const locations = (server.directives ?? []).filter((d) => d.name === 'location')
  for (const loc of locations) {
    const proxyPass = (loc.directives ?? []).find((d) => d.name === 'proxy_pass')?.args?.[0] ?? ''
    const normalized = proxyPass.replace(/^https?:\/\//, '')
    if (upstreamNames.includes(normalized) || upstreamNames.includes(proxyPass)) return true
  }
  return false
}

interface ConfigEditorProps {
  readOnly?: boolean
}

export default function ConfigEditor({ readOnly = false }: ConfigEditorProps) {
  const [files, setFiles] = useState<ConfigFileInfo[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [config, setConfig] = useState<ConfigFile | null>(null)
  const [originalConfig, setOriginalConfig] = useState<ConfigFile | null>(null)
  const [tab, setTab] = useState<TabId>('upstreams')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ErrorDetails | string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [wizardDestination, setWizardDestination] = useState<string | undefined>(undefined)
  const [showDiff, setShowDiff] = useState(false)
  const [fileMenu, setFileMenu] = useState<{ file: string; status?: string; x: number; y: number } | null>(null)
  const [globalBusy, setGlobalBusy] = useState<string | null>(null)
  const [syntaxOk, setSyntaxOk] = useState<string | null>(null)
  const [configRoot, setConfigRootValue] = useState('')
  const [configRootInput, setConfigRootInput] = useState('')
  const backupInputRef = useRef<HTMLInputElement>(null)

  const refetchFiles = () => {
    fetchConfigFiles()
      .then((r) => {
        setFiles(r.files)
        if (r.files.length > 0 && !selectedFile) setSelectedFile(r.files[0].path)
      })
      .catch((e) =>
        setError({
          title: 'Failed to load files',
          message: e instanceof Error ? e.message : 'Failed to load files',
        })
      )
  }

  useEffect(() => {
    refetchFiles()
    fetchConfigRoot()
      .then((r) => {
        setConfigRootValue(r.config_root)
        setConfigRootInput(r.config_root)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedFile) return
    setLoading(true)
    fetchConfig(selectedFile)
      .then((c) => {
        setConfig(c)
        setOriginalConfig(c)
      })
      .catch((e) =>
        setError({
          title: 'Failed to load config',
          message: e instanceof Error ? e.message : 'Failed to load config',
        })
      )
      .finally(() => setLoading(false))
  }, [selectedFile])

  const globalDirectives = config?.directives?.filter((d) => d.type === 'directive') ?? []
  const workerProcesses = findNode(globalDirectives, 'worker_processes')
  const errorLog = findNode(globalDirectives, 'error_log')
  const pid = findNode(globalDirectives, 'pid')

  const httpBlock = config?.directives?.find((d) => d.name === 'http' && d.type === 'block')
  const upstreams = findNodesInTree(config?.directives ?? [], 'upstream')
  const servers = findNodesInTree(config?.directives ?? [], 'server')
  const upstreamNames = upstreams.map((u) => u.args?.[0]).filter(Boolean) as string[]
  const directProxyHosts = servers.filter((s) => !serverUsesAnyUpstream(s, upstreamNames))

  const updateConfig = (updater: (c: ConfigFile) => ConfigFile) => {
    if (config) setConfig(updater(config))
  }

  const doSave = async () => {
    if (!selectedFile || !config) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveConfig(selectedFile, config)
      if (res.success) {
        setOriginalConfig(config)
        setShowDiff(false)
      } else {
        setError({ title: 'Save failed', message: res.message ?? 'Save failed' })
      }
    } catch (e) {
      setError({
        title: 'Save failed',
        message: e instanceof Error ? e.message : 'Save failed',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => {
    if (!config || !originalConfig) return doSave()
    const origText = serializeConfigToText(originalConfig)
    const currText = serializeConfigToText(config)
    if (origText === currText) {
      return
    }
    setShowDiff(true)
  }

  const handleTestSyntax = async () => {
    if (!config) return
    setGlobalBusy('test')
    setError(null)
    try {
      const text = serializeConfigToText(config)
      const res = await testConfig(text)
      if (res.success) {
        setError(null)
        setSyntaxOk(res.output || 'Configuration file syntax is ok.')
        setTimeout(() => setSyntaxOk(null), 3000)
      } else {
        const output = res.output?.trim() || ''
        const parsed = parseNginxError(output)
        setError({
          title: 'nginx -t failed',
          message: output || 'Syntax error (no details returned — check that nginx is installed and NGINX_CONFIG_ROOT is correct)',
          lineNumber: parsed.lineNumber,
          filePath: parsed.filePath,
          sourceText: text,
        })
      }
    } catch (e) {
      setError({
        title: 'Test failed',
        message: e instanceof Error ? e.message : 'Test failed',
      })
    } finally {
      setGlobalBusy(null)
    }
  }

  const handleReload = async () => {
    setGlobalBusy('reload')
    setError(null)
    try {
      const res = await reloadNginx()
      if (!res.success)
        setError({ title: 'Reload failed', message: res.message ?? 'Reload failed' })
      else refetchFiles()
    } catch (e) {
      setError({
        title: 'Reload failed',
        message: e instanceof Error ? e.message : 'Reload failed',
      })
    } finally {
      setGlobalBusy(null)
    }
  }

  const handleDownloadBackup = async () => {
    setGlobalBusy('backup')
    try {
      const blob = await downloadBackup()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `nginx-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError({
        title: 'Backup failed',
        message: e instanceof Error ? e.message : 'Backup failed',
      })
    } finally {
      setGlobalBusy(null)
    }
  }

  const handleUploadBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setGlobalBusy('restore')
    setError(null)
    try {
      const res = await uploadBackup(file)
      if (res.success) {
        refetchFiles()
        if (selectedFile) {
          fetchConfig(selectedFile).then((c) => {
            setConfig(c)
            setOriginalConfig(c)
          })
        }
      } else {
        setError({ title: 'Restore failed', message: res.message ?? 'Restore failed' })
      }
    } catch (err) {
      setError({
        title: 'Restore failed',
        message: err instanceof Error ? err.message : 'Restore failed',
      })
    } finally {
      setGlobalBusy(null)
      e.target.value = ''
    }
  }

  const handleFileContextMenu = (e: React.MouseEvent, file: string, status?: string) => {
    e.preventDefault()
    setFileMenu({ file, status, x: e.clientX, y: e.clientY })
  }

  const isSitesAvailable = (path: string) => path.startsWith('sites-available/')

  const handleFileEnable = async () => {
    if (!fileMenu) return
    const f = fileMenu.file
    setFileMenu(null)
    try {
      const res = await enableConfig(f)
      if (res.success) refetchFiles()
      else setError({ title: 'Enable failed', message: res.message ?? 'Enable failed' })
    } catch (e) {
      setError({ title: 'Enable failed', message: e instanceof Error ? e.message : 'Enable failed' })
    }
  }

  const handleFileDisable = async () => {
    if (!fileMenu) return
    const f = fileMenu.file
    setFileMenu(null)
    try {
      const res = await disableConfig(f)
      if (res.success) refetchFiles()
      else setError({ title: 'Disable failed', message: res.message ?? 'Disable failed' })
    } catch (e) {
      setError({ title: 'Disable failed', message: e instanceof Error ? e.message : 'Disable failed' })
    }
  }

  const handleFileDuplicate = async () => {
    if (!fileMenu) return
    const baseName = fileMenu.file.split('/').pop()?.replace(/\.conf$/, '') ?? 'copy'
    const newName = `${baseName}-copy.conf`
    const targetDir = fileMenu.file.startsWith('sites-available/') ? 'sites-available' : 'conf.d'
    setFileMenu(null)
    try {
      const cfg = fileMenu.file === selectedFile ? config : await fetchConfig(fileMenu.file)
      if (!cfg) throw new Error('Could not load config')
      const res = await createConfig(newName, targetDir)
      if (res.success && res.path) {
        await saveConfig(res.path, cfg)
        refetchFiles()
        setSelectedFile(res.path)
      } else {
        setError({ title: 'Duplicate failed', message: res.message ?? 'Duplicate failed' })
      }
    } catch (e) {
      setError({
        title: 'Duplicate failed',
        message: e instanceof Error ? e.message : 'Duplicate failed',
      })
    }
  }

  const handleFileDelete = async () => {
    if (!fileMenu) return
    const f = fileMenu.file
    setFileMenu(null)
    if (!confirm(`Delete ${f}?`)) return
    try {
      const res = await deleteConfig(f)
      if (res.success) {
        refetchFiles()
        if (selectedFile === f) {
          setSelectedFile(null)
          setConfig(null)
        }
      } else {
        setError({ title: 'Delete failed', message: res.message ?? 'Delete failed' })
      }
    } catch (e) {
      setError({
        title: 'Delete failed',
        message: e instanceof Error ? e.message : 'Delete failed',
      })
    }
  }

  const handleAddProxyHost = (server: Node) => {
    if (!config) return
    setConfig(addServerToConfig(config, server))
    setTab('proxy')
  }

  const handleAddProxyHostWithUpstream = (server: Node, upstreamName: string, defaultAddr: string) => {
    if (!config) return
    const upstreamExists = upstreamNames.includes(upstreamName)
    let next = config
    if (!upstreamExists) {
      const newUpstream: Node = {
        type: 'block',
        name: 'upstream',
        args: [upstreamName],
        enabled: true,
        id: `upstream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        directives: [
          {
            type: 'directive',
            name: 'server',
            args: [defaultAddr],
            enabled: true,
            id: `server-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          },
        ],
      }
      next = addUpstreamToConfig(next, newUpstream)
    }
    next = addServerToConfig(next, server)
    setConfig(next)
    setTab('proxy')
  }

  const handleConfigRootApply = async () => {
    const next = configRootInput.trim()
    if (!next) return
    const res = await setConfigRoot(next)
    if (!res.success) {
      setError({ title: 'Config root update failed', message: res.message ?? 'Failed to update config root' })
      return
    }
    setConfigRootValue(res.config_root ?? next)
    setSelectedFile(null)
    setConfig(null)
    setOriginalConfig(null)
    refetchFiles()
  }

  return (
    <div className="config-editor">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>Config Files</div>
          <div className="config-root-box">
            <label>Config root</label>
            <input
              type="text"
              value={configRootInput}
              onChange={(e) => setConfigRootInput(e.target.value)}
              placeholder="/etc/nginx"
            />
            <button type="button" onClick={handleConfigRootApply} disabled={configRootInput.trim() === ''}>
              Apply
            </button>
            {configRoot && <div className="config-root-current">Current: {configRoot}</div>}
          </div>
        </div>
        {loading && files.length === 0 ? (
          <div className="sidebar-loading">Loading…</div>
        ) : (
              <ul className="file-list">
            {files.map((f) => (
              <li
                key={f.path}
                className={selectedFile === f.path ? 'selected' : ''}
                onClick={() => setSelectedFile(f.path)}
                onContextMenu={readOnly ? undefined : (e) => handleFileContextMenu(e, f.path, f.status)}
              >
                <span className="file-path">{f.path}</span>
                {f.status === 'disabled' && <span className="file-status disabled">disabled</span>}
                {f.status === 'enabled' && isSitesAvailable(f.path) && (
                  <span className="file-status enabled">on</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
      {fileMenu && (
        <>
          <div className="context-menu-backdrop" onClick={() => setFileMenu(null)} />
          <div
            className="file-context-menu"
            style={{ left: fileMenu.x, top: fileMenu.y }}
          >
            {isSitesAvailable(fileMenu.file) && (
              <>
                {fileMenu.status === 'disabled' && (
                  <button type="button" onClick={handleFileEnable}>
                    Enable
                  </button>
                )}
                {fileMenu.status === 'enabled' && (
                  <button type="button" onClick={handleFileDisable}>
                    Disable
                  </button>
                )}
              </>
            )}
            <button type="button" onClick={handleFileDuplicate}>
              Duplicate
            </button>
            <button type="button" onClick={handleFileDelete} className="danger">
              Delete
            </button>
          </div>
        </>
      )}

      <main className="editor-main">
        {syntaxOk && <div className="success-banner">{syntaxOk}</div>}

        {/* Global bar: Reload, Test Syntax, Upload Backup */}
        <div className="global-bar">
          <button
            type="button"
            className="btn-global"
            onClick={handleReload}
            disabled={!!globalBusy}
            title="Reload Nginx"
          >
            {globalBusy === 'reload' ? 'Reloading…' : 'Reload'}
          </button>
          <button
            type="button"
            className="btn-global"
            onClick={handleTestSyntax}
            disabled={!!globalBusy || !config}
            title="Test config syntax (nginx -t)"
          >
            {globalBusy === 'test' ? 'Testing…' : 'Test Syntax'}
          </button>
          <button
            type="button"
            className="btn-global"
            onClick={handleDownloadBackup}
            disabled={!!globalBusy}
            title="Download backup"
          >
            {globalBusy === 'backup' ? '…' : 'Backup'}
          </button>
          <button
            type="button"
            className="btn-global"
            onClick={() => backupInputRef.current?.click()}
            disabled={!!globalBusy}
            title="Upload and restore backup"
          >
            {globalBusy === 'restore' ? 'Restoring…' : 'Restore'}
          </button>
          <input
            ref={backupInputRef}
            type="file"
            accept=".tar.gz"
            className="hidden-file-input"
            onChange={handleUploadBackup}
          />
        </div>

        {selectedFile && config && (
          <>
            <div className="editor-header">
              <div className="editor-header-top">
                <h2>{selectedFile}</h2>
                <div className="header-actions">
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        className="btn-new-proxy"
                        onClick={() => {
                          setWizardDestination('')
                          setShowWizard(true)
                        }}
                      >
                        + New Proxy Host
                      </button>
                      <button
                        className="btn-save"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </>
                  )}
                  {readOnly && (
                    <span className="readonly-badge">Read-only</span>
                  )}
                </div>
              </div>
              <div className="tabs">
                <button
                  className={tab === 'global' ? 'active' : ''}
                  onClick={() => setTab('global')}
                >
                  Global Settings
                </button>
                <button
                  className={tab === 'upstreams' ? 'active' : ''}
                  onClick={() => setTab('upstreams')}
                >
                  Upstreams / Backend Pools ({upstreams.length})
                </button>
                <button
                  className={tab === 'proxy' ? 'active' : ''}
                  onClick={() => setTab('proxy')}
                >
                  Proxy Hosts / Direct Targets ({directProxyHosts.length})
                </button>
              </div>
            </div>

            <div className="tab-content">
              {tab === 'global' && (
                <GlobalSettingsTab
                  workerProcesses={workerProcesses}
                  errorLog={errorLog}
                  pid={pid}
                  directives={config.directives}
                  onUpdate={updateConfig}
                  readOnly={readOnly}
                />
              )}
              {tab === 'upstreams' && (
                <UpstreamsTab
                  upstreams={upstreams}
                  servers={servers}
                  config={config}
                  onUpdate={updateConfig}
                  onAddProxyHost={
                    readOnly
                      ? undefined
                      : (upstreamName?: string) => {
                          setWizardDestination(upstreamName ?? '')
                          setShowWizard(true)
                        }
                  }
                  readOnly={readOnly}
                />
              )}
              {tab === 'proxy' && (
                <DomainsServersTab
                  servers={servers}
                  upstreams={upstreams}
                  httpBlock={httpBlock}
                  config={config}
                  mode="without_upstream"
                  onUpdate={updateConfig}
                  readOnly={readOnly}
                />
              )}
            </div>
          </>
        )}

        {selectedFile && !config && !loading && (
          <div className="empty-state">No config loaded</div>
        )}

        {!selectedFile && files.length === 0 && !loading && (
          <div className="empty-state">No config files found</div>
        )}
      </main>

      {!readOnly && showWizard && config && (
        <NewProxyWizard
          config={config}
          upstreamNames={upstreamNames}
          initialDestination={wizardDestination}
          onAdd={handleAddProxyHost}
          onAddWithUpstream={handleAddProxyHostWithUpstream}
          onClose={() => setShowWizard(false)}
        />
      )}

      {!readOnly && showDiff && config && originalConfig && (
        <DiffModal
          original={originalConfig}
          proposed={config}
          onConfirm={doSave}
          onCancel={() => setShowDiff(false)}
        />
      )}

      {error && (
        <ErrorModal error={error} onDismiss={() => setError(null)} />
      )}
    </div>
  )
}
