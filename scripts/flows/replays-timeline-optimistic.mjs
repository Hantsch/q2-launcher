// Story 184 D4: e2e proof that the timeline strip answers a click at once (optimistic expected state),
// shows a waiting note after 1 s, confirms from the engine's readbacks, and reverts a refused command.
// The "engine" is the fixture's stub with two latency levers (`scripts/lib/stub-engine.cjs`):
// `commandDelayMs` runs every launcher command N ms late (log line, state change and ACK together),
// `outputBurstMs` holds all engine output and writes it in one burst every N ms (Q2PRO's buffered
// logfile). A launch cannot change its env per demo, so each phase writes the stub's levers file and
// starts a fresh demo. Phase A: delay 1500 ms. Phase B: burst 1500 ms at 1x. Phase C: no lever.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { makeFail, sleep } from '../lib/flow-common.mjs'
import { commands, openDemos, openFolder } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
const ENGINE_TIMEOUT_MS = 8_000

const files = replaysTimelineEngineFiles()
const leversFile = join(files.dir, 'levers.json')

export async function setup() {
  writeReplaysTimelineFixture()
  mkdirSync(files.dir, { recursive: true })
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_ENGINE_LEVERS_FILE: leversFile,
    },
  }
}

const fail = makeFail('replays-timeline-optimistic')

async function waitForCommands(count, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS * 2
  while (commands(files.commandLog).length < count) {
    if (Date.now() >= deadline)
      fail(`${label}: engine ran ${JSON.stringify(commands(files.commandLog))}, expected ${count}`)
    await sleep(50)
  }
}

/** Sleeps until `ms` after `t0` (the click), so checks land at fixed offsets from it. */
async function at(t0, ms) {
  const wait = t0 + ms - Date.now()
  if (wait > 0) await sleep(wait)
}

const positionS = async (page) =>
  Number(await page.getByTestId('replays-timeline-seek').getAttribute('aria-valuenow'))
const positionMs = async (page) =>
  Number(await page.getByTestId('replays-timeline-seek').getAttribute('data-position-ms'))
const toggleLabel = (page) => page.getByTestId('replays-timeline-toggle').getAttribute('aria-label')

/** A freshly started demo with the stub's levers set to `levers`. */
async function startDemo(page, levers) {
  rmSync(files.quitFile, { force: true })
  rmSync(files.commandLog, { force: true })
  writeFileSync(leversFile, JSON.stringify(levers))
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_CTF_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })
}

async function stopDemo(page) {
  writeFileSync(files.quitFile, '')
  await page.getByTestId('replays-timeline').waitFor({ state: 'detached', timeout: 15_000 })
}

/** Waits until the launcher's strip has a live position (the first readback arrived). */
async function waitForLive(page, minMs = 1_000) {
  const deadline = Date.now() + 10_000
  while ((await positionMs(page)) < minMs) {
    if (Date.now() >= deadline) fail(`the position never reached ${minMs} ms`)
    await sleep(100)
  }
}

export default async function replaysTimelineOptimistic({ page, step, shot }) {
  const seekBar = page.getByTestId('replays-timeline-seek')
  const toggle = page.getByTestId('replays-timeline-toggle')
  const forward = page.getByTestId('replays-timeline-forward')
  const speed = page.getByTestId('replays-timeline-speed')
  const waiting = page.getByTestId('replays-timeline-waiting')

  await openDemos(page)
  await openFolder(page, 'ctf')

  // ---- Phase A: every command runs 1500 ms late ----
  await startDemo(page, { commandDelayMs: 1500 })
  await waitForLive(page, 1_000)

  step('AC1 pause flips before the readback')
  {
    if ((await toggleLabel(page)) !== 'Pause')
      fail(`AC1: the toggle reads ${await toggleLabel(page)} before the click, expected Pause`)
    const t0 = Date.now()
    await toggle.click({ timeout: TIMEOUT_MS })
    await at(t0, 300)
    if ((await toggleLabel(page)) !== 'Play')
      fail(`AC1: at +300 ms the toggle reads ${await toggleLabel(page)}, expected Play`)
    if (commands(files.commandLog).includes('pause'))
      fail('AC1: the engine had already run pause at +300 ms - the delay lever is not holding it')
    await at(t0, 1200)
    if ((await toggleLabel(page)) !== 'Play')
      fail(`AC1: at +1200 ms the toggle reads ${await toggleLabel(page)}, expected Play`)
    if (commands(files.commandLog).includes('pause'))
      fail('AC1: the engine had already run pause at +1200 ms')
    await waitForCommands(1, 'AC1')
    await sleep(800)
    if ((await toggleLabel(page)) !== 'Play')
      fail('AC1: the toggle flipped back after the engine confirmed pause')
    await shot('optimistic-paused')
  }

  step('AC3 speed shows at once')
  {
    const t0 = Date.now()
    await speed.selectOption('2', { timeout: TIMEOUT_MS })
    await at(t0, 300)
    if ((await speed.inputValue()) !== '2')
      fail(`AC3: at +300 ms the speed shows ${await speed.inputValue()}, expected 2`)
    const label = await speed.evaluate((el) => el.options[el.selectedIndex]?.textContent ?? '')
    if (!label.includes('2')) fail(`AC3: speed label ${JSON.stringify(label)}`)
    if (commands(files.commandLog).some((c) => c === 'timescale 2'))
      fail('AC3: the engine had already run timescale 2 at +300 ms')
    await waitForCommands(2, 'AC3')
    await sleep(800)
    if ((await speed.inputValue()) !== '2')
      fail('AC3: the speed fell back after the engine confirmed it')
  }

  step('AC2 jump, click-seek and key-seek move at once')
  const p0 = await positionS(page)
  let expectedS = p0
  {
    const t0 = Date.now()
    await forward.click({ timeout: TIMEOUT_MS })
    await forward.click({ timeout: TIMEOUT_MS })
    expectedS = p0 + 20
    await at(t0, 300)
    const s300 = await positionS(page)
    if (s300 !== expectedS)
      fail(
        `AC2: two forward clicks at +300 ms show ${s300} s, expected ${expectedS} s (from ${p0} s)`,
      )
    const text = (await page.getByTestId('replays-timeline-position').textContent()) ?? ''
    if (!text.startsWith(`0:${String(expectedS).padStart(2, '0')}`))
      fail(`AC2: the position text reads ${JSON.stringify(text)}, expected 0:${expectedS}`)
    for (const offset of [800, 1200]) {
      await at(t0, offset)
      const s = await positionS(page)
      if (s < expectedS)
        fail(
          `AC2: at +${offset} ms the position fell back to ${s} s, below the target ${expectedS} s`,
        )
    }
    // Let both jumps land before the next gesture so the final position is deterministic.
    await waitForCommands(4, 'AC2 jumps')
    await sleep(600)

    // A seek-bar click and ArrowRight also move at once.
    const box = await seekBar.boundingBox()
    if (!box) fail('AC2: the seek bar has no box')
    const t1 = Date.now()
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2)
    await at(t1, 300)
    const clicked = await positionS(page)
    const durationS = Number(await seekBar.getAttribute('aria-valuemax'))
    if (Math.abs(clicked - durationS * 0.25) > 2)
      fail(`AC2: a click at 25% shows ${clicked} s at +300 ms, expected ~${durationS * 0.25} s`)
    expectedS = clicked
    await waitForCommands(5, 'AC2 bar click')
    await sleep(600)
    const t2 = Date.now()
    await seekBar.focus()
    await page.keyboard.press('ArrowRight')
    await at(t2, 300)
    const keyed = await positionS(page)
    if (keyed !== clicked + 10)
      fail(`AC2: ArrowRight at +300 ms shows ${keyed} s, expected ${clicked + 10} s`)
    expectedS = keyed
  }

  step('AC5 readback confirms the seek')
  {
    await waitForCommands(6, 'AC5')
    await sleep(2_500)
    const ran = commands(files.commandLog)
    const seekCmd = ran[4]
    if (!/^seek \d+$/.test(seekCmd ?? '')) fail(`AC5: the bar click ran ${JSON.stringify(seekCmd)}`)
    if (
      ran.length !== 6 ||
      ran[0] !== 'pause' ||
      ran[1] !== 'timescale 2' ||
      ran[2] !== 'seek +10' ||
      ran[3] !== 'seek +10' ||
      ran[5] !== 'seek +10'
    ) {
      fail(
        `AC5: each command must run exactly once, in order; the engine ran ${JSON.stringify(ran)}`,
      )
    }
    // The demo is paused, so the stub's position is exactly the last absolute seek plus the last jump.
    const stubS = Number(seekCmd.split(' ')[1]) + 10
    const shown = await positionS(page)
    if (Math.abs(shown - stubS) > 1)
      fail(`AC5: the strip shows ${shown} s, the engine is at ~${stubS} s`)
    if (Math.abs(shown - expectedS) > 1)
      fail(`AC5: the strip moved from ${expectedS} s to ${shown} s after confirmation`)
    if ((await toggleLabel(page)) !== 'Play')
      fail('AC5: the toggle no longer reads Play after confirmation')
  }

  step('AC6 waiting text after 1 s, cleared on confirmation')
  {
    if (await waiting.isVisible()) fail('AC6: the waiting note shows with nothing in flight')
    const before = await commands(files.commandLog).length
    const t0 = Date.now()
    await forward.click({ timeout: TIMEOUT_MS })
    await at(t0, 500)
    if (await waiting.isVisible())
      fail('AC6: the waiting note shows at +500 ms, before the 1 s threshold')
    await at(t0, 1100)
    if (!(await waiting.isVisible())) fail('AC6: no waiting note at +1100 ms')
    const text = (await waiting.textContent()) ?? ''
    if (!text.includes('Waiting for the game') || !text.includes('(seek)'))
      fail(`AC6: the waiting note reads ${JSON.stringify(text)}`)
    if ((await forward.getAttribute('aria-busy')) !== 'true')
      fail('AC6: the forward button is not aria-busy="true" while waiting')
    await waitForCommands(before + 1, 'AC6')
    await waiting.waitFor({ state: 'detached', timeout: 6_000 })
    if ((await forward.getAttribute('aria-busy')) === 'true')
      fail('AC6: the forward button is still aria-busy after confirmation')
    await shot('optimistic-waiting-cleared')
  }
  await stopDemo(page)

  // ---- Phase B: output arrives in 1500 ms bursts at 1x ----
  await startDemo(page, { outputBurstMs: 1500 })

  step('AC4 position advances smoothly between bursts')
  {
    await waitForLive(page, 1)
    const samples = []
    const t0 = Date.now()
    for (let i = 0; i <= 20; i++) {
      await at(t0, i * 200)
      samples.push(await positionMs(page))
    }
    for (let i = 1; i < samples.length; i++) {
      const d = samples[i] - samples[i - 1]
      if (d === 0)
        fail(
          `AC4: the position stood still between samples ${i - 1} and ${i}: ${JSON.stringify(samples)}`,
        )
      // A burst's newest sample is up to loop (13 frames = 208 ms) + log poll (50 ms) + push (250 ms) = ~510 ms
      // old at receipt, and the previous anchor was as fresh as it could be, so a correction of ~-520 ms is the
      // pipeline's jitter, not a renderer error (the stub's held samples are the real ones, flushed together).
      if (d > 1000 || d < -750)
        fail(
          `AC4: the position jumped ${d} ms between samples ${i - 1} and ${i}: ${JSON.stringify(samples)}`,
        )
    }
  }
  await stopDemo(page)

  // ---- Phase C: no lever - a refused command reverts ----
  await startDemo(page, {})

  step('AC7 a refused command reverts')
  {
    await waitForLive(page, 1_000)
    await seekBar.focus()
    await page.keyboard.press('End')
    await page
      .getByTestId('replays-timeline-state')
      .filter({ hasText: 'Finished' })
      .waitFor({ state: 'visible', timeout: 15_000 })
    await sleep(800)
    const confirmedMs = await positionMs(page)
    const confirmedLabel = await toggleLabel(page)
    await forward.click({ timeout: TIMEOUT_MS })
    await toggle.click({ timeout: TIMEOUT_MS })
    await page.getByTestId('replays-timeline-error').waitFor({ state: 'visible', timeout: 6_000 })
    const deadline = Date.now() + 6_000
    let ms = await positionMs(page)
    let label = await toggleLabel(page)
    while ((ms !== confirmedMs || label !== confirmedLabel) && Date.now() < deadline) {
      await sleep(100)
      ms = await positionMs(page)
      label = await toggleLabel(page)
    }
    if (ms !== confirmedMs)
      fail(
        `AC7: the position is ${ms} ms after the refusal, expected the confirmed ${confirmedMs} ms`,
      )
    if (label !== confirmedLabel)
      fail(
        `AC7: the toggle reads ${label} after the refusal, expected the confirmed ${confirmedLabel}`,
      )
    await shot('optimistic-refused')
  }
  await stopDemo(page)
}
