import fs from 'node:fs'
import path from 'node:path'
import { createSigner, normalizeSignerUrl, SignerError } from './signer.js'
import { locateQQNT } from './ntqq/wrapper.js'
import { createUpstream, toWsUrl } from './napcat/upstream.js'

const MODES = ['mock', 'ntqq', 'napcat']

/**
 * 协议层边界：决定 ORBIT 的账号与消息由谁提供。
 * - mock：内置演示内核
 * - napcat：以 OneBot 11 客户端身份接入真实协议端（不含对方代码）
 * - ntqq：自研原生层，目前仅完成 wrapper 探测
 */
export function createProtocolHub({ dataDir = process.env.ORBIT_DATA_DIR || './data' } = {}) {
  const file = path.join(dataDir, 'protocol.json')
  const config = {
    mode: process.env.ORBIT_PROTOCOL || 'mock',
    signerUrl: '',
    uin: '',
    qua: '',
    qqPath: '',
    upstreamUrl: process.env.ORBIT_UPSTREAM_URL || '',
    upstreamToken: process.env.ORBIT_UPSTREAM_TOKEN || ''
  }
  if (!MODES.includes(config.mode)) config.mode = 'mock'

  try {
    Object.assign(config, JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    /* 首次运行没有配置文件 */
  }

  const listeners = new Set()
  let upstream = null

  function persist() {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(config, null, 2))
  }

  function syncUpstream() {
    if (upstream) {
      upstream.close()
      upstream = null
    }
    if (config.mode !== 'napcat' || !config.upstreamUrl) return
    upstream = createUpstream({
      url: config.upstreamUrl,
      token: config.upstreamToken,
      onEvent: (event) => {
        for (const listener of listeners) listener(event)
      }
    })
  }

  function signer() {
    return createSigner({ url: config.signerUrl, uin: config.uin, qua: config.qua })
  }

  async function status() {
    const blockers = []
    let signerState = { configured: Boolean(config.signerUrl), ok: false, latencyMs: 0, detail: '' }
    const native = locateQQNT({ root: config.qqPath || process.env.ORBIT_QQ_PATH || '' })

    if (config.mode === 'ntqq') {
      if (!config.uin) blockers.push('缺少 QQ 号')
      if (!native.found) {
        blockers.push('未找到 QQNT 安装或 wrapper.node：请在设置中指定 QQ 安装目录')
      }
      if (!config.signerUrl) {
        blockers.push('缺少签名服务地址')
      } else {
        const probe = await signer().probe()
        signerState = { configured: true, ok: probe.ok, latencyMs: probe.latencyMs, detail: probe.detail }
        if (!probe.ok) blockers.push('签名服务不可用')
      }
      blockers.push('登录交换尚未实现：需要真实账号的登录抓包与可用签名服务才能完成并验证')
    }

    if (config.mode === 'napcat') {
      if (!config.upstreamUrl) blockers.push('缺少上游地址（例如 ws://127.0.0.1:3001）')
      if (upstream && !upstream.online) blockers.push('上游尚未连接')
    }

    const upstreamState = upstream
      ? { ...upstream.state }
      : { status: 'idle', url: toWsUrl(config.upstreamUrl), connectedAt: 0, reconnects: 0, lastError: '' }

    const bridged = config.mode === 'napcat' && Boolean(upstream?.online)

    return {
      mode: config.mode,
      modes: MODES,
      uin: config.uin,
      qua: config.qua,
      signer: { ...signerState, url: config.signerUrl },
      native: {
        found: native.found,
        root: native.root,
        version: native.version,
        wrapperPath: native.wrapperPath
      },
      upstream: { ...upstreamState, tokenConfigured: Boolean(config.upstreamToken) },
      capabilities: {
        login: config.mode === 'mock' || bridged,
        sendMessage: config.mode === 'mock' || bridged,
        receiveMessage: config.mode === 'mock' || bridged,
        groupManage: config.mode === 'mock' || bridged
      },
      blockers
    }
  }

  async function update(patch = {}) {
    if (patch.mode !== undefined) {
      if (!MODES.includes(patch.mode)) throw new SignerError(`不支持的协议模式：${patch.mode}`)
      config.mode = patch.mode
    }
    if (patch.signerUrl !== undefined) config.signerUrl = normalizeSignerUrl(patch.signerUrl)
    if (patch.uin !== undefined) config.uin = String(patch.uin || '').replace(/\D/g, '')
    if (patch.qua !== undefined) config.qua = String(patch.qua || '').trim()
    if (patch.qqPath !== undefined) config.qqPath = String(patch.qqPath || '').trim()
    if (patch.upstreamUrl !== undefined) {
      const value = String(patch.upstreamUrl || '').trim()
      if (value && !toWsUrl(value)) throw new SignerError('上游地址必须是 ws:// 或 http:// 开头')
      config.upstreamUrl = value
    }
    if (patch.upstreamToken !== undefined) config.upstreamToken = String(patch.upstreamToken || '')
    persist()
    syncUpstream()
    return status()
  }

  function onUpstreamEvent(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function request(action, params) {
    if (!upstream) return Promise.reject(new Error('尚未配置上游协议端'))
    return upstream.request(action, params)
  }

  syncUpstream()

  return {
    config,
    status,
    update,
    probe: () => signer().probe(),
    onUpstreamEvent,
    request,
    get mode() {
      return config.mode
    },
    get bridged() {
      return config.mode === 'napcat' && Boolean(upstream?.online)
    }
  }
}
