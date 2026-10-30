// Spike Electron main: serves app/, the engine and a fixed list of data files over q2spike://app/
// under the launcher's production CSP, watches the window until the demo shows a picture, plays on
// for the requested seconds and writes frame + metrics to results/. Always quits. (story 284)

import { app } from 'electron'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, startEngineWindow } from '../lib/engine-window.mjs'

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(SPIKE_DIR, 'results')
const ENGINE_DIR = env.engineDir
const LABEL = process.env.Q2L_SPIKE_LABEL ?? 'shareware'
const SECONDS = Number(process.env.Q2L_SPIKE_SECONDS ?? '10')
const PAD_MB = Number(process.env.Q2L_SPIKE_PAD_MB ?? '0')
const WASM_CSP = process.env.Q2L_SPIKE_WASM_CSP !== '0'

const HARD_TIMEOUT_MS = 60_000
const PICTURE_DEADLINE_MS = 10_000
const POLL_MS = 250
const COMPARE_BACK_MS = 500
const BRIGHT_LUMA = 16
const MIN_BRIGHT_SHARE = 0.5
const MIN_CHANGED_SHARE = 0.02
// A pixel counts as changed when its summed per-channel difference |dR|+|dG|+|dB| against the
// earlier sample exceeds this (of a possible 765); filters compositor dithering noise.
const CHANGED_THRESHOLD = 24

const manifestExtra = { padMb: PAD_MB }

// ---- state reported by the renderer ----
const state = {
  memBefore: null,
  dataLoadMs: null,
  dataBytes: null,
  padBytes: null,
  engineStartPerf: null,
  control: null,
  gaps: [],
  fsWriteMs: null,
  factory: null,
  engineStartEpoch: null,
  engineStartMain: null,
  engineError: null,
  cspViolations: 0,
  cspSamples: [],
  longTasks: [],
  lastTick: null,
}
let firstPicture = null // { at, tick }
let finished = false

function onReport(msg) {
  switch (msg.type) {
    case 'csp':
      state.cspViolations += 1
      if (state.cspSamples.length < 5) state.cspSamples.push(msg.violation)
      console.error(`[csp] ${JSON.stringify(msg.violation)}`)
      break
    case 'dataLoaded':
      state.memBefore = msg.memBefore
      state.dataLoadMs = msg.dataLoadMs
      state.dataBytes = msg.dataBytes
      state.padBytes = msg.padBytes
      break
    case 'engineStart':
      state.engineStartEpoch = msg.at
      state.engineStartPerf = msg.perf
      state.engineStartMain = Date.now()
      break
    case 'engineError':
      state.engineError = msg.error
      console.error(`[engine error] ${msg.error.name}: ${msg.error.message}`)
      void finish()
      break
    case 'longtask':
      state.longTasks.push({ start: msg.start, duration: msg.duration })
      break
    case 'gap':
      state.gaps.push({ start: msg.start, gap: msg.gap })
      break
    case 'longTaskControl':
      state.control = { start: msg.start, end: msg.end }
      break
    case 'fsWrite':
      state.fsWriteMs = msg.ms
      break
    case 'factory':
      state.factory = msg
      break
    case 'tick':
      state.lastTick = msg
      break
    case 'log':
      console.log(`[engine] ${msg.text}`)
      break
  }
}

/** Share of pixels at luma > 16, and of pixels that changed against `prev` (null if incomparable). */
function analyse(bitmap, prev) {
  const pixels = bitmap.length / 4
  let bright = 0
  let changed = 0
  const comparable = prev !== null && prev.length === bitmap.length
  for (let i = 0; i < bitmap.length; i += 4) {
    // toBitmap() is BGRA.
    const b = bitmap[i]
    const g = bitmap[i + 1]
    const r = bitmap[i + 2]
    if (0.2126 * r + 0.7152 * g + 0.0722 * b > BRIGHT_LUMA) bright++
    if (
      comparable &&
      Math.abs(r - prev[i + 2]) + Math.abs(g - prev[i + 1]) + Math.abs(b - prev[i]) >
        CHANGED_THRESHOLD
    )
      changed++
  }
  return { brightShare: bright / pixels, changedShare: comparable ? changed / pixels : null }
}

const samples = [] // { at, bitmap }, newest last
let polling = false

let candidate = null // first poll of a possible pair of consecutive picture polls

async function pagePerf() {
  return engineWindow.getWindow().webContents.executeJavaScript('performance.now()')
}

async function poll() {
  if (polling || finished || firstPicture || state.engineStartMain === null) return
  polling = true
  try {
    const perf = await pagePerf()
    const image = await engineWindow.getWindow().webContents.capturePage()
    const at = Date.now()
    const bitmap = image.toBitmap()
    const earlier = samples.filter((s) => s.at <= at - COMPARE_BACK_MS).at(-1) ?? null
    const { brightShare, changedShare } = analyse(bitmap, earlier ? earlier.bitmap : null)
    samples.push({ at, bitmap })
    while (samples.length > 6) samples.shift()
    const shows =
      brightShare >= MIN_BRIGHT_SHARE && changedShare !== null && changedShare >= MIN_CHANGED_SHARE
    // One passing poll can be a loading flash; two in a row are a picture that moves.
    if (!shows) candidate = null
    else if (!candidate) candidate = { at, perf, tick: state.lastTick, brightShare, changedShare }
    else if (!firstPicture) {
      firstPicture = candidate
      console.log(
        `engine:smoke: first picture after ${firstPicture.at - state.engineStartMain} ms (bright ${(firstPicture.brightShare * 100).toFixed(0)}%, changed ${(firstPicture.changedShare * 100).toFixed(1)}%), playing ${SECONDS}s`,
      )
      setTimeout(() => void finish(), SECONDS * 1000)
    }
  } catch (error) {
    console.error(`capturePage failed: ${error.message}`)
  } finally {
    polling = false
  }
}

function appMetricsWorkingSet() {
  const metrics = app.getAppMetrics()
  const rendererPid =
    engineWindow.getWindow() && !engineWindow.getWindow().isDestroyed()
      ? engineWindow.getWindow().webContents.getOSProcessId()
      : -1
  const of = (pred) =>
    metrics.filter(pred).reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0)
  return {
    rendererKB: of((m) => m.pid === rendererPid),
    gpuKB: of((m) => m.type === 'GPU'),
    totalKB: of(() => true),
  }
}

async function finish(extraFailure) {
  if (finished) return
  finished = true
  const failures = []
  if (extraFailure) failures.push(extraFailure)
  let frameWritten = false
  try {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const endTick = state.lastTick
    const timeToPictureMs =
      firstPicture && state.engineStartMain !== null
        ? firstPicture.at - state.engineStartMain
        : null
    // Everything below is on the page's performance.now() timeline.
    const windowStart = state.engineStartPerf
    const windowEnd = firstPicture ? firstPicture.perf : await pagePerf().catch(() => null)
    const overlaps = (start, length, from, to) =>
      from !== null && to !== null && start + length >= from && start <= to
    const longIn = (from, to) =>
      state.longTasks.filter((t) => overlaps(t.start, t.duration, from, to))
    const gapIn = (from, to) =>
      state.gaps.filter((g) => from === null || overlaps(g.start, g.gap, from, to))
    const maxOf = (list, key) => Math.round(list.reduce((x, e) => Math.max(x, e[key]), 0) * 10) / 10
    const inWindow = longIn(windowStart, windowEnd)
    const control = state.control
    const longTaskControlObserved =
      control !== null &&
      state.longTasks.some(
        (t) => t.duration >= 100 && overlaps(t.start, t.duration, control.start, control.end),
      )
    let fps = 0
    if (firstPicture && firstPicture.tick && endTick && endTick.at > firstPicture.tick.at)
      fps =
        (endTick.rafCount - firstPicture.tick.rafCount) /
        ((endTick.at - firstPicture.tick.at) / 1000)

    let playbackMotion = null
    if (firstPicture && engineWindow.getWindow() && !engineWindow.getWindow().isDestroyed()) {
      const before = (await engineWindow.getWindow().webContents.capturePage()).toBitmap()
      await new Promise((resolve) => setTimeout(resolve, COMPARE_BACK_MS))
      const image = await engineWindow.getWindow().webContents.capturePage()
      playbackMotion = analyse(image.toBitmap(), before).changedShare
      const frame = join(RESULTS_DIR, `frame-${LABEL}.png`)
      writeFileSync(frame, image.toPNG())
      copyFileSync(frame, join(RESULTS_DIR, 'frame.png'))
      frameWritten = true
    }

    const wasm = readFileSync(join(ENGINE_DIR, 'q2pro.wasm'))
    const metrics = {
      label: LABEL,
      cspMode: WASM_CSP ? 'wasm-unsafe-eval' : 'no-wasm',
      dataLoadMs: state.dataLoadMs,
      dataBytes: state.dataBytes,
      padBytes: state.padBytes,
      files: engineWindow.dataFiles.map(({ vpath, size }) => ({ vpath, size })),
      timeToPictureMs,
      longestLongTaskMs: maxOf(inWindow, 'duration'),
      longTaskTotalMs: Math.round(inWindow.reduce((sum, t) => sum + t.duration, 0)),
      longTaskControlObserved,
      longTaskEntriesTotal: state.longTasks.length,
      longTaskEntriesInWindow: inWindow.map((t) => ({
        start: Math.round(t.start),
        duration: Math.round(t.duration),
      })),
      maxLoopGapMs: maxOf(gapIn(windowStart, windowEnd), 'gap'),
      maxLoopGapWholeRunMs: maxOf(gapIn(null, null), 'gap'),
      factoryCallMs: state.factory ? Math.round(state.factory.callMs * 10) / 10 : null,
      factoryResolveMs: state.factory ? Math.round(state.factory.resolveMs) : null,
      engineImportMs: state.factory ? Math.round(state.factory.importMs) : null,
      fsWriteMs: state.fsWriteMs === null ? null : Math.round(state.fsWriteMs),
      playbackMotion,
      rendererMemBefore: state.memBefore,
      rendererMemAfter: endTick ? endTick.mem : null,
      appMetricsWorkingSet: appMetricsWorkingSet(),
      heapBytes: endTick ? endTick.heapBytes : null,
      fps: Math.round(fps * 10) / 10,
      cspViolations: state.cspViolations,
      cspViolationSamples: state.cspSamples,
      engineError: state.engineError,
      wasmSha256: createHash('sha256').update(wasm).digest('hex'),
      wasmBytes: wasm.length,
      electronVersion: process.versions.electron,
      // Not every Chromium reports a webgl2 key; null plus the full status keeps the field honest.
      gpu: app.getGPUFeatureStatus().webgl2 ?? null,
      gpuFeatureStatus: app.getGPUFeatureStatus(),
    }

    if (state.engineError)
      failures.push(`engine error: ${state.engineError.name}: ${state.engineError.message}`)
    if (state.cspViolations > 0)
      failures.push(
        `${state.cspViolations} CSP violation(s), first: ${JSON.stringify(state.cspSamples[0])}`,
      )
    if (timeToPictureMs === null) failures.push('no picture in the canvas')
    else if (timeToPictureMs > PICTURE_DEADLINE_MS)
      failures.push(`first picture after ${timeToPictureMs} ms (limit ${PICTURE_DEADLINE_MS} ms)`)
    if (!longTaskControlObserved)
      failures.push('long-task positive control (120 ms busy loop) was not observed')
    if (firstPicture && !(playbackMotion !== null && playbackMotion >= MIN_CHANGED_SHARE))
      failures.push(`picture is not moving at the end of playback (motion ${playbackMotion})`)
    metrics.failures = failures

    const metricsFile = join(RESULTS_DIR, `metrics-${LABEL}.json`)
    writeFileSync(metricsFile, `${JSON.stringify(metrics, null, 2)}\n`)
    copyFileSync(metricsFile, join(RESULTS_DIR, 'metrics.json'))
    console.log(
      `engine:smoke: wrote ${basename(metricsFile)}${frameWritten ? ` and frame-${LABEL}.png` : ''}`,
    )
  } catch (error) {
    failures.push(`could not write results: ${error.stack ?? error}`)
  }
  const code = failures.length > 0 ? 1 : 0
  for (const f of failures) console.error(`engine:smoke FAILED: ${f}`)
  if (code === 0) console.log('engine:smoke: OK')
  engineWindow.exit(code)
}

const engineWindow = startEngineWindow({
  spikeDir: SPIKE_DIR,
  hardTimeoutMs: HARD_TIMEOUT_MS,
  onHardTimeout: () => void finish(`hard timeout after ${HARD_TIMEOUT_MS / 1000} s`),
  onReport,
  onGone: (reason) => void finish(`renderer gone: ${reason}`),
  wasmCsp: WASM_CSP,
  manifestExtra,
  window: { width: 1024, height: 768, focusable: false },
  onReady: () => setInterval(() => void poll(), POLL_MS),
})
