const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const path = require('node:path')
const net = require('node:net')
const { pathToFileURL } = require('node:url')

app.setName('XingGui ORBIT')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let win = null

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

  async function waitForServer(url, timeoutMs = 20000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(url)
        if (res.ok) return true
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error(`协议内核未在 ${timeoutMs / 1000}s 内就绪`)
  }

  function createWindow(url) {
    win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1080,
      minHeight: 700,
      show: false,
      backgroundColor: '#0b0d12',
      title: '星轨 · ORBIT',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    win.once('ready-to-show', () => win.show())

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

  async function boot() {
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

    await import(pathToFileURL(path.join(__dirname, '..', 'server', 'server.js')).href)
    const url = `http://127.0.0.1:${port}`
    await waitForServer(`${url}/api/bootstrap`)
    createWindow(url)
  }

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: '文件',
          submenu: [
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
      await boot()
    } catch (err) {
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
