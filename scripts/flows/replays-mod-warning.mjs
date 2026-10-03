// Story 182 D2: e2e proof that a missing-mod demo carries no permanent warning, that View asks once
// (naming the mod, with a "Don't ask again" box), that Cancel remembers nothing even with the box
// ticked, and that Play anyway with the box ticked is remembered in `state.json`
// (`replays.modWarning.trustedMods`) so the next View launches without a dialog.
//
// The "engine" is the fixture's stand-in client (see `replays-play-q2pro.mjs`); no real Quake II runs.
// The final step resets the trusted list so the flow leaves defaults behind - later deliverables insert
// their steps BEFORE that cleanup.
import { variantUserDataDir } from '../lib/harness.mjs'
import { STATE_WRITE_GRACE_MS, readStateJson, waitForStateJson } from '../lib/state-json.mjs'
import {
  REPLAYS_PLAY_MISSING_MOD,
  REPLAYS_PLAY_MISSING_MOD_DEMO,
  vendoredExtractorExists,
  startBootstrapFixtureServer,
  writeReplaysPlayFixture,
} from '../lib/fixture.mjs'
import { waitForScan } from '../lib/replays-copy-in.mjs'
import { readLog } from '../lib/flow-common.mjs'

export const variant = 'replays-play'

const TIMEOUT_MS = 8_000
const LAUNCH_TIMEOUT_MS = 15_000

let server = null

/** Flows never reseed their fixture, so this one writes its own (like `replays-play-q2pro.mjs`). The
 * catalog has an entry (`action`) but no `opentdm`, so the dialog must offer no install (story 193 AC2). */
export async function setup() {
  writeReplaysPlayFixture()
  if (process.platform === 'win32' && !vendoredExtractorExists()) return {}
  server = await startBootstrapFixtureServer({ modsReplays: { withOpentdm: false } })
  return { env: { Q2L_UI_CONTENT_REPO_BASE: server.baseUrl } }
}

export async function teardown() {
  await server?.close()
  server = null
}

async function waitFor(predicate, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() >= deadline)
      throw new Error(`replays-mod-warning: timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

const trustedModsOf = (doc) => doc.replays?.modWarning?.trustedMods ?? []
function trustedMods() {
  try {
    return trustedModsOf(readStateJson(variantUserDataDir('replays-play')))
  } catch {
    return []
  }
}

export default async function replaysModWarning({ page, step, shot }) {
  if (process.platform === 'win32' && !vendoredExtractorExists()) {
    console.log(
      'replays-mod-warning: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored (npm run fetch:7za)',
    )
    return
  }

  await page.getByTestId('nav-replays').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  const dialog = page.getByTestId('replays-mod-missing-dialog')
  const launchCount = () => (readLog(logPath).match(/launching/g) ?? []).length
  const demoLaunches = () =>
    (readLog(logPath).match(new RegExp(`\\+set game ${REPLAYS_PLAY_MISSING_MOD} `, 'g')) ?? [])
      .length
  const waitForExit = () =>
    page.waitForFunction(
      () => {
        const phases = window.__q2lPhases ?? []
        return (
          phases.lastIndexOf('running') !== -1 && phases.length > phases.lastIndexOf('running') + 1
        )
      },
      undefined,
      { timeout: LAUNCH_TIMEOUT_MS },
    )

  step('a missing-mod demo shows no permanent warning')
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_MISSING_MOD_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await play.isDisabled())
    throw new Error('replays-mod-warning: View must be enabled for the missing-mod demo')
  const reasonNode = page.getByTestId('actionbar-action-reason')
  const visibleText =
    ((await page.getByTestId('replays-detail').textContent()) ?? '') +
    ((await reasonNode.count()) > 0 ? ((await reasonNode.textContent()) ?? '') : '')
  if (/not fully installed/i.test(visibleText)) {
    throw new Error(
      `replays-mod-warning: no permanent mod warning expected, got ${JSON.stringify(visibleText)}`,
    )
  }
  await shot('no-permanent-warning')

  step("View asks, naming the mod, with don't ask again")
  await page.evaluate(() => {
    window.__q2lPhases = []
    if (!window.__q2lArmed) {
      window.__q2lArmed = true
      window.q2.on('launch:state', (state) => window.__q2lPhases.push(state.phase))
    }
  })
  const launchesBefore = launchCount()
  await play.click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await dialog.textContent()) ?? '').includes(REPLAYS_PLAY_MISSING_MOD)) {
    throw new Error(`replays-mod-warning: the dialog must name ${REPLAYS_PLAY_MISSING_MOD}`)
  }
  await page
    .getByTestId('replays-mod-warning-dont-ask')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-mod-missing-confirm')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-mod-missing-cancel')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('mod-warning-dialog')

  step('without a catalog entry the dialog offers no install')
  // Prove the catalog was actually served (not unreachable) before trusting the absent button.
  if (!server?.requested.includes('/mods/manifest.json')) {
    throw new Error(
      'replays-mod-warning: the mod catalog manifest was never requested from the fixture server',
    )
  }
  if ((await page.getByTestId('replays-mod-missing-install').count()) !== 0) {
    throw new Error(
      'replays-mod-warning: no install offer expected while the catalog has no opentdm entry',
    )
  }

  step("cancel with don't ask again remembers nothing")
  await page.getByTestId('replays-mod-warning-dont-ask').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-mod-missing-cancel').click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  if (launchCount() !== launchesBefore)
    throw new Error('replays-mod-warning: Cancel must not launch anything')
  await new Promise((resolve) => setTimeout(resolve, STATE_WRITE_GRACE_MS))
  if (trustedMods().length !== 0) {
    throw new Error(
      `replays-mod-warning: Cancel must trust nothing, got ${JSON.stringify(trustedMods())}`,
    )
  }
  await play.click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step("play anyway with don't ask again is remembered")
  await page.getByTestId('replays-mod-warning-dont-ask').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-mod-missing-confirm').click({ timeout: TIMEOUT_MS })
  await waitFor(() => demoLaunches() === 1, 'the first launch (+set game opentdm)')
  await waitFor(
    () => readLog(logPath).includes('+demo play-tdm.dm2'),
    'main.log +demo play-tdm.dm2',
  )
  await waitForExit()
  await waitForStateJson(
    variantUserDataDir('replays-play'),
    (doc) => trustedModsOf(doc).includes(REPLAYS_PLAY_MISSING_MOD),
    `state.json trustedMods to contain ${REPLAYS_PLAY_MISSING_MOD}`,
  )
  await page.evaluate(() => {
    window.__q2lPhases = []
  })
  await play.click({ timeout: TIMEOUT_MS })
  await waitFor(() => demoLaunches() === 2, 'the second launch without a dialog')
  if ((await dialog.count()) !== 0)
    throw new Error('replays-mod-warning: a trusted mod must play without the dialog')
  await waitForExit()

  // Story 182 D3: the Settings switch and "Forget remembered mods" (AC5, AC6).
  const switchEl = page.getByTestId('replays-mod-warning-enabled')
  const resetBtn = page.getByTestId('replays-mod-warning-reset')
  const trustedText = page.getByTestId('replays-mod-warning-trusted')
  const openSettings = async () => {
    await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
    await switchEl.scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
    await switchEl.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  const setSwitch = async (on) => {
    const want = on ? 'true' : 'false'
    if ((await switchEl.getAttribute('aria-checked')) !== want)
      await switchEl.click({ timeout: TIMEOUT_MS })
    await page.waitForFunction(
      ([id, value]) =>
        document.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-checked') === value,
      ['replays-mod-warning-enabled', want],
      { timeout: TIMEOUT_MS },
    )
  }
  const openDemos = async () => {
    await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
    await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  const viewPlaysWithoutDialog = async (why) => {
    await page.evaluate(() => {
      window.__q2lPhases = []
    })
    const before = demoLaunches()
    await play.click({ timeout: TIMEOUT_MS })
    await waitFor(() => demoLaunches() === before + 1, `a launch without a dialog (${why})`)
    if ((await dialog.count()) !== 0)
      throw new Error(`replays-mod-warning: no dialog expected (${why})`)
    await waitForExit()
  }

  step('the settings switch silences and restores the warning')
  await openSettings()
  await setSwitch(false)
  await shot('settings-switch-off')
  await openDemos()
  await viewPlaysWithoutDialog('switch off')
  await openSettings()
  await setSwitch(true)
  await openDemos()
  await viewPlaysWithoutDialog('switch on, opentdm remembered')

  step('resetting remembered mods asks again')
  await openSettings()
  await resetBtn.click({ timeout: TIMEOUT_MS })
  await waitForStateJson(
    variantUserDataDir('replays-play'),
    (doc) => trustedModsOf(doc).length === 0,
    'state.json trustedMods to be empty after Reset',
  )
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="replays-mod-warning-reset"]')?.hasAttribute('disabled'),
    undefined,
    { timeout: TIMEOUT_MS },
  )
  if (/opentdm/.test((await trustedText.textContent()) ?? '')) {
    throw new Error('replays-mod-warning: the remembered list must be empty after Reset')
  }
  await shot('settings-reset')
  await openDemos()
  const launchesAfterReset = launchCount()
  await play.click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-mod-missing-cancel').click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  if (launchCount() !== launchesAfterReset)
    throw new Error('replays-mod-warning: Cancel must not launch')
  await openSettings()
  await setSwitch(false)
  await openDemos()
  await viewPlaysWithoutDialog('turned off, no demo asks')
  await openSettings()
  await setSwitch(true)

  step('cleanup: reset the trusted mods so the flow leaves defaults')
  await page.evaluate(() =>
    window.q2.invoke('module:invoke', { moduleId: 'replays', type: 'modWarning.resetTrusted' }),
  )
  await waitForStateJson(
    variantUserDataDir('replays-play'),
    (doc) => trustedModsOf(doc).length === 0,
    'state.json trustedMods to be empty again',
  )
}
