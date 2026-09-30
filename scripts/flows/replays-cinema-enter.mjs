// Story 187 D6: e2e proof that the launcher's mode switch enters cinema. The three labeled options are
// visible and aria-checked follows the mode; choosing Cinema opens the transparent overlay window
// (cinema.html), pins the game to the primary display's physical rect with exactly one
// `set vid_geometry` and no `win_alwaysontop`, without restarting the demo; quitting the game while in
// cinema closes the overlay and the launcher shows the ended state (no timeline). Assertions on the
// engine stub's window log (`Q2L_UI_ENGINE_WINDOW_LOG`) and main.log's launching lines.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysStageFollowEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { waitForWindow } from '../lib/harness.mjs'

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
      Q2L_UI_CINEMA_DISPLAY: 'primary',
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (message) => {
  throw new Error(`replays-cinema-enter: ${message}`)
}

function windowLines() {
  if (!existsSync(files.windowLog)) return []
  return readFileSync(files.windowLog, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
}

const launchCount = (logPath) =>
  existsSync(logPath) ? readFileSync(logPath, 'utf8').split(/\r?\n/).filter((l) => l.includes('launching')).length : 0

async function waitForScan(page) {
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (await refresh.isDisabled()) {
    if (Date.now() >= deadline) fail('timed out waiting for the demo scan to finish')
    await sleep(100)
  }
}

const cinemaWindows = (app) => app.windows().filter((w) => w.url().includes('cinema.html'))

export default async function replaysCinemaEnter({ page, app, log, step, shot }) {
  step('a demo plays on the stage and the mode switch offers Preview, Cinema and Fullscreen')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  await page.getByTestId('replays-demo-row').filter({ hasText: REPLAYS_PLAY_CTF_DEMO }).first().click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })
  const input = page.getByTestId('replays-console-input')
  const liveBy = Date.now() + 15_000
  while (await input.isDisabled()) {
    if (Date.now() >= liveBy) fail('the playback session never went live')
    await sleep(100)
  }
  const preview = page.getByTestId('replays-timeline-mode-preview')
  const cinema = page.getByTestId('replays-timeline-mode-cinema')
  const fullscreen = page.getByTestId('replays-timeline-fullscreen')
  const labels = await Promise.all([preview, cinema, fullscreen].map(async (l) => ((await l.textContent()) ?? '').trim()))
  if (labels.join('|') !== 'Preview|Cinema|Fullscreen') fail(`the mode labels read ${JSON.stringify(labels)}`)
  const checked = async () =>
    (await Promise.all([preview, cinema, fullscreen].map((l) => l.getAttribute('aria-checked')))).join(',')
  if ((await checked()) !== 'true,false,false') fail(`aria-checked before cinema is ${await checked()}`)
  await sleep(SETTLE_MS)
  if (windowLines().length > 0) fail(`an unmoved launcher must not re-place the game: ${JSON.stringify(windowLines())}`)
  const launches = launchCount(logPath)
  await shot('cinema-mode-switch')

  step('Cinema opens the overlay and pins the game to the primary display')
  const want = await app.evaluate(({ screen }) => {
    const p = screen.getPrimaryDisplay()
    const r =
      typeof screen.dipToScreenRect === 'function'
        ? screen.dipToScreenRect(null, p.bounds)
        : {
            x: p.bounds.x * p.scaleFactor,
            y: p.bounds.y * p.scaleFactor,
            width: p.bounds.width * p.scaleFactor,
            height: p.bounds.height * p.scaleFactor,
          }
    return `set vid_geometry ${Math.round(r.width)}x${Math.round(r.height)}+${Math.round(r.x)}+${Math.round(r.y)}`
  })
  await cinema.click({ timeout: TIMEOUT_MS })
  await waitForWindow(app, 'cinema.html', log)
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (windowLines().filter((l) => l.startsWith('set vid_geometry ')).length < 1) {
    if (Date.now() >= deadline) fail(`window log got ${JSON.stringify(windowLines())}`)
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const lines = windowLines()
  const geometry = lines.filter((l) => l.startsWith('set vid_geometry '))
  if (geometry.length !== 1 || geometry[0] !== want) fail(`expected exactly [${want}], got ${JSON.stringify(lines)}`)
  if (lines.some((l) => l.includes('win_alwaysontop'))) fail(`cinema must not send win_alwaysontop: ${JSON.stringify(lines)}`)
  if (launchCount(logPath) !== launches) fail('entering cinema restarted the demo')
  const movedBy = Date.now() + TIMEOUT_MS
  while ((await checked()) !== 'false,true,false') {
    if (Date.now() >= movedBy) fail(`aria-checked never moved to Cinema (now ${await checked()})`)
    await sleep(100)
  }
  await shot('cinema-entered')

  step('the game quits while in cinema: the overlay closes and the launcher shows the ended state')
  writeFileSync(files.quitFile, '')
  const closedBy = Date.now() + 15_000
  while (cinemaWindows(app).length > 0) {
    if (Date.now() >= closedBy) fail('the cinema overlay stayed open after the game quit')
    await sleep(100)
  }
  await page.getByTestId('replays-timeline').waitFor({ state: 'detached', timeout: 15_000 })
  if (log.pageErrors.length > 0) fail(`page errors: ${JSON.stringify(log.pageErrors)}`)
}
