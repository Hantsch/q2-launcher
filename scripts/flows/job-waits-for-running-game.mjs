// Story 091 (docs/requirements/091-writes-wait-for-a-running-game.md) D8: the story's offline
// end-to-end proof. Drives the real app, no network access, and proves the whole
// wait-then-continue mechanism the guard adds: a write into a running installation is deferred and
// visible as `waiting` (AC1/AC2), it resumes on its own once the game exits (AC3), cancelling a
// waiting job leaves nothing behind (AC6), and a job that holds the write lock disables Play and
// makes `launch:start` refuse (AC5).
//
// This is a structural sibling of `scripts/flows/retail-upgrade.mjs` (090 D6), reused almost
// verbatim for its fixture/harness plumbing (the demo installation, the two fixture store sources,
// the `Q2L_UI_HARNESS_STORE_SOURCES` override, `dev:simulateLaunch`) rather than duplicated blind -
// see that file's own header for the fuller writeup of why each piece works the way it does. The
// difference is what this flow actually asserts: 090's own flow already proves the upgrade job
// waits instead of refusing (091 Decisions); this flow is the guard's OWN acceptance surface -
// the waiting reason on both the Downloads tab and the action bar, the resume-on-exit, the cancel
// cleanup, and the independent write-lock/launch-refusal path (091's actual AC1-AC6), none of which
// 090's own flow was written to check.
//
// ## Passes, and why they run in this order in ONE app session
//
// 1. **AC1/AC2/AC6** — start the upgrade while the game is reported running, assert nothing is
//    written and the waiting reason names the running game on both the Downloads tab
//    (`downloads-job-waiting-<id>`) and the action bar's `JobReadout`, then cancel it from the
//    Downloads tab's own `downloads-job-cancel-<id>` button and assert nothing was written and no
//    staging directory survives. This MUST run before the successful pass below: it needs a
//    pristine, still-demo-sized `pak0.pak` to prove "wrote nothing", and a successful upgrade would
//    permanently consume that.
// 2. **AC3** — start the upgrade again (still running), then flip `dev:simulateLaunch` to `idle`
//    with no further UI interaction; the job finishes on its own and the paks are retail-sized on
//    disk afterwards.
// 3. **AC5** — independent of the retail-upgrade job entirely: D7's `dev:simulateJob({ scenario:
//    'writing', installationId })` takes the REAL write lock on the same installation (now already
//    upgraded, which does not matter to the guard), and this asserts the action bar's Play button
//    is disabled and that `launch:start` refuses with `launch.error.installationBusy`.
//
// ## Selectors
//
// Reused as-is from `retail-upgrade.mjs`: `installation.action.importRetail`'s translated
// aria-label (no dedicated testid on the library-card trigger), `retail-upgrade-source-item`,
// `retail-upgrade-confirm`, `retail-upgrade-dismiss`, `bootstrap-running-step[data-status]`.
// New to this flow, both real, pre-existing testids (091 D1/D3 - see
// `src/renderer/src/modules/downloads/components/JobRow.tsx`):
//   downloads-job-waiting-<jobId>   JobRow.tsx - the waiting reason line under a `waiting` job row
//   downloads-job-cancel-<jobId>    JobRow.tsx - that row's own cancel button
//   actionbar-play                  ActionBar.tsx - `data-action`/`disabled` mirror `resolvePrimaryAction`
// `launch:start`'s refusal (AC5b) is asserted directly against the real IPC response
// (`window.q2.invoke('launch:start', { installationId })`) rather than through a click: the Play
// button is disabled by design at that point (AC5a), and a disabled `<button>` never dispatches a
// click event at all, so there is no UI path left to drive a toast through. The main process is the
// authoritative refusal surface anyway (091 Decisions: "the authoritative refusal is never derived
// from renderer-visible data"), so asserting the IPC outcome's `error.key` is the strongest, not a
// weaker, proof of AC5b.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  INSTALL_DEMO_UPGRADE_ID,
  INSTALL_DEMO_UPGRADE_NAME,
  RETAIL_PAK_SIZES,
  RETAIL_UPGRADE_MARKER_FILE,
  installationConfigFilePath,
  writeBootstrapStoreSources,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** Mirrors `retail-upgrade.mjs`'s own budget for the same real copy+promote job. */
const JOB_TIMEOUT_MS = 60_000

/** Mirrors `src/renderer/src/i18n/locales/en.json`'s `installation.action.importRetail`. */
const IMPORT_RETAIL_LABEL = 'Import retail data…'

/** A staging directory this job would leave behind mid-copy (`upgrade-job.ts`'s
 * `STAGING_DIR_PREFIX`, `.q2launcher-upgrade-<jobId>`) - AC6 asserts none survives a cancel. */
const STAGING_DIR_PATTERN = /^\.q2launcher-upgrade-/

let storeSources = null

export async function setup() {
  // Same as `retail-upgrade.mjs`'s own `setup()`: reseed fresh so a previous run's upgrade never
  // leaves a retail-sized pak0.pak behind for this one to find.
  writePopulatedFixture()
  storeSources = writeBootstrapStoreSources()
  return {
    env: {
      Q2L_UI_HARNESS_STORE_SOURCES: JSON.stringify(storeSources),
    },
  }
}

function libraryCard(page, name) {
  return page
    .locator('div.items-start')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
}

function importRetailButton(scope) {
  return scope.getByRole('button', { name: IMPORT_RETAIL_LABEL })
}

async function simulateLaunch(page, installationId, phase) {
  const outcome = await page.evaluate(
    ({ id, ph }) => window.q2.invoke('dev:simulateLaunch', { installationId: id, phase: ph }),
    { id: installationId, ph: phase },
  )
  if (!outcome?.ok) {
    throw new Error(`dev:simulateLaunch(${phase}) failed: ${JSON.stringify(outcome)}`)
  }
}

/** Reads back the one job the harness cares about - installation id plus status - rather than
 * threading a jobId through component state neither this flow nor the dialog exposes directly. */
async function findJob(page, installationId, status) {
  const jobs = await page.evaluate(() => window.q2.invoke('jobs:list'))
  return jobs.find((job) => job.installationId === installationId && job.status === status) ?? null
}

/** Starts the retail-upgrade dialog from the library card, picks the one verified fixture source,
 * and confirms - mirrors `retail-upgrade.mjs`'s own "AC2: choose the verified source" step, minus
 * the AC2/AC6 source-list assertions that flow already owns. */
async function startUpgradeFromCard(page, card) {
  await importRetailButton(card).click({ timeout: TIMEOUT_MS })
  const verifiedRow = page.locator('[data-testid="retail-upgrade-source-item"][data-index="1"]')
  await verifiedRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await verifiedRow.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('retail-upgrade-confirm').click({ timeout: TIMEOUT_MS })
}

function playButtonWithDisabled(page, disabled) {
  const attr = disabled ? '[disabled]' : ':not([disabled])'
  return page.locator(`button[data-testid="actionbar-play"]${attr}`)
}

export default async function jobWaitsForRunningGame({ page, step, shot }) {
  const pak0Path = installationConfigFilePath(INSTALL_DEMO_UPGRADE_ID, 'pak0.pak')
  const pak1Path = installationConfigFilePath(INSTALL_DEMO_UPGRADE_ID, 'pak1.pak')
  const pak2Path = installationConfigFilePath(INSTALL_DEMO_UPGRADE_ID, 'pak2.pak')
  const markerPath = installationConfigFilePath(INSTALL_DEMO_UPGRADE_ID, RETAIL_UPGRADE_MARKER_FILE)
  const baseDir = dirname(pak0Path)

  step('record the fixture demo installation before any job runs')
  const pak0SizeBefore = statSync(pak0Path).size
  if (pak0SizeBefore === RETAIL_PAK_SIZES['pak0.pak']) {
    throw new Error('fixture bug: the demo installation already has a retail-sized pak0.pak')
  }
  const filesBefore = readdirSync(baseDir).sort()

  step('open the library and select the demo installation')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  const card = libraryCard(page, INSTALL_DEMO_UPGRADE_NAME)
  await card.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await card.getByRole('button', { name: INSTALL_DEMO_UPGRADE_NAME, exact: true }).click({ timeout: TIMEOUT_MS })
  await page
    .locator('footer')
    .filter({ hasText: INSTALL_DEMO_UPGRADE_NAME })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // --- AC1/AC2/AC6: waiting while running, named on both surfaces, then cancelled clean ----------
  step('AC1: simulate the game running, then start the upgrade - it must write nothing')
  await simulateLaunch(page, INSTALL_DEMO_UPGRADE_ID, 'running')
  await startUpgradeFromCard(page, card)
  const waitingStep = page.locator('[data-testid="bootstrap-running-step"][data-status="waiting"]')
  await waitingStep.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (statSync(pak0Path).size !== pak0SizeBefore) {
    throw new Error('the waiting job wrote to pak0.pak before the game exited (AC1)')
  }
  await shot('waiting-in-dialog')

  step('AC2: the action-bar readout names the running game as the reason')
  const footerWaitingText = page.locator('footer').getByText(/waiting for the game to close/i)
  await footerWaitingText.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('waiting-actionbar-readout')

  step('AC2: the Downloads tab names the same reason on the job row')
  await page.getByTestId('retail-upgrade-dismiss').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await page.getByTestId('nav-downloads').click({ timeout: TIMEOUT_MS })
  const waitingJob = await findJob(page, INSTALL_DEMO_UPGRADE_ID, 'waiting')
  if (!waitingJob) {
    throw new Error('expected a waiting job for the demo installation after dismissing the dialog')
  }
  const waitingRow = page.getByTestId(`downloads-job-waiting-${waitingJob.id}`)
  await waitingRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const waitingRowText = await waitingRow.innerText()
  if (!/waiting for the game to close/i.test(waitingRowText)) {
    throw new Error(
      `expected the Downloads tab row to name the running game as its reason (AC2), got: ${JSON.stringify(waitingRowText)}`,
    )
  }
  await shot('waiting-downloads-tab')

  step('AC6: cancelling the waiting job leaves no partial files behind')
  await page.getByTestId(`downloads-job-cancel-${waitingJob.id}`).click({ timeout: TIMEOUT_MS })
  await waitingRow.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  if (statSync(pak0Path).size !== pak0SizeBefore) {
    throw new Error('cancelling the waiting job changed pak0.pak (AC6)')
  }
  const filesAfterCancel = readdirSync(baseDir).sort()
  if (JSON.stringify(filesAfterCancel) !== JSON.stringify(filesBefore)) {
    throw new Error(
      `expected baseq2 to hold exactly ${JSON.stringify(filesBefore)} after cancelling, found ${JSON.stringify(filesAfterCancel)} (AC6)`,
    )
  }
  if (filesAfterCancel.some((name) => STAGING_DIR_PATTERN.test(name))) {
    throw new Error(`a staging directory survived the cancel: ${JSON.stringify(filesAfterCancel)} (AC6)`)
  }
  await shot('cancelled-no-partial-files')

  // --- AC3: the deferred write resumes on its own once the game exits ----------------------------
  step('AC3: start the upgrade again while running, then simulate the game exiting')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await card.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await startUpgradeFromCard(page, card)
  await waitingStep.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (statSync(pak0Path).size !== pak0SizeBefore) {
    throw new Error('the second waiting job wrote to pak0.pak before the game exited (AC1, re-check)')
  }

  step('AC3: no further UI action - simulate idle and let the job finish on its own')
  await simulateLaunch(page, INSTALL_DEMO_UPGRADE_ID, 'idle')
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('resumed-and-succeeded')

  const pak0SizeAfter = statSync(pak0Path).size
  const pak1SizeAfter = statSync(pak1Path).size
  if (pak0SizeAfter !== RETAIL_PAK_SIZES['pak0.pak']) {
    throw new Error(`expected pak0.pak to be ${RETAIL_PAK_SIZES['pak0.pak']} bytes, got ${pak0SizeAfter} (AC3)`)
  }
  if (pak1SizeAfter !== RETAIL_PAK_SIZES['pak1.pak']) {
    throw new Error(`expected pak1.pak to be ${RETAIL_PAK_SIZES['pak1.pak']} bytes, got ${pak1SizeAfter} (AC3)`)
  }
  const filesAfterUpgrade = readdirSync(baseDir).sort()
  if (filesAfterUpgrade.some((name) => STAGING_DIR_PATTERN.test(name))) {
    throw new Error(`a staging directory survived the successful upgrade: ${JSON.stringify(filesAfterUpgrade)}`)
  }
  if (existsSync(pak2Path)) {
    throw new Error('pak2.pak was copied - out of scope for this job (see retail-upgrade.mjs AC4)')
  }
  const markerAfterUpgrade = readFileSync(markerPath)
  if (!markerAfterUpgrade.length) {
    throw new Error('the marker file went missing after the upgrade')
  }

  await page.getByTestId('retail-upgrade-dismiss').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  // --- AC5: a write-lock-holding job disables Play and launch:start refuses ----------------------
  step("AC5: dev:simulateJob('writing') takes the real write lock on this installation")
  const writingOutcome = await page.evaluate(
    (installationId) =>
      window.q2.invoke('dev:simulateJob', { scenario: 'writing', installationId }),
    INSTALL_DEMO_UPGRADE_ID,
  )
  if (!writingOutcome?.ok) {
    throw new Error(`dev:simulateJob('writing') failed: ${JSON.stringify(writingOutcome)}`)
  }

  step('AC5: the Play button is disabled while the write lock is held')
  await playButtonWithDisabled(page, true).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('play-disabled-write-locked')

  step('AC5: launch:start refuses with launch.error.installationBusy')
  const launchOutcome = await page.evaluate(
    (installationId) => window.q2.invoke('launch:start', { installationId }),
    INSTALL_DEMO_UPGRADE_ID,
  )
  if (launchOutcome?.ok) {
    throw new Error('expected launch:start to refuse while a job holds the write lock (AC5)')
  }
  if (launchOutcome?.error?.key !== 'launch.error.installationBusy') {
    throw new Error(
      `expected launch.error.installationBusy, got: ${JSON.stringify(launchOutcome?.error)} (AC5)`,
    )
  }

  step('cleanup: cancel the dev-only writing job so it does not outlive this run')
  const writingJob = await findJob(page, INSTALL_DEMO_UPGRADE_ID, 'running')
  if (writingJob) {
    const cancelOutcome = await page.evaluate(
      (jobId) => window.q2.invoke('jobs:cancel', jobId),
      writingJob.id,
    )
    if (!cancelOutcome?.ok) {
      throw new Error(`jobs:cancel(${writingJob.id}) failed: ${JSON.stringify(cancelOutcome)}`)
    }
  }
  await playButtonWithDisabled(page, false).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  console.log(
    'job-waits-for-running-game: starting the upgrade while the game ran wrote nothing and named ' +
      'the reason on both the Downloads tab and the action bar, cancelling it left no partial files, ' +
      'simulating the game exit resumed and finished the job with no user action, and a job holding ' +
      "the write lock disabled Play and made launch:start refuse with launch.error.installationBusy",
  )
}
