import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createProtocolHub } from '../server/protocol/index.js'
import { createSigner, normalizeSignerUrl } from '../server/protocol/signer.js'
import { locateQQNT } from '../server/protocol/ntqq/wrapper.js'
import { probeWrapper } from '../server/protocol/ntqq/probe.js'
import { createUpstream, toWsUrl } from '../server/protocol/napcat/upstream.js'
import { WebSocketServer } from 'ws'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-protocol-'))
}

test('默认使用演示内核且具备全部能力', async () => {
  const hub = createProtocolHub({ dataDir: tempDir() })
  const status = await hub.status()
  assert.equal(status.mode, 'mock')
  assert.equal(status.capabilities.login, true)
  assert.deepEqual(status.blockers, [])
})

test('签名服务地址必须合法', async () => {
  const hub = createProtocolHub({ dataDir: tempDir() })
  await assert.rejects(() => hub.update({ signerUrl: 'ftp://x' }), /http/)
  assert.equal(normalizeSignerUrl('https://sign.example.com///'), 'https://sign.example.com')
})

test('ntqq 模式会列出缺失前置条件', async () => {
  const hub = createProtocolHub({ dataDir: tempDir() })
  const status = await hub.update({ mode: 'ntqq' })
  assert.equal(status.mode, 'ntqq')
  assert.equal(status.capabilities.login, false)
  assert.ok(status.blockers.some((b) => b.includes('签名服务')))
  assert.ok(status.blockers.some((b) => b.includes('登录交换')))
})

test('qsign 风格服务可用性探测', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('qsign ok')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`

  try {
    const hub = createProtocolHub({ dataDir: tempDir() })
    const status = await hub.update({ mode: 'ntqq', uin: '10001', signerUrl: url })
    assert.equal(status.signer.ok, true)
    assert.equal(status.blockers.some((b) => b.includes('签名服务不可用')), false)
  } finally {
    server.close()
  }
})

test('签名请求会携带 uin 与 qua', async () => {
  let received = null
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received = JSON.parse(body)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 0, token: 't', sign: 's', extra: 'e' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const signer = createSigner({
      url: `http://127.0.0.1:${server.address().port}`,
      uin: '10001',
      qua: 'V1_NT_123'
    })
    const result = await signer.sign({ cmd: 'wtlogin.login', seq: 7, hex: 'deadbeef' })
    assert.equal(result.token, 't')
    assert.deepEqual(received, {
      uin: '10001',
      qua: 'V1_NT_123',
      cmd: 'wtlogin.login',
      seq: 7,
      hex: 'deadbeef'
    })
  } finally {
    server.close()
  }
})

test('能在 versions 目录下定位 QQNT wrapper', () => {
  const root = tempDir()
  const wrapperDir = path.join(root, 'versions', '9.9.9')
  fs.mkdirSync(wrapperDir, { recursive: true })
  fs.writeFileSync(path.join(wrapperDir, 'wrapper.node'), '')

  const result = locateQQNT({ root, platform: 'win32' })
  assert.equal(result.found, true)
  assert.equal(result.version, '9.9.9')
  assert.equal(result.wrapperPath, path.join(wrapperDir, 'wrapper.node'))
})

test('缺少 wrapper.node 时给出未安装状态', () => {
  const result = locateQQNT({ root: tempDir(), platform: 'win32' })
  assert.equal(result.found, false)
  assert.equal(result.wrapperPath, '')
})

test('ntqq 状态会带出原生层诊断信息', async () => {
  const hub = createProtocolHub({ dataDir: tempDir() })
  const status = await hub.update({ mode: 'ntqq', qqPath: tempDir() })
  assert.equal(status.native.found, false)
  assert.ok(status.blockers.some((b) => b.includes('wrapper.node')))
})

test('上游地址会归一化成 ws/wss', () => {
  assert.equal(toWsUrl('http://127.0.0.1:3001'), 'ws://127.0.0.1:3001')
  assert.equal(toWsUrl('https://q.example.com/'), 'wss://q.example.com')
  assert.equal(toWsUrl('127.0.0.1:3001'), '')
})

test('未指定 wrapper 时探测安全返回', async () => {
  const result = await probeWrapper('')
  assert.equal(result.ok, false)
  assert.match(result.error, /未指定/)
})

test('载入非原生模块时给出错误而不是崩溃', async () => {
  const file = path.join(tempDir(), 'fake.node')
  fs.writeFileSync(file, 'not a native module')
  const result = await probeWrapper(file, { timeoutMs: 8000 })
  assert.equal(result.ok, false)
  assert.ok(result.error.length > 0)
})

test('能接收上游事件并按 echo 回传动作结果', async () => {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise((resolve) => wss.once('listening', resolve))
  const url = `ws://127.0.0.1:${wss.address().port}`
  const events = []

  wss.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        group_id: 123,
        user_id: 456,
        raw_message: '真实消息',
        message: [{ type: 'text', data: { text: '真实消息' } }]
      })
    )
    socket.on('message', (raw) => {
      const body = JSON.parse(String(raw))
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 99 }, echo: body.echo }))
    })
  })

  const upstream = createUpstream({ url, onEvent: (event) => events.push(event) })
  try {
    for (let i = 0; i < 100 && !upstream.online; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(upstream.online, true)
    const result = await upstream.request('send_group_msg', { group_id: 123, message: 'hi' })
    assert.equal(result.data.message_id, 99)
    assert.equal(events[0].raw_message, '真实消息')
  } finally {
    upstream.close()
    await new Promise((resolve) => wss.close(resolve))
  }
})

