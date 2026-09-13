// Story 076 (docs/requirements/076-bootstrap-assembles-the-real-archives.md) D6: AC5's user-facing
// half - a package that downloads, verifies and extracts perfectly, but contributes none of its
// required allowlist files, names ITSELF in the failure - both on the wizard's running step and in
// the Downloads tab's persisted failure log.
//
// A separate flow rather than a branch inside `bootstrap-wizard.mjs`, because this needs:
//   - a distinct, deliberately-broken fixture archive set (the demo package built with its
//     `pak0.pak` withheld, via `startBootstrapFixtureServer({ demoContributesNothing: true })`);
//   - a distinct assertion target - a FAILURE, not a success;
//   - a much shorter walk, since none of AC1-AC4/AC6-AC8 (already proven by `bootstrap-wizard.mjs`)
//     need re-proving here - this flow never touches the Program Files leg of the target step at
//     all, and only ever picks one folder.
//
// ## Selectors, not guesses
//
// Same components as `bootstrap-wizard.mjs` - read that file's own selector table before changing
// any of these. This flow additionally reads:
//   downloads-failure-<failureId>   FailureLogEntry.tsx (`scripts/flows/downloads-tab.mjs`'s
//                                   pattern: `[data-testid^="downloads-failure-"]`, since a
//                                   `DownloadFailure.id` is a generated uuid unknown in advance)
//
// ## How this run is offline
//
// Same two harness-only overrides as `bootstrap-wizard.mjs` (`Q2L_UI_CONTENT_REPO_BASE`,
// `Q2L_UI_PICK_FOLDER`), both gated the same way - see that file's own comment. This flow's
// `Q2L_UI_PICK_FOLDER` queues a single entry (the real fixture target) rather than two, since AC2's
// Program Files warning is not part of this walk.
import {
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeBootstrapTargetDir,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/**
 * This job still runs all three real downloads+extracts (engine, demo, point-release) before the
 * missing-required check fires on the assemble pass - reuses `bootstrap-wizard.mjs`'s own full job
 * budget rather than inventing a shorter one.
 */
const JOB_TIMEOUT_MS = 90_000

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
  // and a fresh target folder are what make a second run of this flow possible at all.
  writePopulatedFixture()
  const targetPath = writeBootstrapTargetDir()
  server = await startBootstrapFixtureServer({ demoContributesNothing: true })

  console.log(`  fixture server: ${server.baseUrl}`)
  console.log(`  fixture target: ${targetPath}`)
  for (const pkg of server.packages) {
    console.log(`  package ${pkg.role}: ${pkg.fileName} ${pkg.sizeBytes} bytes`)
  }

  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      // A single queued pick - this flow never exercises the Program Files warning, only ever
      // Browse-clicks once for the real fixture target.
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

export default async function bootstrapIncompletePackage({ page, shot, step }) {
  const demoPackageId = server.packages.find((pkg) => pkg.role === 'demo')?.id
  if (!demoPackageId) {
    throw new Error('the fixture server reported no "demo" package - cannot assert its id (D6)')
  }

  step('open the Library and click "Download & install"')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })

  step('assert the engine step offers Q2PRO and click Next')
  const engineOption = page.getByTestId('bootstrap-engine-q2pro')
  await engineOption.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })

  step('pick the fixture target and acknowledge the non-empty warning')
  const browse = page
    .getByTestId('bootstrap-target-path-input')
    .getByRole('button', { name: 'Browse…' })
  const next = page.getByRole('button', { name: 'Next' })
  await browse.click({ timeout: TIMEOUT_MS })

  const nonEmptyWarning = page.getByTestId('bootstrap-target-nonempty-warning')
  await nonEmptyWarning.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  // `Checkbox` (`components/ui/controls.tsx`) hides its real `<input type="checkbox">` with
  // `sr-only` and paints a visible `<span>` - the click has to land on the wrapping `<label>`,
  // same pattern as `bootstrap-wizard.mjs`.
  await page
    .getByTestId('bootstrap-target-nonempty-acknowledge')
    .locator('label')
    .click({ timeout: TIMEOUT_MS })
  await next.click({ timeout: TIMEOUT_MS })

  step('start the job')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })
  const runningStep = page.getByTestId('bootstrap-running-step')
  await runningStep.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('wait for the job to fail naming the demo package (AC5)')
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="failed"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })

  step('assert the running step names the demo package in its failure reason')
  const runningStepText = await runningStep.innerText()
  if (!runningStepText.includes(demoPackageId)) {
    throw new Error(
      `expected the running step's failure reason to name the demo package ` +
        `${JSON.stringify(demoPackageId)}, got: ${JSON.stringify(runningStepText)}`,
    )
  }
  await shot('running-step-failed')

  step('dismiss the wizard and open the Downloads tab')
  await page.getByTestId('bootstrap-running-dismiss').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-downloads').click({ timeout: TIMEOUT_MS })

  step("assert the Downloads tab's failure card carries the same key and names the same package")
  const failureEntry = page.locator('[data-testid^="downloads-failure-"]').first()
  await failureEntry.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const failureText = await failureEntry.innerText()
  if (!failureText.includes(demoPackageId)) {
    throw new Error(
      `expected the Downloads tab's failure card to name the demo package ` +
        `${JSON.stringify(demoPackageId)}, got: ${JSON.stringify(failureText)}`,
    )
  }
  await shot('downloads-failure-card')

  step('assert nothing outside the loopback fixture server was ever asked for')
  const unexpected = server.requested.filter((path) => path === '/' || path.startsWith('/..'))
  if (unexpected.length > 0) {
    throw new Error(`the fixture server saw unexpected request paths: ${JSON.stringify(unexpected)}`)
  }
  console.log(`fixture server served: ${JSON.stringify([...new Set(server.requested)])}`)

  console.log(
    `bootstrap incomplete package: the demo package (${demoPackageId}) downloaded and extracted ` +
      `fine but contributed no required file, and both the running step and the Downloads tab's ` +
      `failure card named it (AC5)`,
  )
}
