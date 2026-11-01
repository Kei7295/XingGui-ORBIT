import EventEmitter from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import QRCode from 'qrcode'

export const VERSION = '0.0.1-beta'

const DATA_DIR = process.env.ORBIT_DATA_DIR
  ? path.resolve(process.env.ORBIT_DATA_DIR)
  : path.join(process.cwd(), 'data')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const DEFAULT_TOKEN = process.env.ORBIT_ACCESS_TOKEN || 'orbit-demo-token'

const now = () => Date.now()
const rid = () => Math.random().toString(36).slice(2, 10)

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message)
    this.status = status
    this.data = data
  }
}

const FRIEND_NAMES = [
  '陈疏影', '江停', '林前瞻', '苏晚', '何知远', '顾青', '白露',
  '沈砚', '周也', '温以宁', '阿岚', '唐棠', '许逸', '陆时雨'
]

const GROUP_SEEDS = [
  { name: 'ORBIT 内测节点', members: 186, pinned: true, desc: '协议内核灰度验证 · 只谈稳定性' },
  { name: '协议端运维值班室', members: 74, desc: '7×24 心跳守望，异常即告警' },
  { name: '深夜代码互助会', members: 412, desc: '凌晨两点的报错比白天更诚实' },
  { name: '二次元观测站', members: 928, desc: '番剧 / 同人 / 声优，闲聊为主' },
  { name: '产品需求对撞机', members: 133, desc: '把需求先撞碎，再拼起来' },
  { name: '周末骑行俱乐部', members: 56, desc: '周六 7:00 集合，风雨无阻' },
  { name: 'NOTION 模板交换', members: 321, desc: '模板、看板、自动化流' },
  { name: '打工人的午餐', members: 267, desc: '今天吃什么，是永恒的问题' }
]

const INCOMING_POOL = [
  '心跳包刚刚有个 400ms 的尖刺，帮忙看下出口代理？',
  '收到，我这边重连了一次，现在已经稳定在 32ms。',
  '新版本的风控阈值是不是调高了？我这边连续三条被排队。',
  '群里那条公告我置顶了，晚点同步到值班室。',
  '有没有人试过把冷却调到 3s？感觉更稳一点。',
  '刚才的日志我导出了，回头发你。',
  '这个 QR 过期时间能不能拉到 3 分钟，扫码有点赶。',
  '今天的在线率 100%，一次都没掉，舒服。',
  '@ORBIT 帮我查下 uin 3312 的登录状态。',
  '午饭吃什么，投票：麻辣烫 / 沙拉 / 便利店。',
  '接口返回 retcode 0，但是 data 是空的，是不是 action 拼错了？',
  '把夜间静默开一下吧，凌晨两点发消息太像机器人了。',
  '我顺手把出口节点切到备用，延迟降了 18ms。',
  '这个版本的事件流终于不闪了，点赞。'
]

const REPLIES = [
  '已收到，正在核对链路状态。',
  '明白，我先把这条放进冷却队列，避免触发阈值。',
  '日志已记录，稍后同步完整链路诊断。',
  '好的，这条我转给值班同学。',
  '当前风险评分处于低位，可以正常发送。',
  '我先用备用出口试一下，30 秒后给你结果。',
  '收到，已经为这个会话加上 2.5s 冷却。'
]

const AVATAR_TONES = ['zinc', 'zinc', 'zinc']

function initials(name) {
  if (!name) return '?'
  const clean = name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
  if (/^[\u4e00-\u9fa5]/.test(clean)) return clean.slice(-2)
  return clean.slice(0, 2).toUpperCase() || '?'
}

function seededRandom(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export class Engine extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(50)
    this.bootAt = now()
    this.instanceId = `orbit-${rid()}`
    this.accounts = []
    this.friends = []
    this.groups = []
    this.conversations = []
    this.logs = []
    this.activity = []
    this.overview = {
      messagesSent: 0,
      messagesReceived: 0,
      reconnects: 0,
      latencyMs: 34,
      riskScore: 12,
      latency: [],
      rateWindow: [],
      riskTrend: []
    }
    this.risk = {
      enabled: true,
      safeMode: false,
      score: 12,
      level: 'low',
      budget: { used: 0, limit: 30, windowSeconds: 60 },
      cooldownUntil: 0,
      rules: [
        { id: 'budget', name: '发送预算', desc: '60 秒窗口内的发送上限，超限自动排队', enabled: true },
        { id: 'cooldown', name: '会话冷却', desc: '同一会话两次发送至少间隔 2.4s', enabled: true },
        { id: 'dedupe', name: '内容去重', desc: '30s 内相同内容自动拦截，避免刷屏', enabled: true },
        { id: 'humanize', name: '拟人化间隔', desc: '按句长与标点抖动发送时间', enabled: true },
        { id: 'spread', name: '随机化发送', desc: '在预算内随机分配时间片，避免机械节拍', enabled: true },
        { id: 'night', name: '夜间静默', desc: '23:30–07:00 仅响应白名单会话', enabled: false }
      ],
      intercepted: []
    }
    this.connection = {
      heartbeatMs: 20000,
      heartbeatTimeoutMs: 60000,
      maxReconnectAttempts: 12,
      backoffBaseMs: 500,
      backoffMaxMs: 30000,
      jitter: 0.3,
      watchdog: true,
      autoRelogin: true,
      endpoints: [
        { id: 'ws-main', name: '主链路 · WebSocket', url: 'ws://127.0.0.1:3001/', priority: 1, status: 'connected', rtt: 28 },
        { id: 'http-backup', name: '备用 · HTTP', url: 'http://127.0.0.1:3000/', priority: 2, status: 'standby', rtt: 46 },
        { id: 'proxy', name: '出口代理 · SOCKS5', url: 'socks5://127.0.0.1:10808', priority: 3, status: 'healthy', rtt: 19 }
      ],
      timeline: []
    }
    this.consoleToken = process.env.ORBIT_CONSOLE_TOKEN || crypto.randomBytes(16).toString('hex')
    this.settings = {
      botName: 'ORBIT',
      apiToken: DEFAULT_TOKEN,
      webhook: 'https://example.com/orbit/hook',
      autoTraffic: true,
      autoReply: false,
      nightQuiet: false,
      dataRetentionDays: 7,
      defaultReply: '已收到，我会在处理队列里安排。'
    }
    this.network = {
      reverseWs: {
        enabled: false,
        url: 'ws://127.0.0.1:8082/onebot/v11/ws',
        reconnectMs: 3000,
        status: 'idle',
        connectedAt: 0,
        attempts: 0,
        lastError: ''
      },
      httpReport: {
        enabled: false,
        url: 'http://127.0.0.1:8083/onebot/event',
        secret: '',
        status: 'idle',
        lastAt: 0,
        lastError: '',
        delivered: 0,
        failed: 0
      }
    }
    this.apiKeys = [
      { id: 'key_main', name: '控制台 · 主密钥', token: DEFAULT_TOKEN, createdAt: now() - 86400000 * 12, lastUsed: now() - 60000, enabled: true }
    ]
    this.health = { cpu: 22, memory: 48, queue: 0 }
    this.queue = []
    this.sendStamps = []
    this.lastSendAt = {}
    this.lastIncomingAt = now()
    this.nextIncomingGap = 9000
    this.lastInterceptAt = 0
    this.lastHeartbeatLog = now()
    this.tick = 0
    this.metrics = { incoming: 0, outgoing: 0 }
    this.reconnectTimer = null
    this.persistDirty = false

    this.seed()
    this.load()
    if (process.env.ORBIT_ACCESS_TOKEN) {
      const main = this.apiKeys.find((k) => k.id === 'key_main')
      if (main) main.token = process.env.ORBIT_ACCESS_TOKEN
      this.settings.apiToken = process.env.ORBIT_ACCESS_TOKEN
    }
    this.overview.latency = Array.from({ length: 36 }, () => Math.round(24 + Math.random() * 18))
    this.overview.riskTrend = Array.from({ length: 36 }, () => Math.round(9 + Math.random() * 8))
    this.overview.rateWindow = Array.from({ length: 36 }, () => Math.round(Math.random() * 2))
    this.attachTimers()
  }

  /* ------------------------------------------------------------------ seed */

  seed() {
    const t = now()
    this.accounts = [
      {
        id: 'acc_main',
        uin: '2846721930',
        nickname: 'ORBIT 小轨',
        initials: 'OR',
        status: 'online',
        device: 'iPad Pro · Android 12',
        protocol: 'OneBot 11 · WS',
        loginAt: t - 1000 * 60 * 60 * 26,
        lastHeartbeat: t,
        reconnectCount: 0,
        riskScore: 11,
        primary: true
      },
      {
        id: 'acc_backup',
        uin: '3312005817',
        nickname: '备用节点',
        initials: 'BK',
        status: 'offline',
        device: 'Pixel 7 · Android 14',
        protocol: 'OneBot 11 · HTTP',
        loginAt: 0,
        lastHeartbeat: 0,
        reconnectCount: 2,
        riskScore: 0,
        primary: false
      }
    ]

    this.friends = FRIEND_NAMES.map((name, i) => ({
      id: `f_${10001 + i}`,
      uin: String(10001 + i),
      name,
      initials: initials(name),
      remark: i % 3 === 0 ? `${name} · 运维` : '',
      online: i % 2 === 0,
      lastActive: t - 1000 * 60 * (5 + i * 8),
      level: 3 + (i % 4)
    }))

    const rnd = seededRandom(20261031)
    this.groups = GROUP_SEEDS.map((seed, gi) => {
      const id = String(700000 + gi * 111)
      const memberTotal = seed.members
      const names = FRIEND_NAMES.concat(FRIEND_NAMES).slice(0, 14)
      const members = names.map((name, mi) => ({
        id: `m_${id}_${mi}`,
        uin: String(20000 + gi * 20 + mi),
        name,
        initials: initials(name),
        role: mi === 0 ? 'owner' : mi < 3 ? 'admin' : 'member',
        muted: mi > 8 && rnd() > 0.6,
        joinedAt: t - 1000 * 60 * 60 * (10 + mi * 30)
      }))
      return {
        id,
        name: seed.name,
        initials: initials(seed.name),
        memberCount: memberTotal,
        owner: 'ORBIT 小轨',
        desc: seed.desc,
        muted: false,
        pinned: !!seed.pinned,
        createdAt: t - 1000 * 60 * 60 * 24 * (30 + gi * 10),
        notices:
          gi < 2
            ? [
                {
                  notice_id: `notice_${id}_1`,
                  sender_id: 2846721930,
                  sender_name: 'ORBIT 小轨',
                  time: Math.floor((t - 1000 * 60 * 60 * 6) / 1000),
                  content: gi === 0 ? '灰度验证期间请勿修改发送预算，异常直接贴日志。' : '值班表已更新，凌晨班次请在 00:00 前完成交接。'
                }
              ]
            : [],
        essence: [],
        members
      }
    })

    this.conversations = []

    // group conversations
    this.groups.forEach((group, gi) => {
      const messages = this.seedMessages(group.id, gi % 3)
      this.conversations.push({
        id: `g:${group.id}`,
        type: 'group',
        targetId: group.id,
        title: group.name,
        initials: group.initials,
        subtitle: `${group.memberCount} 人 · ${group.desc}`,
        unread: gi === 0 ? 3 : gi % 4 === 0 ? 1 : 0,
        pinned: group.pinned,
        lastAt: messages.at(-1)?.ts || t,
        messages
      })
    })

    // private conversations
    this.friends.forEach((friend, fi) => {
      const messages = this.seedMessages(`p:${friend.uin}`, fi + 2, true)
      this.conversations.push({
        id: `p:${friend.uin}`,
        type: 'private',
        targetId: friend.uin,
        title: friend.remark || friend.name,
        initials: friend.initials,
        subtitle: friend.online ? '在线 · 手机' : '离线',
        unread: fi === 1 ? 2 : 0,
        pinned: false,
        lastAt: messages.at(-1)?.ts || t,
        messages
      })
    })
  }

  seedMessages(convId, variant, isPrivate = false) {
    const t = now()
    const pool = isPrivate
      ? [
          ['in', '在吗？看下今天的在线率。'],
          ['out', '在的，今天 100%，心跳全部正常。'],
          ['in', '那我先把夜间静默关了，凌晨要跑批。'],
          ['out', '好，记得把发送预算提到 40，跑批容易超。']
        ]
      : [
          ['in', '今天的容灾演练准备好了吗？'],
          ['out', '准备好了，watchdog 与指数退避都已开启。'],
          ['in', '重连的首次等待是多少？'],
          ['out', '500ms 起步，带 30% 抖动，最大 30s。'],
          ['in', '可以，演练的时候我在群里盯着。'],
          ['out', '我同步一条演练公告，稍等。']
        ]
    const chosen = pool.slice(0, 3 + (variant % 3))
    return chosen.map(([dir, content], i) => ({
      id: `msg_${convId}_${i}_${rid()}`,
      sender:
        dir === 'out'
          ? { id: 'acc_main', uin: this.accounts[0].uin, name: this.accounts[0].nickname, initials: this.accounts[0].initials }
          : { id: isPrivate ? convId.slice(2) : `seed_${i}`, uin: isPrivate ? convId.slice(2) : '', name: i % 2 === 0 ? '陈疏影' : '江停', initials: initials(i % 2 === 0 ? '陈疏影' : '江停') },
      direction: dir,
      kind: 'text',
      content,
      ts: t - 1000 * 60 * ((chosen.length - i) * 7 + variant * 3),
      state: 'sent'
    }))
  }

  /* ----------------------------------------------------------- persistence */

  load() {
    try {
      if (!fs.existsSync(STATE_FILE)) return
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
      if (data.accounts?.length) this.accounts = data.accounts
      if (data.conversations?.length) this.conversations = data.conversations
      if (data.groups?.length) this.groups = data.groups
      if (data.settings) this.settings = { ...this.settings, ...data.settings }
      if (data.risk) this.risk = { ...this.risk, ...data.risk, safeMode: false }
      if (data.connection) this.connection = { ...this.connection, ...data.connection, timeline: [] }
      if (data.network) {
        const rev = data.network.reverseWs || {}
        const rep = data.network.httpReport || {}
        Object.assign(this.network.reverseWs, {
          enabled: !!rev.enabled,
          url: rev.url || this.network.reverseWs.url,
          reconnectMs: Math.max(500, Number(rev.reconnectMs) || this.network.reverseWs.reconnectMs)
        })
        Object.assign(this.network.httpReport, {
          enabled: !!rep.enabled,
          url: rep.url || this.network.httpReport.url,
          secret: String(rep.secret || '')
        })
      }
      if (data.apiKeys?.length) this.apiKeys = data.apiKeys
      if (data.overview) {
        this.overview.messagesSent = data.overview.messagesSent || 0
        this.overview.messagesReceived = data.overview.messagesReceived || 0
        this.overview.reconnects = data.overview.reconnects || 0
      }
      // A fresh process always starts with a clean session.
      this.accounts.forEach((a) => {
        if (a.status !== 'offline') {
          a.status = 'online'
          a.lastHeartbeat = now()
        }
      })
      this.log('info', 'CORE', '从本地快照恢复状态')
    } catch (err) {
      this.log('warn', 'CORE', `快照读取失败：${err.message}`)
    }
  }

  schedulePersist() {
    this.persistDirty = true
  }

  persist() {
    if (!this.persistDirty) return
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      const data = {
        savedAt: now(),
        accounts: this.accounts,
        groups: this.groups,
        conversations: this.conversations.map((c) => ({
          ...c,
          messages: c.messages.slice(-80)
        })),
        settings: this.settings,
        risk: {
          enabled: this.risk.enabled,
          budget: this.risk.budget,
          rules: this.risk.rules
        },
        connection: {
          heartbeatMs: this.connection.heartbeatMs,
          heartbeatTimeoutMs: this.connection.heartbeatTimeoutMs,
          maxReconnectAttempts: this.connection.maxReconnectAttempts,
          backoffBaseMs: this.connection.backoffBaseMs,
          backoffMaxMs: this.connection.backoffMaxMs,
          jitter: this.connection.jitter,
          watchdog: this.connection.watchdog,
          autoRelogin: this.connection.autoRelogin,
          endpoints: this.connection.endpoints
        },
        apiKeys: this.apiKeys,
        network: {
          reverseWs: {
            enabled: this.network.reverseWs.enabled,
            url: this.network.reverseWs.url,
            reconnectMs: this.network.reverseWs.reconnectMs
          },
          httpReport: {
            enabled: this.network.httpReport.enabled,
            url: this.network.httpReport.url,
            secret: this.network.httpReport.secret
          }
        },
        overview: {
          messagesSent: this.overview.messagesSent,
          messagesReceived: this.overview.messagesReceived,
          reconnects: this.overview.reconnects
        }
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2))
      this.persistDirty = false
    } catch (err) {
      this.log('error', 'CORE', `快照写入失败：${err.message}`)
    }
  }

  /* ---------------------------------------------------------------- helpers */

  log(level, module, message) {
    const entry = { id: `log_${rid()}`, ts: now(), level, module, message }
    this.logs.unshift(entry)
    if (this.logs.length > 320) this.logs.length = 320
    this.emit('broadcast', { event: 'log', data: entry })
    return entry
  }

  addActivity({ type, title, detail, tone = 'default', toast = false }) {
    const item = { id: `act_${rid()}`, ts: now(), type, title, detail, tone }
    this.activity.unshift(item)
    if (this.activity.length > 30) this.activity.length = 30
    this.emit('broadcast', { event: 'notice', data: { ...item, toast } })
    return item
  }

  primaryAccount() {
    return this.accounts.find((a) => a.status === 'online') || this.accounts.find((a) => a.primary) || this.accounts[0]
  }

  onlineAccount() {
    return this.accounts.find((a) => a.status === 'online') || null
  }

  findConversation(id) {
    const conv = this.conversations.find((c) => c.id === id)
    if (!conv) throw new ApiError(404, '会话不存在')
    return conv
  }

  budgetUsed() {
    const windowMs = 60000
    this.sendStamps = this.sendStamps.filter((s) => now() - s < windowMs)
    return this.sendStamps.length
  }

  riskLevel(score) {
    if (score >= 70) return 'high'
    if (score >= 40) return 'medium'
    return 'low'
  }

  /* --------------------------------------------------------------- snapshot */

  snapshot() {
    const online = this.accounts.find((a) => a.status === 'online')
    const sinceLogin = online?.loginAt ? Math.floor((now() - online.loginAt) / 1000) : 0
    return {
      account: this.primaryAccount() || null,
      accounts: this.accounts,
      overview: {
        uptimeSeconds: Math.floor((now() - this.bootAt) / 1000),
        onlineSeconds: sinceLogin,
        reconnects: this.overview.reconnects,
        messagesSent: this.overview.messagesSent,
        messagesReceived: this.overview.messagesReceived,
        latencyMs: Math.round(this.overview.latencyMs),
        riskScore: Math.round(this.risk.score),
        latency: this.overview.latency.slice(-48),
        rateWindow: this.overview.rateWindow.slice(-48),
        riskTrend: this.overview.riskTrend.slice(-48)
      },
      risk: {
        enabled: this.risk.enabled,
        safeMode: this.risk.safeMode,
        score: Math.round(this.risk.score),
        level: this.riskLevel(this.risk.score),
        budget: { used: this.budgetUsed(), limit: this.risk.budget.limit, windowSeconds: 60 },
        cooldownUntil: this.risk.cooldownUntil,
        rules: this.risk.rules,
        intercepted: this.risk.intercepted.slice(0, 12),
        queue: this.queue.length,
        queueItems: this.queue.slice(0, 6)
      },
      connection: {
        heartbeatMs: this.connection.heartbeatMs,
        heartbeatTimeoutMs: this.connection.heartbeatTimeoutMs,
        maxReconnectAttempts: this.connection.maxReconnectAttempts,
        backoffBaseMs: this.connection.backoffBaseMs,
        backoffMaxMs: this.connection.backoffMaxMs,
        jitter: this.connection.jitter,
        watchdog: this.connection.watchdog,
        autoRelogin: this.connection.autoRelogin,
        endpoints: this.connection.endpoints,
        timeline: this.connection.timeline.slice(0, 16)
      },
      health: {
        cpu: Math.round(this.health.cpu),
        memory: Math.round(this.health.memory),
        queue: this.queue.length,
        sessions: this.onlineAccount() ? 1 : 0
      },
      activity: this.activity.slice(0, 16),
      settings: {
        botName: this.settings.botName,
        webhook: this.settings.webhook,
        autoTraffic: this.settings.autoTraffic,
        autoReply: this.settings.autoReply,
        nightQuiet: this.settings.nightQuiet,
        dataRetentionDays: this.settings.dataRetentionDays
      },
      network: this.networkView()
    }
  }

  broadcastSnapshot() {
    this.emit('broadcast', { event: 'snapshot', data: this.snapshot() })
  }

  /* ------------------------------------------------------------------ loops */

  attachTimers() {
    this.loop = setInterval(() => this.onTick(), 1000)
    this.persistLoop = setInterval(() => this.persist(), 8000)
  }

  destroy() {
    clearInterval(this.loop)
    clearInterval(this.persistLoop)
    clearTimeout(this.reconnectTimer)
    this.removeAllListeners()
  }

  onTick() {
    this.tick += 1
    const online = this.accounts.find((a) => a.status === 'online')
    const t = now()

    // latency random walk with occasional spikes
    const prev = this.overview.latencyMs
    let next = prev + (Math.random() - 0.5) * 6
    if (Math.random() < 0.02) next += Math.random() * 80
    this.overview.latencyMs = Math.min(160, Math.max(16, next))

    if (online) {
      online.lastHeartbeat = t
      online.latency = Math.round(this.overview.latencyMs)
      this.overview.rateWindow.push(Math.round(this.metrics.outgoing || 0))
      if (this.overview.rateWindow.length > 60) this.overview.rateWindow.shift()
      this.metrics.outgoing = Math.max(0, this.metrics.outgoing - 0.35)

      // heartbeat journal every ~20s
      if (t - this.lastHeartbeatLog >= this.connection.heartbeatMs) {
        this.lastHeartbeatLog = t
        this.log('debug', 'HEARTBEAT', `心跳正常 · RTT ${Math.round(this.overview.latencyMs)}ms`)
      }
    } else {
      this.overview.rateWindow.push(0)
    }

    // synthetic inbound traffic
    if (online && this.settings.autoTraffic && t - this.lastIncomingAt > this.nextIncomingGap) {
      this.lastIncomingAt = t
      this.nextIncomingGap = 7000 + Math.random() * 12000
      this.generateIncoming()
    }

    // risk score
    const used = this.budgetUsed()
    const target =
      (this.risk.safeMode ? 6 : 10) +
      used * 1.15 +
      this.queue.length * 2.4 +
      (this.overview.latencyMs > 80 ? 6 : 0) +
      (Math.random() - 0.5) * 5
    this.risk.score = Math.max(2, Math.min(94, this.risk.score * 0.88 + target * 0.12))
    this.risk.score = Math.round(this.risk.score * 10) / 10
    this.risk.level = this.riskLevel(this.risk.score)
    this.risk.budget.used = used
    this.risk.budget.limit = this.risk.budget.limit || 30
    this.overview.riskTrend.push(Math.round(this.risk.score))
    if (this.overview.riskTrend.length > 60) this.overview.riskTrend.shift()

    // high-risk guard
    if (
      this.risk.enabled &&
      !this.risk.safeMode &&
      this.risk.score > 72 &&
      t - this.lastInterceptAt > 18000
    ) {
      this.lastInterceptAt = t
      const reason = used > this.risk.budget.limit * 0.8 ? '窗口预算接近上限' : '风险评分越过阈值'
      this.risk.cooldownUntil = t + 8000
      this.risk.intercepted.unshift({
        id: `int_${rid()}`,
        ts: t,
        reason,
        action: '自动冷却 8s',
        detail: `评分 ${Math.round(this.risk.score)} · 近 60s 已发 ${used} 条`
      })
      if (this.risk.intercepted.length > 20) this.risk.intercepted.length = 20
      this.log('warn', 'RISK', `${reason}，自动进入冷却`)
      this.addActivity({
        type: 'risk',
        title: '风险防护已介入',
        detail: `${reason}，自动冷却 8 秒`,
        tone: 'warning'
      })
    }

    // drain queue
    this.drainQueue()

    // health drift
    this.health.cpu = Math.max(8, Math.min(72, this.health.cpu + (Math.random() - 0.5) * 4))
    this.health.memory = Math.max(35, Math.min(78, this.health.memory + (Math.random() - 0.5) * 1.2))

    if (this.tick % 2 === 0) this.broadcastSnapshot()
    if (this.tick % 9 === 0) this.schedulePersist()
  }

  generateIncoming() {
    const conv = this.conversations[Math.floor(Math.random() * this.conversations.length)]
    if (!conv || conv.muted) return
    const friend = this.friends[Math.floor(Math.random() * this.friends.length)]
    const name = conv.type === 'private' ? conv.title : friend.name
    const message = {
      id: `msg_${rid()}`,
      sender: { id: friend.id, uin: friend.uin, name, initials: initials(name) },
      direction: 'in',
      kind: 'text',
      content: INCOMING_POOL[Math.floor(Math.random() * INCOMING_POOL.length)],
      ts: now(),
      state: 'sent'
    }
    conv.messages.push(message)
    if (conv.messages.length > 140) conv.messages.shift()
    conv.lastAt = message.ts
    conv.unread = (conv.unread || 0) + 1
    this.overview.messagesReceived += 1
    this.emit('broadcast', { event: 'message', data: { conversationId: conv.id, message } })
    this.addActivity({
      type: 'message',
      title: `${name} 发来一条消息`,
      detail: message.content.slice(0, 42),
      tone: 'default'
    })
    if (this.settings.autoReply) {
      this.queueReply(conv, message)
    }
  }

  queueReply(conv, message) {
    const reply = REPLIES[Math.floor(Math.random() * REPLIES.length)]
    const delay = 1500 + Math.random() * 3500
    setTimeout(() => {
      if (this.accounts.some((a) => a.status === 'online')) {
        this.appendOutgoing(conv, reply, { kind: 'text', state: 'sent' })
        this.overview.messagesSent += 1
        this.metrics.outgoing += 1
        this.sendStamps.push(now())
        this.emit('broadcast', { event: 'message', data: { conversationId: conv.id, message: conv.messages.at(-1) } })
      }
    }, delay)
    this.log('info', 'AUTO', `自动回复已排入队列 · ${conv.title}`)
  }

  appendOutgoing(conv, content, extra = {}) {
    const account = this.primaryAccount()
    const message = {
      id: `msg_${rid()}`,
      sender: { id: account.id, uin: account.uin, name: account.nickname, initials: account.initials },
      direction: 'out',
      kind: extra.kind || 'text',
      content,
      ts: now(),
      state: extra.state || 'sent',
      ...extra
    }
    conv.messages.push(message)
    if (conv.messages.length > 140) conv.messages.shift()
    conv.lastAt = message.ts
    conv.unread = 0
    return message
  }

  /* ---------------------------------------------------------------- actions */

  startLogin(accountId) {
    const account = accountId
      ? this.accounts.find((a) => a.id === accountId)
      : this.accounts.find((a) => a.status !== 'online') || null
    if (!account) throw new ApiError(409, '没有可登录的账号，请新建')
    if (account.status === 'online') throw new ApiError(409, '该账号已在线')

    account.status = 'scanning'
    account.loginAt = 0
    const ticket = rid() + rid()
    const expiresAt = now() + 120000
    this.pendingLogins = this.pendingLogins || new Map()
    this.pendingLogins.set(account.id, { ticket, expiresAt })

    const payload = `orbit://auth?uin=${account.uin}&ticket=${ticket}`
    this.log('info', 'LOGIN', `生成登录二维码 · ${account.uin}`)
    this.addActivity({ type: 'login', title: '等待扫码', detail: `${account.nickname} · ${account.uin}`, tone: 'info' })
    this.broadcastSnapshot()
    this.schedulePersist()

    return QRCode.toDataURL(payload, {
      margin: 1,
      width: 420,
      errorCorrectionLevel: 'M',
      color: { dark: '#111113', light: '#ffffff' }
    }).then((qr) => ({ accountId: account.id, qr, expiresIn: 120, ticket }))
  }

  confirmLogin(accountId) {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) throw new ApiError(404, '账号不存在')
    if (account.status === 'online') return account
    const pending = this.pendingLogins?.get(accountId)
    if (!pending) throw new ApiError(409, '请先生成二维码')
    if (now() > pending.expiresAt) {
      account.status = 'offline'
      throw new ApiError(410, '二维码已过期，请重新生成')
    }
    account.status = 'confirming'
    this.broadcastSnapshot()

    setTimeout(() => {
      account.status = 'online'
      account.loginAt = now()
      account.lastHeartbeat = now()
      account.riskScore = 8
      this.pendingLogins.delete(accountId)
      this.overview.riskScore = 8
      this.log('info', 'LOGIN', `账号上线 · ${account.nickname} (${account.uin})`)
      this.addActivity({
        type: 'login',
        title: '账号已上线',
        detail: `${account.nickname} · ${account.uin} · 会话建立完成`,
        tone: 'success',
        toast: true
      })
      this.broadcastSnapshot()
      this.schedulePersist()
    }, 1200)

    return { ...account, status: 'confirming' }
  }

  logout(accountId) {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) throw new ApiError(404, '账号不存在')
    account.status = 'offline'
    account.loginAt = 0
    this.log('warn', 'LOGIN', `主动下线 · ${account.uin}`)
    this.addActivity({ type: 'login', title: '账号已下线', detail: account.nickname, tone: 'warning' })
    this.broadcastSnapshot()
    this.schedulePersist()
    return account
  }

  simulateDrop(accountId) {
    const account = accountId
      ? this.accounts.find((a) => a.id === accountId)
      : this.accounts.find((a) => a.status === 'online')
    if (!account) throw new ApiError(409, '当前没有在线账号')
    if (account.status !== 'online') throw new ApiError(409, '账号不在线')

    account.status = 'offline'
    account.loginAt = 0
    this.log('error', 'LINK', `链路中断 · ${account.uin} · 模拟网络抖动`)
    this.addActivity({
      type: 'link',
      title: '检测到链路中断',
      detail: 'watchdog 已接管，正在执行退避重连',
      tone: 'danger',
      toast: true
    })
    this.broadcastSnapshot()

    if (this.connection.watchdog && this.connection.autoRelogin) {
      this.reconnect(account.id, true)
    }
    return account
  }

  reconnect(accountId, auto = false) {
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account) throw new ApiError(404, '账号不存在')
    if (account.status === 'online') throw new ApiError(409, '账号已在线')

    clearTimeout(this.reconnectTimer)
    const cfg = this.connection
    const maxAttempts = cfg.maxReconnectAttempts
    let attempt = 0

    const step = () => {
      attempt += 1
      if (attempt > maxAttempts) {
        account.status = 'offline'
        this.connection.timeline.unshift({
          id: `tl_${rid()}`,
          ts: now(),
          attempt,
          state: 'failed',
          delay: 0,
          note: '达到最大重试次数，等待人工介入'
        })
        this.connection.timeline = this.connection.timeline.slice(0, 20)
        this.log('error', 'LINK', '重连达到上限，链接挂起')
        this.addActivity({ type: 'link', title: '重连失败', detail: `已尝试 ${maxAttempts} 次`, tone: 'danger', toast: true })
        this.broadcastSnapshot()
        return
      }

      account.status = 'reconnecting'
      const delay = Math.min(
        cfg.backoffMaxMs,
        cfg.backoffBaseMs * Math.pow(2, attempt - 1) * (1 + (Math.random() - 0.5) * cfg.jitter)
      )
      this.connection.timeline.unshift({
        id: `tl_${rid()}`,
        ts: now(),
        attempt,
        state: 'waiting',
        delay: Math.round(delay),
        note: `${Math.round(delay)}ms 后尝试第 ${attempt} 次握手`
      })
      this.connection.timeline = this.connection.timeline.slice(0, 20)
      this.log('info', 'LINK', `第 ${attempt} 次重连 · 退避 ${Math.round(delay)}ms`)
      this.broadcastSnapshot()

      this.reconnectTimer = setTimeout(() => {
        // stable link succeeds on the second or third attempt most of the time
        const success = attempt >= (auto ? 2 : 1)
        if (success) {
          account.status = 'online'
          account.loginAt = now()
          account.lastHeartbeat = now()
          account.reconnectCount = (account.reconnectCount || 0) + 1
          this.overview.reconnects += 1
          this.connection.timeline.unshift({
            id: `tl_${rid()}`,
            ts: now(),
            attempt,
            state: 'success',
            delay: 0,
            note: `握手成功 · 第 ${attempt} 次`
          })
          this.connection.timeline = this.connection.timeline.slice(0, 20)
          this.log('info', 'LINK', `重连成功 · ${account.uin}`)
          this.addActivity({
            type: 'link',
            title: '链路已恢复',
            detail: `第 ${attempt} 次握手成功，会话已接管`,
            tone: 'success',
            toast: true
          })
          this.broadcastSnapshot()
          this.schedulePersist()
        } else {
          step()
        }
      }, delay)
    }

    step()
    return { ok: true }
  }

  /* ---------------------------------------------------------------- sending */

  sendMessage(conversationId, content, meta = {}) {
    const conv = this.findConversation(conversationId)
    const trimmed = String(content || '').trim()
    if (!trimmed) throw new ApiError(400, '消息内容不能为空')
    if (!this.accounts.some((a) => a.status === 'online')) throw new ApiError(409, '账号不在线，无法发送')
    if (this.risk.safeMode) throw new ApiError(423, '安全模式已开启，发送被挂起', { safeMode: true })

    const ruleOn = (id) => this.risk.enabled && this.risk.rules.find((r) => r.id === id)?.enabled

    // duplicate guard
    if (ruleOn('dedupe')) {
      const recent = conv.messages.slice(-8).filter((m) => m.direction === 'out')
      if (recent.some((m) => m.content === trimmed && now() - m.ts < 30000)) {
        const int = {
          id: `int_${rid()}`,
          ts: now(),
          reason: '内容去重',
          action: '已拦截',
          detail: '30s 内重复内容，避免刷屏触发风控'
        }
        this.risk.intercepted.unshift(int)
        this.log('warn', 'RISK', '重复内容已拦截')
        return { blocked: true, reason: '内容去重', message: '30 秒内已发送过相同内容' }
      }
    }

    const used = this.budgetUsed()
    const limit = this.risk.budget.limit
    const last = this.lastSendAt[conversationId] || 0
    const cooldown = ruleOn('cooldown') ? 2400 : 0
    const needsCooldown = now() - last < cooldown || (this.risk.cooldownUntil || 0) > now()
    const overBudget = ruleOn('budget') && used >= limit

    if (needsCooldown || overBudget) {
      const reason = overBudget ? '窗口预算已满' : '会话冷却中'
      const entry = {
        id: `q_${rid()}`,
        conversationId,
        content: trimmed,
        ts: now(),
        reason
      }
      this.queue.push(entry)
      this.log('info', 'QUEUE', `${reason} · 已排队 ${this.queue.length}`)
      this.broadcastSnapshot()
      return {
        queued: true,
        position: this.queue.length,
        reason,
        message: `${reason}，消息已进入发送队列`
      }
    }

    const message = this.appendOutgoing(conv, trimmed)
    this.lastSendAt[conversationId] = now()
    this.sendStamps.push(now())
    this.overview.messagesSent += 1
    this.metrics.outgoing += 1
    this.log('info', 'SEND', `已发送 · ${conv.title} · ${trimmed.slice(0, 24)}`)
    this.emit('broadcast', { event: 'message', data: { conversationId: conv.id, message } })
    this.broadcastSnapshot()
    this.schedulePersist()
    return { queued: false, message }
  }

  drainQueue() {
    if (!this.queue.length) return
    if (!this.accounts.some((a) => a.status === 'online') || this.risk.safeMode) return
    if (this.risk.cooldownUntil > now()) return
    if (this.risk.enabled && this.budgetUsed() >= this.risk.budget.limit) return

    const entry = this.queue[0]
    const conv = this.conversations.find((c) => c.id === entry.conversationId)
    if (!conv) {
      this.queue.shift()
      return
    }
    const cooldown = this.risk.enabled && this.risk.rules.find((r) => r.id === 'cooldown')?.enabled ? 2400 : 0
    if (now() - (this.lastSendAt[conv.id] || 0) < cooldown) return

    this.queue.shift()
    const message = this.appendOutgoing(conv, entry.content)
    this.lastSendAt[conv.id] = now()
    this.sendStamps.push(now())
    this.overview.messagesSent += 1
    this.metrics.outgoing += 1
    this.log('info', 'QUEUE', `队列出队并送达 · ${conv.title}`)
    this.emit('broadcast', { event: 'message', data: { conversationId: conv.id, message } })
    this.addActivity({ type: 'queue', title: '队列消息已送达', detail: `${conv.title} · ${entry.content.slice(0, 30)}`, tone: 'success' })
    this.broadcastSnapshot()
  }

  applyOneBotSend(type, targetId, content, source = 'onebot') {
    let conv = null
    if (type === 'group') {
      conv = this.conversations.find((c) => c.type === 'group' && c.targetId === String(targetId))
      if (!conv) throw new ApiError(404, '群聊不存在')
    } else {
      conv = this.conversations.find((c) => c.type === 'private' && c.targetId === String(targetId))
      if (!conv) throw new ApiError(404, '私聊对象不存在')
    }
    const result = this.sendMessage(conv.id, content, { source })
    return { ...result, message_id: result.message?.id || null, conversation_id: conv.id }
  }

  /* ------------------------------------------------------------------ config */

  updateRiskConfig(patch) {
    if (patch.budgetLimit !== undefined) {
      this.risk.budget.limit = Math.max(1, Math.min(120, Number(patch.budgetLimit) || 30))
    }
    if (patch.safeMode !== undefined) {
      this.risk.safeMode = !!patch.safeMode
      if (!this.risk.safeMode) this.risk.cooldownUntil = 0
    }
    if (Array.isArray(patch.rules)) {
      patch.rules.forEach((incoming) => {
        const rule = this.risk.rules.find((r) => r.id === incoming.id)
        if (rule) rule.enabled = !!incoming.enabled
      })
    }
    this.log('info', 'RISK', patch.safeMode === undefined ? '风险策略已更新' : `安全模式 ${patch.safeMode ? '开启' : '关闭'}`)
    this.addActivity({
      type: 'risk',
      title: patch.safeMode === undefined ? '风险策略已更新' : '安全模式已切换',
      detail: patch.safeMode === undefined ? `预算 ${this.risk.budget.limit}/60s` : patch.safeMode ? '所有外发消息挂起' : '恢复正常发送',
      tone: patch.safeMode ? 'warning' : 'default'
    })
    this.broadcastSnapshot()
    this.schedulePersist()
    return this.risk
  }

  updateConnectionConfig(patch) {
    Object.assign(this.connection, patch)
    this.log('info', 'LINK', '链路策略已更新')
    this.broadcastSnapshot()
    this.schedulePersist()
    return this.connection
  }

  testConnection() {
    const results = this.connection.endpoints.map((e) => {
      const ok = e.id !== 'http-backup' || Math.random() > 0.15
      const rtt = ok ? Math.round(12 + Math.random() * 55) : 0
      return { id: e.id, name: e.name, ok, rtt }
    })
    results.forEach((r) => {
      const ep = this.connection.endpoints.find((e) => e.id === r.id)
      if (ep) {
        ep.status = r.ok ? (ep.priority === 1 ? 'connected' : 'healthy') : 'down'
        ep.rtt = r.rtt
      }
    })
    this.log('info', 'LINK', `链路诊断完成 · ${results.filter((r) => r.ok).length}/${results.length} 可用`)
    this.broadcastSnapshot()
    return results
  }

  updateSettings(patch) {
    Object.assign(this.settings, patch)
    if (patch.autoTraffic !== undefined) {
      this.log('info', 'CORE', `模拟流量 ${patch.autoTraffic ? '已开启' : '已关闭'}`)
    }
    this.broadcastSnapshot()
    this.schedulePersist()
    return this.settings
  }

  /* ------------------------------------------------------------------ network */

  networkView() {
    const rev = this.network.reverseWs
    const rep = this.network.httpReport
    return {
      reverseWs: {
        enabled: rev.enabled,
        url: rev.url,
        reconnectMs: rev.reconnectMs,
        status: rev.status,
        connected: rev.status === 'connected',
        connectedAt: rev.connectedAt,
        attempts: rev.attempts,
        lastError: rev.lastError
      },
      httpReport: {
        enabled: rep.enabled,
        url: rep.url,
        secret: rep.secret ? '••••••' : '',
        hasSecret: !!rep.secret,
        status: rep.status,
        lastAt: rep.lastAt,
        lastError: rep.lastError,
        delivered: rep.delivered,
        failed: rep.failed
      }
    }
  }

  updateNetworkConfig(patch = {}) {
    const revPatch = patch.reverseWs
    const repPatch = patch.httpReport
    if (revPatch) {
      if (revPatch.url !== undefined) {
        const url = String(revPatch.url).trim()
        if (!/^wss?:\/\//.test(url)) throw new ApiError(400, '反向 WS 地址必须以 ws:// 或 wss:// 开头')
        this.network.reverseWs.url = url
      }
      if (revPatch.reconnectMs !== undefined) {
        this.network.reverseWs.reconnectMs = Math.max(500, Math.min(60000, Number(revPatch.reconnectMs) || 3000))
      }
      if (revPatch.enabled !== undefined) {
        this.network.reverseWs.enabled = !!revPatch.enabled
        this.network.reverseWs.status = revPatch.enabled ? 'connecting' : 'idle'
        this.network.reverseWs.connectedAt = 0
        if (!revPatch.enabled) this.network.reverseWs.lastError = ''
      }
    }
    if (repPatch) {
      if (repPatch.url !== undefined) {
        const url = String(repPatch.url).trim()
        if (!/^https?:\/\//.test(url)) throw new ApiError(400, '事件上报地址必须以 http:// 或 https:// 开头')
        this.network.httpReport.url = url
      }
      if (repPatch.secret !== undefined) {
        this.network.httpReport.secret = String(repPatch.secret)
      }
      if (repPatch.enabled !== undefined) {
        this.network.httpReport.enabled = !!repPatch.enabled
        this.network.httpReport.status = repPatch.enabled ? 'ready' : 'idle'
      }
    }
    this.log(
      'info',
      'NET',
      `反向 WS ${this.network.reverseWs.enabled ? '开启' : '关闭'} · HTTP 上报 ${this.network.httpReport.enabled ? '开启' : '关闭'}`
    )
    this.broadcastSnapshot()
    this.schedulePersist()
    return this.networkView()
  }

  setReverseStatus(patch = {}) {
    Object.assign(this.network.reverseWs, patch)
    if (patch.status === 'connected') {
      this.network.reverseWs.connectedAt = now()
      this.log('info', 'NET', `反向 WS 已连接 · ${this.network.reverseWs.url}`)
    } else if (patch.status === 'error') {
      this.log('warn', 'NET', `反向 WS 连接失败：${patch.lastError || '未知错误'}`)
    }
    this.emit('broadcast', { event: 'network', data: this.networkView() })
    return this.networkView()
  }

  setReportStatus(patch = {}) {
    Object.assign(this.network.httpReport, patch)
    this.emit('broadcast', { event: 'network', data: this.networkView() })
    return this.networkView()
  }

  noteReportDelivery(ok, error = '') {
    const rep = this.network.httpReport
    rep.lastAt = now()
    if (ok) {
      rep.delivered += 1
      rep.status = 'ready'
      rep.lastError = ''
    } else {
      rep.failed += 1
      rep.status = 'error'
      rep.lastError = String(error || '上报失败').slice(0, 160)
    }
  }

  listKeys() {
    return this.apiKeys.map((k) => ({ ...k }))
  }

  createKey(name) {
    const raw = `orbit_${rid()}${rid()}`
    const key = {
      id: `key_${rid()}`,
      name: String(name || '新密钥'),
      token: raw,
      createdAt: now(),
      lastUsed: 0,
      enabled: true,
      fresh: true
    }
    this.apiKeys.push(key)
    this.log('info', 'AUTH', `创建 API 密钥 · ${key.name}`)
    this.schedulePersist()
    return key
  }

  rotateKey(id) {
    const key = this.apiKeys.find((k) => k.id === id)
    if (!key) throw new ApiError(404, '密钥不存在')
    const raw = `orbit_${rid()}${rid()}`
    key.token = raw
    key.lastUsed = 0
    this.log('info', 'AUTH', `轮换 API 密钥 · ${key.name}`)
    this.schedulePersist()
    return key
  }

  removeKey(id) {
    const idx = this.apiKeys.findIndex((k) => k.id === id)
    if (idx < 0) throw new ApiError(404, '密钥不存在')
    if (this.apiKeys[idx].id === 'key_main') throw new ApiError(409, '主密钥不可删除')
    const [removed] = this.apiKeys.splice(idx, 1)
    this.log('warn', 'AUTH', `删除 API 密钥 · ${removed.name}`)
    this.schedulePersist()
    return { ok: true }
  }

  toggleKey(id) {
    const key = this.apiKeys.find((k) => k.id === id)
    if (!key) throw new ApiError(404, '密钥不存在')
    key.enabled = !key.enabled
    this.schedulePersist()
    return key
  }

  authToken(token) {
    if (!token) return false
    return this.apiKeys.some((k) => k.enabled && k.token === token)
  }

  /* ------------------------------------------------------------------ onebot */

  onebotActions() {
    return [
      { name: 'get_login_info', desc: '获取当前账号信息', params: '无' },
      { name: 'get_status', desc: '获取运行状态', params: '无' },
      { name: 'get_version_info', desc: '获取协议端版本', params: '无' },
      { name: 'get_friend_list', desc: '获取好友列表', params: '无' },
      { name: 'get_group_list', desc: '获取群列表', params: '无' },
      { name: 'get_group_member_list', desc: '获取群成员列表', params: 'group_id' },
      { name: 'get_group_member_info', desc: '获取群成员资料', params: 'group_id, user_id' },
      { name: 'get_group_info', desc: '获取群资料', params: 'group_id' },
      { name: 'get_group_info_ex', desc: '获取群扩展资料', params: 'group_id' },
      { name: 'get_stranger_info', desc: '获取陌生人信息', params: 'user_id' },
      { name: 'send_private_msg', desc: '发送私聊消息', params: 'user_id, message' },
      { name: 'send_group_msg', desc: '发送群聊消息', params: 'group_id, message' },
      { name: 'send_msg', desc: '通用发送', params: 'message_type, user_id / group_id, message' },
      { name: 'get_msg', desc: '获取消息详情', params: 'message_id' },
      { name: 'delete_msg', desc: '撤回 / 删除消息', params: 'message_id' },
      { name: 'mark_msg_as_read', desc: '标记消息已读', params: 'message_id' },
      { name: 'get_friend_msg_history', desc: '获取私聊历史消息', params: 'user_id, count' },
      { name: 'get_group_msg_history', desc: '获取群历史消息', params: 'group_id, count' },
      { name: 'get_forward_msg', desc: '获取合并转发内容', params: 'message_id' },
      { name: 'get_recent_contact', desc: '获取最近会话', params: 'count' },
      { name: 'get_unread_count', desc: '获取未读计数', params: '无' },
      { name: 'get_online_clients', desc: '获取在线客户端', params: '无' },
      { name: 'get_cookies', desc: '获取登录 Cookie', params: 'domain' },
      { name: 'get_csrf_token', desc: '获取 CSRF Token', params: '无' },
      { name: 'can_send_image', desc: '检查是否可发送图片', params: '无' },
      { name: 'can_send_record', desc: '检查是否可发送语音', params: '无' },
      { name: 'get_image', desc: '获取图片文件信息', params: 'file' },
      { name: 'get_record', desc: '获取语音文件信息', params: 'file' },
      { name: 'get_file', desc: '获取文件信息', params: 'file' },
      { name: 'set_friend_remark', desc: '设置好友备注', params: 'user_id, remark' },
      { name: 'set_qq_profile', desc: '设置账号资料', params: 'nickname' },
      { name: 'send_like', desc: '名片点赞', params: 'user_id, times' },
      { name: 'set_group_ban', desc: '禁言群成员', params: 'group_id, user_id, duration' },
      { name: 'set_group_whole_ban', desc: '全员禁言开关', params: 'group_id, enable' },
      { name: 'set_group_card', desc: '设置群名片', params: 'group_id, user_id, card' },
      { name: 'set_group_admin', desc: '设置群管理员', params: 'group_id, user_id, enable' },
      { name: 'set_group_name', desc: '修改群名称', params: 'group_id, group_name' },
      { name: 'set_group_special_title', desc: '设置群头衔', params: 'group_id, user_id, special_title' },
      { name: 'set_group_kick', desc: '踢出群成员', params: 'group_id, user_id' },
      { name: 'set_group_leave', desc: '退出群聊', params: 'group_id' },
      { name: 'get_group_at_all_remain', desc: '查询 @全体 剩余次数', params: 'group_id' },
      { name: 'get_group_notice', desc: '获取群公告', params: 'group_id' },
      { name: 'send_group_notice', desc: '发布群公告', params: 'group_id, content' },
      { name: 'delete_group_notice', desc: '删除群公告', params: 'group_id, notice_id' },
      { name: 'get_group_honor_info', desc: '获取群荣誉', params: 'group_id, type' },
      { name: 'get_group_system_msg', desc: '获取群系统消息', params: '无' },
      { name: 'get_group_file_system_info', desc: '获取群文件统计', params: 'group_id' },
      { name: 'get_group_root_files', desc: '获取群根目录文件', params: 'group_id' },
      { name: 'get_group_files_by_folder', desc: '获取群文件夹内容', params: 'group_id, folder_id' },
      { name: 'get_group_file_url', desc: '获取群文件下载地址', params: 'group_id, file_id' },
      { name: 'delete_group_file', desc: '删除群文件', params: 'group_id, file_id' },
      { name: 'get_essence_msg_list', desc: '获取群精华消息', params: 'group_id' },
      { name: 'set_essence_msg', desc: '设为精华消息', params: 'message_id' },
      { name: 'delete_essence_msg', desc: '移除精华消息', params: 'message_id' },
      { name: 'get_profile_like', desc: '获取账号获赞信息', params: '无' }
    ]
  }

  handleOneBot(action, params = {}) {
    const account = this.primaryAccount()
    switch (action) {
      case 'get_login_info':
        if (!account) throw new ApiError(403, '没有可用的登录账号')
        return { user_id: Number(account.uin), nickname: account.nickname }
      case 'get_status':
        return {
          online: this.accounts.some((a) => a.status === 'online'),
          good: this.risk.score < 70,
          stat: { packet_sent: this.overview.messagesSent, packet_received: this.overview.messagesReceived }
        }
      case 'get_version_info':
        return { app_name: 'ORBIT', app_name_cn: '星轨', app_version: VERSION, protocol_version: '11', runtime: 'node' }
      case 'get_friend_list':
        return this.friends.map((f) => ({ user_id: Number(f.uin), nickname: f.name, remark: f.remark }))
      case 'get_group_list':
        return this.groups.map((g) => ({
          group_id: Number(g.id),
          group_name: g.name,
          member_count: g.memberCount,
          max_member_count: Math.max(500, g.memberCount)
        }))
      case 'get_group_member_list': {
        const group = this.groups.find((g) => g.id === String(params.group_id))
        if (!group) throw new ApiError(404, '群不存在')
        return group.members.map((m) => ({
          group_id: Number(group.id),
          user_id: Number(m.uin),
          nickname: m.name,
          role: m.role,
          card: m.card || '',
          muted: m.muted
        }))
      }
      case 'send_private_msg':
        return this.applyOneBotSend('private', params.user_id, this.normalizeMessage(params.message))
      case 'send_group_msg':
        return this.applyOneBotSend('group', params.group_id, this.normalizeMessage(params.message))
      case 'send_msg':
        if (params.message_type === 'group') {
          return this.applyOneBotSend('group', params.group_id, this.normalizeMessage(params.message))
        }
        return this.applyOneBotSend('private', params.user_id, this.normalizeMessage(params.message))
      case 'set_group_ban': {
        const group = this.groups.find((g) => g.id === String(params.group_id))
        if (!group) throw new ApiError(404, '群不存在')
        const member = group.members.find((m) => m.uin === String(params.user_id))
        if (!member) throw new ApiError(404, '成员不存在')
        member.muted = Number(params.duration) > 0
        this.log('warn', 'GROUP', `禁言 ${member.name} · ${params.duration}s`)
        this.broadcastSnapshot()
        return { ok: true }
      }
      case 'set_group_whole_ban': {
        const group = this.groups.find((g) => g.id === String(params.group_id))
        if (!group) throw new ApiError(404, '群不存在')
        group.muted = !!params.enable
        this.log('warn', 'GROUP', `全员禁言 · ${group.name} · ${params.enable ? '开' : '关'}`)
        return { ok: true }
      }
      case 'get_stranger_info': {
        const friend = this.friends.find((f) => f.uin === String(params.user_id))
        if (friend) {
          return { user_id: Number(friend.uin), nickname: friend.name, sex: 'unknown', age: 0 }
        }
        let stranger = null
        for (const group of this.groups) {
          stranger = group.members.find((m) => m.uin === String(params.user_id))
          if (stranger) break
        }
        if (!stranger) throw new ApiError(404, '用户不存在')
        return { user_id: Number(stranger.uin), nickname: stranger.name, sex: 'unknown', age: 0 }
      }
      case 'get_group_info': {
        const group = this.groups.find((g) => g.id === String(params.group_id))
        if (!group) throw new ApiError(404, '群不存在')
        return {
          group_id: Number(group.id),
          group_name: group.name,
          member_count: group.memberCount,
          max_member_count: Math.max(500, group.memberCount),
          owner_id: Number(group.members[0]?.uin || 0),
          group_memo: group.desc || ''
        }
      }
      case 'get_group_member_info': {
        const group = this.groups.find((g) => g.id === String(params.group_id))
        if (!group) throw new ApiError(404, '群不存在')
        const member = group.members.find((m) => m.uin === String(params.user_id))
        if (!member) throw new ApiError(404, '成员不存在')
        return {
          group_id: Number(group.id),
          user_id: Number(member.uin),
          nickname: member.name,
          card: member.card || member.name,
          role: member.role,
          muted: member.muted
        }
      }
      case 'get_msg': {
        const { conv, message } = this.findMessage(params.message_id)
        return this.toOneBotMessage(conv, message)
      }
      case 'delete_msg': {
        const { conv, message } = this.findMessage(params.message_id)
        const idx = conv.messages.indexOf(message)
        if (idx > -1) conv.messages.splice(idx, 1)
        this.log('warn', 'ONEBOT', `撤回消息 · ${conv.title} · ${message.content.slice(0, 18)}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true, message_id: message.id }
      }
      case 'mark_msg_as_read': {
        const { conv } = this.findMessage(params.message_id)
        conv.unread = 0
        this.broadcastSnapshot()
        return { ok: true }
      }
      case 'get_friend_msg_history':
      case 'get_group_msg_history': {
        const isGroup = action === 'get_group_msg_history'
        const conv = isGroup
          ? this.conversations.find((c) => c.type === 'group' && c.targetId === String(params.group_id))
          : this.conversations.find((c) => c.type === 'private' && c.targetId === String(params.user_id))
        if (!conv) throw new ApiError(404, isGroup ? '群聊不存在' : '私聊对象不存在')
        const count = Math.max(1, Math.min(100, Number(params.count) || 20))
        return { messages: conv.messages.slice(-count).map((m) => this.toOneBotMessage(conv, m)) }
      }
      case 'get_forward_msg': {
        const { conv, message } = this.findMessage(params.message_id)
        const nodes = conv.messages.slice(-5).map((m) => ({
          type: 'node',
          data: {
            user_id: Number(m.sender?.uin) || 0,
            nickname: m.sender?.name || '',
            time: Math.floor(m.ts / 1000),
            content: m.content
          }
        }))
        return { messages: nodes, message_id: message.id }
      }
      case 'get_recent_contact': {
        const count = Math.max(1, Math.min(50, Number(params.count) || 10))
        return this.conversations
          .slice()
          .sort((a, b) => b.lastAt - a.lastAt)
          .slice(0, count)
          .map((c) => ({
            lastest_msg: c.messages.at(-1) ? this.toOneBotMessage(c, c.messages.at(-1)) : null,
            peer_name: c.title,
            peer_uin: Number(c.targetId) || 0,
            conversation_id: c.id,
            type: c.type
          }))
      }
      case 'get_unread_count':
        return { unread_count: this.conversations.reduce((sum, c) => sum + (c.unread || 0), 0) }
      case 'get_online_clients': {
        const online = this.accounts.filter((a) => a.status === 'online')
        return online.map((a) => ({
          app_id: 10000,
          device_name: a.device,
          device_kind: 'iPad',
          online: true
        }))
      }
      case 'get_cookies': {
        const main = this.accounts[0]
        return { cookies: `uin=o${main?.uin || 0}; skey=@orbit; p_skey=orbit` }
      }
      case 'get_csrf_token':
        return { token: 9100 + (Number(this.accounts[0]?.uin || 0) % 89) }
      case 'can_send_image':
      case 'can_send_record':
        return { yes: true }
      case 'get_image':
      case 'get_record':
      case 'get_file': {
        const file = String(params.file || params.file_id || '')
        if (!file) throw new ApiError(400, '缺少 file 参数')
        return {
          file,
          url: `https://orbit.local/assets/${encodeURIComponent(file)}`,
          file_size: 1024,
          file_name: file.includes('.') ? file : `${file}.dat`
        }
      }
      case 'set_friend_remark': {
        const friend = this.friends.find((f) => f.uin === String(params.user_id))
        if (!friend) throw new ApiError(404, '好友不存在')
        friend.remark = String(params.remark || '')
        const conv = this.conversations.find((c) => c.type === 'private' && c.targetId === friend.uin)
        if (conv) conv.title = friend.remark || friend.name
        this.log('info', 'ONEBOT', `设置好友备注 · ${friend.name} → ${friend.remark || '无'}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'set_qq_profile': {
        if (!account) throw new ApiError(403, '没有可用的登录账号')
        if (params.nickname) account.nickname = String(params.nickname)
        this.log('info', 'ONEBOT', `更新账号昵称 · ${account.nickname}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'send_like': {
        const friend = this.friends.find((f) => f.uin === String(params.user_id))
        if (!friend) throw new ApiError(404, '好友不存在')
        const times = Math.max(1, Math.min(20, Number(params.times) || 1))
        this.log('info', 'ONEBOT', `名片点赞 · ${friend.name} ×${times}`)
        return { ok: true, times }
      }
      case 'set_group_card': {
        const { group, member } = this.requireGroupMember(params)
        member.card = String(params.card || '')
        this.log('info', 'ONEBOT', `设置群名片 · ${group.name} · ${member.card || '清空'}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'set_group_admin': {
        const { group, member } = this.requireGroupMember(params)
        member.role = params.enable ? 'admin' : 'member'
        this.log('info', 'ONEBOT', `${params.enable ? '设置' : '取消'}管理员 · ${member.name}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'set_group_name': {
        const group = this.findGroup(params.group_id)
        const name = String(params.group_name || '').trim()
        if (!name) throw new ApiError(400, '群名称不能为空')
        group.name = name
        group.initials = initials(name)
        const conv = this.conversations.find((c) => c.type === 'group' && c.targetId === group.id)
        if (conv) {
          conv.title = name
          conv.initials = group.initials
        }
        this.log('info', 'ONEBOT', `修改群名称 · ${name}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'set_group_special_title': {
        const { group, member } = this.requireGroupMember(params)
        member.specialTitle = String(params.special_title || '')
        this.log('info', 'ONEBOT', `设置群头衔 · ${group.name} · ${member.name}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'set_group_kick': {
        const { group, member } = this.requireGroupMember(params)
        group.members = group.members.filter((m) => m.uin !== member.uin)
        group.memberCount = Math.max(1, group.memberCount - 1)
        this.log('warn', 'ONEBOT', `移出群成员 · ${group.name} · ${member.name}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'set_group_leave': {
        const group = this.findGroup(params.group_id)
        this.groups = this.groups.filter((g) => g.id !== group.id)
        this.conversations = this.conversations.filter(
          (c) => !(c.type === 'group' && c.targetId === group.id)
        )
        this.log('warn', 'ONEBOT', `退出群聊 · ${group.name}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'get_group_at_all_remain': {
        const group = this.findGroup(params.group_id)
        return {
          can_at_all: true,
          remain_at_all_count_for_group: Math.max(0, 20 - (this.tick % 20)),
          remain_at_all_count_for_uin: Math.max(0, 10 - (this.tick % 10)),
          group_id: Number(group.id)
        }
      }
      case 'get_group_notice': {
        const group = this.findGroup(params.group_id)
        if (!group.notices) group.notices = []
        return group.notices.map((n) => ({ ...n }))
      }
      case 'send_group_notice': {
        const group = this.findGroup(params.group_id)
        const content = String(params.content || '').trim()
        if (!content) throw new ApiError(400, '公告内容不能为空')
        if (!group.notices) group.notices = []
        const notice = {
          notice_id: `notice_${rid()}`,
          sender_id: Number(account?.uin || 0),
          sender_name: account?.nickname || 'ORBIT',
          time: Math.floor(now() / 1000),
          content
        }
        group.notices.unshift(notice)
        this.log('info', 'ONEBOT', `发布群公告 · ${group.name}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return notice
      }
      case 'delete_group_notice': {
        const group = this.findGroup(params.group_id)
        const id = String(params.notice_id || '')
        group.notices = (group.notices || []).filter((n) => n.notice_id !== id)
        this.log('info', 'ONEBOT', `删除群公告 · ${group.name}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'get_group_honor_info': {
        const group = this.findGroup(params.group_id)
        const talkatives = group.members.slice(1, 4).map((m, i) => ({
          user_id: Number(m.uin),
          nickname: m.name,
          avatar: '',
          day_count: 12 - i * 3
        }))
        const performers = group.members.slice(0, 3).map((m, i) => ({
          user_id: Number(m.uin),
          nickname: m.name,
          avatar: '',
          description: ['连续 30 天在线', '夜间守望者', '文档贡献者'][i]
        }))
        return {
          group_id: Number(group.id),
          current_talkative: talkatives[0] || null,
          talkative_list: talkatives,
          performer_list: performers,
          legend_list: [],
          strong_newbie_list: [],
          emotion_list: []
        }
      }
      case 'get_group_system_msg':
        return { invited_requests: [], join_requests: [] }
      case 'get_group_file_system_info': {
        const group = this.findGroup(params.group_id)
        const files = this.demoGroupFiles(group)
        return {
          file_count: files.length + 12,
          limit_count: 2000,
          used_space: 1024 * 1024 * 48,
          total_space: 1024 * 1024 * 1024 * 10
        }
      }
      case 'get_group_root_files': {
        const group = this.findGroup(params.group_id)
        return {
          files: this.demoGroupFiles(group),
          folders: [
            {
              group_id: Number(group.id),
              folder_id: `gfolder_${group.id}_ops`,
              folder_name: '运维归档',
              create_time: Math.floor(now() / 1000) - 86400 * 30,
              creator: Number(group.members[0]?.uin || 0),
              creator_name: group.members[0]?.name || '',
              total_file_count: 18
            }
          ]
        }
      }
      case 'get_group_files_by_folder': {
        const group = this.findGroup(params.group_id)
        return { files: this.demoGroupFiles(group), folders: [] }
      }
      case 'get_group_file_url': {
        const group = this.findGroup(params.group_id)
        const fileId = String(params.file_id || '')
        if (!fileId) throw new ApiError(400, '缺少 file_id')
        return { url: `https://orbit.local/group/${group.id}/files/${encodeURIComponent(fileId)}` }
      }
      case 'delete_group_file': {
        const group = this.findGroup(params.group_id)
        if (!params.file_id) throw new ApiError(400, '缺少 file_id')
        this.log('warn', 'ONEBOT', `删除群文件 · ${group.name} · ${params.file_id}`)
        this.broadcastSnapshot()
        return { ok: true }
      }
      case 'get_essence_msg_list': {
        const group = this.findGroup(params.group_id)
        return (group.essence || []).map((item) => ({ ...item }))
      }
      case 'set_essence_msg': {
        const { conv, message } = this.findMessage(params.message_id)
        const group = this.groups.find((g) => conv.type === 'group' && g.id === conv.targetId)
        if (!group) throw new ApiError(400, '仅支持群聊消息设为精华')
        if (!group.essence) group.essence = []
        if (!group.essence.some((e) => e.message_id === message.id)) {
          group.essence.unshift({
            message_id: message.id,
            sender_id: Number(message.sender?.uin) || 0,
            sender_nick: message.sender?.name || '',
            operator_id: Number(account?.uin || 0),
            operator_nick: account?.nickname || '',
            message_time: Math.floor(message.ts / 1000),
            content: message.content
          })
        }
        this.log('info', 'ONEBOT', `设为精华消息 · ${group.name}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'delete_essence_msg': {
        const { conv, message } = this.findMessage(params.message_id)
        const group = this.groups.find((g) => conv.type === 'group' && g.id === conv.targetId)
        if (!group) throw new ApiError(400, '仅支持群聊消息')
        group.essence = (group.essence || []).filter((e) => e.message_id !== message.id)
        this.log('info', 'ONEBOT', `移除精华消息 · ${group.name}`)
        this.broadcastSnapshot()
        this.schedulePersist()
        return { ok: true }
      }
      case 'get_profile_like': {
        return {
          uid: Number(account?.uin || 0),
          time: Math.floor(now() / 1000),
          favoriteInfo: { total_count: 128, last_time: Math.floor(now() / 1000) - 3600 },
          voteInfo: { total_count: 64, new_count: 3, new_nearby_count: 1, last_visit_time: Math.floor(now() / 1000) }
        }
      }
      default:
        throw new ApiError(404, `不支持的动作：${action}`, { retcode: 1404 })
    }
  }

  findGroup(groupId) {
    const group = this.groups.find((g) => g.id === String(groupId))
    if (!group) throw new ApiError(404, '群不存在')
    return group
  }

  requireGroupMember(params = {}) {
    const group = this.findGroup(params.group_id)
    const member = group.members.find((m) => m.uin === String(params.user_id))
    if (!member) throw new ApiError(404, '成员不存在')
    return { group, member }
  }

  demoGroupFiles(group) {
    const uploader = group.members[0] || {}
    return [
      { file_id: `gf_${group.id}_drill`, file_name: '容灾演练记录.md', file_size: 18_432, busid: 102, upload_time: Math.floor(now() / 1000) - 7200, dead_time: 0, modify_time: Math.floor(now() / 1000) - 7200, download_times: 6, uploader: Number(uploader.uin || 0), uploader_name: uploader.name || '' },
      { file_id: `gf_${group.id}_log`, file_name: 'heartbeat-2026-10-31.log', file_size: 1_048_576, busid: 102, upload_time: Math.floor(now() / 1000) - 86400, dead_time: 0, modify_time: Math.floor(now() / 1000) - 86400, download_times: 2, uploader: Number(uploader.uin || 0), uploader_name: uploader.name || '' }
    ]
  }

  findMessage(messageId) {
    const id = String(messageId ?? '')
    for (const conv of this.conversations) {
      const message = conv.messages.find((m) => m.id === id)
      if (message) return { conv, message }
    }
    throw new ApiError(404, '消息不存在', { retcode: 1404 })
  }

  toOneBotMessage(conv, message) {
    const isGroup = conv.type === 'group'
    const target = String(conv.targetId)
    const selfId = Number(this.primaryAccount()?.uin || 0)
    const userId = Number(message.sender?.uin) || (isGroup ? 0 : Number(target))
    return {
      message_id: message.id,
      message: message.content,
      raw_message: message.content,
      font: 0,
      message_type: conv.type,
      sub_type: isGroup ? 'normal' : 'friend',
      time: Math.floor(message.ts / 1000),
      self_id: selfId,
      target_id: Number(target),
      sender: { user_id: userId, nickname: message.sender?.name || '' },
      ...(isGroup ? { group_id: Number(target), group_name: conv.title } : { user_id: userId })
    }
  }

  normalizeMessage(message) {
    if (typeof message === 'string') return message
    if (Array.isArray(message)) {
      return message
        .map((seg) => (seg.type === 'text' ? seg.data?.text || '' : `[${seg.type}]`))
        .join('')
    }
    if (message && typeof message === 'object') return message.text || ''
    return ''
  }

  /* ------------------------------------------------------------------ lists */

  conversationsList() {
    return this.conversations
      .slice()
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.lastAt - a.lastAt)
      .map((c) => ({
        id: c.id,
        type: c.type,
        targetId: c.targetId,
        title: c.title,
        initials: c.initials,
        subtitle: c.subtitle,
        unread: c.unread || 0,
        pinned: !!c.pinned,
        muted: !!c.muted,
        lastAt: c.lastAt,
        preview: c.messages.at(-1)?.content || '',
        lastDirection: c.messages.at(-1)?.direction || 'in'
      }))
  }

  getMessages(conversationId) {
    return this.findConversation(conversationId).messages
  }

  markRead(conversationId) {
    const conv = this.findConversation(conversationId)
    conv.unread = 0
    this.broadcastSnapshot()
    return { ok: true }
  }

  friendsList() {
    return this.friends
  }

  groupsList() {
    return this.groups.map(({ members, ...g }) => ({ ...g, memberCount: g.memberCount }))
  }

  groupMembers(groupId) {
    const group = this.groups.find((g) => g.id === String(groupId))
    if (!group) throw new ApiError(404, '群不存在')
    return group.members
  }

  groupAction(groupId, action) {
    const group = this.groups.find((g) => g.id === String(groupId))
    if (!group) throw new ApiError(404, '群不存在')
    if (action === 'mute') group.muted = true
    if (action === 'unmute') group.muted = false
    if (action === 'pin') group.pinned = true
    this.log('info', 'GROUP', `群操作 · ${group.name} · ${action}`)
    this.broadcastSnapshot()
    return group
  }

  logsList({ level = 'all', q = '' } = {}) {
    let list = this.logs
    if (level !== 'all') list = list.filter((l) => l.level === level)
    if (q) {
      const needle = q.toLowerCase()
      list = list.filter(
        (l) =>
          l.message.toLowerCase().includes(needle) ||
          l.module.toLowerCase().includes(needle) ||
          l.level.includes(needle)
      )
    }
    return list
  }
}

export const engine = new Engine()
