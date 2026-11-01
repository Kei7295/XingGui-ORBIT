import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = path.join(root, 'release')
const stageDir = path.join(releaseDir, 'stage')
const appName = 'XingGui-ORBIT'
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')
).version
const isWin = process.platform === 'win32'
const npmCmd = isWin ? 'npm.cmd' : 'npm'
const packagerCmd = path.join(
  root,
  'node_modules',
  '.bin',
  isWin ? 'electron-packager.cmd' : 'electron-packager'
)

function run(cmd, args, cwd = root, env = process.env) {
  console.log(`\n▸ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env, shell: isWin })
}

run(npmCmd, ['run', 'build'])

fs.rmSync(stageDir, { recursive: true, force: true })
fs.mkdirSync(stageDir, { recursive: true })

for (const entry of ['dist', 'server', 'desktop']) {
  fs.cpSync(path.join(root, entry), path.join(stageDir, entry), { recursive: true })
}
for (const file of ['LICENSE', 'README.md']) {
  fs.copyFileSync(path.join(root, file), path.join(stageDir, file))
}

fs.writeFileSync(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'xinggui-orbit-desktop',
      productName: '星轨 ORBIT',
      version,
      description: '星轨 · ORBIT 桌面版',
      author: 'ORBIT',
      main: 'desktop/main.cjs',
      license: 'AGPL-3.0-only',
      private: true,
      dependencies: { qrcode: '^1.5.4', ws: '^8.22.1' }
    },
    null,
    2
  )}\n`
)

run(npmCmd, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stageDir)

run(packagerCmd, [
  stageDir,
  appName,
  '--platform=win32',
  '--arch=x64',
  '--out=' + releaseDir,
  '--overwrite',
  '--asar=false',
  '--app-version=' + version.replace('-beta', '.0'),
  '--electron-version=' + electronVersion,
  '--ignore=node_modules/.package-lock.json',
  '--quiet'
])

const outDir = path.join(releaseDir, `${appName}-win32-x64`)
const zipName = `${appName}-${version}-win32-x64.zip`
const zipPath = path.join(releaseDir, zipName)
fs.rmSync(zipPath, { force: true })
if (process.platform === 'win32') {
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${path.basename(outDir)}' -DestinationPath '${zipName}' -Force`
  ], releaseDir)
} else {
  run('zip', ['-qr', zipPath, path.basename(outDir), '-x', '*/resources/app/data/*'], releaseDir)
}

const size = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)
console.log(`\n✔ Windows 桌面版已生成：release/${zipName}（${size} MB）`)
