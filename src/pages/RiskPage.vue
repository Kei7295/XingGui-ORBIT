<script setup>
import { computed, ref, watch } from 'vue'
import {
  ShieldCheck, ShieldAlert, TriangleAlert, Gauge, Clock, Layers, RefreshCw,
  Ban, ShieldOff, Info, Zap, ArrowUpRight
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import RiskGauge from '../components/RiskGauge.vue'
import Sparkline from '../components/Sparkline.vue'
import UiButton from '../components/UiButton.vue'
import UiSwitch from '../components/UiSwitch.vue'
import EmptyState from '../components/EmptyState.vue'
import { state, api, toast, refresh } from '../lib/store'
import { clock, timeAgo } from '../lib/format'
import { navigate } from '../lib/router'

const budget = ref(state.risk.budget?.limit || 30)
const saving = ref('')
const risk = computed(() => state.risk)
const levelColor = computed(
  () => ({ low: 'var(--success)', medium: 'var(--warning)', high: 'var(--danger)' })[risk.value.level] || 'var(--foreground)'
)
const budgetPct = computed(() =>
  Math.min(100, Math.round((risk.value.budget.used / Math.max(1, risk.value.budget.limit || budget.value)) * 100))
)
const cooldownLeft = computed(() => Math.max(0, Math.ceil(((risk.value.cooldownUntil || 0) - Date.now()) / 1000)))
const trend = computed(() => state.overview.riskTrend.slice(-48))
const queueItems = computed(() => risk.value.queueItems || [])

watch(
  () => state.risk.budget?.limit,
  (v) => {
    if (v && v !== budget.value) budget.value = v
  }
)

async function toggleSafe(value) {
  try {
    await api.post('/api/risk/config', { safeMode: value })
    toast({
      title: value ? '安全模式已开启' : '安全模式已关闭',
      description: value ? '所有外发消息会被挂起' : '发送预算与冷却重新生效',
      tone: value ? 'warning' : 'success'
    })
  } catch (err) {
    toast({ title: '切换失败', description: err.message, tone: 'danger' })
  }
}

async function toggleRule(rule) {
  const next = !rule.enabled
  rule.enabled = next
  saving.value = rule.id
  try {
    await api.post('/api/risk/config', {
      rules: state.risk.rules.map((r) => ({ id: r.id, enabled: r.id === rule.id ? next : r.enabled }))
    })
    toast({ title: `${rule.name}${next ? '已启用' : '已关闭'}`, tone: next ? 'success' : 'info' })
  } catch (err) {
    rule.enabled = !next
    toast({ title: '策略更新失败', description: err.message, tone: 'danger' })
  } finally {
    saving.value = ''
  }
}

async function saveBudget() {
  saving.value = 'budget'
  try {
    await api.post('/api/risk/config', { budgetLimit: Number(budget.value) })
    toast({ title: '发送预算已更新', description: `${budget.value} 条 / 60 秒`, tone: 'success' })
  } catch (err) {
    toast({ title: '保存失败', description: err.message, tone: 'danger' })
  } finally {
    saving.value = ''
  }
}
</script>

<template>
  <div>
    <PageHeader
      eyebrow="RISK GUARD / 风险防护"
      title="风险防护"
      description="把不可控的风险变成可计算的预算。评分越高，预算越紧；越界即冷却，宁慢勿炸。"
    >
      <template #actions>
        <UiButton size="sm" @click="refresh">
          <template #icon><RefreshCw :size="13" /></template>
          刷新
        </UiButton>
        <UiButton
          size="sm"
          :variant="risk.safeMode ? 'danger' : 'primary'"
          @click="toggleSafe(!risk.safeMode)"
        >
          <template #icon>
            <ShieldOff v-if="risk.safeMode" :size="13" />
            <ShieldCheck v-else :size="13" />
          </template>
          {{ risk.safeMode ? '关闭安全模式' : '开启安全模式' }}
        </UiButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 lg:grid-cols-3">
      <!-- score -->
      <div class="card fade-up p-5">
        <div class="flex items-center justify-between">
          <p class="micro">RISK SCORE</p>
          <span class="badge" :style="{ color: levelColor, borderColor: levelColor, background: 'transparent' }">
            {{ { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' }[risk.level] }}
          </span>
        </div>
        <div class="flex justify-center py-3">
          <RiskGauge :score="risk.score" :size="200" />
        </div>
        <div class="grid grid-cols-2 divide-x divide-border border-t border-border pt-3 text-center">
          <div>
            <p class="micro">THRESHOLD</p>
            <p class="mono mt-1 text-[13px]">70</p>
          </div>
          <div>
            <p class="micro">COOLDOWN</p>
            <p class="mono mt-1 text-[13px]" :style="{ color: cooldownLeft > 0 ? 'var(--warning)' : undefined }">
              {{ cooldownLeft > 0 ? `${cooldownLeft}s` : '—' }}
            </p>
          </div>
        </div>
      </div>

      <!-- budget -->
      <div class="card fade-up p-5" style="--d: 70ms">
        <div class="flex items-center justify-between">
          <p class="micro">SEND BUDGET</p>
          <span class="badge">{{ risk.budget.used }} / {{ risk.budget.limit }}</span>
        </div>
        <div class="mt-4 flex items-end justify-between">
          <div>
            <p class="num text-[28px] font-semibold leading-none">{{ risk.budget.limit }}</p>
            <p class="mt-1.5 text-[10.5px] text-muted-foreground">条 / 60 秒窗口上限</p>
          </div>
          <div class="text-right">
            <p class="num text-[18px]" :style="{ color: budgetPct > 80 ? 'var(--danger)' : 'var(--foreground)' }">
              {{ budgetPct }}%
            </p>
            <p class="text-[10.5px] text-muted-foreground">已用窗口</p>
          </div>
        </div>
        <div class="progress mt-3">
          <span :style="{ width: `${budgetPct}%`, background: budgetPct > 80 ? 'var(--danger)' : budgetPct > 50 ? 'var(--warning)' : 'var(--foreground)' }" />
        </div>
        <div class="mt-4">
          <div class="mb-1 flex justify-between">
            <label class="micro">ADJUST LIMIT</label>
            <span class="mono text-[10px]">{{ budget }}</span>
          </div>
          <input
            v-model.number="budget"
            type="range"
            min="5"
            max="120"
            step="5"
            class="w-full"
            style="accent-color: var(--foreground)"
            @change="saveBudget"
          />
          <div class="mt-1 flex justify-between font-mono text-[9px] text-subtle-foreground">
            <span>5</span><span>120</span>
          </div>
        </div>
        <div class="mt-3 flex items-center justify-between rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Layers :size="12" /> 队列中</span>
          <span class="mono text-[11px]">{{ risk.queue }}</span>
        </div>
      </div>

      <!-- safe mode -->
      <div
        class="card fade-up relative overflow-hidden p-5"
        :style="{ '--d': `140ms` }"
      >
        <div
          class="pointer-events-none absolute inset-0 opacity-70"
          :style="{
            background: risk.safeMode
              ? 'color-mix(in srgb, var(--warning) 7%, transparent)'
              : 'transparent'
          }"
        />
        <div class="relative">
          <div class="flex items-center justify-between">
            <p class="micro">SAFE MODE</p>
            <span class="badge" :class="risk.safeMode ? 'badge-warning' : 'badge-success'">
              {{ risk.safeMode ? 'ON' : 'OFF' }}
            </span>
          </div>
          <div class="mt-4 flex items-center gap-3">
            <span
              class="flex h-11 w-11 items-center justify-center rounded-lg border"
              :style="{
                borderColor: risk.safeMode ? 'color-mix(in srgb, var(--warning) 40%, transparent)' : 'var(--border)',
                background: risk.safeMode ? 'color-mix(in srgb, var(--warning) 10%, transparent)' : 'var(--surface-2)'
              }"
            >
              <ShieldAlert v-if="risk.safeMode" :size="19" style="color: var(--warning)" />
              <ShieldCheck v-else :size="19" class="text-muted-foreground" />
            </span>
            <div class="flex-1">
              <p class="text-[13px] font-medium">{{ risk.safeMode ? '挂起中' : '待命' }}</p>
              <p class="mt-0.5 text-[10.5px] text-muted-foreground">
                {{ risk.safeMode ? '恢复前不会发出任何消息' : '开关会立即暂停外发' }}
              </p>
            </div>
            <UiSwitch :model-value="risk.safeMode" @update:model-value="toggleSafe" />
          </div>

          <div class="mt-4 space-y-2">
            <div class="flex items-center justify-between text-[11px]">
              <span class="flex items-center gap-1.5 text-muted-foreground"><Ban :size="12" /> 累计拦截</span>
              <span class="mono">{{ risk.intercepted.length }}</span>
            </div>
            <div class="flex items-center justify-between text-[11px]">
              <span class="flex items-center gap-1.5 text-muted-foreground"><Clock :size="12" /> 冷却至</span>
              <span class="mono">{{ cooldownLeft > 0 ? `${cooldownLeft}s` : '未触发' }}</span>
            </div>
            <div class="flex items-center justify-between text-[11px]">
              <span class="flex items-center gap-1.5 text-muted-foreground"><Gauge :size="12" /> 策略数量</span>
              <span class="mono">{{ risk.rules.filter((r) => r.enabled).length }} / {{ risk.rules.length }}</span>
            </div>
          </div>

          <button
            class="mt-4 flex w-full items-center justify-between rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
            @click="navigate('/connection')"
          >
            查看断线容灾策略
            <ArrowUpRight :size="13" />
          </button>
        </div>
      </div>
    </div>

    <!-- rules + intercepted -->
    <div class="mt-4 grid gap-4 xl:grid-cols-[1.45fr_1fr]">
      <div class="card fade-up overflow-hidden" style="--d: 180ms">
        <div class="card-head">
          <div>
            <p class="micro mb-1.5">GUARD RULES</p>
            <h2 class="card-title">防护规则</h2>
            <p class="mt-1 text-[11.5px] text-muted-foreground">每条规则独立生效，开关即时写入内核。</p>
          </div>
          <span class="badge">{{ risk.rules.filter((r) => r.enabled).length }} ACTIVE</span>
        </div>
        <div class="divide-y divide-border">
          <div
            v-for="rule in risk.rules"
            :key="rule.id"
            class="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60"
          >
            <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2">
              <Zap v-if="rule.id === 'humanize' || rule.id === 'spread'" :size="13" />
              <Gauge v-else-if="rule.id === 'budget'" :size="13" />
              <Clock v-else-if="rule.id === 'cooldown' || rule.id === 'night'" :size="13" />
              <Layers v-else :size="13" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-2 text-[12.5px] font-medium">
                {{ rule.name }}
                <span v-if="rule.id === 'budget'" class="badge">{{ risk.budget.limit }}/60s</span>
                <span v-if="rule.id === 'cooldown'" class="badge">2.4s</span>
                <span v-if="rule.id === 'dedupe'" class="badge">30s</span>
              </p>
              <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{{ rule.desc }}</p>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="saving === rule.id" class="mono text-[9px] text-muted-foreground">SAVING</span>
              <UiSwitch :model-value="rule.enabled" @update:model-value="toggleRule(rule)" />
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 border-t border-border bg-surface-2/40 px-4 py-2.5 text-[10.5px] text-muted-foreground">
          <Info :size="11" />
          规则只能降低触发概率，不能消除平台侧的风控判定。
        </div>
      </div>

      <div class="card fade-up overflow-hidden" style="--d: 230ms">
        <div class="card-head">
          <div>
            <p class="micro mb-1.5">INTERCEPT LOG</p>
            <h2 class="card-title">拦截记录</h2>
          </div>
          <span class="badge">{{ risk.intercepted.length }}</span>
        </div>
        <div v-if="risk.intercepted.length" class="scroll-thin max-h-[360px] divide-y divide-border overflow-y-auto">
          <div v-for="item in risk.intercepted" :key="item.id" class="px-4 py-3">
            <div class="flex items-center justify-between gap-3">
              <span class="flex items-center gap-1.5 text-[12px] font-medium">
                <TriangleAlert :size="12" style="color: var(--warning)" />
                {{ item.reason }}
              </span>
              <span class="mono text-[9.5px] text-subtle-foreground">{{ clock(item.ts) }}</span>
            </div>
            <p class="mt-1 pl-[18px] text-[11px] text-muted-foreground">{{ item.detail }}</p>
            <p class="mt-1.5 pl-[18px]">
              <span class="badge badge-warning">{{ item.action }}</span>
            </p>
          </div>
        </div>
        <EmptyState
          v-else
          title="暂无拦截"
          description="当发送频率、重复内容或评分触发阈值时，这里会记录裁决。"
        />
      </div>
    </div>

    <!-- trend + queue -->
    <div class="mt-4 grid gap-4 xl:grid-cols-[1.45fr_1fr]">
      <div class="card fade-up p-5" style="--d: 280ms">
        <div class="flex items-start justify-between">
          <div>
            <p class="micro">RISK TREND · 60S</p>
            <p class="mt-2 text-[13px] font-medium">评分与预算的联合走势</p>
          </div>
          <span class="badge" :style="{ color: levelColor, borderColor: levelColor, background: 'transparent' }">
            {{ risk.score }}
          </span>
        </div>
        <div class="mt-5">
          <Sparkline :data="trend" :height="130" :stroke="levelColor" />
        </div>
        <div class="mt-2 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.1em] text-subtle-foreground">
          <span>0</span>
          <span>threshold · 70</span>
          <span>100</span>
        </div>
      </div>

      <div class="card fade-up overflow-hidden" style="--d: 330ms">
        <div class="card-head">
          <div>
            <p class="micro mb-1.5">SEND QUEUE</p>
            <h2 class="card-title">发送队列</h2>
          </div>
          <span class="badge">{{ risk.queue }}</span>
        </div>
        <div v-if="queueItems.length" class="divide-y divide-border">
          <div v-for="item in queueItems" :key="item.id" class="px-4 py-3">
            <p class="truncate text-[12px] font-medium">{{ item.content }}</p>
            <p class="mt-1 flex items-center justify-between text-[10.5px] text-muted-foreground">
              <span class="badge badge-warning">{{ item.reason }}</span>
              <span class="mono">{{ timeAgo(item.ts) }}</span>
            </p>
          </div>
        </div>
        <EmptyState
          v-else
          title="队列为空"
          description="冷却、预算或安全模式触发时，消息会在这里排队等待出队。"
        />
      </div>
    </div>
  </div>
</template>
