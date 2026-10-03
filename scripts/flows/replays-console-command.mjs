// Story 166 D4: e2e proof that the Demos view's console field sends a typed line to the running
// demo through story 164's playback channel. Same seam as `replays-timeline.mjs`: the fixture's stub
// engine (`scripts/lib/stub-engine.cjs`) executes what the channel delivers and records each command
// in `Q2L_UI_ENGINE_COMMAND_LOG`; assertions read that log, not the UI's local state.
//
// Selectors: `replays-demo-row`, `actionbar-play[data-action="view"]` (story 159), `replays-timeline`,
// `replays-console-{field,input,send,reason}` (`ConsoleCommandField.tsx`).
import { writeFileSync } from 'node:fs'
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
const ENGINE_TIMEOUT_MS = 5_000
/** Long enough that a seq guard failing would have re-run a command several loop ticks over. */
const SETTLE_MS = 700

const files = replaysTimelineEngineFiles()

export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: { Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog, Q2L_UI_ENGINE_QUIT_FILE: files.quitFile },
  }
}

async function expectCommands(expected, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (commands(files.commandLog).length < expected.length) {
    if (Date.now() >= deadline) {
      throw new Error(
        `replays-console-command: ${label}: engine ran ${JSON.stringify(commands(files.commandLog))}, expected ${JSON.stringify(expected)}`,
      )
    }
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const ran = commands(files.commandLog)
  if (JSON.stringify(ran) !== JSON.stringify(expected)) {
    throw new Error(
      `replays-console-command: ${label}: engine ran ${JSON.stringify(ran)}, expected exactly ${JSON.stringify(expected)}`,
    )
  }
}

export default async function replaysConsoleCommand({ page, step, shot }) {
  const input = page.getByTestId('replays-console-input')
  const reason = page.getByTestId('replays-console-reason')

  step('with no demo playing there is no console field and no no-session text')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  if ((await page.getByTestId('replays-console-field').count()) !== 0) {
    throw new Error('replays-console-command: there must be no console field without a session')
  }
  if ((await page.getByText('no demo is playing').count()) !== 0) {
    throw new Error('replays-console-command: the no-session reason must not be rendered')
  }
  await shot('console-no-session')

  step('start playback against the stubbed engine')
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_CTF_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })
  await input.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await input.isDisabled())
    throw new Error('replays-console-command: the field must be enabled while a demo plays')

  step('a typed line is executed once by the engine and the field clears')
  await input.focus()
  await page.keyboard.type('fov 110')
  await page.keyboard.press('Enter')
  await expectCommands(['fov 110'], 'fov 110')
  if ((await input.inputValue()) !== '')
    throw new Error('replays-console-command: the field must clear after a send')
  await shot('console-sent')

  step('a line with a non-ASCII character is refused with a visible reason and nothing is sent')
  await input.focus()
  await page.keyboard.type('say héllo')
  await page.keyboard.press('Enter')
  await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectCommands(['fov 110'], 'non-ASCII line')
  if ((await input.inputValue()) === '')
    throw new Error('replays-console-command: a refused line must stay in the field')
  await shot('console-refused')

  step('the game exits')
  writeFileSync(files.quitFile, '')
  await page.getByTestId('replays-timeline').waitFor({ state: 'detached', timeout: 10_000 })
  await page.getByTestId('replays-console-field').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
}
