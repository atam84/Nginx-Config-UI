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

export default function NewProxyWizard({ config, upstreamNames, initialDestination, onAdd, onAddWithUpstream, onClose }: Props) {
  const [step, setStep] = useState(1)
  const [domain, setDomain] = useState('')
  const [destination, setDestination] = useState(initialDestination ?? '')
  const [ssl, setSsl] = useState(false)
  const [http2, setHttp2] = useState(false)
  const [websockets, setWebsockets] = useState(false)
  const [port, setPort] = useState('80')

  const portNum = ssl ? (port || '443') : (port || '80')

  const buildServer = (): Node => {
    const listenParts = [portNum]
    if (ssl) listenParts.push('ssl')
    if (http2) listenParts.push('http2')
    const server: Node = {
      type: 'block',
      name: 'server',
      args: [],
      enabled: true,
      id: `server-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      directives: [
        { type: 'directive', name: 'listen', args: [listenParts.join(' ')], enabled: true },
      ],
    }
    if (domain.trim()) {
      server.directives!.push({
        type: 'directive',
        name: 'server_name',
        args: domain.split(/[\s,]+/).filter(Boolean),
        enabled: true,
      })
    }
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
    const location: Node = {
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: `location-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      directives: locDirs,
    }
    server.directives!.push(location)
    return server
  }

  const handleFinish = () => {
    const dest = destination.trim() || 'http://127.0.0.1:3000'
    const server = buildServer()
    if (onAddWithUpstream && looksLikeUpstreamName(dest) && !upstreamNames.includes(dest)) {
      onAddWithUpstream(server, dest, '127.0.0.1:8080')
    } else {
      onAdd(server)
    }
    onClose()
  }

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
          <span className={step >= 1 ? 'active' : ''}>1. Domain</span>
          <span className={step >= 2 ? 'active' : ''}>2. Destination</span>
          <span className={step >= 3 ? 'active' : ''}>3. SSL</span>
          <span className={step >= 4 ? 'active' : ''}>4. Advanced</span>
        </div>
        <div className="wizard-body">
          {step === 1 && (
            <div className="wizard-step">
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
          {step === 2 && (
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
                <button type="button" onClick={() => setStep(1)}>
                  Back
                </button>
                <button type="button" onClick={() => setStep(3)}>
                  Next
                </button>
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
                <button type="button" onClick={() => setStep(2)}>
                  Back
                </button>
                <button type="button" onClick={() => setStep(4)}>
                  Next
                </button>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="wizard-step">
              <label>Advanced</label>
              <label className="wizard-check">
                <input type="checkbox" checked={websockets} onChange={(e) => setWebsockets(e.target.checked)} />
                Websockets support (add Upgrade headers)
              </label>
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(3)}>
                  Back
                </button>
                <button type="button" className="wizard-finish" onClick={handleFinish}>
                  Add Proxy Host
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
