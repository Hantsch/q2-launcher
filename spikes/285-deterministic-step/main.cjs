// Spike Electron main: serves app/, the engine and a fixed list of data files over q2spike://app/
// under the launcher's production CSP, lets the page run the stepped engine, then writes hashes and
// PNG frames to results/. Always quits.

const { app, BrowserWindow, ipcMain, nativeImage, protocol, screen } = require('electron')
const { mkdirSync, statSync, writeFileSync } = require('node:fs')
const { readFile } = require('node:fs/promises')
const { basename, join } = require('node:path')

const SPIKE_DIR = __dirname
const RESULTS_DIR = join(SPIKE_DIR, 'results')
const ENGINE_DIR = process.env.Q2L_SPIKE_ENGINE_DIR
const PAKS = JSON.parse(process.env.Q2L_SPIKE_PAKS ?? '[]')
const DEMO = process.env.Q2L_SPIKE_DEMO
const RENDERER = process.env.Q2L_SPIKE_RENDERER ?? 'swiftshader'
const SEED = process.env.Q2L_SPIKE_SEED === '' ? null : Number(process.env.Q2L_SPIKE_SEED)
const RUNS = Number(process.env.Q2L_SPIKE_RUNS ?? '2')
const FPS = Number(process.env.Q2L_SPIKE_FPS ?? '30')
const STEPS = Number(process.env.Q2L_SPIKE_STEPS ?? '300')
const HARD_TIMEOUT_MS = 540_000

if (!ENGINE_DIR || !DEMO || PAKS.length === 0) {
  console.error('main.cjs: start it through harness.mjs')
  process.exit(2)
}

if (RENDERER === 'swiftshader') {
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('enable-unsafe-swiftshader')
}

// Copied by value from PRODUCTION_CSP in src/main/lib/renderer-source.ts; a spike may not import
// src/. The only change is 'wasm-unsafe-eval' in script-src.
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

// Same privileges as the launcher's own scheme (src/main/index.ts); must run before `ready`.
protocol.registerSchemesAsPrivileged([
  { scheme: 'q2spike', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

const html = 'text/html; charset=utf-8'
const js = 'text/javascript; charset=utf-8'
// Every servable file is fixed here; the renderer only ever names a key or an index, never a path.
const APP_FILES = {
  '/': { path: join(SPIKE_DIR, 'app', 'index.html'), type: html },
  '/index.html': { path: join(SPIKE_DIR, 'app', 'index.html'), type: html },
  '/boot.js': { path: join(SPIKE_DIR, 'app', 'boot.js'), type: js },
  '/engine/q2pro.js': { path: join(ENGINE_DIR, 'q2pro.js'), type: js },
  '/engine/q2pro.wasm': { path: join(ENGINE_DIR, 'q2pro.wasm'), type: 'application/wasm' },
}

// The demo goes to baseq2/demos/ because that is where `demo <name>` looks it up.
const DATA_FILES = [
  ...PAKS.map((path) => ({ path, vpath: `baseq2/${basename(path).toLowerCase()}` })),
  { path: DEMO, vpath: `baseq2/demos/${basename(DEMO)}` },
].map((file, index) => ({ ...file, index, size: statSync(file.path).size }))
const MANIFEST = JSON.stringify({
  files: DATA_FILES.map(({ index, vpath, size }) => ({ index, vpath, size })),
})
const CONFIG = JSON.stringify({ runs: RUNS, seed: SEED, fps: FPS, steps: STEPS })

function respond(body, status, type) {
  const headers = { 'Content-Security-Policy': CSP }
  if (type) headers['Content-Type'] = type
  return new Response(body, { status, headers })
}

async function handle(request) {
  const url = new URL(request.url)
  if (url.host !== 'app') return respond(null, 404)
  const fixed = Object.hasOwn(APP_FILES, url.pathname) ? APP_FILES[url.pathname] : null
  if (fixed) return respond(await readFile(fixed.path), 200, fixed.type)
  if (url.pathname === '/data/manifest.json') return respond(MANIFEST, 200, 'application/json')
  if (url.pathname === '/config.json') return respond(CONFIG, 200, 'application/json')
  const match = /^\/data\/(\d+)$/.exec(url.pathname)
  const file = match ? DATA_FILES[Number(match[1])] : undefined
  if (!file) return respond(null, 404)
  return respond(await readFile(file.path), 200, 'application/octet-stream')
}

let win = null
let finished = false
const failures = []

function compare(runs) {
  const lists = runs.map((run) => run.hashes)
  const base = lists[0]
  const identical = lists.every(
    (list) => list.length === base.length && list.every((h, i) => h.sha256 === base[i].sha256),
  )
  let firstDifferentFrame = null
  if (!identical) {
    const length = Math.max(...lists.map((list) => list.length))
    for (let i = 0; i < length && firstDifferentFrame === null; i++)
      if (new Set(lists.map((list) => list[i]?.sha256)).size > 1)
        firstDifferentFrame = lists.find((list) => list[i])[i].frame
  }
  return { identical, firstDifferentFrame }
}

function writeResults(runs, identical, firstDifferentFrame) {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const suffix = `${SEED === null ? '-noseed' : ''}${FPS === 60 ? '-60fps' : ''}`
  const file = join(RESULTS_DIR, `hashes-${RENDERER}${suffix}.json`)
  const body = {
    renderer: RENDERER,
    seed: SEED,
    fps: FPS,
    steps: STEPS,
    runs: runs.map(({ framesRendered, warmupSteps, glRenderer, hashes }) => ({
      framesRendered,
      warmupSteps,
      glRenderer,
      hashes,
    })),
    identical,
    firstDifferentFrame,
  }
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`)
  console.log(`spike 285: wrote ${basename(file)} (identical=${identical})`)
}

function finish(runs) {
  if (finished) return
  finished = true
  try {
    if (runs) {
      for (const run of runs) failures.push(...run.failures)
      const { identical, firstDifferentFrame } = compare(runs)
      if (!identical) {
        const message = `runs differ, first at frame ${firstDifferentFrame}`
        if (SEED !== null) failures.push(message)
        else console.log(`spike 285: ${message} (--no-seed: reported, not a failure)`)
      }
      writeResults(runs, identical, firstDifferentFrame)
    }
  } catch (error) {
    failures.push(`could not write results: ${error.stack ?? error}`)
  }
  for (const f of failures) console.error(`spike 285 FAILED: ${f}`)
  const code = failures.length > 0 ? 1 : 0
  if (code === 0) console.log('spike 285: OK')
  // finish() can run inside an IPC dispatch, where app.exit() stalls; leave the handler first and
  // fall back to a hard process exit so the app always quits.
  setImmediate(() => app.exit(code))
  setTimeout(() => process.exit(code), 3000).unref()
}

function onReport(event, msg) {
  if (!win || event.sender !== win.webContents || !msg || typeof msg !== 'object') return
  switch (msg.type) {
    case 'csp':
      failures.push(`CSP violation: ${msg.directive} ${msg.blockedURI}`)
      break
    case 'log':
      console.log(`[engine] ${msg.text}`)
      break
    case 'png': {
      mkdirSync(RESULTS_DIR, { recursive: true })
      const image = nativeImage.createFromBitmap(Buffer.from(msg.bgra), {
        width: msg.width,
        height: msg.height,
      })
      const name = RENDERER + (msg.run > 0 ? `-run${msg.run}` : '')
      writeFileSync(join(RESULTS_DIR, `frame-${name}-${msg.frame}.png`), image.toPNG())
      break
    }
    case 'error':
      failures.push(`page error: ${msg.message}`)
      finish(null)
      break
    case 'done':
      finish(msg.runs)
      break
  }
}

setTimeout(() => {
  failures.push(`hard timeout after ${HARD_TIMEOUT_MS / 1000} s`)
  finish(null)
}, HARD_TIMEOUT_MS)

app.whenReady().then(() => {
  protocol.handle('q2spike', (request) =>
    handle(request).catch((error) => {
      console.error(`q2spike handler: ${error.message}`)
      return respond(null, 500)
    }),
  )
  ipcMain.on('spike:report', onReport)

  // Copied by value from rendererWebPreferences in src/main/window-shared.ts (offscreen variant);
  // a spike may not import src/.
  const webPreferences = {
    preload: join(SPIKE_DIR, 'preload.cjs'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    backgroundThrottling: false,
  }
  const width = 800
  const height = 600
  // Left of every display, as scripts/lib/harness.mjs places the offscreen UI harness window.
  const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x))
  // Focusable, unlike 284: the engine only treats itself as active while the window has focus.
  win = new BrowserWindow({
    x: left - width - 100,
    y: 0,
    width,
    height,
    useContentSize: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences,
  })
  win.setPosition(left - width - 100, 0)
  win.webContents.setBackgroundThrottling(false)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('q2spike://app/')) event.preventDefault()
  })
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error')
      console.error(`[renderer ${event.level}] ${event.message}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    failures.push(`renderer gone: ${details.reason}`)
    finish(null)
  })
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
    win.webContents.focus()
  })
  void win.loadURL('q2spike://app/index.html')
})
