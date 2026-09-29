// Story 172 D7: e2e proof of the timeline's fullscreen switch and the way back, against the fixture's
// stub engine (`scripts/lib/stub-engine.cjs`, a real child process speaking story 164's transport).
//
// Fullscreen stops the launcher's control loop (the loop alias is redefined to only arm
// `q2l_armpos`), so key presses that were already queued behind it must not run: every demo action is
// guarded (`if x$cl_demopos ne x$q2l_armpos then <cmd>`, see `src/shared/replays/demo-guard.ts` - the
// strings below are hard-coded on purpose, this flow imports nothing from `src`). The stub's
// `Q2L_UI_ENGINE_KEYS_FILE` is the key lever: its lines are appended to the console buffer like bind
// presses. While the launcher's loop runs, those lines sit in the console buffer behind it (the loop
// re-inserts itself in front of them, as in the real engine); fullscreen replaces the loop by the
// arming alias, so they run in the very frame that armed the position - deterministically "starved".
//
// Selectors: `replays-timeline-{toggle,back,forward,seek,fullscreen,keys}` (`DemoTimeline.tsx`).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
const ENGINE_TIMEOUT_MS = 5_000
/** Long enough for a starved command to have run several frames over, and for the 0.1 s position to tick. */
const SETTLE_MS = 700

const files = replaysTimelineEngineFiles()

export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_ENGINE_KEYS_FILE: files.keysFile,
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** `guardDemoCommand` in `src/shared/replays/demo-guard.ts`, spelled out. */
const guarded = (command) => `if x$cl_demopos ne x$q2l_armpos then ${command}`
/** `BACK_TO_WINDOW_COMMAND` in the same file. */
const BACK = 'exec q2l_back.cfg'

function commands() {
  if (!existsSync(files.commandLog)) return []
  return readFileSync(files.commandLog, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
}

const count = (command) => commands().filter((c) => c === command).length

function press(...lines) {
  writeFileSync(files.keysFile, `${lines.join('\n')}\n`)
}

async function waitForCount(command, n, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (count(command) < n) {
    if (Date.now() >= deadline) {
      throw new Error(`replays-fullscreen: ${label}: engine ran ${JSON.stringify(commands())}, expected ${n} x ${command}`)
    }
    await sleep(50)
  }
}

async function positionS(page) {
  return Number(await page.getByTestId('replays-timeline-seek').getAttribute('aria-valuenow'))
}

async function waitForPosition(page, predicate, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  let seen = await positionS(page)
  while (!predicate(seen)) {
    if (Date.now() >= deadline) throw new Error(`replays-fullscreen: ${label}: position stuck at ${seen} s`)
    await sleep(100)
    seen = await positionS(page)
  }
  return seen
}

async function waitForScan(page) {
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (await refresh.isDisabled()) {
    if (Date.now() >= deadline) throw new Error('replays-fullscreen: timed out waiting for the demo scan to finish')
    await sleep(100)
  }
}

export default async function replaysFullscreen({ page, step, shot }) {
  const timeline = page.getByTestId('replays-timeline')
  const keys = page.getByTestId('replays-timeline-keys')
  const fullscreenButton = page.getByTestId('replays-timeline-fullscreen')
  const controls = ['toggle', 'back', 'forward', 'fullscreen'].map((id) => page.getByTestId(`replays-timeline-${id}`))

  step('start the demo')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  await page.getByTestId('replays-demo-row').filter({ hasText: REPLAYS_PLAY_CTF_DEMO }).first().click({ timeout: TIMEOUT_MS })
  const play = page.getByTestId('replays-demo-play')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await timeline.waitFor({ state: 'visible', timeout: 15_000 })
  await waitForPosition(page, (s) => s >= 2, 'the engine clock reaching 2 s')
  if (await keys.isVisible()) throw new Error('replays-fullscreen: the keys hint must not show in the window')

  step('fullscreen: queued guarded presses starve, the controls lock and the keys hint shows')
  press(guarded('seek +60'))
  await sleep(SETTLE_MS)
  if (count('seek +60') !== 0) throw new Error('replays-fullscreen: the press ran behind the control loop')
  await fullscreenButton.click({ timeout: TIMEOUT_MS })
  await waitForCount('vid_fullscreen 1', 1, 'entering fullscreen')
  await keys.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  for (const control of controls) {
    if (!(await control.isDisabled())) throw new Error('replays-fullscreen: a timeline control stays enabled in fullscreen')
  }
  await sleep(SETTLE_MS)
  if (count('seek +60') !== 0) throw new Error(`replays-fullscreen: a starved press ran: ${JSON.stringify(commands())}`)
  await shot('fullscreen-keys')

  step('a guarded press runs once the position moved (wait, press)')
  await sleep(SETTLE_MS)
  press(guarded('seek +10'))
  await waitForCount('seek +10', 1, 'guarded seek +10')
  if (count('seek +60') !== 0) throw new Error(`replays-fullscreen: the starved press ran late: ${JSON.stringify(commands())}`)

  step('Back to window leaves fullscreen and hands the loop back to the launcher')
  const before = await positionS(page)
  press(BACK)
  await waitForCount('vid_fullscreen 0', 1, 'Back to window')
  await keys.waitFor({ state: 'detached', timeout: 10_000 })
  await waitForPosition(page, (s) => s > before, 'the position advancing after the way back')
  for (const control of controls) {
    await control.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    if (await control.isDisabled()) throw new Error('replays-fullscreen: a timeline control stays disabled after the way back')
  }
  await page.getByTestId('replays-timeline-forward').click({ timeout: TIMEOUT_MS })
  await waitForCount('seek +10', 2, 'a timeline jump after the way back')

  step('fullscreen again, then the game quits and the timeline returns to idle')
  await fullscreenButton.click({ timeout: TIMEOUT_MS })
  await waitForCount('vid_fullscreen 1', 2, 'entering fullscreen again')
  press('quit')
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
  await shot('fullscreen-gone')
}
