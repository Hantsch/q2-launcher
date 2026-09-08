// Story 073 (docs/requirements/073-downloads-tab-shows-jobs-and-failures.md) D6 acceptance flow:
// the Downloads tab's live states that a static `state.json` fixture cannot seed (Decisions
// (Sprint), "Fixture split") - a live running job and a live failed job both need a real
// `dev:simulateJob` round trip, so they live here rather than in `scripts/lib/screens.mjs`
// (which only shows the zero-jobs state, see that file's `downloads` entry's own D6 comment).
//
// Walks: the real view renders (not `PlannedModuleView`, AC4) -> the archive cache figure is
// shown (AC3) -> a stalled job (D5's `stall` scenario) shows bytes/speed/ETA (AC1) -> a failed
// job (D5's `failure` scenario) leaves a translated failure-log entry (AC2) -> dismissing it
// moves it into the collapsed "dismissed" disclosure, and restoring it brings it back (AC2).
//
// Selectors, not guesses - read `src/renderer/src/modules/downloads/DownloadsView.tsx`,
// `components/JobRow.tsx`, `components/FailureLogEntry.tsx` and `src/renderer/src/views/
// SettingsView.tsx`'s dev panel before changing any of these:
//   nav-downloads                    TitleBar.tsx (utility cluster, story 031)
//   nav-settings                     TitleBar.tsx
//   "Simulate a stalled job"         SettingsView.tsx dev panel button (D5, no testid - translated
//                                    accessible name, `settings.simulateJobStall`)
//   "Simulate a failed job"          SettingsView.tsx dev panel button (D5, `settings.simulateJobFailure`)
//   downloads-job-<jobId>            JobRow.tsx - `data-status` attribute carries the job's status
//   downloads-job-cancel-<jobId>     JobRow.tsx - only rendered while `job.cancellable`
//   downloads-failure-<failureId>    FailureLogEntry.tsx
//   downloads-failure-dismiss-<id>   FailureLogEntry.tsx - undismissed entry's action
//   downloads-failure-restore-<id>   FailureLogEntry.tsx - dismissed entry's action (inside the
//                                    collapsed disclosure)
//
// `dev:simulateJob` is the flow's only job source (D5) - no network, per AC5's own text ("No
// network: the flow's only job source is the dev-only `dev:simulateJob` channel"). The dev panel
// only renders while `appInfo.isDev` is true (`SettingsView.tsx`), which is exactly the same
// condition that registers the channel at all (`src/main/ipc/index.ts`'s `if (app.isDev)
// registerDevIpc(app)`) - the harness always runs an unpackaged build, so both are true here the
// same way `scripts/flows/import-from-files.mjs` already relies on `isDev` for its own dev-only
// surface (the `DialogService` harness stub).
//
// Unlike `ui:shot`/`ui:a11y`/`ui:verify`, `ui:flow` never reseeds the fixture before launching
// (`scripts/flow.mjs`'s `withApp()` opens `.ui-verify/fixture/populated/userdata` as-is, mirroring
// every other flow's own doc comment on this) - the stalled job this flow starts never finishes on
// its own (D5: "held at ~40%... the dev panel's job list is how it goes away (cancel)"), so a
// second run in the same session would find it still `running` from the previous run. That is
// harmless here: the flow only ever asserts "at least one running job with real progress figures
// exists", never "exactly one", and starting a second stalled job changes nothing this flow checks.
import { DOWNLOADS_CACHE_ITEM_COUNT } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** Long enough for `dev:simulateJob`'s round trip plus the store's `jobs:changed` re-render. */
const JOB_TIMEOUT_MS = 15_000

/** Mirrors `scripts/flows/settings-downloads-section.mjs`'s own constant: `formatBytes` for the
 * fixture's exact two seeded archives (3 MB + 1 MB = 4 MB), chosen so the assertion never depends
 * on rounding behaviour. */
const EXPECTED_CACHE_SIZE_TEXT = '4 MB'

/** The exact copy `PlannedModuleView` (`src/renderer/src/views/PlannedModuleView.tsx`) renders for
 * any module the shell has no renderer half for yet - AC4's "not the planned placeholder" has to
 * mean this text is absent, not merely that some other content is present alongside it. */
const PLANNED_PLACEHOLDER_TEXT = 'This part of the launcher is on the way, but it is not here yet.'

export default async function downloadsTab({ page, shot, step }) {
  step('open the Downloads tab')
  await page.getByTestId('nav-downloads').click({ timeout: TIMEOUT_MS })
  await page
    .getByText('Jobs you start will show their progress here.', { exact: true })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert the real view rendered, not the PlannedModuleView placeholder (AC4)')
  const bodyText = await page.evaluate(() => document.body.innerText)
  if (bodyText.includes(PLANNED_PLACEHOLDER_TEXT)) {
    throw new Error(
      `the downloads route still shows PlannedModuleView's placeholder copy ("${PLANNED_PLACEHOLDER_TEXT}") ` +
        'instead of the real DownloadsView (AC4)',
    )
  }
  if (await page.getByText('Planned', { exact: true }).count()) {
    throw new Error('a "Planned" badge is still visible on the downloads route (AC4)')
  }

  step('assert the archive cache size is shown (AC3)')
  const cacheSizeText = await page.getByText(/^Cache:/, { exact: false }).first().innerText()
  if (!cacheSizeText.includes(EXPECTED_CACHE_SIZE_TEXT) || !cacheSizeText.includes(String(DOWNLOADS_CACHE_ITEM_COUNT))) {
    throw new Error(
      `expected the cache KeyValue to mention ${EXPECTED_CACHE_SIZE_TEXT} and ` +
        `${DOWNLOADS_CACHE_ITEM_COUNT} archives, got: ${JSON.stringify(cacheSizeText)}`,
    )
  }

  await shot('empty-state')

  // --- AC1: a running (stalled) job shows bytes, speed and ETA ------------------------------------
  step('trigger a stalled job via the dev panel')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await page
    .getByRole('button', { name: 'Simulate a stalled job' })
    .click({ timeout: TIMEOUT_MS })

  step('return to Downloads and wait for the running job to render')
  await page.getByTestId('nav-downloads').click({ timeout: TIMEOUT_MS })
  const runningJob = page.locator('[data-testid^="downloads-job-"][data-status="running"]').first()
  await runningJob.waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })

  step('assert the running job shows bytes, speed and ETA (AC1)')
  const runningText = await runningJob.innerText()
  if (!/\d[\d.,]*\s*(B|KB|MB|GB)\s*\/\s*\d[\d.,]*\s*(B|KB|MB|GB)/.test(runningText)) {
    throw new Error(`expected a "bytesDone / bytesTotal" figure in the running job row, got: ${JSON.stringify(runningText)}`)
  }
  if (!/\d[\d.,]*\s*(KB|MB)\/s/.test(runningText)) {
    throw new Error(`expected a speed figure (KB/s or MB/s) in the running job row, got: ${JSON.stringify(runningText)}`)
  }
  if (!/left/.test(runningText)) {
    throw new Error(`expected an ETA ("... left") in the running job row, got: ${JSON.stringify(runningText)}`)
  }
  console.log(`running job row: ${JSON.stringify(runningText)}`)

  await shot('running-job')

  // --- AC2: a failed reason persists, dismisses and restores --------------------------------------
  step('trigger a failed job via the dev panel')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await page
    .getByRole('button', { name: 'Simulate a failed job' })
    .click({ timeout: TIMEOUT_MS })

  step('return to Downloads and wait for the failure-log entry to appear, translated (AC2)')
  await page.getByTestId('nav-downloads').click({ timeout: TIMEOUT_MS })
  const failureEntry = page.locator('[data-testid^="downloads-failure-"]').first()
  await failureEntry.waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  const failureText = await failureEntry.innerText()
  if (!failureText.includes('A network error interrupted the download.')) {
    throw new Error(
      `expected the failure entry to show the translated reason for downloads.error.network, got: ${JSON.stringify(failureText)}`,
    )
  }
  if (!/failed/i.test(failureText)) {
    throw new Error(`expected the failure entry to carry a "Failed" status badge, got: ${JSON.stringify(failureText)}`)
  }
  console.log(`failure entry: ${JSON.stringify(failureText)}`)

  await shot('failed-job')

  step('reload the tab and assert the failure reason still persists (AC2: "persists")')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-downloads').click({ timeout: TIMEOUT_MS })
  const failureEntryAfterRemount = page.locator('[data-testid^="downloads-failure-"]').first()
  await failureEntryAfterRemount.waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  const failureTextAfterRemount = await failureEntryAfterRemount.innerText()
  if (!failureTextAfterRemount.includes('A network error interrupted the download.')) {
    throw new Error(
      `expected the failure reason to still be visible after a DownloadsView remount, got: ${JSON.stringify(failureTextAfterRemount)}`,
    )
  }

  step('dismiss the failure and assert it moves into the collapsed "dismissed" disclosure')
  // `failure-log.ts` appends newest-first and this flow's own entry is the one just created, so
  // `.first()` throughout this section is always *this* entry - never a leftover from a previous,
  // un-reseeded `ui:flow` run (see the module doc comment above on why `ui:flow` never reseeds).
  // Its own `entryId` is read off the DOM once, up front, so the dismiss/restore assertions below
  // target this exact entry rather than "any dismiss/restore button on the page" - which would give
  // a false pass/fail once a second run leaves an older undismissed entry sitting alongside it.
  const entryId = (await failureEntryAfterRemount.getAttribute('data-testid')).replace(
    'downloads-failure-',
    '',
  )
  const dismissButton = page.getByTestId(`downloads-failure-dismiss-${entryId}`)
  const restoreButton = page.getByTestId(`downloads-failure-restore-${entryId}`)

  await dismissButton.click({ timeout: TIMEOUT_MS })

  const dismissedSummary = page.locator('summary', { hasText: 'Dismissed' })
  await dismissedSummary.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await dismissButton.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  await dismissedSummary.click({ timeout: TIMEOUT_MS })
  await restoreButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('failure-dismissed')

  step('restore the failure and assert it is back in the visible list')
  await restoreButton.click({ timeout: TIMEOUT_MS })
  await dismissButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('failure-restored')

  console.log(
    'downloads tab: real view renders (not the planned placeholder), cache size is shown, a ' +
      'running job shows bytes/speed/ETA, and a failed job persists/dismisses/restores its ' +
      'failure-log entry',
  )
}
