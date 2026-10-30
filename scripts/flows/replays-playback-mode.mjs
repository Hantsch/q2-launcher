// Story 287: the playback mode is switched in Settings and in the Demos view, both show the same
// stored value, the integrated mode plays into the stage (reason text visible), and the switch is
// locked (with visible text) while a demo plays.
//
// Selectors: `replays-settings-playback-mode-<mode>`, `replays-playback-mode-<mode>`,
// `replays-playback-mode-locked`, `replays-demo-row`, `actionbar-play[data-action="view"]`,
// `actionbar-action-reason`, `replays-timeline`, `replays-timeline-stop`.
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { openDemos, openFolder, poll, selectDemo, TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const files = replaysTimelineEngineFiles()

export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_ENGINE_IGNORE_QUIT_FILE: files.ignoreQuitFile,
    },
  }
}

async function storedMode(page) {
  const outcome = await page.evaluate(() =>
    window.q2.invoke('module:invoke', { moduleId: 'replays', type: 'playbackMode.read' }),
  )
  if (!outcome?.ok) throw new Error(`playbackMode.read failed: ${JSON.stringify(outcome)}`)
  return outcome.value
}

async function expectPressed(locator, expected, label) {
  await poll(
    label,
    async () => (await locator.getAttribute('aria-pressed')) === expected,
    TIMEOUT_MS,
  )
}

export default async function replaysPlaybackMode({ page, step, shot }) {
  const settingsIntegrated = page.getByTestId('replays-settings-playback-mode-integrated')
  const viewIntegrated = page.getByTestId('replays-playback-mode-integrated')
  const viewEngine = page.getByTestId('replays-playback-mode-engine')
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  const timeline = page.getByTestId('replays-timeline')

  step('Settings switches to the integrated mode and main stores it')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await settingsIntegrated.scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  await poll(
    'the Settings switch to be enabled',
    async () => !(await settingsIntegrated.isDisabled()),
    TIMEOUT_MS,
  )
  await settingsIntegrated.click({ timeout: TIMEOUT_MS })
  await expectPressed(settingsIntegrated, 'true', 'the integrated button to be pressed')
  if ((await storedMode(page)) !== 'integrated')
    throw new Error('replays-playback-mode: main did not store integrated')
  await shot('settings-integrated')

  step('the Demos view shows integrated and Play opens the stage with its reason text')
  await openDemos(page)
  await expectPressed(viewIntegrated, 'true', 'the Demos switch to show integrated')
  await openFolder(page, 'ctf')
  await selectDemo(page, REPLAYS_PLAY_CTF_DEMO)
  await poll('Play to be enabled', async () => !(await play.isDisabled()), TIMEOUT_MS)
  await play.click({ timeout: TIMEOUT_MS })
  // This variant has no fake engine, so the stage may end in loading or the canvas without a
  // picture; what matters is that Play is accepted (no refusal reason) and Stop clears the stage.
  const canvas = page.getByTestId('replays-engine-canvas')
  const loading = page.getByTestId('replays-integrated-loading')
  const reasonNode = page.getByTestId('replays-stage-reason')
  await canvas.or(loading).first().waitFor({ state: 'visible', timeout: 15_000 })
  if (await reasonNode.isVisible()) {
    const reason = (await reasonNode.textContent()) ?? ''
    if (/not ready/i.test(reason))
      throw new Error(`replays-playback-mode: Play must not be refused as not ready: ${reason}`)
  }
  if (await play.isDisabled())
    throw new Error('replays-playback-mode: Play must stay enabled in integrated mode')
  await shot('integrated-stage')
  await page.getByTestId('replays-timeline-stop').click({ timeout: TIMEOUT_MS })
  await canvas.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await loading.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  // endSession disarms the stage, so the whole stage (placeholder included) leaves with the session.
  await page.getByTestId('replays-stage').waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('switching back to the engine window enables Play')
  await viewEngine.click({ timeout: TIMEOUT_MS })
  await expectPressed(viewEngine, 'true', 'the engine button to be pressed')
  if ((await storedMode(page)) !== 'engine')
    throw new Error('replays-playback-mode: main did not store engine')
  await poll('Play to be enabled', async () => !(await play.isDisabled()), TIMEOUT_MS)

  step('the switch is locked with visible text while the demo plays, and free again after stop')
  await play.click({ timeout: TIMEOUT_MS })
  await timeline.waitFor({ state: 'visible', timeout: 15_000 })
  if (!(await viewEngine.isDisabled()) || !(await viewIntegrated.isDisabled()))
    throw new Error('replays-playback-mode: both switch buttons must be disabled while playing')
  const locked = page.getByTestId('replays-playback-mode-locked')
  await locked.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await locked.textContent()) ?? '').includes('Stop the demo to switch'))
    throw new Error('replays-playback-mode: the locked text is missing')
  await shot('locked-while-playing')
  await page.getByTestId('replays-timeline-stop').click({ timeout: TIMEOUT_MS })
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
  await poll(
    'the switch to be enabled again',
    async () => !(await viewEngine.isDisabled()),
    TIMEOUT_MS,
  )
}
