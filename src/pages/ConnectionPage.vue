<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  Activity, HeartPulse, GitBranch, Server, Wifi, WifiOff, RefreshCw, Save,
  ShieldCheck, Clock, Zap, Check, X, ArrowDown, RotateCcw, SlidersHorizontal,
  CircleAlert
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import UiButton from '../components/UiButton.vue'
import UiSwitch from '../components/UiSwitch.vue'
import EmptyState from '../components/EmptyState.vue'
import { state, api, toast } from '../lib/store'
import { clock, timeAgo } from '../lib/format'

const form = reactive({
  heartbeatMs: 20000,
  heartbeatTimeoutMs: 60000,
  maxReconnectAttempts: 12,
  backoffBaseMs: 500,
  backoffMaxMs: 30000,
  jitter: 0.3,
  watchdog: true,
  autoRelogin: true
})

const dirty = ref(false)
const saving = ref(false)
const diagnosing = ref(false)
const dropping = ref(false)

const endpoints = computed(() => state.connection.endpoints || [])
const timeline = computed(() => state.connection.timeline || [])
const account = computed(() => state.account)

function syncFromState() {
  const c = state.connection
  form.heartbeatMs = c.heartbeatMs
  form.heartbeatTimeoutMs = c.heartbeatTimeoutMs
  form.maxReconnectAttempts = c.maxReconnectAttempts
  form.backoffBaseMs = c.backoffBaseMs
  form.backoffMaxMs = c.backoffMaxMs
  form.jitter = c.jitter
  form.watchdog = c.watchdog
  form.autoRelogin = c.autoRelogin
}

onMounted(syncFromState)
watch(
  () => state.connection,
  () => {
    if (!dirty.value) syncFromState()
  },
  { deep: true }
)

function touch() {
  dirty.value = true
}

const attempts = computed(() => Array.from({ length: 8 }, (_, i) => i + 1))
const delays = computed(() =>
  attempts.value.map((n) => {
    const base = Math.min(form.backoffMaxMs, form.backoffBaseMs * Math.pow(2, n - 1))
    return { attempt: n, delay: base, jitter: Math.round(base * form.jitter) }
  })
)
const maxDelay = computed(() => Math.max(...delays.value.map((d) => d.delay), 1))

async function save() {
  saving.value = true
  try {
    await api.post('/api/connection/config', { ...form })
    dirty.value = false
    toast({ title: '链路策略已保存', description: 'watchdog 会立即使用新的心跳与退避参数', tone: 'success' })
  } catch (err) {
    toast({ title: '保存失败', description: err.message, tone: 'danger' })
  } finally {
    saving.value = false
  }
}

async function diagnose() {
  diagnosing.value = true
  try {
    const results = await api.post('/api/connection/test')
    const ok = results.filter((r) => r.ok).length
    toast({ title: '诊断完成', description: `${ok}/${results.length} 个出口可用 · 结果已回写`, tone: ok === results.length ? 'success' : 'warning' })
  } catch (err) {
    toast({ title: '诊断失败', description: err.message, tone: 'danger' })
  } finally {
    diagnosing.value = false
  }
}

async function simulateDrop() {
  dropping.value = true
  try {
    await api.post('/api/connection/simulate-drop', { accountId: account.value?.id })
    toast({ title: '中断已注入', description: '观察右侧时间轴的退避与握手', tone: 'warning' })
  } catch (err) {
    toast({ title: '注入失败', description: err.message, tone: 'danger' })
  } finally {
    dropping.value = false
  }
}

const stateOf = (s) => ({
  connected: { label: 'CONNECTED', cls: 'badge-success' },
  healthy: { label: 'HEALTHY', cls: 'badge-success' },
  standby: { label: 'STANDBY', cls: '' },
  down: { label: 'DOWN', cls: 'badge-danger' }
}[s] || { label: s || 'UNKNOWN', cls: '' })
</script>

<template>
  <div>
    <PageHeader
      eyebrow="CONNECTION / 容灾与重连"
      title="连接容灾"
      description="心跳守望、指数退避与多出口切换。掉线不可避免，但恢复可以是有节奏的。"
    >
      <template #actions>
        <UiButton size="sm" :loading="diagnosing" @click="diagnose">
          <template #icon><Zap :size="13" /></template>
          一键诊断
        </UiButton>
        <UiButton size="sm" variant="primary" :loading="dropping" @click="simulateDrop">
          <template #icon><WifiOff :size="13" /></template>
          模拟中断
        </UiButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
      <!-- config -->
      <div class="card fade-up overflow-hidden">
        <div class="card-head">
          <div>
            <p class="micro mb-1.5">HEARTBEAT & BACKOFF</p>
            <h2 class="card-title">心跳与退避参数</h2>
            <p class="mt-1 text-[11.5px] text-muted-foreground">修改后需保存；watchdog 会热更新，无需重启会话。</p>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="dirty" class="badge badge-warning">UNSAVED</span>
            <UiButton size="sm" :loading="saving" :disabled="!dirty" @click="save">
              <template #icon><Save :size="12" /></template>
              保存
            </UiButton>
          </div>
        </div>

        <div class="grid gap-5 p-5 sm:grid-cols-2">
          <div class="field">
            <label class="field-label"><HeartPulse :size="12" /> 心跳间隔</label>
            <select v-model.number="form.heartbeatMs" class="select" @change="touch">
              <option :value="10000">10 秒 · 激进</option>
              <option :value="20000">20 秒 · 推荐</option>
              <option :value="30000">30 秒 · 保守</option>
              <option :value="60000">60 秒 · 低频</option>
            </select>
            <p class="field-hint">越短越能及时发现断线，但心跳本身也消耗配额。</p>
          </div>

          <div class="field">
            <label class="field-label"><Clock :size="12" /> 心跳超时</label>
            <select v-model.number="form.heartbeatTimeoutMs" class="select" @change="touch">
              <option :value="30000">30 秒判定离线</option>
              <option :value="60000">60 秒判定离线 · 推荐</option>
              <option :value="120000">120 秒判定离线</option>
            </select>
            <p class="field-hint">连续超时后 watchdog 触发重连流程。</p>
          </div>

          <div class="field">
            <label class="field-label"><GitBranch :size="12" /> 首次退避</label>
            <select v-model.number="form.backoffBaseMs" class="select" @change="touch">
              <option :value="300">300ms</option>
              <option :value="500">500ms · 推荐</option>
              <option :value="1000">1s</option>
              <option :value="2000">2s</option>
            </select>
            <p class="field-hint">每次失败按 2^n 增长，直到触达最大退避。</p>
          </div>

          <div class="field">
            <label class="field-label"><SlidersHorizontal :size="12" /> 最大退避</label>
            <select v-model.number="form.backoffMaxMs" class="select" @change="touch">
              <option :value="8000">8s</option>
              <option :value="15000">15s</option>
              <option :value="30000">30s · 推荐</option>
              <option :value="60000">60s</option>
            </select>
            <p class="field-hint">封顶后保持固定间隔，避免无限放大。</p>
          </div>

          <div class="field">
            <label class="field-label"><RotateCcw :size="12" /> 最大重试次数</label>
            <input
              v-model.number="form.maxReconnectAttempts"
              type="number"
              min="1"
              max="30"
              class="input input-mono"
              @input="touch"
            />
            <p class="field-hint">超过上限后挂起，等待人工介入。</p>
          </div>

          <div class="field">
            <label class="field-label"><Activity :size="12" /> 抖动系数 · {{ Math.round(form.jitter * 100) }}%</label>
            <input
              v-model.number="form.jitter"
              type="range"
              min="0"
              max="0.6"
              step="0.05"
              class="w-full"
              style="accent-color: var(--foreground)"
              @input="touch"
            />
            <p class="field-hint">在退避时间上叠加 ±抖动，避免所有节点同步重试。</p>
          </div>
        </div>

        <div class="divide-y divide-border border-t border-border">
          <div class="flex items-center justify-between px-5 py-3.5">
            <div class="flex items-start gap-3">
              <ShieldCheck :size="15" class="mt-0.5 text-muted-foreground" />
              <div>
                <p class="text-[12.5px] font-medium">Watchdog 守望</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">检测心跳超时并自动接管重连流程。</p>
              </div>
            </div>
            <UiSwitch v-model="form.watchdog" @update:model-value="touch" />
          </div>
          <div class="flex items-center justify-between px-5 py-3.5">
            <div class="flex items-start gap-3">
              <RefreshCw :size="15" class="mt-0.5 text-muted-foreground" />
              <div>
                <p class="text-[12.5px] font-medium">自动恢复登录</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">重连成功后自动恢复会话与事件订阅。</p>
              </div>
            </div>
            <UiSwitch v-model="form.autoRelogin" @update:model-value="touch" />
          </div>
        </div>
      </div>

      <!-- endpoints + timeline -->
      <div class="flex flex-col gap-4">
        <div class="card fade-up overflow-hidden" style="--d: 80ms">
          <div class="card-head">
            <div>
              <p class="micro mb-1.5">ENDPOINTS</p>
              <h2 class="card-title">链路出口</h2>
            </div>
            <span class="badge">{{ endpoints.filter((e) => e.status === 'connected' || e.status === 'healthy').length }} HEALTHY</span>
          </div>
          <div class="divide-y divide-border">
            <div v-for="ep in endpoints" :key="ep.id" class="flex items-center gap-2.5 px-4 py-3">
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
                :class="ep.priority === 1 ? 'border-border-strong bg-muted' : 'border-border bg-surface-2'"
              >
                <Server :size="12" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[12px] font-medium">{{ ep.name }}</p>
                <p class="mono truncate text-[9.5px] text-muted-foreground">{{ ep.url }}</p>
              </div>
              <div class="text-right">
                <span class="badge" :class="stateOf(ep.status).cls">{{ stateOf(ep.status).label }}</span>
                <p class="mono mt-1 text-[9.5px] text-muted-foreground">{{ ep.rtt || 0 }}ms</p>
              </div>
            </div>
          </div>
          <div class="border-t border-border p-3">
            <UiButton size="sm" block :loading="diagnosing" @click="diagnose">
              <template #icon><Zap :size="12" /></template>
              测试所有出口
            </UiButton>
          </div>
        </div>

        <div class="card fade-up overflow-hidden" style="--d: 140ms">
          <div class="card-head">
            <div>
              <p class="micro mb-1.5">RECONNECT TIMELINE</p>
              <h2 class="card-title">重连时间轴</h2>
            </div>
            <span class="badge">{{ timeline.length }}</span>
          </div>
          <div v-if="timeline.length" class="scroll-thin max-h-[300px] divide-y divide-border overflow-y-auto">
            <div v-for="item in timeline" :key="item.id" class="flex items-start gap-2.5 px-4 py-2.5">
              <span
                class="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                :style="{
                  borderColor:
                    item.state === 'success'
                      ? 'color-mix(in srgb, var(--success) 40%, transparent)'
                      : item.state === 'failed'
                        ? 'color-mix(in srgb, var(--danger) 40%, transparent)'
                        : 'var(--border)'
                }"
              >
                <Check v-if="item.state === 'success'" :size="10" style="color: var(--success)" />
                <X v-else-if="item.state === 'failed'" :size="10" style="color: var(--danger)" />
                <ArrowDown v-else :size="10" class="text-muted-foreground" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-[11.5px] font-medium">
                  第 {{ item.attempt }} 次 · {{ { waiting: '退避等待', success: '握手成功', failed: '重试耗尽' }[item.state] }}
                </p>
                <p class="mt-0.5 truncate text-[10.5px] text-muted-foreground">{{ item.note }}</p>
              </div>
              <span class="mono shrink-0 text-[9.5px] text-subtle-foreground">{{ clock(item.ts) }}</span>
            </div>
          </div>
          <EmptyState
            v-else
            title="尚未发生重连"
            description="点击「模拟中断」，观察 watchdog 如何按退避曲线恢复链路。"
          />
        </div>
      </div>
    </div>

    <!-- backoff visualizer -->
    <div class="mt-4 card fade-up p-5" style="--d: 190ms">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="micro">BACKOFF CURVE</p>
          <p class="mt-2 text-[13px] font-medium">退避曲线可视化 · 前 8 次尝试</p>
          <p class="mt-1 text-[11] text-muted-foreground">
            基准 {{ form.backoffBaseMs }}ms · 封顶 {{ form.backoffMaxMs / 1000 }}s · 抖动 ±{{ Math.round(form.jitter * 100) }}%
          </p>
        </div>
        <div class="flex gap-1.5">
          <span class="badge">EXPONENTIAL</span>
          <span class="badge">JITTERED</span>
          <span class="badge">CAPPED</span>
        </div>
      </div>
      <div class="mt-6 grid grid-cols-8 items-end gap-2 sm:gap-4">
        <div v-for="d in delays" :key="d.attempt" class="flex flex-col items-center gap-2">
          <span class="mono text-[9.5px] text-muted-foreground">{{ d.delay >= 1000 ? `${d.delay / 1000}s` : `${d.delay}ms` }}</span>
          <div class="relative w-full">
            <div class="w-full rounded-t-[3px] bg-muted" :style="{ height: '120px' }">
              <div
                class="absolute bottom-0 w-full rounded-t-[3px]"
                :style="{
                  height: `${Math.max(4, (d.delay / maxDelay) * 120)}px`,
                  background: 'var(--foreground)'
                }"
              />
              <div
                class="absolute bottom-0 w-full rounded-t-[3px]"
                :style="{
                  height: `${Math.max(4, ((d.delay + d.jitter) / maxDelay) * 120)}px`,
                  background: 'color-mix(in srgb, var(--foreground) 22%, transparent)'
                }"
              />
            </div>
          </div>
          <span class="mono text-[9px] text-subtle-foreground">#{{ d.attempt }}</span>
        </div>
      </div>
      <div class="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[10.5px] text-muted-foreground">
        <CircleAlert :size="11" />
        抖动会让每个节点的重试错开；封顶保证不会出现无限等待。
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
      <p class="text-[11.5px] text-muted-foreground">
        「不掉线」是目标而非承诺。ORBIT 用守望与退避把恢复时间压到最短，但仍需人工兜底极端场景。
      </p>
      <UiButton size="sm" :loading="saving" :disabled="!dirty" @click="save">
        <template #icon><Save :size="12" /></template>
        保存策略
      </UiButton>
    </div>
  </div>
</template>
