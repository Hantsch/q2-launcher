// Story 162 D1: an MVD2 and an MVD2.gz play through story 159's path - the stand-in Q2PRO is
// launched with `+set game <mod> +demo <full file name>` (extension kept: Q2PRO assumes .dm2 only
// for a name without one, and reads gzip itself). Same stub engine and log technique as
// `replays-play-q2pro.mjs`.
import { existsSync, readFileSync } from 'node:fs'
import {
  REPLAYS_PLAY_MVD2_DEMO,
  REPLAYS_PLAY_MVD2_GAME_DIR,
  REPLAYS_PLAY_MVD2_GZ_DEMO,
  vendoredExtractorExists,
  writeReplaysPlayMvd2Fixture,
} from '../lib/fixture.mjs'

export const variant = 'replays-play-mvd2'

const TIMEOUT_MS = 8_000
const LAUNCH_TIMEOUT_MS = 15_000

export async function setup() {
  writeReplaysPlayMvd2Fixture(variant)
  return {}
}

function rowFor(page, fileName) {
  return page.getByTestId('replays-demo-row').filter({ hasText: fileName })
}

async function waitForScan(page) {
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await refresh.isDisabled())) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('replays-play-mvd2: timed out waiting for the demo scan to finish')
}

async function waitForLog(logPath, substring) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    if (content.includes(substring)) return content
    if (Date.now() >= deadline) throw new Error(`replays-play-mvd2: main.log never contained ${substring}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

async function playAndCheck(page, logPath, fileName) {
  await rowFor(page, fileName).first().click({ timeout: TIMEOUT_MS })
  const play = page.getByTestId('replays-demo-play')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await play.isDisabled()) {
    const reason = await page.getByTestId('replays-demo-play-reason').textContent()
    throw new Error(`replays-play-mvd2: Play should be enabled for ${fileName}, reason: ${reason}`)
  }
  await page.evaluate(() => {
    window.__q2lPhases = []
    if (!window.__q2lArmed) {
      window.__q2lArmed = true
      window.q2.on('launch:state', (state) => window.__q2lPhases.push(state.phase))
    }
  })
  await play.click({ timeout: TIMEOUT_MS })
  const log = await waitForLog(logPath, `+demo ${fileName}`)
  const line = log
    .split(/\r?\n/)
    .filter((l) => l.includes('launching'))
    .pop()
  const expected = `+set game ${REPLAYS_PLAY_MVD2_GAME_DIR} +demo ${fileName}`
  if (!line || !line.trimEnd().endsWith(expected)) {
    throw new Error(`replays-play-mvd2: expected launching line ending in ${expected}, got ${JSON.stringify(line)}`)
  }
  if (line.includes('demomap')) throw new Error('replays-play-mvd2: launching line must not use demomap')
  // The stand-in exits on its own; wait for that so the next Play is not refused as "game running".
  await page.waitForFunction(
    () => {
      const phases = window.__q2lPhases ?? []
      return phases.lastIndexOf('running') !== -1 && phases.length > phases.lastIndexOf('running') + 1
    },
    undefined,
    { timeout: LAUNCH_TIMEOUT_MS },
  )
}

export default async function replaysPlayMvd2({ page, step }) {
  if (process.platform === 'win32' && !vendoredExtractorExists()) {
    console.log('replays-play-mvd2: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored (npm run fetch:7za)')
    return
  }

  step('open Demos; the fixture install lists an .mvd2 and an .mvd2.gz')
  await page.getByTestId('nav-replays').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))

  step('the mvd2 detail note is visible')
  for (const name of [REPLAYS_PLAY_MVD2_DEMO, REPLAYS_PLAY_MVD2_GZ_DEMO]) {
    await rowFor(page, name).first().click({ timeout: TIMEOUT_MS })
    await page.getByTestId('demo-detail-mvd2-note').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }

  step('an mvd2 and an mvd2.gz play in Q2PRO with +set game and +demo')
  await playAndCheck(page, logPath, REPLAYS_PLAY_MVD2_DEMO)
  await playAndCheck(page, logPath, REPLAYS_PLAY_MVD2_GZ_DEMO)
}
