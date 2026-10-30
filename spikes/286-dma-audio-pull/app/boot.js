// Spike page: per run a fresh engine on the web sound driver. Capture mode warms up until the demo
// draws, then every step pulls the frames the mixer painted and counts them against 48 * ms.
// Real-time mode lets the engine run on its own main loop and feeds an AudioWorklet. (story 286)

import { loadData, report, sleep, toHex, watchCsp } from './lib/page.js'

const WIDTH = 640
const HEIGHT = 480
const WARMUP_CAP = 900
const WARMUP_STREAK = 3
const TAKE_FRAMES = 4096
const KHZ = 48
const BLOCK = 1024
const SAB_RING_FRAMES = 16384

watchCsp()

function newCanvas() {
  document.getElementById('canvas')?.remove()
  const canvas = document.createElement('canvas')
  canvas.id = 'canvas'
  canvas.width = WIDTH
  canvas.height = HEIGHT
  document.body.append(canvas)
  return canvas
}

async function startEngine(config, createEngine, files) {
  const log = []
  const print = (text) => {
    log.push(text)
    report({ type: 'log', text })
  }
  const engine = await createEngine({
    canvas: newCanvas(),
    print,
    printErr: print,
    arguments: [
      ...['+set', 'basedir', '/q2', '+set', 'homedir', '/q2home'],
      ...['+set', 's_enable', '1', '+set', 's_driver', 'web', '+set', 's_khz', String(KHZ)],
      ...(config.mode === 'capture' ? ['+set', 's_mixahead', '0'] : []),
      ...['+set', 'cl_autopause', '0', '+set', 'scr_showpause', '0'],
      ...['+set', 'cl_demowait', '1', '+set', 'cl_flares', '0'],
      ...['+set', 'cl_async', '1', '+set', 'r_maxfps', '0'],
      // Real time: the demo is short; nextserver restarts it when it ends so the 60 s stay audible.
      ...(config.mode === 'realtime' ? ['+set', 'nextserver', 'demo move-fire'] : []),
      '+demo',
      'move-fire',
      // Prints the cvar's value into the log; the engine exports no cvar reader.
      '+s_enable',
    ],
    preRun: [
      (module) => {
        for (const dir of ['/q2', '/q2/baseq2', '/q2/baseq2/demos', '/q2home']) module.FS.mkdir(dir)
        for (const { vpath, bytes } of files) module.FS.writeFile(`/q2/${vpath}`, bytes)
      },
    ],
  })
  const text = log.join('\n')
  const enableMatch = /"s_enable" is "(\d+)"/.exec(text)
  const boot = {
    driver: /Using web audio driver/.test(text) ? 'web' : null,
    sEnable: enableMatch ? Number(enableMatch[1]) : null,
    soundErrors: log.filter(
      (line) => /sound|audio|snd/i.test(line) && /fail|error|couldn't|can't/i.test(line),
    ),
  }
  return { engine, boot }
}

async function runOnce(config, createEngine, files, runIndex) {
  const { engine, boot } = await startEngine(config, createEngine, files)
  // Must precede any step: the RAF-driven frame would otherwise interleave with ours.
  engine.pauseMainLoop()
  if (config.seed !== null) engine._q2l_seed(config.seed)

  const msAt = (i) =>
    Math.round(((i + 1) * 1000) / config.fps) - Math.round((i * 1000) / config.fps)

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

  const ptr = engine._malloc(TAKE_FRAMES * 4)
  engine._q2l_audio_capture(1)
  const expected = []
  const got = []
  const chunks = []
  let nonZeroSamples = 0
  for (let i = 0; i < config.frames; i++) {
    const ms = msAt(i)
    engine._q2l_step(ms)
    const taken = engine._q2l_audio_take(ptr, TAKE_FRAMES)
    expected.push(KHZ * ms)
    got.push(taken)
    // HEAP16 is re-read per step: a heap growth detaches the previous view.
    const pcm = engine.HEAP16.slice(ptr / 2, ptr / 2 + taken * 2)
    for (let s = 0; s < pcm.length; s++) if (pcm[s] !== 0) nonZeroSamples++
    chunks.push(pcm)
  }
  engine._q2l_audio_capture(0)

  const total = chunks.reduce((n, c) => n + c.length, 0)
  const pcm = new Int16Array(total)
  let at = 0
  for (const chunk of chunks) {
    pcm.set(chunk, at)
    at += chunk.length
  }
  const sha256 = toHex(await crypto.subtle.digest('SHA-256', pcm))
  let mismatches = 0
  for (let i = 0; i < expected.length; i++) if (expected[i] !== got[i]) mismatches++
  return {
    boot,
    warmup,
    expected,
    got,
    mismatches,
    nonZeroSamples,
    sha256,
    pcm: runIndex === 0 ? pcm : null,
  }
}

async function runRealtime(config, createEngine, files) {
  const sab = config.transport === 'sab'
  if (sab && !crossOriginIsolated)
    throw new Error('transport sab unavailable: crossOriginIsolated is false')
  const shared = sab
    ? { ring: new SharedArrayBuffer(SAB_RING_FRAMES * 2 * 4), ctl: new SharedArrayBuffer(3 * 4) }
    : null
  const ring = sab ? new Float32Array(shared.ring) : null
  const ctl = sab ? new Int32Array(shared.ctl) : null

  const context = new AudioContext({ sampleRate: KHZ * 1000, latencyHint: 'interactive' })
  await context.audioWorklet.addModule('worklet.js')
  const node = new AudioWorkletNode(context, 'engine-player', {
    outputChannelCount: [2],
    processorOptions: { sab: shared },
  })
  node.connect(context.destination)
  await context.resume()
  if (context.state !== 'running') throw new Error(`AudioContext is ${context.state}`)

  let consumed = 0
  let underruns = 0
  node.port.onmessage = ({ data }) => {
    consumed = data.consumed
    underruns = data.underruns
  }

  const { engine, boot } = await startEngine({ ...config, mode: 'realtime' }, createEngine, files)
  const ptr = engine._malloc(TAKE_FRAMES * 4)
  let painted = 0
  let sent = 0
  let blocks = 0
  let nonSilentBlocks = 0
  let latencySum = 0
  let latencyN = 0
  const outputMs = () => (context.baseLatency + (context.outputLatency || 0)) * 1000

  // samples: interleaved Int16 stereo, BLOCK frames
  function sendBlock(samples) {
    let nonZero = false
    const planar = sab ? null : new Float32Array(BLOCK * 2)
    for (let i = 0; i < BLOCK; i++) {
      const l = samples[i * 2]
      const r = samples[i * 2 + 1]
      if (l !== 0 || r !== 0) nonZero = true
      if (sab) {
        const at = ((sent + i) % SAB_RING_FRAMES) * 2
        ring[at] = l / 32768
        ring[at + 1] = r / 32768
      } else {
        planar[i] = l / 32768
        planar[BLOCK + i] = r / 32768
      }
    }
    if (nonZero) nonSilentBlocks++
    blocks++
    sent += BLOCK
    if (sab) Atomics.store(ctl, 0, sent)
    else node.port.postMessage({ block: planar }, [planar.buffer])
  }

  let carry = new Int16Array(0)
  function pump() {
    if (sab) {
      consumed = Atomics.load(ctl, 1)
      underruns = Atomics.load(ctl, 2)
    }
    engine._q2l_audio_consumed(consumed)
    const taken = engine._q2l_audio_take(ptr, TAKE_FRAMES)
    if (taken > 0) {
      // HEAP16 is re-read per pull: a heap growth detaches the previous view.
      const pcm = engine.HEAP16.slice(ptr / 2, ptr / 2 + taken * 2)
      const merged = new Int16Array(carry.length + pcm.length)
      merged.set(carry)
      merged.set(pcm, carry.length)
      painted += taken
      let at = 0
      while (merged.length - at >= BLOCK * 2) {
        sendBlock(merged.subarray(at, at + BLOCK * 2))
        at += BLOCK * 2
      }
      carry = merged.slice(at)
    }
    if (sent > 0) {
      latencySum += (painted - consumed) / KHZ + outputMs()
      latencyN++
    }
  }

  const started = performance.now()
  await new Promise((resolve) => {
    const tick = () => {
      pump()
      if (performance.now() - started >= config.seconds * 1000) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const seconds = (performance.now() - started) / 1000
  await context.close()
  return {
    boot,
    result: {
      transport: config.transport,
      seconds: Math.round(seconds * 10) / 10,
      underruns,
      underrunsPerMinute: Math.round((underruns / seconds) * 60 * 100) / 100,
      latencyMs: latencyN > 0 ? Math.round((latencySum / latencyN) * 10) / 10 : null,
      nonSilentBlocks,
      blocks,
      crossOriginIsolated,
    },
  }
}

async function main() {
  const config = await (await fetch('config.json')).json()
  const files = await loadData()
  const { default: createEngine } = await import('./engine/q2pro.js')
  if (config.mode === 'realtime') {
    const { boot, result } = await runRealtime(config, createEngine, files)
    report({ type: 'done', boot, result })
    return
  }
  const runs = []
  for (let r = 0; r < config.runs; r++) {
    runs.push(await runOnce(config, createEngine, files, r))
    // Lets the previous instance's canvas and context go before the next one is created.
    await sleep(50)
  }
  report({ type: 'done', runs })
}

main().catch((error) =>
  report({ type: 'error', message: String(error && error.stack ? error.stack : error) }),
)
