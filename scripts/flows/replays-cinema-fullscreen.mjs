// Story 187 D7: e2e proof of fullscreen from the cinema overlay. F in the overlay sends `vid_fullscreen 1`
// and the overlay closes; the game's own "Back to window" key (simulated through the stub's keys file)
// returns the stage: the stub gets the stage geometry again and the launcher's mode switch reads Preview.
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

const files = replaysStageFollowEngineFiles()

export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_ENGINE_KEYS_FILE: files.keysFile,
      Q2L_UI_ENGINE_WINDOW_LOG: files.windowLog,
      Q2L_UI_CINEMA_DISPLAY: 'primary',
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (message) => {
  throw new Error(`replays-cinema-fullscreen: ${message}`)
}
const lines = (path) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.length > 0)
    : []
const commands = () => lines(files.commandLog)
const geometry = () => lines(files.windowLog).filter((l) => l.startsWith('set vid_geometry '))
const cinemaWindows = (app) => app.windows().filter((w) => w.url().includes('cinema.html'))

async function until(predicate, label, timeoutMs = ENGINE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) fail(`timed out: ${label}`)
    await sleep(50)
  }
}

async function waitForScan(page) {
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await until(async () => !(await refresh.isDisabled()), 'the demo scan to finish', TIMEOUT_MS)
}

/** The stage geometry the game was launched with (`+set vid_geometry` on the main.log launching line). */
async function launchGeometry(page) {
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  const deadline = Date.now() + 10_000
  for (;;) {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    const line = content.split(/\r?\n/).filter((l) => l.includes('launching')).pop()
    const m = line ? /\+set vid_geometry (\d+x\d+\+-?\d+\+-?\d+)/.exec(line) : null
    if (m) return m[1]
    if (Date.now() >= deadline) fail(`main.log has no launching line with a vid_geometry: ${JSON.stringify(line)}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

export default async function replaysCinemaFullscreen({ page, app, log, step, shot }) {
  step('a demo plays in cinema')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  await page.getByTestId('replays-demo-row').filter({ hasText: REPLAYS_PLAY_CTF_DEMO }).first().click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })
  const input = page.getByTestId('replays-console-input')
  await until(async () => !(await input.isDisabled()), 'the playback session going live', 15_000)
  // The stage geometry the stub was last given before cinema pinned the display rect (AC7 compares it).
  const stageGeometry = await launchGeometry(page)
  await page.getByTestId('replays-timeline-mode-cinema').click({ timeout: TIMEOUT_MS })
  const overlay = await waitForWindow(app, 'cinema.html', log)
  const root = overlay.getByTestId('cinema-root')
  await root.waitFor({ state: 'attached', timeout: TIMEOUT_MS })
  await until(() => geometry().length >= 1, 'the cinema geometry')
  const geometryBefore = geometry().length

  step('F in the overlay goes fullscreen and the overlay closes')
  await root.focus()
  // The window closes under the key press; the closing is what is asserted below.
  await overlay.keyboard.press('KeyF').catch(() => {})
  await until(() => commands().includes('vid_fullscreen 1'), 'vid_fullscreen 1 in the command log')
  await until(() => cinemaWindows(app).length === 0, 'the overlay to close', 10_000)
  await shot('cinema-fullscreen')

  step('back to window returns the stage and the mode reads Preview')
  // As in replays-fullscreen: let the fullscreen loop arm its position before a key press lands.
  await sleep(1_000)
  writeFileSync(files.keysFile, 'exec q2l_back.cfg\n')
  await until(() => commands().includes('vid_fullscreen 0'), 'vid_fullscreen 0 in the command log')
  await until(() => geometry().length > geometryBefore, 'the stage geometry after the way back', 10_000)
  if (geometry().at(-1)?.slice('set vid_geometry '.length) !== stageGeometry) {
    fail(`the newest geometry after the way back is ${geometry().at(-1)}, expected the stage geometry ${stageGeometry}`)
  }
  const preview = page.getByTestId('replays-timeline-mode-preview')
  await until(async () => (await preview.getAttribute('aria-checked')) === 'true', 'Preview to be checked', 10_000)
  if (log.pageErrors.length > 0) fail(`page errors: ${JSON.stringify(log.pageErrors)}`)
}
