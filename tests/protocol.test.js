import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createProtocolHub } from '../server/protocol/index.js'
import { createSigner, normalizeSignerUrl } from '../server/protocol/signer.js'
import { locateQQNT } from '../server/protocol/ntqq/wrapper.js'

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

