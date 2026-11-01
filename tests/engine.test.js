import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-engine-'))
process.env.ORBIT_DATA_DIR = DATA_DIR
process.env.ORBIT_ACCESS_TOKEN = 'test-bot-token'
process.env.ORBIT_CONSOLE_TOKEN = 'test-console-token'

const { Engine, VERSION, ApiError } = await import('../server/engine.js')

const engine = new Engine()

after(() => {
  engine.destroy()
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
})

test('版本与快照结构正确', () => {
  assert.equal(VERSION, '0.0.1-beta')
  const snap = engine.snapshot()
  assert.equal(snap.account.status, 'online')
  assert.equal(typeof snap.overview.uptimeSeconds, 'number')
  assert.ok(Array.isArray(snap.risk.rules))
  assert.ok(snap.connection.timeline.every((item) => item.id))
})

test('环境变量覆盖主密钥并可通过 authToken 校验', () => {
  assert.equal(engine.apiKeys.find((k) => k.id === 'key_main').token, 'test-bot-token')
  assert.equal(engine.authToken('test-bot-token'), true)
  assert.equal(engine.authToken('orbit-demo-token'), false)
  assert.equal(engine.authToken(''), false)
})

test('发送消息与冷却队列生效', () => {
  const before = engine.snapshot().overview.messagesSent
  const first = engine.sendMessage('g:700000', 'beta 测试消息 A')
  assert.equal(first.queued, false)
  assert.equal(first.message.content, 'beta 测试消息 A')

  const second = engine.sendMessage('g:700000', 'beta 测试消息 B')
  assert.equal(second.queued, true)
  assert.equal(second.reason, '会话冷却中')
  assert.equal(engine.snapshot().risk.queue, 1)
  assert.equal(engine.snapshot().overview.messagesSent, before + 1)
})

test('安全模式会拒绝发送', () => {
  engine.updateRiskConfig({ safeMode: true })
  assert.throws(() => engine.sendMessage('g:700000', '安全模式测试'), (err) => err instanceof ApiError && err.status === 423)
  engine.updateRiskConfig({ safeMode: false })
})

test('OneBot 消息查询与撤回', () => {
  const sent = engine.sendMessage('p:10001', '可撤回的消息')
  const view = engine.handleOneBot('get_msg', { message_id: sent.message.id })
  assert.equal(view.message_id, sent.message.id)
  assert.equal(view.message_type, 'private')
  assert.equal(view.raw_message, '可撤回的消息')

  const result = engine.handleOneBot('delete_msg', { message_id: sent.message.id })
  assert.equal(result.ok, true)
  assert.throws(() => engine.handleOneBot('get_msg', { message_id: sent.message.id }), (err) => err instanceof ApiError && err.status === 404)
})

test('群资料与成员资料动作可用', () => {
  const info = engine.handleOneBot('get_group_info', { group_id: 700000 })
  assert.equal(info.group_id, 700000)
  assert.ok(info.member_count > 0)
  const member = engine.handleOneBot('get_group_member_info', { group_id: 700000, user_id: 20000 })
  assert.equal(member.user_id, 20000)
  assert.equal(member.role, 'owner')
})

test('新增动作在动作清单中', () => {
  const names = engine.onebotActions().map((a) => a.name)
  for (const name of [
    'get_msg',
    'delete_msg',
    'get_group_info',
    'get_group_member_info',
    'get_group_msg_history',
    'get_forward_msg',
    'get_recent_contact',
    'get_unread_count',
    'get_online_clients',
    'get_cookies',
    'can_send_image',
    'set_friend_remark',
    'send_like',
    'set_group_card',
    'set_group_admin',
    'set_group_name',
    'get_group_notice',
    'send_group_notice',
    'get_group_honor_info',
    'get_group_root_files',
    'get_essence_msg_list',
    'get_profile_like'
  ]) {
    assert.ok(names.includes(name), `${name} 应出现在动作清单`)
  }
})

test('网络配置校验与状态视图', () => {
  const view = engine.networkView()
  assert.equal(view.reverseWs.enabled, false)
  assert.equal(view.reverseWs.status, 'idle')
  assert.equal(view.httpReport.enabled, false)
  assert.equal(view.httpReport.secret, '')

  assert.throws(
    () => engine.updateNetworkConfig({ reverseWs: { url: 'http://example.com' } }),
    (err) => err instanceof ApiError && err.status === 400
  )

  const updated = engine.updateNetworkConfig({
    reverseWs: { enabled: true, url: 'ws://127.0.0.1:8099/onebot', reconnectMs: 1500 },
    httpReport: { enabled: true, url: 'http://127.0.0.1:8098/event', secret: 'report-secret' }
  })
  assert.equal(updated.reverseWs.enabled, true)
  assert.equal(updated.reverseWs.status, 'connecting')
  assert.equal(updated.reverseWs.reconnectMs, 1500)
  assert.equal(updated.httpReport.enabled, true)
  assert.equal(updated.httpReport.hasSecret, true)
  assert.equal(updated.httpReport.secret, '••••••')
  assert.equal(engine.snapshot().network.reverseWs.url, 'ws://127.0.0.1:8099/onebot')

  engine.updateNetworkConfig({ reverseWs: { enabled: false }, httpReport: { enabled: false } })
})

test('群公告、文件与荣誉动作', () => {
  const notices = engine.handleOneBot('get_group_notice', { group_id: 700000 })
  assert.ok(notices.length >= 1)
  assert.ok(notices[0].notice_id)

  const created = engine.handleOneBot('send_group_notice', {
    group_id: 700000,
    content: '测试公告：请保持心跳'
  })
  assert.ok(created.notice_id)
  const after = engine.handleOneBot('get_group_notice', { group_id: 700000 })
  assert.equal(after.length, notices.length + 1)
  engine.handleOneBot('delete_group_notice', { group_id: 700000, notice_id: created.notice_id })

  const files = engine.handleOneBot('get_group_root_files', { group_id: 700000 })
  assert.ok(files.files.length >= 2)
  assert.ok(files.folders.length >= 1)
  const stat = engine.handleOneBot('get_group_file_system_info', { group_id: 700000 })
  assert.ok(stat.total_space > stat.used_space)
  const url = engine.handleOneBot('get_group_file_url', { group_id: 700000, file_id: files.files[0].file_id })
  assert.match(url.url, /^https:\/\//)

  const honor = engine.handleOneBot('get_group_honor_info', { group_id: 700000, type: 'all' })
  assert.equal(honor.group_id, 700000)
  assert.ok(honor.talkative_list.length >= 1)
  assert.ok(honor.performer_list.length >= 1)
})

test('历史消息、最近会话与未读计数', () => {
  const history = engine.handleOneBot('get_group_msg_history', { group_id: 700000, count: 3 })
  assert.equal(history.messages.length, 3)
  const friendHistory = engine.handleOneBot('get_friend_msg_history', { user_id: 10001, count: 2 })
  assert.equal(friendHistory.messages.length, 2)

  const recent = engine.handleOneBot('get_recent_contact', { count: 4 })
  assert.equal(recent.length, 4)
  assert.ok(recent[0].lastest_msg)
  assert.equal(engine.handleOneBot('get_unread_count', {}).unread_count > 0, true)

  const conv = engine.conversations.find((c) => c.type === 'group' && c.targetId === '700000')
  const forward = engine.handleOneBot('get_forward_msg', { message_id: conv.messages.at(-1).id })
  assert.ok(forward.messages.length >= 1)
  assert.equal(forward.messages[0].type, 'node')
})

test('账号与关系链动作', () => {
  const clients = engine.handleOneBot('get_online_clients', {})
  assert.equal(clients.length, 1)
  assert.equal(clients[0].online, true)
  assert.match(engine.handleOneBot('get_cookies', { domain: 'qq.com' }).cookies, /uin=/)
  assert.equal(engine.handleOneBot('can_send_image', {}).yes, true)
  assert.equal(engine.handleOneBot('send_like', { user_id: 10001, times: 3 }).times, 3)
  assert.equal(engine.handleOneBot('get_profile_like', {}).favoriteInfo.total_count > 0, true)

  engine.handleOneBot('set_friend_remark', { user_id: 10001, remark: '值班联系人' })
  const remark = engine.friends.find((f) => f.uin === '10001').remark
  assert.equal(remark, '值班联系人')
  const conv = engine.conversations.find((c) => c.type === 'private' && c.targetId === '10001')
  assert.equal(conv.title, '值班联系人')
})

test('群管理动作会同步状态', () => {
  engine.handleOneBot('set_group_card', { group_id: 700000, user_id: 20001, card: '值班 · 江停' })
  const member = engine.handleOneBot('get_group_member_info', { group_id: 700000, user_id: 20001 })
  assert.equal(member.card, '值班 · 江停')

  engine.handleOneBot('set_group_admin', { group_id: 700000, user_id: 20001, enable: true })
  assert.equal(engine.handleOneBot('get_group_member_info', { group_id: 700000, user_id: 20001 }).role, 'admin')

  engine.handleOneBot('set_group_name', { group_id: 700111, group_name: '协议端运维 · 新' })
  assert.equal(engine.handleOneBot('get_group_info', { group_id: 700111 }).group_name, '协议端运维 · 新')
  const conv = engine.conversations.find((c) => c.type === 'group' && c.targetId === '700111')
  assert.equal(conv.title, '协议端运维 · 新')

  engine.handleOneBot('set_group_kick', { group_id: 700111, user_id: 20033 })
  assert.throws(
    () => engine.handleOneBot('get_group_member_info', { group_id: 700111, user_id: 20033 }),
    (err) => err instanceof ApiError && err.status === 404
  )
})

test('精华消息动作', () => {
  const conv = engine.conversations.find((c) => c.type === 'group' && c.targetId === '700000')
  const message = conv.messages.at(-1)
  engine.handleOneBot('set_essence_msg', { message_id: message.id })
  const list = engine.handleOneBot('get_essence_msg_list', { group_id: 700000 })
  assert.equal(list.length, 1)
  assert.equal(list[0].message_id, message.id)
  engine.handleOneBot('delete_essence_msg', { message_id: message.id })
  assert.equal(engine.handleOneBot('get_essence_msg_list', { group_id: 700000 }).length, 0)
})

test('退群会移除群与会话', () => {
  engine.handleOneBot('set_group_leave', { group_id: 700777 })
  assert.equal(engine.groups.some((g) => g.id === '700777'), false)
  assert.equal(engine.conversations.some((c) => c.type === 'group' && c.targetId === '700777'), false)
})
