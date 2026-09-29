// Story 171 D3: e2e proof that leaving the Demos view parks the game and coming back places it at
// the stage again - without restarting the demo - and that a bigger window (setSize + maximize) yields
// exactly one park and one placed line, sized like the new stage rect. Assertions are on the
// engine stub's window log (`Q2L_UI_ENGINE_WINDOW_LOG`) and main.log's launching lines only.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysStageFollowEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
const ENGINE_TIMEOUT_MS = 5_000
const SETTLE_MS = 700

const files = replaysStageFollowEngineFiles()

export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_ENGINE_WINDOW_LOG: files.windowLog,
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (message) => {
  throw new Error(`replays-stage-view-leave: ${message}`)
}

function windowLines() {
  if (!existsSync(files.windowLog)) return []
  return readFileSync(files.windowLog, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
}

/** Waits until the log has grown by `expected.length` lines, settles, then wants exactly those. */
async function expectNewLines(from, expected, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (windowLines().length - from < expected.length) {
    if (Date.now() >= deadline) fail(`${label}: window log got ${JSON.stringify(windowLines().slice(from))}, expected ${JSON.stringify(expected)}`)
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const got = windowLines().slice(from)
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    fail(`${label}: window log got ${JSON.stringify(got)}, expected exactly ${JSON.stringify(expected)}`)
  }
}

const geometryLines = (lines) => lines.filter((l) => l.startsWith('set vid_geometry '))

async function waitForScan(page) {
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (await refresh.isDisabled()) {
    if (Date.now() >= deadline) fail('timed out waiting for the demo scan to finish')
    await sleep(100)
  }
}

async function launchGeometry(logPath) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    const line = content
      .split(/\r?\n/)
      .filter((l) => l.includes('launching'))
      .pop()
    const m = line ? /\+set vid_geometry (\d+)x(\d+)\+(-?\d+)\+(-?\d+)/.exec(line) : null
    if (m) return { w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }
    if (line) fail(`the launching line has no vid_geometry: ${JSON.stringify(line)}`)
    if (Date.now() >= deadline) fail('main.log never contained a launching line')
    await sleep(150)
  }
}

/** The `vid_geometry` line for the picture's box at the window's current place and display (the same
 * conversion `replays-stage.mjs` checks the launch against). */
async function placedNow(page, app) {
  const b = await page.getByTestId('replays-stage-picture').boundingBox()
  if (!b) fail('the stage picture has no box')
  const rect = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
  return app.evaluate(({ BrowserWindow, screen }, rect) => {
    const win = BrowserWindow.getAllWindows()[0]
    const contentBounds = win.getContentBounds()
    const scale = screen.getDisplayMatching(contentBounds).scaleFactor
    const zoom = win.webContents.getZoomFactor()
    const dip = {
      x: contentBounds.x + rect.x * zoom,
      y: contentBounds.y + rect.y * zoom,
      width: rect.width * zoom,
      height: rect.height * zoom,
    }
    const p = typeof screen.dipToScreenRect === 'function' ? screen.dipToScreenRect(win, dip) : {
      x: dip.x * scale, y: dip.y * scale, width: dip.width * scale, height: dip.height * scale,
    }
    return `set vid_geometry ${Math.round(p.width)}x${Math.round(p.height)}+${Math.round(p.x)}+${Math.round(p.y)}`
  }, rect)
}


const launchCount = (logPath) =>
  existsSync(logPath) ? readFileSync(logPath, 'utf8').split(/\r?\n/).filter((l) => l.includes('launching')).length : 0

/** Waits for `n` new geometry lines, settles, and returns all new geometry lines. */
async function newGeometry(from, n, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (geometryLines(windowLines().slice(from)).length < n) {
    if (Date.now() >= deadline) fail(`${label}: window log got ${JSON.stringify(windowLines().slice(from))}`)
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  return geometryLines(windowLines().slice(from))
}

export default async function replaysStageViewLeave({ page, app, step, shot }) {
  step('a demo plays on the stage')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  await page.getByTestId('replays-demo-row').filter({ hasText: REPLAYS_PLAY_CTF_DEMO }).first().click({ timeout: TIMEOUT_MS })
  const play = page.getByTestId('replays-demo-play')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  const picture = page.getByTestId('replays-stage-picture')
  await picture.waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })
  const input = page.getByTestId('replays-console-input')
  const liveBy = Date.now() + 15_000
  while (await input.isDisabled()) {
    if (Date.now() >= liveBy) fail('the playback session never went live')
    await sleep(100)
  }
  const launched = await launchGeometry(logPath)
  await sleep(SETTLE_MS)
  if (windowLines().length > 0) fail(`an unmoved launcher must not re-place the game: ${JSON.stringify(windowLines())}`)
  const launches = launchCount(logPath)

  const edge = await app.evaluate(({ screen }) => {
    let right = 0
    for (const d of screen.getAllDisplays()) {
      const p = typeof screen.dipToScreenRect === 'function' ? screen.dipToScreenRect(null, d.bounds) : {
        x: d.bounds.x * d.scaleFactor, width: d.bounds.width * d.scaleFactor,
      }
      right = Math.max(right, p.x + p.width)
    }
    return Math.round(right)
  })
  const parkX = edge + 64
  const parseGeo = (l) => {
    const g = /^set vid_geometry (\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/.exec(l ?? '')
    return g ? { w: Number(g[1]), h: Number(g[2]), x: Number(g[3]), y: Number(g[4]) } : null
  }
  const isPark = (l) => parseGeo(l)?.x === parkX

  step('leaving the Demos view parks the game')
  let from = windowLines().length
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await picture.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  let lines = await newGeometry(from, 1, 'leave')
  if (lines.length !== 1 || !isPark(lines[0])) fail(`leave: expected exactly one park line (x=${parkX}), got ${JSON.stringify(lines)}`)

  step('back on Demos the game is placed at the stage, the demo was not restarted')
  from = windowLines().length
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await picture.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  lines = await newGeometry(from, 1, 'return')
  let want = await placedNow(page, app)
  if (lines.length !== 1 || lines[0] !== want) fail(`return: expected exactly [${want}], got ${JSON.stringify(lines)}`)
  if (launchCount(logPath) !== launches) fail('returning to the Demos view restarted the demo')
  await shot('stage-view-leave-back')

  step('a bigger window: one park, one placed line at the new stage size')
  const before = parseGeo(want)
  from = windowLines().length
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [w, h] = win.getSize()
    win.setSize(w + 200, h + 120)
    win.maximize()
  })
  lines = await newGeometry(from, 2, 'resize')
  want = await placedNow(page, app)
  const now = parseGeo(want)
  if (lines.length !== 2 || !isPark(lines[0]) || lines[1] !== want) {
    fail(`resize: expected exactly one park line then [${want}], got ${JSON.stringify(lines)}`)
  }
  if (!(now.w > before.w || now.h > before.h)) fail(`resize: the stage did not grow (${JSON.stringify(before)} -> ${JSON.stringify(now)})`)
  if (launchCount(logPath) !== launches) fail('resizing restarted the demo')
  await shot('stage-view-leave-maximized')

  step('the game exits and the stage is gone')
  writeFileSync(files.quitFile, '')
  await picture.waitFor({ state: 'hidden', timeout: 15_000 })
}
