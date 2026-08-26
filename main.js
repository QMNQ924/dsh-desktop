'use strict'

/**
 * DeepSeek Harness Desktop — Electron 外壳
 *
 * 原则：不重写任何功能。桌面端 = 原生窗口 + 进程托管，界面直接加载
 * 现有的 dsh web GUI（与浏览器访问的是同一个应用），因此功能 100% 等价。
 *
 * 主进程职责：
 *   1. 若目标地址已有 dsh web 在运行 → 直接挂接；
 *   2. 否则定位 dsh CLI（DSH_CLI 环境变量 或 npx 缓存），后台隐藏启动
 *      `dsh web --no-open`，等待就绪；
 *   3. 打开原生窗口加载 GUI；退出时只清理自己启动的服务器进程。
 */

const { app, BrowserWindow, dialog, shell, session, ipcMain } = require('electron')
const { spawn, execFile } = require('child_process')
const http = require('http')
const https = require('https')
const path = require('path')
const fs = require('fs')

// ---------------------------------------------------------------- config

const APP_NAME = 'DeepSeek Harness'
const DEFAULT_URL = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080'
const BOOT_TIMEOUT_MS = 90000

// 日志必须写入可写目录：开发时在项目目录旁，打包后 __dirname 位于只读的 app.asar 内，
// 统一改到系统用户数据目录 %APPDATA%\<app>\logs。
const USER_DATA = app.getPath('userData')
const LOG_DIR = path.join(USER_DATA, 'logs')
try { fs.mkdirSync(LOG_DIR, { recursive: true }) } catch { /* ignore */ }
const APP_LOG = path.join(LOG_DIR, 'app.log')
const OUT_LOG = path.join(LOG_DIR, 'server.out.log')
const ERR_LOG = path.join(LOG_DIR, 'server.err.log')

const SMOKE_TEST = process.argv.includes('--smoke-test')

let targetUrl = DEFAULT_URL
let mainWindow = null
let serverProc = null // 我们启动的 dsh web 进程（若有）
let weStartedServer = false

// ---------------------------------------------------------------- helpers

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try { fs.appendFileSync(APP_LOG, line + '\n') } catch { /* ignore */ }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function showError(msg) {
  log('ERROR: ' + msg)
  dialog.showErrorBox(APP_NAME, msg)
}

function readLogTail(file, lines = 25) {
  try {
    const all = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    return all.slice(-lines).join('\n')
  } catch { return '(无日志)' }
}

function getNodeExe() {
  for (const p of [
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'nodejs', 'node.exe'),
  ]) {
    if (p && fs.existsSync(p)) return p
  }
  return 'node'
}

/** 与 launcher 一致的 CLI 定位：DSH_CLI 环境变量优先，其次最新 npx 缓存。 */
function resolveDshCli() {
  if (process.env.DSH_CLI) {
    try {
      const p = path.resolve(process.env.DSH_CLI)
      if (fs.existsSync(p)) return { binJs: p, source: 'DSH_CLI env' }
    } catch { /* fall through */ }
  }
  const npxRoot = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
  let best = null
  try {
    for (const entry of fs.readdirSync(npxRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const cand = path.join(npxRoot, entry.name, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      if (!fs.existsSync(cand)) continue
      const mtime = fs.statSync(path.join(npxRoot, entry.name)).mtimeMs
      if (!best || mtime > best.mtime) best = { binJs: cand, source: 'npx cache', mtime }
    }
  } catch { /* ignore */ }
  return best ? { binJs: best.binJs, source: best.source } : null
}

/** 检查目标地址是否已是 DeepSeek Harness（与 launcher 相同的判定）。 */
function isServerUp(target) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(target) } catch { return resolve(false) }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.get(
      { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: '/', timeout: 4000 },
      (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => {
          const ok = res.statusCode === 200 && /<title>\s*DeepSeek Harness/i.test(body)
          resolve(ok)
        })
      },
    )
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

/** 后台隐藏启动 dsh web，日志落盘（与 launcher 行为一致）。 */
function startDshWeb(cli) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl)
    const args = [cli.binJs, 'web', '--no-open']
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    if (port !== '80' && port !== '443') args.push('--port', port)
    const env = { ...process.env }
    if (!env.DSH_HOME) env.DSH_HOME = path.join(process.env.USERPROFILE || '', '.dsh')
    log(`Starting dsh web (${cli.source}): ${cli.binJs} args=${JSON.stringify(args)} DSH_HOME=${env.DSH_HOME}`)
    let out = -1, err = -1
    try {
      out = fs.openSync(OUT_LOG, 'a')
      err = fs.openSync(ERR_LOG, 'a')
    } catch (e) { return reject(e) }
    const child = spawn(getNodeExe(), args, {
      cwd: LOG_DIR,
      env,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, err],
    })
    child.on('error', (e) => { try { fs.closeSync(out); fs.closeSync(err) } catch { /* ignore */ } reject(e) })
    child.on('spawn', () => {
      log(`dsh web spawned pid=${child.pid}`)
      resolve(child)
    })
  })
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isServerUp(targetUrl)) return true
    if (serverProc && serverProc.exitCode !== null) return false
    await sleep(1200)
  }
  return false
}

/** Windows 下结束整棵进程树。 */
function killTree(pid) {
  if (!pid) return
  log(`Killing server process tree pid=${pid}`)
  try {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } catch (e) { log('taskkill failed: ' + e.message) }
}

function isExternal(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true
    return u.origin !== new URL(targetUrl).origin
  } catch { return true }
}

// ---------------------------------------------------------------- window

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    icon: path.join(__dirname, 'dsh.ico'),
    autoHideMenuBar: true,
    // 液态玻璃（Windows 11 原生亚克力）：窗口背景使用系统亚克力材质，
    // 页面透明区域会透出被模糊的桌面。仅 Win11 生效，其他系统自动忽略。
    // 注：最大化时 Windows 会按系统行为降级为实色背景。
    backgroundMaterial: 'acrylic',
    // 隐藏原生标题栏：让页面顶部直接成为玻璃标题栏（液态玻璃一体感）。
    // 不使用原生覆盖式窗口按钮（titleBarOverlay），改由页面注入 macOS 红绿灯
    // 风格的自定义按钮（window-controls.js + preload.js），避免与页面 UI 重叠。
    titleBarStyle: 'hidden',
    // 预渲染背景设为全透明，避免遮挡亚克力；加载页(loading.html)自带深色底。
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // 最大化状态变化 → 通知页面（红绿灯按钮切换 最大化/还原 图标）
  mainWindow.on('maximize', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('dsh:window-maximized-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('dsh:window-maximized-changed', false)
  })

  // 页面加载完成后注入 macOS 红绿灯窗口按钮（幂等，脚本内部会去重）
  mainWindow.webContents.on('did-finish-load', () => {
    const scriptPath = path.join(__dirname, 'window-controls.js')
    fs.readFile(scriptPath, 'utf8', (err, code) => {
      if (err) { log('window-controls read failed: ' + err.message); return }
      mainWindow.webContents.executeJavaScript(code).catch((e) => log('window-controls inject failed: ' + e.message))
    })
  })

  // 外部链接/弹窗 → 系统浏览器，绝不拦截 GUI 内部逻辑
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (isExternal(url)) { e.preventDefault(); shell.openExternal(url) }
  })

  // 下载保持与浏览器一致：询问保存位置
  session.defaultSession.on('will-download', (e, item) => {
    const win = mainWindow
    if (!win) { item.cancel(); return }
    dialog.showSaveDialog(win, { defaultPath: item.getFilename() }).then((r) => {
      if (r.canceled || !r.filePath) { item.cancel(); return }
      item.setSavePath(r.filePath)
    }).catch(() => item.cancel())
  })

  mainWindow.on('closed', () => { mainWindow = null })

  return mainWindow
}

// ---------------------------------------------------------------- window controls (IPC)

/** 自定义窗口控制：页面注入的红绿灯按钮通过 preload 暴露的 API 调到这里。 */
ipcMain.on('dsh:window-minimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize() })
ipcMain.on('dsh:window-maximize-toggle', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('dsh:window-close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close() })
ipcMain.handle('dsh:window-is-maximized', () => (mainWindow && !mainWindow.isDestroyed()) ? mainWindow.isMaximized() : false)

function loadTarget() {
  log(`Loading GUI at ${targetUrl}`)
  mainWindow.loadURL(targetUrl)
  armSmokeTest()
}

// ---------------------------------------------------------------- smoke test

function armSmokeTest() {
  if (!SMOKE_TEST) return
  let done = false
  const finish = (ok, extra) => {
    if (done) return
    done = true
    console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL' + (extra ? ' ' + extra : ''))
    app.exit(ok ? 0 : 1)
  }
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const info = await mainWindow.webContents.executeJavaScript(
          `({ title: document.title, boot: typeof window.__DSH_BOOT__, bodyLen: document.body ? document.body.innerHTML.length : 0 })`,
        )
        const ok = /DeepSeek Harness/i.test(info.title) && info.boot === 'object' && info.bodyLen > 0
        finish(ok, JSON.stringify(info))
      } catch (e) {
        finish(false, 'eval error: ' + e.message)
      }
    }, 2500)
  })
  setTimeout(() => finish(false, 'smoke timeout 60s'), 60000)
}

// ---------------------------------------------------------------- bootstrap

async function bootstrap() {
  log(`=== ${APP_NAME} Desktop shell ===`)
  log(`Target: ${targetUrl}`)

  if (await isServerUp(targetUrl)) {
    log('Server already running; attaching to it.')
    createWindow()
    loadTarget()
    return
  }

  // 需要自启服务器：先展示加载页，避免白屏
  const win = createWindow()
  win.loadFile(path.join(__dirname, 'loading.html'))

  const cli = resolveDshCli()
  if (!cli) {
    showError(
      '找不到 DeepSeek Harness 命令行工具（dsh）。\n' +
      '请重新安装，或设置环境变量 DSH_CLI 指向 @deepseek-ai/dsh 的 lib/bin.js。\n\n' +
      `日志：${APP_LOG}`,
    )
    app.exit(1)
    return
  }

  try {
    serverProc = await startDshWeb(cli)
    weStartedServer = true
  } catch (e) {
    showError(`无法启动 DSH 服务器进程：\n${e.message}`)
    app.exit(1)
    return
  }

  const ok = await waitForServer(BOOT_TIMEOUT_MS)
  if (!ok) {
    showError(
      'DeepSeek Harness 服务器未能启动。\n\n' +
      `日志尾部：\n${readLogTail(ERR_LOG)}\n\n` +
      `完整日志：${APP_LOG}`,
    )
    app.exit(1)
    return
  }
  log('Server is up.')
  loadTarget()
}

// ---------------------------------------------------------------- lifecycle

app.setAppUserModelId('com.dsh.desktop')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(bootstrap)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && app.isReady()) {
      createWindow()
      loadTarget()
    }
  })

  app.on('window-all-closed', () => app.quit())

  app.on('quit', () => {
    if (weStartedServer && serverProc && serverProc.pid) killTree(serverProc.pid)
  })
}
