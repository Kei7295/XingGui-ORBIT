<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, markRaw } from 'vue'
import {
  Search, LayoutDashboard, Users, MessageSquare, Contact, ShieldCheck, Activity,
  Terminal, ScrollText, Settings, Moon, Zap, RefreshCw, WifiOff, Copy, ShieldAlert
} from 'lucide-vue-next'
import { routes, navigate } from '../lib/router'
import { state, toggleTheme, toast, api, refresh } from '../lib/store'

const icons = markRaw({
  '/': LayoutDashboard,
  '/accounts': Users,
  '/messages': MessageSquare,
  '/contacts': Contact,
  '/risk': ShieldCheck,
  '/connection': Activity,
  '/api': Terminal,
  '/logs': ScrollText,
  '/settings': Settings
})

const query = ref('')
const active = ref(0)
const inputEl = ref(null)

const actions = computed(() => [
  {
    id: 'act-theme',
    group: '快捷动作',
    label: state.theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题',
    hint: '外观',
    icon: markRaw(Moon),
    run: () => toggleTheme()
  },
  {
    id: 'act-drop',
    group: '快捷动作',
    label: '模拟链路中断（演练容灾）',
    hint: '会触发退避重连',
    icon: markRaw(WifiOff),
    run: async () => {
      await api.post('/api/connection/simulate-drop', { accountId: state.account?.id })
      toast({ title: '已注入链路中断', description: 'watchdog 将按退避策略接管', tone: 'warning' })
    }
  },
  {
    id: 'act-safe',
    group: '快捷动作',
    label: state.risk.safeMode ? '关闭安全模式' : '开启安全模式',
    hint: '挂起全部外发消息',
    icon: markRaw(ShieldAlert),
    run: async () => {
      await api.post('/api/risk/config', { safeMode: !state.risk.safeMode })
      toast({ title: state.risk.safeMode ? '安全模式已开启' : '已恢复发送', tone: state.risk.safeMode ? 'warning' : 'success' })
    }
  },
  {
    id: 'act-refresh',
    group: '快捷动作',
    label: '刷新内核快照',
    hint: 'bootstrap',
    icon: markRaw(RefreshCw),
    run: () => refresh()
  },
  {
    id: 'act-copy',
    group: '快捷动作',
    label: '复制 OneBot 接口地址',
    hint: 'HTTP · 带 token',
    icon: markRaw(Copy),
    run: async () => {
      const url = `${location.origin}/onebot?access_token=orbit-demo-token`
      try {
        await navigator.clipboard.writeText(url)
        toast({ title: '已复制接口地址', description: url, tone: 'success' })
      } catch {
        toast({ title: '复制失败', description: url, tone: 'warning' })
      }
    }
  },
  {
    id: 'act-risk',
    group: '快捷动作',
    label: '一键诊断链路',
    hint: '测试全部出口',
    icon: markRaw(Zap),
    run: async () => {
      await api.post('/api/connection/test')
      toast({ title: '诊断完成', description: '结果已写入链路面板', tone: 'success' })
    }
  }
])

const navItems = computed(() =>
  routes.map((r) => ({
    id: `nav-${r.path}`,
    group: '跳转',
    label: r.label,
    hint: r.path,
    icon: icons[r.path],
    run: () => navigate(r.path)
  }))
)

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  const all = [...navItems.value, ...actions.value]
  if (!q) return all
  return all.filter((i) => `${i.label} ${i.hint} ${i.group}`.toLowerCase().includes(q))
})

const grouped = computed(() => {
  const map = new Map()
  for (const item of results.value) {
    if (!map.has(item.group)) map.set(item.group, [])
    map.get(item.group).push(item)
  }
  return [...map.entries()]
})

const flat = computed(() => results.value)

watch(query, () => (active.value = 0))

watch(
  () => state.paletteOpen,
  async (open) => {
    if (open) {
      query.value = ''
      active.value = 0
      document.body.style.overflow = 'hidden'
      await nextTick()
      inputEl.value?.focus()
    } else {
      document.body.style.overflow = ''
    }
  }
)

function close() {
  state.paletteOpen = false
}

function run(item) {
  close()
  setTimeout(() => item.run(), 80)
}

async function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    state.paletteOpen = !state.paletteOpen
    return
  }
  if (!state.paletteOpen) return
  if (e.key === 'Escape') return close()
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = Math.min(flat.value.length - 1, active.value + 1)
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(0, active.value - 1)
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const item = flat.value[active.value]
    if (item) run(item)
  }
}

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="state.paletteOpen" class="fixed inset-0 z-[65] flex items-start justify-center px-4 pt-[12vh]">
        <div class="absolute inset-0 bg-black/45 backdrop-blur-[2px]" @click="close" />
        <div class="palette-panel relative z-10 w-full max-w-[620px] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          <div class="flex items-center gap-3 border-b border-border px-4">
            <Search :size="16" class="shrink-0 text-muted-foreground" />
            <input
              ref="inputEl"
              v-model="query"
              class="h-12 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-subtle-foreground"
              placeholder="跳转页面、执行动作…"
            />
            <kbd>ESC</kbd>
          </div>

          <div class="scroll-thin max-h-[52vh] overflow-y-auto py-2">
            <template v-for="[group, items] in grouped" :key="group">
              <p class="micro px-4 pb-1.5 pt-2">{{ group }}</p>
              <button
                v-for="item in items"
                :key="item.id"
                class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                :class="flat[active]?.id === item.id ? 'bg-muted' : 'hover:bg-muted/60'"
                @mouseenter="active = flat.findIndex((f) => f.id === item.id)"
                @click="run(item)"
              >
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                  <component :is="item.icon" :size="14" />
                </span>
                <span class="min-w-0 flex-1 truncate text-[13px]">{{ item.label }}</span>
                <span class="mono shrink-0 text-[10px] text-muted-foreground">{{ item.hint }}</span>
              </button>
            </template>
            <p v-if="!flat.length" class="px-4 py-10 text-center text-[12px] text-muted-foreground">
              没有匹配的结果
            </p>
          </div>

          <div class="flex items-center justify-between border-t border-border px-4 py-2.5">
            <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd class="ml-2">↵</kbd> 执行
            </span>
            <span class="micro">ORBIT COMMAND</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.palette-enter-active,
.palette-leave-active {
  transition: opacity 0.18s ease;
}
.palette-enter-active .palette-panel,
.palette-leave-active .palette-panel {
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
.palette-enter-from .palette-panel,
.palette-leave-to .palette-panel {
  transform: translateY(-8px) scale(0.99);
  opacity: 0;
}
</style>
