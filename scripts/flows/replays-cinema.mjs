// Story 187 D7: e2e proof of the cinema overlay's controls. In cinema the overlay (cinema.html) carries
// the launcher timeline's controls: the seek bar, play/pause, +-10/+-60 jumps and speed put the matching
// commands in the stub engine's command log; the controls hide after ~3 s idle, come back on mouse
// movement and stay while the demo is paused; the keys Space, Right, Shift+Right and . reach the log;
// Esc closes the overlay, the stub gets the stage geometry again and a launcher timeline click reaches
// the log (AC6). Keys are dispatched to the overlay page via Playwright: the harness overlay is non-focusable.
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysStageFollowEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { waitForWindow } from '../lib/harness.mjs'
import { makeFail, sleep } from '../lib/flow-common.mjs'
import { commands, launchGeometry, waitForScan, windowLines } from '../lib/replays-copy-in.mjs'

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
      Q2L_UI_ENGINE_WINDOW_LOG: files.windowLog,
      Q2L_UI_CINEMA_DISPLAY: 'primary',
    },
  }
}

const fail = makeFail('replays-cinema')
const geometry = () => windowLines(files.windowLog).filter((l) => l.startsWith('set vid_geometry '))
const cinemaWindows = (app) => app.windows().filter((w) => w.url().includes('cinema.html'))

/** Runs `act`, then waits until a command matching `expected` (string or regexp) was appended. */
async function expectAppended(act, expected, label) {
  const before = commands(files.commandLog).length
  await act()
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  for (;;) {
    const fresh = commands(files.commandLog).slice(before)
    const hit = fresh.find((c) => (expected instanceof RegExp ? expected.test(c) : c === expected))
    if (hit !== undefined) return hit
    if (Date.now() >= deadline)
      fail(
        `${label}: engine ran ${JSON.stringify(fresh)} (all: ${JSON.stringify(commands(files.commandLog))}), expected ${expected}`,
      )
    await sleep(50)
  }
}

async function waitAttr(locator, name, value, label, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs
  while ((await locator.getAttribute(name)) !== value) {
    if (Date.now() >= deadline)
      fail(`${label}: ${name} is ${await locator.getAttribute(name)}, expected ${value}`)
    await sleep(100)
  }
}

export default async function replaysCinema({ page, app, log, step, shot }) {
  step('a demo plays and Cinema opens the overlay')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_CTF_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
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
  // The stage geometry the stub was last given before cinema pinned the display rect (AC6 compares it).
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  const stageGeometry = (await launchGeometry(logPath, { fail })).raw
  await page.getByTestId('replays-timeline-cinema').click({ timeout: TIMEOUT_MS })
  const overlay = await waitForWindow(app, 'cinema.html', log)
  const root = overlay.getByTestId('cinema-root')
  await root.waitFor({ state: 'attached', timeout: TIMEOUT_MS })
  const seekBar = overlay.getByTestId('cinema-seek')
  await seekBar.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitAttr(seekBar, 'aria-valuemax', '41', 'the overlay never learned the demo length')
  const geometryBefore = geometry().length

  step('the overlay controls put the matching commands in the log')
  const bar = await seekBar.boundingBox()
  if (!bar) fail('the overlay seek bar has no box')
  const seek = await expectAppended(
    () => overlay.mouse.click(bar.x + bar.width * 0.25, bar.y + bar.height / 2),
    /^seek \d+$/,
    'seek bar click',
  )
  const target = Number(seek.split(' ')[1])
  if (Math.abs(target - Math.round(41 * 0.25)) > 2) fail(`a click at 25% sent ${seek}`)
  await expectAppended(
    () => overlay.getByTestId('cinema-forward').click({ timeout: TIMEOUT_MS }),
    'seek +10',
    'jump +10',
  )
  await expectAppended(
    () => overlay.getByTestId('cinema-back').click({ timeout: TIMEOUT_MS }),
    'seek -10',
    'jump -10',
  )
  await expectAppended(
    () => overlay.getByTestId('cinema-back60').click({ timeout: TIMEOUT_MS }),
    'seek -60',
    'jump -60',
  )
  await expectAppended(
    () => overlay.getByTestId('cinema-speed').selectOption('2', { timeout: TIMEOUT_MS }),
    'timescale 2',
    'speed 2',
  )
  await expectAppended(
    () => overlay.getByTestId('cinema-speed').selectOption('1', { timeout: TIMEOUT_MS }),
    'timescale 1',
    'speed 1',
  )
  await shot('cinema-controls')

  step('the controls hide when idle and come back on mouse movement')
  await overlay.mouse.move(5, 5)
  await sleep(3_500)
  await waitAttr(root, 'data-controls', 'hidden', 'idle fade', 2_000)
  await overlay.mouse.move(40, 40)
  await waitAttr(root, 'data-controls', 'visible', 'mouse move', 2_000)
  await sleep(3_500)
  await waitAttr(root, 'data-controls', 'hidden', 'idle fade again', 2_000)

  step('a paused demo keeps the controls up')
  await overlay.mouse.move(60, 60)
  await expectAppended(
    () => overlay.getByTestId('cinema-toggle').click({ timeout: TIMEOUT_MS }),
    'pause',
    'pause',
  )
  await overlay.mouse.move(5, 5)
  await sleep(3_500)
  await waitAttr(root, 'data-controls', 'visible', 'paused demo', 1_000)
  await shot('cinema-paused')

  // +60 overshoots the 41 s demo and a playing demo would end there; paused it only clamps. The seek bar
  // brings the position back afterwards.
  const back = () =>
    expectAppended(
      () => overlay.mouse.click(bar.x + bar.width * 0.25, bar.y + bar.height / 2),
      /^seek \d+$/,
      'seek back',
    )
  await expectAppended(
    () => overlay.getByTestId('cinema-forward60').click({ timeout: TIMEOUT_MS }),
    'seek +60',
    'jump +60',
  )
  await back()

  step('keys reach the log: Space, Right, Shift+Right and .')
  await root.focus()
  await expectAppended(() => overlay.keyboard.press('Shift+ArrowRight'), 'seek +60', 'Shift+Right')
  await back()
  await expectAppended(() => overlay.keyboard.press('ArrowRight'), 'seek +10', 'Right')
  await expectAppended(() => overlay.keyboard.press('Space'), 'pause', 'Space resumes')
  await expectAppended(() => overlay.keyboard.press('Period'), 'timescale 2', '. speeds up')

  step('Esc closes the overlay, the stage is back and the launcher timeline steers again (AC6)')
  // The window closes under the key press; the closing is what is asserted below.
  await overlay.keyboard.press('Escape').catch(() => {})
  const closedBy = Date.now() + 10_000
  while (cinemaWindows(app).length > 0) {
    if (Date.now() >= closedBy) fail('Esc did not close the overlay')
    await sleep(100)
  }
  const stageBy = Date.now() + ENGINE_TIMEOUT_MS
  while (geometry().length <= geometryBefore) {
    if (Date.now() >= stageBy)
      fail(
        `the stub never got the stage geometry again: ${JSON.stringify(windowLines(files.windowLog))}`,
      )
    await sleep(50)
  }
  if (geometry().at(-1)?.slice('set vid_geometry '.length) !== stageGeometry) {
    fail(
      `the newest geometry after leaving is ${geometry().at(-1)}, expected the stage geometry ${stageGeometry}`,
    )
  }
  await waitAttr(
    page.getByTestId('replays-timeline-cinema'),
    'data-mode',
    'preview',
    'mode after leaving',
    6_000,
  )
  await expectAppended(
    () => page.getByTestId('replays-timeline-forward').click({ timeout: TIMEOUT_MS }),
    'seek +10',
    'launcher jump',
  )
  if (log.pageErrors.length > 0) fail(`page errors: ${JSON.stringify(log.pageErrors)}`)
}
