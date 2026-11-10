import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { engine, ApiError, VERSION } from './engine.js'
import { createProtocolHub } from './protocol/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.ORBIT_HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

/* ------------------------------------------------------------------ helpers */

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 2_000_000) {
        reject(new ApiError(413, '请求体过大'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({ _raw: raw })
      }
    })
    req.on('error', reject)
  })
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
}

/* -------------------------------------------------------------- guard rails */

const rateBuckets = new Map()

function rateLimited(req, scope, limit, windowMs = 60_000) {
  const ip = req.socket.remoteAddress || 'unknown'
  const key = `${scope}:${ip}`
  const t = Date.now()
  let bucket = rateBuckets.get(key)
  if (!bucket || t >= bucket.resetAt) {
    bucket = { count: 0, resetAt: t + windowMs }
    rateBuckets.set(key, bucket)
  }
  bucket.count += 1
  if (rateBuckets.size > 20_000) rateBuckets.clear()
  return bucket.count > limit
}

function consoleWriteAllowed(req) {
  if (req.method === 'GET' || req.method === 'OPTIONS') return true
  const token = req.headers['x-orbit-token']
  return typeof token === 'string' && token === engine.consoleToken
}

/* -------------------------------------------------------------------- SSE */

const sseClients = new Set()

function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.write(`retry: 2000\n\n`)
  const client = { res }
  sseClients.add(client)
  res.write(`event: snapshot\ndata: ${JSON.stringify(engine.snapshot())}\n\n`)

  const ping = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`)
    } catch {
      clearInterval(ping)
    }
  }, 15000)

  req.on('close', () => {
    clearInterval(ping)
    sseClients.delete(client)
  })
}

/* --------------------------------------------------------- onebot over ws */

const wss = new WebSocketServer({ noServer: true })

function wsSend(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload))
}

function buildOneBotEvent(conversationId, message) {
  const conv = engine.conversations.find((c) => c.id === conversationId)
  if (!conv || !message) return null
  return {
    post_type: message.direction === 'out' ? 'message_sent' : 'message',
    ...engine.toOneBotMessage(conv, message)
  }
}

function broadcastOneBot(payload) {
  const frame = JSON.stringify(payload)
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(frame)
  }
}

/* ---------------------------------------------- reverse ws + http reporting */

const reverse = { ws: null, timer: null, key: '' }
let reportKey = ''

function reverseSend(payload) {
  if (reverse.ws?.readyState === WebSocket.OPEN) reverse.ws.send(JSON.stringify(payload))
}

function stopReverse() {
  clearTimeout(reverse.timer)
  reverse.timer = null
  if (reverse.ws) {
    reverse.ws.removeAllListeners()
    try {
      reverse.ws.close()
    } catch {
      /* ignore */
    }
    reverse.ws = null
  }
}

function scheduleReverse() {
  clearTimeout(reverse.timer)
  const cfg = engine.network.reverseWs
  reverse.timer = setTimeout(connectReverse, cfg.reconnectMs)
}

function connectReverse() {
  reverse.timer = null
  const cfg = engine.network.reverseWs
  if (!cfg.enabled || reverse.ws) return
  const token = engine.apiKeys.find((k) => k.id === 'key_main')?.token || ''
  const ws = new WebSocket(cfg.url, { headers: { Authorization: `Bearer ${token}` } })
  reverse.ws = ws
  cfg.attempts += 1
  engine.setReverseStatus({ status: 'connecting', lastError: '' })

  ws.on('open', () => {
    engine.setReverseStatus({ status: 'connected', attempts: 0, lastError: '' })
  })

  ws.on('message', (raw) => {
    let body
    try {
      body = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!body || !body.action) return
    reverseSend(executeOneBot(body.action, body.params || {}, body.echo || '', token))
  })

  ws.on('error', (err) => {
    engine.setReverseStatus({ status: 'error', lastError: err.message })
  })

  ws.on('close', () => {
    if (reverse.ws !== ws) return
    reverse.ws = null
    if (!engine.network.reverseWs.enabled) {
      engine.setReverseStatus({ status: 'idle' })
      return
    }
    engine.setReverseStatus({ status: 'connecting', lastError: '连接已断开，等待重连' })
    scheduleReverse()
  })
}

function syncReverse() {
  const cfg = engine.network.reverseWs
  const key = `${cfg.enabled}|${cfg.url}`
  if (reverse.key === key) return
  reverse.key = key
  stopReverse()
  if (cfg.enabled) {
    reverse.timer = setTimeout(connectReverse, 0)
  } else {
    engine.setReverseStatus({ status: 'idle', lastError: '' })
  }
}

async function reportEvent(payload) {
  const cfg = engine.network.httpReport
  if (!cfg.enabled || !payload) return
  const headers = {
    'Content-Type': 'application/json',
    'X-Self-ID': String(engine.primaryAccount()?.uin || 0)
  }
  if (cfg.secret) headers.Authorization = `Bearer ${cfg.secret}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 5000)
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: ac.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    engine.noteReportDelivery(true)
  } catch (err) {
    engine.noteReportDelivery(false, err.message)
  } finally {
    clearTimeout(timer)
  }
}

function syncReport() {
  const cfg = engine.network.httpReport
  const key = `${cfg.enabled}|${cfg.url}|${cfg.secret}`
  if (reportKey === key) return
  const wasEnabled = reportKey.split('|')[0] === 'true'
  reportKey = key
  if (cfg.enabled && !wasEnabled) {
    engine.setReportStatus({ status: 'ready' })
    reportEvent(metaEvent('lifecycle'))
    engine.log('info', 'NET', `HTTP 事件上报已启用 · ${cfg.url}`)
  }
}

function syncNetwork() {
  syncReverse()
  syncReport()
}

function metaEvent(type) {
  return {
    post_type: 'meta_event',
    meta_event_type: type,
    time: Math.floor(Date.now() / 1000),
    self_id: Number(engine.primaryAccount()?.uin || 0),
    interval: 30_000,
    status: { online: true, good: true }
  }
}

wss.on('connection', (ws, req, token) => {
  ws.token = token
  wsSend(ws, metaEvent('lifecycle'))
  const heartbeat = setInterval(() => wsSend(ws, metaEvent('heartbeat')), 30_000)
  ws.on('close', () => clearInterval(heartbeat))
  ws.on('error', () => clearInterval(heartbeat))
  ws.on('message', (raw) => {
    let action = ''
    let params = {}
    let echo = ''
    try {
      const body = JSON.parse(String(raw))
      action = body.action || ''
      params = body.params || {}
      echo = body.echo || ''
    } catch {
      return wsSend(ws, { status: 'failed', retcode: 1400, data: null, message: 'JSON 解析失败', echo })
    }
    wsSend(ws, executeOneBot(action, params, echo, ws.token))
  })
})

engine.on('broadcast', ({ event, data }) => {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    try {
      client.res.write(frame)
    } catch {
      sseClients.delete(client)
    }
  }
  if (event === 'message' && data?.message) {
    const payload = buildOneBotEvent(data.conversationId, data.message)
    if (payload) {
      broadcastOneBot(payload)
      reverseSend(payload)
      reportEvent(payload)
    }
  }
})

/* ------------------------------------------------------------------ routes */

const routes = []
const route = (method, pattern, handler) => routes.push({ method, pattern, handler })

route('GET', /^\/api\/bootstrap$/, () => ({
  ...engine.snapshot(),
  version: VERSION,
  consoleToken: engine.consoleToken
}))
route('GET', /^\/api\/accounts$/, () => engine.accounts)
route('POST', /^\/api\/accounts\/([\w-]+)\/login$/, (ctx) => engine.startLogin(ctx.params[0]))
route('POST', /^\/api\/accounts\/([\w-]+)\/confirm$/, (ctx) => engine.confirmLogin(ctx.params[0]))
route('POST', /^\/api\/accounts\/([\w-]+)\/logout$/, (ctx) => engine.logout(ctx.params[0]))
route('POST', /^\/api\/accounts\/([\w-]+)\/reconnect$/, (ctx) => engine.reconnect(ctx.params[0]))
route('POST', /^\/api\/accounts\/([\w-]+)\/simulate-drop$/, (ctx) => engine.simulateDrop(ctx.params[0]))

route('GET', /^\/api\/conversations$/, () => engine.conversationsList())
route('GET', /^\/api\/conversations\/([\w:.-]+)\/messages$/, (ctx) => engine.getMessages(ctx.params[0]))
route('POST', /^\/api\/conversations\/([\w:.-]+)\/messages$/, (ctx, body) =>
  engine.sendMessage(ctx.params[0], body.content)
)
route('POST', /^\/api\/conversations\/([\w:.-]+)\/read$/, (ctx) => engine.markRead(ctx.params[0]))

route('GET', /^\/api\/friends$/, () => engine.friendsList())
route('GET', /^\/api\/groups$/, () => engine.groupsList())
route('GET', /^\/api\/groups\/([\w-]+)\/members$/, (ctx) => engine.groupMembers(ctx.params[0]))
route('POST', /^\/api\/groups\/([\w-]+)\/action$/, (ctx, body) =>
  engine.groupAction(ctx.params[0], body.action)
)

route('GET', /^\/api\/risk$/, () => ({
  ...engine.snapshot().risk,
  enabled: engine.risk.enabled
}))
route('POST', /^\/api\/risk\/config$/, (ctx, body) => engine.updateRiskConfig(body))

route('GET', /^\/api\/connection$/, () => engine.snapshot().connection)
route('POST', /^\/api\/connection\/config$/, (ctx, body) => engine.updateConnectionConfig(body))
route('POST', /^\/api\/connection\/test$/, () => engine.testConnection())
route('POST', /^\/api\/connection\/simulate-drop$/, (ctx, body) =>
  engine.simulateDrop(body.accountId)
)

route('GET', /^\/api\/logs$/, (ctx) => engine.logsList(ctx.query))
route('GET', /^\/api\/keys$/, () => engine.listKeys())
route('POST', /^\/api\/keys$/, (ctx, body) => engine.createKey(body.name))
route('POST', /^\/api\/keys\/([\w-]+)\/rotate$/, (ctx) => engine.rotateKey(ctx.params[0]))
route('POST', /^\/api\/keys\/([\w-]+)\/toggle$/, (ctx) => engine.toggleKey(ctx.params[0]))
route('DELETE', /^\/api\/keys\/([\w-]+)$/, (ctx) => engine.removeKey(ctx.params[0]))

route('GET', /^\/api\/settings$/, () => engine.settings)
route('POST', /^\/api\/settings$/, (ctx, body) => engine.updateSettings(body))

const protocol = createProtocolHub()
route('GET', /^\/api\/protocol$/, () => protocol.status())
route('POST', /^\/api\/protocol$/, async (ctx, body) => {
  try {
    return await protocol.update(body)
  } catch (err) {
    throw new ApiError(400, err.message)
  }
})
route('POST', /^\/api\/protocol\/probe$/, () => protocol.probe())

route('GET', /^\/api\/onebot\/actions$/, () => engine.onebotActions())
route('GET', /^\/api\/onebot\/network$/, () => engine.networkView())
route('POST', /^\/api\/onebot\/network$/, (ctx, body) => {
  const view = engine.updateNetworkConfig(body)
  syncNetwork()
  return view
})
route('POST', /^\/api\/onebot\/network\/reconnect$/, () => {
  stopReverse()
  reverse.key = ''
  syncNetwork()
  return engine.networkView()
})

/* ------------------------------------------------------------------ onebot */

function executeOneBot(action, params = {}, echo = '', token = '') {
  if (!action) {
    return { status: 'failed', retcode: 1400, data: null, message: '缺少 action', echo }
  }
  try {
    const data = engine.handleOneBot(action, params)
    const key = engine.apiKeys.find((k) => k.enabled && k.token === token)
    if (key) key.lastUsed = Date.now()
    return { status: 'ok', retcode: 0, data, echo }
  } catch (err) {
    const retcode = err.data?.retcode || (err.status === 404 ? 1404 : err.status || 1400)
    return { status: 'failed', retcode, data: null, message: err.message, echo }
  }
}

async function handleOneBot(req, res, url) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }
  if (rateLimited(req, 'onebot', 120)) {
    return json(res, 429, { status: 'failed', retcode: 1409, data: null, message: '请求过于频繁，请稍后再试' })
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(res, 405, { status: 'failed', retcode: 1404, data: null, message: '仅支持 GET/POST' })
  }

  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const queryToken = url.searchParams.get('access_token') || ''
  const token = bearer || queryToken

  if (!engine.authToken(token)) {
    return json(res, 401, {
      status: 'failed',
      retcode: 1403,
      data: null,
      message: 'access_token 无效或缺失'
    })
  }

  let action = url.searchParams.get('action') || ''
  let params = {}
  let echo = url.searchParams.get('echo') || ''

  if (req.method === 'POST') {
    const body = await readBody(req)
    action = body.action || action
    params = body.params || {}
    echo = body.echo || echo
  } else {
    const raw = url.searchParams.get('params')
    if (raw) {
      try {
        params = JSON.parse(raw)
      } catch {
        params = {}
      }
    }
  }

  const payload = executeOneBot(action, params, echo, token)
  return json(res, payload.status === 'ok' ? 200 : action ? 200 : 400, payload)
}

/* ------------------------------------------------------------------ static */

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(
      `<body style="font-family:ui-monospace,monospace;background:#fff;color:#111;padding:48px;">
        <h1 style="font-size:20px;letter-spacing:-.02em;">星轨 ORBIT ${VERSION} is running.</h1>
        <p style="color:#555;font-size:13px;">dist/ 尚未构建。<br/>开发：npm run dev（前端 5173 代理到 8787）<br/>生产：npm run build 后重启本进程。</p>
        <p style="color:#888;font-size:12px;margin-top:32px;">API 可用：GET /api/bootstrap · POST /onebot?access_token=orbit-demo-token</p>
      </body>`
    )
  }

  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const safe = rel.replace(/\.\.+/g, '.')
  const file = path.join(DIST, safe)
  if (!file.startsWith(DIST)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }

  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file)
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cache
    })
    return fs.createReadStream(file).pipe(res)
  }

  // SPA fallback
  const index = path.join(DIST, 'index.html')
  if (fs.existsSync(index)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
    return fs.createReadStream(index).pipe(res)
  }
  res.writeHead(404)
  res.end('Not found')
}

/* -------------------------------------------------------------------- main */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname
  let routePath = pathname
  try {
    routePath = decodeURIComponent(pathname)
  } catch {
    /* keep raw path when encoding is malformed */
  }

  try {
    if (pathname === '/api/events') return sseHandler(req, res)

    if (pathname.startsWith('/onebot')) {
      return await handleOneBot(req, res, url)
    }

    if (pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Orbit-Token',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
        })
        return res.end()
      }
      if (pathname !== '/api/events' && rateLimited(req, 'api', 600)) {
        return json(res, 429, { message: '请求过于频繁，请稍后再试' })
      }
      if (!consoleWriteAllowed(req)) {
        return json(res, 403, { message: '控制台写操作令牌缺失或无效' })
      }

      for (const r of routes) {
        if (r.method !== req.method) continue
        const match = r.pattern.exec(routePath)
        if (!match) continue
        const query = Object.fromEntries(url.searchParams.entries())
        let body = {}
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          body = await readBody(req)
        }
        const params = match.slice(1).map((p) => {
          try {
            return decodeURIComponent(p)
          } catch {
            return p
          }
        })
        const result = await r.handler({ params, query }, body)
        return json(res, 200, result)
      }
      return json(res, 404, { message: `未知接口 ${req.method} ${pathname}` })
    }

    serveStatic(req, res, pathname)
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500
    if (status >= 500) console.error(err)
    json(res, status, {
      message: err.message || '服务器内部错误',
      ...(err.data ? { data: err.data } : {})
    })
  }
})

server.on('upgrade', (req, socket, head) => {
  let url
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  } catch {
    socket.destroy()
    return
  }
  if (url.pathname !== '/onebot/ws') {
    socket.destroy()
    return
  }
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const token = bearer || url.searchParams.get('access_token') || ''
  if (!engine.authToken(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, token))
})

server.listen(PORT, HOST, () => {
  syncNetwork()
  engine.log('info', 'CORE', `星轨 ORBIT ${VERSION} 启动 · 端口 ${PORT}`)
  console.log(`\n  星轨 · ORBIT ${VERSION}\n  ─────────────────────────────\n  控制台 / API : http://localhost:${PORT}\n  OneBot HTTP  : http://localhost:${PORT}/onebot?access_token=orbit-demo-token\n  OneBot WS    : ws://localhost:${PORT}/onebot/ws?access_token=orbit-demo-token\n`)
})

function shutdown(signal) {
  console.log(`\n  ${signal} received · persisting state`)
  engine.persist()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1200)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
