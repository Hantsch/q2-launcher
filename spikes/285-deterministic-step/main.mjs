// Spike Electron main: serves app/, the engine and a fixed list of data files over q2spike://app/
// under the launcher's production CSP, lets the page run the stepped engine, then writes hashes and
// PNG frames to results/. Always quits.

import { nativeImage } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startEngineWindow } from '../lib/engine-window.mjs'

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(SPIKE_DIR, 'results')
const RENDERER = process.env.Q2L_SPIKE_RENDERER ?? 'swiftshader'
const SEED = process.env.Q2L_SPIKE_SEED === '' ? null : Number(process.env.Q2L_SPIKE_SEED)
const RUNS = Number(process.env.Q2L_SPIKE_RUNS ?? '2')
const FPS = Number(process.env.Q2L_SPIKE_FPS ?? '30')
const STEPS = Number(process.env.Q2L_SPIKE_STEPS ?? '300')
const HARD_TIMEOUT_MS = 540_000

const CONFIG = JSON.stringify({ runs: RUNS, seed: SEED, fps: FPS, steps: STEPS })

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
  engineWindow.exit(code)
}

function onReport(msg) {
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

const engineWindow = startEngineWindow({
  spikeDir: SPIKE_DIR,
  hardTimeoutMs: HARD_TIMEOUT_MS,
  onHardTimeout: () => {
    failures.push(`hard timeout after ${HARD_TIMEOUT_MS / 1000} s`)
    finish(null)
  },
  onReport,
  onGone: (reason) => {
    failures.push(`renderer gone: ${reason}`)
    finish(null)
  },
  switches:
    RENDERER === 'swiftshader' ? [['use-angle', 'swiftshader'], ['enable-unsafe-swiftshader']] : [],
  jsonRoutes: { '/config.json': CONFIG },
  // Focusable, unlike 284: the engine only treats itself as active while the window has focus.
  window: { width: 800, height: 600, focusable: true, focus: true },
})
