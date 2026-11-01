<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  Search, MessageSquare, Users, RefreshCw, Download, Crown, Shield, Pin,
  VolumeX, Volume2, Hash, ArrowUpRight, ChevronRight, Check
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import Avatar from '../components/Avatar.vue'
import UiButton from '../components/UiButton.vue'
import UiSegmented from '../components/UiSegmented.vue'
import UiModal from '../components/UiModal.vue'
import EmptyState from '../components/EmptyState.vue'
import { api, toast } from '../lib/store'
import { navigate } from '../lib/router'
import { timeAgo, dateTime, num } from '../lib/format'

const tab = ref('friends')
const search = ref('')
const friends = ref([])
const groups = ref([])
const members = ref([])
const activeGroup = ref(null)
const modalOpen = ref(false)
const loading = ref(false)
const actionBusy = ref(false)

const filteredFriends = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return friends.value
  return friends.value.filter(
    (f) => f.name.toLowerCase().includes(q) || f.uin.includes(q) || (f.remark || '').toLowerCase().includes(q)
  )
})

const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return groups.value
  return groups.value.filter((g) => g.name.toLowerCase().includes(q) || g.id.includes(q))
})

const onlineFriends = computed(() => friends.value.filter((f) => f.online).length)
const totalMembers = computed(() => groups.value.reduce((sum, g) => sum + g.memberCount, 0))

async function loadAll() {
  loading.value = true
  try {
    const [f, g] = await Promise.all([api.get('/api/friends'), api.get('/api/groups')])
    friends.value = f
    groups.value = g
  } catch (err) {
    toast({ title: '加载失败', description: err.message, tone: 'danger' })
  } finally {
    loading.value = false
  }
}

async function openGroup(group) {
  activeGroup.value = group
  modalOpen.value = true
  try {
    members.value = await api.get(`/api/groups/${group.id}/members`)
  } catch (err) {
    toast({ title: '成员加载失败', description: err.message, tone: 'danger' })
  }
}

async function groupAction(action) {
  if (!activeGroup.value) return
  actionBusy.value = true
  try {
    await api.post(`/api/groups/${activeGroup.value.id}/action`, { action })
    const label = { mute: '已开启全员禁言', unmute: '已关闭全员禁言', pin: '已置顶群聊' }[action] || '操作完成'
    toast({ title: label, description: activeGroup.value.name, tone: action === 'mute' ? 'warning' : 'success' })
    await loadAll()
    activeGroup.value = groups.value.find((g) => g.id === activeGroup.value.id) || activeGroup.value
  } catch (err) {
    toast({ title: '操作失败', description: err.message, tone: 'danger' })
  } finally {
    actionBusy.value = false
  }
}

function openChat(type, targetId) {
  sessionStorage.setItem('orbit.conv', `${type === 'group' ? 'g' : 'p'}:${targetId}`)
  navigate('/messages')
}

function exportContacts() {
  const payload = {
    exportedAt: new Date().toISOString(),
    friends: friends.value,
    groups: groups.value.map(({ members: _m, ...g }) => g)
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orbit-contacts-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast({ title: '联系人已导出', tone: 'success' })
}

const roleLabel = { owner: '群主', admin: '管理', member: '成员' }

onMounted(loadAll)
</script>

<template>
  <div>
    <PageHeader
      eyebrow="CONTACTS / 好友与群"
      title="联系人与群"
      description="好友、群与成员的统一视图。群操作会写入运行日志，并立即反映在事件流中。"
    >
      <template #actions>
        <UiButton size="sm" :loading="loading" @click="loadAll">
          <template #icon><RefreshCw :size="13" /></template>
          刷新
        </UiButton>
        <UiButton size="sm" @click="exportContacts">
          <template #icon><Download :size="13" /></template>
          导出 JSON
        </UiButton>
      </template>
    </PageHeader>

    <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="card p-3.5">
        <p class="micro">FRIENDS</p>
        <p class="num mt-2 text-[20px] font-semibold">{{ friends.length }}</p>
      </div>
      <div class="card p-3.5">
        <p class="micro">ONLINE</p>
        <p class="num mt-2 text-[20px] font-semibold">{{ onlineFriends }}</p>
      </div>
      <div class="card p-3.5">
        <p class="micro">GROUPS</p>
        <p class="num mt-2 text-[20px] font-semibold">{{ groups.length }}</p>
      </div>
      <div class="card p-3.5">
        <p class="micro">TOTAL MEMBERS</p>
        <p class="num mt-2 text-[20px] font-semibold">{{ num(totalMembers) }}</p>
      </div>
    </div>

    <div class="card overflow-hidden">
      <div class="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <UiSegmented
          v-model="tab"
          :options="[
            { value: 'friends', label: `好友 ${friends.length}` },
            { value: 'groups', label: `群组 ${groups.length}` }
          ]"
        />
        <div class="relative w-full sm:w-[280px]">
          <Search :size="13" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="search"
            class="input h-9 pl-8 text-[12px]"
            :placeholder="tab === 'friends' ? '搜索昵称、备注或 QQ 号…' : '搜索群名或群号…'"
          />
        </div>
      </div>

      <!-- friends -->
      <div v-if="tab === 'friends'" class="overflow-x-auto">
        <table class="data-table min-w-[680px]">
          <thead>
            <tr>
              <th>好友</th>
              <th>QQ</th>
              <th>状态</th>
              <th>最近活跃</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="friend in filteredFriends" :key="friend.id">
              <td>
                <div class="flex items-center gap-2.5">
                  <Avatar :text="friend.initials" :size="30" :status="friend.online ? 'online' : ''" />
                  <div class="min-w-0">
                    <p class="truncate text-[12.5px] font-medium">{{ friend.name }}</p>
                    <p class="truncate text-[10.5px] text-muted-foreground">{{ friend.remark || '—' }}</p>
                  </div>
                </div>
              </td>
              <td class="mono text-[11.5px] text-muted-foreground">{{ friend.uin }}</td>
              <td>
                <span class="badge" :class="friend.online ? 'badge-success' : ''">
                  {{ friend.online ? '在线' : '离线' }}
                </span>
              </td>
              <td class="mono text-[11px] text-muted-foreground">{{ timeAgo(friend.lastActive) }}</td>
              <td>
                <div class="flex justify-end">
                  <button
                    class="btn btn-ghost btn-sm"
                    @click="openChat('private', friend.uin)"
                  >
                    <MessageSquare :size="12" /> 发消息
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState
          v-if="!filteredFriends.length"
          title="没有找到好友"
          description="试试更短的关键词，或清空搜索。"
        />
      </div>

      <!-- groups -->
      <div v-else class="overflow-x-auto">
        <table class="data-table min-w-[760px]">
          <thead>
            <tr>
              <th>群组</th>
              <th>群号</th>
              <th>成员</th>
              <th>状态</th>
              <th>创建时间</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in filteredGroups" :key="group.id">
              <td>
                <button class="flex items-center gap-2.5 text-left" @click="openGroup(group)">
                  <Avatar :text="group.initials" :size="30" />
                  <div class="min-w-0">
                    <p class="flex items-center gap-1.5 text-[12.5px] font-medium">
                      <Pin v-if="group.pinned" :size="10" class="text-muted-foreground" />
                      {{ group.name }}
                    </p>
                    <p class="truncate text-[10.5px] text-muted-foreground">{{ group.desc }}</p>
                  </div>
                </button>
              </td>
              <td class="mono text-[11.5px] text-muted-foreground">{{ group.id }}</td>
              <td class="mono text-[11.5px]">{{ num(group.memberCount) }}</td>
              <td>
                <span class="badge" :class="group.muted ? 'badge-warning' : 'badge-success'">
                  {{ group.muted ? '全员禁言' : '正常' }}
                </span>
              </td>
              <td class="mono text-[11px] text-muted-foreground">{{ dateTime(group.createdAt).slice(0, 10) }}</td>
              <td>
                <div class="flex items-center justify-end gap-1">
                  <button class="btn btn-ghost btn-sm" @click="openGroup(group)">
                    成员 <ChevronRight :size="12" />
                  </button>
                  <button class="btn btn-ghost btn-sm" @click="openChat('group', group.id)">
                    <MessageSquare :size="12" /> 发消息
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState
          v-if="!filteredGroups.length"
          title="没有找到群组"
          description="试试群号，或清空搜索条件。"
        />
      </div>
    </div>

    <!-- group modal -->
    <UiModal
      :open="modalOpen"
      :title="activeGroup?.name || '群详情'"
      description="GROUP DETAIL"
      width="780px"
      @close="modalOpen = false"
    >
      <div v-if="activeGroup" class="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div class="flex items-center gap-3">
          <Avatar :text="activeGroup.initials" :size="44" />
          <div>
            <p class="text-[13px] font-medium">{{ activeGroup.name }}</p>
            <p class="mono mt-0.5 text-[10.5px] text-muted-foreground">
              {{ activeGroup.id }} · {{ num(activeGroup.memberCount) }} 人 · 群主 {{ activeGroup.owner }}
            </p>
            <p class="mt-1 text-[11px] text-muted-foreground">{{ activeGroup.desc }}</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <UiButton
            size="sm"
            :loading="actionBusy"
            @click="groupAction(activeGroup.muted ? 'unmute' : 'mute')"
          >
            <template #icon>
              <Volume2 v-if="activeGroup.muted" :size="12" />
              <VolumeX v-else :size="12" />
            </template>
            {{ activeGroup.muted ? '解除禁言' : '全员禁言' }}
          </UiButton>
          <UiButton size="sm" @click="groupAction('pin')">
            <template #icon><Pin :size="12" /></template>
            置顶
          </UiButton>
          <UiButton size="sm" variant="primary" @click="openChat('group', activeGroup.id)">
            <template #icon><MessageSquare :size="12" /></template>
            发消息
          </UiButton>
        </div>
      </div>

      <div class="mb-2 flex items-center justify-between">
        <p class="micro">MEMBERS · {{ members.length }}</p>
        <span class="mono text-[10px] text-muted-foreground">展示前 {{ members.length }} 位</span>
      </div>
      <div class="scroll-thin max-h-[42vh] overflow-y-auto rounded-md border border-border">
        <table class="data-table min-w-[560px]">
          <thead>
            <tr>
              <th>成员</th>
              <th>QQ</th>
              <th>角色</th>
              <th>入群时间</th>
              <th class="text-right">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in members" :key="m.id">
              <td>
                <div class="flex items-center gap-2.5">
                  <Avatar :text="m.initials" :size="28" />
                  <span class="text-[12px]">{{ m.name }}</span>
                </div>
              </td>
              <td class="mono text-[11px] text-muted-foreground">{{ m.uin }}</td>
              <td>
                <span class="badge" :class="m.role === 'owner' ? 'badge-info' : m.role === 'admin' ? 'badge-warning' : ''">
                  <Crown v-if="m.role === 'owner'" :size="9" />
                  <Shield v-else-if="m.role === 'admin'" :size="9" />
                  {{ roleLabel[m.role] }}
                </span>
              </td>
              <td class="mono text-[10.5px] text-muted-foreground">{{ dateTime(m.joinedAt).slice(0, 10) }}</td>
              <td class="text-right">
                <span class="badge" :class="m.muted ? 'badge-danger' : 'badge-success'">
                  {{ m.muted ? '已禁言' : '正常' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template #footer>
        <UiButton size="sm" variant="ghost" @click="modalOpen = false">关闭</UiButton>
        <UiButton size="sm" @click="openChat('group', activeGroup?.id)">进入会话</UiButton>
      </template>
    </UiModal>
  </div>
</template>
