// Story 077 (docs/requirements/077-a-failed-install-stays-in-my-library.md) D5: the story's own
// offline e2e proof of the LIVE run - "a bootstrap job that fails leaves its installation
// registered, and a retry on the same folder adopts it instead of erroring
// `installations.error.duplicate`". Mirrors `bootstrap-wizard.mjs`'s `setup()`/`teardown()` shape
// and general flow structure exactly; read that file's own top comment first if anything about the
// two harness-only overrides below is unclear.
//
// AC1's OTHER half - "after an app restart" - is deliberately NOT proven here. It is proven by
// booting the app from a fixture `state.json` that already carries a `lastFailure`
// (`scripts/lib/fixture.mjs`'s fourth `populatedInstallations()` row, `INSTALL_FAILED_ID`) and
// checking the Library renders it correctly: `npm run ui:verify --screens=library`. This flow
// instead proves the LIVE failing-then-succeeding run, against a FRESH installation it creates
// itself through the real wizard - never the pre-seeded fixture row, which exists only to prove the
// restart half in isolation.
//
// ## What is different from `bootstrap-wizard.mjs`
//
//   - The fixture server is started with `failFirstAttemptFor` (`scripts/lib/fixture.mjs`): the
//     engine package's PRIMARY and MIRROR urls each 404 on their own first request, then serve
//     normally ever after. That is what makes ONE app session (`Q2L_UI_CONTENT_REPO_BASE` is fixed
//     at launch, so this has to be a property of the server, not of the flow - Decisions (Refine))
//     cover both the failing first run and the succeeding retry.
//   - The target folder is genuinely FRESH - not pre-seeded non-empty like `bootstrapTargetDir()` -
//     so neither run has to acknowledge the Program Files or non-empty warnings at all; both target
//     steps enable Next as soon as the verdict comes back.
//   - The wizard is walked TWICE in one app session, pointed at the SAME target both times, via a
//     single-entry `Q2L_UI_PICK_FOLDER` (the harness stub's last entry repeats forever, so the
//     second Browse click hands back the same path with no second queued entry needed).
//
// ## Selectors, not guesses
//
// Same components as `bootstrap-wizard.mjs` - read that file's own selector table before changing
// any of these. This flow additionally reads:
//   failure-badge                       components/ui/FailureBadge.tsx (story 077 D4)
//   installation-failure-reason         views/LibraryView.tsx (story 077 D4) - the translated
//                                        `t(installation.lastFailure.errorKey)` sentence
//   installation-tile-failed-tag        components/installations/InstallationTile.tsx (story 077 D4)
import { readdirSync } from 'node:fs'
import {
  bootstrapFailureRetryTargetDir,
  resetBootstrapFailureRetryTargetDir,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** The first run's failure is near-instant - one 404'd primary and one 404'd mirror, no retry
 * (`isRetryableStatus` in `fetcher.ts` never retries a 404) - so this budget is generous margin. */
const FAIL_TIMEOUT_MS = 30_000
/** The retry runs all three real downloads+extracts+assembles - same budget `bootstrap-wizard.mjs`
 * gives its one and only run. */
const JOB_TIMEOUT_MS = 90_000

/** The name `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` (`@shared/modules/downloads`) gives the install -
 * the wizard has no name field of its own (`BootstrapWizard.tsx`'s `start()` never passes `name`),
 * so this is the name every bootstrap-created installation gets, "chosen" only in the sense that the
 * user never had to type it. Mirrors `bootstrap-wizard.mjs`'s own `INSTALLATION_NAME` literal. */
const INSTALLATION_NAME = 'Q2PRO Demo'

/** Mirrors `buildBootstrapPackages()`'s own literal engine package id (`scripts/lib/fixture.mjs`) -
 * the package this flow's fixture server 404s on its first attempt only. Failing the FIRST
 * downloaded package (engine, demo, point-release, in that order) means run 1 fails before a single
 * byte of any package is assembled into the target, which is what keeps the "target is empty
 * afterwards" assertion below simple and unambiguous. */
const FAIL_FIRST_PACKAGE_ID = 'q2pro-fixture-client'

/** The exact text `src/renderer/src/i18n/locales/en.json`'s `downloads.error.allMirrorsFailed`
 * carries - what `fetcher.ts` reports once a package's primary URL and every mirror have failed,
 * and what `INSTALL_FAILED_ERROR_KEY` (`scripts/lib/fixture.mjs`) also names for the seeded fixture
 * row, so the same failure reads the same way on both the live run and the restart-proof screen. */
const EXPECTED_FAILURE_REASON = 'Every download source failed. Check your connection and try again.'

/** Module-scoped, because `setup()` starts it and `teardown()` has to close it. */
let server = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - this flow runs the REAL extractor against real ' +
        'archives and will not pretend otherwise. Run `npm run fetch:7za` first.',
    )
  }

  // Same "why this flow reseeds" reasoning as `bootstrap-wizard.mjs`: a fresh `populated` fixture
  // (this flow's own installation is registered into that same state document) and a genuinely
  // fresh, non-existent target folder (`resetBootstrapFailureRetryTargetDir` deletes it outright -
  // the wizard's own `create()` is what should bring it into being) are what make a second run of
  // this flow possible at all.
  writePopulatedFixture()
  const targetPath = resetBootstrapFailureRetryTargetDir()
  server = await startBootstrapFixtureServer({ failFirstAttemptFor: FAIL_FIRST_PACKAGE_ID })

  const failedPackage = server.packages.find((pkg) => pkg.id === FAIL_FIRST_PACKAGE_ID)
  if (!failedPackage) {
    throw new Error(`the fixture server reported no package with id ${FAIL_FIRST_PACKAGE_ID}`)
  }

  console.log(`  fixture server: ${server.baseUrl}`)
  console.log(`  fixture target: ${targetPath}`)
  console.log(`  failing-first-attempt package: ${failedPackage.role} (${failedPackage.id})`)

  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      // A single queued pick, repeated on the second Browse click (the harness stub's last entry
      // repeats forever) - both wizard runs target the exact same fresh folder.
      Q2L_UI_PICK_FOLDER: targetPath,
    },
  }
}

export async function teardown() {
  if (server) {
    await server.close()
    server = null
  }
}

/** Reads back whether the Library card for `installName` shows the failure marks, and whether its
 * Play control is disabled - all through the real rendered DOM, scoped to that installation's own
 * `<li>` row (`LibraryView.tsx` wraps each `InstallationRow` in one) so a finding here can never be
 * about a different installation's badge. */
async function readLibraryCardState(page, installName) {
  return page.evaluate((name) => {
    const heading = [...document.querySelectorAll('h2')].find(
      (element) => element.textContent?.trim() === name,
    )
    const row = heading?.closest('li')
    if (!row) return null
    const playButton = [...row.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Play',
    )
    const reasonEl = row.querySelector('[data-testid="installation-failure-reason"]')
    return {
      hasFailureBadge: row.querySelector('[data-testid="failure-badge"]') !== null,
      hasFailedTag: row.querySelector('[data-testid="installation-tile-failed-tag"]') !== null,
      failureReasonText: reasonEl ? reasonEl.textContent?.trim() : null,
      playDisabled: playButton ? playButton.disabled : null,
    }
  }, installName)
}

/**
 * Browses to `expectedTargetPath` (the queued `Q2L_UI_PICK_FOLDER` entry) and waits for the target
 * step to settle on it - the input's value updates synchronously with the pick, but the D2 verdict
 * (and therefore whether any warning renders, and whether Next enables) resolves a moment later over
 * `installations:inspectPath`'s async round trip. Polling `next`'s enabled state is what waits for
 * that resolution without hanging a wait off a warning this flow's fresh target never shows.
 */
async function pickFreshTarget(page, expectedTargetPath) {
  const browse = page
    .getByTestId('bootstrap-target-path-input')
    .getByRole('button', { name: 'Browse…' })
  const pathField = page.getByTestId('bootstrap-target-path-input').locator('input')
  const next = page.getByRole('button', { name: 'Next' })

  await browse.click({ timeout: TIMEOUT_MS })

  // The input's value follows the `installations:pickFolder` round trip, which is async - reading
  // it immediately after the click can still see the previous (empty) value, so this polls rather
  // than asserting on the first read.
  const pickDeadline = Date.now() + TIMEOUT_MS
  let shownPath = await pathField.inputValue()
  while (Date.now() < pickDeadline && shownPath !== expectedTargetPath) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    shownPath = await pathField.inputValue()
  }
  if (shownPath !== expectedTargetPath) {
    throw new Error(
      `expected the target field to show ${JSON.stringify(expectedTargetPath)}, got ${JSON.stringify(shownPath)}`,
    )
  }

  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline && !(await next.isEnabled())) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!(await next.isEnabled())) {
    throw new Error(`Next never enabled for the fresh target ${JSON.stringify(expectedTargetPath)}`)
  }

  for (const testId of [
    'bootstrap-target-blocked',
    'bootstrap-target-programfiles-warning',
    'bootstrap-target-nonempty-warning',
    'bootstrap-target-notwritable-warning',
  ]) {
    if (await page.getByTestId(testId).count()) {
      throw new Error(`expected a genuinely fresh target to show no "${testId}" warning`)
    }
  }

  await next.click({ timeout: TIMEOUT_MS })
}

export default async function bootstrapFailureRetry({ page, shot, step }) {
  const targetPath = bootstrapFailureRetryTargetDir()
  const runningStep = page.getByTestId('bootstrap-running-step')

  // --- run 1: the wizard creates a fresh installation, and its download fails --------------------
  step('open the Library and click "Download & install" (run 1)')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })

  step('engine step: assert Q2PRO is offered and click Next')
  await page.getByTestId('bootstrap-engine-q2pro').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })

  step('target step: pick the fresh target (run 1)')
  await pickFreshTarget(page, targetPath)

  step('confirm step: start the job (run 1)')
  await page
    .getByTestId('bootstrap-confirm-total-size')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('run1-confirm-step')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })

  step('wait for run 1 to fail (the engine package 404s on its first attempt)')
  await runningStep.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="failed"]')
    .waitFor({ state: 'visible', timeout: FAIL_TIMEOUT_MS })

  const runningStepText = await runningStep.innerText()
  if (!runningStepText.includes(EXPECTED_FAILURE_REASON)) {
    throw new Error(
      `expected the running step to show the translated allMirrorsFailed reason ` +
        `${JSON.stringify(EXPECTED_FAILURE_REASON)}, got: ${JSON.stringify(runningStepText)}`,
    )
  }
  await shot('run1-failed')

  step('dismiss the wizard')
  await page.getByTestId('bootstrap-running-dismiss').click({ timeout: TIMEOUT_MS })

  // --- Library: the installation survives the failure, marked, with Play disabled ----------------
  step('assert the Library still shows the installation, failed and unplayable (AC1/AC5/AC6)')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  const cardStateAfterFailure = await readLibraryCardState(page, INSTALLATION_NAME)
  if (!cardStateAfterFailure) {
    throw new Error(`no Library card named "${INSTALLATION_NAME}" found after the failed run (AC1)`)
  }
  if (!cardStateAfterFailure.hasFailureBadge) {
    throw new Error('expected the Library card to show the FailureBadge ("Failed") (AC5)')
  }
  if (cardStateAfterFailure.failureReasonText !== EXPECTED_FAILURE_REASON) {
    throw new Error(
      `expected the Library card's failure sentence to read ${JSON.stringify(EXPECTED_FAILURE_REASON)}, ` +
        `got ${JSON.stringify(cardStateAfterFailure.failureReasonText)} (AC5)`,
    )
  }
  if (!cardStateAfterFailure.hasFailedTag) {
    throw new Error('expected the tile\'s corner "FAILED" microtag to render (AC5)')
  }
  if (cardStateAfterFailure.playDisabled !== true) {
    throw new Error('expected the Play control to stay disabled on the failed installation (AC6)')
  }
  await shot('library-after-run1-failure')

  step('assert the target folder on disk is empty after the failure (AC1)')
  const entriesAfterFailure = readdirSync(targetPath)
  if (entriesAfterFailure.length !== 0) {
    throw new Error(
      `expected ${targetPath} to be empty after the failed run, found: ${JSON.stringify(entriesAfterFailure)}`,
    )
  }

  // --- run 2: the same folder, adopting the failed installation, this time succeeding ------------
  step('open the wizard again, pointed at the same folder (run 2)')
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('bootstrap-engine-q2pro').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })

  step('target step: re-pick the same target (run 2)')
  await pickFreshTarget(page, targetPath)

  step('confirm step: start the retry - must adopt, not error installations.error.duplicate (AC7)')
  await page
    .getByTestId('bootstrap-confirm-total-size')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })

  try {
    await runningStep.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  } catch (waitError) {
    const dangerText = await page
      .locator('.text-danger')
      .first()
      .innerText()
      .catch(() => null)
    throw new Error(
      `the retry never reached the running step (expected no installations.error.duplicate, AC7)` +
        (dangerText ? ` - wizard reported: ${JSON.stringify(dangerText)}` : '') +
        `: ${waitError.message}`,
    )
  }

  step('wait for run 2 to succeed (the same package now serves normally)')
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('run2-succeeded')

  step('dismiss the wizard')
  await page.getByTestId('bootstrap-running-dismiss').click({ timeout: TIMEOUT_MS })

  // --- Library: the badge and the microtag are gone -----------------------------------------------
  step('assert the badge and the microtag are gone everywhere they were checked (AC4)')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  const cardStateAfterSuccess = await readLibraryCardState(page, INSTALLATION_NAME)
  if (!cardStateAfterSuccess) {
    throw new Error(`no Library card named "${INSTALLATION_NAME}" found after the retry (AC7)`)
  }
  if (cardStateAfterSuccess.hasFailureBadge) {
    throw new Error('expected the FailureBadge to be gone once the retry succeeded (AC4)')
  }
  if (cardStateAfterSuccess.hasFailedTag) {
    throw new Error('expected the tile\'s "FAILED" microtag to be gone once the retry succeeded (AC4)')
  }
  if (cardStateAfterSuccess.failureReasonText !== null) {
    throw new Error(
      `expected no failure sentence once the retry succeeded, got ${JSON.stringify(cardStateAfterSuccess.failureReasonText)} (AC4)`,
    )
  }
  if (cardStateAfterSuccess.playDisabled !== false) {
    throw new Error('expected the Play control to be enabled once the retry succeeded')
  }
  await shot('library-after-run2-success')

  step('assert nothing outside the loopback fixture server was ever asked for')
  const unexpected = server.requested.filter((path) => path === '/' || path.startsWith('/..'))
  if (unexpected.length > 0) {
    throw new Error(`the fixture server saw unexpected request paths: ${JSON.stringify(unexpected)}`)
  }

  console.log(
    "bootstrap failure retry: run 1 failed on the engine package's 404'd primary+mirror and left " +
      'the installation registered with the FailureBadge, the translated reason, the tile microtag ' +
      'and a disabled Play control, the target folder was left empty, run 2 on the same folder ' +
      'adopted it without installations.error.duplicate and succeeded, and the badge/tag/reason are ' +
      'now gone (AC1/AC4/AC5/AC6/AC7)',
  )
}
