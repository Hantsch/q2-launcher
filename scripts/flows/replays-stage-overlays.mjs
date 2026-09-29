// Story 171 D4: e2e proof that an overlay over the stage parks the game and closing it places it again:
// a Modal-backed dialog (add existing installation, opened from the rail) and the timeline's native speed select (mousedown -> change). Assertions are on the
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
  throw new Error(`replays-stage-overlays: ${message}`)
}

function windowLines() {
  if (!existsSync(files.windowLog)) return []
  return readFileSync(files.windowLog, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
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

export default async function replaysStageOverlays({ page, app, step, shot }) {
  step('a demo plays on the stage')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
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
  await sleep(SETTLE_MS)
  if (windowLines().length > 0) fail(`an unmoved launcher must not re-place the game: ${JSON.stringify(windowLines())}`)

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
  const isPark = (l) => Number(/^set vid_geometry \d+x\d+\+(-?\d+)\+-?\d+$/.exec(l ?? '')?.[1]) === parkX

  step('a dialog over the stage parks the game, closing it places it again')
  let from = windowLines().length
  // The list and its detail panel are hidden while the stage shows, so the dialog comes from the
  // shell's rail (same Modal primitive): Add an installation -> Add existing installation.
  await page.getByRole('button', { name: 'Add an installation' }).click({ timeout: TIMEOUT_MS })
  await page.getByRole('menuitem', { name: /Add existing installation/ }).click({ timeout: TIMEOUT_MS })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  let lines = await newGeometry(from, 1, 'dialog open')
  if (lines.length !== 1 || !isPark(lines[0])) fail(`dialog open: expected exactly one park line (x=${parkX}), got ${JSON.stringify(lines)}`)
  await shot('stage-overlays-dialog')
  from = windowLines().length
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  lines = await newGeometry(from, 1, 'dialog close')
  let want = await placedNow(page, app)
  if (lines.length !== 1 || lines[0] !== want) fail(`dialog close: expected exactly [${want}], got ${JSON.stringify(lines)}`)

  step('the speed select parks the game from mousedown until change')
  const speed = page.getByTestId('replays-timeline-speed')
  from = windowLines().length
  await speed.dispatchEvent('mousedown')
  lines = await newGeometry(from, 1, 'speed open')
  if (lines.length !== 1 || !isPark(lines[0])) fail(`speed open: expected exactly one park line (x=${parkX}), got ${JSON.stringify(lines)}`)
  from = windowLines().length
  await speed.selectOption('2')
  lines = await newGeometry(from, 1, 'speed change')
  want = await placedNow(page, app)
  if (lines.length !== 1 || lines[0] !== want) fail(`speed change: expected exactly [${want}], got ${JSON.stringify(lines)}`)
  await shot('stage-overlays-placed')

  step('the game exits and the stage is gone')
  writeFileSync(files.quitFile, '')
  await picture.waitFor({ state: 'hidden', timeout: 15_000 })
}
