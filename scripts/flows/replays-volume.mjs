// Proves the timeline strip's volume slider and mute button steer the playing engine's `s_volume`,
// and that the user's own archived `s_volume` survives the session (story 237). The engine is
// the fixture's stub (`scripts/lib/stub-engine.cjs`): its command log records every `s_volume N` it
// ran, and with `Q2L_UI_ENGINE_ARCHIVE_CVARS=s_volume` it archives its value into `q2config.cfg` on
// exit, as Q2PRO does.
//
// Selectors: `replays-timeline-volume-{toggle,label}`, `replays-timeline-volume` (`VolumeControl.tsx`).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { sleep } from '../lib/flow-common.mjs'
import { variantUserDataDir } from '../lib/harness.mjs'
import { commands, openDemos, openFolder, poll } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
const ENGINE_TIMEOUT_MS = 5_000
const SETTLE_MS = 700
const USER_VOLUME = '0.5'

const files = replaysTimelineEngineFiles()
let configFile = ''

export async function setup() {
  const fixture = writeReplaysTimelineFixture()
  // The demo plays in the fixture's ctf game dir (Windows: the game dir; Linux: Q2PRO's write dir,
  // which the harness redirects into the variant's userData).
  configFile =
    process.platform === 'win32'
      ? join(fixture.installRoot, 'ctf', 'q2config.cfg')
      : join(variantUserDataDir(variant), 'harness-home', '.q2pro', 'ctf', 'q2config.cfg')
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, `seta s_volume "${USER_VOLUME}"\n`)
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_ENGINE_CONFIG_FILE: configFile,
      Q2L_UI_ENGINE_ARCHIVE_CVARS: 's_volume',
    },
  }
}

const volumeLines = () => commands(files.commandLog).filter((l) => /^s_volume /.test(l))

/** Waits until the engine's last `s_volume` is `expected`, then lets a stray extra command show up. */
async function expectVolume(expected, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (volumeLines().at(-1) !== `s_volume ${expected}`) {
    if (Date.now() >= deadline) {
      throw new Error(
        `replays-volume: ${label}: engine ran ${JSON.stringify(volumeLines())}, expected last s_volume ${expected}`,
      )
    }
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const ran = volumeLines()
  if (ran.at(-1) !== `s_volume ${expected}`)
    throw new Error(`replays-volume: ${label}: engine ended on ${ran.at(-1)}, expected ${expected}`)
  return ran
}

async function expectText(locator, expected, label) {
  const text = ((await locator.textContent()) ?? '').trim()
  if (!text.includes(expected))
    throw new Error(`replays-volume: ${label}: shows ${JSON.stringify(text)}, expected ${expected}`)
}

/** A range input is not fillable: set it the way a drag does, through the native setter and an input event. */
async function setSlider(slider, value) {
  await slider.evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, String(value))
}

async function playCtfDemo(page, timeline) {
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

export default async function replaysVolume({ page, step, shot }) {
  const timeline = page.getByTestId('replays-timeline')
  const toggle = page.getByTestId('replays-timeline-volume-toggle')
  const slider = page.getByTestId('replays-timeline-volume')
  const label = page.getByTestId('replays-timeline-volume-label')

  step('the strip shows a mute button and a slider at the volume the user already had')
  await openDemos(page)
  await openFolder(page, 'ctf')
  await playCtfDemo(page, timeline)
  await toggle.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await slider.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await slider.inputValue()) !== '50')
    throw new Error(`replays-volume: slider starts at ${await slider.inputValue()}, expected 50`)
  await expectText(label, '50', 'initial label')
  await shot('volume-initial')

  step('moving the slider sets the playing engine volume')
  await setSlider(slider, 30)
  await expectVolume('0.3', 'slider to 30')
  await expectText(label, '30', 'label after slider')
  await shot('volume-30')

  step('a fast burst of slider moves ends on the last value with fewer commands')
  const before = volumeLines().length
  const burst = [80, 75, 70, 65, 60, 55, 50, 45, 40, 30]
  for (const value of burst) await setSlider(slider, value)
  await expectVolume('0.3', 'burst')
  const sent = volumeLines().length - before
  if (sent >= burst.length)
    throw new Error(`replays-volume: burst of ${burst.length} sent ${sent} s_volume commands`)

  step('mute silences the engine and says so; unmute brings the level back')
  await toggle.click({ timeout: TIMEOUT_MS })
  await expectVolume('0', 'mute')
  await expectText(label, 'Muted', 'muted label')
  if ((await toggle.getAttribute('aria-pressed')) !== 'true')
    throw new Error('replays-volume: the mute button does not report being pressed')
  await shot('volume-muted')
  await toggle.click({ timeout: TIMEOUT_MS })
  await expectVolume('0.3', 'unmute')
  await expectText(label, '30', 'label after unmute')

  step('the keyboard steers the slider and the mute button')
  await slider.focus()
  await page.keyboard.press('ArrowUp')
  await expectVolume('0.35', 'slider ArrowUp')
  await toggle.focus()
  await page.keyboard.press('Space')
  await expectVolume('0', 'mute by Space')
  await page.keyboard.press('Space')
  await expectVolume('0.35', 'unmute by Space')

  step("after the game exits the user's own volume is back in their config")
  writeFileSync(files.quitFile, '')
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
  await poll(
    `q2config.cfg reading seta s_volume "${USER_VOLUME}" again`,
    () => readFileSync(configFile, 'latin1').includes(`seta s_volume "${USER_VOLUME}"`),
    10_000,
  )

  step('the next play starts at the volume I left')
  rmSync(files.quitFile, { force: true })
  await playCtfDemo(page, timeline)
  await slider.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await slider.inputValue()) !== '35')
    throw new Error(`replays-volume: slider restarts at ${await slider.inputValue()}, expected 35`)
  await shot('volume-remembered')
  writeFileSync(files.quitFile, '')
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
}
