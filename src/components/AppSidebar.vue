<script setup>
import { computed, markRaw } from 'vue'
import {
  LayoutDashboard, Users, MessageSquare, Contact, ShieldCheck, Activity,
  Terminal, ScrollText, Settings, ChevronRight, Sun, Moon, Command
} from 'lucide-vue-next'
import BrandMark from './BrandMark.vue'
import Avatar from './Avatar.vue'
import { routes, currentPath, navigate } from '../lib/router'
import { state, toggleTheme } from '../lib/store'

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

const groups = computed(() => {
  const map = new Map()
  for (const r of routes) {
    if (!map.has(r.group)) map.set(r.group, [])
    map.get(r.group).push(r)
  }
  return [...map.entries()]
})

const queueCount = computed(() => state.risk?.queue || 0)
const statusLabel = computed(
  () => ({ live: 'LIVE', retrying: 'RETRY', connecting: 'SYNC' })[state.stream] || 'OFFLINE'
)

function go(path) {
  navigate(path)
  state.sidebarOpen = false
}
</script>

<template>
  <div
    v-if="state.sidebarOpen"
    class="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] lg:hidden"
    @click="state.sidebarOpen = false"
  />
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-border bg-surface transition-transform duration-300 lg:translate-x-0"
    :class="state.sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
  >
    <!-- brand -->
    <div class="flex items-center justify-between px-4 pb-4 pt-5">
      <div class="flex items-center gap-2.5">
        <BrandMark :size="26" />
        <div class="leading-none">
          <p class="text-[15px] font-semibold tracking-[0.14em]">ORBIT</p>
          <p class="micro mt-1.5 tracking-[0.2em]">QQ PROTOCOL</p>
        </div>
      </div>
      <span class="badge">{{ state.version }}</span>
    </div>

    <!-- active account -->
    <button
      class="mx-3 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 p-2.5 text-left transition-colors hover:border-border-strong"
      @click="go('/accounts')"
    >
      <Avatar :text="state.account?.initials || '—'" :size="34" :status="state.account?.status === 'online' ? 'online' : ''" />
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-1.5 truncate text-[12.5px] font-medium">
          {{ state.account?.nickname || '未登录' }}
          <span class="dot" :class="state.account?.status === 'online' ? 'dot-live' : 'dot-dead'" />
        </p>
        <p class="mono mt-0.5 truncate text-[10px] text-muted-foreground">
          {{ state.account?.uin || 'no account' }}
        </p>
      </div>
      <ChevronRight :size="14" class="shrink-0 text-muted-foreground" />
    </button>

    <!-- nav -->
    <nav class="scroll-thin mt-4 flex-1 overflow-y-auto px-2 pb-4">
      <div v-for="[group, items] in groups" :key="group" class="mb-4">
        <p class="micro px-2.5 pb-1.5 pt-1">{{ group }}</p>
        <button
          v-for="item in items"
          :key="item.path"
          class="group relative mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[12.5px] transition-colors"
          :class="
            currentPath === item.path
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          "
          @click="go(item.path)"
        >
          <span
            v-if="currentPath === item.path"
            class="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-foreground"
          />
          <component :is="icons[item.path]" :size="15" class="shrink-0" />
          <span class="flex-1 truncate">{{ item.label }}</span>
          <span
            v-if="item.path === '/risk' && queueCount"
            class="badge badge-warning h-[18px]"
          >{{ queueCount }}</span>
        </button>
      </div>
    </nav>

    <!-- status -->
    <div class="border-t border-border p-3">
      <div class="mb-2 flex items-center justify-between px-1">
        <span class="micro">EVENT STREAM</span>
        <span class="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span
            class="dot"
            :class="state.stream === 'live' ? 'dot-live' : state.stream === 'retrying' ? 'dot-warn' : ''"
          />
          {{ statusLabel }}
        </span>
      </div>
      <div class="mb-2 flex items-center gap-2">
        <button
          class="btn btn-secondary btn-sm flex-1"
          @click="toggleTheme"
          :aria-label="state.theme === 'dark' ? '切换亮色' : '切换暗色'"
        >
          <Sun v-if="state.theme === 'dark'" :size="13" />
          <Moon v-else :size="13" />
          {{ state.theme === 'dark' ? '亮色' : '暗色' }}
        </button>
        <button
          class="btn btn-secondary btn-sm flex-1"
          @click="state.paletteOpen = true"
        >
          <Command :size="13" /> ⌘K
        </button>
      </div>
      <p class="mono px-1 text-[9.5px] tracking-[0.08em] text-subtle-foreground">
        CORE {{ state.version }} · ONEBOT 11
      </p>
    </div>
  </aside>
</template>
