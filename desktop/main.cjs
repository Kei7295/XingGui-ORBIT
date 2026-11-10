const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const path = require('node:path')
const net = require('node:net')
const { pathToFileURL } = require('node:url')

app.setName('XingGui ORBIT')
app.setAppUserModelId('com.xinggui.orbit')
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')

const gotLock = app.requestSingleInstanceLock()

const SPLASH_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;overflow:hidden}
  body{
    display:grid;place-items:center;
    background:#09090b;color:#fafafa;
    font-family:"Inter","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    -webkit-app-region:drag;user-select:none;
  }
  .grid{
    position:absolute;inset:0;
    background-image:linear-gradient(to right,rgba(250,250,250,.045) 1px,transparent 1px),
      linear-gradient(to bottom,rgba(250,250,250,.045) 1px,transparent 1px);
    background-size:44px 44px;
    mask-image:radial-gradient(circle at 50% 46%,#000 0%,transparent 70%);
    -webkit-mask-image:radial-gradient(circle at 50% 46%,#000 0%,transparent 70%);
  }
  .core{position:relative;display:flex;flex-direction:column;align-items:center;gap:20px;width:300px}
  .mark{position:relative;width:66px;height:66px}
  .mark svg{position:absolute;inset:0;width:100%;height:100%}
  .halo{position:absolute;inset:-16px;border-radius:50%;border:1px solid rgba(250,250,250,.1);animation:pulse 2.4s ease-in-out infinite}
  .halo.b{inset:-30px;border-color:rgba(250,250,250,.06);animation-delay:.6s}
  .name{display:flex;align-items:baseline;gap:8px;font-size:14.5px;font-weight:600;letter-spacing:.02em}
  .name em{font-style:normal;font-size:9.5px;font-weight:500;letter-spacing:.22em;color:#71717a}
  .bar{position:relative;width:100%;height:2px;border-radius:999px;background:rgba(250,250,250,.1);overflow:hidden}
  .bar i{position:absolute;inset:0 auto 0 0;width:0%;border-radius:999px;background:linear-gradient(90deg,#a1a1aa,#fafafa);transition:width .24s cubic-bezier(.4,0,.2,1)}
  .meta{display:flex;width:100%;justify-content:space-between;font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:#52525b}
  .meta b{font-weight:400;color:#a1a1aa}
  .hint{margin-top:2px;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#3f3f46}
  @keyframes pulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.06);opacity:.4}}
  @media (prefers-reduced-motion:reduce){.halo{animation:none}}
</style>
</head>
<body>
  <div class="grid"></div>
  <div class="core">
    <div class="mark">
      <span class="halo"></span><span class="halo b"></span>
      <svg viewBox="0 0 64 64" fill="none">
        <rect x="3" y="3" width="58" height="58" rx="16" stroke="#fafafa" stroke-opacity=".85"/>
        <ellipse cx="32" cy="32" rx="21" ry="10.4" transform="rotate(-32 32 32)" stroke="#fafafa" stroke-opacity=".45"/>
        <ellipse cx="32" cy="32" rx="13" ry="6.4" transform="rotate(28 32 32)" stroke="#fafafa" stroke-opacity=".22"/>
        <circle cx="47.2" cy="19.2" r="4.8" fill="#fafafa"/>
        <circle cx="32" cy="32" r="2.6" fill="#fafafa" fill-opacity=".45"/>
      </svg>
    </div>
    <div class="name">星轨 · ORBIT <em>0.0.1-BETA</em></div>
    <div class="bar"><i id="bar"></i></div>
    <div class="meta"><b id="status">正在唤醒协议内核</b><b id="pct">0%</b></div>
    <div class="hint">COLD START · LOCAL CORE</div>
  </div>
<script>
  window.setProgress = function (value, text) {
    var bar = document.getElementById('bar')
    var pct = document.getElementById('pct')
    var status = document.getElementById('status')
    if (bar) bar.style.width = value + '%'
    if (pct) pct.textContent = value + '%'
    if (text && status) status.textContent = text
  }
</script>
</body>
</html>`

if (!gotLock) {
  app.quit()
} else {
  let win = null
  let splash = null

  function freePort() {
    return new Promise((resolve, reject) => {
      const probe = net.createServer()
      probe.unref()
      probe.on('error', reject)
      probe.listen(0, '127.0.0.1', () => {
        const port = probe.address().port
        probe.close(() => resolve(port))
      })
    })
  }

  function progress(splashWin, value, text) {
    if (!splashWin || splashWin.isDestroyed()) return
    splashWin.webContents
      .executeJavaScript(`window.setProgress && window.setProgress(${value}, ${JSON.stringify(text)})`)
      .catch(() => {})
  }

  function createSplash() {
    const frame = new BrowserWindow({
      width: 400,
      height: 300,
      frame: false,
      transparent: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      center: true,
      show: true,
      backgroundColor: '#09090b',
      title: '星轨 · ORBIT',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    frame.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`)
    return frame
  }

  async function waitForServer(url, splashWin, timeoutMs = 20000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(600) })
        if (res.ok) return true
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error(`协议内核未在 ${timeoutMs / 1000}s 内就绪`)
  }

  function createWindow(url, splashWin) {
    win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1080,
      minHeight: 700,
      show: false,
      backgroundColor: '#09090b',
      title: '星轨 · ORBIT',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })

    let revealed = false
    const reveal = () => {
      if (revealed) return
      revealed = true
      win.show()
      if (splashWin && !splashWin.isDestroyed()) {
        setTimeout(() => splashWin.isDestroyed() || splashWin.close(), 120)
      }
    }

    win.once('ready-to-show', reveal)
    win.webContents.once('did-finish-load', () => setTimeout(reveal, 120))
    win.webContents.once('dom-ready', () => progress(splashWin, 88, '正在加载工作台'))

    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/i.test(target)) shell.openExternal(target)
      return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, target) => {
      if (target.startsWith(url)) return
      event.preventDefault()
      if (/^https?:/i.test(target)) shell.openExternal(target)
    })

    win.loadURL(url)
    win.on('closed', () => {
      win = null
    })
  }

  async function boot(splashWin) {
    progress(splashWin, 18, '正在检查本地端口')
    const preferred = Number(process.env.PORT || 8787)
    let port = preferred
    try {
      await new Promise((resolve, reject) => {
        const probe = net.createServer()
        probe.once('error', reject)
        probe.once('listening', () => probe.close(resolve))
        probe.listen(preferred, '127.0.0.1')
      })
    } catch {
      port = await freePort()
    }

    process.env.PORT = String(port)
    process.env.ORBIT_HOST = '127.0.0.1'
    process.env.ORBIT_DATA_DIR = path.join(app.getPath('userData'), 'data')

    progress(splashWin, 38, '正在启动协议内核')
    const startedAt = Date.now()
    await import(pathToFileURL(path.join(__dirname, '..', 'server', 'server.js')).href)

    const url = `http://127.0.0.1:${port}`
    progress(splashWin, 58, '正在等待内核响应')
    await waitForServer(`${url}/api/bootstrap`, splashWin)
    progress(splashWin, 72, `内核就绪 · ${Date.now() - startedAt}ms`)

    createWindow(url, splashWin)
  }

  app.whenReady().then(async () => {
    splash = createSplash()

    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: '文件',
          submenu: [
            {
              label: '开机自启',
              type: 'checkbox',
              checked: app.getLoginItemSettings().openAtLogin,
              click: (item) =>
                app.setLoginItemSettings({
                  openAtLogin: item.checked,
                  path: process.execPath,
                  args: []
                })
            },
            {
              label: '重新加载',
              accelerator: 'CmdOrCtrl+R',
              click: () => win && win.reload()
            },
            { type: 'separator' },
            { label: '退出', role: 'quit' }
          ]
        },
        {
          label: '帮助',
          submenu: [
            {
              label: '打开数据目录',
              click: () => shell.openPath(app.getPath('userData'))
            },
            {
              label: '项目主页',
              click: () => shell.openExternal('https://github.com/Kei7295/XingGui-ORBIT')
            }
          ]
        }
      ])
    )

    try {
      await boot(splash)
    } catch (err) {
      progress(splash, 100, '启动失败')
      dialog.showErrorBox('星轨 · ORBIT 启动失败', String(err && err.stack ? err.stack : err))
      app.quit()
    }
  })

  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.on('window-all-closed', () => app.quit())
}
