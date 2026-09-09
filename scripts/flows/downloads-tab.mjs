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
import { homedir } from 'node:os'
import { DOWNLOADS_CACHE_ITEM_COUNT } from '../lib/fixture.mjs'
import {
  DOWNLOAD_FAILURE_WITH_DIAGNOSTICS_ID,
  DOWNLOAD_FAILURE_WITHOUT_DIAGNOSTICS_ID,
  FIXTURE_ACCOUNT_NAME,
  FIXTURE_HOME_DIR,
  FIXTURE_RAW_TARGET_PATH,
} from '../lib/download-failures.mjs'

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

export default async function downloadsTab({ page, app, shot, step }) {
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

  // --- Story 075 D7: the two static fixture entries (AC3/AC4/AC5/AC6/AC8) ------------------------
  // Unlike the `dev:simulateJob` entry above, these come straight from the static `state.json`
  // fixture (`scripts/lib/fixture.mjs`'s `populatedDownloadFailures()`) - reachable offline, no
  // job round trip needed.
  step('assert both static fixture failure entries render (AC8)')
  const diagnosticsEntry = page.getByTestId(`downloads-failure-${DOWNLOAD_FAILURE_WITH_DIAGNOSTICS_ID}`)
  const plainEntry = page.getByTestId(`downloads-failure-${DOWNLOAD_FAILURE_WITHOUT_DIAGNOSTICS_ID}`)
  await diagnosticsEntry.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await plainEntry.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('failure-with-diagnostics')
  await shot('failure-without-diagnostics')

  step('assert only the diagnostics entry offers the copy action (AC6)')
  const copyButton = page.getByTestId(`downloads-failure-copy-${DOWNLOAD_FAILURE_WITH_DIAGNOSTICS_ID}`)
  await copyButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const plainCopyButtonCount = await page
    .getByTestId(`downloads-failure-copy-${DOWNLOAD_FAILURE_WITHOUT_DIAGNOSTICS_ID}`)
    .count()
  if (plainCopyButtonCount !== 0) {
    throw new Error(
      `expected the non-diagnostics entry to render no copy action at all (not even a disabled ` +
        `stub), found ${plainCopyButtonCount} element(s) matching its copy testid`,
    )
  }

  step(
    'assert reveal-log is reachable only inside the diagnostics entry\'s cause detail, not the ' +
      'header cluster, and not at all on the no-diagnostics entry (078 D6/D8, AC5/AC6)',
  )
  // 078 D6 moved reveal-log out of the always-visible header cluster into `FailureCauseDetail`'s
  // closed-by-default footer - so before that detail is ever expanded, the diagnostics entry's
  // reveal button exists (inside the closed native `<details>`) but is not visible, and the
  // no-diagnostics entry renders `FailureCauseDetail` as `null` (AC6), so it has no reveal button
  // at all, not even a disabled stub.
  const diagnosticsReveal = page.getByTestId(`downloads-failure-reveal-${DOWNLOAD_FAILURE_WITH_DIAGNOSTICS_ID}`)
  const plainRevealCount = await page
    .getByTestId(`downloads-failure-reveal-${DOWNLOAD_FAILURE_WITHOUT_DIAGNOSTICS_ID}`)
    .count()
  if (plainRevealCount !== 0) {
    throw new Error(
      `expected the non-diagnostics entry to render no reveal-log action at all (AC6), found ` +
        `${plainRevealCount} element(s) matching its reveal testid`,
    )
  }
  if (await diagnosticsReveal.isVisible()) {
    throw new Error(
      'expected the diagnostics entry\'s reveal-log action to be hidden until its cause detail is ' +
        'expanded (AC5 - it is no longer offered as the first explanation)',
    )
  }

  step('copy the diagnostics report and read it back off the clipboard (AC3)')
  await copyButton.click({ timeout: TIMEOUT_MS })
  await page
    .getByText('Failure report copied to clipboard', { exact: true })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText())

  if (!clipboardText.includes('demo-gamedata') || !clipboardText.includes('q2pro-engine')) {
    throw new Error(
      `expected the copied report to contain the package table's package ids, got: ${JSON.stringify(clipboardText.slice(0, 400))}`,
    )
  }
  if (!/\|.*Package.*\|/.test(clipboardText) || !clipboardText.includes('| --- |')) {
    throw new Error('expected the copied report to contain a Markdown package table (AC3)')
  }
  if (!clipboardText.includes('downloads.error.installationNotPlayable')) {
    throw new Error('expected the copied report to contain the error key (AC3)')
  }
  if (!clipboardText.includes('base-paks') || !clipboardText.includes('pak0.pak is missing')) {
    throw new Error(
      'expected the copied report to contain the AC2 verdict block (the failing check id and its ' +
        'translated message)',
    )
  }
  console.log(`clipboard report length: ${clipboardText.length} chars`)

  step('assert the copied report carries no real account name (AC4)')
  // The seeded entry is built in `scripts/lib/download-failures.mjs` by running realistic,
  // *un-redacted* home-directory paths (`FIXTURE_RAW_TARGET_PATH`, with the account-name segment
  // `FIXTURE_ACCOUNT_NAME`) through the real redaction algorithm - and
  // `src/main/modules/downloads/diagnostics.test.ts` pins that mirror against
  // `src/main/modules/downloads/diagnostics.ts`'s `redactHome`. So the three assertions below
  // exercise redaction's actual output travelling state.json -> renderer -> report -> clipboard,
  // rather than a hand-typed `<home>` placeholder that could never have leaked in the first place.
  for (const [label, leak] of [
    ['the fixture account name', FIXTURE_ACCOUNT_NAME],
    ['the fixture home directory', FIXTURE_HOME_DIR],
    ['the raw (un-redacted) target path', FIXTURE_RAW_TARGET_PATH],
    ['the real home directory of the machine running this flow', homedir()],
  ]) {
    if (clipboardText.includes(leak)) {
      throw new Error(
        `expected the copied report to carry no home-directory account name, but ${label} ` +
          `(${leak}) appeared verbatim`,
      )
    }
  }
  if (/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/.test(clipboardText)) {
    throw new Error(
      'the copied report contains a Windows user-profile path shape - redaction let an account ' +
        'name through',
    )
  }
  if (!clipboardText.includes('<home>')) {
    throw new Error(
      'expected the copied report to contain the redaction placeholder "<home>" in place of the ' +
        'real home directory',
    )
  }

  await shot('failure-report-copied')

  // --- Story 078 D8: the shared cause detail (`FailureCauseDetail`) on the diagnostics entry ------
  step('assert the cause detail is closed on load, before it is ever expanded (AC3)')
  const causeDetail = diagnosticsEntry.locator('details')
  await causeDetail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const isOpenBeforeExpand = await causeDetail.evaluate((el) => el.open)
  if (isOpenBeforeExpand) {
    throw new Error('expected the cause detail to render closed by default (AC3)')
  }
  // The card's own height with the detail closed - captured now so opening it below can prove the
  // closed body was not already inflating the layout (AC3: "the failure list does not grow taller
  // for entries nobody opens"). If the closed state already included the body's height, opening
  // would show no further growth.
  const closedCardHeight = (await diagnosticsEntry.boundingBox())?.height ?? 0

  step('expand the cause detail and assert the per-package step summary renders (AC1)')
  await causeDetail.locator('summary').click({ timeout: TIMEOUT_MS })
  const detailBody = causeDetail.locator('[data-selectable]').first()
  await detailBody.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const detailText = await causeDetail.innerText()
  for (const packageId of ['q2pro-engine', 'demo-gamedata', 'point-release']) {
    if (!detailText.includes(packageId)) {
      throw new Error(`expected the expanded cause detail to name package "${packageId}" (AC1), got: ${JSON.stringify(detailText)}`)
    }
  }
  if (
    (detailText.match(/did not contribute to the installation/g) ?? []).length !== 2 ||
    !detailText.includes('extraction failed')
  ) {
    throw new Error(
      `expected q2pro-engine and point-release to read as "extracted, but did not contribute" and ` +
        `demo-gamedata to read as "extraction failed" (AC1), got: ${JSON.stringify(detailText)}`,
    )
  }

  step('assert the target verdict and its failing check render through their messageKey (AC2)')
  if (!detailText.includes('Installation check')) {
    throw new Error(`expected the verdict heading in the expanded detail (AC2), got: ${JSON.stringify(detailText)}`)
  }
  if (!detailText.includes('pak0.pak is missing')) {
    throw new Error(
      `expected the failing check's translated message (validation.pak0Missing) in the expanded ` +
        `detail (AC2), got: ${JSON.stringify(detailText)}`,
    )
  }
  // The card-facing detail deliberately never renders the assembly table or extraction listings
  // ((User) Q1 - report-only) - so the expanded card text itself must not leak either heading.
  if (detailText.includes('Assembly') || detailText.includes('Extraction contents')) {
    throw new Error(
      `expected the user-facing cause detail to omit the assembly table and extraction listing ` +
        `((User) Q1, report-only), got: ${JSON.stringify(detailText)}`,
    )
  }

  step(
    'assert opening the detail grows the card, proving its closed height did not already include ' +
      'the body (AC3)',
  )
  const openCardHeight = (await diagnosticsEntry.boundingBox())?.height ?? 0
  if (!(openCardHeight > closedCardHeight + 20)) {
    throw new Error(
      `expected expanding the cause detail to noticeably grow the card (closed=${closedCardHeight}px, ` +
        `open=${openCardHeight}px) - if it did not grow, the closed state was already carrying the ` +
        `body's height (AC3)`,
    )
  }

  step('assert reveal-log becomes reachable once the detail is expanded (AC5)')
  await diagnosticsReveal.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await diagnosticsReveal.isDisabled()) {
    throw new Error('expected the diagnostics entry\'s reveal-log action to be enabled once expanded (AC5)')
  }

  await shot('failure-cause-expanded')

  step(
    'assert the already-copied report also carries the assembly table and the extraction ' +
      'listing, with no real account name in either (AC7/AC8/AC9)',
  )
  // Reuses `clipboardText` read earlier by the copy-report step above - `buildFailureReport`
  // builds the whole report (including these two sections) in one call, so nothing needs to be
  // copied again.
  if (!clipboardText.includes('## Assembly')) {
    throw new Error('expected the copied report to contain the assembly table heading (AC7)')
  }
  if (!/\|.*Looked for.*\|/.test(clipboardText) || !clipboardText.includes('baseq2/pak0.pak')) {
    throw new Error('expected the copied report to contain an assembly table row naming baseq2/pak0.pak (AC7)')
  }
  if (!clipboardText.includes('## Extraction contents')) {
    throw new Error('expected the copied report to contain the extraction-listing heading (AC8)')
  }
  if (!clipboardText.includes('### q2pro-engine') || !clipboardText.includes('### point-release')) {
    throw new Error('expected the copied report to list each extracted package\'s own contents block (AC8)')
  }
  if (!clipboardText.includes('q2-3.20-x86-full-ctf')) {
    throw new Error(
      'expected the copied report to show point-release\'s wrapper-directory entry in its ' +
        'extraction listing (AC8)',
    )
  }
  if (!clipboardText.includes('(truncated - more entries were not listed)')) {
    throw new Error('expected point-release\'s truncated extraction listing to carry the truncation marker (AC8)')
  }
  if (clipboardText.includes('### demo-gamedata')) {
    throw new Error(
      'expected demo-gamedata (which never extracted) to have no extraction-listing block at all (AC8)',
    )
  }
  for (const [label, leak] of [
    ['the fixture account name', FIXTURE_ACCOUNT_NAME],
    ['the fixture home directory', FIXTURE_HOME_DIR],
    ['the real home directory of the machine running this flow', homedir()],
  ]) {
    if (clipboardText.includes(leak)) {
      throw new Error(
        `expected the assembly/extraction sections to carry no real account name, but ${label} ` +
          `(${leak}) appeared verbatim in the report (AC9)`,
      )
    }
  }

  step('assert the without-diagnostics entry has no cause detail / disclosure at all (AC6)')
  const plainDetailCount = await plainEntry.locator('details').count()
  if (plainDetailCount !== 0) {
    throw new Error(
      `expected the non-diagnostics entry to render no <details> disclosure at all (AC6), found ` +
        `${plainDetailCount} element(s)`,
    )
  }

  console.log(
    'downloads tab: real view renders (not the planned placeholder), cache size is shown, a ' +
      'running job shows bytes/speed/ETA, a failed job persists/dismisses/restores its ' +
      'failure-log entry, and the two static fixture entries (with/without diagnostics) offer ' +
      'copy/reveal actions correctly, with the copied report redacted',
  )
}
