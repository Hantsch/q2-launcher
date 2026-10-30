// Spike Electron main: runs the capture page on the shared engine window, then writes counts, PCM
// hashes and a WAV to results/. Always quits. (story 286)

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startEngineWindow } from '../lib/engine-window.mjs'

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(SPIKE_DIR, 'results')
const SEED = process.env.Q2L_SPIKE_SEED === '' ? null : Number(process.env.Q2L_SPIKE_SEED)
const RUNS = Number(process.env.Q2L_SPIKE_RUNS ?? '1')
const FPS = Number(process.env.Q2L_SPIKE_FPS ?? '60')
const FRAMES = Number(process.env.Q2L_SPIKE_FRAMES ?? '600')
const MODE = process.env.Q2L_SPIKE_MODE ?? 'capture'
const SECONDS = Number(process.env.Q2L_SPIKE_SECONDS ?? '60')
const TRANSPORT = process.env.Q2L_SPIKE_TRANSPORT ?? 'port'
const HARD_TIMEOUT_MS = 540_000
const SAMPLE_RATE = 48000

const failures = []
let finished = false

function wav(pcm) {
  const bytes = pcm.length * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + bytes, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(2, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 4, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(bytes, 40)
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, bytes)])
}

function checkBoot(boot) {
  if (boot.driver !== 'web') failures.push('boot check: the driver init line is missing')
  if (boot.soundErrors.length > 0) failures.push(`boot check: sound error: ${boot.soundErrors[0]}`)
  if (boot.sEnable !== 1) failures.push(`boot check: s_enable reads ${boot.sEnable}`)
}

function writeRealtime(msg) {
  checkBoot(msg.boot)
  const name = TRANSPORT === 'sab' ? 'realtime-sab.json' : 'realtime.json'
  writeFileSync(join(RESULTS_DIR, name), `${JSON.stringify(msg.result, null, 2)}\n`)
  if (msg.result.nonSilentBlocks === 0) failures.push('every 1024-frame block is silent')
}

function writeResults(runs) {
  const write = (name, body) =>
    writeFileSync(join(RESULTS_DIR, name), `${JSON.stringify(body, null, 2)}\n`)
  const first = runs[0]
  const { boot } = first
  checkBoot(boot)
  const bootFields = { driver: boot.driver, sEnable: boot.sEnable }
  write('counts.json', {
    ...bootFields,
    fps: FPS,
    seed: SEED,
    steps: first.expected.length,
    expected: first.expected,
    got: first.got,
    mismatches: first.mismatches,
    nonZeroSamples: first.nonZeroSamples,
    warmupSteps: first.warmup,
  })
  for (const [i, run] of runs.entries()) {
    if (run.mismatches !== 0)
      failures.push(`run ${i}: ${run.mismatches} step(s) with a wrong frame count`)
    if (run.nonZeroSamples === 0) failures.push(`run ${i}: every sample is zero`)
  }
  if (first.pcm) writeFileSync(join(RESULTS_DIR, 'capture-run1.wav'), wav(first.pcm))
  if (runs.length >= 2) {
    const hashes = runs.map((run) => run.sha256)
    const equal = hashes.every((h) => h === hashes[0])
    write('pcm-hashes.json', { ...bootFields, seed: SEED, runs: hashes, equal })
    if (!equal) failures.push('PCM hashes differ between runs')
  }
}

function finish(msg) {
  if (finished) return
  finished = true
  try {
    mkdirSync(RESULTS_DIR, { recursive: true })
    if (msg?.runs) writeResults(msg.runs)
    else if (msg) writeRealtime(msg)
  } catch (error) {
    failures.push(`could not write results: ${error.stack ?? error}`)
  }
  for (const f of failures) console.error(`spike 286 FAILED: ${f}`)
  const code = failures.length > 0 ? 1 : 0
  if (code === 0) console.log('spike 286: OK')
  engineWindow.exit(code)
}

const engineWindow = startEngineWindow({
  spikeDir: SPIKE_DIR,
  hardTimeoutMs: HARD_TIMEOUT_MS,
  onHardTimeout: () => {
    failures.push(`hard timeout after ${HARD_TIMEOUT_MS / 1000} s`)
    finish(null)
  },
  onReport: (msg) => {
    switch (msg.type) {
      case 'csp':
        failures.push(`CSP violation: ${msg.directive} ${msg.blockedURI}`)
        break
      case 'log':
        console.log(`[engine] ${msg.text}`)
        break
      case 'error':
        failures.push(`page error: ${msg.message}`)
        finish(null)
        break
      case 'done':
        finish(msg)
        break
    }
  },
  onGone: (reason) => {
    failures.push(`renderer gone: ${reason}`)
    finish(null)
  },
  switches: [
    ['use-angle', 'swiftshader'],
    ['enable-unsafe-swiftshader'],
    ...(MODE === 'realtime' ? [['autoplay-policy', 'no-user-gesture-required']] : []),
  ],
  extraFiles: {
    '/worklet.js': {
      path: join(SPIKE_DIR, 'worklet.js'),
      type: 'text/javascript; charset=utf-8',
    },
  },
  // SharedArrayBuffer needs cross-origin isolation; require-corp holds as every fetch is same-origin.
  headers:
    TRANSPORT === 'sab'
      ? {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        }
      : {},
  jsonRoutes: {
    '/config.json': JSON.stringify({
      mode: MODE,
      runs: RUNS,
      seed: SEED,
      fps: FPS,
      frames: FRAMES,
      seconds: SECONDS,
      transport: TRANSPORT,
    }),
  },
  // Focusable: the engine only treats itself as active while the window has focus.
  window: { width: 800, height: 600, focusable: true, focus: true },
})
