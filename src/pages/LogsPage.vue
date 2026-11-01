<script setup>
import { computed, ref } from 'vue'
import {
  Pause, Play, Download, RefreshCw, Search, Copy, ScrollText, Radio,
  CircleCheck, TriangleAlert, Bug, Info, Database, Trash2
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import UiButton from '../components/UiButton.vue'
import UiSegmented from '../components/UiSegmented.vue'
import EmptyState from '../components/EmptyState.vue'
import { state, toast, refresh } from '../lib/store'
import { dateTime, clock } from '../lib/format'

const level = ref('all')
const query = ref('')
const paused = ref(false)
const frozen = ref(null)
const copied = ref(false)

const source = computed(() => (paused.value ? frozen.value || [] : state.logs))
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return source.value.filter((l) => {
    if (level.value !== 'all' && l.level !== level.value) return false
    if (!q) return true
    return (
      l.message.toLowerCase().includes(q) ||
      l.module.toLowerCase().includes(q) ||
      l.level.includes(q)
    )
  })
})

const counts = computed(() => {
  const base = { debug: 0, info: 0, warn: 0, error: 0 }
  for (const l of source.value) if (base[l.level] !== undefined) base[l.level] += 1
  return base
})

const modules = computed(() => {
  const map = new Map()
  for (const l of source.value) map.set(l.module, (map.get(l.module) || 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
})

const levelStyle = {
  debug: 'color: var(--subtle-foreground)',
  info: 'color: var(--foreground)',
  warn: 'color: var(--warning)',
  error: 'color: var(--danger)'
}
const levelBadge = {
  debug: '',
  info: 'badge-info',
  warn: 'badge-warning',
  error: 'badge-danger'
}

function togglePause() {
  if (!paused.value) {
    frozen.value = state.logs.slice()
    paused.value = true
    toast({ title: '日志流已暂停', description: '恢复后会重新同步最新日志', tone: 'info' })
  } else {
    paused.value = false
    frozen.value = null
    toast({ title: '日志流已恢复', tone: 'success' })
  }
}

function exportLogs() {
  const text = filtered.value
    .map((l) => `${dateTime(l.ts)} [${l.level.toUpperCase().padEnd(5)}] [${l.module}] ${l.message}`)
    .join('\n')
  const blob = new Blob([text || 'ORBIT · 暂无日志'], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orbit-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`
  a.click()
  URL.revokeObjectURL(url)
  toast({ title: '日志已导出', description: `${filtered.value.length} 行`, tone: 'success' })
}

async function copyAll() {
  try {
    await navigator.clipboard.writeText(
      filtered.value.map((l) => `${clock(l.ts)} [${l.level}] [${l.module}] ${l.message}`).join('\n')
    )
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
    toast({ title: '已复制当前视图', tone: 'success' })
  } catch {
    toast({ title: '复制失败', tone: 'warning' })
  }
}

const levelIcon = { debug: Bug, info: Info, warn: TriangleAlert, error: CircleCheck }
</script>

<template>
  <div>
    <PageHeader
      eyebrow="LOGS / 运行日志"
      title="运行日志"
      description="内核的每一次心跳、重连、发送与拦截都在这里留痕。SSE 推送，320 条环形缓冲。"
    >
      <template #actions>
        <UiButton size="sm" :loading="false" @click="refresh">
          <template #icon><RefreshCw :size="13" /></template>
          刷新
        </UiButton>
        <UiButton size="sm" @click="togglePause">
          <template #icon>
            <Play v-if="paused" :size="13" />
            <Pause v-else :size="13" />
          </template>
          {{ paused ? '恢复' : '暂停' }}
        </UiButton>
        <UiButton size="sm" variant="primary" @click="exportLogs">
          <template #icon><Download :size="13" /></template>
          导出
        </UiButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 xl:grid-cols-[1fr_280px]">
      <div class="card overflow-hidden">
        <div class="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-2">
            <UiSegmented
              v-model="level"
              :options="[
                { value: 'all', label: '全部' },
                { value: 'debug', label: 'DEBUG' },
                { value: 'info', label: 'INFO' },
                { value: 'warn', label: 'WARN' },
                { value: 'error', label: 'ERROR' }
              ]"
            />
            <span class="hidden items-center gap-1.5 sm:flex">
              <span class="dot" :class="paused ? 'dot-warn' : 'dot-live'" />
              <span class="mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
                {{ paused ? 'PAUSED' : 'STREAMING' }}
              </span>
            </span>
          </div>
          <div class="flex items-center gap-2">
            <div class="relative flex-1 sm:w-[260px]">
              <Search :size="13" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input v-model="query" class="input h-8 pl-8 text-[12px]" placeholder="搜索消息、模块、级别…" />
            </div>
            <button class="btn btn-ghost btn-sm btn-icon" @click="copyAll">
              <CircleCheck v-if="copied" :size="14" style="color: var(--success)" />
              <Copy v-else :size="14" />
            </button>
          </div>
        </div>

        <div class="grid grid-cols-[64px_64px_1fr] items-center gap-2 border-b border-border bg-surface-2 px-4 py-2 sm:grid-cols-[92px_66px_76px_1fr]">
          <span class="micro hidden sm:block">TIME</span>
          <span class="micro">LEVEL</span>
          <span class="micro hidden sm:block">MODULE</span>
          <span class="micro">MESSAGE</span>
        </div>

        <div class="scroll-thin overflow-y-auto" style="height: calc(100dvh - 330px); min-height: 420px">
          <div
            v-for="entry in filtered"
            :key="entry.id"
            class="fade-in grid grid-cols-[64px_64px_1fr] items-start gap-2 border-b border-border px-4 py-2 font-mono text-[11px] hover:bg-surface-2/60 sm:grid-cols-[92px_66px_76px_1fr]"
          >
            <span class="truncate text-subtle-foreground">{{ dateTime(entry.ts).slice(11, 19) }}</span>
            <span>
              <span class="badge h-[17px] px-1" :class="levelBadge[entry.level]" :style="levelStyle[entry.level]">
                {{ entry.level }}
              </span>
            </span>
            <span class="hidden truncate text-muted-foreground sm:block">{{ entry.module }}</span>
            <span class="break-words leading-relaxed">{{ entry.message }}</span>
          </div>
          <EmptyState
            v-if="!filtered.length"
            title="没有匹配的日志"
            description="调整级别或关键词；新的日志会通过 SSE 实时补进来。"
          />
        </div>

        <div class="flex items-center justify-between border-t border-border px-4 py-2">
          <span class="mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
            SHOWING {{ filtered.length }} / {{ source.length }}
          </span>
          <span class="flex items-center gap-1.5 font-mono text-[9.5px] text-muted-foreground">
            <Database :size="10" /> 环形缓冲 320
          </span>
        </div>
      </div>

      <!-- side -->
      <div class="flex flex-col gap-4">
        <div class="card p-4">
          <p class="micro mb-3">LEVEL DISTRIBUTION</p>
          <div class="space-y-2.5">
            <div v-for="(count, lvl) in counts" :key="lvl">
              <div class="mb-1 flex items-center justify-between text-[10.5px]">
                <span class="flex items-center gap-1.5" :style="levelStyle[lvl]">
                  <span class="dot" :style="{ background: lvl === 'error' ? 'var(--danger)' : lvl === 'warn' ? 'var(--warning)' : lvl === 'info' ? 'var(--foreground)' : 'var(--subtle-foreground)' }" />
                  {{ lvl.toUpperCase() }}
                </span>
                <span class="mono">{{ count }}</span>
              </div>
              <div class="progress" style="height: 4px">
                <span
                  :style="{
                    width: `${source.length ? (count / source.length) * 100 : 0}%`,
                    background: lvl === 'error' ? 'var(--danger)' : lvl === 'warn' ? 'var(--warning)' : 'var(--foreground)'
                  }"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="card p-4">
          <p class="micro mb-3">MODULES</p>
          <div class="space-y-2">
            <div v-for="[mod, count] in modules" :key="mod" class="flex items-center justify-between text-[11px]">
              <span class="mono text-muted-foreground">{{ mod }}</span>
              <span class="mono">{{ count }}</span>
            </div>
            <p v-if="!modules.length" class="text-[11px] text-muted-foreground">等待日志进入…</p>
          </div>
        </div>

        <div class="card p-4">
          <div class="mb-2 flex items-center justify-between">
            <p class="micro">STREAM</p>
            <span class="dot" :class="state.stream === 'live' ? 'dot-live' : 'dot-warn'" />
          </div>
          <p class="text-[12px] font-medium">{{ state.stream === 'live' ? '实时连接正常' : '正在重连事件流' }}</p>
          <p class="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
            日志通过 SSE 的 <span class="mono">log</span> 事件传输；断线时前端会按退避自动重连。
          </p>
          <div class="mt-3 flex items-center gap-2">
            <Radio :size="12" class="text-muted-foreground" />
            <span class="mono text-[9.5px] text-muted-foreground">/api/events</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
