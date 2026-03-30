import { useEffect, useState, useRef, useCallback } from 'react'
import {
  fetchConfigFiles,
  fetchConfig,
  saveConfig,
  saveAllConfigs,
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
  openFileByPath,
  saveFileByPath,
  formatConfig,
  type ConfigFile,
  type ConfigFileInfo,
  type Node,
} from './api'
import { addServerToConfig, addUpstreamToConfig, serializeConfigToText } from './configUtils'
import GlobalSettingsTab from './GlobalSettingsTab'
import HttpSettingsTab from './HttpSettingsTab'
import UpstreamsTab from './UpstreamsTab'
import DomainsServersTab from './DomainsServersTab'
import StreamTab from './StreamTab'
import MailTab from './MailTab'
import TopologyTab from './TopologyTab'
import RawEditorTab from './RawEditorTab'
import HistoryModal from './HistoryModal'
import SearchPanel from './SearchPanel'
import NewProxyWizard from './NewProxyWizard'
import DiffModal from './DiffModal'
import ErrorModal, { parseNginxError, type ErrorDetails } from './ErrorModal'
import './ConfigEditor.css'

type TabId = 'global' | 'http' | 'upstreams' | 'proxy' | 'stream' | 'mail' | 'topology' | 'raw'
type SourceMode = 'local' | 'file' | 'new'

let _nidSeq = 0
function nid(): string { return `fe-${Date.now()}-${++_nidSeq}` }

function makeConfigTemplate(kind: 'blank' | 'http' | 'proxy'): ConfigFile {
  if (kind === 'blank') return { file_path: '', status: 'enabled', directives: [] }
  const events: Node = {
    id: nid(), type: 'block', name: 'events', args: [], enabled: true,
    directives: [{ id: nid(), type: 'directive', name: 'worker_connections', args: ['1024'], enabled: true }],
  }
  if (kind === 'http') {
    return {
      file_path: '', status: 'enabled',
      directives: [
        { id: nid(), type: 'directive', name: 'worker_processes', args: ['auto'], enabled: true },
        events,
        {
          id: nid(), type: 'block', name: 'http', args: [], enabled: true,
          directives: [
            { id: nid(), type: 'directive', name: 'include', args: ['mime.types'], enabled: true },
            { id: nid(), type: 'directive', name: 'default_type', args: ['application/octet-stream'], enabled: true },
            { id: nid(), type: 'directive', name: 'sendfile', args: ['on'], enabled: true },
            { id: nid(), type: 'directive', name: 'keepalive_timeout', args: ['65'], enabled: true },
            {
              id: nid(), type: 'block', name: 'server', args: [], enabled: true,
              directives: [
                { id: nid(), type: 'directive', name: 'listen', args: ['80'], enabled: true },
                { id: nid(), type: 'directive', name: 'server_name', args: ['_'], enabled: true },
                {
                  id: nid(), type: 'block', name: 'location', args: ['/'], enabled: true,
                  directives: [{ id: nid(), type: 'directive', name: 'return', args: ['404'], enabled: true }],
                },
              ],
            },
          ],
        },
      ],
    }
  }
  // proxy template
  return {
    file_path: '', status: 'enabled',
    directives: [
      { id: nid(), type: 'directive', name: 'worker_processes', args: ['auto'], enabled: true },
      events,
      {
        id: nid(), type: 'block', name: 'http', args: [], enabled: true,
        directives: [
          { id: nid(), type: 'directive', name: 'include', args: ['mime.types'], enabled: true },
          { id: nid(), type: 'directive', name: 'default_type', args: ['application/octet-stream'], enabled: true },
          { id: nid(), type: 'directive', name: 'sendfile', args: ['on'], enabled: true },
          {
            id: nid(), type: 'block', name: 'upstream', args: ['backend'], enabled: true,
            directives: [{ id: nid(), type: 'directive', name: 'server', args: ['127.0.0.1:3000'], enabled: true }],
          },
          {
            id: nid(), type: 'block', name: 'server', args: [], enabled: true,
            directives: [
              { id: nid(), type: 'directive', name: 'listen', args: ['80'], enabled: true },
              { id: nid(), type: 'directive', name: 'server_name', args: ['example.com'], enabled: true },
              {
                id: nid(), type: 'block', name: 'location', args: ['/'], enabled: true,
                directives: [
                  { id: nid(), type: 'directive', name: 'proxy_pass', args: ['http://backend'], enabled: true },
                  { id: nid(), type: 'directive', name: 'proxy_set_header', args: ['Host', '$host'], enabled: true },
                  { id: nid(), type: 'directive', name: 'proxy_set_header', args: ['X-Real-IP', '$remote_addr'], enabled: true },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

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
  // Multi-file dirty tracking: keyed by file path, stores unsaved config
  const pendingConfigsRef = useRef<Map<string, ConfigFile>>(new Map())
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set())
  // Undo / Redo stacks (max 50 snapshots each)
  const [undoStack, setUndoStack] = useState<ConfigFile[]>([])
  const [redoStack, setRedoStack] = useState<ConfigFile[]>([])
  const handleUndoRef = useRef<() => void>(() => {})
  const handleRedoRef = useRef<() => void>(() => {})
  // History and Search
  const [showHistory, setShowHistory] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  // Source mode
  const [sourceMode, setSourceMode] = useState<SourceMode>('local')
  const [openFilePath, setOpenFilePath] = useState('')
  const [openFileInput, setOpenFileInput] = useState('')
  // Save As dialog
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [saveAsMode, setSaveAsMode] = useState<'local' | 'path'>('path')
  const [saveAsFilename, setSaveAsFilename] = useState('')
  const [saveAsTargetDir, setSaveAsTargetDir] = useState<'conf.d' | 'sites-available'>('conf.d')
  const [saveAsCustomPath, setSaveAsCustomPath] = useState('')

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

  const clearHistory = () => { setUndoStack([]); setRedoStack([]) }

  useEffect(() => {
    if (!selectedFile) return
    // If we have unsaved changes for this file, restore them without hitting the server
    const pending = pendingConfigsRef.current.get(selectedFile)
    if (pending) {
      setConfig(pending)
      clearHistory()
      setLoading(false)
      return
    }
    setLoading(true)
    fetchConfig(selectedFile)
      .then((c) => {
        setConfig(c)
        setOriginalConfig(c)
        clearHistory()
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
  const streamBlock = config?.directives?.find((d) => d.name === 'stream' && d.type === 'block')
  const streamServers = streamBlock?.directives?.filter((d) => d.name === 'server') ?? []
  const mailBlock = config?.directives?.find((d) => d.name === 'mail' && d.type === 'block')
  const mailServers = mailBlock?.directives?.filter((d) => d.name === 'server') ?? []
  const upstreams = findNodesInTree(config?.directives ?? [], 'upstream')
  const servers = findNodesInTree(config?.directives ?? [], 'server')
  const upstreamNames = upstreams.map((u) => u.args?.[0]).filter(Boolean) as string[]
  const directProxyHosts = servers.filter((s) => !serverUsesAnyUpstream(s, upstreamNames))

  const markDirty = useCallback((path: string, cfg: ConfigFile) => {
    pendingConfigsRef.current.set(path, cfg)
    setDirtyFiles(new Set(pendingConfigsRef.current.keys()))
  }, [])

  const markClean = useCallback((path: string) => {
    pendingConfigsRef.current.delete(path)
    setDirtyFiles(new Set(pendingConfigsRef.current.keys()))
  }, [])

  const updateConfig = (updater: (c: ConfigFile) => ConfigFile) => {
    if (!config) return
    setUndoStack((prev) => [...prev.slice(-49), config])
    setRedoStack([])
    const next = updater(config)
    setConfig(next)
    const key = selectedFile || openFilePath
    if (key) markDirty(key, next)
  }

  const handleUndo = () => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev
      const snapshot = prev[prev.length - 1]
      setConfig((cur) => { if (cur) setRedoStack((r) => [...r.slice(-49), cur]); return snapshot })
      return prev.slice(0, -1)
    })
  }

  const handleRedo = () => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev
      const snapshot = prev[prev.length - 1]
      setConfig((cur) => { if (cur) setUndoStack((u) => [...u.slice(-49), cur]); return snapshot })
      return prev.slice(0, -1)
    })
  }

  handleUndoRef.current = handleUndo
  handleRedoRef.current = handleRedo

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndoRef.current() }
      if (e.key === 'z' && e.shiftKey)  { e.preventDefault(); handleRedoRef.current() }
      if (e.key === 'y')                  { e.preventDefault(); handleRedoRef.current() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const doSave = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      let res: { success: boolean; message?: string }
      if (openFilePath) {
        res = await saveFileByPath(openFilePath, config)
      } else if (selectedFile) {
        res = await saveConfig(selectedFile, config)
      } else {
        res = { success: false, message: 'No save path set' }
      }
      if (res.success) {
        setOriginalConfig(config)
        setShowDiff(false)
        const key = openFilePath || selectedFile
        if (key) markClean(key)
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
    if (!config) return
    if (!selectedFile && !openFilePath) {
      setShowSaveAs(true)
      return
    }
    if (!originalConfig) return doSave()
    const origText = serializeConfigToText(originalConfig)
    const currText = serializeConfigToText(config)
    if (origText === currText) return
    setShowDiff(true)
  }

  const handleOpenFile = async () => {
    const path = openFileInput.trim()
    if (!path) return
    setLoading(true)
    setError(null)
    try {
      const c = await openFileByPath(path)
      setConfig(c)
      setOriginalConfig(c)
      setOpenFilePath(path)
      setSelectedFile(null)
      clearHistory()
    } catch (e) {
      setError({ title: 'Open failed', message: e instanceof Error ? e.message : 'Failed to open file' })
    } finally {
      setLoading(false)
    }
  }

  const handleNewConfig = (kind: 'blank' | 'http' | 'proxy') => {
    const c = makeConfigTemplate(kind)
    setConfig(c)
    setOriginalConfig(c)
    setSelectedFile(null)
    setOpenFilePath('')
    clearHistory()
  }

  const handleDownloadConfig = () => {
    if (!config) return
    const text = serializeConfigToText(config)
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const raw = openFilePath || selectedFile || 'nginx.conf'
    a.download = raw.split('/').pop() ?? 'nginx.conf'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const handleSaveAs = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      if (saveAsMode === 'local') {
        const filename = saveAsFilename.trim() || 'new-config.conf'
        const created = await createConfig(filename, saveAsTargetDir)
        if (!created.success || !created.path) {
          setError({ title: 'Save As failed', message: created.message ?? 'Create failed' })
          return
        }
        const saved = await saveConfig(created.path, config)
        if (saved.success) {
          setOriginalConfig(config)
          setSelectedFile(created.path)
          setOpenFilePath('')
          setSourceMode('local')
          setShowSaveAs(false)
          refetchFiles()
        } else {
          setError({ title: 'Save As failed', message: saved.message ?? 'Save failed' })
        }
      } else {
        const path = saveAsCustomPath.trim()
        if (!path) {
          setError({ title: 'Path required', message: 'Enter an absolute path to save to.' })
          return
        }
        const res = await saveFileByPath(path, config)
        if (res.success) {
          setOriginalConfig(config)
          setOpenFilePath(path)
          setSelectedFile(null)
          setSourceMode('file')
          setOpenFileInput(path)
          setShowSaveAs(false)
        } else {
          setError({ title: 'Save As failed', message: res.message ?? 'Save failed' })
        }
      }
    } catch (e) {
      setError({ title: 'Save As failed', message: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
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

  const handleSaveAll = async () => {
    if (pendingConfigsRef.current.size === 0) return
    setSaving(true)
    setError(null)
    try {
      const files = Array.from(pendingConfigsRef.current.entries()).map(([path, config]) => ({
        path,
        config,
      }))
      const res = await saveAllConfigs(files)
      if (res.success) {
        for (const { path } of files) {
          markClean(path)
        }
        setOriginalConfig(config)
        setShowDiff(false)
      } else {
        const firstErr = res.errors?.[0]
        setError({
          title: 'Save All failed',
          message: firstErr
            ? `${firstErr.path}: ${firstErr.error}${firstErr.output ? '\n' + firstErr.output : ''}`
            : 'Save failed',
        })
      }
    } catch (e) {
      setError({ title: 'Save All failed', message: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const handleFormatConfig = async () => {
    if (!config) return
    setGlobalBusy('format')
    try {
      const formatted = await formatConfig(config)
      updateConfig(() => formatted)
    } catch (e) {
      setError({ title: 'Format failed', message: e instanceof Error ? e.message : 'Format failed' })
    } finally {
      setGlobalBusy(null)
    }
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
        <div className="sidebar-source-tabs">
          <button
            className={sourceMode === 'local' ? 'active' : ''}
            onClick={() => setSourceMode('local')}
            title="Browse local nginx config files"
          >Local</button>
          <button
            className={sourceMode === 'file' ? 'active' : ''}
            onClick={() => setSourceMode('file')}
            title="Open a config file by absolute path"
          >Open File</button>
          <button
            className={sourceMode === 'new' ? 'active' : ''}
            onClick={() => setSourceMode('new')}
            title="Create a new config from scratch"
          >New Config</button>
        </div>

        {sourceMode === 'local' && (
          <>
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
                    className={[
                      selectedFile === f.path ? 'selected' : '',
                      dirtyFiles.has(f.path) ? 'dirty' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => { setSelectedFile(f.path); setOpenFilePath('') }}
                    onContextMenu={readOnly ? undefined : (e) => handleFileContextMenu(e, f.path, f.status)}
                  >
                    <span className="file-path">{f.path}</span>
                    {dirtyFiles.has(f.path) && <span className="file-status dirty" title="Unsaved changes">●</span>}
                    {f.status === 'disabled' && <span className="file-status disabled">disabled</span>}
                    {f.status === 'enabled' && isSitesAvailable(f.path) && (
                      <span className="file-status enabled">on</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {sourceMode === 'file' && (
          <div className="sidebar-panel">
            <div className="sidebar-panel-title">Open Config File</div>
            <div className="open-file-form">
              <label>File path</label>
              <input
                type="text"
                value={openFileInput}
                onChange={(e) => setOpenFileInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleOpenFile()}
                placeholder="/etc/nginx/nginx.conf"
                spellCheck={false}
              />
              <button type="button" onClick={handleOpenFile} disabled={!openFileInput.trim() || loading}>
                {loading ? 'Opening…' : 'Open'}
              </button>
              {openFilePath && (
                <div className="open-file-current">Opened: {openFilePath}</div>
              )}
            </div>
          </div>
        )}

        {sourceMode === 'new' && (
          <div className="sidebar-panel">
            <div className="sidebar-panel-title">New Config</div>
            <div className="new-config-options">
              <button className="btn-template" onClick={() => handleNewConfig('blank')}>
                <div className="template-name">Blank</div>
                <div className="template-desc">Empty directives</div>
              </button>
              <button className="btn-template" onClick={() => handleNewConfig('http')}>
                <div className="template-name">HTTP Server</div>
                <div className="template-desc">Basic web server template</div>
              </button>
              <button className="btn-template" onClick={() => handleNewConfig('proxy')}>
                <div className="template-name">Reverse Proxy</div>
                <div className="template-desc">With upstream backend</div>
              </button>
            </div>
          </div>
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
            onClick={() => setShowSearch(true)}
            title="Global search (all config files)"
          >Search</button>
          <button
            type="button"
            className="btn-global"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Undo (Ctrl+Z)"
          >↩ Undo</button>
          <button
            type="button"
            className="btn-global"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title="Redo (Ctrl+Shift+Z)"
          >↪ Redo</button>
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
          {!readOnly && (
            <button
              type="button"
              className="btn-global"
              onClick={handleFormatConfig}
              disabled={!!globalBusy || !config}
              title="Normalize config formatting (remove custom blank lines)"
            >
              {globalBusy === 'format' ? 'Formatting…' : 'Format Config'}
            </button>
          )}
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

        {config && (selectedFile || openFilePath || sourceMode === 'new') && (
          <>
            <div className="editor-header">
              <div className="editor-header-top">
                <h2 className={!selectedFile && !openFilePath ? 'config-title-new' : ''}>
                  {selectedFile || openFilePath || 'New Config'}
                </h2>
                <div className="header-actions">
                  <button
                    type="button"
                    className="btn-global"
                    onClick={handleDownloadConfig}
                    title="Download config as .conf file"
                  >
                    Download
                  </button>
                  {!readOnly && selectedFile && (
                    <button
                      type="button"
                      className="btn-global"
                      onClick={() => setShowHistory(true)}
                      title="View change history"
                    >
                      History
                    </button>
                  )}
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        className="btn-global"
                        onClick={() => setShowSaveAs(true)}
                        title="Save to a different path"
                      >
                        Save As…
                      </button>
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
                      {dirtyFiles.size > 1 && (
                        <button
                          className="btn-save"
                          onClick={handleSaveAll}
                          disabled={saving}
                          title={`Save all ${dirtyFiles.size} modified files atomically`}
                        >
                          {saving ? 'Saving…' : `Save All (${dirtyFiles.size})`}
                        </button>
                      )}
                      <button
                        className={`btn-save${dirtyFiles.has(selectedFile ?? openFilePath ?? '') ? ' btn-dirty' : ''}`}
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
                  className={tab === 'http' ? 'active' : ''}
                  onClick={() => setTab('http')}
                >
                  HTTP Settings
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
                <button
                  className={tab === 'stream' ? 'active' : ''}
                  onClick={() => setTab('stream')}
                >
                  Stream / TCP-UDP ({streamServers.length})
                </button>
                <button
                  className={tab === 'mail' ? 'active' : ''}
                  onClick={() => setTab('mail')}
                >
                  Mail ({mailServers.length})
                </button>
                <button
                  className={tab === 'topology' ? 'active' : ''}
                  onClick={() => setTab('topology')}
                >
                  Topology
                </button>
                <button
                  className={tab === 'raw' ? 'active' : ''}
                  onClick={() => setTab('raw')}
                >
                  Raw
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
              {tab === 'http' && (
                <HttpSettingsTab
                  httpBlock={httpBlock}
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
              {tab === 'stream' && (
                <StreamTab
                  streamBlock={streamBlock}
                  config={config}
                  onUpdate={updateConfig}
                  readOnly={readOnly}
                />
              )}
              {tab === 'mail' && (
                <MailTab
                  mailBlock={mailBlock}
                  config={config}
                  onUpdate={updateConfig}
                  readOnly={readOnly}
                />
              )}
              {tab === 'topology' && (
                <TopologyTab
                  config={config}
                  onNavigate={(newTab) => setTab(newTab as TabId)}
                />
              )}
              {tab === 'raw' && (
                <RawEditorTab
                  config={config}
                  onUpdate={updateConfig}
                  onTestSyntax={handleTestSyntax}
                  readOnly={readOnly}
                />
              )}
            </div>
          </>
        )}

        {(selectedFile || openFilePath) && !config && !loading && (
          <div className="empty-state">No config loaded</div>
        )}

        {!config && !selectedFile && !openFilePath && sourceMode === 'local' && files.length === 0 && !loading && (
          <div className="empty-state">No config files found</div>
        )}

        {!config && !selectedFile && !openFilePath && sourceMode !== 'local' && !loading && (
          <div className="empty-state">
            {sourceMode === 'file' ? 'Enter a file path and click Open.' : 'Choose a template on the left to start a new config.'}
          </div>
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

      {showHistory && selectedFile && (
        <HistoryModal
          filePath={selectedFile}
          onClose={() => setShowHistory(false)}
          onRestore={() => {
            setShowHistory(false)
            fetchConfig(selectedFile).then((c) => {
              setConfig(c)
              setOriginalConfig(c)
              clearHistory()
            })
          }}
        />
      )}

      {showSearch && (
        <SearchPanel
          onNavigate={(filePath) => {
            setSelectedFile(filePath)
            setOpenFilePath('')
            setSourceMode('local')
            setShowSearch(false)
          }}
          onClose={() => setShowSearch(false)}
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

      {showSaveAs && (
        <>
          <div className="modal-backdrop" onClick={() => setShowSaveAs(false)} />
          <div className="save-as-modal">
            <h3>Save Config As</h3>
            <div className="save-as-mode-row">
              <label className={`save-as-mode-btn${saveAsMode === 'local' ? ' active' : ''}`}>
                <input type="radio" name="save-as-mode" value="local" checked={saveAsMode === 'local'} onChange={() => setSaveAsMode('local')} />
                Local nginx directory
              </label>
              <label className={`save-as-mode-btn${saveAsMode === 'path' ? ' active' : ''}`}>
                <input type="radio" name="save-as-mode" value="path" checked={saveAsMode === 'path'} onChange={() => setSaveAsMode('path')} />
                Custom absolute path
              </label>
            </div>
            {saveAsMode === 'local' && (
              <div className="save-as-fields">
                <div className="save-as-field">
                  <label>Directory</label>
                  <select value={saveAsTargetDir} onChange={(e) => setSaveAsTargetDir(e.target.value as 'conf.d' | 'sites-available')}>
                    <option value="conf.d">conf.d/</option>
                    <option value="sites-available">sites-available/</option>
                  </select>
                </div>
                <div className="save-as-field">
                  <label>Filename</label>
                  <input
                    type="text"
                    value={saveAsFilename}
                    onChange={(e) => setSaveAsFilename(e.target.value)}
                    placeholder="myconfig.conf"
                    autoFocus
                  />
                </div>
              </div>
            )}
            {saveAsMode === 'path' && (
              <div className="save-as-fields">
                <div className="save-as-field">
                  <label>Absolute path</label>
                  <input
                    type="text"
                    value={saveAsCustomPath}
                    onChange={(e) => setSaveAsCustomPath(e.target.value)}
                    placeholder="/etc/nginx/conf.d/myconfig.conf"
                    spellCheck={false}
                    autoFocus
                  />
                </div>
              </div>
            )}
            <div className="save-as-actions">
              <button type="button" onClick={() => setShowSaveAs(false)}>Cancel</button>
              <button type="button" className="btn-save" onClick={handleSaveAs} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}

      {error && (
        <ErrorModal error={error} onDismiss={() => setError(null)} />
      )}
    </div>
  )
}
