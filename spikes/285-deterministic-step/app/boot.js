// Spike page: per run a fresh canvas and engine instance, the main loop paused, then the engine
// stepped by host-given milliseconds with WebGL frames hashed along the way.

const spike = window.spike
const WIDTH = 640
const HEIGHT = 480
const HASH_EVERY = 15
const PNG_EVERY = 60
const WARMUP_CAP = 900
const WARMUP_STREAK = 3

Object.assign(document.documentElement.style, { margin: '0', background: '#000' })
Object.assign(document.body.style, { margin: '0', background: '#000' })

const report = (obj) => spike.report(obj)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

window.addEventListener('securitypolicyviolation', (e) =>
  report({ type: 'csp', directive: e.effectiveDirective, blockedURI: e.blockedURI }),
)

function newCanvas() {
  document.getElementById('canvas')?.remove()
  const canvas = document.createElement('canvas')
  canvas.id = 'canvas'
  canvas.width = WIDTH
  canvas.height = HEIGHT
  Object.assign(canvas.style, { display: 'block', width: `${WIDTH}px`, height: `${HEIGHT}px` })
  document.body.append(canvas)
  return canvas
}

async function loadData() {
  const { files: manifest } = await (await fetch('data/manifest.json')).json()
  return Promise.all(
    manifest.map(async ({ index, vpath }) => {
      const response = await fetch(`data/${index}`)
      if (!response.ok) throw new Error(`data/${index} (${vpath}): HTTP ${response.status}`)
      return { vpath, bytes: new Uint8Array(await response.arrayBuffer()) }
    }),
  )
}

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

function isSingleColour(pixels) {
  for (let i = 4; i < pixels.length; i += 4)
    if (
      pixels[i] !== pixels[0] ||
      pixels[i + 1] !== pixels[1] ||
      pixels[i + 2] !== pixels[2] ||
      pixels[i + 3] !== pixels[3]
    )
      return false
  return true
}

// readPixels is bottom-up RGBA; nativeImage wants top-down BGRA.
function toBgraTopDown(pixels) {
  const out = new Uint8Array(pixels.length)
  const stride = WIDTH * 4
  for (let y = 0; y < HEIGHT; y++) {
    const src = (HEIGHT - 1 - y) * stride
    const dst = y * stride
    for (let x = 0; x < stride; x += 4) {
      out[dst + x] = pixels[src + x + 2]
      out[dst + x + 1] = pixels[src + x + 1]
      out[dst + x + 2] = pixels[src + x]
      out[dst + x + 3] = pixels[src + x + 3]
    }
  }
  return out
}

async function runOnce(config, createEngine, files, runIndex) {
  const canvas = newCanvas()
  const engine = await createEngine({
    canvas,
    print: (text) => report({ type: 'log', text }),
    printErr: (text) => report({ type: 'log', text }),
    arguments: [
      ...['+set', 'basedir', '/q2', '+set', 'homedir', '/q2home'],
      ...['+set', 's_enable', '0', '+set', 'cl_autopause', '0', '+set', 'scr_showpause', '0'],
      ...['+set', 'cl_demowait', '1', '+set', 'cl_flares', '0'],
      ...['+set', 'cl_async', '1', '+set', 'r_maxfps', '0', '+demo', 'move-fire'],
    ],
    preRun: [
      (module) => {
        for (const dir of ['/q2', '/q2/baseq2', '/q2/baseq2/demos', '/q2home']) module.FS.mkdir(dir)
        for (const { vpath, bytes } of files) module.FS.writeFile(`/q2/${vpath}`, bytes)
      },
    ],
  })
  // Must precede any step: the RAF-driven frame would otherwise interleave with ours.
  engine.pauseMainLoop()
  // Seeding follows init because the engine's own startup consumes the generator.
  if (config.seed !== null) engine._q2l_seed(config.seed)

  const msAt = (i) =>
    Math.round(((i + 1) * 1000) / config.fps) - Math.round((i * 1000) / config.fps)
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('no WebGL2 context on the engine canvas')
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const glRenderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : String(gl.getParameter(gl.RENDERER))
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  const failures = []

  // Map load renders no frame; the counted steps start once the demo draws on every step.
  let streak = 0
  let warmup = 0
  while (streak < WARMUP_STREAK) {
    if (warmup >= WARMUP_CAP)
      throw new Error(`no steady rendering after ${WARMUP_CAP} warm-up steps`)
    const before = engine._q2l_frames_rendered()
    engine._q2l_step(msAt(warmup))
    streak = engine._q2l_frames_rendered() - before === 1 ? streak + 1 : 0
    warmup++
  }

  const start = engine._q2l_frames_rendered()
  const hashes = []
  for (let i = 0; i < config.steps; i++) {
    const before = engine._q2l_frames_rendered()
    engine._q2l_step(msAt(i))
    const rendered = engine._q2l_frames_rendered() - before
    if (rendered !== 1) failures.push(`run ${runIndex}: step ${i} rendered ${rendered} frames`)
    const frame = i + 1
    if (frame % HASH_EVERY !== 0) continue
    // Same task as the step: the drawing buffer is cleared once the page composites.
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    if (isSingleColour(pixels)) failures.push(`run ${runIndex}: frame ${frame} is a single colour`)
    hashes.push({ frame, sha256: toHex(await crypto.subtle.digest('SHA-256', pixels)) })
    if (frame % PNG_EVERY === 0)
      report({
        type: 'png',
        run: runIndex,
        frame,
        width: WIDTH,
        height: HEIGHT,
        bgra: toBgraTopDown(pixels),
      })
  }
  if (new Set(hashes.map((h) => h.sha256)).size < 2)
    failures.push(`run ${runIndex}: all sampled hashes are equal`)
  return {
    framesRendered: engine._q2l_frames_rendered() - start,
    warmupSteps: warmup,
    glRenderer,
    hashes,
    failures,
  }
}

async function main() {
  const config = await (await fetch('config.json')).json()
  const files = await loadData()
  const { default: createEngine } = await import('./engine/q2pro.js')
  const runs = []
  for (let r = 0; r < config.runs; r++) {
    runs.push(await runOnce(config, createEngine, files, r))
    // Lets the previous instance's canvas and context go before the next one is created. Unseeded
    // runs wait over a second so the engine's own time(NULL) seed differs between instances.
    await sleep(config.seed === null ? 1100 : 50)
  }
  report({ type: 'done', runs })
}

main().catch((error) =>
  report({ type: 'error', message: String(error && error.stack ? error.stack : error) }),
)
