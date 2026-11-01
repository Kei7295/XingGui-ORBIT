<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  Search, Send, Paperclip, Image, Smile, ArrowLeft, MoreHorizontal, ShieldCheck,
  ShieldAlert, Pin, Copy, RefreshCw, Hash, Users, MessageSquare, BellOff, Clock, Check
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import Avatar from '../components/Avatar.vue'
import UiButton from '../components/UiButton.vue'
import UiSegmented from '../components/UiSegmented.vue'
import EmptyState from '../components/EmptyState.vue'
import { state, api, toast } from '../lib/store'
import { clock, timeAgo } from '../lib/format'

const conversations = ref([])
const activeId = ref('')
const messages = ref([])
const draft = ref('')
const search = ref('')
const filter = ref('all')
const loading = ref(false)
const sending = ref(false)
const showChat = ref(false)
const listEl = ref(null)
const composerEl = ref(null)
const copied = ref(false)

const online = computed(() => !!state.accounts.find((a) => a.status === 'online'))
const safeMode = computed(() => state.risk.safeMode)
const queue = computed(() => state.risk.queue || 0)
const active = computed(() => conversations.value.find((c) => c.id === activeId.value))
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return conversations.value.filter((c) => {
    if (filter.value !== 'all' && c.type !== filter.value) return false
    if (!q) return true
    return c.title.toLowerCase().includes(q) || (c.preview || '').toLowerCase().includes(q)
  })
})

const messageRows = computed(() => {
  const rows = []
  let last = 0
  for (const m of messages.value) {
    let sep = null
    if (m.ts - last > 10 * 60 * 1000) sep = dayLabel(m.ts)
    rows.push({ ...m, sep })
    last = m.ts
  }
  return rows
})

function dayLabel(ts) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86400000)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return `今天 ${clock(ts).slice(0, 5)}`
  if (sameDay(d, yesterday)) return `昨天 ${clock(ts).slice(0, 5)}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${clock(ts).slice(0, 5)}`
}

async function loadConversations() {
  conversations.value = await api.get('/api/conversations')
  if (!activeId.value && conversations.value.length) await select(conversations.value[0])
}

async function focusFromStorage() {
  const target = sessionStorage.getItem('orbit.conv')
  if (!target) return
  sessionStorage.removeItem('orbit.conv')
  const conv = conversations.value.find((c) => c.id === target)
  if (conv) await select(conv)
}

async function select(conv) {
  if (!conv) return
  activeId.value = conv.id
  showChat.value = true
  loading.value = true
  try {
    messages.value = await api.get(`/api/conversations/${encodeURIComponent(conv.id)}/messages`)
    conv.unread = 0
    api.post(`/api/conversations/${encodeURIComponent(conv.id)}/read`).catch(() => {})
    scrollToBottom()
  } catch (err) {
    toast({ title: '会话加载失败', description: err.message, tone: 'danger' })
  } finally {
    loading.value = false
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

function upsert(message) {
  if (!message) return
  if (messages.value.some((m) => m.id === message.id)) return
  messages.value.push(message)
  scrollToBottom()
}

async function send() {
  const content = draft.value.trim()
  if (!content || sending.value) return
  if (!online.value) {
    toast({ title: '账号不在线', description: '请先在账号页恢复会话', tone: 'warning' })
    return
  }
  sending.value = true
  try {
    const res = await api.post(`/api/conversations/${encodeURIComponent(activeId.value)}/messages`, {
      content
    })
    draft.value = ''
    if (res?.queued) {
      toast({ title: '已进入发送队列', description: res.message, tone: 'warning' })
    } else {
      upsert(res?.message)
    }
  } catch (err) {
    toast({ title: '发送失败', description: err.message, tone: 'danger' })
  } finally {
    sending.value = false
    nextTick(() => {
      if (composerEl.value) composerEl.value.style.height = 'auto'
    })
  }
}

function onComposerKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function onComposerInput(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = `${Math.min(140, el.scrollHeight)}px`
}

async function copyId() {
  try {
    await navigator.clipboard.writeText(active.value?.id || '')
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
    toast({ title: '已复制会话 ID', tone: 'success' })
  } catch {
    toast({ title: '复制失败', tone: 'danger' })
  }
}

function previewOf(conv) {
  return conv.preview || '暂无消息'
}

watch(
  () => state.messageSeq,
  () => {
    const evt = state.lastMessage
    if (!evt) return
    const conv = conversations.value.find((c) => c.id === evt.conversationId)
    if (conv) {
      conv.preview = evt.message.content
      conv.lastAt = evt.message.ts
      if (evt.message.direction === 'in' && evt.conversationId !== activeId.value) {
        conv.unread = (conv.unread || 0) + 1
      }
      conversations.value.sort(
        (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.lastAt - a.lastAt
      )
    }
    if (evt.conversationId === activeId.value) upsert(evt.message)
  }
)

onMounted(async () => {
  await loadConversations()
  await focusFromStorage()
})
</script>

<template>
  <div>
    <PageHeader
      eyebrow="MESSAGES / 会话运营"
      title="消息"
      description="以会话为单位的消息流。发送动作会实时经过预算、冷却与去重三道守卫。"
    >
      <template #actions>
        <span class="badge" :class="online ? 'badge-success' : 'badge-danger'">
          {{ online ? 'SESSION ONLINE' : 'SESSION OFFLINE' }}
        </span>
        <UiButton size="sm" @click="loadConversations">
          <template #icon><RefreshCw :size="13" /></template>
          刷新会话
        </UiButton>
      </template>
    </PageHeader>

    <div class="card overflow-hidden">
      <div
        class="grid w-full grid-cols-1 lg:grid-cols-[290px_1fr] xl:grid-cols-[290px_1fr_264px]"
        style="height: calc(100dvh - 232px); min-height: 560px"
      >
        <!-- conversations -->
        <div
          class="min-h-0 flex-col border-r border-border"
          :class="showChat ? 'hidden lg:flex' : 'flex'"
        >
          <div class="border-b border-border p-3">
            <div class="mb-2.5 flex items-center justify-between">
              <p class="micro">CONVERSATIONS · {{ filtered.length }}</p>
              <UiSegmented
                v-model="filter"
                :options="[
                  { value: 'all', label: '全部' },
                  { value: 'group', label: '群' },
                  { value: 'private', label: '私' }
                ]"
              />
            </div>
            <div class="relative">
              <Search :size="13" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input v-model="search" class="input h-8 pl-8 text-[12px]" placeholder="搜索会话或内容…" />
            </div>
          </div>

          <div class="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <button
              v-for="conv in filtered"
              :key="conv.id"
              class="flex w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors"
              :class="activeId === conv.id ? 'bg-muted' : 'hover:bg-muted/50'"
              @click="select(conv)"
            >
              <Avatar :text="conv.initials" :size="34" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <Pin v-if="conv.pinned" :size="10" class="shrink-0 text-muted-foreground" />
                  <p class="truncate text-[12.5px] font-medium" :class="conv.unread ? 'text-foreground' : ''">
                    {{ conv.title }}
                  </p>
                </div>
                <p class="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {{ conv.lastDirection === 'out' ? '我：' : '' }}{{ previewOf(conv) }}
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span class="mono text-[9.5px] text-subtle-foreground">{{ clock(conv.lastAt) }}</span>
                <span v-if="conv.unread" class="badge badge-success h-[17px] px-1">{{ conv.unread }}</span>
              </div>
            </button>
            <EmptyState v-if="!filtered.length" title="没有匹配的会话" description="换个关键词，或切换筛选条件。" />
          </div>

          <div class="flex items-center justify-between border-t border-border px-3 py-2">
            <span class="micro">RISK BUDGET</span>
            <span class="mono text-[10px]">{{ state.risk.budget.used }}/{{ state.risk.budget.limit }}</span>
          </div>
        </div>

        <!-- chat -->
        <div
          class="min-h-0 flex-col"
          :class="showChat ? 'flex' : 'hidden lg:flex'"
        >
          <template v-if="active">
            <!-- chat head -->
            <div class="flex items-center gap-2.5 border-b border-border px-3 py-2.5 sm:px-4">
              <button class="btn btn-ghost btn-sm btn-icon lg:hidden" @click="showChat = false">
                <ArrowLeft :size="16" />
              </button>
              <Avatar :text="active.initials" :size="34" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <p class="truncate text-[13px] font-medium">{{ active.title }}</p>
                  <span class="badge">{{ active.type === 'group' ? 'GROUP' : 'DIRECT' }}</span>
                </div>
                <p class="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-muted-foreground">
                  <component :is="active.type === 'group' ? Hash : Users" :size="10" />
                  {{ active.type === 'group' ? active.subtitle : active.subtitle || '私聊会话' }}
                </p>
              </div>
              <span v-if="queue" class="badge badge-warning">{{ queue }} 排队</span>
              <button class="btn btn-ghost btn-sm btn-icon" @click="copyId">
                <Check v-if="copied" :size="14" style="color: var(--success)" />
                <Copy v-else :size="14" />
              </button>
              <button class="btn btn-ghost btn-sm btn-icon">
                <MoreHorizontal :size="16" />
              </button>
            </div>

            <!-- banners -->
            <div
              v-if="safeMode"
              class="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px]"
              style="background: color-mix(in srgb, var(--warning) 7%, transparent); color: var(--warning)"
            >
              <ShieldAlert :size="12" /> 安全模式开启中，所有外发消息会被挂起
            </div>
            <div
              v-else-if="!online"
              class="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px]"
              style="background: color-mix(in srgb, var(--danger) 6%, transparent); color: var(--danger)"
            >
              <Clock :size="12" /> 会话离线，发送前请先恢复链路
            </div>

            <!-- messages -->
            <div ref="listEl" class="scroll-thin min-h-0 flex-1 overflow-y-auto bg-surface-2/40 px-3 py-4 sm:px-5">
              <div v-if="loading" class="space-y-3">
                <div class="skeleton h-14 w-2/3" />
                <div class="skeleton ml-auto h-12 w-1/2" />
                <div class="skeleton h-16 w-3/5" />
              </div>
              <template v-else>
                <div v-for="(m, i) in messageRows" :key="m.id">
                  <div v-if="m.sep" class="my-4 flex items-center gap-3">
                    <span class="h-px flex-1 bg-border" />
                    <span class="micro">{{ m.sep }}</span>
                    <span class="h-px flex-1 bg-border" />
                  </div>
                  <div
                    class="fade-in mb-3 flex items-end gap-2"
                    :class="m.direction === 'out' ? 'justify-end' : 'justify-start'"
                    :style="{ '--d': `${Math.min(i, 8) * 18}ms` }"
                  >
                    <Avatar
                      v-if="m.direction === 'in' && active.type === 'group'"
                      :text="m.sender?.initials || '?'"
                      :size="26"
                    />
                    <div class="max-w-[76%] sm:max-w-[68%]">
                      <p
                        v-if="m.direction === 'in' && active.type === 'group'"
                        class="mb-1 pl-0.5 text-[10px] text-muted-foreground"
                      >
                        {{ m.sender?.name }}
                      </p>
                      <div
                        class="rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed"
                        :class="
                          m.direction === 'out'
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-surface text-foreground'
                        "
                        style="border-bottom-right-radius: 3px; border-bottom-left-radius: 3px"
                      >
                        {{ m.content }}
                      </div>
                      <p
                        class="mt-1 flex items-center gap-1 font-mono text-[9.5px] text-subtle-foreground"
                        :class="m.direction === 'out' ? 'justify-end' : ''"
                      >
                        {{ clock(m.ts) }}
                        <Check v-if="m.direction === 'out'" :size="9" />
                      </p>
                    </div>
                    <Avatar
                      v-if="m.direction === 'out'"
                      :text="m.sender?.initials || 'ME'"
                      :size="26"
                    />
                  </div>
                </div>
                <div v-if="!messageRows.length" class="flex h-full items-center justify-center">
                  <EmptyState title="还没有消息" description="发送第一条消息，它会先经过风险守卫。" />
                </div>
              </template>
            </div>

            <!-- composer -->
            <div class="border-t border-border p-3">
              <div class="rounded-md border border-border bg-background focus-within:border-ring" style="transition: border-color .15s, box-shadow .15s">
                <textarea
                  ref="composerEl"
                  v-model="draft"
                  rows="1"
                  class="scroll-thin block max-h-[140px] min-h-[40px] w-full resize-none border-0 bg-transparent px-3 pt-2.5 text-[12.5px] leading-relaxed outline-none placeholder:text-subtle-foreground"
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行…"
                  @keydown="onComposerKey"
                  @input="onComposerInput"
                />
                <div class="flex items-center justify-between px-2 pb-1.5">
                  <div class="flex items-center gap-0.5">
                    <button class="composer-tool tip" data-tip="附件"><Paperclip :size="14" /></button>
                    <button class="composer-tool tip" data-tip="图片"><Image :size="14" /></button>
                    <button class="composer-tool tip" data-tip="表情"><Smile :size="14" /></button>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="mono text-[9.5px] text-subtle-foreground">{{ draft.length }}/2000</span>
                    <UiButton
                      size="sm"
                      variant="primary"
                      :loading="sending"
                      :disabled="!draft.trim() || safeMode"
                      @click="send"
                    >
                      <template #icon><Send :size="12" /></template>
                      发送
                    </UiButton>
                  </div>
                </div>
              </div>
              <p class="mt-1.5 flex items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground">
                <ShieldCheck :size="10" />
                预算 {{ state.risk.budget.used }}/{{ state.risk.budget.limit }} · 冷却 2.4s · 去重 30s
                <span class="ml-auto">{{ online ? '链路正常' : '链路离线' }}</span>
              </p>
            </div>
          </template>

          <div v-else class="flex h-full items-center justify-center">
            <EmptyState title="选择一个会话" description="左侧列出来自群聊与好友的会话；点击即可查看上下文。" />
          </div>
        </div>

        <!-- inspector -->
        <div class="hidden min-h-0 flex-col border-l border-border xl:flex">
          <div class="border-b border-border p-4">
            <p class="micro mb-2.5">INSPECTOR</p>
            <div v-if="active" class="flex items-center gap-2.5">
              <Avatar :text="active.initials" :size="36" />
              <div class="min-w-0">
                <p class="truncate text-[12.5px] font-medium">{{ active.title }}</p>
                <p class="mono truncate text-[9.5px] text-muted-foreground">{{ active.id }}</p>
              </div>
            </div>
          </div>
          <div class="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
            <div>
              <p class="micro mb-2">META</p>
              <dl class="space-y-2 text-[11.5px]">
                <div class="flex justify-between gap-3">
                  <dt class="text-muted-foreground">类型</dt>
                  <dd class="mono">{{ active?.type === 'group' ? '群聊' : '私聊' }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted-foreground">目标</dt>
                  <dd class="mono truncate">{{ active?.targetId }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted-foreground">置顶</dt>
                  <dd class="mono">{{ active?.pinned ? '是' : '否' }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted-foreground">消息数</dt>
                  <dd class="mono">{{ messages.length }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted-foreground">最近活动</dt>
                  <dd class="mono">{{ active ? timeAgo(active.lastAt) : '—' }}</dd>
                </div>
              </dl>
            </div>

            <div class="hairline" />

            <div>
              <p class="micro mb-2">RISK BUDGET</p>
              <div class="progress mb-2">
                <span
                  :style="{
                    width: `${Math.min(100, (state.risk.budget.used / Math.max(1, state.risk.budget.limit)) * 100)}%`,
                    background: state.risk.score > 60 ? 'var(--warning)' : 'var(--foreground)'
                  }"
                />
              </div>
              <p class="flex justify-between text-[10.5px] text-muted-foreground">
                <span>{{ state.risk.budget.used }} 已用</span>
                <span>{{ state.risk.budget.limit }} 上限 / 60s</span>
              </p>
            </div>

            <div class="hairline" />

            <div>
              <p class="micro mb-2">GUARDS</p>
              <div class="space-y-1.5">
                <div
                  v-for="rule in state.risk.rules.filter((r) => ['budget', 'cooldown', 'dedupe'].includes(r.id))"
                  :key="rule.id"
                  class="flex items-center justify-between text-[11px]"
                >
                  <span class="text-muted-foreground">{{ rule.name }}</span>
                  <span class="badge" :class="rule.enabled ? 'badge-success' : ''">{{ rule.enabled ? 'ON' : 'OFF' }}</span>
                </div>
              </div>
            </div>

            <div class="hairline" />

            <div class="space-y-1.5">
              <p class="micro mb-2">ACTIONS</p>
              <button class="quick-row" @click="copyId"><Copy :size="12" /> 复制会话 ID</button>
              <button class="quick-row" @click="toast({ title: '已标记为关注', tone: 'success' })">
                <Pin :size="12" /> 置顶会话
              </button>
              <button class="quick-row" @click="toast({ title: '已静音该会话', tone: 'info' })">
                <BellOff :size="12" /> 静音提醒
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  color: var(--muted-foreground);
  transition: all 0.15s ease;
}
.composer-tool:hover {
  background: var(--muted);
  color: var(--foreground);
}
.quick-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  height: 30px;
  padding: 0 0.5rem;
  border-radius: 5px;
  font-size: 11px;
  color: var(--muted-foreground);
  transition: all 0.15s ease;
}
.quick-row:hover {
  background: var(--muted);
  color: var(--foreground);
}
</style>
