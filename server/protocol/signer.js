/**
 * qsign 风格签名服务客户端。
 * 只负责与用户自建的签名服务通信，不包含任何签名算法实现。
 */
export class SignerError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SignerError'
  }
}

export function normalizeSignerUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  let url
  try {
    url = new URL(value)
  } catch {
    throw new SignerError('签名服务地址不是合法 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SignerError('签名服务地址必须以 http:// 或 https:// 开头')
  }
  return url.origin + url.pathname.replace(/\/+$/, '')
}

export function createSigner({ url, uin = '', qua = '', timeoutMs = 4000, fetchImpl = fetch } = {}) {
  const base = normalizeSignerUrl(url)

  async function request(path, init) {
    if (!base) throw new SignerError('尚未配置签名服务地址')
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) throw new SignerError(`签名服务返回 HTTP ${res.status}`)
    return res
  }

  return {
    base,
    async probe() {
      const started = Date.now()
      try {
        const res = await request('/', { method: 'GET' })
        const body = await res.text()
        return { ok: true, latencyMs: Date.now() - started, detail: body.slice(0, 80) }
      } catch (err) {
        return { ok: false, latencyMs: Date.now() - started, detail: err.message }
      }
    },
    async sign({ cmd, seq, hex, buffer }) {
      if (!uin) throw new SignerError('缺少 uin')
      const res = await request('/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uin: String(uin), qua, cmd, seq, hex: hex || buffer })
      })
      const data = await res.json().catch(() => null)
      if (!data || data.code !== 0) {
        throw new SignerError(data?.msg || '签名服务拒绝了该请求')
      }
      return data
    }
  }
}
