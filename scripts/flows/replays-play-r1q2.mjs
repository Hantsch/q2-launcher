// E2e proof that a demo plays in an R1Q2 installation through `+demomap` with no playback
// channel - the engine-less session leaves every steering control visible but disabled, with the
// reason as visible text - and that Stop restores the installation's whole config file (story 275).
//
// The "engine" is the fixture's stand-in R1Q2 (`stub-engine.cjs` in `engine: 'r1q2'` mode), which
// appends a `set` line to `baseq2/q2config.cfg` the way R1Q2 archives a cvar.
//
// Selectors: `replays-demo-row`, `actionbar-play[data-action="view"]`, `actionbar-action-reason`,
// `replays-timeline-*`, `replays-console-input`, `replays-playback-engine-reason`.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPLAYS_PLAY_BASE_DEMO,
  REPLAYS_PLAY_MVD2_DEMO,
  REPLAYS_PLAY_R1Q2_SEEDED_CONFIG,
  r1q2WrapperCompiler,
  writeReplaysPlayFixture,
} from '../lib/fixture.mjs'
import { openDemos, openFolder, rowFor } from '../lib/replays-copy-in.mjs'

export const variant = 'replays-play-r1q2'

const TIMEOUT_MS = 8_000
const LAUNCH_TIMEOUT_MS = 15_000

let fixture = null

export async function setup() {
  if (process.platform === 'win32' && !r1q2WrapperCompiler()) return {}
  fixture = writeReplaysPlayFixture(variant, { r1q2Stub: true })
  return {}
}

async function waitForLog(logPath, substring) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    if (content.includes(substring)) return content
    if (Date.now() >= deadline)
      throw new Error(`replays-play-r1q2: main.log never contained ${substring}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

// The restore in main is fire-and-forget, so the file is polled rather than read once.
async function pollConfig(predicate, configPath, expectation) {
  const deadline = Date.now() + 8_000
  for (;;) {
    const config = existsSync(configPath) ? readFileSync(configPath, 'latin1') : ''
    if (predicate(config)) return
    if (Date.now() >= deadline)
      throw new Error(
        `replays-play-r1q2: q2config.cfg must ${expectation}, got ${JSON.stringify(config)}`,
      )
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

const isDisabled = (locator) =>
  locator.evaluate((el) => el.disabled === true || el.getAttribute('aria-disabled') === 'true')

export default async function replaysPlayR1q2({ page, step, shot }) {
  if (!fixture) {
    console.log(
      'replays-play-r1q2: SKIPPING LOUDLY - the .NET Framework csc.exe needed to build the stand-in R1Q2 was not found',
    )
    return
  }

  step('open Demos on the R1Q2 installation')
  await page.getByTestId('nav-replays').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await openDemos(page)
  await openFolder(page, 'baseq2')
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')

  step('Play launches r1q2 with +demomap and none of the channel args')
  await rowFor(page, REPLAYS_PLAY_BASE_DEMO).first().click({ timeout: TIMEOUT_MS })
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await play.isDisabled()) {
    const reason = await page.getByTestId('actionbar-action-reason').textContent()
    throw new Error(`replays-play-r1q2: Play should be enabled for a .dm2, reason: ${reason}`)
  }
  await page.evaluate(() => {
    window.__q2lPhases = []
    if (!window.__q2lArmed) {
      window.__q2lArmed = true
      window.q2.on('launch:state', (state) => window.__q2lPhases.push(state.phase))
    }
  })
  await play.click({ timeout: TIMEOUT_MS })
  const log = await waitForLog(logPath, '+demomap ')
  const line = log
    .split(/\r?\n/)
    .filter((l) => l.includes('launching'))
    .pop()
  if (!/launching.*r1q2/i.test(line ?? '')) {
    throw new Error(`replays-play-r1q2: expected an r1q2 launch line, got ${JSON.stringify(line)}`)
  }
  if (/\+demo /.test(line)) throw new Error('replays-play-r1q2: the launch must not use +demo')
  for (const forbidden of ['logfile', 'q2l_', 's_volume']) {
    if (line.includes(forbidden))
      throw new Error(`replays-play-r1q2: the launch line must not carry ${forbidden}`)
  }
  await page.waitForFunction(() => (window.__q2lPhases ?? []).includes('running'), undefined, {
    timeout: LAUNCH_TIMEOUT_MS,
  })

  step('every steering control is visible but disabled, with the reason as text')
  await page
    .getByTestId('replays-timeline')
    .waitFor({ state: 'visible', timeout: LAUNCH_TIMEOUT_MS })
  const controls = [
    'replays-timeline-toggle',
    'replays-timeline-back',
    'replays-timeline-forward',
    'replays-timeline-speed',
    'replays-timeline-seek',
    'replays-timeline-volume',
    'replays-timeline-add-comment',
    'replays-timeline-cinema',
    'replays-timeline-fullscreen',
    'replays-console-input',
  ]
  for (const id of controls) {
    const control = page.getByTestId(id)
    await control.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    if (!(await isDisabled(control)))
      throw new Error(`replays-play-r1q2: ${id} must be disabled in an engine-less session`)
  }
  const reason = page.getByTestId('replays-playback-engine-reason')
  await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await reason.textContent()) ?? '').includes('Not available in R1Q2')) {
    throw new Error('replays-play-r1q2: the engine reason must say "Not available in R1Q2"')
  }
  const configPath = join(fixture.r1q2Root, 'baseq2', 'q2config.cfg')
  await pollConfig(
    (c) => c !== REPLAYS_PLAY_R1Q2_SEEDED_CONFIG,
    configPath,
    'change while the game runs',
  )
  await shot('r1q2-engine-less')

  step('Stop ends the session and restores the whole config file')
  await page.getByTestId('replays-timeline-stop').click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () => {
      const phases = window.__q2lPhases ?? []
      return (
        phases.lastIndexOf('running') !== -1 && phases.length > phases.lastIndexOf('running') + 1
      )
    },
    undefined,
    { timeout: LAUNCH_TIMEOUT_MS },
  )
  await pollConfig(
    (c) => c === REPLAYS_PLAY_R1Q2_SEEDED_CONFIG,
    configPath,
    'equal the seeded bytes after Stop',
  )

  step('an .mvd2 cannot play in R1Q2: Play is disabled with its reason as text')
  await rowFor(page, REPLAYS_PLAY_MVD2_DEMO).first().click({ timeout: TIMEOUT_MS })
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await play.isDisabled()))
    throw new Error('replays-play-r1q2: Play must be disabled for an .mvd2')
  const actionReason = page.getByTestId('actionbar-action-reason')
  await actionReason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await actionReason.textContent()) ?? '').includes('Not available in R1Q2')) {
    throw new Error('replays-play-r1q2: the .mvd2 reason must say "Not available in R1Q2"')
  }
  await shot('r1q2-mvd2-disabled')
}
