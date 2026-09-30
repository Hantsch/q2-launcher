// Story 185 D3: AC2 through the real click path. The stub's logfile is buffered the way Q2PRO's is
// (`Q2L_UI_ENGINE_LOG_FLUSH_MS=1500`: one burst every 1.5 s), so an ACK only becomes readable to the
// launcher at a flush. Three quick clicks on the timeline's +10 s control must all reach the engine
// at once - in click order, each exactly once - instead of queueing behind ACKs (3 x 1500 ms). The
// stub stamps each command-log line with ` @<epoch ms>` when the knob is set.
//
// Selectors: same as `replays-timeline` (`replays-timeline-{forward,seek,position}`).
import { existsSync, readFileSync } from 'node:fs'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
const FLUSH_MS = 1_500
// A serial one-ACK-per-command channel needs >= 3 x FLUSH_MS (4.5 s) for three commands, so it times out.
const ENGINE_TIMEOUT_MS = 3_000

const files = replaysTimelineEngineFiles()

export async function setup() {
  writeReplaysTimelineFixture()
  return {
    env: {
      Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog,
      Q2L_UI_ENGINE_QUIT_FILE: files.quitFile,
      Q2L_UI_ENGINE_LOG_FLUSH_MS: String(FLUSH_MS),
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** `{ text, at }` per command the engine ran (`at`: epoch ms the stub stamped). */
function commands() {
  if (!existsSync(files.commandLog)) return []
  return readFileSync(files.commandLog, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => {
      const m = /^(.*) @(\d+)$/.exec(l)
      if (!m) throw new Error(`replays-timeline-burst: command-log line has no @<epoch ms> stamp: ${JSON.stringify(l)}`)
      return { text: m[1], at: Number(m[2]) }
    })
}

async function waitForScan(page) {
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (await refresh.isDisabled()) {
    if (Date.now() >= deadline) throw new Error('replays-timeline-burst: timed out waiting for the demo scan to finish')
    await sleep(100)
  }
}

export default async function replaysTimelineBurst({ page, step, shot }) {
  const timeline = page.getByTestId('replays-timeline')
  const seekBar = page.getByTestId('replays-timeline-seek')
  const positionS = async () => Number(await seekBar.getAttribute('aria-valuenow'))

  step('a demo plays and the timeline is up')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  await page.getByTestId('replays-demo-row').filter({ hasText: REPLAYS_PLAY_CTF_DEMO }).first().click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await timeline.waitFor({ state: 'visible', timeout: 15_000 })
  // Let the loop cfg and the first flush settle so the clicks start from an idle channel.
  await sleep(FLUSH_MS + 500)
  const before = commands().length
  const startS = await positionS()

  step('three quick +10 s clicks all run, in order, before any ACK could be read')
  const forward = page.getByTestId('replays-timeline-forward')
  const firstClickAt = Date.now()
  for (let i = 0; i < 3; i++) {
    await forward.click({ timeout: TIMEOUT_MS, noWaitAfter: true })
    if (i < 2) await sleep(60)
  }
  const clicksTook = Date.now() - firstClickAt
  if (clicksTook > 300) throw new Error(`replays-timeline-burst: the three clicks took ${clicksTook} ms, expected <= 300`)

  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  while (commands().length < before + 3) {
    if (Date.now() >= deadline) {
      throw new Error(`replays-timeline-burst: engine ran ${JSON.stringify(commands().slice(before))}, expected 3 seek commands`)
    }
    await sleep(25)
  }
  await sleep(FLUSH_MS + 500)
  const ran = commands().slice(before)
  if (ran.length !== 3 || ran.some((c) => c.text !== 'seek +10')) {
    throw new Error(`replays-timeline-burst: engine ran ${JSON.stringify(ran)}, expected exactly three 'seek +10' in click order`)
  }
  const lag = ran[2].at - firstClickAt
  if (lag >= FLUSH_MS) {
    throw new Error(`replays-timeline-burst: the third seek ran ${lag} ms after the first click, expected < ${FLUSH_MS} ms (waited for an ACK)`)
  }
  if (ran[0].at > ran[1].at || ran[1].at > ran[2].at) throw new Error('replays-timeline-burst: the seeks ran out of order')
  for (let i = 1; i < ran.length; i++) {
    const gap = ran[i].at - ran[i - 1].at
    if (gap >= FLUSH_MS) {
      throw new Error(`replays-timeline-burst: seek ${i + 1} ran ${gap} ms after seek ${i}, expected < ${FLUSH_MS} ms (serialised behind an ACK)`)
    }
  }
  console.log(`replays-timeline-burst: lag=${lag} ms, gaps=${ran[1].at - ran[0].at}/${ran[2].at - ran[1].at} ms`)

  step('the position readback shows the jump')
  const deadlinePos = Date.now() + ENGINE_TIMEOUT_MS
  while ((await positionS()) < startS + 25) {
    if (Date.now() >= deadlinePos) throw new Error(`replays-timeline-burst: position stuck at ${await positionS()} s after 3 jumps from ${startS} s`)
    await sleep(100)
  }
  await shot('timeline-burst-jumped')

  step('the game exits')
  await import('node:fs').then(({ writeFileSync }) => writeFileSync(files.quitFile, ''))
  await timeline.waitFor({ state: 'detached', timeout: 10_000 })
}
