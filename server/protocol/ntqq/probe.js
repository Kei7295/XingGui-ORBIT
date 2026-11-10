import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'probe-child.js')

/**
 * 在独立子进程里载入 wrapper.node 并清点对外服务。
 * 隔离进程的原因：ABI 不匹配时 dlopen 会直接让进程崩溃，不能拖垮 API 服务。
 */
export function probeWrapper(wrapperPath, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    if (!wrapperPath) {
      resolve({ ok: false, error: '未指定 wrapper.node 路径', keys: [], services: [], elapsedMs: 0 })
      return
    }

    const startedAt = Date.now()
    const child = spawn(process.execPath, [CHILD, wrapperPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...payload, elapsedMs: Date.now() - startedAt })
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, error: `载入超时（${timeoutMs}ms）`, keys: [], services: [] })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))

    child.on('error', (err) => finish({ ok: false, error: err.message, keys: [], services: [] }))

    child.on('close', (code) => {
      const line = stdout.trim().split('\n').filter(Boolean).at(-1) || ''
      try {
        const parsed = JSON.parse(line)
        finish({
          ok: code === 0 && !parsed.error,
          exitCode: code,
          keys: parsed.keys || [],
          services: parsed.services || [],
          error: parsed.error || ''
        })
      } catch {
        finish({
          ok: false,
          exitCode: code,
          error: (stderr || stdout || '子进程无输出').trim().slice(0, 600),
          keys: [],
          services: []
        })
      }
    })
  })
}
