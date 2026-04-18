import { useState } from 'react'
import { type ConfigFile, type Node } from './api'
import './NewProxyWizard.css'

interface Props {
  config: ConfigFile
  upstreamNames: string[]
  initialDestination?: string
  onAdd: (server: Node) => void
  onAddWithUpstream?: (server: Node, upstreamName: string, defaultAddr: string) => void
  onClose: () => void
}

type Template = 'proxy' | 'php'

/** True if destination looks like an upstream name (simple identifier, not URL/hostname) */
function looksLikeUpstreamName(dest: string): boolean {
  const t = dest.trim()
  if (!t) return false
  if (t.includes('://')) return false // http://, https://
  if (t.includes('.')) return false // example.com = hostname, not upstream
  if (/^\d/.test(t)) return false // IP or port-first
  if (t.startsWith('unix:')) return false
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(t) // e.g. backend, my_app
}

function nid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function NewProxyWizard({ config: _config, upstreamNames, initialDestination, onAdd, onAddWithUpstream, onClose }: Props) {
  void _config
  const [template, setTemplate] = useState<Template>('proxy')
  const [step, setStep] = useState(1)
  const [domain, setDomain] = useState('')
  const [destination, setDestination] = useState(initialDestination ?? '')
  const [ssl, setSsl] = useState(false)
  const [http2, setHttp2] = useState(false)
  const [websockets, setWebsockets] = useState(false)
  const [port, setPort] = useState('80')
  // §42.6 — PHP-FPM template state
  const [phpRoot, setPhpRoot] = useState('/var/www/html')
  const [phpFpmBackend, setPhpFpmBackend] = useState('unix:/run/php/php-fpm.sock')
  const [phpIndex, setPhpIndex] = useState('index.php')
  const [phpTryFiles, setPhpTryFiles] = useState(true)

  const portNum = ssl ? (port || '443') : (port || '80')

  const listenArg = (): string => {
    const listenParts = [portNum]
    if (ssl) listenParts.push('ssl')
    if (http2) listenParts.push('http2')
    return listenParts.join(' ')
  }

  const serverNameNode = (): Node | null =>
    domain.trim()
      ? { type: 'directive', name: 'server_name', args: domain.split(/[\s,]+/).filter(Boolean), enabled: true }
      : null

  const buildProxyServer = (): Node => {
    const server: Node = {
      type: 'block',
      name: 'server',
      args: [],
      enabled: true,
      id: nid('server'),
      directives: [
        { type: 'directive', name: 'listen', args: [listenArg()], enabled: true },
      ],
    }
    const sn = serverNameNode()
    if (sn) server.directives!.push(sn)
    const dest = destination.trim() || 'http://127.0.0.1:3000'
    const proxyPassValue = dest.includes('://') ? dest : `http://${dest}`
    const locDirs: Node[] = [
      { type: 'directive', name: 'proxy_pass', args: [proxyPassValue], enabled: true },
      { type: 'directive', name: 'proxy_set_header', args: ['Host', '$host'], enabled: true },
      { type: 'directive', name: 'proxy_set_header', args: ['X-Real-IP', '$remote_addr'], enabled: true },
      { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-For', '$proxy_add_x_forwarded_for'], enabled: true },
      { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-Proto', '$scheme'], enabled: true },
    ]
    if (websockets) {
      locDirs.push({ type: 'directive', name: 'proxy_set_header', args: ['Upgrade', '$http_upgrade'], enabled: true })
      locDirs.push({ type: 'directive', name: 'proxy_set_header', args: ['Connection', '"upgrade"'], enabled: true })
    }
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: nid('location'),
      directives: locDirs,
    })
    return server
  }

  const buildPhpServer = (): Node => {
    const server: Node = {
      type: 'block',
      name: 'server',
      args: [],
      enabled: true,
      id: nid('server'),
      directives: [
        { type: 'directive', name: 'listen', args: [listenArg()], enabled: true },
      ],
    }
    const sn = serverNameNode()
    if (sn) server.directives!.push(sn)
    // Webroot + index
    server.directives!.push({ type: 'directive', name: 'root', args: [phpRoot || '/var/www/html'], enabled: true })
    server.directives!.push({ type: 'directive', name: 'index', args: [phpIndex || 'index.php', 'index.html'], enabled: true })

    // location / { try_files $uri $uri/ /index.php?$query_string; }
    const rootLocDirs: Node[] = []
    if (phpTryFiles) {
      const indexTarget = `/${(phpIndex || 'index.php').replace(/^\/+/, '')}?$query_string`
      rootLocDirs.push({
        type: 'directive',
        name: 'try_files',
        args: ['$uri', '$uri/', indexTarget],
        enabled: true,
      })
    }
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: nid('location'),
      directives: rootLocDirs,
    })

    // location ~ \.php$ { fastcgi_pass …; include fastcgi_params; … }
    const fpmBackend = (phpFpmBackend || 'unix:/run/php/php-fpm.sock').trim()
    const phpLocDirs: Node[] = [
      { type: 'directive', name: 'try_files', args: ['$uri', '=404'], enabled: true },
      { type: 'directive', name: 'fastcgi_split_path_info', args: ['^(.+\\.php)(/.+)$'], enabled: true },
      { type: 'directive', name: 'fastcgi_pass', args: [fpmBackend], enabled: true },
      { type: 'directive', name: 'fastcgi_index', args: [phpIndex || 'index.php'], enabled: true },
      { type: 'directive', name: 'include', args: ['fastcgi_params'], enabled: true },
      { type: 'directive', name: 'fastcgi_param', args: ['SCRIPT_FILENAME', '$document_root$fastcgi_script_name'], enabled: true },
      { type: 'directive', name: 'fastcgi_param', args: ['PATH_INFO', '$fastcgi_path_info'], enabled: true },
      { type: 'directive', name: 'fastcgi_param', args: ['HTTPS', '$https', 'if_not_empty'], enabled: true },
      { type: 'directive', name: 'fastcgi_read_timeout', args: ['300s'], enabled: true },
      { type: 'directive', name: 'fastcgi_buffer_size', args: ['16k'], enabled: true },
      { type: 'directive', name: 'fastcgi_buffers', args: ['16', '16k'], enabled: true },
    ]
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['~', '\\.php$'],
      enabled: true,
      id: nid('location'),
      directives: phpLocDirs,
    })

    // Deny direct access to hidden files (standard PHP hardening)
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['~', '/\\.(?!well-known).*'],
      enabled: true,
      id: nid('location'),
      directives: [
        { type: 'directive', name: 'deny', args: ['all'], enabled: true },
      ],
    })

    return server
  }

  const buildServer = (): Node => (template === 'php' ? buildPhpServer() : buildProxyServer())

  const handleFinish = () => {
    const server = buildServer()
    if (template === 'proxy') {
      const dest = destination.trim() || 'http://127.0.0.1:3000'
      if (onAddWithUpstream && looksLikeUpstreamName(dest) && !upstreamNames.includes(dest)) {
        onAddWithUpstream(server, dest, '127.0.0.1:8080')
        onClose()
        return
      }
    }
    onAdd(server)
    onClose()
  }

  const totalSteps = template === 'php' ? 3 : 4

  return (
    <div className="wizard-overlay" onClick={onClose}>
      <div className="wizard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-header">
          <h3>New Proxy Host</h3>
          <button type="button" className="wizard-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="wizard-steps">
          <span className={step >= 1 ? 'active' : ''}>1. Template &amp; Domain</span>
          <span className={step >= 2 ? 'active' : ''}>
            2. {template === 'php' ? 'PHP Backend' : 'Destination'}
          </span>
          <span className={step >= 3 ? 'active' : ''}>3. SSL</span>
          {template === 'proxy' && (
            <span className={step >= 4 ? 'active' : ''}>4. Advanced</span>
          )}
        </div>
        <div className="wizard-body">
          {step === 1 && (
            <div className="wizard-step">
              <label>Template</label>
              <div className="wizard-templates">
                <button
                  type="button"
                  className={`wizard-template-card${template === 'proxy' ? ' active' : ''}`}
                  onClick={() => setTemplate('proxy')}
                >
                  <div className="wizard-template-name">Reverse Proxy</div>
                  <div className="wizard-template-desc">Forward requests to a backend / upstream (Node, Python, Go, etc.)</div>
                </button>
                <button
                  type="button"
                  className={`wizard-template-card${template === 'php' ? ' active' : ''}`}
                  onClick={() => setTemplate('php')}
                >
                  <div className="wizard-template-name">PHP / PHP-FPM site</div>
                  <div className="wizard-template-desc">Serve static files + dispatch <code>.php</code> to a FastCGI backend</div>
                </button>
              </div>
              <label>Domain name(s)</label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com www.example.com"
              />
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(2)}>
                  Next
                </button>
              </div>
            </div>
          )}
          {step === 2 && template === 'proxy' && (
            <div className="wizard-step">
              <label>Forward hostname / IP</label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="http://127.0.0.1:3000 or upstream name"
                list="wizard-upstreams"
              />
              <datalist id="wizard-upstreams">
                {upstreamNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(1)}>Back</button>
                <button type="button" onClick={() => setStep(3)}>Next</button>
              </div>
            </div>
          )}
          {step === 2 && template === 'php' && (
            <div className="wizard-step">
              <label>Webroot (<code>root</code>)</label>
              <input
                type="text"
                value={phpRoot}
                onChange={(e) => setPhpRoot(e.target.value)}
                placeholder="/var/www/html"
                spellCheck={false}
              />
              <label>PHP-FPM backend (<code>fastcgi_pass</code>)</label>
              <input
                type="text"
                value={phpFpmBackend}
                onChange={(e) => setPhpFpmBackend(e.target.value)}
                placeholder="unix:/run/php/php8.2-fpm.sock or 127.0.0.1:9000"
                spellCheck={false}
              />
              <label>Index file</label>
              <input
                type="text"
                value={phpIndex}
                onChange={(e) => setPhpIndex(e.target.value)}
                placeholder="index.php"
                spellCheck={false}
              />
              <label className="wizard-check">
                <input type="checkbox" checked={phpTryFiles} onChange={(e) => setPhpTryFiles(e.target.checked)} />
                Add <code>try_files $uri $uri/ /{phpIndex || 'index.php'}?$query_string</code> for clean URLs (Laravel, WordPress, Symfony)
              </label>
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(1)}>Back</button>
                <button type="button" onClick={() => setStep(3)}>Next</button>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="wizard-step">
              <label>SSL / Port</label>
              <div className="wizard-row">
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  min={1}
                  max={65535}
                  placeholder={ssl ? '443' : '80'}
                />
                <label className="wizard-check">
                  <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
                  SSL
                </label>
                <label className="wizard-check">
                  <input type="checkbox" checked={http2} onChange={(e) => setHttp2(e.target.checked)} disabled={!ssl} />
                  HTTP/2
                </label>
              </div>
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(2)}>Back</button>
                {template === 'proxy' ? (
                  <button type="button" onClick={() => setStep(4)}>Next</button>
                ) : (
                  <button type="button" className="wizard-finish" onClick={handleFinish}>
                    Add PHP Site
                  </button>
                )}
              </div>
            </div>
          )}
          {step === 4 && template === 'proxy' && (
            <div className="wizard-step">
              <label>Advanced</label>
              <label className="wizard-check">
                <input type="checkbox" checked={websockets} onChange={(e) => setWebsockets(e.target.checked)} />
                Websockets support (add Upgrade headers)
              </label>
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(3)}>Back</button>
                <button type="button" className="wizard-finish" onClick={handleFinish}>
                  Add Proxy Host
                </button>
              </div>
            </div>
          )}
          <div className="wizard-step-progress">Step {step} of {totalSteps}</div>
        </div>
      </div>
    </div>
  )
}
