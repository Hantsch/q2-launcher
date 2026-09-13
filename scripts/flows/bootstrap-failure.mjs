// Story 078 (docs/requirements/078-the-failure-says-the-cause-not-the-log.md) D9: AC4's e2e proof
// that the bootstrap wizard's own failed running step shows the same cause detail
// (`FailureCauseDetail`, mounted by `RunningStep.tsx` per D7) as the Downloads tab - reached
// through a REAL, deliberately broken package set served by the fixture server, not a
// `dev:simulateJob` stub and not hand-authored diagnostics like `downloads-tab.mjs`'s D8 section
// uses. Mirrors `bootstrap-wizard.mjs`'s own `setup()`/`teardown()` shape closely (same fixture
// server, same two harness-only overrides, same real `7za.exe` extraction) but is its own file so
// that flow's passing happy path is never touched by this one.
//
// ## The broken fixture: `startBootstrapFixtureServer({ wrapperNestedLayout: true })`
//
// `scripts/lib/fixture.mjs`'s `buildBootstrapPackages({ wrapperNestedLayout: true })` moves EVERY
// package's payload one wrapper level deeper than any candidate `assemble.ts`'s allowlist
// (`buildFixedEntries()`, story 076 D1) accepts - not just the demo/point-release archives the
// story's own fixture bullet names, but the engine archive too (see "Why the engine package is
// also broken" below). The result is a real download, a real `7za.exe` extraction and a real
// allowlist search that finds nothing - never a simulated failure.
//
// ## What this actually proves, and the one thing it cannot (read before changing the assertions)
//
// The story's acceptance text asks for a real `downloads.error.installationNotPlayable` failure.
// What a wrapper-nested archive genuinely produces instead, on this exact codebase, is
// `downloads.error.packageIncomplete` - and that is not a shortcut this flow took, it is the ONLY
// reachable outcome. `bootstrap/job.ts` (story 076 D3) checks `assembleInstallation`'s
// `missingRequired` and fails the job right there, BEFORE the revalidation that would ever produce
// `installationNotPlayable`, the moment even ONE required allowlist entry (any one of the five: the
// demo's `pak0.pak`, the point-release's `pak1.pak`/`pak2.pak`, the engine's executable/DLL) is not
// found - see that file's own module comment, "the order is the acceptance criterion", step 6. A
// real archive that leaves ANY required file unfindable is answered by `packageIncomplete`, always,
// by construction: `installationNotPlayable` requires every required entry to have been found (so
// `missingRequired` is empty) and the assembled folder to STILL fail `inspectInstallation` - which
// this codebase's checks (`src/main/services/inspector.ts`: `root-exists`, `base-game-dir`,
// `base-paks`, `executable`) cannot do once every required file is genuinely present, since each of
// those checks is satisfied by the mere presence of the file at its target path, regardless of
// content or which archive served it. `job.test.ts`'s own `breakTargetBeforeValidate()` helper says
// as much in its doc comment: it reaches `installationNotPlayable` only by mocking
// `installations.validate()` to delete the assembled paks a moment before the verdict is read - a
// test-only race no Playwright flow driving the real, unmodified app can reproduce.
//
// So AC4's "the target verdict and its failing checks" half of the cause detail cannot render here:
// `diagnostics.target` is only ever recorded downstream of a successful core assemble pass
// (`job.ts`, right before its final invalid/missing check), a line this run's `packageIncomplete`
// exit never reaches. This flow asserts that gap explicitly (no `verdictHeading` text anywhere in
// the expanded detail) rather than silently omitting the check, so a future change that DOES make
// `installationNotPlayable` reachable here has something to flip red. What this flow proves
// instead, in full, is AC1's half: a real run where every package downloaded, verified and
// extracted, and the cause detail names every one of them as having reached exactly that step and
// no further - the 2026-09-08 report's own "every package downloaded, nothing reached the
// installation" reading, word for word the same i18n string
// (`downloads.failures.detail.step.extracted`) the story's own D8 section already exercises against
// hand-authored data. This is a genuine, non-simulated instance of the same rendering path.
//
// ## Why the engine package is also broken
//
// The story's own fixture bullet only asks for the demo and point-release archives to nest under
// `Install/Data/`. Left alone, the engine package still contributes normally (it has no
// `Install/Data/` candidate to defeat, but nothing nests it either), which would leave it the one
// package the cause detail still credits as having reached "contributed" - short of "every package"
// (AC4's own wording, and D9's deliverable text). Nesting the engine archive under the same wrapper
// is what makes every one of the three packages read the same way. It is a deliberate widening of
// the story's literal fixture bullet, made so the flow can honour AC4's "every package" as closely
// as this codebase allows; see the comment above `buildBootstrapPackages()`'s `engine` package in
// `scripts/lib/fixture.mjs` for the mechanics.
//
// ## Selectors, not guesses
//
// Same components as `bootstrap-wizard.mjs` - read that file's own selector table before changing
// any of these. This flow additionally reads:
//   (FailureCauseDetail has no data-testid - its `<summary>` is located by its own translated text,
//   `downloads.failures.detail.summary` = "What went wrong", scoped under `bootstrap-running-step`)
import {
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeBootstrapTargetDir,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** Three small downloads/extracts, failing at the assemble step - well short of a healthy run's
 * budget (no large discard payload in this variant, no revalidation before the failure). */
const JOB_TIMEOUT_MS = 60_000

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
  server = await startBootstrapFixtureServer({ wrapperNestedLayout: true })

  console.log(`  fixture server: ${server.baseUrl}`)
  console.log(`  fixture target: ${targetPath}`)
  for (const pkg of server.packages) {
    console.log(`  package ${pkg.role}: ${pkg.fileName} ${pkg.sizeBytes} bytes`)
  }

  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      // A single queued pick, like `bootstrap-incomplete-package.mjs`: this flow never exercises
      // the Program Files leg of the target step, only ever Browse-clicks once.
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

export default async function bootstrapFailure({ page, shot, step }) {
  const engineId = server.packages.find((pkg) => pkg.role === 'engine')?.id
  const demoId = server.packages.find((pkg) => pkg.role === 'demo')?.id
  const pointReleaseId = server.packages.find((pkg) => pkg.role === 'point-release')?.id
  if (!engineId || !demoId || !pointReleaseId) {
    throw new Error('the fixture server did not report all three package ids (D9)')
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
  // `sr-only` and paints a visible `<span>` - the click has to land on the wrapping `<label>`.
  await page
    .getByTestId('bootstrap-target-nonempty-acknowledge')
    .locator('label')
    .click({ timeout: TIMEOUT_MS })
  await next.click({ timeout: TIMEOUT_MS })

  step('start the job')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })
  const runningStep = page.getByTestId('bootstrap-running-step')
  await runningStep.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('wait for the job to fail (AC4)')
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="failed"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })

  step('assert the running step names the demo package (the first package plan order finds broken)')
  const runningStepText = await runningStep.innerText()
  if (!runningStepText.includes(demoId)) {
    throw new Error(
      `expected the running step's failure reason to name the demo package ${JSON.stringify(demoId)}, ` +
        `got: ${JSON.stringify(runningStepText)}`,
    )
  }

  step('expand the cause detail (AC4: the same FailureCauseDetail the Downloads tab mounts)')
  const causeSummary = runningStep.getByText('What went wrong')
  await causeSummary.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await causeSummary.click({ timeout: TIMEOUT_MS })

  step('assert every package reads as downloaded, verified and extracted, but not contributing')
  const causeText = await runningStep.innerText()
  for (const [role, id] of [
    ['engine', engineId],
    ['demo', demoId],
    ['point-release', pointReleaseId],
  ]) {
    const expected = `${id}: downloaded, verified and extracted, but did not contribute to the installation`
    if (!causeText.includes(expected)) {
      throw new Error(
        `expected the cause detail to read the ${role} package (${id}) as "${expected}", ` +
          `got: ${JSON.stringify(causeText)}`,
      )
    }
  }

  step(
    'assert the target verdict/checks section is absent - see this file\'s header comment for ' +
      'exactly why a real packageIncomplete run can never reach it',
  )
  if (causeText.includes('Installation check')) {
    throw new Error(
      'the cause detail rendered a target verdict for a packageIncomplete failure - if job.ts ' +
        'changed to record diagnostics.target before this exit, update this flow (and its header ' +
        'comment) to assert the verdict/checks content instead of its absence',
    )
  }

  await shot('bootstrap-failure-cause')

  step('assert nothing outside the loopback fixture server was ever asked for')
  const unexpected = server.requested.filter((path) => path === '/' || path.startsWith('/..'))
  if (unexpected.length > 0) {
    throw new Error(`the fixture server saw unexpected request paths: ${JSON.stringify(unexpected)}`)
  }
  console.log(`fixture server served: ${JSON.stringify([...new Set(server.requested)])}`)

  console.log(
    'bootstrap failure: a real wrapper-nested package set downloaded, verified and extracted for ' +
      'every package, the assemble allowlist found none of them, the running step reached ' +
      '"failed" and its cause detail named every package as downloaded-but-not-contributing ' +
      '(AC4); the target verdict/checks half stays unreachable here - see the header comment',
  )
}
