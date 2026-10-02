// Story 171 D2: e2e proof that the game window follows the launcher while a demo plays on the stage.
// The "engine" is the fixture's stub (`scripts/lib/stub-engine.cjs`): every `set vid_geometry …` /
// `set win_alwaysontop …` the launcher sends after the demo started lands in its window log
// (`Q2L_UI_ENGINE_WINDOW_LOG`), and that log is all this flow asserts on:
//   AC1 - dragging the window (20 `setPosition` steps) parks the game once, then places it once at
//         the launch geometry moved by the drag's delta;
//   AC2 - minimize parks it, restore places it back;
//   AC3 - blur drops topmost (`set win_alwaysontop 0`), focus restores it (`1`).
// The stage rect is the one the demo was launched with (the renderer does not report a new one: the
// picture does not move inside the window).
//
// The window is dragged diagonally (X and Y change every step): the follower parks once and does not
// re-send the park line as the stage's Y moves.
//
// Selectors: `replays-stage-picture`, `replays-timeline`, `replays-console-input`, `replays-demo-*`.
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
const STEPS = 20
const STEP_PX = -3
const PARK_MARGIN_PX = 64

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
  throw new Error(`replays-stage-follow: ${message}`)
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
    if (Date.now() >= deadline)
      fail(
        `${label}: window log got ${JSON.stringify(windowLines().slice(from))}, expected ${JSON.stringify(expected)}`,
      )
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const got = windowLines().slice(from)
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    fail(
      `${label}: window log got ${JSON.stringify(got)}, expected exactly ${JSON.stringify(expected)}`,
    )
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
  const rect = {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
  }
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
    const p =
      typeof screen.dipToScreenRect === 'function'
        ? screen.dipToScreenRect(win, dip)
        : {
            x: dip.x * scale,
            y: dip.y * scale,
            width: dip.width * scale,
            height: dip.height * scale,
          }
    return `set vid_geometry ${Math.round(p.width)}x${Math.round(p.height)}+${Math.round(p.x)}+${Math.round(p.y)}`
  }, rect)
}

export default async function replaysStageFollow({ page, app, step, shot }) {
  step('a demo plays on the stage')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_CTF_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
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
  if (windowLines().length > 0)
    fail(`an unmoved launcher must not re-place the game: ${JSON.stringify(windowLines())}`)
  await shot('stage-follow-playing')

  // Where the launcher parks: the virtual desktop's right edge in physical px + 64, same size and Y.
  const { edge, scale } = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]
    let right = 0
    for (const d of screen.getAllDisplays()) {
      const p =
        typeof screen.dipToScreenRect === 'function'
          ? screen.dipToScreenRect(null, d.bounds)
          : {
              x: d.bounds.x * d.scaleFactor,
              width: d.bounds.width * d.scaleFactor,
            }
      right = Math.max(right, p.x + p.width)
    }
    return {
      edge: Math.round(right),
      scale: screen.getDisplayMatching(win.getContentBounds()).scaleFactor,
    }
  })
  const size = `${launched.w}x${launched.h}`
  const parked = `set vid_geometry ${size}+${edge + PARK_MARGIN_PX}+${launched.y}`

  step('AC1: a drag parks the game once, then places it once, moved by the delta')
  let from = windowLines().length
  await app.evaluate(
    async ({ BrowserWindow }, { steps, stepPx }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const [x, y] = win.getPosition()
      for (let i = 1; i <= steps; i++) {
        win.setPosition(x + i * stepPx, y + i * stepPx)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    },
    { steps: STEPS, stepPx: STEP_PX },
  )
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (geometryLines(windowLines().slice(from)).length < 2) {
    if (Date.now() >= deadline)
      fail(`drag: window log got ${JSON.stringify(windowLines().slice(from))}`)
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const dragged = geometryLines(windowLines().slice(from))
  const pk = /^set vid_geometry (\d+x\d+)\+(-?\d+)\+(-?\d+)$/.exec(dragged[0] ?? '')
  const parkY = pk ? Number(pk[3]) : Number.NaN
  const yLo = Math.min(launched.y, launched.y + STEPS * STEP_PX * scale) - 1
  const yHi = Math.max(launched.y, launched.y + STEPS * STEP_PX * scale) + 1
  if (
    dragged.length !== 2 ||
    !pk ||
    pk[1] !== size ||
    Number(pk[2]) !== edge + PARK_MARGIN_PX ||
    !(parkY >= yLo && parkY <= yHi)
  ) {
    fail(
      `drag: expected exactly [${parked} (Y within the drag), <placed>], got ${JSON.stringify(dragged)}`,
    )
  }
  const m = /^set vid_geometry (\d+x\d+)\+(-?\d+)\+(-?\d+)$/.exec(dragged[1])
  const wantX = launched.x + STEPS * STEP_PX * scale
  const wantY = launched.y + STEPS * STEP_PX * scale
  if (
    !m ||
    m[1] !== size ||
    Math.abs(Number(m[3]) - wantY) > 1 ||
    Math.abs(Number(m[2]) - wantX) > 1
  ) {
    fail(
      `drag: the placed line ${JSON.stringify(dragged[1])} is not ${size}+${wantX}+${wantY} (launch moved by the delta)`,
    )
  }
  const placed = dragged[1]
  // After the drag the stage sits at the placed Y, so minimize parks at that Y.
  const parkedAfter = `set vid_geometry ${size}+${edge + PARK_MARGIN_PX}+${m[3]}`

  step('AC2: minimize parks the game, restore places it back')
  from = windowLines().length
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  await expectNewLines(from, [parkedAfter], 'minimize')
  from = windowLines().length
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
  // Restoring the offscreen harness window can re-associate it with another display (another DPI):
  // the game is then re-parked at the new size before it is placed - never placed anywhere else.
  const restoreBy = Date.now() + ENGINE_TIMEOUT_MS
  const isPark = (l) => {
    const g = /^set vid_geometry \d+x\d+\+(-?\d+)\+(-?\d+)$/.exec(l)
    return (
      g !== null &&
      Number(g[1]) === edge + PARK_MARGIN_PX &&
      Math.abs(Number(g[2]) - Number(m[3])) <= 1
    )
  }
  while (!geometryLines(windowLines().slice(from)).some((l) => !isPark(l))) {
    if (Date.now() >= restoreBy)
      fail(
        `restore: window log got ${JSON.stringify(windowLines().slice(from))}, expected a placed line`,
      )
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const restored = windowLines().slice(from)
  const wantPlaced = await placedNow(page, app)
  if (restored[restored.length - 1] !== wantPlaced || !restored.slice(0, -1).every(isPark)) {
    fail(
      `restore: expected park lines then exactly one ${wantPlaced}, got ${JSON.stringify(restored)} (placed before minimize: ${placed})`,
    )
  }

  step('AC3: blur drops the game from topmost, focus puts it back')
  // The harness window is never really focused, so focus is established first.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('focus'))
  await sleep(SETTLE_MS)
  const tops = windowLines().filter((l) => l.startsWith('set win_alwaysontop '))
  if (tops.length > 0 && tops[tops.length - 1] !== 'set win_alwaysontop 1') {
    fail(`after focus the game must be topmost, window log has ${JSON.stringify(tops)}`)
  }
  from = windowLines().length
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('blur'))
  await expectNewLines(from, ['set win_alwaysontop 0'], 'blur')
  from = windowLines().length
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('focus'))
  await expectNewLines(from, ['set win_alwaysontop 1'], 'focus')
  await shot('stage-follow-after')

  step('the game exits and the stage is gone')
  writeFileSync(files.quitFile, '')
  await picture.waitFor({ state: 'hidden', timeout: 15_000 })
}
