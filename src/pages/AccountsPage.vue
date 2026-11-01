<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  QrCode, RefreshCw, Power, WifiOff, Wifi, ScanLine, Smartphone, Copy,
  ArrowRight, ShieldCheck, Server, Clock, Check, AlertTriangle, KeyRound
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import Avatar from '../components/Avatar.vue'
import UiButton from '../components/UiButton.vue'
import UiModal from '../components/UiModal.vue'
import { state, api, toast, refresh } from '../lib/store'
import { duration, timeAgo, dateTime } from '../lib/format'

const busy = ref({})
const qrOpen = ref(false)
const qr = ref('')
const qrAccount = ref(null)
const secondsLeft = ref(0)
const confirming = ref(false)
const copied = ref(false)
let timer = null

const accounts = computed(() => state.accounts || [])
const offlineAccounts = computed(() => accounts.value.filter((a) => a.status !== 'online'))
const allOnline = computed(() => accounts.value.length > 0 && offlineAccounts.value.length === 0)

const statusMap = {
  online: { label: '在线', cls: 'badge-success' },
  offline: { label: '离线', cls: 'badge-danger' },
  scanning: { label: '待扫码', cls: 'badge-warning' },
  confirming: { label: '确认中', cls: 'badge-warning' },
  reconnecting: { label: '重连中', cls: 'badge-info' }
}
const statusOf = (acc) => statusMap[acc.status] || { label: acc.status, cls: 'badge' }

async function action(acc, kind) {
  const key = `${kind}-${acc.id}`
  busy.value[key] = true
  try {
    if (kind === 'logout') {
      await api.post(`/api/accounts/${acc.id}/logout`)
      toast({ title: '账号已下线', description: acc.nickname, tone: 'warning' })
    } else if (kind === 'reconnect') {
      await api.post(`/api/accounts/${acc.id}/reconnect`)
      toast({ title: '已触发重连', description: '观察退避时间轴以确认握手进度', tone: 'info' })
    } else if (kind === 'drop') {
      await api.post(`/api/connection/simulate-drop`, { accountId: acc.id })
      toast({ title: '已注入中断', description: 'watchdog 正在接管', tone: 'warning' })
    }
  } catch (err) {
    toast({ title: '操作失败', description: err.message, tone: 'danger' })
  } finally {
    busy.value[key] = false
  }
}

async function startLogin(acc) {
  try {
    const data = await api.post(`/api/accounts/${acc.id}/login`)
    qr.value = data.qr
    qrAccount.value = accounts.value.find((a) => a.id === data.accountId) || acc
    secondsLeft.value = data.expiresIn || 120
    qrOpen.value = true
    clearInterval(timer)
    timer = setInterval(() => {
      secondsLeft.value = Math.max(0, secondsLeft.value - 1)
      if (secondsLeft.value === 0) {
        clearInterval(timer)
      }
    }, 1000)
  } catch (err) {
    toast({ title: '无法生成二维码', description: err.message, tone: 'danger' })
  }
}

function closeQr() {
  qrOpen.value = false
  clearInterval(timer)
}

async function confirmScan() {
  if (!qrAccount.value) return
  confirming.value = true
  try {
    await api.post(`/api/accounts/${qrAccount.value.id}/confirm`)
    toast({ title: '已模拟扫码确认', description: '会话建立中，约 1.2s 后上线', tone: 'success' })
    setTimeout(closeQr, 700)
  } catch (err) {
    toast({ title: '确认失败', description: err.message, tone: 'danger' })
  } finally {
    confirming.value = false
  }
}

async function copyCurl() {
  const cmd = `curl -X POST '${location.origin}/onebot?access_token=orbit-demo-token' \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"get_status","params":{},"echo":"orbit"}'`
  try {
    await navigator.clipboard.writeText(cmd)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
    toast({ title: '已复制示例请求', tone: 'success' })
  } catch {
    toast({ title: '复制失败', description: cmd, tone: 'warning' })
  }
}

onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div>
    <PageHeader
      eyebrow="ACCOUNTS / 登录与会话"
      title="账号与会话"
      description="二维码登录、会话接管与重连守卫。每一段会话都有独立的心跳、退避与风险画像。"
    >
      <template #actions>
        <UiButton size="sm" @click="refresh">
          <template #icon><RefreshCw :size="13" /></template>
          刷新状态
        </UiButton>
        <UiButton
          size="sm"
          variant="primary"
          :disabled="!offlineAccounts.length"
          @click="startLogin(offlineAccounts[0])"
        >
          <template #icon><QrCode :size="13" /></template>
          扫码登录
        </UiButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 lg:grid-cols-2">
      <div
        v-for="(acc, i) in accounts"
        :key="acc.id"
        class="card fade-up relative overflow-hidden"
        :style="{ '--d': `${i * 70}ms` }"
      >
        <div class="grid-bg pointer-events-none absolute right-0 top-0 h-24 w-40 opacity-60" />
        <div class="relative p-5">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <span class="micro">{{ acc.primary ? 'PRIMARY NODE' : 'BACKUP NODE' }}</span>
              <span class="badge" :class="statusOf(acc).cls">{{ statusOf(acc).label }}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span v-if="acc.status === 'online'" class="dot dot-live" />
              <span v-else class="dot" />
              <span class="mono text-[10px] text-muted-foreground">RISK {{ acc.riskScore ?? 0 }}</span>
            </div>
          </div>

          <div class="mt-4 flex items-center gap-3.5">
            <Avatar :text="acc.initials" :size="52" :status="acc.status === 'online' ? 'online' : ''" />
            <div class="min-w-0">
              <p class="truncate text-[16px] font-medium tracking-[-0.01em]">{{ acc.nickname }}</p>
              <p class="mono mt-1 text-[11px] text-muted-foreground">{{ acc.uin }}</p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <span class="badge"><Smartphone :size="10" />{{ acc.device }}</span>
                <span class="badge">{{ acc.protocol }}</span>
              </div>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-md border border-border bg-surface-2 p-3">
            <div>
              <p class="micro">SESSION</p>
              <p class="mono mt-1 text-[11.5px]">{{ acc.status === 'online' ? duration(state.overview.onlineSeconds) : '—' }}</p>
            </div>
            <div>
              <p class="micro">LAST HEARTBEAT</p>
              <p class="mono mt-1 text-[11.5px]">{{ acc.lastHeartbeat ? timeAgo(acc.lastHeartbeat) : '—' }}</p>
            </div>
            <div>
              <p class="micro">RECONNECTS</p>
              <p class="mono mt-1 text-[11.5px]">{{ acc.reconnectCount || 0 }}</p>
            </div>
            <div>
              <p class="micro">LOGIN AT</p>
              <p class="mono mt-1 truncate text-[11.5px]">{{ acc.loginAt ? dateTime(acc.loginAt) : '尚未登录' }}</p>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <UiButton
              v-if="acc.status !== 'online'"
              size="sm"
              variant="primary"
              @click="startLogin(acc)"
            >
              <template #icon><QrCode :size="13" /></template>
              生成登录二维码
            </UiButton>
            <UiButton
              v-if="acc.status === 'online'"
              size="sm"
              variant="secondary"
              :loading="busy[`drop-${acc.id}`]"
              @click="action(acc, 'drop')"
            >
              <template #icon><WifiOff :size="13" /></template>
              模拟断线
            </UiButton>
            <UiButton
              v-if="acc.status !== 'online'"
              size="sm"
              :loading="busy[`reconnect-${acc.id}`]"
              @click="action(acc, 'reconnect')"
            >
              <template #icon><Wifi :size="13" /></template>
              立即重连
            </UiButton>
            <UiButton
              v-if="acc.status === 'online'"
              size="sm"
              variant="ghost"
              :loading="busy[`logout-${acc.id}`]"
              @click="action(acc, 'logout')"
            >
              <template #icon><Power :size="13" /></template>
              下线
            </UiButton>
          </div>
        </div>
      </div>

      <!-- add card -->
      <button
        class="fade-up group flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface-2/40 p-6 text-center transition-colors hover:bg-surface-2"
        :style="{ '--d': `${accounts.length * 70}ms` }"
        @click="!allOnline && startLogin(offlineAccounts[0])"
      >
        <span class="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-background transition-transform group-hover:-translate-y-0.5">
          <QrCode :size="19" class="text-muted-foreground" />
        </span>
        <div>
          <p class="text-[13px] font-medium">{{ allOnline ? '所有演示账号均在线' : '接入新的会话' }}</p>
          <p class="mt-1 max-w-[240px] text-[11.5px] leading-relaxed text-muted-foreground">
            生成一次性二维码，模拟手机端扫码确认。真实环境需使用官方授权的协议实现。
          </p>
        </div>
        <span class="badge">{{ allOnline ? 'NO OFFLINE SLOT' : 'ADD ACCOUNT' }}</span>
      </button>
    </div>

    <!-- disclosure + integration -->
    <div class="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div class="card fade-up p-5" style="--d: 200ms">
        <div class="flex items-start gap-3">
          <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-warning/30" style="background: color-mix(in srgb, var(--warning) 8%, transparent)">
            <AlertTriangle :size="15" style="color: var(--warning)" />
          </span>
          <div>
            <p class="text-[13px] font-medium">关于「不风控」的边界</p>
            <p class="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              没有任何协议端能承诺零风控。ORBIT 做的是把风险变得可观测、可预算：心跳守望、指数退避、发送预算、会话冷却、内容去重与安全模式。
              请仅在合规范围内使用，并对账号行为负责。
            </p>
          </div>
        </div>
        <div class="mt-4 grid gap-2 sm:grid-cols-3">
          <div class="panel-inset p-3">
            <p class="micro">WATCHDOG</p>
            <p class="mt-1.5 text-[11.5px]">{{ state.connection.watchdog ? '已启用' : '已关闭' }} · 超时 {{ state.connection.heartbeatTimeoutMs / 1000 }}s</p>
          </div>
          <div class="panel-inset p-3">
            <p class="micro">BACKOFF</p>
            <p class="mt-1.5 text-[11.5px]">{{ state.connection.backoffBaseMs }}ms → {{ state.connection.backoffMaxMs }}ms</p>
          </div>
          <div class="panel-inset p-3">
            <p class="micro">SAFE MODE</p>
            <p class="mt-1.5 text-[11.5px]">{{ state.risk.safeMode ? '开启中' : '未开启' }} · 预算 {{ state.risk.budget.limit }}/60s</p>
          </div>
        </div>
      </div>

      <div class="card fade-up p-5" style="--d: 260ms">
        <p class="micro mb-2">REAL BACKEND</p>
        <h3 class="text-[14px] font-medium">对接真实 OneBot 实现</h3>
        <p class="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          控制台默认运行内置演示内核，同时暴露标准 OneBot 11 HTTP 接口。你可以把它当作真实端的操作台。
        </p>
        <div class="panel-inset mt-4 p-3">
          <div class="flex items-center gap-2">
            <Server :size="13" class="text-muted-foreground" />
            <span class="mono flex-1 truncate text-[10.5px]">POST /onebot?access_token=orbit-demo-token</span>
            <button class="btn btn-ghost btn-sm btn-icon" @click="copyCurl">
              <Check v-if="copied" :size="12" style="color: var(--success)" />
              <Copy v-else :size="12" />
            </button>
          </div>
        </div>
        <div class="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
          <KeyRound :size="12" />
          密钥管理见「API 调试场」
          <ArrowRight :size="12" />
        </div>
      </div>
    </div>

    <!-- QR modal -->
    <UiModal
      :open="qrOpen"
      title="扫码登录"
      description="LOGIN SESSION"
      width="720px"
      @close="closeQr"
    >
      <div class="grid gap-6 sm:grid-cols-[240px_1fr]">
        <div>
          <div class="relative overflow-hidden rounded-lg border border-border bg-white p-3">
            <img v-if="qr" :src="qr" alt="登录二维码" class="block w-full" />
            <div v-if="secondsLeft === 0" class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/90 backdrop-blur-sm">
              <p class="text-[12px] font-medium" style="color: #18181b">二维码已过期</p>
              <button class="btn btn-primary btn-sm" style="background:#18181b;color:#fafafa" @click="startLogin(qrAccount)">重新生成</button>
            </div>
            <div v-if="secondsLeft > 0" class="scan-line" />
          </div>
          <div class="mt-3 flex items-center justify-between">
            <span class="micro">EXPIRES IN</span>
            <span class="mono text-[12px]" :style="{ color: secondsLeft < 20 ? 'var(--danger)' : 'var(--foreground)' }">
              {{ String(Math.floor(secondsLeft / 60)).padStart(2, '0') }}:{{ String(secondsLeft % 60).padStart(2, '0') }}
            </span>
          </div>
        </div>

        <div class="flex flex-col">
          <div class="flex items-center gap-2.5">
            <Avatar :text="qrAccount?.initials || '—'" :size="38" />
            <div>
              <p class="text-[13px] font-medium">{{ qrAccount?.nickname }}</p>
              <p class="mono text-[10.5px] text-muted-foreground">{{ qrAccount?.uin }}</p>
            </div>
          </div>

          <div class="mt-5 space-y-3">
            <div class="flex gap-3">
              <span class="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[9px]">1</span>
              <div>
                <p class="text-[12px] font-medium">二维码已生成</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">票据有效期 120 秒，单次有效</p>
              </div>
            </div>
            <div class="flex gap-3">
              <span class="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[9px]">2</span>
              <div>
                <p class="text-[12px] font-medium">使用手机端扫码</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">演示环境可直接点击下方按钮模拟确认</p>
              </div>
            </div>
            <div class="flex gap-3">
              <span class="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[9px]">3</span>
              <div>
                <p class="text-[12px] font-medium">会话接管</p>
                <p class="mt-0.5 text-[11px] text-muted-foreground">上线后自动挂载心跳与风险防护</p>
              </div>
            </div>
          </div>

          <div class="mt-auto pt-6">
            <div class="mb-2 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
              <ShieldCheck :size="12" /> 登录票据仅保存在本次进程内存
            </div>
            <UiButton variant="primary" block :loading="confirming" :disabled="secondsLeft === 0" @click="confirmScan">
              <template #icon><ScanLine :size="14" /></template>
              模拟扫码并确认登录
            </UiButton>
          </div>
        </div>
      </div>

      <template #footer>
        <UiButton size="sm" variant="ghost" @click="closeQr">取消</UiButton>
        <UiButton size="sm" @click="startLogin(qrAccount)">刷新二维码</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.scan-line {
  position: absolute;
  left: 8%;
  right: 8%;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #18181b, transparent);
  box-shadow: 0 0 12px rgba(24, 24, 27, 0.5);
  animation: qr-scan 2.6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}
@keyframes qr-scan {
  0% { transform: translateY(10px); opacity: 0; }
  15% { opacity: 1; }
  85% { opacity: 1; }
  100% { transform: translateY(212px); opacity: 0; }
}
</style>
