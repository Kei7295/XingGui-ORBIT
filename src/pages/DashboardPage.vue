<script setup>
import { computed, ref } from 'vue'
import {
  RefreshCw, WifiOff, ArrowUpRight, MessageSquare, QrCode, ShieldCheck,
  Zap, ScrollText, Server, Cpu, Activity, TriangleAlert, CircleCheck, Link2,
  Inbox, Sparkles, Clock
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import Avatar from '../components/Avatar.vue'
import RiskGauge from '../components/RiskGauge.vue'
import Sparkline from '../components/Sparkline.vue'
import UiSwitch from '../components/UiSwitch.vue'
import UiButton from '../components/UiButton.vue'
import EmptyState from '../components/EmptyState.vue'
import { state, api, toast, refresh } from '../lib/store'
import { duration, num, compact, timeAgo } from '../lib/format'
import { navigate } from '../lib/router'

const busy = ref({ drop: false, diagnose: false, refresh: false })

const account = computed(() => state.account)
const online = computed(() => account.value?.status === 'online')
const risk = computed(() => state.risk)
const riskBadge = computed(
  () => ({ low: 'badge-success', medium: 'badge-warning', high: 'badge-danger' })[risk.value.level] || 'badge'
)
const riskText = computed(() => ({ low: '低风险', medium: '中等', high: '高风险' })[risk.value.level] || '—')
const throughput = computed(() => state.overview.rateWindow.slice(-40))
const latency = computed(() => state.overview.latency.slice(-40))
const riskTrend = computed(() => state.overview.riskTrend.slice(-40))
const budgetPct = computed(() => {
  const b = risk.value.budget || { used: 0, limit: 30 }
  return Math.min(100, Math.round((b.used / Math.max(1, b.limit)) * 100))
})
const health = computed(() => state.health)
const heartbeatSec = computed(() => Math.round((state.connection.heartbeatMs || 20000) / 1000))

const activityIcons = {
  message: MessageSquare,
  link: Link2,
  risk: TriangleAlert,
  login: QrCode,
  queue: Clock,
  default: Sparkles
}

async function simulateDrop() {
  busy.value.drop = true
  try {
    await api.post('/api/connection/simulate-drop', { accountId: account.value?.id })
    toast({ title: '已注入链路中断', description: 'watchdog 将按指数退避接管', tone: 'warning' })
  } catch (err) {
    toast({ title: '操作失败', description: err.message, tone: 'danger' })
  } finally {
    busy.value.drop = false
  }
}

async function diagnose() {
  busy.value.diagnose = true
  try {
    const results = await api.post('/api/connection/test')
    const ok = results.filter((r) => r.ok).length
    toast({ title: '链路诊断完成', description: `${ok}/${results.length} 个出口可用`, tone: 'success' })
  } catch (err) {
    toast({ title: '诊断失败', description: err.message, tone: 'danger' })
  } finally {
    busy.value.diagnose = false
  }
}

async function setSafe(value) {
  try {
    await api.post('/api/risk/config', { safeMode: value })
    toast({
      title: value ? '安全模式已开启' : '已恢复发送',
      description: value ? '所有外发消息会挂起，直到关闭' : '风险防护继续以预算模式运行',
      tone: value ? 'warning' : 'success'
    })
  } catch (err) {
    toast({ title: '操作失败', description: err.message, tone: 'danger' })
  }
}

async function doRefresh() {
  busy.value.refresh = true
  await refresh()
  busy.value.refresh = false
}

const endpointMain = computed(() => state.connection.endpoints?.find((e) => e.priority === 1))
const backups = computed(() => state.connection.endpoints?.filter((e) => e.priority > 1) || [])
</script>

<template>
  <div>
    <PageHeader
      eyebrow="OVERVIEW / 实时监控"
      title="运行概览"
      description="一个面板看住协议端的呼吸：链路、吞吐、风险预算与事件流。数据经 SSE 每秒推送。"
    >
      <template #actions>
        <UiButton size="sm" :loading="busy.refresh" @click="doRefresh">
          <template #icon><RefreshCw :size="13" /></template>
          刷新
        </UiButton>
        <UiButton size="sm" :loading="busy.diagnose" @click="diagnose">
          <template #icon><Zap :size="13" /></template>
          链路诊断
        </UiButton>
        <UiButton size="sm" variant="primary" :loading="busy.drop" @click="simulateDrop">
          <template #icon><WifiOff :size="13" /></template>
          模拟断线
        </UiButton>
      </template>
    </PageHeader>

    <!-- hero -->
    <div class="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
      <div class="card fade-up relative overflow-hidden">
        <div class="grid-bg grid-bg-fade pointer-events-none absolute inset-0 opacity-80" />
        <div class="relative flex flex-col gap-5 p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="micro mb-2.5">LINK STATUS</p>
              <h2 class="flex items-center gap-2 text-[19px] font-semibold tracking-[-0.02em]">
                <span class="dot" :class="online ? 'dot-live' : 'dot-dead'" />
                {{ online ? '链路稳定，服务在线' : '链路中断，等待接管' }}
              </h2>
              <p class="mt-1 text-[12px] text-muted-foreground">
                {{ online ? '心跳与事件流正常 · OneBot 11 兼容内核' : 'watchdog 已接管，按退避策略重连' }}
              </p>
            </div>
            <span class="badge" :class="online ? 'badge-success' : 'badge-danger'">
              {{ online ? 'ONLINE' : 'OFFLINE' }}
            </span>
          </div>

          <div class="flex flex-wrap items-end justify-between gap-4">
            <div class="flex items-center gap-3">
              <Avatar :text="account?.initials || '—'" :size="46" :status="online ? 'online' : ''" />
              <div>
                <p class="text-[15px] font-medium">{{ account?.nickname || '未登录账号' }}</p>
                <p class="mono mt-0.5 text-[11px] text-muted-foreground">
                  {{ account?.uin || '—' }} · {{ account?.device || '尚无设备' }}
                </p>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <span class="badge">{{ account?.protocol || 'OneBot 11' }}</span>
                  <span class="badge">HB {{ heartbeatSec }}s</span>
                  <span class="badge">{{ online ? '会话已接管' : '待重新登录' }}</span>
                </div>
              </div>
            </div>
            <div class="text-right">
              <p class="micro">SESSION UPTIME</p>
              <p class="mono mt-1.5 text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">
                {{ duration(state.overview.onlineSeconds) }}
              </p>
            </div>
          </div>

          <div class="grid grid-cols-3 divide-x divide-border border-t border-border pt-4">
            <div class="pr-3">
              <p class="micro">RECONNECTS</p>
              <p class="num mt-1.5 text-[17px] font-semibold">{{ num(state.overview.reconnects) }}</p>
            </div>
            <div class="px-3">
              <p class="micro">SENT</p>
              <p class="num mt-1.5 text-[17px] font-semibold">{{ compact(state.overview.messagesSent) }}</p>
            </div>
            <div class="pl-3">
              <p class="micro">RECEIVED</p>
              <p class="num mt-1.5 text-[17px] font-semibold">{{ compact(state.overview.messagesReceived) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="card fade-up p-5" style="--d: 70ms">
        <div class="flex items-center justify-between">
          <p class="micro">RISK GUARD</p>
          <span class="badge" :class="riskBadge">{{ riskText }}</span>
        </div>
        <div class="flex justify-center py-2">
          <RiskGauge :score="risk.score" :size="196" />
        </div>
        <div class="mt-1">
          <div class="mb-1.5 flex items-center justify-between text-[11px]">
            <span class="text-muted-foreground">发送预算 · 60s 窗口</span>
            <span class="mono">{{ risk.budget.used }} / {{ risk.budget.limit }}</span>
          </div>
          <div class="progress">
            <span :style="{ width: `${budgetPct}%`, background: budgetPct > 85 ? 'var(--danger)' : 'var(--foreground)' }" />
          </div>
        </div>
        <div class="mt-4 flex items-center justify-between border-t border-border pt-3.5">
          <div>
            <p class="text-[12px] font-medium">安全模式</p>
            <p class="mt-0.5 text-[10.5px] text-muted-foreground">挂起全部外发消息</p>
          </div>
          <UiSwitch :model-value="risk.safeMode" @update:model-value="setSafe" />
        </div>
        <button
          class="mt-3 flex w-full items-center justify-between rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          @click="navigate('/risk')"
        >
          <span>打开风险防护策略</span>
          <ArrowUpRight :size="13" />
        </button>
      </div>
    </div>

    <!-- stats -->
    <div class="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <div class="fade-up" style="--d: 110ms">
        <div class="stat-wrap h-full">
          <div class="card card-hover p-4">
            <div class="flex items-start justify-between">
              <p class="micro">SESSION</p>
              <Activity :size="14" class="text-muted-foreground" />
            </div>
            <div class="mt-3 flex items-baseline gap-1.5">
              <span class="num text-[24px] font-semibold leading-none">{{ duration(state.overview.onlineSeconds) }}</span>
            </div>
            <p class="mt-2 text-[11px] text-muted-foreground">自上次登录起的连续在线时长</p>
            <div class="-mx-1 mt-2 opacity-70">
              <Sparkline :data="latency" :height="30" />
            </div>
          </div>
        </div>
      </div>
      <div class="fade-up" style="--d: 160ms">
        <div class="card card-hover p-4">
          <div class="flex items-start justify-between">
            <p class="micro">MESSAGES SENT</p>
            <MessageSquare :size="14" class="text-muted-foreground" />
          </div>
          <div class="mt-3 flex items-baseline gap-1.5">
            <span class="num text-[24px] font-semibold leading-none">{{ compact(state.overview.messagesSent) }}</span>
            <span class="font-mono text-[11px] text-muted-foreground">条</span>
          </div>
          <p class="mt-2 text-[11px] text-muted-foreground">含命令台、队列与 OneBot 调用</p>
          <div class="-mx-1 mt-2 opacity-70">
            <Sparkline :data="throughput" :height="30" />
          </div>
        </div>
      </div>
      <div class="fade-up" style="--d: 210ms">
        <div class="card card-hover p-4">
          <div class="flex items-start justify-between">
            <p class="micro">MESSAGES RECEIVED</p>
            <Inbox :size="14" class="text-muted-foreground" />
          </div>
          <div class="mt-3 flex items-baseline gap-1.5">
            <span class="num text-[24px] font-semibold leading-none">{{ compact(state.overview.messagesReceived) }}</span>
            <span class="font-mono text-[11px] text-muted-foreground">条</span>
          </div>
          <p class="mt-2 text-[11px] text-muted-foreground">事件流合成的真实语义消息</p>
          <div class="-mx-1 mt-2 opacity-70">
            <Sparkline :data="riskTrend" :height="30" />
          </div>
        </div>
      </div>
      <div class="fade-up" style="--d: 260ms">
        <div class="card card-hover p-4">
          <div class="flex items-start justify-between">
            <p class="micro">ROUND TRIP</p>
            <Cpu :size="14" class="text-muted-foreground" />
          </div>
          <div class="mt-3 flex items-baseline gap-1.5">
            <span class="num text-[24px] font-semibold leading-none">{{ Math.round(state.overview.latencyMs) }}</span>
            <span class="font-mono text-[11px] text-muted-foreground">ms</span>
          </div>
          <p class="mt-2 text-[11px] text-muted-foreground">心跳往返延迟 · 低于 80ms 视为健康</p>
          <div class="-mx-1 mt-2 opacity-70">
            <Sparkline :data="latency" :height="30" stroke="var(--success)" />
          </div>
        </div>
      </div>
    </div>

    <!-- charts -->
    <div class="mt-4 grid gap-4 lg:grid-cols-3">
      <div class="card fade-up p-4" style="--d: 300ms">
        <div class="flex items-start justify-between">
          <div>
            <p class="micro">THROUGHPUT</p>
            <p class="mt-2 text-[13px] font-medium">发送吞吐 · 近 60s</p>
          </div>
          <span class="badge">{{ throughput.at(-1) || 0 }} / tick</span>
        </div>
        <div class="mt-4">
          <Sparkline :data="throughput" :height="96" />
        </div>
        <div class="mt-2 flex justify-between font-mono text-[9.5px] uppercase tracking-[0.1em] text-subtle-foreground">
          <span>-60s</span><span>now</span>
        </div>
      </div>

      <div class="card fade-up p-4" style="--d: 340ms">
        <div class="flex items-start justify-between">
          <div>
            <p class="micro">RISK TREND</p>
            <p class="mt-2 text-[13px] font-medium">风险评分走势</p>
          </div>
          <span class="badge" :class="riskBadge">{{ risk.score }}</span>
        </div>
        <div class="mt-4">
          <Sparkline
            :data="riskTrend"
            :height="96"
            :stroke="risk.level === 'high' ? 'var(--danger)' : risk.level === 'medium' ? 'var(--warning)' : 'var(--success)'"
          />
        </div>
        <div class="mt-2 flex justify-between font-mono text-[9.5px] uppercase tracking-[0.1em] text-subtle-foreground">
          <span>threshold 70</span><span>budget {{ budgetPct }}%</span>
        </div>
      </div>

      <div class="card fade-up p-4" style="--d: 380ms">
        <div class="flex items-start justify-between">
          <div>
            <p class="micro">HOST HEALTH</p>
            <p class="mt-2 text-[13px] font-medium">内核负载</p>
          </div>
          <span class="badge">NODE 24</span>
        </div>
        <div class="mt-4 space-y-3">
          <div>
            <div class="mb-1 flex justify-between text-[11px]">
              <span class="text-muted-foreground">CPU</span><span class="mono">{{ health.cpu }}%</span>
            </div>
            <div class="progress"><span :style="{ width: `${health.cpu}%` }" /></div>
          </div>
          <div>
            <div class="mb-1 flex justify-between text-[11px]">
              <span class="text-muted-foreground">MEM</span><span class="mono">{{ health.memory }}%</span>
            </div>
            <div class="progress"><span :style="{ width: `${health.memory}%` }" /></div>
          </div>
          <div>
            <div class="mb-1 flex justify-between text-[11px]">
              <span class="text-muted-foreground">QUEUE</span><span class="mono">{{ health.queue }}</span>
            </div>
            <div class="progress"><span :style="{ width: `${Math.min(100, health.queue * 20)}%` }" /></div>
          </div>
        </div>
        <div class="mt-4 flex items-center gap-2 text-[10.5px] text-muted-foreground">
          <CircleCheck :size="12" style="color: var(--success)" />
          watchdog 运行中 · {{ state.connection.maxReconnectAttempts }} 次上限
        </div>
      </div>
    </div>

    <!-- activity + side -->
    <div class="mt-4 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
      <div class="card fade-up overflow-hidden" style="--d: 420ms">
        <div class="card-head">
          <div>
            <p class="micro mb-1.5">EVENT STREAM</p>
            <h2 class="card-title">实时事件</h2>
          </div>
          <button class="btn btn-ghost btn-sm" @click="navigate('/logs')">
            全部日志 <ArrowUpRight :size="12" />
          </button>
        </div>
        <div v-if="state.activity.length" class="divide-y divide-border">
          <div
            v-for="(item, i) in state.activity.slice(0, 8)"
            :key="item.id"
            class="fade-in flex items-start gap-3 px-4 py-3"
            :style="{ '--d': `${i * 30}ms` }"
          >
            <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2">
              <component :is="activityIcons[item.type] || activityIcons.default" :size="13" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[12.5px] font-medium">{{ item.title }}</p>
              <p class="mt-0.5 truncate text-[11px] text-muted-foreground">{{ item.detail }}</p>
            </div>
            <span class="mono shrink-0 text-[10px] text-subtle-foreground">{{ timeAgo(item.ts) }}</span>
          </div>
        </div>
        <EmptyState v-else title="还没有事件" description="当账号上线、消息到达或风险防护介入时，这里会出现记录。" />
      </div>

      <div class="flex flex-col gap-4">
        <div class="card fade-up p-4" style="--d: 460ms">
          <div class="mb-3 flex items-center justify-between">
            <p class="micro">LINK TOPOLOGY</p>
            <span class="badge">{{ online ? 'ACTIVE' : 'STANDBY' }}</span>
          </div>
          <div class="space-y-2">
            <div class="flex items-center gap-2.5 rounded-md border border-border bg-surface-2 p-2.5">
              <Avatar :text="account?.initials || '—'" :size="28" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-[11.5px] font-medium">{{ account?.nickname || '未登录' }}</p>
                <p class="mono text-[9.5px] text-muted-foreground">{{ account?.uin || '—' }}</p>
              </div>
              <span class="dot" :class="online ? 'dot-live' : 'dot-dead'" />
            </div>
            <div class="mx-auto h-4 w-px bg-border" />
            <div class="flex items-center gap-2.5 rounded-md border border-border bg-surface p-2.5">
              <Server :size="14" class="text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-[11.5px] font-medium">{{ endpointMain?.name || '主链路' }}</p>
                <p class="mono truncate text-[9.5px] text-muted-foreground">{{ endpointMain?.url || 'ws://127.0.0.1:3001' }}</p>
              </div>
              <span class="mono text-[9.5px] text-muted-foreground">{{ endpointMain?.rtt || 0 }}ms</span>
            </div>
            <div class="mx-auto h-4 w-px bg-border" />
            <div class="flex items-center gap-2.5 rounded-md border border-dashed border-border-strong p-2.5">
              <Zap :size="14" class="text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="text-[11.5px] font-medium">OneBot 11 · 控制台</p>
                <p class="mono text-[9.5px] text-muted-foreground">HTTP 8787 / SSE /api/events</p>
              </div>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <span v-for="ep in backups" :key="ep.id" class="badge">
              {{ ep.name }} · {{ ep.status }}
            </span>
          </div>
        </div>

        <div class="card fade-up p-4" style="--d: 500ms">
          <p class="micro mb-3">QUICK ACTIONS</p>
          <div class="grid grid-cols-2 gap-2">
            <button class="quick-action" @click="navigate('/accounts')">
              <QrCode :size="15" /><span>扫码登录</span>
            </button>
            <button class="quick-action" @click="navigate('/messages')">
              <MessageSquare :size="15" /><span>发送消息</span>
            </button>
            <button class="quick-action" @click="navigate('/risk')">
              <ShieldCheck :size="15" /><span>风险策略</span>
            </button>
            <button class="quick-action" @click="navigate('/logs')">
              <ScrollText :size="15" /><span>运行日志</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quick-action {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 38px;
  padding: 0 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-2);
  font-size: 11.5px;
  color: var(--muted-foreground);
  transition: all 0.16s ease;
}
.quick-action:hover {
  color: var(--foreground);
  border-color: var(--border-strong);
  background: var(--background);
}
</style>
