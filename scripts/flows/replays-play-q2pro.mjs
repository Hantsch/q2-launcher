// Story 159 D3: e2e proof that "Play" on a demo launches the active Q2PRO installation with
// `+set game <mod> +demo <file>` (and never `demomap`), and that the button stays visible but
// disabled - with its reason as visible text - when playback cannot work.
//
// The "engine" is the fixture's stand-in client (7za.exe / a shell script) that exits on its own; no
// real Quake II is ever started. The launch line is read from main.log, the phases from a
// `launch:state` collector armed in the page (same technique as `servers-join.mjs`).
//
// Selectors: `nav-replays`, `replays-demo-row`, `replays-demo-play`, `replays-demo-play-reason`
// (`DemoPlayAction.tsx`), and the rail's installation entries by their fixture names.
import { existsSync, readFileSync } from 'node:fs'
import {
  REPLAYS_PLAY_BASE_DEMO,
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_PLAY_MISSING_MOD,
  REPLAYS_PLAY_MISSING_MOD_DEMO,
  vendoredExtractorExists,
  writeReplaysPlayFixture,
} from '../lib/fixture.mjs'

export const variant = 'replays-play'

const TIMEOUT_MS = 8_000

/** Flows never reseed their fixture, so this one writes its own (like `servers-join.mjs`). */
export async function setup() {
  writeReplaysPlayFixture()
  return {}
}
const LAUNCH_TIMEOUT_MS = 15_000

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
  throw new Error('replays-play-q2pro: timed out waiting for the demo scan to finish')
}

async function selectDemo(page, fileName) {
  await rowFor(page, fileName).first().click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-play').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

async function waitForLog(logPath, substring) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    if (content.includes(substring)) return content
    if (Date.now() >= deadline) throw new Error(`replays-play-q2pro: main.log never contained ${substring}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

export default async function replaysPlayQ2pro({ page, step, shot }) {
  if (process.platform === 'win32' && !vendoredExtractorExists()) {
    console.log('replays-play-q2pro: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored (npm run fetch:7za)')
    return
  }

  step('open Demos; the fixture lists three demos')
  await page.getByTestId('nav-replays').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)

  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))

  step('playing the ctf demo launches the Q2PRO stand-in with +set game ctf +demo, no demomap')
  await selectDemo(page, REPLAYS_PLAY_CTF_DEMO)
  const play = page.getByTestId('replays-demo-play')
  if (await play.isDisabled()) {
    const reason = await page.getByTestId('replays-demo-play-reason').textContent()
    throw new Error(`replays-play-q2pro: Play should be enabled for the ctf demo, reason: ${reason}`)
  }
  await shot('play-enabled')
  await page.evaluate(() => {
    window.__q2lPhases = []
    if (!window.__q2lArmed) {
      window.__q2lArmed = true
      window.q2.on('launch:state', (state) => window.__q2lPhases.push(state.phase))
    }
  })
  await play.click({ timeout: TIMEOUT_MS })
  const log = await waitForLog(logPath, `+demo ${REPLAYS_PLAY_CTF_DEMO}`)
  const line = log
    .split(/\r?\n/)
    .filter((l) => l.includes('launching'))
    .pop()
  if (!line || !line.trimEnd().endsWith(`+set game ctf +demo ${REPLAYS_PLAY_CTF_DEMO}`)) {
    throw new Error(`replays-play-q2pro: unexpected launching line ${JSON.stringify(line)}`)
  }
  if (line.includes('demomap')) throw new Error('replays-play-q2pro: launching line must not use demomap')
  await page.waitForFunction(() => (window.__q2lPhases ?? []).includes('running'), undefined, {
    timeout: LAUNCH_TIMEOUT_MS,
  })
  await page.waitForFunction(
    () => {
      const phases = window.__q2lPhases ?? []
      return phases.lastIndexOf('running') !== -1 && phases.length > phases.lastIndexOf('running') + 1
    },
    undefined,
    { timeout: LAUNCH_TIMEOUT_MS },
  )

  step('a demo whose mod no installation has shows "Mod `opentdm` missing"')
  await selectDemo(page, REPLAYS_PLAY_MISSING_MOD_DEMO)
  if (!(await page.getByTestId('replays-demo-play').isDisabled())) {
    throw new Error('replays-play-q2pro: Play must be disabled for the missing-mod demo')
  }
  const modReason = (await page.getByTestId('replays-demo-play-reason').textContent()) ?? ''
  if (!modReason.includes(`Mod \`${REPLAYS_PLAY_MISSING_MOD}\` missing`)) {
    throw new Error(`replays-play-q2pro: expected the modMissing text, got ${JSON.stringify(modReason)}`)
  }
  await shot('play-mod-missing')

  step('selecting the r1q2 installation disables Play with the notQ2pro reason')
  await selectDemo(page, REPLAYS_PLAY_BASE_DEMO)
  // The rail lists installations by sortOrder: q2pro first, r1q2 second.
  await page.getByTestId('installation-tile').nth(1).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-play-reason').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await page.getByTestId('replays-demo-play').isDisabled())) {
    throw new Error('replays-play-q2pro: Play must be disabled with the r1q2 installation active')
  }
  const reason = (await page.getByTestId('replays-demo-play-reason').textContent()) ?? ''
  if (!reason.includes('is not Q2PRO')) {
    throw new Error(`replays-play-q2pro: expected the notQ2pro text, got ${JSON.stringify(reason)}`)
  }
  await shot('play-not-q2pro')
}
