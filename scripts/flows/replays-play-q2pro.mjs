// Story 159 D3 / 180 D4: e2e proof that the action bar's "View" button on Demos launches the active
// Q2PRO installation with `+set game <mod> +demo <file>` (and never `demomap`), that it stays visible but
// disabled - with its reason as visible text in `actionbar-action-reason` - when playback cannot work,
// and that a mod-missing demo asks for confirmation (Cancel launches nothing, Play anyway launches).
//
// The "engine" is the fixture's stand-in client (7za.exe / a shell script) that exits on its own; no
// real Quake II is ever started. The launch line is read from main.log, the phases from a
// `launch:state` collector armed in the page (same technique as `servers-join.mjs`).
//
// Selectors: `nav-replays`, `replays-demo-row`, `actionbar-play[data-action="view"]`,
// `actionbar-action-reason`, `replays-mod-missing-*` (`ModMissingConfirmDialog.tsx`), and the rail's installation entries by their fixture names.
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
  await page.locator('[data-testid="actionbar-play"][data-action="view"]').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
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
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  if (await play.isDisabled()) {
    const reason = await page.getByTestId('actionbar-action-reason').textContent()
    throw new Error(`replays-play-q2pro: View should be enabled for the ctf demo, reason: ${reason}`)
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
  // Playback session (story 164): the channel's args wrap +demo - before it the logfile setup
  // (Windows) or sys_console (Linux), after it the polling loop (Windows only).
  // Story 170: the stage args (borderless window at `vid_geometry`) come after the channel's setup
  // args and before +demo. Story 172: the channel also marks the session (`+set q2l_session 1`) right
  // after its setup args.
  const head = process.platform === 'win32' ? '+set logfile 2 +set logfile_flush 3 +set logfile_name q2l_demo.log' : '+set sys_console 1'
  const tail = process.platform === 'win32' ? `+demo ${REPLAYS_PLAY_CTF_DEMO} +exec q2l_loop.cfg` : `+demo ${REPLAYS_PLAY_CTF_DEMO}`
  const trimmed = (line ?? '').trimEnd()
  const geometryAt = trimmed.search(/ \+set vid_geometry \d+x\d+\+-?\d+\+-?\d+ /)
  const okOrder =
    trimmed.includes(` +set game ctf ${head} +set q2l_session 1 +set con_notifylines 0 +set scr_chathud 1 +set in_grab 2 +set vid_fullscreen 0 `) &&
    geometryAt !== -1 &&
    trimmed.endsWith(` ${tail}`) &&
    trimmed.indexOf('+set vid_geometry') < trimmed.indexOf('+demo ')
  if (!okOrder) {
    throw new Error(`replays-play-q2pro: expected game, ${head}, stage args, then ${tail}; got ${JSON.stringify(line)}`)
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

  step('a demo whose mod no installation has keeps View enabled and asks for confirmation')
  const launchCount = () => (readFileSync(logPath, 'utf8').match(/launching/g) ?? []).length
  await selectDemo(page, REPLAYS_PLAY_MISSING_MOD_DEMO)
  if (await play.isDisabled()) {
    throw new Error('replays-play-q2pro: View must stay enabled for the missing-mod demo')
  }
  // Story 182: the warning lives only in the dialog - the readout carries no permanent modMissing text.
  const reasonNode = page.getByTestId('actionbar-action-reason')
  if ((await reasonNode.count()) > 0 && /not fully installed/i.test((await reasonNode.textContent()) ?? '')) {
    throw new Error('replays-play-q2pro: the action bar must not carry a permanent mod warning')
  }
  const launchesBefore = launchCount()
  await play.click({ timeout: TIMEOUT_MS })
  const dialog = page.getByTestId('replays-mod-missing-dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await dialog.textContent()) ?? '').includes(REPLAYS_PLAY_MISSING_MOD)) {
    throw new Error(`replays-play-q2pro: the confirmation must name ${REPLAYS_PLAY_MISSING_MOD}`)
  }
  await shot('play-mod-missing')

  step('Cancel launches nothing')
  await page.getByTestId('replays-mod-missing-cancel').click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  if (launchCount() !== launchesBefore) throw new Error('replays-play-q2pro: Cancel must not launch anything')

  step('Play anyway launches with +set game opentdm')
  await play.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-mod-missing-confirm').click({ timeout: TIMEOUT_MS })
  await waitForLog(logPath, `+set game ${REPLAYS_PLAY_MISSING_MOD} `)
  await page.waitForFunction(
    () => {
      const phases = window.__q2lPhases ?? []
      return phases.lastIndexOf('running') !== -1 && phases.length > phases.lastIndexOf('running') + 1
    },
    undefined,
    { timeout: LAUNCH_TIMEOUT_MS },
  )

  step('selecting the r1q2 installation disables View with the notQ2pro reason')
  await selectDemo(page, REPLAYS_PLAY_BASE_DEMO)
  // The rail lists installations by sortOrder: q2pro first, r1q2 second.
  await page.getByTestId('installation-tile').nth(1).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('actionbar-action-reason').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await play.isDisabled())) {
    throw new Error('replays-play-q2pro: View must be disabled with the r1q2 installation active')
  }
  const reason = (await page.getByTestId('actionbar-action-reason').textContent()) ?? ''
  if (!reason.includes('is not Q2PRO')) {
    throw new Error(`replays-play-q2pro: expected the notQ2pro text, got ${JSON.stringify(reason)}`)
  }
  await shot('play-not-q2pro')
}
