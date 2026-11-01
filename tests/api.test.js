import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 8899
const BASE = `http://127.0.0.1:${PORT}`
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-api-'))
const CONSOLE_TOKEN = 'test-console-token'
const BOT_TOKEN = 'test-bot-token'

const child = spawn(process.execPath, ['server/server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    ORBIT_DATA_DIR: DATA_DIR,
    ORBIT_CONSOLE_TOKEN: CONSOLE_TOKEN,
    ORBIT_ACCESS_TOKEN: BOT_TOKEN
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk
})

async function waitForServer() {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/bootstrap`)
      if (res.ok) return
    } catch {
      /* server not ready yet */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`server did not start: ${stderr}`)
}

after(() => {
  child.kill('SIGTERM')
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
})

await waitForServer()

test('bootstrap 返回版本与写操作令牌', async () => {
  const res = await fetch(`${BASE}/api/bootstrap`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.version, '0.0.1-beta')
  assert.equal(data.consoleToken, CONSOLE_TOKEN)
  assert.equal(data.account.status, 'online')
})

test('控制台写操作必须携带令牌', async () => {
  const denied = await fetch(`${BASE}/api/risk/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ safeMode: true })
  })
  assert.equal(denied.status, 403)

  const allowed = await fetch(`${BASE}/api/risk/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orbit-Token': CONSOLE_TOKEN },
    body: JSON.stringify({ safeMode: true })
  })
  assert.equal(allowed.status, 200)
  assert.equal((await allowed.json()).safeMode, true)

  await fetch(`${BASE}/api/risk/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orbit-Token': CONSOLE_TOKEN },
    body: JSON.stringify({ safeMode: false })
  })
})

test('OneBot HTTP 鉴权与版本动作', async () => {
  const denied = await fetch(`${BASE}/onebot?action=get_login_info`, { method: 'POST' })
  assert.equal(denied.status, 401)
  assert.equal((await denied.json()).retcode, 1403)

  const res = await fetch(`${BASE}/onebot?access_token=${BOT_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get_version_info', echo: 'http-1' })
  })
  const payload = await res.json()
  assert.equal(payload.retcode, 0)
  assert.equal(payload.data.app_version, '0.0.1-beta')
  assert.equal(payload.echo, 'http-1')
})

test('网络配置接口校验与写保护', async () => {
  const denied = await fetch(`${BASE}/api/onebot/network`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reverseWs: { enabled: true } })
  })
  assert.equal(denied.status, 403)

  const current = await (await fetch(`${BASE}/api/onebot/network`)).json()
  assert.equal(current.reverseWs.status, 'idle')
  assert.equal(current.httpReport.enabled, false)

  const invalid = await fetch(`${BASE}/api/onebot/network`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orbit-Token': CONSOLE_TOKEN },
    body: JSON.stringify({ reverseWs: { url: 'http://example.com/ws' } })
  })
  assert.equal(invalid.status, 400)

  const ok = await fetch(`${BASE}/api/onebot/network`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orbit-Token': CONSOLE_TOKEN },
    body: JSON.stringify({
      reverseWs: { enabled: false, url: 'ws://127.0.0.1:8099/onebot', reconnectMs: 1500 },
      httpReport: { enabled: false, url: 'http://127.0.0.1:8098/event', secret: 'report-secret' }
    })
  })
  assert.equal(ok.status, 200)
  const data = await ok.json()
  assert.equal(data.reverseWs.url, 'ws://127.0.0.1:8099/onebot')
  assert.equal(data.reverseWs.reconnectMs, 1500)
  assert.equal(data.httpReport.hasSecret, true)
  assert.equal(data.httpReport.secret, '••••••')
})

test('OneBot WebSocket 调用与事件推送', async () => {
  const result = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/onebot/ws?access_token=${BOT_TOKEN}`)
    const state = { lifecycle: false, reply: null, event: null }
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`ws timeout · ${JSON.stringify(state)}`))
    }, 5000)

    ws.on('message', (raw) => {
      const frame = JSON.parse(String(raw))
      if (frame.post_type === 'meta_event') {
        state.lifecycle = true
        ws.send(JSON.stringify({ action: 'get_login_info', echo: 'ws-1' }))
        return
      }
      if (frame.echo === 'ws-1' && frame.status === 'ok') {
        state.reply = frame
        ws.send(
          JSON.stringify({
            action: 'send_private_msg',
            params: { user_id: 10002, message: 'ws 事件测试' },
            echo: 'ws-2'
          })
        )
        return
      }
      if (frame.echo === 'ws-2') {
        state.reply2 = frame
      }
      if (frame.post_type === 'message_sent') {
        state.event = frame
      }
      if (state.reply && state.reply2 && state.event) {
        clearTimeout(timer)
        ws.close()
        resolve(state)
      }
    })
    ws.on('error', reject)
  })

  assert.equal(result.lifecycle, true)
  assert.equal(result.reply.data.user_id, 2846721930)
  assert.equal(result.reply2.retcode, 0)
  assert.equal(result.event.post_type, 'message_sent')
  assert.equal(result.event.message, 'ws 事件测试')
})
