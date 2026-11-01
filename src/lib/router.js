import { ref, computed } from 'vue'

export const routes = [
  { path: '/', label: '概览', group: '监控' },
  { path: '/accounts', label: '账号', group: '监控' },
  { path: '/messages', label: '消息', group: '运营' },
  { path: '/contacts', label: '联系人与群', group: '运营' },
  { path: '/risk', label: '风险防护', group: '安全' },
  { path: '/connection', label: '连接容灾', group: '安全' },
  { path: '/api', label: 'API 调试场', group: '开发' },
  { path: '/logs', label: '运行日志', group: '开发' },
  { path: '/settings', label: '设置', group: '系统' }
]

const read = () => {
  const raw = window.location.hash.replace(/^#/, '')
  return raw && raw.startsWith('/') ? raw : '/'
}

export const currentPath = ref(read())

window.addEventListener('hashchange', () => {
  currentPath.value = read()
  window.scrollTo({ top: 0 })
})

export const currentRoute = computed(
  () => routes.find((r) => r.path === currentPath.value) || routes[0]
)

export function navigate(path) {
  if (path === currentPath.value) return
  window.location.hash = path
}
