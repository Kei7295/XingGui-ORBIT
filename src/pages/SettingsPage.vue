<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Settings2, Save, Sun, Moon, Download, RotateCcw, KeyRound, Copy, Check,
  ShieldCheck, Server, Info, ArrowUpRight, Bot, Webhook, Database, Clock,
  Terminal, Layers, CircleAlert, Trash2, Network, Plug, RefreshCw
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import BrandMark from '../components/BrandMark.vue'
import Avatar from '../components/Avatar.vue'
import UiButton from '../components/UiButton.vue'
import UiSwitch from '../components/UiSwitch.vue'
import { state, api, toast, applyTheme } from '../lib/store'
import { duration, num } from '../lib/format'
import { navigate } from '../lib/router'

const form = reactive({
  botName: 'ORBIT',
  webhook: '',
  defaultReply: '',
  autoTraffic: true,
  autoReply: false,
  nightQuiet: false,
  dataRetentionDays: 7
})
const dirty = ref(false)
const saving = ref(false)
const loading = ref(true)
const copied = ref(false)

const network = reactive({
  reverseEnabled: false,
  reverseUrl: '',
  reconnectMs: 3000,
  reverseStatus: 'idle',
  reverseError: '',
  reportEnabled: false,
  reportUrl: '',
  reportSecret: '',
  reportStatus: 'idle',
  reportError: '',
  delivered: 0,
  failed: 0
})
const networkBusy = ref(false)
const networkDirty = ref(false)

const reverseStatusLabel = computed(
  () =>
    ({
      idle: '未启用',
      connecting: '连接中',
      connected: '已连接',
      error: '连接失败'
    })[network.reverseStatus] || network.reverseStatus
)
const reverseStatusTone = computed(() =>
  network.reverseStatus === 'connected' ? 'badge-success' : network.reverseStatus === 'error' ? 'badge-danger' : 'badge'
)
const reportStatusTone = computed(() =>
  network.reportStatus === 'error' ? 'badge-danger' : network.reportStatus === 'ready' ? 'badge-success' : 'badge'
)

const account = computed(() => state.account)
const online = computed(() => account.value?.status === 'online')
const endpointUrl = computed(() => `${location.origin}/onebot?access_token=orbit-demo-token`)
const wsEndpointUrl = computed(() =>
  `${location.origin.replace(/^http/, 'ws')}/onebot/ws?access_token=orbit-demo-token`
)

function touch() {
  dirty.value = true
}

async function load() {
  loading.value = true
  try {
    const data = await api.get('/api/settings')
    Object.assign(form, {
      botName: data.botName ?? form.botName,
      webhook: data.webhook ?? form.webhook,
      defaultReply: data.defaultReply ?? form.defaultReply,
      autoTraffic: data.autoTraffic ?? form.autoTraffic,
      autoReply: data.autoReply ?? form.autoReply,
      nightQuiet: data.nightQuiet ?? form.nightQuiet,
      dataRetentionDays: data.dataRetentionDays ?? form.dataRetentionDays
    })
    dirty.value = false
  } catch (err) {
    toast({ title: '读取设置失败', description: err.message, tone: 'danger' })
  } finally {
    loading.value = false
  }
  await loadNetwork()
}

function applyNetwork(data) {
  if (!data) return
  network.reverseEnabled = !!data.reverseWs?.enabled
  network.reverseUrl = data.reverseWs?.url || ''
  network.reconnectMs = data.reverseWs?.reconnectMs ?? 3000
  network.reverseStatus = data.reverseWs?.status || 'idle'
  network.reverseError = data.reverseWs?.lastError || ''
  network.reportEnabled = !!data.httpReport?.enabled
  network.reportUrl = data.httpReport?.url || ''
  network.reportStatus = data.httpReport?.status || 'idle'
  network.reportError = data.httpReport?.lastError || ''
  network.delivered = data.httpReport?.delivered || 0
  network.failed = data.httpReport?.failed || 0
  networkDirty.value = false
}

async function loadNetwork() {
  try {
    applyNetwork(await api.get('/api/onebot/network'))
  } catch (err) {
    toast({ title: '读取网络配置失败', description: err.message, tone: 'danger' })
  }
}

async function saveNetwork() {
  networkBusy.value = true
  try {
    const payload = {
      reverseWs: {
        enabled: network.reverseEnabled,
        url: network.reverseUrl,
        reconnectMs: Number(network.reconnectMs)
      },
      httpReport: {
        enabled: network.reportEnabled,
        url: network.reportUrl
      }
    }
    if (network.reportSecret) payload.httpReport.secret = network.reportSecret
    applyNetwork(await api.post('/api/onebot/network', payload))
    network.reportSecret = ''
    toast({ title: '网络配置已生效', description: '反向 WS 与事件上报已同步到内核', tone: 'success' })
  } catch (err) {
    toast({ title: '网络配置保存失败', description: err.message, tone: 'danger' })
  } finally {
    networkBusy.value = false
  }
}

async function reconnectNetwork() {
  networkBusy.value = true
  try {
    applyNetwork(await api.post('/api/onebot/network/reconnect', {}))
    toast({ title: '已触发重连', description: '反向 WS 将按退避策略重新连接', tone: 'info' })
  } catch (err) {
    toast({ title: '重连失败', description: err.message, tone: 'danger' })
  } finally {
    networkBusy.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await api.post('/api/settings', {
      botName: form.botName,
      webhook: form.webhook,
      defaultReply: form.defaultReply,
      autoTraffic: form.autoTraffic,
      autoReply: form.autoReply,
      nightQuiet: form.nightQuiet,
      dataRetentionDays: Number(form.dataRetentionDays)
    })
    dirty.value = false
    toast({ title: '设置已保存', description: '行为开关已同步到内核', tone: 'success' })
  } catch (err) {
    toast({ title: '保存失败', description: err.message, tone: 'danger' })
  } finally {
    saving.value = false
  }
}

async function copyEndpoint() {
  const url = `${location.origin}/onebot?access_token=orbit-demo-token`
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
    toast({ title: '已复制 OneBot 地址', tone: 'success' })
  } catch {
    toast({ title: '复制失败', description: url, tone: 'warning' })
  }
}

async function exportSnapshot() {
  try {
    const data = await api.get('/api/bootstrap')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orbit-state-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: '快照已导出', tone: 'success' })
  } catch (err) {
    toast({ title: '导出失败', description: err.message, tone: 'danger' })
  }
}

function resetPreferences() {
  localStorage.removeItem('orbit.theme')
  toast({ title: '本地偏好已清除', description: '正在重新加载…', tone: 'info' })
  setTimeout(() => window.location.reload(), 600)
}

onMounted(load)
</script>

<template>
  <div>
    <PageHeader
      eyebrow="SETTINGS / 系统设置"
      title="设置"
      description="身份、行为、外观与数据。所有改动都会写入内核，并通过快照持久化。"
    >
      <template #actions>
        <span v-if="dirty" class="badge badge-warning">UNSAVED CHANGES</span>
        <UiButton size="sm" :loading="loading" @click="load">
          <template #icon><RotateCcw :size="13" /></template>
          重置表单
        </UiButton>
        <UiButton size="sm" variant="primary" :loading="saving" :disabled="!dirty" @click="save">
          <template #icon><Save :size="13" /></template>
          保存更改
        </UiButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div class="flex flex-col gap-4">
        <!-- identity -->
        <div class="card fade-up overflow-hidden">
          <div class="card-head">
            <div>
              <p class="micro mb-1.5">IDENTITY</p>
              <h2 class="card-title">身份与回调</h2>
            </div>
            <Bot :size="15" class="text-muted-foreground" />
          </div>
          <div class="grid gap-4 p-5 sm:grid-cols-2">
            <div class="field">
              <label class="field-label">协议端名称</label>
              <input v-model="form.botName" class="input" @input="touch" />
              <p class="field-hint">展示在控制台与 OneBot get_version_info 中。</p>
            </div>
            <div class="field">
              <label class="field-label"><Webhook :size="12" /> Webhook 地址</label>
              <input v-model="form.webhook" class="input input-mono" placeholder="https://example.com/hook" @input="touch" />
              <p class="field-hint">事件推送目标，真实端接入时填写。</p>
            </div>
            <div class="field sm:col-span-2">
              <label class="field-label">默认回复语</label>
              <input v-model="form.defaultReply" class="input" @input="touch" />
              <p class="field-hint">当自动回复开启且没有匹配规则时使用。</p>
            </div>
          </div>
        </div>

        <!-- behaviour -->
        <div class="card fade-up overflow-hidden" style="--d: 60ms">
          <div class="card-head">
            <div>
              <p class="micro mb-1.5">BEHAVIOUR</p>
              <h2 class="card-title">行为开关</h2>
            </div>
            <Settings2 :size="15" class="text-muted-foreground" />
          </div>
          <div class="divide-y divide-border">
            <div class="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p class="text-[12.5px] font-medium">模拟入站流量</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">内核会按 7–19 秒的节奏合成收到消息，用于演示事件流。</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="badge">{{ form.autoTraffic ? 'ON' : 'OFF' }}</span>
                <UiSwitch v-model="form.autoTraffic" @update:model-value="touch" />
              </div>
            </div>
            <div class="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p class="text-[12.5px] font-medium">自动回复</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">收到消息后按 1.5–5 秒延迟回复，同样经过风险守卫。</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="badge">{{ form.autoReply ? 'ON' : 'OFF' }}</span>
                <UiSwitch v-model="form.autoReply" @update:model-value="touch" />
              </div>
            </div>
            <div class="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p class="text-[12.5px] font-medium">夜间静默</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">23:30–07:00 降低拟人化破绽，只处理白名单会话。</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="badge">{{ form.nightQuiet ? 'ON' : 'OFF' }}</span>
                <UiSwitch v-model="form.nightQuiet" @update:model-value="touch" />
              </div>
            </div>
            <div class="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <p class="text-[12.5px] font-medium"><Database :size="11" /> 数据保留</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">内存消息与会话快照的清理周期。</p>
              </div>
              <select v-model.number="form.dataRetentionDays" class="select h-8 w-[120px] text-[12px]" @change="touch">
                <option :value="1">1 天</option>
                <option :value="3">3 天</option>
                <option :value="7">7 天 · 推荐</option>
                <option :value="30">30 天</option>
              </select>
            </div>
          </div>
        </div>

        <!-- network -->
        <div class="card fade-up overflow-hidden" style="--d: 90ms">
          <div class="card-head">
            <div>
              <p class="micro mb-1.5">NETWORK / ONEBOT LINK</p>
              <h2 class="card-title">反向 WS 与事件上报</h2>
            </div>
            <Network :size="15" class="text-muted-foreground" />
          </div>
          <div class="grid gap-4 p-5 sm:grid-cols-2">
            <div class="field sm:col-span-2">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <label class="field-label"><Plug :size="12" /> 反向 WebSocket</label>
                  <p class="field-hint">主动连接外部 OneBot 实现，接收动作请求并回传事件。</p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="badge" :class="reverseStatusTone">{{ reverseStatusLabel }}</span>
                  <UiSwitch v-model="network.reverseEnabled" @update:model-value="networkDirty = true" />
                </div>
              </div>
            </div>
            <div class="field sm:col-span-2">
              <label class="field-label">反向 WS 地址</label>
              <input
                v-model="network.reverseUrl"
                class="input input-mono"
                placeholder="ws://127.0.0.1:8082/onebot/v11/ws"
                :disabled="!network.reverseEnabled"
                @input="networkDirty = true"
              />
              <p class="field-hint">
                连接时自动携带 <span class="mono">Authorization: Bearer &lt;主密钥&gt;</span>。当前状态：{{ reverseStatusLabel }}
                <span v-if="network.reverseError" class="text-[color:var(--danger)]"> · {{ network.reverseError }}</span>
              </p>
            </div>
            <div class="field">
              <label class="field-label">重连间隔（毫秒）</label>
              <input
                v-model.number="network.reconnectMs"
                type="number"
                min="500"
                max="60000"
                step="500"
                class="input input-mono"
                :disabled="!network.reverseEnabled"
                @input="networkDirty = true"
              />
              <p class="field-hint">断线后按该间隔自动重连，范围 500–60000ms。</p>
            </div>
            <div class="field">
              <label class="field-label">HTTP 事件上报</label>
              <div class="flex items-center justify-between gap-3">
                <p class="field-hint !mt-0">POST JSON 到外部地址，支持 Bearer 校验。</p>
                <div class="flex items-center gap-2">
                  <span class="badge" :class="reportStatusTone">{{ network.reportEnabled ? 'ON' : 'OFF' }}</span>
                  <UiSwitch v-model="network.reportEnabled" @update:model-value="networkDirty = true" />
                </div>
              </div>
            </div>
            <div class="field sm:col-span-2">
              <label class="field-label">上报地址</label>
              <input
                v-model="network.reportUrl"
                class="input input-mono"
                placeholder="http://127.0.0.1:8083/onebot/event"
                :disabled="!network.reportEnabled"
                @input="networkDirty = true"
              />
            </div>
            <div class="field">
              <label class="field-label">上报密钥（可选）</label>
              <input
                v-model="network.reportSecret"
                type="password"
                class="input input-mono"
                placeholder="留空则沿用当前密钥"
                :disabled="!network.reportEnabled"
                @input="networkDirty = true"
              />
              <p class="field-hint">写入后以 Bearer Token 发送，不回显明文。</p>
            </div>
            <div class="field">
              <label class="field-label">上报统计</label>
              <div class="panel-inset flex items-center justify-between px-3 py-2 text-[11px]">
                <span class="text-muted-foreground">成功 / 失败</span>
                <span class="mono">{{ network.delivered }} / {{ network.failed }}</span>
              </div>
              <p v-if="network.reportError" class="field-hint text-[color:var(--danger)]">{{ network.reportError }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            <p class="text-[11px] text-muted-foreground">改动即时生效；运行时状态来自内核实时快照。</p>
            <div class="flex items-center gap-2">
              <UiButton size="sm" :loading="networkBusy" @click="reconnectNetwork">
                <template #icon><RefreshCw :size="12" /></template>
                重连
              </UiButton>
              <UiButton size="sm" variant="primary" :loading="networkBusy" @click="saveNetwork">
                <template #icon><Save :size="12" /></template>
                应用网络配置
              </UiButton>
            </div>
          </div>
        </div>

        <!-- appearance -->
        <div class="card fade-up overflow-hidden" style="--d: 120ms">
          <div class="card-head">
            <div>
              <p class="micro mb-1.5">APPEARANCE</p>
              <h2 class="card-title">外观</h2>
            </div>
            <Layers :size="15" class="text-muted-foreground" />
          </div>
          <div class="grid gap-4 p-5 sm:grid-cols-2">
            <button
              class="theme-tile"
              :data-active="state.theme === 'light'"
              @click="applyTheme('light')"
            >
              <div class="theme-preview light-preview">
                <div class="tp-side" />
                <div class="tp-main">
                  <div class="tp-line" />
                  <div class="tp-line short" />
                  <div class="tp-card" />
                </div>
              </div>
              <div class="mt-3 flex items-center justify-between">
                <span class="flex items-center gap-1.5 text-[12px] font-medium"><Sun :size="12" /> 亮色</span>
                <span class="mono text-[9.5px] text-muted-foreground">ZINC · PAPER</span>
              </div>
            </button>
            <button
              class="theme-tile"
              :data-active="state.theme === 'dark'"
              @click="applyTheme('dark')"
            >
              <div class="theme-preview dark-preview">
                <div class="tp-side" />
                <div class="tp-main">
                  <div class="tp-line" />
                  <div class="tp-line short" />
                  <div class="tp-card" />
                </div>
              </div>
              <div class="mt-3 flex items-center justify-between">
                <span class="flex items-center gap-1.5 text-[12px] font-medium"><Moon :size="12" /> 暗色</span>
                <span class="mono text-[9.5px] text-muted-foreground">ZINC · VOID</span>
              </div>
            </button>
            <p class="text-[11px] leading-relaxed text-muted-foreground sm:col-span-2">
              配色与圆角全部由 CSS 变量驱动，默认是一套克制的 zinc 黑白灰；语义色仅用于状态与风险。
            </p>
          </div>
        </div>

        <!-- danger -->
        <div class="card fade-up overflow-hidden" style="--d: 180ms">
          <div class="card-head">
            <div>
              <p class="micro mb-1.5">DATA & DANGER ZONE</p>
              <h2 class="card-title">数据操作</h2>
            </div>
            <CircleAlert :size="15" style="color: var(--warning)" />
          </div>
          <div class="divide-y divide-border">
            <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div>
                <p class="text-[12.5px] font-medium">导出当前快照</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">包含账号、会话、风险与链路配置的 JSON。</p>
              </div>
              <UiButton size="sm" @click="exportSnapshot">
                <template #icon><Download :size="12" /></template>
                导出 JSON
              </UiButton>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div>
                <p class="text-[12.5px] font-medium">清除本地偏好</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">移除主题记忆并重新加载页面，不影响内核数据。</p>
              </div>
              <UiButton size="sm" variant="ghost" @click="resetPreferences">
                <template #icon><Trash2 :size="12" /></template>
                清除并重载
              </UiButton>
            </div>
          </div>
        </div>
      </div>

      <!-- side -->
      <div class="flex flex-col gap-4">
        <div class="card fade-up p-5" style="--d: 80ms">
          <div class="mb-4 flex items-center justify-between">
            <p class="micro">CURRENT SESSION</p>
            <span class="badge" :class="online ? 'badge-success' : 'badge-danger'">{{ online ? 'ONLINE' : 'OFFLINE' }}</span>
          </div>
          <div class="flex items-center gap-3">
            <Avatar :text="account?.initials || '—'" :size="42" :status="online ? 'online' : ''" />
            <div class="min-w-0">
              <p class="truncate text-[13px] font-medium">{{ account?.nickname || '未登录' }}</p>
              <p class="mono truncate text-[10px] text-muted-foreground">{{ account?.uin || '—' }}</p>
            </div>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <p class="micro">UPTIME</p>
              <p class="mono mt-1">{{ duration(state.overview.onlineSeconds) }}</p>
            </div>
            <div>
              <p class="micro">RISK</p>
              <p class="mono mt-1">{{ state.risk.score }}</p>
            </div>
            <div>
              <p class="micro">SENT</p>
              <p class="mono mt-1">{{ num(state.overview.messagesSent) }}</p>
            </div>
            <div>
              <p class="micro">QUEUE</p>
              <p class="mono mt-1">{{ state.risk.queue }}</p>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm mt-4 w-full" @click="navigate('/accounts')">
            管理账号 <ArrowUpRight :size="12" />
          </button>
        </div>

        <div class="card fade-up p-5" style="--d: 140ms">
          <p class="micro mb-3">ONEBOT ENDPOINT</p>
          <div class="panel-inset space-y-2 p-3">
            <p class="mono break-all text-[10px] leading-relaxed">POST {{ endpointUrl }}</p>
            <p class="mono break-all text-[10px] leading-relaxed text-muted-foreground">WS {{ wsEndpointUrl }}</p>
          </div>
          <div class="mt-2 flex gap-2">
            <UiButton size="sm" block @click="copyEndpoint">
              <template #icon>
                <Check v-if="copied" :size="12" style="color: var(--success)" />
                <Copy v-else :size="12" />
              </template>
              {{ copied ? '已复制' : '复制地址' }}
            </UiButton>
            <UiButton size="sm" block @click="navigate('/api')">
              <template #icon><Terminal :size="12" /></template>
              调试场
            </UiButton>
          </div>
          <div class="mt-3 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <KeyRound :size="11" /> 主密钥可在 API 调试场查看与轮换
          </div>
        </div>

        <div class="card fade-up p-5" style="--d: 200ms">
          <div class="flex items-center gap-2.5">
            <BrandMark :size="30" />
            <div>
              <p class="text-[13px] font-semibold tracking-[0.12em]">ORBIT</p>
              <p class="micro mt-1">QQ PROTOCOL CORE</p>
            </div>
          </div>
          <p class="mt-4 text-[11.5px] leading-relaxed text-muted-foreground">
            纯原创的工业风协议端控制台。Vue 3 + Vite + Tailwind v4 构建，Node 24 内核，OneBot 11 兼容。
          </p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <span class="badge">{{ state.version }}</span>
            <span class="badge">VUE 3</span>
            <span class="badge">VITE</span>
            <span class="badge">TAILWIND 4</span>
            <span class="badge">NODE 24</span>
            <span class="badge">SSE</span>
            <span class="badge">WS</span>
          </div>
          <div class="mt-4 flex items-start gap-2 border-t border-border pt-3 text-[10.5px] leading-relaxed text-muted-foreground">
            <ShieldCheck :size="12" class="mt-0.5 shrink-0" />
            仅用于合规的账号管理与技术演示，不提供规避平台风控的保证。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.theme-tile {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 8px;
  text-align: left;
  transition: all 0.18s ease;
  background: var(--surface);
}
.theme-tile:hover {
  border-color: var(--border-strong);
}
.theme-tile[data-active="true"] {
  border-color: var(--foreground);
  box-shadow: 0 0 0 1px var(--foreground);
}
.theme-preview {
  display: flex;
  height: 96px;
  overflow: hidden;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}
.light-preview {
  background: #fff;
  color: #18181b;
}
.dark-preview {
  background: #000;
  color: #fafafa;
}
.tp-side {
  width: 26%;
  border-right: 1px solid currentColor;
  opacity: 0.18;
}
.tp-main {
  flex: 1;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tp-line {
  height: 4px;
  width: 70%;
  background: currentColor;
  opacity: 0.7;
  border-radius: 2px;
}
.tp-line.short {
  width: 45%;
  opacity: 0.3;
}
.tp-card {
  margin-top: auto;
  height: 30px;
  border: 1px solid currentColor;
  border-radius: 4px;
  opacity: 0.2;
}
</style>
