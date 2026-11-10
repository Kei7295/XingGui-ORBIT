import { WebSocket } from 'ws'

function toWsUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '')
  if (!value) return ''
  if (value.startsWith('ws://') || value.startsWith('wss://')) return value
  if (value.startsWith('http://')) return 'ws://' + value.slice(7)
  if (value.startsWith('https://')) return 'wss://' + value.slice(8)
  return ''
}

/**
 * 以 OneBot 11 客户端身份连到一个真实的协议端（例如 NapCat）。
 * 只做协议互联，不包含对方的任何代码。
 */
export function createUpstream({
  url,
  token = '',
  onEvent = () => {},
  onState = () => {},
  WebSocketImpl = WebSocket,
  reconnectMs = 3000
} = {}) {
  const target = toWsUrl(url)
  const state = {
    status: 'idle',
    url: target,
    connectedAt: 0,
    reconnects: 0,
    lastError: ''
  }
  const pending = new Map()
  let socket = null
  let closed = false
  let timer = null
  let seq = 0

  function emitState() {
    onState({ ...state })
  }

  function connectUrl() {
    if (!token) return target
    const join = target.includes('?') ? '&' : '?'
    return `${target}${join}access_token=${encodeURIComponent(token)}`
  }

  function schedule() {
    if (closed) return
    clearTimeout(timer)
    timer = setTimeout(connect, reconnectMs)
  }

  function settle(echo, payload) {
    const item = pending.get(echo)
    if (!item) return false
    pending.delete(echo)
    clearTimeout(item.timer)
    item.resolve(payload)
    return true
  }

  function connect() {
    if (closed || !target) return
    state.status = 'connecting'
    emitState()

    const ws = new WebSocketImpl(connectUrl(), {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    socket = ws

    ws.on('open', () => {
      state.status = 'online'
      state.connectedAt = Date.now()
      state.lastError = ''
      emitState()
    })

    ws.on('message', (raw) => {
      let payload
      try {
        payload = JSON.parse(String(raw))
      } catch {
        return
      }
      if (payload.echo && settle(payload.echo, payload)) return
      onEvent(payload)
    })

    ws.on('error', (err) => {
      state.lastError = err.message || '上游连接错误'
    })

    ws.on('close', () => {
      for (const item of pending.values()) {
        clearTimeout(item.timer)
        item.reject(new Error('上游连接已断开'))
      }
      pending.clear()
      socket = null
      if (closed) return
      state.status = 'offline'
      state.reconnects += 1
      emitState()
      schedule()
    })
  }

  function request(action, params = {}, timeoutMs = 15000) {
    if (!socket || state.status !== 'online') {
      return Promise.reject(new Error('上游协议端未连接'))
    }
    const echo = `orbit-${++seq}`
    return new Promise((resolve, reject) => {
      const timerId = setTimeout(() => {
        pending.delete(echo)
        reject(new Error(`上游响应超时：${action}`))
      }, timeoutMs)
      pending.set(echo, { resolve, reject, timer: timerId })
      try {
        socket.send(JSON.stringify({ action, params, echo }))
      } catch (err) {
        pending.delete(echo)
        clearTimeout(timerId)
        reject(err)
      }
    })
  }

  function close() {
    closed = true
    clearTimeout(timer)
    if (socket) socket.close()
    socket = null
    state.status = 'closed'
    emitState()
  }

  if (target) connect()

  return {
    state,
    request,
    close,
    get online() {
      return state.status === 'online'
    }
  }
}

export { toWsUrl }
