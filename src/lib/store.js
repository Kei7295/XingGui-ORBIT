import { reactive, computed, watch } from 'vue'
import { api, setConsoleToken } from './api'

export { api }

const THEME_KEY = 'orbit.theme'

function preferredTheme() {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const state = reactive({
  theme: preferredTheme(),
  ready: false,
  stream: 'connecting',
  version: '0.0.1-beta',
  account: null,
  accounts: [],
  overview: {
    uptimeSeconds: 0,
    onlineSeconds: 0,
    reconnects: 0,
    messagesSent: 0,
    messagesReceived: 0,
    rateWindow: [],
    latency: [],
    latencyMs: 0,
    riskScore: 0,
    riskTrend: []
  },
  risk: {
    enabled: true,
    safeMode: false,
    score: 0,
    level: 'low',
    budget: { used: 0, limit: 0, windowSeconds: 60 },
    cooldownUntil: 0,
    rules: [],
    intercepted: []
  },
  connection: {
    heartbeatMs: 20000,
    heartbeatTimeoutMs: 60000,
    reconnectAttempts: 3,
    maxReconnectAttempts: 12,
    backoffBaseMs: 500,
    backoffMaxMs: 30000,
    jitter: 0.3,
    watchdog: true,
    autoRelogin: true,
    endpoints: [],
    timeline: []
  },
  activity: [],
  logs: [],
  lastMessage: null,
  messageSeq: 0,
  health: { cpu: 0, memory: 0, queue: 0, sessions: 0 },
  notices: 0,
  paletteOpen: false,
  sidebarOpen: false
})

export const toasts = reactive([])
let toastSeq = 0
let stream = null
let retryTimer = null
let retryDelay = 1000

export const isDark = computed(() => state.theme === 'dark')
export const online = computed(() => !!state.account && state.account.status === 'online')
export const accountStatusLabel = computed(() => {
  const s = state.account?.status
  return { online: '在线', offline: '离线', scanning: '待扫码', confirming: '确认中', reconnecting: '重连中' }[s] || '未知'
})

export function applyTheme(theme) {
  state.theme = theme
  const dark = theme === 'dark'
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.classList.toggle('light', !dark)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#000000' : '#ffffff')
  localStorage.setItem(THEME_KEY, theme)
}

export function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark')
  toast({
    title: state.theme === 'dark' ? '已切换到暗色' : '已切换到亮色',
    tone: 'info'
  })
}

watch(
  () => state.theme,
  (t) => applyTheme(t),
  { immediate: true }
)

export function toast({ title, description = '', tone = 'default', timeout = 4200 }) {
  const id = ++toastSeq
  toasts.push({ id, title, description, tone })
  if (timeout) setTimeout(() => dismissToast(id), timeout)
  return id
}

export function dismissToast(id) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i > -1) toasts.splice(i, 1)
}

export function setSnapshot(payload) {
  if (payload.account !== undefined) state.account = payload.account
  if (payload.accounts !== undefined) state.accounts = payload.accounts
  if (payload.overview !== undefined) Object.assign(state.overview, payload.overview)
  if (payload.risk !== undefined) Object.assign(state.risk, payload.risk)
  if (payload.connection !== undefined) Object.assign(state.connection, payload.connection)
  if (payload.health !== undefined) Object.assign(state.health, payload.health)
}

export function pushActivity(item) {
  state.activity.unshift(item)
  if (state.activity.length > 20) state.activity.length = 20
}

export async function bootstrap() {
  const [data, logs] = await Promise.all([api.get('/api/bootstrap'), api.get('/api/logs')])
  setConsoleToken(data.consoleToken)
  state.version = data.version || '0.0.1-beta'
  setSnapshot(data)
  state.activity = data.activity || []
  state.logs = Array.isArray(logs) ? logs : []
  state.ready = true
  connectStream()
}

export function connectStream() {
  if (stream) stream.close()
  state.stream = 'connecting'
  stream = new EventSource('/api/events')

  stream.addEventListener('open', () => {
    state.stream = 'live'
    retryDelay = 1000
  })

  stream.addEventListener('snapshot', (e) => {
    try {
      const data = JSON.parse(e.data)
      setSnapshot(data)
      if (data.activity) state.activity = data.activity
    } catch {
      /* ignore malformed frame */
    }
  })

  stream.addEventListener('message', (e) => {
    try {
      state.lastMessage = JSON.parse(e.data)
      state.messageSeq += 1
    } catch {
      /* ignore */
    }
  })

  stream.addEventListener('log', (e) => {
    try {
      const entry = JSON.parse(e.data)
      state.logs.unshift(entry)
      if (state.logs.length > 320) state.logs.length = 320
    } catch {
      /* ignore */
    }
  })

  stream.addEventListener('notice', (e) => {
    try {
      const data = JSON.parse(e.data)
      pushActivity(data)
      if (data.toast) {
        toast({ title: data.title, description: data.detail, tone: data.tone || 'default' })
      }
      state.notices += 1
    } catch {
      /* ignore */
    }
  })

  stream.addEventListener('error', () => {
    if (stream && stream.readyState !== EventSource.OPEN) {
      state.stream = 'retrying'
      stream.close()
      clearTimeout(retryTimer)
      retryTimer = setTimeout(connectStream, retryDelay)
      retryDelay = Math.min(retryDelay * 1.7, 15000)
    }
  })
}

export async function refresh() {
  try {
    const data = await api.get('/api/bootstrap')
    if (data.consoleToken) setConsoleToken(data.consoleToken)
    setSnapshot(data)
    state.activity = data.activity || []
  } catch (err) {
    toast({ title: '刷新失败', description: err.message, tone: 'danger' })
  }
}

// keep uptime ticking locally between SSE snapshots
setInterval(() => {
  if (state.account?.status === 'online') {
    state.overview.uptimeSeconds += 1
    state.overview.onlineSeconds += 1
  }
}, 1000)
