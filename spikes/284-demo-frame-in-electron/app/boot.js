// Spike page: loads the data files into MEMFS and starts the engine on a demo, reporting what main
// needs to measure through the preload bridge. (story 284)

const spike = window.spike

// No inline styles under the production CSP; CSSOM writes are not governed by style-src.
Object.assign(document.documentElement.style, { margin: '0', height: '100%', overflow: 'hidden' })
Object.assign(document.body.style, { margin: '0', height: '100%', background: '#000' })
const canvas = document.getElementById('q2l-engine-canvas')
Object.assign(canvas.style, { display: 'block', width: '100vw', height: '100vh' })

// Instrumentation goes in before the engine module is imported, so nothing it does is missed.
window.addEventListener('securitypolicyviolation', (e) => {
  spike.report({
    type: 'csp',
    violation: {
      directive: e.effectiveDirective,
      blockedURI: e.blockedURI,
      sample: e.sample,
      sourceFile: e.sourceFile,
    },
  })
})

// Every entry is reported on the page's own performance.now() timeline, the same one the heartbeat
// and the engine-start mark use, so main never mixes clocks.
new PerformanceObserver((list) => {
  for (const entry of list.getEntries())
    spike.report({ type: 'longtask', start: entry.startTime, duration: entry.duration })
}).observe({ type: 'longtask', buffered: true })

// Independent of the 50 ms long-task threshold: the largest gap between 5 ms timer ticks is the
// longest stretch the main thread could not run a timer. Only gaps above 10 ms are sent.
const HEARTBEAT_MS = 5
let lastBeat = performance.now()
setInterval(() => {
  const now = performance.now()
  if (now - lastBeat > 10) spike.report({ type: 'gap', start: lastBeat, gap: now - lastBeat })
  lastBeat = now
}, HEARTBEAT_MS)

// Positive control: a task known to exceed the 50 ms long-task threshold must show up as an entry.
async function longTaskControl() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  const start = performance.now()
  while (performance.now() - start < 120);
  const end = performance.now()
  await new Promise((resolve) => setTimeout(resolve, 200))
  spike.report({ type: 'longTaskControl', start, end })
}

let rafCount = 0
const nativeRaf = window.requestAnimationFrame.bind(window)
window.requestAnimationFrame = (callback) =>
  nativeRaf((time) => {
    rafCount++
    callback(time)
  })

let engineError = null
function reportEngineError(error) {
  if (engineError) return
  engineError = {
    name: error && error.name ? String(error.name) : 'Error',
    message: error && error.message ? String(error.message) : String(error),
  }
  spike.report({ type: 'engineError', error: engineError })
}
window.addEventListener('error', (e) => reportEngineError(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => reportEngineError(e.reason))

const moduleOptions = {
  canvas,
  print: (text) => spike.report({ type: 'log', text }),
  printErr: (text) => spike.report({ type: 'log', text }),
}

setInterval(async () => {
  const mem = await spike.memory()
  spike.report({
    type: 'tick',
    at: Date.now(),
    rafCount,
    heapBytes: moduleOptions.HEAPU8 ? moduleOptions.HEAPU8.length : null,
    mem,
  })
}, 250)

async function loadData() {
  const memBefore = await spike.memory()
  const started = performance.now()
  const { files: manifest, padMb } = await (await fetch('data/manifest.json')).json()
  const files = await Promise.all(
    manifest.map(async ({ index, vpath }) => {
      const response = await fetch(`data/${index}`)
      if (!response.ok) throw new Error(`data/${index} (${vpath}): HTTP ${response.status}`)
      return { vpath, bytes: new Uint8Array(await response.arrayBuffer()) }
    }),
  )
  const dataLoadMs = Math.round(performance.now() - started)
  const dataBytes = files.reduce((sum, f) => sum + f.bytes.length, 0)
  // Zero-filled stand-in for retail data the machine does not have; generated here, never fetched,
  // and named so the engine does not mount it as a pak.
  const padBytes = padMb * 1024 * 1024
  if (padBytes > 0) files.push({ vpath: 'baseq2/pad.bin', bytes: new Uint8Array(padBytes) })
  spike.report({ type: 'dataLoaded', memBefore, dataLoadMs, dataBytes, padBytes })
  return files
}

async function main() {
  const files = await loadData()
  const demo = files.find((f) => f.vpath.startsWith('baseq2/demos/'))
  const demoName = demo.vpath.slice('baseq2/demos/'.length)

  moduleOptions.arguments = [
    ...['+set', 'basedir', '/q2', '+set', 'homedir', '/q2home'],
    ...['+set', 's_enable', '0', '+set', 'cl_autopause', '0', '+set', 'scr_showpause', '0'],
    ...['+set', 'cl_demowait', '1', '+demo', demoName],
  ]
  moduleOptions.preRun = [
    (module) => {
      const fs = module.FS
      for (const dir of ['/q2', '/q2/baseq2', '/q2/baseq2/demos', '/q2home']) fs.mkdir(dir)
      const writeStart = performance.now()
      for (const { vpath, bytes } of files) fs.writeFile(`/q2/${vpath}`, bytes)
      spike.report({ type: 'fsWrite', ms: performance.now() - writeStart })
    },
  ]

  await longTaskControl()
  const importStart = performance.now()
  spike.report({ type: 'engineStart', at: Date.now(), perf: importStart })
  const { default: createEngine } = await import('./engine/q2pro.js')
  const callStart = performance.now()
  const pending = createEngine(moduleOptions)
  const callMs = performance.now() - callStart
  const engine = await pending
  // INVOKE_RUN=0: the host starts the engine.
  engine.callMain(moduleOptions.arguments)
  spike.report({
    type: 'factory',
    importMs: callStart - importStart,
    callMs,
    resolveMs: performance.now() - callStart,
  })
}

main().catch(reportEngineError)
