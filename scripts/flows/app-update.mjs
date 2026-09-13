// Story 098 (docs/requirements/098-i-update-when-i-choose-to.md) D5: the offline end-to-end proof.
// Drives the real app, no network access, and proves the whole staged-update mechanism D1-D4 add:
// the titlebar control only exists while an update is known (AC1), its popover names the version
// and links to what changed (AC2), a download shows live progress without freezing the launcher
// (AC3), a finished download waits for a second confirmation before anything installs (AC4),
// dismissing quiets the nag for the session without losing the control (AC5), the restart guard
// refuses while a game or a job is active without touching either (AC6), a failed download always
// falls back to a still-offerable `available` state with its reason (AC7), and reaching parity with
// the running version makes the control disappear (AC8's control-disappears half; the other half -
// a real restart relaunching into the new build - is manual residue per the story, not attempted
// here).
//
// This is a structural sibling of `job-waits-for-running-game.mjs` (091 D8): same harness
// (`withApp` via `flow.mjs`), same "drive a dev-only channel, assert the real DOM/state" shape, same
// `dev:simulateLaunch`/`dev:simulateJob` calls for the two restart-guard refusals. What is new here
// is `dev:simulateAppUpdate` (098 D4) - every phase transition except the guarded
// `update:installAndRestart` itself is driven through it, exactly as `UpdateService.simulate()`'s
// own doc comment describes: it writes into the same closure-scoped `facts`/`stage` the real actions
// read, so `update:installAndRestart` runs its real, unfaked guard once `{scenario:'downloaded'}` has
// staged a release. `update:cancelDownload`/a real `update:download` are deliberately never called -
// AC7's `cancelled` reason is exercised through `dev:simulateAppUpdate({scenario:'error',
// reason:'cancelled'})` instead (the story's own Acceptance Tests section lists all three AC7
// reasons that way), so there is no need to touch the real backend at all.
//
// ## Passes, and why they run in this order in ONE app session
//
// 1. **AC1** - assert no control at all while nothing is known, then simulate an available release
//    and assert the control appears, in DOM order, before `nav-downloads`.
// 2. **AC2** - open the popover, assert it names the version, and follow "what changed" into
//    Settings -> About (`settings-about`).
// 3. **AC5** - reopen the popover (phase still `available`), assert the attention dot, dismiss, and
//    reload the renderer: the control survives the reload and the dot does not come back (dismissal
//    is in-memory in *main*, not renderer state, so a renderer-only reload must not resurrect it).
//    This has to run before the download starts: the attention dot's whole story is "available and
//    not yet acted on or dismissed", which stops being true the moment a download starts anyway.
// 4. **AC3** - drive three `progress` ticks while navigating Library and Config in between, and
//    assert the popover's own progress readout (`aria-valuenow`) advances each time - proving the
//    launcher stayed responsive to unrelated navigation while "downloading".
// 5. **AC4** - stage a finished download and assert nothing installs itself: the phase (read back
//    through the real `update:getState` IPC call, not just the DOM) stays `downloaded` on its own,
//    and the app is still here to ask - if a real `quitAndInstall()` had fired, there would be no
//    app left to keep driving this flow.
// 6. **AC6** - with the release staged `downloaded`, refuse a real `update:installAndRestart` twice:
//    once with `dev:simulateLaunch('running')`, once with `dev:simulateJob('stall')` - asserting the
//    popover's own inline reason, the real IPC call's `error.key`, and that the thing being refused
//    for (the launch state, the job) is untouched by the refusal.
// 7. **AC7** - for each of `offline`/`checksum`/`cancelled`, simulate the failure and assert the
//    phase falls back to `available` with the reason shown and the Download button offerable again.
// 8. **AC8** - simulate `upToDate` and assert the control (and, with it, the popover it owned) is
//    gone from the DOM.
//
// ## Selectors
//
// All real, pre-existing testids from D2/D3 (`UpdateButton.tsx`/`UpdatePopover.tsx`) - see those
// files before changing any of the strings below:
//   nav-update                    UpdateButton.tsx - the titlebar control itself
//   nav-update-attention          UpdateButton.tsx - the "not yet looked at" dot
//   update-popover                UpdatePopover.tsx - the popover's own content container
//   update-popover-version        UpdatePopover.tsx - names the version
//   update-popover-whatchanged    UpdatePopover.tsx - link into Settings -> About
//   update-popover-available      UpdatePopover.tsx - the `available` phase's own container
//   update-popover-download       UpdatePopover.tsx - "Download"
//   update-popover-download-error UpdatePopover.tsx - a carried-over download failure's reason
//   update-popover-downloading    UpdatePopover.tsx - the `downloading` phase's own container
//   update-popover-restart        UpdatePopover.tsx - "Restart and install"
//   update-popover-refusal        UpdatePopover.tsx - the guard's reason, in place of the button
//   update-popover-dismiss        UpdatePopover.tsx - always present, every phase
//   settings-about                SettingsView.tsx - 099's anchor, added for this story's AC2
// `nav-downloads` is TitleBar.tsx's own pre-existing testid for the Downloads utility button, reused
// here only as AC1's DOM-order reference point.
import { INSTALL_ONE_ID } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

const VERSION = '9.9.9-e2e'
const NOTES = 'Offline UI-verification fixture release notes.'

/** Mirrors `src/renderer/src/i18n/locales/en.json`'s `appUpdate.error.*` - the repo ships only `en`
 * (CLAUDE.md), so asserting the exact rendered string is as strong as asserting the key. */
const ERROR_TEXT = {
  gameRunning: 'Quake II is still running. Close it before installing the update.',
  jobActive: 'A download is still in progress. Wait for it to finish before installing the update.',
  offline: 'Could not download the update. Check your internet connection.',
  checksum: 'The downloaded update failed verification and was discarded.',
  cancelled: 'The download was cancelled.',
}

async function invoke(page, channel, payload) {
  const outcome = await page.evaluate(
    ({ ch, p }) => window.q2.invoke(ch, p),
    { ch: channel, p: payload },
  )
  return outcome
}

async function invokeOk(page, channel, payload, label) {
  const outcome = await invoke(page, channel, payload)
  if (outcome !== undefined && outcome !== null && outcome.ok === false) {
    throw new Error(`${label ?? channel} failed: ${JSON.stringify(outcome)}`)
  }
  return outcome
}

function simulateAppUpdate(page, scenario) {
  return invokeOk(page, 'dev:simulateAppUpdate', scenario, `dev:simulateAppUpdate(${scenario.scenario})`)
}

async function getUpdateState(page) {
  return page.evaluate(() => window.q2.invoke('update:getState'))
}

async function domOrderBefore(page, firstTestId, secondTestId) {
  return page.evaluate(
    ({ first, second }) => {
      const all = [...document.querySelectorAll('[data-testid]')]
      const firstIndex = all.findIndex((el) => el.getAttribute('data-testid') === first)
      const secondIndex = all.findIndex((el) => el.getAttribute('data-testid') === second)
      return firstIndex !== -1 && secondIndex !== -1 && firstIndex < secondIndex
    },
    { first: firstTestId, second: secondTestId },
  )
}

export default async function appUpdateFlow({ page, step, shot }) {
  step('AC1: no control while up to date')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  if ((await page.getByTestId('nav-update').count()) !== 0) {
    throw new Error('expected no nav-update control before any update is known (AC1)')
  }

  step('AC1: the control appears left of Downloads once an update is available')
  await simulateAppUpdate(page, { scenario: 'available', version: VERSION, notes: NOTES })
  await page.getByTestId('nav-update').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await domOrderBefore(page, 'nav-update', 'nav-downloads'))) {
    throw new Error('expected nav-update to sit before nav-downloads in DOM order (AC1)')
  }
  await shot('control-appears')

  step('AC2: the popover names the version and links to what changed')
  await page.getByTestId('nav-update').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('update-popover').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const versionText = await page.getByTestId('update-popover-version').innerText()
  if (!versionText.includes(VERSION)) {
    throw new Error(`expected the popover to name version ${VERSION}, got: ${JSON.stringify(versionText)} (AC2)`)
  }
  await shot('popover-available')
  await page.getByTestId('update-popover-whatchanged').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('settings-about').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('update-popover').waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('AC5: dismissing stops the prompt for this session and leaves the control reachable')
  await page.getByTestId('nav-update').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('update-popover').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('nav-update-attention').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('update-popover-dismiss').click({ timeout: TIMEOUT_MS })
  if ((await page.getByTestId('nav-update-attention').count()) !== 0) {
    throw new Error('expected the attention dot to be gone right after dismissing (AC5)')
  }
  if ((await page.getByTestId('nav-update').count()) !== 1) {
    throw new Error('expected the update control to stay reachable after dismissing (AC5)')
  }

  step('AC5: a renderer reload does not resurrect the prompt, and nothing was installed')
  await page.reload({ timeout: TIMEOUT_MS * 2 })
  await page.getByTestId('nav-home').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('nav-update').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await page.getByTestId('nav-update-attention').count()) !== 0) {
    throw new Error('expected the attention dot to stay gone across a renderer reload (AC5)')
  }
  const stateAfterReload = await getUpdateState(page)
  if (stateAfterReload.phase !== 'available') {
    throw new Error(
      `expected phase to still be 'available' after dismissing and reloading, got ${JSON.stringify(stateAfterReload)} (AC5)`,
    )
  }
  await shot('dismissed-survives-reload')

  step('AC3: downloading shows progress and the launcher stays usable')
  await page.getByTestId('nav-update').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('update-popover-available').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await simulateAppUpdate(page, { scenario: 'progress', ratio: 0.1 })
  const progressBarSelector = '[data-testid="update-popover"] [role="progressbar"]'
  await page.waitForSelector(progressBarSelector, { state: 'visible', timeout: TIMEOUT_MS })
  const readingInDom = () =>
    page.evaluate((selector) => {
      const el = document.querySelector(selector)
      return el ? Number(el.getAttribute('aria-valuenow')) : null
    }, progressBarSelector)
  const firstReading = await readingInDom()
  if (!(firstReading >= 5 && firstReading <= 15)) {
    throw new Error(`expected an early progress reading near 10%, got ${firstReading} (AC3)`)
  }
  await shot('downloading-progress')

  // A click anywhere outside the popover closes it (Popover.tsx's own, correct, outside-click
  // behaviour) - that is not this criterion's concern. What AC3 actually claims is that the
  // launcher itself is not blocked while a download runs: real nav clicks land and the download's
  // own progress keeps moving forward regardless, provable through the same real `update:getState`
  // IPC call the titlebar control itself is fed by, not just the DOM this one popover happens to own.
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-library').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await simulateAppUpdate(page, { scenario: 'progress', ratio: 0.5 })
  const midState = await getUpdateState(page)
  if (midState.phase !== 'downloading' || !(midState.progress?.ratio > 0.1)) {
    throw new Error(
      `expected progress to keep advancing while on Library, got ${JSON.stringify(midState)} (AC3)`,
    )
  }

  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-config').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await simulateAppUpdate(page, { scenario: 'progress', ratio: 0.9 })
  const lateState = await getUpdateState(page)
  if (lateState.phase !== 'downloading' || !(lateState.progress?.ratio > midState.progress.ratio)) {
    throw new Error(
      `expected progress to keep advancing while on Config, got ${JSON.stringify(lateState)} (AC3)`,
    )
  }

  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  // Reopen the popover back on Home: the same, real, still-running download it left behind on
  // Library/Config is the one this shows, its readout now reflecting the later ratio.
  await page.getByTestId('nav-update').click({ timeout: TIMEOUT_MS })
  await page.waitForSelector(progressBarSelector, { state: 'visible', timeout: TIMEOUT_MS })
  const finalDomReading = await readingInDom()
  if (!(finalDomReading > firstReading)) {
    throw new Error(
      `expected the reopened popover to show advanced progress (${firstReading} -> ${finalDomReading}) (AC3)`,
    )
  }

  step('AC4: a finished download installs nothing until the second confirmation')
  await simulateAppUpdate(page, { scenario: 'downloaded' })
  await page.getByTestId('update-popover-restart').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const stateJustDownloaded = await getUpdateState(page)
  if (stateJustDownloaded.phase !== 'downloaded') {
    throw new Error(`expected phase 'downloaded' right after staging, got ${JSON.stringify(stateJustDownloaded)} (AC4)`)
  }
  // Nothing about a staged download resolves itself: read the state back again without touching
  // anything in between. If a real `quitAndInstall()` had fired on its own, this app would already be
  // gone and every call above and below would have failed instead.
  const stateStillDownloaded = await getUpdateState(page)
  if (stateStillDownloaded.phase !== 'downloaded') {
    throw new Error(
      `expected phase to still be 'downloaded' with no action taken, got ${JSON.stringify(stateStillDownloaded)} (AC4)`,
    )
  }
  await shot('downloaded-awaiting-confirmation')

  step('AC6: restart-and-install is refused while a game launched by this launcher is running')
  await invokeOk(page, 'dev:simulateLaunch', { installationId: INSTALL_ONE_ID, phase: 'running' })
  await page.getByTestId('update-popover-restart').click({ timeout: TIMEOUT_MS })
  const refusalGameRunning = await page.getByTestId('update-popover-refusal').innerText()
  if (!refusalGameRunning.includes(ERROR_TEXT.gameRunning)) {
    throw new Error(
      `expected the popover to show the game-running refusal, got: ${JSON.stringify(refusalGameRunning)} (AC6)`,
    )
  }
  await shot('restart-refused-game-running')
  const directRefusalGameRunning = await invoke(page, 'update:installAndRestart')
  if (directRefusalGameRunning?.ok !== false || directRefusalGameRunning.error?.key !== 'appUpdate.error.gameRunning') {
    throw new Error(
      `expected a direct update:installAndRestart call to refuse with appUpdate.error.gameRunning, got: ${JSON.stringify(directRefusalGameRunning)} (AC6)`,
    )
  }
  const launchStateStillRunning = await page.evaluate(() => window.q2.invoke('launch:getState'))
  if (launchStateStillRunning.phase !== 'running') {
    throw new Error(
      `expected the simulated game to survive the refused restart, got phase ${JSON.stringify(launchStateStillRunning)} (AC6)`,
    )
  }
  await invokeOk(page, 'dev:simulateLaunch', { installationId: INSTALL_ONE_ID, phase: 'idle' })

  step('AC6: restart-and-install is refused while a download job is in flight')
  await invokeOk(page, 'dev:simulateJob', { scenario: 'stall' })
  // The first refusal's reason replaces the button with plain text and nothing in the UI un-does
  // that (UpdatePopover.tsx's `refusalKey` is local state, cleared only when the popover unmounts) -
  // closing and reopening it is the same real interaction a user retrying a second time would do.
  await page.keyboard.press('Escape')
  await page.getByTestId('update-popover').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await page.getByTestId('nav-update').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('update-popover-restart').click({ timeout: TIMEOUT_MS })
  const refusalJobActive = await page.getByTestId('update-popover-refusal').innerText()
  if (!refusalJobActive.includes(ERROR_TEXT.jobActive)) {
    throw new Error(
      `expected the popover to show the job-active refusal, got: ${JSON.stringify(refusalJobActive)} (AC6)`,
    )
  }
  await shot('restart-refused-job-active')
  const directRefusalJobActive = await invoke(page, 'update:installAndRestart')
  if (directRefusalJobActive?.ok !== false || directRefusalJobActive.error?.key !== 'appUpdate.error.jobActive') {
    throw new Error(
      `expected a direct update:installAndRestart call to refuse with appUpdate.error.jobActive, got: ${JSON.stringify(directRefusalJobActive)} (AC6)`,
    )
  }
  const jobsAfterRefusal = await page.evaluate(() => window.q2.invoke('jobs:list'))
  const stallJob = jobsAfterRefusal.find((job) => job.status === 'running')
  if (!stallJob) {
    throw new Error('expected the simulated job to survive the refused restart (AC6)')
  }

  const stateStillDownloadedAfterGuards = await getUpdateState(page)
  if (stateStillDownloadedAfterGuards.phase !== 'downloaded') {
    throw new Error(
      `expected phase to still be 'downloaded' after both refusals, got ${JSON.stringify(stateStillDownloadedAfterGuards)} (AC4/AC6)`,
    )
  }

  step('cleanup: cancel the dev-only job so it does not outlive this run')
  await invokeOk(page, 'jobs:cancel', stallJob.id)

  step('AC7: offline, checksum mismatch and cancelled each leave the launcher untouched and stay offerable')
  for (const reason of ['offline', 'checksum', 'cancelled']) {
    await simulateAppUpdate(page, { scenario: 'error', reason })
    await page.getByTestId('update-popover-available').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const errorText = await page.getByTestId('update-popover-download-error').innerText()
    if (!errorText.includes(ERROR_TEXT[reason])) {
      throw new Error(
        `expected the '${reason}' failure to show its own reason, got: ${JSON.stringify(errorText)} (AC7)`,
      )
    }
    await page.getByTestId('update-popover-download').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const stateAfterFailure = await getUpdateState(page)
    if (stateAfterFailure.phase !== 'available') {
      throw new Error(
        `expected the '${reason}' failure to fall back to phase 'available', got ${JSON.stringify(stateAfterFailure)} (AC7)`,
      )
    }
    await shot(`download-failed-${reason}`)
  }

  step('AC8: once the running version matches, the control is gone')
  await simulateAppUpdate(page, { scenario: 'upToDate' })
  await page.getByTestId('nav-update').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  if ((await page.getByTestId('update-popover').count()) !== 0) {
    throw new Error('expected the popover to disappear along with the control (AC8)')
  }
  await shot('up-to-date-control-gone')

  console.log(
    'app-update: the control stays absent until an update is known and disappears again once up to ' +
      "date, its popover names the version and links to what changed, a download's progress advances " +
      'while the launcher keeps navigating, a finished download waits for an explicit restart, the ' +
      'restart guard refuses while a game or a job is active without touching either, and a failed ' +
      'download always leaves the update offerable with its reason shown',
  )
}
