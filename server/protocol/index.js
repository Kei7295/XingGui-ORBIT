import fs from 'node:fs'
import path from 'node:path'
import { createSigner, normalizeSignerUrl, SignerError } from './signer.js'
import { locateQQNT } from './ntqq/wrapper.js'

const MODES = ['mock', 'ntqq']

/**
 * 协议层边界：决定 ORBIT 的账号与消息由谁提供。
 * mock 走内置演示内核；ntqq 为真实 QQ 适配层，当前仅有前置条件检测。
 */
export function createProtocolHub({ dataDir = process.env.ORBIT_DATA_DIR || './data' } = {}) {
  const file = path.join(dataDir, 'protocol.json')
  const config = {
    mode: process.env.ORBIT_PROTOCOL === 'ntqq' ? 'ntqq' : 'mock',
    signerUrl: '',
    uin: '',
    qua: '',
    qqPath: ''
  }

  try {
    Object.assign(config, JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    /* 首次运行没有配置文件 */
  }

  function persist() {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(config, null, 2))
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
      capabilities: {
        login: config.mode === 'mock',
        sendMessage: config.mode === 'mock',
        receiveMessage: config.mode === 'mock',
        groupManage: config.mode === 'mock'
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
    persist()
    return status()
  }

  return { config, status, update, probe: () => signer().probe() }
}
