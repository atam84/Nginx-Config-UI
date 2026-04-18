import { useState } from 'react'
import { type ConfigFile, type Node } from './api'
import {
  replaceNodeById,
  setBlockDirective,
  removeBlockDirective,
  removeNodeById,
} from './configUtils'
import './MailTab.css'

interface Props {
  mailBlock?: Node
  config: ConfigFile
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  readOnly?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getArg(block: Node | undefined, name: string, idx = 0): string {
  return block?.directives?.find((d) => d.name === name)?.args?.[idx] ?? ''
}

function applyToMail(c: ConfigFile, fn: (dirs: Node[]) => Node[]): ConfigFile {
  const dirs = c.directives ?? []
  const idx = dirs.findIndex((d) => d.name === 'mail' && d.type === 'block')
  if (idx >= 0) {
    const mail = dirs[idx]
    return {
      ...c,
      directives: [
        ...dirs.slice(0, idx),
        { ...mail, directives: fn(mail.directives ?? []) },
        ...dirs.slice(idx + 1),
      ],
    }
  }
  const newMail: Node = {
    type: 'block',
    name: 'mail',
    args: [],
    enabled: true,
    id: `mail-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    directives: fn([]),
  }
  return { ...c, directives: [...dirs, newMail] }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ─── Mail Server Card ─────────────────────────────────────────────────────────

interface MailServerCardProps {
  server: Node
  onUpdate: (updater: (c: ConfigFile) => ConfigFile) => void
  readOnly?: boolean
}

const MAIL_PROTOCOLS = ['imap', 'pop3', 'smtp']
const STARTTLS_OPTIONS = ['on', 'off', 'only']

function MailServerCard({ server, onUpdate, readOnly }: MailServerCardProps) {
  const [open, setOpen] = useState(true)
  const listenArgs = server.directives?.find((d) => d.name === 'listen')?.args ?? []
  const port = listenArgs.find((a) => /^\d+/.test(a)) ?? ''
  const ssl = listenArgs.includes('ssl')

  const protocol = getArg(server, 'protocol') || 'imap'
  const sslCert = getArg(server, 'ssl_certificate')
  const sslKey = getArg(server, 'ssl_certificate_key')
  const sslProtos = server.directives?.find((d) => d.name === 'ssl_protocols')?.args ?? []
  const starttls = getArg(server, 'starttls')
  const smtpAuth = (server.directives?.find((d) => d.name === 'smtp_auth')?.args ?? []).join(' ')
  const xclient = getArg(server, 'xclient')
  const proxyPass = getArg(server, 'proxy_pass')
  const proxyTimeout = getArg(server, 'proxy_timeout')

  const updateServer = (fn: (u: Node) => Node) => {
    onUpdate((c) => replaceNodeById(c, server.id, fn))
  }

  const setDir = (name: string, args: string[]) => {
    updateServer((s) => ({
      ...s,
      directives: args.length > 0
        ? setBlockDirective(s.directives ?? [], name, args)
        : removeBlockDirective(s.directives ?? [], name),
    }))
  }

  const setListen = (p: string, withSsl: boolean) => {
    const args = [p || '993', ...(withSsl ? ['ssl'] : [])]
    setDir('listen', args)
  }

  const SSL_PROTOCOLS = ['TLSv1.2', 'TLSv1.3']
  const toggleSslProto = (proto: string, checked: boolean) => {
    const next = checked ? [...sslProtos, proto] : sslProtos.filter((p) => p !== proto)
    setDir('ssl_protocols', next)
  }

  return (
    <div className={`mail-server-card ${!server.enabled ? 'mail-block-disabled' : ''}`}>
      <div className="mail-card-header">
        <button
          type="button"
          className="block-collapse-toggle"
          onClick={() => setOpen((v) => !v)}
          title={open ? 'Collapse server' : 'Expand server'}
        >
          {open ? '▾' : '▸'}
        </button>
        {!readOnly && (
          <label className="mail-toggle-label" title="enabled">
            <input
              type="checkbox"
              checked={server.enabled}
              onChange={(e) => updateServer((s) => ({ ...s, enabled: e.target.checked }))}
            />
          </label>
        )}
        <span className="mail-card-title">
          {protocol.toUpperCase()} :{port || '?'}{ssl ? ' (SSL)' : ''}
        </span>
        {!open && sslProtos.length > 0 && (
          <span className="block-collapsed-summary">
            {sslProtos.join(', ')}
          </span>
        )}
        {!readOnly && (
          <button
            type="button"
            className="btn-delete-mail"
            onClick={() => onUpdate((c) => removeNodeById(c, server.id))}
          >
            Delete
          </button>
        )}
      </div>

      {open && (<>
      <div className="mail-fields-row">
        <div className="mail-field">
          <label>protocol</label>
          <select
            value={protocol}
            onChange={(e) => setDir('protocol', [e.target.value])}
            disabled={readOnly}
          >
            {MAIL_PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="mail-field mail-field-port">
          <label>listen port</label>
          <input
            type="text"
            placeholder="993"
            value={port}
            onChange={(e) => setListen(e.target.value, ssl)}
            readOnly={readOnly}
          />
        </div>
        <div className="mail-field">
          <label className="mail-toggle-label">
            <input
              type="checkbox"
              checked={ssl}
              disabled={readOnly}
              onChange={(e) => setListen(port, e.target.checked)}
            />
            ssl
          </label>
        </div>
      </div>

      {ssl && (
        <div className="mail-ssl-section">
          <div className="mail-fields-row">
            <div className="mail-field mail-field-wide">
              <label>ssl_certificate</label>
              <input
                type="text"
                placeholder="/etc/ssl/certs/mail.crt"
                value={sslCert}
                onChange={(e) => setDir('ssl_certificate', e.target.value ? [e.target.value] : [])}
                readOnly={readOnly}
              />
            </div>
            <div className="mail-field mail-field-wide">
              <label>ssl_certificate_key</label>
              <input
                type="text"
                placeholder="/etc/ssl/private/mail.key"
                value={sslKey}
                onChange={(e) => setDir('ssl_certificate_key', e.target.value ? [e.target.value] : [])}
                readOnly={readOnly}
              />
            </div>
          </div>
          <div className="mail-ssl-protos">
            <span className="mail-field-label">ssl_protocols</span>
            {SSL_PROTOCOLS.map((p) => (
              <label key={p} className="mail-toggle-label">
                <input
                  type="checkbox"
                  checked={sslProtos.includes(p)}
                  disabled={readOnly}
                  onChange={(e) => toggleSslProto(p, e.target.checked)}
                />
                {p}
              </label>
            ))}
          </div>
        </div>
      )}

      {(protocol === 'pop3' || protocol === 'smtp') && (
        <div className="mail-fields-row">
          <div className="mail-field">
            <label>starttls</label>
            <select
              value={starttls || 'off'}
              onChange={(e) => setDir('starttls', e.target.value !== 'off' ? [e.target.value] : [])}
              disabled={readOnly}
            >
              {STARTTLS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
      )}

      {protocol === 'smtp' && (
        <div className="mail-fields-row">
          <div className="mail-field mail-field-wide">
            <label>smtp_auth</label>
            <input
              type="text"
              placeholder="login plain"
              value={smtpAuth}
              onChange={(e) => setDir('smtp_auth', e.target.value ? e.target.value.split(/\s+/).filter(Boolean) : [])}
              readOnly={readOnly}
            />
          </div>
          <div className="mail-field">
            <label className="mail-toggle-label">
              <input
                type="checkbox"
                checked={xclient === 'on'}
                disabled={readOnly}
                onChange={(e) => setDir('xclient', e.target.checked ? ['on'] : ['off'])}
              />
              xclient
            </label>
          </div>
        </div>
      )}

      <div className="mail-fields-row">
        <div className="mail-field mail-field-wide">
          <label>proxy_pass (backend)</label>
          <input
            type="text"
            placeholder="127.0.0.1:143"
            value={proxyPass}
            onChange={(e) => setDir('proxy_pass', e.target.value ? [e.target.value] : [])}
            readOnly={readOnly}
          />
        </div>
        <div className="mail-field">
          <label>proxy_timeout</label>
          <input
            type="text"
            placeholder="24h"
            value={proxyTimeout}
            onChange={(e) => setDir('proxy_timeout', e.target.value ? [e.target.value] : [])}
            readOnly={readOnly}
          />
        </div>
      </div>
      </>)}
    </div>
  )
}

// ─── Main MailTab Component ───────────────────────────────────────────────────

export default function MailTab({ mailBlock, config, onUpdate, readOnly }: Props) {
  const mailServers = mailBlock?.directives?.filter((d) => d.name === 'server') ?? []

  const serverName = getArg(mailBlock, 'server_name')
  const authHttp = getArg(mailBlock, 'auth_http')
  const authHttpTimeout = getArg(mailBlock, 'auth_http_timeout')
  const imapCaps = (mailBlock?.directives?.find((d) => d.name === 'imap_capabilities')?.args ?? []).join(' ')
  const pop3Caps = (mailBlock?.directives?.find((d) => d.name === 'pop3_capabilities')?.args ?? []).join(' ')
  const smtpCaps = (mailBlock?.directives?.find((d) => d.name === 'smtp_capabilities')?.args ?? []).join(' ')

  const setMailDir = (name: string, args: string[]) => {
    onUpdate((c) =>
      applyToMail(c, (dirs) =>
        args.length > 0
          ? setBlockDirective(dirs, name, args)
          : removeBlockDirective(dirs, name)
      )
    )
  }

  const addServer = (protocol: 'imap' | 'pop3' | 'smtp') => {
    const defaults: Record<string, { port: string; ssl: boolean }> = {
      imap: { port: '993', ssl: true },
      pop3: { port: '110', ssl: false },
      smtp: { port: '25', ssl: false },
    }
    const d = defaults[protocol]
    const newServer: Node = {
      type: 'block',
      name: 'server',
      args: [],
      enabled: true,
      id: makeId('mail-srv'),
      directives: [
        { type: 'directive', name: 'listen', args: [d.port, ...(d.ssl ? ['ssl'] : [])], enabled: true, id: makeId('listen') },
        { type: 'directive', name: 'protocol', args: [protocol], enabled: true, id: makeId('proto') },
      ],
    }
    onUpdate((c) => applyToMail(c, (dirs) => [...dirs, newServer]))
  }

  return (
    <div className="mail-tab">
      {/* Mail block settings */}
      <div className="mail-section">
        <div className="mail-section-header">
          <h3>Mail Block Settings</h3>
        </div>
        <div className="mail-global-settings">
          <div className="mail-fields-row">
            <div className="mail-field mail-field-wide">
              <label>server_name</label>
              <input
                type="text"
                placeholder="mail.example.com"
                value={serverName}
                onChange={(e) => setMailDir('server_name', e.target.value ? [e.target.value] : [])}
                readOnly={readOnly}
              />
            </div>
          </div>
          <div className="mail-fields-row">
            <div className="mail-field mail-field-wide">
              <label>auth_http</label>
              <input
                type="text"
                placeholder="http://auth.example.com/auth"
                value={authHttp}
                onChange={(e) => setMailDir('auth_http', e.target.value ? [e.target.value] : [])}
                readOnly={readOnly}
              />
            </div>
            <div className="mail-field">
              <label>auth_http_timeout</label>
              <input
                type="text"
                placeholder="60s"
                value={authHttpTimeout}
                onChange={(e) => setMailDir('auth_http_timeout', e.target.value ? [e.target.value] : [])}
                readOnly={readOnly}
              />
            </div>
          </div>
          <div className="mail-fields-row">
            <div className="mail-field mail-field-wide">
              <label>imap_capabilities</label>
              <input
                type="text"
                placeholder="IMAP4 IMAP4rev1 AUTH=PLAIN"
                value={imapCaps}
                onChange={(e) => setMailDir('imap_capabilities', e.target.value ? e.target.value.split(/\s+/).filter(Boolean) : [])}
                readOnly={readOnly}
              />
            </div>
          </div>
          <div className="mail-fields-row">
            <div className="mail-field mail-field-wide">
              <label>pop3_capabilities</label>
              <input
                type="text"
                placeholder="TOP USER UIDL"
                value={pop3Caps}
                onChange={(e) => setMailDir('pop3_capabilities', e.target.value ? e.target.value.split(/\s+/).filter(Boolean) : [])}
                readOnly={readOnly}
              />
            </div>
            <div className="mail-field mail-field-wide">
              <label>smtp_capabilities</label>
              <input
                type="text"
                placeholder="SIZE NOOP HELP"
                value={smtpCaps}
                onChange={(e) => setMailDir('smtp_capabilities', e.target.value ? e.target.value.split(/\s+/).filter(Boolean) : [])}
                readOnly={readOnly}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Server blocks */}
      <div className="mail-section">
        <div className="mail-section-header">
          <h3>Mail Servers ({mailServers.length})</h3>
          {!readOnly && (
            <div className="mail-add-btns">
              <button type="button" className="btn-add-mail" onClick={() => addServer('imap')}>
                + IMAP
              </button>
              <button type="button" className="btn-add-mail" onClick={() => addServer('pop3')}>
                + POP3
              </button>
              <button type="button" className="btn-add-mail" onClick={() => addServer('smtp')}>
                + SMTP
              </button>
            </div>
          )}
        </div>
        {mailServers.length === 0 && (
          <div className="mail-empty">No mail server blocks defined.</div>
        )}
        {mailServers.map((srv) => (
          <MailServerCard
            key={srv.id ?? Math.random()}
            server={srv}
            onUpdate={onUpdate}
            readOnly={readOnly}
          />
        ))}
      </div>

      {!mailBlock && (
        <div className="mail-no-block">
          No <code>mail &#123;&#125;</code> block in this config. Add a server to create one automatically.
        </div>
      )}
    </div>
  )
}
