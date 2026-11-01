<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Terminal, Play, Copy, Check, Search, KeyRound, Plus, RefreshCw, Eye, EyeOff,
  Trash2, RotateCw, ShieldCheck, Clock, ChevronRight, Code2, CircleCheck, CircleX
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import UiButton from '../components/UiButton.vue'
import UiModal from '../components/UiModal.vue'
import EmptyState from '../components/EmptyState.vue'
import { api, toast } from '../lib/store'
import { timeAgo, ms } from '../lib/format'

const actions = ref([])
const keys = ref([])
const groups = ref([])
const friends = ref([])
const selected = ref('')
const actionSearch = ref('')
const paramsText = ref('{}')
const token = ref('orbit-demo-token')
const running = ref(false)
const response = ref(null)
const history = ref([])
const revealed = reactive({})
const copied = ref('')
const createOpen = ref(false)
const createName = ref('')
const creating = ref(false)
const newKey = ref(null)
const pendingDelete = ref('')

const endpoint = computed(() => `${location.origin}/onebot`)
const activeAction = computed(() => actions.value.find((a) => a.name === selected.value))
const filteredActions = computed(() => {
  const q = actionSearch.value.trim().toLowerCase()
  if (!q) return actions.value
  return actions.value.filter((a) => `${a.name} ${a.desc}`.toLowerCase().includes(q))
})

const curl = computed(() => {
  const body = JSON.stringify({ action: selected.value, params: safeParams(), echo: 'orbit' })
  return `curl -X POST '${endpoint.value}?access_token=${token.value}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${body.replace(/'/g, "'\\''")}'`
})

function safeParams() {
  try {
    return JSON.parse(paramsText.value || '{}')
  } catch {
    return {}
  }
}

function templateFor(name) {
  const gid = groups.value[0]?.id
  const uid = friends.value[0]?.uin
  switch (name) {
    case 'get_group_member_list':
      return { group_id: gid ? Number(gid) : 700000 }
    case 'send_private_msg':
      return { user_id: uid ? Number(uid) : 10001, message: '来自 ORBIT 控制台的一条私聊测试消息' }
    case 'send_group_msg':
      return { group_id: gid ? Number(gid) : 700000, message: '来自 ORBIT 控制台的一条群聊测试消息' }
    case 'send_msg':
      return { message_type: 'private', user_id: uid ? Number(uid) : 10001, message: '通用发送测试' }
    case 'set_group_ban':
      return { group_id: gid ? Number(gid) : 700000, user_id: 20001, duration: 60 }
    case 'set_group_whole_ban':
      return { group_id: gid ? Number(gid) : 700000, enable: false }
    case 'get_stranger_info':
      return { user_id: uid ? Number(uid) : 10001 }
    default:
      return {}
  }
}

function choose(name) {
  selected.value = name
  paramsText.value = JSON.stringify(templateFor(name), null, 2)
}

async function run() {
  if (!selected.value) return
  running.value = true
  response.value = null
  let params
  try {
    params = JSON.parse(paramsText.value || '{}')
  } catch (err) {
    running.value = false
    toast({ title: '参数不是合法 JSON', description: err.message, tone: 'danger' })
    return
  }
  const started = performance.now()
  try {
    const res = await fetch(`${endpoint.value}?access_token=${encodeURIComponent(token.value)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: selected.value, params, echo: 'orbit' })
    })
    const body = await res.json()
    const latency = performance.now() - started
    response.value = { http: res.status, body, latency }
    history.value.unshift({
      id: Math.random().toString(36).slice(2),
      action: selected.value,
      ok: body.status === 'ok',
      retcode: body.retcode,
      latency,
      ts: Date.now()
    })
    if (history.value.length > 10) history.value.length = 10
    toast({
      title: body.status === 'ok' ? '调用成功' : '调用失败',
      description: `${selected.value} · retcode ${body.retcode} · ${ms(latency)}`,
      tone: body.status === 'ok' ? 'success' : 'danger'
    })
  } catch (err) {
    response.value = { http: 0, body: { error: err.message }, latency: performance.now() - started }
    toast({ title: '请求未完成', description: err.message, tone: 'danger' })
  } finally {
    running.value = false
  }
}

async function copy(text, tag) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = tag
    setTimeout(() => (copied.value = ''), 1500)
    toast({ title: '已复制', tone: 'success' })
  } catch {
    toast({ title: '复制失败', tone: 'warning' })
  }
}

async function loadKeys() {
  keys.value = await api.get('/api/keys')
}

async function loadRefs() {
  const [g, f] = await Promise.all([api.get('/api/groups'), api.get('/api/friends')])
  groups.value = g
  friends.value = f
}

function mask(t) {
  if (!t) return ''
  return t.length > 14 ? `${t.slice(0, 6)}••••${t.slice(-4)}` : t
}

async function createKey() {
  if (!createName.value.trim()) return
  creating.value = true
  try {
    const key = await api.post('/api/keys', { name: createName.value.trim() })
    newKey.value = key
    createOpen.value = false
    createName.value = ''
    await loadKeys()
    toast({ title: '密钥已创建', description: '请立即保存，之后仍可在列表中查看', tone: 'success' })
  } catch (err) {
    toast({ title: '创建失败', description: err.message, tone: 'danger' })
  } finally {
    creating.value = false
  }
}

async function rotate(key) {
  try {
    const updated = await api.post(`/api/keys/${key.id}/rotate`)
    newKey.value = updated
    await loadKeys()
    toast({ title: '密钥已轮换', description: key.name, tone: 'success' })
  } catch (err) {
    toast({ title: '轮换失败', description: err.message, tone: 'danger' })
  }
}

async function toggleKey(key) {
  try {
    await api.post(`/api/keys/${key.id}/toggle`)
    await loadKeys()
    toast({ title: key.enabled ? '密钥已停用' : '密钥已启用', tone: key.enabled ? 'warning' : 'success' })
  } catch (err) {
    toast({ title: '操作失败', description: err.message, tone: 'danger' })
  }
}

async function removeKey(key) {
  if (pendingDelete.value !== key.id) {
    pendingDelete.value = key.id
    setTimeout(() => {
      if (pendingDelete.value === key.id) pendingDelete.value = ''
    }, 3000)
    return
  }
  try {
    await api.del(`/api/keys/${key.id}`)
    pendingDelete.value = ''
    await loadKeys()
    toast({ title: '密钥已删除', description: key.name, tone: 'warning' })
  } catch (err) {
    toast({ title: '删除失败', description: err.message, tone: 'danger' })
  }
}

onMounted(async () => {
  try {
    const list = await api.get('/api/onebot/actions')
    actions.value = list
    await Promise.all([loadKeys(), loadRefs()])
    if (list.length) choose(list[0].name)
  } catch (err) {
    toast({ title: '初始化失败', description: err.message, tone: 'danger' })
  }
})

const jsonOf = computed(() => (response.value ? JSON.stringify(response.value.body, null, 2) : ''))
</script>

<template>
  <div>
    <PageHeader
      eyebrow="PLAYGROUND / OneBot 11"
      title="API 调试场"
      description="标准 OneBot 11 HTTP 接口，带 token 校验、真实 retcode 与毫秒级耗时。左侧选动作，右侧直接发。"
    >
      <template #actions>
        <UiButton size="sm" @click="copy(endpoint, 'endpoint')">
          <template #icon><Copy :size="13" /></template>
          {{ copied === 'endpoint' ? '已复制' : '复制 Endpoint' }}
        </UiButton>
        <UiButton size="sm" variant="primary" :loading="running" @click="run">
          <template #icon><Play :size="13" /></template>
          发送请求
        </UiButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 xl:grid-cols-[300px_1fr]">
      <!-- action list -->
      <div class="card flex min-h-[520px] flex-col overflow-hidden">
        <div class="border-b border-border p-3">
          <div class="mb-2.5 flex items-center justify-between">
            <p class="micro">ACTIONS · {{ actions.length }}</p>
            <span class="badge">HTTP</span>
          </div>
          <div class="relative">
            <Search :size="13" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input v-model="actionSearch" class="input h-8 pl-8 text-[12px]" placeholder="搜索动作…" />
          </div>
        </div>
        <div class="scroll-thin flex-1 overflow-y-auto py-1">
          <button
            v-for="action in filteredActions"
            :key="action.name"
            class="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors"
            :class="selected === action.name ? 'bg-muted' : 'hover:bg-muted/50'"
            @click="choose(action.name)"
          >
            <Terminal :size="12" class="mt-0.5 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <p class="mono truncate text-[11.5px]" :class="selected === action.name ? 'font-medium' : ''">
                {{ action.name }}
              </p>
              <p class="mt-0.5 truncate text-[10.5px] text-muted-foreground">{{ action.desc }}</p>
            </div>
            <ChevronRight v-if="selected === action.name" :size="12" class="mt-0.5 shrink-0" />
          </button>
          <EmptyState v-if="!filteredActions.length" title="没有匹配的动作" />
        </div>
        <div class="border-t border-border p-3">
          <p class="mono truncate text-[9.5px] text-muted-foreground">POST {{ endpoint }}</p>
        </div>
      </div>

      <!-- editor -->
      <div class="flex flex-col gap-4">
        <div class="card overflow-hidden">
          <div class="card-head">
            <div class="min-w-0">
              <p class="micro mb-1.5">REQUEST BUILDER</p>
              <h2 class="mono card-title truncate text-[12.5px]">{{ selected || '选择一个动作' }}</h2>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge">POST</span>
              <UiButton size="sm" variant="primary" :loading="running" @click="run">
                <template #icon><Play :size="12" /></template>
                Run
              </UiButton>
            </div>
          </div>

          <div class="grid gap-4 p-4 lg:grid-cols-2">
            <div class="field">
              <label class="field-label"><KeyRound :size="12" /> access_token</label>
              <input v-model="token" class="input input-mono" placeholder="orbit-demo-token" />
              <p class="field-hint">默认密钥来自内置主密钥，可在下方密钥表中轮换。</p>
            </div>
            <div class="field">
              <label class="field-label"><Code2 :size="12" /> echo</label>
              <input class="input input-mono" value="orbit" readonly />
              <p class="field-hint">OneBot 会原样回传，用于关联请求与响应。</p>
            </div>
          </div>

          <div class="px-4 pb-4">
            <div class="mb-1.5 flex items-center justify-between">
              <label class="field-label"><Code2 :size="12" /> params · JSON</label>
              <span v-if="activeAction" class="mono text-[10px] text-muted-foreground">{{ activeAction.params }}</span>
            </div>
            <textarea
              v-model="paramsText"
              rows="6"
              class="textarea input-mono"
              spellcheck="false"
              placeholder='{ "group_id": 700000 }'
            />
            <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span class="text-[10.5px] text-muted-foreground">
                {{ activeAction?.desc || '选择动作后自动填充参数模板' }}
              </span>
              <button class="btn btn-ghost btn-sm" @click="copy(curl, 'curl')">
                <Check v-if="copied === 'curl'" :size="12" style="color: var(--success)" />
                <Copy v-else :size="12" />
                复制 cURL
              </button>
            </div>
          </div>
        </div>

        <!-- response -->
        <div class="card overflow-hidden">
          <div class="card-head">
            <div>
              <p class="micro mb-1.5">RESPONSE</p>
              <h2 class="card-title">响应</h2>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="response" class="badge" :class="response.body.status === 'ok' ? 'badge-success' : 'badge-danger'">
                HTTP {{ response.http }} · {{ ms(response.latency) }}
              </span>
              <span v-else class="badge">IDLE</span>
            </div>
          </div>
          <div v-if="response" class="p-4">
            <div class="mb-3 flex flex-wrap items-center gap-2">
              <span class="badge" :class="response.body.status === 'ok' ? 'badge-success' : 'badge-danger'">
                <CircleCheck v-if="response.body.status === 'ok'" :size="9" />
                <CircleX v-else :size="9" />
                {{ response.body.status }}
              </span>
              <span class="badge">retcode {{ response.body.retcode }}</span>
              <span v-if="response.body.message" class="text-[11px] text-muted-foreground">{{ response.body.message }}</span>
            </div>
            <pre class="scroll-thin max-h-[300px] overflow-auto rounded-md border border-border bg-surface-2 p-3.5 font-mono text-[11.5px] leading-relaxed">{{ jsonOf }}</pre>
          </div>
          <EmptyState
            v-else
            title="等待请求"
            description="选择左侧动作，确认参数后点击 Run。响应会带 HTTP 状态、retcode 与耗时。"
          />
          <div v-if="history.length" class="border-t border-border px-4 py-2.5">
            <p class="micro mb-2">RECENT</p>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="h in history.slice(0, 6)"
                :key="h.id"
                class="badge"
                :class="h.ok ? 'badge-success' : 'badge-danger'"
              >
                {{ h.action }} · {{ ms(h.latency) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- keys -->
    <div class="mt-4 card overflow-hidden">
      <div class="card-head">
        <div>
          <p class="micro mb-1.5">ACCESS KEYS</p>
          <h2 class="card-title">接口密钥</h2>
          <p class="mt-1 text-[11.5px] text-muted-foreground">用于 OneBot HTTP 的 access_token。停用与轮换立即生效。</p>
        </div>
        <UiButton size="sm" @click="createOpen = true">
          <template #icon><Plus :size="12" /></template>
          新建密钥
        </UiButton>
      </div>
      <div class="overflow-x-auto">
        <table class="data-table min-w-[760px]">
          <thead>
            <tr>
              <th>名称</th>
              <th>Token</th>
              <th>创建</th>
              <th>最近使用</th>
              <th>状态</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in keys" :key="key.id">
              <td>
                <div class="flex items-center gap-2">
                  <KeyRound :size="13" class="text-muted-foreground" />
                  <span class="text-[12px]">{{ key.name }}</span>
                  <span v-if="key.id === 'key_main'" class="badge">MAIN</span>
                </div>
              </td>
              <td>
                <div class="flex items-center gap-1.5">
                  <span class="mono text-[10.5px] text-muted-foreground">
                    {{ revealed[key.id] ? key.token : mask(key.token) }}
                  </span>
                  <button class="btn btn-ghost btn-sm btn-icon h-6 w-6" @click="revealed[key.id] = !revealed[key.id]">
                    <EyeOff v-if="revealed[key.id]" :size="11" />
                    <Eye v-else :size="11" />
                  </button>
                  <button class="btn btn-ghost btn-sm btn-icon h-6 w-6" @click="copy(key.token, key.id)">
                    <Check v-if="copied === key.id" :size="11" style="color: var(--success)" />
                    <Copy v-else :size="11" />
                  </button>
                </div>
              </td>
              <td class="mono text-[10.5px] text-muted-foreground">{{ timeAgo(key.createdAt) }}</td>
              <td class="mono text-[10.5px] text-muted-foreground">
                {{ key.lastUsed ? timeAgo(key.lastUsed) : '未使用' }}
              </td>
              <td>
                <button
                  class="badge cursor-pointer"
                  :class="key.enabled ? 'badge-success' : 'badge-danger'"
                  @click="toggleKey(key)"
                >
                  {{ key.enabled ? 'ENABLED' : 'DISABLED' }}
                </button>
              </td>
              <td>
                <div class="flex items-center justify-end gap-1">
                  <button class="btn btn-ghost btn-sm" @click="rotate(key)">
                    <RotateCw :size="12" /> 轮换
                  </button>
                  <button
                    v-if="key.id !== 'key_main'"
                    class="btn btn-ghost btn-sm"
                    :style="pendingDelete === key.id ? { color: 'var(--danger)' } : {}"
                    @click="removeKey(key)"
                  >
                    <Trash2 :size="12" /> {{ pendingDelete === key.id ? '确认删除' : '删除' }}
                  </button>
                  <span v-else class="mono px-2 text-[9.5px] text-subtle-foreground">PROTECTED</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center gap-2 border-t border-border bg-surface-2/40 px-4 py-2.5 text-[10.5px] text-muted-foreground">
        <ShieldCheck :size="11" />
        令牌仅用于本机演示。生产环境请改为环境变量注入，并限制来源 IP。
      </div>
    </div>

    <!-- create modal -->
    <UiModal
      :open="createOpen"
      title="新建接口密钥"
      description="NEW ACCESS KEY"
      width="440px"
      @close="createOpen = false"
    >
      <div class="field">
        <label class="field-label">密钥名称</label>
        <input v-model="createName" class="input" placeholder="例如：监控探针 / 自动化脚本" @keydown.enter="createKey" />
        <p class="field-hint">名称仅用于辨识，不会影响权限。</p>
      </div>
      <template #footer>
        <UiButton size="sm" variant="ghost" @click="createOpen = false">取消</UiButton>
        <UiButton size="sm" variant="primary" :loading="creating" @click="createKey">创建</UiButton>
      </template>
    </UiModal>

    <!-- new key modal -->
    <UiModal
      :open="!!newKey"
      title="密钥已就绪"
      description="ACCESS KEY"
      width="480px"
      @close="newKey = null"
    >
      <div v-if="newKey">
        <p class="text-[12px] text-muted-foreground">请复制并妥善保存以下 token。将它填入 OneBot 请求的 access_token。</p>
        <div class="panel-inset mt-3 flex items-center gap-2 p-3">
          <span class="mono flex-1 break-all text-[11px]">{{ newKey.token }}</span>
          <button class="btn btn-ghost btn-sm btn-icon" @click="copy(newKey.token, 'newkey')">
            <Check v-if="copied === 'newkey'" :size="12" style="color: var(--success)" />
            <Copy v-else :size="12" />
          </button>
        </div>
      </div>
      <template #footer>
        <UiButton size="sm" variant="primary" @click="newKey = null">我已保存</UiButton>
      </template>
    </UiModal>
  </div>
</template>
