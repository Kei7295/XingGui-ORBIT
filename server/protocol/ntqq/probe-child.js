import process from 'node:process'

/**
 * 独立进程入口：载入 wrapper.node，输出可用的服务清单。
 * 只做 introspection，不发起任何腾讯网络请求。
 */
const wrapperPath = process.argv[2]
const result = { keys: [], services: [], error: '' }

try {
  const nativeModule = { exports: {} }
  process.dlopen(nativeModule, wrapperPath)
  const exported = nativeModule.exports || {}

  const scope = { ...globalThis, ...exported }
  result.keys = Object.keys(exported)
    .filter((key) => /^NodeI/.test(key))
    .sort()

  const names = [
    'NodeIQQNTWrapperSession',
    'NodeIKernelLoginService',
    'NodeIKernelMsgService',
    'NodeIKernelProfileService',
    'NodeIKernelGroupService',
    'NodeIKernelBuddyService',
    'NodeIKernelSessionListener',
    'NodeIKernelMsgListener',
    'NodeIKernelLoginListener'
  ]
  result.services = names
    .map((name) => ({ name, kind: typeof scope[name] }))
    .filter((item) => item.kind === 'function' || item.kind === 'object')
} catch (err) {
  result.error = err.message
  process.exitCode = 1
}

process.stdout.write(`${JSON.stringify(result)}\n`)
