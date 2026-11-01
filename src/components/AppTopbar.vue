<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Menu, Search, Bell, Moon, Sun, ChevronDown, Users, ArrowUpRight, CircleDot
} from 'lucide-vue-next'
import Avatar from './Avatar.vue'
import { state, toggleTheme } from '../lib/store'
import { currentRoute, navigate } from '../lib/router'

const menuOpen = ref(false)
const accountRef = ref(null)

const streamLabel = computed(
  () => ({ live: 'LIVE', retrying: 'RETRY', connecting: 'SYNC' })[state.stream] || 'IDLE'
)

function outside(e) {
  if (accountRef.value && !accountRef.value.contains(e.target)) menuOpen.value = false
}

onMounted(() => document.addEventListener('click', outside))
onBeforeUnmount(() => document.removeEventListener('click', outside))

function openLogs() {
  state.notices = 0
  navigate('/logs')
}
</script>

<template>
  <header class="glass sticky top-0 z-30 border-b border-border">
    <div class="flex h-14 items-center gap-3 px-4 sm:px-6">
      <button
        class="btn btn-ghost btn-sm btn-icon lg:hidden"
        aria-label="打开导航"
        @click="state.sidebarOpen = true"
      >
        <Menu :size="18" />
      </button>

      <div class="hidden items-center gap-2 sm:flex">
        <span class="micro">ORBIT</span>
        <span class="text-[10px] text-subtle-foreground">/</span>
        <span class="text-[12px] font-medium">{{ currentRoute.label }}</span>
      </div>

      <button
        class="ml-auto flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-muted-foreground transition-colors hover:text-foreground md:hidden"
        aria-label="搜索与命令"
        @click="state.paletteOpen = true"
      >
        <Search :size="15" />
      </button>

      <button
        class="hidden h-8 w-[240px] items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-left text-[12px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground md:flex"
        @click="state.paletteOpen = true"
      >
        <Search :size="14" />
        <span class="flex-1">搜索页面、执行动作</span>
        <kbd>⌘K</kbd>
      </button>

      <div class="ml-auto flex items-center gap-1.5">
        <span
          class="hidden items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-muted-foreground lg:flex"
        >
          <span
            class="dot"
            :class="state.stream === 'live' ? 'dot-live' : state.stream === 'retrying' ? 'dot-warn' : ''"
          />
          {{ streamLabel }}
        </span>

        <span class="hidden items-center gap-1 font-mono text-[10px] text-muted-foreground sm:flex md:mr-1">
          RTT
          <span class="text-foreground">{{ Math.round(state.overview.latencyMs) }}ms</span>
        </span>

        <button
          class="btn btn-ghost btn-sm btn-icon tip relative"
          data-tip="运行日志"
          @click="openLogs"
        >
          <Bell :size="15" />
          <span
            v-if="state.notices > 0"
            class="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
            style="background: var(--warning)"
          />
        </button>

        <button
          class="btn btn-ghost btn-sm btn-icon tip"
          :data-tip="state.theme === 'dark' ? '亮色模式' : '暗色模式'"
          @click="toggleTheme"
        >
          <Sun v-if="state.theme === 'dark'" :size="15" />
          <Moon v-else :size="15" />
        </button>

        <div ref="accountRef" class="relative">
          <button
            class="ml-0.5 flex items-center gap-1.5 rounded-md border border-transparent p-0.5 pr-1 transition-colors hover:border-border hover:bg-surface-2"
            @click="menuOpen = !menuOpen"
          >
            <Avatar
              :text="state.account?.initials || '—'"
              :size="27"
              :status="state.account?.status === 'online' ? 'online' : ''"
            />
            <ChevronDown :size="13" class="text-muted-foreground" />
          </button>

          <Transition name="drop">
            <div
              v-if="menuOpen"
              class="absolute right-0 top-[calc(100%+8px)] z-40 w-[268px] overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            >
              <div class="border-b border-border px-3 py-2.5">
                <p class="micro mb-1.5">ACTIVE SESSION</p>
                <p class="text-[12.5px] font-medium">{{ state.account?.nickname || '未登录' }}</p>
                <p class="mono mt-0.5 text-[10px] text-muted-foreground">
                  {{ state.account?.uin || '—' }} · {{ state.account?.device || '' }}
                </p>
              </div>
              <div class="max-h-48 overflow-y-auto py-1">
                <button
                  v-for="acc in state.accounts"
                  :key="acc.id"
                  class="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/70"
                  @click="navigate('/accounts'); menuOpen = false"
                >
                  <CircleDot
                    :size="13"
                    :style="{ color: acc.status === 'online' ? 'var(--success)' : 'var(--subtle-foreground)' }"
                  />
                  <span class="min-w-0 flex-1 truncate text-[12px]">{{ acc.nickname }}</span>
                  <span class="mono text-[10px] text-muted-foreground">{{ acc.uin }}</span>
                </button>
              </div>
              <button
                class="flex w-full items-center justify-between border-t border-border px-3 py-2.5 text-[12px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                @click="navigate('/accounts'); menuOpen = false"
              >
                <span class="flex items-center gap-2"><Users :size="13" /> 账号管理</span>
                <ArrowUpRight :size="13" />
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.drop-enter-active,
.drop-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
