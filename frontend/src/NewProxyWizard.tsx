import { useEffect, useState } from 'react'
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

type Template = 'proxy' | 'php' | 'uwsgi' | 'grpc' | 'static' | 'spa' | 'node' | 'asgi' | 'go'

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
  // §43.2 — Python / uWSGI template state
  const [uwsgiBackend, setUwsgiBackend] = useState('unix:/run/uwsgi/app.sock')
  const [uwsgiStaticUrl, setUwsgiStaticUrl] = useState('/static/')
  const [uwsgiStaticRoot, setUwsgiStaticRoot] = useState('/var/www/app/static/')
  const [uwsgiServeStatic, setUwsgiServeStatic] = useState(true)
  const [uwsgiReadTimeout, setUwsgiReadTimeout] = useState('300s')
  // §44.3 — gRPC template state
  const [grpcBackend, setGrpcBackend] = useState('grpc://127.0.0.1:50051')
  const [grpcSslServerName, setGrpcSslServerName] = useState('')
  const [grpcSslVerify, setGrpcSslVerify] = useState(false)
  const [grpcReadTimeout, setGrpcReadTimeout] = useState('600s')
  // §45.6 — Static site template state
  const [staticRoot, setStaticRoot] = useState('/var/www/html')
  const [staticIndex, setStaticIndex] = useState('index.html index.htm')
  const [staticSpaFallback, setStaticSpaFallback] = useState(true)
  const [staticLongCache, setStaticLongCache] = useState(true)
  const [staticAssetsPrefix, setStaticAssetsPrefix] = useState('/assets/')
  // §45.7 — SPA (SSR + static) template state
  const [spaSsrBackend, setSpaSsrBackend] = useState('http://127.0.0.1:3000')
  const [spaStaticPrefix, setSpaStaticPrefix] = useState('/_next/static/')
  const [spaStaticRoot, setSpaStaticRoot] = useState('/var/www/app/.next/static/')
  const [spaPublicPrefix, setSpaPublicPrefix] = useState('/public/')
  const [spaPublicRoot, setSpaPublicRoot] = useState('/var/www/app/public/')
  const [spaIncludePublic, setSpaIncludePublic] = useState(true)
  // §46.1 — Node.js (Next.js / Nuxt / Remix) template state
  const [nodeBackend, setNodeBackend] = useState('http://127.0.0.1:3000')
  const [nodeIncludeStatic, setNodeIncludeStatic] = useState(true)
  const [nodeStaticPrefix, setNodeStaticPrefix] = useState('/_next/static/')
  const [nodeStaticRoot, setNodeStaticRoot] = useState('/var/www/app/.next/static/')
  const [nodeReadTimeout, setNodeReadTimeout] = useState('3600s')
  // §46.2 — Python ASGI (FastAPI / Django Channels / Starlette) template state
  const [asgiBackend, setAsgiBackend] = useState('http://127.0.0.1:8000')
  const [asgiReadTimeout, setAsgiReadTimeout] = useState('300s')
  // §46.3 — Go / generic HTTP service template state
  const [goBackend, setGoBackend] = useState('http://127.0.0.1:8080')
  const [goReadTimeout, setGoReadTimeout] = useState('60s')

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

  const buildUwsgiServer = (): Node => {
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

    // Optional /static/ alias block — served by nginx directly, bypassing uWSGI.
    if (uwsgiServeStatic && uwsgiStaticUrl.trim() && uwsgiStaticRoot.trim()) {
      const url = uwsgiStaticUrl.trim().endsWith('/') ? uwsgiStaticUrl.trim() : `${uwsgiStaticUrl.trim()}/`
      const root = uwsgiStaticRoot.trim().endsWith('/') ? uwsgiStaticRoot.trim() : `${uwsgiStaticRoot.trim()}/`
      server.directives!.push({
        type: 'block',
        name: 'location',
        args: [url],
        enabled: true,
        id: nid('location'),
        directives: [
          { type: 'directive', name: 'alias', args: [root], enabled: true },
          { type: 'directive', name: 'expires', args: ['30d'], enabled: true },
          { type: 'directive', name: 'access_log', args: ['off'], enabled: true },
        ],
      })
    }

    // Main uWSGI passthrough block.
    const uwsgiBackendValue = (uwsgiBackend || 'unix:/run/uwsgi/app.sock').trim()
    const readT = (uwsgiReadTimeout || '300s').trim()
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: nid('location'),
      directives: [
        { type: 'directive', name: 'include', args: ['uwsgi_params'], enabled: true },
        { type: 'directive', name: 'uwsgi_pass', args: [uwsgiBackendValue], enabled: true },
        { type: 'directive', name: 'uwsgi_param', args: ['HTTPS', '$https', 'if_not_empty'], enabled: true },
        { type: 'directive', name: 'uwsgi_read_timeout', args: [readT], enabled: true },
        { type: 'directive', name: 'uwsgi_buffers', args: ['16', '16k'], enabled: true },
        { type: 'directive', name: 'client_max_body_size', args: ['25m'], enabled: true },
      ],
    })

    return server
  }

  const buildGrpcServer = (): Node => {
    // gRPC requires HTTP/2 — always emit the flag regardless of the SSL/http2
    // wizard toggles so the generated config works out of the box.
    const listenParts = [portNum]
    if (ssl) listenParts.push('ssl')
    listenParts.push('http2')
    const server: Node = {
      type: 'block',
      name: 'server',
      args: [],
      enabled: true,
      id: nid('server'),
      directives: [
        { type: 'directive', name: 'listen', args: [listenParts.join(' ')], enabled: true },
      ],
    }
    const sn = serverNameNode()
    if (sn) server.directives!.push(sn)

    const backend = (grpcBackend || 'grpc://127.0.0.1:50051').trim()
    const usesTLS = backend.startsWith('grpcs://')
    const readT = (grpcReadTimeout || '600s').trim()

    const locDirs: Node[] = [
      { type: 'directive', name: 'grpc_pass', args: [backend], enabled: true },
      { type: 'directive', name: 'grpc_set_header', args: ['Host', '$host'], enabled: true },
      { type: 'directive', name: 'grpc_set_header', args: ['X-Real-IP', '$remote_addr'], enabled: true },
      { type: 'directive', name: 'grpc_read_timeout', args: [readT], enabled: true },
      { type: 'directive', name: 'grpc_send_timeout', args: [readT], enabled: true },
      { type: 'directive', name: 'client_max_body_size', args: ['0'], enabled: true },
    ]
    if (usesTLS) {
      if (grpcSslServerName.trim()) {
        locDirs.push({ type: 'directive', name: 'grpc_ssl_server_name', args: [grpcSslServerName.trim()], enabled: true })
      }
      locDirs.push({
        type: 'directive',
        name: 'grpc_ssl_verify',
        args: [grpcSslVerify ? 'on' : 'off'],
        enabled: true,
      })
      if (grpcSslVerify) {
        locDirs.push({
          type: 'directive',
          name: 'grpc_ssl_trusted_certificate',
          args: ['/etc/ssl/certs/ca-certificates.crt'],
          enabled: true,
        })
      }
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

  const buildStaticServer = (): Node => {
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

    server.directives!.push({ type: 'directive', name: 'root', args: [staticRoot || '/var/www/html'], enabled: true })
    server.directives!.push({
      type: 'directive',
      name: 'index',
      args: (staticIndex || 'index.html').split(/\s+/).filter(Boolean),
      enabled: true,
    })

    // Optional long-cache block for /assets/ (or whatever prefix the user chose).
    if (staticLongCache && staticAssetsPrefix.trim()) {
      const prefix = staticAssetsPrefix.trim()
      server.directives!.push({
        type: 'block',
        name: 'location',
        args: [prefix],
        enabled: true,
        id: nid('location'),
        directives: [
          { type: 'directive', name: 'expires', args: ['1y'], enabled: true },
          { type: 'directive', name: 'add_header', args: ['Cache-Control', '"public, max-age=31536000, immutable"', 'always'], enabled: true },
          { type: 'directive', name: 'access_log', args: ['off'], enabled: true },
        ],
      })
    }

    // Main location: try_files with optional SPA fallback to /index.html.
    const indexFirst = (staticIndex || 'index.html').split(/\s+/).filter(Boolean)[0] || 'index.html'
    const fallback = staticSpaFallback ? `/${indexFirst.replace(/^\/+/, '')}` : '=404'
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: nid('location'),
      directives: [
        { type: 'directive', name: 'try_files', args: ['$uri', '$uri/', fallback], enabled: true },
      ],
    })

    // Deny dotfiles (common static-site hardening).
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

  const buildSpaServer = (): Node => {
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

    // Static assets served directly from disk, long-cached, access_log off.
    const staticPrefix = (spaStaticPrefix || '/_next/static/').trim()
    const staticRootValue = (spaStaticRoot || '/var/www/app/.next/static/').trim()
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: [staticPrefix],
      enabled: true,
      id: nid('location'),
      directives: [
        { type: 'directive', name: 'alias', args: [staticRootValue], enabled: true },
        { type: 'directive', name: 'expires', args: ['1y'], enabled: true },
        { type: 'directive', name: 'add_header', args: ['Cache-Control', '"public, max-age=31536000, immutable"', 'always'], enabled: true },
        { type: 'directive', name: 'access_log', args: ['off'], enabled: true },
        { type: 'directive', name: 'try_files', args: ['$uri', '=404'], enabled: true },
      ],
    })

    // Optional /public/ (or configurable) prefix for framework-agnostic static files.
    if (spaIncludePublic && spaPublicPrefix.trim() && spaPublicRoot.trim()) {
      server.directives!.push({
        type: 'block',
        name: 'location',
        args: [spaPublicPrefix.trim()],
        enabled: true,
        id: nid('location'),
        directives: [
          { type: 'directive', name: 'alias', args: [spaPublicRoot.trim()], enabled: true },
          { type: 'directive', name: 'expires', args: ['30d'], enabled: true },
          { type: 'directive', name: 'add_header', args: ['Cache-Control', '"public, max-age=2592000"', 'always'], enabled: true },
          { type: 'directive', name: 'access_log', args: ['off'], enabled: true },
          { type: 'directive', name: 'try_files', args: ['$uri', '=404'], enabled: true },
        ],
      })
    }

    // Main passthrough to the SSR backend.
    const backend = (spaSsrBackend || 'http://127.0.0.1:3000').trim()
    const proxyPassValue = backend.includes('://') ? backend : `http://${backend}`
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: nid('location'),
      directives: [
        { type: 'directive', name: 'proxy_pass', args: [proxyPassValue], enabled: true },
        { type: 'directive', name: 'proxy_http_version', args: ['1.1'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['Host', '$host'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Real-IP', '$remote_addr'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-For', '$proxy_add_x_forwarded_for'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-Proto', '$scheme'], enabled: true },
        // WebSocket / HMR support — harmless when not used, required for Next.js dev and most SSR frameworks.
        { type: 'directive', name: 'proxy_set_header', args: ['Upgrade', '$http_upgrade'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['Connection', '"upgrade"'], enabled: true },
        { type: 'directive', name: 'proxy_read_timeout', args: ['60s'], enabled: true },
      ],
    })

    return server
  }

  const buildNodeServer = (): Node => {
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

    // Optional /_next/static (or equivalent) pass-through served from disk.
    if (nodeIncludeStatic && nodeStaticPrefix.trim() && nodeStaticRoot.trim()) {
      server.directives!.push({
        type: 'block',
        name: 'location',
        args: [nodeStaticPrefix.trim()],
        enabled: true,
        id: nid('location'),
        directives: [
          { type: 'directive', name: 'alias', args: [nodeStaticRoot.trim()], enabled: true },
          { type: 'directive', name: 'expires', args: ['1y'], enabled: true },
          { type: 'directive', name: 'add_header', args: ['Cache-Control', '"public, max-age=31536000, immutable"', 'always'], enabled: true },
          { type: 'directive', name: 'access_log', args: ['off'], enabled: true },
          { type: 'directive', name: 'try_files', args: ['$uri', '=404'], enabled: true },
        ],
      })
    }

    const backend = (nodeBackend || 'http://127.0.0.1:3000').trim()
    const proxyPassValue = backend.includes('://') ? backend : `http://${backend}`
    const readT = (nodeReadTimeout || '3600s').trim()
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: nid('location'),
      directives: [
        { type: 'directive', name: 'proxy_pass', args: [proxyPassValue], enabled: true },
        { type: 'directive', name: 'proxy_http_version', args: ['1.1'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['Host', '$host'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Real-IP', '$remote_addr'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-For', '$proxy_add_x_forwarded_for'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-Proto', '$scheme'], enabled: true },
        // WebSocket / HMR — required for Next.js dev server and HMR over WS.
        { type: 'directive', name: 'proxy_set_header', args: ['Upgrade', '$http_upgrade'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['Connection', '"upgrade"'], enabled: true },
        { type: 'directive', name: 'proxy_read_timeout', args: [readT], enabled: true },
        { type: 'directive', name: 'proxy_send_timeout', args: [readT], enabled: true },
        // Streaming responses (SSE, RSC) break when nginx buffers.
        { type: 'directive', name: 'proxy_buffering', args: ['off'], enabled: true },
      ],
    })

    return server
  }

  const buildAsgiServer = (): Node => {
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

    const backend = (asgiBackend || 'http://127.0.0.1:8000').trim()
    const proxyPassValue = backend.includes('://') ? backend : `http://${backend}`
    const readT = (asgiReadTimeout || '300s').trim()
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: nid('location'),
      directives: [
        { type: 'directive', name: 'proxy_pass', args: [proxyPassValue], enabled: true },
        { type: 'directive', name: 'proxy_http_version', args: ['1.1'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['Host', '$host'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Real-IP', '$remote_addr'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-For', '$proxy_add_x_forwarded_for'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-Proto', '$scheme'], enabled: true },
        // WebSocket support — FastAPI WebSockets, Django Channels, Starlette.
        { type: 'directive', name: 'proxy_set_header', args: ['Upgrade', '$http_upgrade'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['Connection', '"upgrade"'], enabled: true },
        { type: 'directive', name: 'proxy_read_timeout', args: [readT], enabled: true },
        { type: 'directive', name: 'proxy_send_timeout', args: [readT], enabled: true },
        // ASGI apps often stream (StreamingResponse, SSE) — disable buffering.
        { type: 'directive', name: 'proxy_buffering', args: ['off'], enabled: true },
        { type: 'directive', name: 'client_max_body_size', args: ['25m'], enabled: true },
      ],
    })

    return server
  }

  const buildGoServer = (): Node => {
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

    const backend = (goBackend || 'http://127.0.0.1:8080').trim()
    const proxyPassValue = backend.includes('://') ? backend : `http://${backend}`
    const readT = (goReadTimeout || '60s').trim()
    server.directives!.push({
      type: 'block',
      name: 'location',
      args: ['/'],
      enabled: true,
      id: nid('location'),
      directives: [
        { type: 'directive', name: 'proxy_pass', args: [proxyPassValue], enabled: true },
        { type: 'directive', name: 'proxy_http_version', args: ['1.1'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['Host', '$host'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Real-IP', '$remote_addr'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-For', '$proxy_add_x_forwarded_for'], enabled: true },
        { type: 'directive', name: 'proxy_set_header', args: ['X-Forwarded-Proto', '$scheme'], enabled: true },
        { type: 'directive', name: 'proxy_connect_timeout', args: ['5s'], enabled: true },
        { type: 'directive', name: 'proxy_read_timeout', args: [readT], enabled: true },
        { type: 'directive', name: 'proxy_send_timeout', args: [readT], enabled: true },
      ],
    })

    return server
  }

  const buildServer = (): Node => {
    if (template === 'php') return buildPhpServer()
    if (template === 'uwsgi') return buildUwsgiServer()
    if (template === 'grpc') return buildGrpcServer()
    if (template === 'static') return buildStaticServer()
    if (template === 'spa') return buildSpaServer()
    if (template === 'node') return buildNodeServer()
    if (template === 'asgi') return buildAsgiServer()
    if (template === 'go') return buildGoServer()
    return buildProxyServer()
  }

  // gRPC requires HTTP/2 — force the wizard's http2 toggle on when gRPC is
  // selected and switch the default listen port to 443 if the user hasn't
  // touched it (most gRPC deployments use TLS on 443).
  useEffect(() => {
    if (template === 'grpc') setHttp2(true)
  }, [template])

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

  const totalSteps = template === 'proxy' ? 4 : 3
  const step2Label =
    template === 'php' ? 'PHP Backend' :
    template === 'uwsgi' ? 'uWSGI Backend' :
    template === 'grpc' ? 'gRPC Backend' :
    template === 'static' ? 'Webroot' :
    template === 'spa' ? 'SSR Backend + Static' :
    template === 'node' ? 'Node Backend' :
    template === 'asgi' ? 'ASGI Backend' :
    template === 'go' ? 'Service Backend' :
    'Destination'

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
            2. {step2Label}
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
                  <div className="wizard-template-desc">Forward requests to a backend / upstream (Node, Go, ASGI, etc.)</div>
                </button>
                <button
                  type="button"
                  className={`wizard-template-card${template === 'php' ? ' active' : ''}`}
                  onClick={() => setTemplate('php')}
                >
                  <div className="wizard-template-name">PHP / PHP-FPM site</div>
                  <div className="wizard-template-desc">Serve static files + dispatch <code>.php</code> to a FastCGI backend</div>
                </button>
                <button
                  type="button"
                  className={`wizard-template-card${template === 'uwsgi' ? ' active' : ''}`}
                  onClick={() => setTemplate('uwsgi')}
                >
                  <div className="wizard-template-name">Python / uWSGI</div>
                  <div className="wizard-template-desc">Dispatch to a uWSGI backend (Django, Flask) + optional <code>/static/</code> alias</div>
                </button>
                <button
                  type="button"
                  className={`wizard-template-card${template === 'grpc' ? ' active' : ''}`}
                  onClick={() => setTemplate('grpc')}
                >
                  <div className="wizard-template-name">gRPC service</div>
                  <div className="wizard-template-desc">HTTP/2 passthrough via <code>grpc_pass</code> (auto-enables <code>http2</code> on listen)</div>
                </button>
                <button
                  type="button"
                  className={`wizard-template-card${template === 'static' ? ' active' : ''}`}
                  onClick={() => setTemplate('static')}
                >
                  <div className="wizard-template-name">Static site</div>
                  <div className="wizard-template-desc">Serve a webroot with <code>try_files</code> + optional SPA fallback to <code>/index.html</code></div>
                </button>
                <button
                  type="button"
                  className={`wizard-template-card${template === 'spa' ? ' active' : ''}`}
                  onClick={() => setTemplate('spa')}
                >
                  <div className="wizard-template-name">SPA (SSR + static)</div>
                  <div className="wizard-template-desc">SSR backend via <code>proxy_pass</code> + static-asset prefix served from disk with long-cache</div>
                </button>
                <button
                  type="button"
                  className={`wizard-template-card${template === 'node' ? ' active' : ''}`}
                  onClick={() => setTemplate('node')}
                >
                  <div className="wizard-template-name">Node.js (Next/Nuxt/Remix)</div>
                  <div className="wizard-template-desc">Proxy + WebSocket upgrade + <code>/_next/static</code> pass-through with HMR-safe timeouts</div>
                </button>
                <button
                  type="button"
                  className={`wizard-template-card${template === 'asgi' ? ' active' : ''}`}
                  onClick={() => setTemplate('asgi')}
                >
                  <div className="wizard-template-name">Python ASGI (FastAPI / Channels)</div>
                  <div className="wizard-template-desc">Proxy + WebSocket upgrade + long <code>proxy_read_timeout</code> for streaming / long-poll</div>
                </button>
                <button
                  type="button"
                  className={`wizard-template-card${template === 'go' ? ' active' : ''}`}
                  onClick={() => setTemplate('go')}
                >
                  <div className="wizard-template-name">Go / generic HTTP</div>
                  <div className="wizard-template-desc">Minimal <code>proxy_pass</code> with sensible timeouts — for Go, Rust, or any plain HTTP service</div>
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
          {step === 2 && template === 'grpc' && (
            <div className="wizard-step">
              <label>gRPC backend (<code>grpc_pass</code>)</label>
              <input
                type="text"
                value={grpcBackend}
                onChange={(e) => setGrpcBackend(e.target.value)}
                placeholder="grpc://127.0.0.1:50051 or grpcs://service.internal:443"
                spellCheck={false}
              />
              <label>grpc_read_timeout / grpc_send_timeout</label>
              <input
                type="text"
                value={grpcReadTimeout}
                onChange={(e) => setGrpcReadTimeout(e.target.value)}
                placeholder="600s"
                spellCheck={false}
              />
              {grpcBackend.trim().startsWith('grpcs://') && (
                <>
                  <label>grpc_ssl_server_name (SNI)</label>
                  <input
                    type="text"
                    value={grpcSslServerName}
                    onChange={(e) => setGrpcSslServerName(e.target.value)}
                    placeholder="service.internal"
                    spellCheck={false}
                  />
                  <label className="wizard-check">
                    <input type="checkbox" checked={grpcSslVerify} onChange={(e) => setGrpcSslVerify(e.target.checked)} />
                    Verify backend certificate (<code>grpc_ssl_verify on</code>) — seeds <code>grpc_ssl_trusted_certificate</code> with the system CA bundle
                  </label>
                </>
              )}
              <div className="wizard-note">
                <strong>HTTP/2 will be enabled automatically on the listen directive.</strong>
                {' '}gRPC is HTTP/2-only; without the flag clients get stream errors.
              </div>
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(1)}>Back</button>
                <button type="button" onClick={() => setStep(3)}>Next</button>
              </div>
            </div>
          )}
          {step === 2 && template === 'static' && (
            <div className="wizard-step">
              <label>Webroot (<code>root</code>)</label>
              <input
                type="text"
                value={staticRoot}
                onChange={(e) => setStaticRoot(e.target.value)}
                placeholder="/var/www/html"
                spellCheck={false}
              />
              <label>Index files (space-separated)</label>
              <input
                type="text"
                value={staticIndex}
                onChange={(e) => setStaticIndex(e.target.value)}
                placeholder="index.html index.htm"
                spellCheck={false}
              />
              <label className="wizard-check">
                <input type="checkbox" checked={staticSpaFallback} onChange={(e) => setStaticSpaFallback(e.target.checked)} />
                SPA fallback — <code>try_files $uri $uri/ /{(staticIndex || 'index.html').split(/\s+/)[0]}</code> (client-side routing)
              </label>
              <label className="wizard-check">
                <input type="checkbox" checked={staticLongCache} onChange={(e) => setStaticLongCache(e.target.checked)} />
                Long-cache an asset prefix (<code>expires 1y</code> + <code>Cache-Control: immutable</code>)
              </label>
              {staticLongCache && (
                <>
                  <label>Asset URL prefix</label>
                  <input
                    type="text"
                    value={staticAssetsPrefix}
                    onChange={(e) => setStaticAssetsPrefix(e.target.value)}
                    placeholder="/assets/"
                    spellCheck={false}
                  />
                </>
              )}
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(1)}>Back</button>
                <button type="button" onClick={() => setStep(3)}>Next</button>
              </div>
            </div>
          )}
          {step === 2 && template === 'spa' && (
            <div className="wizard-step">
              <label>SSR backend (<code>proxy_pass</code>)</label>
              <input
                type="text"
                value={spaSsrBackend}
                onChange={(e) => setSpaSsrBackend(e.target.value)}
                placeholder="http://127.0.0.1:3000"
                spellCheck={false}
              />
              <label>Static asset URL prefix</label>
              <input
                type="text"
                value={spaStaticPrefix}
                onChange={(e) => setSpaStaticPrefix(e.target.value)}
                placeholder="/_next/static/"
                spellCheck={false}
              />
              <label>Static asset root on disk (<code>alias</code>)</label>
              <input
                type="text"
                value={spaStaticRoot}
                onChange={(e) => setSpaStaticRoot(e.target.value)}
                placeholder="/var/www/app/.next/static/"
                spellCheck={false}
              />
              <label className="wizard-check">
                <input type="checkbox" checked={spaIncludePublic} onChange={(e) => setSpaIncludePublic(e.target.checked)} />
                Also serve a <code>/public/</code>-style prefix directly from disk
              </label>
              {spaIncludePublic && (
                <>
                  <label>Public URL prefix</label>
                  <input
                    type="text"
                    value={spaPublicPrefix}
                    onChange={(e) => setSpaPublicPrefix(e.target.value)}
                    placeholder="/public/"
                    spellCheck={false}
                  />
                  <label>Public root on disk (<code>alias</code>)</label>
                  <input
                    type="text"
                    value={spaPublicRoot}
                    onChange={(e) => setSpaPublicRoot(e.target.value)}
                    placeholder="/var/www/app/public/"
                    spellCheck={false}
                  />
                </>
              )}
              <div className="wizard-note">
                <strong>Note:</strong> WebSocket upgrade headers are added automatically so Next.js dev / HMR works.
                Static prefixes are served by nginx directly (bypassing the SSR process) with <code>Cache-Control: immutable</code>.
              </div>
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(1)}>Back</button>
                <button type="button" onClick={() => setStep(3)}>Next</button>
              </div>
            </div>
          )}
          {step === 2 && template === 'uwsgi' && (
            <div className="wizard-step">
              <label>uWSGI backend (<code>uwsgi_pass</code>)</label>
              <input
                type="text"
                value={uwsgiBackend}
                onChange={(e) => setUwsgiBackend(e.target.value)}
                placeholder="unix:/run/uwsgi/app.sock or 127.0.0.1:3031"
                spellCheck={false}
              />
              <label>uwsgi_read_timeout</label>
              <input
                type="text"
                value={uwsgiReadTimeout}
                onChange={(e) => setUwsgiReadTimeout(e.target.value)}
                placeholder="300s"
                spellCheck={false}
              />
              <label className="wizard-check">
                <input type="checkbox" checked={uwsgiServeStatic} onChange={(e) => setUwsgiServeStatic(e.target.checked)} />
                Add a static-files alias served directly by nginx (bypasses uWSGI)
              </label>
              {uwsgiServeStatic && (
                <>
                  <label>Static URL prefix</label>
                  <input
                    type="text"
                    value={uwsgiStaticUrl}
                    onChange={(e) => setUwsgiStaticUrl(e.target.value)}
                    placeholder="/static/"
                    spellCheck={false}
                  />
                  <label>Static files root (<code>alias</code>)</label>
                  <input
                    type="text"
                    value={uwsgiStaticRoot}
                    onChange={(e) => setUwsgiStaticRoot(e.target.value)}
                    placeholder="/var/www/app/static/"
                    spellCheck={false}
                  />
                </>
              )}
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(1)}>Back</button>
                <button type="button" onClick={() => setStep(3)}>Next</button>
              </div>
            </div>
          )}
          {step === 2 && template === 'node' && (
            <div className="wizard-step">
              <label>Node.js backend (<code>proxy_pass</code>)</label>
              <input
                type="text"
                value={nodeBackend}
                onChange={(e) => setNodeBackend(e.target.value)}
                placeholder="http://127.0.0.1:3000"
                spellCheck={false}
              />
              <label>proxy_read_timeout / proxy_send_timeout</label>
              <input
                type="text"
                value={nodeReadTimeout}
                onChange={(e) => setNodeReadTimeout(e.target.value)}
                placeholder="3600s (HMR / SSE safe)"
                spellCheck={false}
              />
              <label className="wizard-check">
                <input type="checkbox" checked={nodeIncludeStatic} onChange={(e) => setNodeIncludeStatic(e.target.checked)} />
                Serve a static-asset prefix from disk (bypasses Node, <code>expires 1y</code> + <code>immutable</code>)
              </label>
              {nodeIncludeStatic && (
                <>
                  <label>Static asset URL prefix</label>
                  <input
                    type="text"
                    value={nodeStaticPrefix}
                    onChange={(e) => setNodeStaticPrefix(e.target.value)}
                    placeholder="/_next/static/"
                    spellCheck={false}
                  />
                  <label>Static asset root on disk (<code>alias</code>)</label>
                  <input
                    type="text"
                    value={nodeStaticRoot}
                    onChange={(e) => setNodeStaticRoot(e.target.value)}
                    placeholder="/var/www/app/.next/static/"
                    spellCheck={false}
                  />
                </>
              )}
              <div className="wizard-note">
                <strong>Note:</strong> WebSocket upgrade headers are added automatically so HMR, React Server Components, and Socket.IO work.
                <code>proxy_buffering off</code> is emitted so streaming / SSE responses flush immediately.
              </div>
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(1)}>Back</button>
                <button type="button" onClick={() => setStep(3)}>Next</button>
              </div>
            </div>
          )}
          {step === 2 && template === 'asgi' && (
            <div className="wizard-step">
              <label>ASGI backend (<code>proxy_pass</code>)</label>
              <input
                type="text"
                value={asgiBackend}
                onChange={(e) => setAsgiBackend(e.target.value)}
                placeholder="http://127.0.0.1:8000"
                spellCheck={false}
              />
              <label>proxy_read_timeout / proxy_send_timeout</label>
              <input
                type="text"
                value={asgiReadTimeout}
                onChange={(e) => setAsgiReadTimeout(e.target.value)}
                placeholder="300s"
                spellCheck={false}
              />
              <div className="wizard-note">
                <strong>Note:</strong> WebSocket upgrade headers are added automatically (FastAPI WebSockets, Django Channels, Starlette).
                <code>proxy_buffering off</code> is emitted so <code>StreamingResponse</code> / SSE endpoints flush immediately.
              </div>
              <div className="wizard-actions">
                <button type="button" onClick={() => setStep(1)}>Back</button>
                <button type="button" onClick={() => setStep(3)}>Next</button>
              </div>
            </div>
          )}
          {step === 2 && template === 'go' && (
            <div className="wizard-step">
              <label>Service backend (<code>proxy_pass</code>)</label>
              <input
                type="text"
                value={goBackend}
                onChange={(e) => setGoBackend(e.target.value)}
                placeholder="http://127.0.0.1:8080"
                spellCheck={false}
              />
              <label>proxy_read_timeout / proxy_send_timeout</label>
              <input
                type="text"
                value={goReadTimeout}
                onChange={(e) => setGoReadTimeout(e.target.value)}
                placeholder="60s"
                spellCheck={false}
              />
              <div className="wizard-note">
                <strong>Minimal template.</strong> Emits <code>proxy_pass</code> + standard forwarding headers + <code>proxy_connect_timeout 5s</code>.
                Suitable for any plain HTTP service (Go, Rust, Java, .NET). If you need WebSockets, SSE, or long-poll, use the Node.js or Python ASGI template instead.
              </div>
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
                    {template === 'uwsgi'
                      ? 'Add Python / uWSGI Site'
                      : template === 'grpc'
                      ? 'Add gRPC Service'
                      : template === 'static'
                      ? 'Add Static Site'
                      : template === 'spa'
                      ? 'Add SPA (SSR + Static)'
                      : template === 'node'
                      ? 'Add Node.js Site'
                      : template === 'asgi'
                      ? 'Add Python ASGI Site'
                      : template === 'go'
                      ? 'Add Generic HTTP Service'
                      : 'Add PHP Site'}
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
