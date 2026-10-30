// Spike Electron main for the encoder matrix. Serves the spike folder over spike282://app/,
// loads probe.html, waits for its report, validates it and exits (non-zero on any gap). (story 282)

import { app, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { closeSync, mkdirSync, openSync, writeFileSync, writeSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SPIKE_DIR = fileURLToPath(new URL('.', import.meta.url))
const labelArg = process.argv.find((a) => a.startsWith('--platform-label='))
const label = labelArg ? labelArg.slice('--platform-label='.length) : process.platform
const TIMEOUT_MS = 120_000

// Same privileges as the launcher's own scheme (src/main/index.ts); must run before `ready`.
protocol.registerSchemesAsPrivileged([
  { scheme: 'spike282', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

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

const childProcessGone = []
app.on('child-process-gone', (_e, details) => {
  childProcessGone.push({ type: details.type, reason: details.reason, name: details.name ?? null })
})

function validate(r) {
  const gaps = []
  if (!Array.isArray(r.video) || r.video.length !== 60)
    gaps.push(`video: expected 60 entries, got ${Array.isArray(r.video) ? r.video.length : 'none'}`)
  else if (r.video.some((v) => typeof v.supported !== 'boolean'))
    gaps.push('video: entry without boolean supported')
  if (!Array.isArray(r.audio) || r.audio.length !== 2)
    gaps.push(`audio: expected 2 entries, got ${Array.isArray(r.audio) ? r.audio.length : 'none'}`)
  else if (r.audio.some((a) => typeof a.supported !== 'boolean'))
    gaps.push('audio: entry without boolean supported')
  for (const k of ['aacBefore', 'aacAfter'])
    if (typeof r.mediabunny?.[k] !== 'boolean') gaps.push(`mediabunny.${k}: not boolean`)
  if (!r.sample || typeof r.sample.bytes !== 'number' || r.sample.bytes <= 0)
    gaps.push(`sample: missing or empty${r.sampleError ? ` (${r.sampleError})` : ''}`)
  if (!existsSync(join(SPIKE_DIR, 'results', `sample-${label}.mp4`)))
    gaps.push(`sample: results/sample-${label}.mp4 not written`)
  for (const k of ['sameTask', 'afterAwait'])
    if (typeof r.capture?.[k] !== 'string' || !r.capture[k]) gaps.push(`capture.${k}: missing`)
  return gaps
}

function finish(code, message) {
  if (message) console.error(message)
  app.exit(code)
}

app.whenReady().then(async () => {
  protocol.handle('spike282', (request) => {
    const root = resolve(SPIKE_DIR)
    const rel = decodeURIComponent(new URL(request.url).pathname)
    const target = resolve(root, `.${rel}`)
    if (request.method !== 'GET' || (target !== root && !target.startsWith(root + sep)))
      return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(target).toString())
  })

  mkdirSync(join(SPIKE_DIR, 'results'), { recursive: true })
  const fd = openSync(join(SPIKE_DIR, 'results', `sample-${label}.mp4`), 'w')
  let fdOpen = true
  ipcMain.handle('spike282:write', (_e, position, bytes) => {
    if (!Number.isSafeInteger(position) || position < 0) throw new Error(`bad position ${position}`)
    if (!fdOpen || !(bytes instanceof Uint8Array)) throw new Error('bad write')
    writeSync(fd, bytes, 0, bytes.length, position)
  })
  ipcMain.handle('spike282:finish', () => {
    if (fdOpen) closeSync(fd)
    fdOpen = false
  })

  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences })

  const timer = setTimeout(() => finish(1, `no report within ${TIMEOUT_MS} ms`), TIMEOUT_MS)
  ipcMain.once('spike282:report', (_e, json) => {
    clearTimeout(timer)
    try {
      const report = { label, ...JSON.parse(json), childProcessGone }
      mkdirSync(join(SPIKE_DIR, 'results'), { recursive: true })
      writeFileSync(
        join(SPIKE_DIR, 'results', `matrix-${label}.json`),
        JSON.stringify(report, null, 2) + '\n',
      )
      const gaps = validate(report)
      if (gaps.length) return finish(1, `validation failed:\n  ${gaps.join('\n  ')}`)
      finish(0)
    } catch (e) {
      finish(1, `bad report: ${e instanceof Error ? e.message : e}`)
    }
  })

  try {
    await win.loadURL('spike282://app/probe.html')
  } catch (e) {
    finish(1, `load failed: ${e instanceof Error ? e.message : e}`)
  }
})
