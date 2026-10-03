// Story 173 D2: e2e proof that the timeline's stop button ends the demo through the real playback
// channel: `quit` reaches the stub engine (commands.log), and a game that ignores `quit` is
// terminated by main after its timeout. Afterwards the launcher's q2l_* control/log files are gone.
//
// Selectors: `replays-demo-row`, `actionbar-play[data-action="view"]`, `replays-timeline`, `replays-timeline-stop`.
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { sleep } from '../lib/flow-common.mjs'
import { commands, waitForScan } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
/** Main's terminate-after-quit timeout is 5 s. */
const TERMINATE_TIMEOUT_MS = 5_000
const MARGIN_MS = 6_000

const files = replaysTimelineEngineFiles()
let fixture = null

export async function setup() {
  fixture = writeReplaysTimelineFixture()
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_ENGINE_IGNORE_QUIT_FILE: files.ignoreQuitFile,
    },
  }
}

/** The launcher's leftover q2l_* control/log files in the Quake II game dir. */
function leftovers() {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name))
      else if (entry.name.startsWith('q2l_')) found.push(join(dir, entry.name))
    }
  }
  if (existsSync(fixture.installRoot)) walk(fixture.installRoot)
  return found
}

async function playDemo(page, timeline) {
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_CTF_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await timeline.waitFor({ state: 'visible', timeout: 15_000 })
}

/** Makes "gone" meaningful: while a demo plays, the launcher's q2l_* files must exist. */
async function expectFilesPresent(label) {
  const deadline = Date.now() + 3_000
  while (leftovers().length === 0) {
    if (Date.now() >= deadline)
      throw new Error(`replays-stop: ${label}: no q2l_* control/log file found in the install`)
    await sleep(100)
  }
}

async function expectFilesGone(label) {
  const deadline = Date.now() + 3_000
  while (leftovers().length > 0) {
    if (Date.now() >= deadline)
      throw new Error(
        `replays-stop: ${label}: q2l_* files left behind: ${JSON.stringify(leftovers())}`,
      )
    await sleep(100)
  }
}

export default async function replaysStop({ page, step, shot }) {
  const timeline = page.getByTestId('replays-timeline')
  const stop = page.getByTestId('replays-timeline-stop')

  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)

  step('the windowed stage says in-game typing does not reach the game')
  await playDemo(page, timeline)
  await page
    .getByTestId('replays-console-stage-hint')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await stop.click({ timeout: TIMEOUT_MS })
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
  await expectFilesGone('after the hint step')

  step('the stop button quits the game and the timeline returns to idle')
  await playDemo(page, timeline)
  await expectFilesPresent('while the demo plays')
  await stop.click({ timeout: TIMEOUT_MS })
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
  await page.getByTestId('replays-console-field').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  const ran = commands(files.commandLog)
  if (ran[ran.length - 1] !== 'quit')
    throw new Error(
      `replays-stop: engine's last command was ${JSON.stringify(ran[ran.length - 1])}, expected quit`,
    )
  await expectFilesGone('after quit')
  await shot('stop-idle')

  step('a game that ignores quit is ended after the timeout')
  writeFileSync(files.ignoreQuitFile, '')
  await playDemo(page, timeline)
  await expectFilesPresent('while the quit-ignoring demo plays')
  await stop.click({ timeout: TIMEOUT_MS })
  await stop.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await stop.isDisabled()))
    throw new Error('replays-stop: the stop button must be disabled while stopping')
  await shot('stop-stopping')
  await timeline.waitFor({ state: 'detached', timeout: TERMINATE_TIMEOUT_MS + MARGIN_MS })
  await expectFilesGone('after terminate')

  step("the action bar's Stop demo ends the demo")
  // The previous step left the ignore-quit marker behind; this game must quit normally.
  rmSync(files.ignoreQuitFile, { force: true })
  await playDemo(page, timeline)
  await page
    .getByTestId('actionbar-play')
    .filter({ hasText: 'Stop demo' })
    .click({ timeout: TIMEOUT_MS })
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
  await expectFilesGone('after the action bar stop')

  step('a finished demo hides the console field')
  rmSync(files.ignoreQuitFile, { force: true })
  await playDemo(page, timeline)
  const consoleInput = page.getByTestId('replays-console-input')
  await consoleInput.focus()
  await page.keyboard.type('seek 100%')
  await page.keyboard.press('Enter')
  await page
    .getByTestId('replays-timeline-state')
    .filter({ hasText: 'Finished' })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-console-field').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
  if (!(await timeline.isVisible()))
    throw new Error('replays-stop: the timeline must stay while the finished demo is shown')
  writeFileSync(files.quitFile, '')
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
  rmSync(files.quitFile, { force: true })
}
