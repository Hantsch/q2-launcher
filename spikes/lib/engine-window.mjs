// Electron main frame shared by the engine spikes (ESM main, run through the spike's main.mjs):
// serves the spike's page, the engine and a fixed list of data files over q2spike://app/ under the
// launcher's production CSP and opens the hidden, offscreen window. The spike keeps its own report
// handling, results and exit decision. Environment comes from spikes/lib/engine-launch.mjs.

import { app, BrowserWindow, ipcMain, protocol, screen } from 'electron'
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))

// Copied by value from PRODUCTION_CSP in src/main/lib/renderer-source.ts; a spike may not import
// src/. The only change under test is 'wasm-unsafe-eval' in script-src.
const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

// Same privileges as the launcher's own scheme (src/main/index.ts); must run before `ready`.
protocol.registerSchemesAsPrivileged([
  { scheme: 'q2spike', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const html = 'text/html; charset=utf-8'
const js = 'text/javascript; charset=utf-8'

export const env = {
  engineDir: process.env.Q2L_SPIKE_ENGINE_DIR,
  paks: JSON.parse(process.env.Q2L_SPIKE_PAKS ?? '[]'),
  demo: process.env.Q2L_SPIKE_DEMO,
}

/**
 * Starts the window. Options:
 * - spikeDir: directory holding app/index.html and app/boot.js
 * - hardTimeoutMs, onHardTimeout(): fires once if the spike has not exited by then
 * - onReport(msg): messages the page sends through window.spike.report
 * - onGone(reason): the renderer process died
 * - switches: [name, value?][] Chromium command-line switches (e.g. autoplay-policy)
 * - wasmCsp (default true): add 'wasm-unsafe-eval' to script-src
 * - headers: extra response headers on every scheme response (COOP/COEP)
 * - extraFiles: { '/path': { path, type } } servable beside the fixed table (e.g. worklet.js)
 * - jsonRoutes: { '/path': string } served as application/json (config)
 * - manifestExtra: object merged into data/manifest.json
 * - window: { width, height, focusable, focus }
 * - onReady(win): called once the window exists
 * Returns { dataFiles, getWindow(), exit(code) }.
 */
export function startEngineWindow(options) {
  const {
    spikeDir,
    hardTimeoutMs,
    onHardTimeout,
    onReport,
    onGone,
    switches = [],
    wasmCsp = true,
    headers: extraHeaders = {},
    extraFiles = {},
    jsonRoutes = {},
    manifestExtra = {},
    window: windowOptions = {},
  } = options
  if (!env.engineDir || !env.demo || env.paks.length === 0) {
    console.error('main.mjs: start it through the spike harness')
    process.exit(2)
  }
  for (const [name, value] of switches) app.commandLine.appendSwitch(name, value)

  const csp = wasmCsp
    ? PRODUCTION_CSP.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'")
    : PRODUCTION_CSP

  // Every servable file is fixed here; the renderer only ever names a key or an index, never a path.
  const appFiles = {
    '/': { path: join(spikeDir, 'app', 'index.html'), type: html },
    '/index.html': { path: join(spikeDir, 'app', 'index.html'), type: html },
    '/boot.js': { path: join(spikeDir, 'app', 'boot.js'), type: js },
    '/lib/page.js': { path: join(LIB_DIR, 'page.js'), type: js },
    '/engine/q2pro.js': { path: join(env.engineDir, 'q2pro.js'), type: js },
    '/engine/q2pro.wasm': { path: join(env.engineDir, 'q2pro.wasm'), type: 'application/wasm' },
    ...extraFiles,
  }

  // The demo goes to baseq2/demos/ because that is where `demo <name>` looks it up.
  const dataFiles = [
    ...env.paks.map((path) => ({ path, vpath: `baseq2/${basename(path).toLowerCase()}` })),
    { path: env.demo, vpath: `baseq2/demos/${basename(env.demo)}` },
  ].map((file, index) => ({ ...file, index, size: statSync(file.path).size }))
  const manifest = JSON.stringify({
    files: dataFiles.map(({ index, vpath, size }) => ({ index, vpath, size })),
    ...manifestExtra,
  })

  const respond = (body, status, type) => {
    const headers = { 'Content-Security-Policy': csp, ...extraHeaders }
    if (type) headers['Content-Type'] = type
    return new Response(body, { status, headers })
  }

  async function handle(request) {
    const url = new URL(request.url)
    if (url.host !== 'app') return respond(null, 404)
    const fixed = Object.hasOwn(appFiles, url.pathname) ? appFiles[url.pathname] : null
    if (fixed) return respond(await readFile(fixed.path), 200, fixed.type)
    if (url.pathname === '/data/manifest.json') return respond(manifest, 200, 'application/json')
    if (Object.hasOwn(jsonRoutes, url.pathname))
      return respond(jsonRoutes[url.pathname], 200, 'application/json')
    const match = /^\/data\/(\d+)$/.exec(url.pathname)
    const file = match ? dataFiles[Number(match[1])] : undefined
    if (!file) return respond(null, 404)
    return respond(await readFile(file.path), 200, 'application/octet-stream')
  }

  let win = null
  const exit = (code) => {
    // Can run inside an IPC dispatch, where app.exit() stalls; leave the handler first and fall
    // back to a hard process exit so the app always quits.
    setImmediate(() => app.exit(code))
    setTimeout(() => process.exit(code), 3000).unref()
  }

  setTimeout(() => onHardTimeout(), hardTimeoutMs)

  void app.whenReady().then(() => {
    protocol.handle('q2spike', (request) =>
      handle(request).catch((error) => {
        console.error(`q2spike handler: ${error.message}`)
        return respond(null, 500)
      }),
    )
    ipcMain.on('spike:report', (event, msg) => {
      if (!win || event.sender !== win.webContents || !msg || typeof msg !== 'object') return
      onReport(msg)
    })

    // Copied by value from rendererWebPreferences in src/main/window-shared.ts (offscreen
    // variant); a spike may not import src/.
    const webPreferences = {
      preload: join(LIB_DIR, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    }
    const { width = 1024, height = 768, focusable = true, focus = false } = windowOptions
    // Left of every display, as scripts/lib/harness.mjs places the offscreen UI harness window.
    const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x))
    win = new BrowserWindow({
      x: left - width - 100,
      y: 0,
      width,
      height,
      useContentSize: true,
      show: false,
      ...(focusable ? {} : { focusable: false }),
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      webPreferences,
    })
    win.setPosition(left - width - 100, 0)
    if (focus) win.webContents.setBackgroundThrottling(false)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('q2spike://app/')) event.preventDefault()
    })
    win.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error')
        console.error(`[renderer ${event.level}] ${event.message}`)
    })
    win.webContents.on('render-process-gone', (_e, details) => onGone(details.reason))
    win.once('ready-to-show', () => {
      if (!focus) {
        win.showInactive()
        return
      }
      // The engine only treats itself as active while the window has focus.
      win.show()
      win.focus()
      win.webContents.focus()
    })
    void win.loadURL('q2spike://app/index.html')
    options.onReady?.(win)
  })

  return { dataFiles, getWindow: () => win, exit }
}
