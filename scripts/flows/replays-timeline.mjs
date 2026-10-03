// Story 165 D4: e2e proof that the Demos view's timeline strip steers a playing demo through story
// 164's real playback channel. The "engine" is the fixture's stub (`scripts/lib/stub-engine.cjs`):
// a real child process that speaks the platform's transport (Windows: polled control cfg + seq guard
// + logfile; Linux: stdin/stdout), keeps a simulated demo clock and records every command it
// actually executed in `Q2L_UI_ENGINE_COMMAND_LOG`. Assertions read that log - what the engine ran,
// exactly once - and the strip's own position/duration, never only the UI's local state. The game's
// exit is the stub seeing `Q2L_UI_ENGINE_QUIT_FILE` appear.
//
// Selectors: `replays-demo-row`, `actionbar-play[data-action="view"]` (story 159), `replays-timeline`,
// `replays-timeline-{toggle,back,forward,seek,speed,position,duration,seek-reason}` (`DemoTimeline.tsx`).
import { writeFileSync } from 'node:fs'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_PLAY_DEMO_MS,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { sleep } from '../lib/flow-common.mjs'
import { commands, waitForScan } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
/** Control cfg poll (~5 frames) + ACK + logfile tail (50 ms) + position push (250 ms), with headroom. */
const ENGINE_TIMEOUT_MS = 5_000
/** Long enough that a seq guard failing would have re-run a command several loop ticks over. */
const SETTLE_MS = 700

const files = replaysTimelineEngineFiles()

/** Flows never reseed their fixture, so this one writes its own and hands the stub its two files. */
export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: { Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog, Q2L_UI_ENGINE_QUIT_FILE: files.quitFile },
  }
}

/** Waits until the engine has executed exactly `count` commands, then checks none repeats. */
async function expectCommands(count, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (commands(files.commandLog).length < count) {
    if (Date.now() >= deadline) {
      throw new Error(
        `replays-timeline: ${label}: engine ran ${JSON.stringify(commands(files.commandLog))}, expected ${count}`,
      )
    }
    await sleep(50)
  }
  await sleep(SETTLE_MS)
  const ran = commands(files.commandLog)
  if (ran.length !== count) {
    throw new Error(
      `replays-timeline: ${label}: engine ran ${JSON.stringify(ran)} - expected exactly ${count}`,
    )
  }
  return ran
}

async function expectLast(count, expected, label) {
  const ran = await expectCommands(count, label)
  const last = ran[ran.length - 1]
  const ok = expected instanceof RegExp ? expected.test(last) : last === expected
  if (!ok)
    throw new Error(
      `replays-timeline: ${label}: engine's last command was ${JSON.stringify(last)}, expected ${expected}`,
    )
  return last
}

async function positionS(page) {
  return Number(await page.getByTestId('replays-timeline-seek').getAttribute('aria-valuenow'))
}

/** Waits for the strip's position (whole seconds) to satisfy `predicate`. */
async function waitForPosition(page, predicate, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  let seen = await positionS(page)
  while (!predicate(seen)) {
    if (Date.now() >= deadline)
      throw new Error(`replays-timeline: ${label}: position stuck at ${seen} s`)
    await sleep(100)
    seen = await positionS(page)
  }
  return seen
}

/** The focused element's testid, and whether it draws a visible focus outline. */
async function focusState(page) {
  return page.evaluate(() => {
    const el = document.activeElement
    const style = el ? getComputedStyle(el) : null
    return {
      testId: el?.getAttribute('data-testid') ?? null,
      visible: !!style && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1,
    }
  })
}

async function expectFocus(page, testId) {
  const state = await focusState(page)
  if (state.testId !== testId)
    throw new Error(`replays-timeline: focus is on ${state.testId}, expected ${testId}`)
  if (!state.visible)
    throw new Error(`replays-timeline: ${testId} has keyboard focus but no visible focus outline`)
}

export default async function replaysTimeline({ page, step, shot }) {
  const timeline = page.getByTestId('replays-timeline')
  const seekBar = page.getByTestId('replays-timeline-seek')
  const speed = page.getByTestId('replays-timeline-speed')
  let n = 0

  step('the timeline appears while a demo plays and disappears when the game exits')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  if (await timeline.isVisible())
    throw new Error('replays-timeline: the strip must not show before a demo plays')
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_CTF_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await timeline.waitFor({ state: 'visible', timeout: 15_000 })

  step('position advances and duration is shown')
  const durationS = Math.floor(REPLAYS_PLAY_DEMO_MS / 1000)
  if (Number(await seekBar.getAttribute('aria-valuemax')) !== durationS) {
    throw new Error(
      `replays-timeline: seek bar max ${await seekBar.getAttribute('aria-valuemax')}, expected ${durationS}`,
    )
  }
  if ((await seekBar.getAttribute('aria-disabled')) !== 'false')
    throw new Error('replays-timeline: seek bar must be enabled with a known duration')
  if (await page.getByTestId('replays-timeline-seek-reason').isVisible())
    throw new Error('replays-timeline: no seek reason with a known duration')
  const durationText = (await page.getByTestId('replays-timeline-duration').textContent()) ?? ''
  if (!durationText.includes(String(durationS)))
    throw new Error(`replays-timeline: duration shows ${JSON.stringify(durationText)}`)
  const firstPosText = await page.getByTestId('replays-timeline-position').textContent()
  await waitForPosition(page, (s) => s >= 2, 'the engine clock reaching 2 s')
  if ((await page.getByTestId('replays-timeline-position').textContent()) === firstPosText) {
    throw new Error('replays-timeline: the position text never moved')
  }
  await shot('timeline-playing')

  step("play/pause toggles the engine's pause")
  await page.getByTestId('replays-timeline-toggle').click({ timeout: TIMEOUT_MS })
  await expectLast(++n, 'pause', 'first toggle')
  const frozen = await positionS(page)
  await sleep(1_500)
  if ((await positionS(page)) !== frozen)
    throw new Error('replays-timeline: position kept moving while the engine is paused')
  await shot('timeline-paused')
  await page.getByTestId('replays-timeline-toggle').click({ timeout: TIMEOUT_MS })
  await expectLast(++n, 'pause', 'second toggle')
  await waitForPosition(page, (s) => s >= frozen + 1, 'the clock resuming after the second toggle')

  step('jump back and forward move by 10 s')
  let before = await positionS(page)
  await page.getByTestId('replays-timeline-forward').click({ timeout: TIMEOUT_MS })
  await expectLast(++n, 'seek +10', 'jump forward')
  await waitForPosition(
    page,
    (s) => s >= before + 9 && s <= before + 13,
    `jumping forward from ${before} s`,
  )
  before = await positionS(page)
  await page.getByTestId('replays-timeline-back').click({ timeout: TIMEOUT_MS })
  await expectLast(++n, 'seek -10', 'jump back')
  await waitForPosition(
    page,
    (s) => s <= before - 7 && s >= before - 11,
    `jumping back from ${before} s`,
  )

  step('clicking the bar seeks there')
  const box = await seekBar.boundingBox()
  if (!box) throw new Error('replays-timeline: the seek bar has no box')
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2)
  const seekCmd = await expectLast(++n, /^seek \d+$/, 'bar click')
  const target = Number(seekCmd.split(' ')[1])
  const expected = durationS * 0.25
  if (Math.abs(target - expected) > 2)
    throw new Error(`replays-timeline: a click at 25% sent ${seekCmd}, expected ~seek ${expected}`)
  await waitForPosition(page, (s) => s >= target && s <= target + 3, `seeking to ${target} s`)

  step('the speed control sets timescale and shows it')
  await speed.selectOption('0.5', { timeout: TIMEOUT_MS })
  await expectLast(++n, 'timescale 0.5', 'speed 0.5')
  if ((await speed.inputValue()) !== '0.5')
    throw new Error('replays-timeline: the speed control does not show 0.5')
  const speedLabel = await speed.evaluate((el) => el.options[el.selectedIndex]?.textContent ?? '')
  if (!speedLabel.includes('0.5'))
    throw new Error(`replays-timeline: speed shows ${JSON.stringify(speedLabel)}`)
  await shot('timeline-half-speed')

  step('every control works from the keyboard with visible focus')
  // Land on the toggle by keyboard (Shift+Tab, Tab) so :focus-visible is the keyboard kind.
  await page.getByTestId('replays-timeline-toggle').focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expectFocus(page, 'replays-timeline-toggle')
  await page.keyboard.press('Enter')
  await expectLast(++n, 'pause', 'toggle by Enter')
  await page.keyboard.press('Tab')
  await expectFocus(page, 'replays-timeline-back')
  await page.keyboard.press('Enter')
  await expectLast(++n, 'seek -10', 'back by Enter')
  await page.keyboard.press('Tab')
  await expectFocus(page, 'replays-timeline-forward')
  await page.keyboard.press('Space')
  await expectLast(++n, 'seek +10', 'forward by Space')
  await page.keyboard.press('Tab')
  await expectFocus(page, 'replays-timeline-speed')
  await page.keyboard.press('ArrowDown')
  await expectLast(++n, 'timescale 1', 'speed by ArrowDown')
  // The seek bar spans the strip above the buttons, so it is first in tab order.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Tab')
  await expectFocus(page, 'replays-timeline-seek')
  await shot('timeline-keyboard-focus')
  await page.keyboard.press('ArrowRight')
  await expectLast(++n, 'seek +10', 'seek bar ArrowRight')
  await page.keyboard.press('ArrowLeft')
  await expectLast(++n, 'seek -10', 'seek bar ArrowLeft')
  await page.keyboard.press('Home')
  await expectLast(++n, 'seek 0', 'seek bar Home')
  await waitForPosition(page, (s) => s === 0, 'Home seeking to the start')
  await page.keyboard.press('Tab')
  await expectFocus(page, 'replays-timeline-toggle')
  await page.keyboard.press('Space')
  await expectLast(++n, 'pause', 'toggle by Space')

  step(
    'the timeline appears while a demo plays and disappears when the game exits - the game exits',
  )
  writeFileSync(files.quitFile, '')
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
  await shot('timeline-gone')
}
