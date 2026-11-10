import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * QQNT 原生 wrapper 定位。
 * 设计参考 NapCat：真实 QQ 的收发能力来自 QQ 自带的 wrapper.node，
 * 通过 process.dlopen 载入后由 NodeIKernel* 服务提供，而不是自己实现加密协议。
 */
const COMMON_ROOTS = {
  win32: [
    'C:\\Program Files\\Tencent\\QQNT',
    'C:\\Program Files\\Tencent\\QQ',
    'C:\\Program Files (x86)\\Tencent\\QQNT',
    path.join(process.env.LOCALAPPDATA || '', 'Tencent', 'QQNT')
  ],
  darwin: ['/Applications/QQ.app'],
  linux: ['/opt/QQ', '/usr/share/QQ', path.join(os.homedir(), 'QQ')]
}

function locateWrapperIn(root) {
  const direct = [
    path.join(root, 'wrapper.node'),
    path.join(root, 'resources', 'app', 'wrapper.node')
  ]
  for (const candidate of direct) {
    if (fs.existsSync(candidate)) return { wrapperPath: candidate, version: '' }
  }

  const versionsDir = path.join(root, 'versions')
  if (!fs.existsSync(versionsDir)) return null

  const versions = fs
    .readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

  for (const version of versions) {
    for (const candidate of [
      path.join(versionsDir, version, 'wrapper.node'),
      path.join(versionsDir, version, 'resources', 'app', 'wrapper.node')
    ]) {
      if (fs.existsSync(candidate)) return { wrapperPath: candidate, version }
    }
  }
  return null
}

export function locateQQNT({ root, platform = process.platform } = {}) {
  const roots = root ? [root] : (COMMON_ROOTS[platform] || []).filter(Boolean)
  for (const candidate of roots) {
    if (!candidate || !fs.existsSync(candidate)) continue
    const found = locateWrapperIn(candidate)
    if (found) {
      return {
        found: true,
        root: candidate,
        wrapperPath: found.wrapperPath,
        version: found.version,
        platform
      }
    }
  }
  return { found: false, root: root || '', wrapperPath: '', version: '', platform, searched: roots }
}

export function loadWrapper(wrapperPath) {
  const nativeModule = { exports: {} }
  process.dlopen(nativeModule, wrapperPath)
  return nativeModule.exports
}
