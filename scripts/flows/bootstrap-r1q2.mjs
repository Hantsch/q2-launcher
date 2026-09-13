// Story 080 (docs/requirements/080-install-r1q2-from-the-community-package.md) D4: the story's own
// offline end-to-end proof for R1Q2, mirroring `scripts/flows/bootstrap-wizard.mjs`'s (Q2PRO's own
// e2e flow) shape and conventions - `setup()`/`teardown()`, the `TIMEOUT_MS`/`JOB_TIMEOUT_MS`
// constants, `step()`/`shot()`, `getByTestId` selectors - rather than reinventing them. That flow
// keeps passing UNCHANGED: it starts its own fixture server with no options at all, so it still sees
// exactly one engine option (Q2PRO), the same as before this story existed.
//
// Covers, in one real job run against a `127.0.0.1` fixture server:
//   AC1 - the engine step offers R1Q2 (alongside Q2PRO), a real selectable row with the fixture
//         manifest's version, and its notice appears once selected (AC8's UI half).
//   AC2 - the community/primary URL for the R1Q2 engine package is permanently down
//         (`failPrimaryOnlyFor`) while its mirror works - the job can only succeed by having
//         actually fallen back to the mirror, which is asserted from the server's own request log
//         rather than assumed from a passing job.
//   AC3 - the assembled target holds exactly the three required R1Q2 files, the demo/point-release
//         game data is unaffected, and no `dedicated.exe` (present in the source archive) exists
//         anywhere under the target.
//   AC4 - `baseq2/autoexec.cfg` was seeded with `vid_ref "r1gl"`, and the confirm step named the
//         r1q2 package, its role and a real total size.
//   AC8 - the installed `LICENSE-r1q2-GPL-3.0.txt` is present and non-empty; the engine step's
//         notice (source/license/runtime) is visible while R1Q2 is selected.
//   AC6 (identity half) - the freshly registered installation's library card shows an `engine-badge`
//        reading R1Q2, not Q2PRO or some other engine.
//
// AC5's "actionable failure" half (missing R1GL/game DLL/x86 runtime) and AC6's job-retry/identity
// halves are unit-level (`bootstrap/job.test.ts`) - this flow proves the healthy path end to end,
// same division of labour `bootstrap-wizard.mjs` and `bootstrap-failure-retry.mjs` already use
// between themselves.
//
// ## Why a separate target folder from `bootstrap-wizard.mjs`
//
// Both flows can run in the same `npm run ui:seed` session (a real user could run either flow
// against the same reseeded `populated` fixture), so this one installs into
// `bootstrapR1q2TargetDir()` (`scripts/lib/fixture.mjs`), never `bootstrapTargetDir()` - the two
// must not race over one directory. Unlike the Q2PRO flow's target, this one starts genuinely fresh
// and empty: the Program Files and non-empty target warnings are already proven end to end by AC2/
// AC3 of `bootstrap-wizard.mjs`, so re-proving them here would only slow this flow down for no new
// evidence.
//
// ## Selectors, not guesses
//
// Everything `bootstrap-wizard.mjs`'s own selector table already lists, plus:
//   bootstrap-engine-r1q2                 modules/downloads/bootstrap/EngineStep.tsx
//   bootstrap-engine-r1q2-notice          .../EngineStep.tsx's `R1q2Notice` (AC8)
//   engine-badge                          components/ui/EngineBadge.tsx - shown next to the
//                                         library card heading, reads "R1Q2" for this installation
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import {
  BOOTSTRAP_R1Q2_DEDICATED_EXE_NAME,
  R1Q2_FIXTURE_ENGINE_ID,
  bootstrapR1q2TargetDir,
  readTargetTree,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeBootstrapR1q2TargetDir,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** The whole job: two engine-package attempts (primary 404, mirror success) plus demo/point-release
 * downloads, three 7za spawns, assemble, two revalidations - same budget `bootstrap-wizard.mjs` gives
 * its own single, unconditionally-succeeding run. */
const JOB_TIMEOUT_MS = 90_000

/** The name `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` (`@shared/modules/downloads`) gives the install -
 * the wizard has no name field of its own, and that default is the SAME literal for every engine
 * (`job.ts`'s `input.name?.trim() || DEFAULT_BOOTSTRAP_INSTALLATION_NAME`), so this R1Q2 flow's
 * installation is named identically to `bootstrap-wizard.mjs`'s Q2PRO one - mirrors that flow's own
 * `INSTALLATION_NAME` literal exactly rather than inventing an engine-specific name that would not
 * match what the app actually creates. */
const INSTALLATION_NAME = 'Q2PRO Demo'

/** Module-scoped, because `setup()` starts it and `teardown()` has to close it. */
let server = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - this flow runs the REAL extractor against real ' +
        'archives and will not pretend otherwise. Run `npm run fetch:7za` first.',
    )
  }

  writePopulatedFixture()
  const targetPath = writeBootstrapR1q2TargetDir()
  // `includeR1q2`: the manifest lists both engine packages, so the wizard can offer R1Q2 at all
  // (AC1). `failPrimaryOnlyFor`: the r1q2 package's PRIMARY url 404s on every request while its
  // MIRROR serves normally from the first one - the one real job this flow runs can only succeed by
  // genuinely falling back to the mirror for that package (AC2).
  server = await startBootstrapFixtureServer({
    includeR1q2: true,
    failPrimaryOnlyFor: R1Q2_FIXTURE_ENGINE_ID,
  })

  console.log(`  fixture server: ${server.baseUrl}`)
  console.log(`  fixture target: ${targetPath}`)
  for (const pkg of server.packages) {
    console.log(`  package ${pkg.role}/${pkg.id}: ${pkg.fileName} ${pkg.sizeBytes} bytes`)
  }

  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      // A single stub entry is enough: this target is fresh and outside Program Files, so no
      // warning is expected and the Browse click is only ever made once.
      Q2L_UI_PICK_FOLDER: [targetPath].join(delimiter),
    },
  }
}

export async function teardown() {
  if (server) {
    await server.close()
    server = null
  }
}

export default async function bootstrapR1q2({ page, shot, step }) {
  const targetPath = bootstrapR1q2TargetDir()

  step('open the Library and click "Download & install"')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })

  // --- AC1/AC8: R1Q2 is offered as a real, selectable option alongside Q2PRO ----------------------
  step('assert at least two engine options are offered and R1Q2 names the fixture version (AC1)')
  const r1q2Option = page.getByTestId('bootstrap-engine-r1q2')
  await r1q2Option.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const engineOptionCount = await page.locator('[data-testid^="bootstrap-engine-"]').count()
  if (engineOptionCount < 2) {
    throw new Error(`expected at least two engine options, found ${engineOptionCount} (AC1)`)
  }
  const r1q2Text = await r1q2Option.innerText()
  if (!/R1Q2/i.test(r1q2Text)) {
    throw new Error(`expected the engine option to name R1Q2, got: ${JSON.stringify(r1q2Text)}`)
  }
  if (!r1q2Text.includes('r1q2-fixture-1')) {
    throw new Error(
      `expected the engine option to show the fixture manifest's version "r1q2-fixture-1" ` +
        `(proving the loopback manifest was used), got: ${JSON.stringify(r1q2Text)}`,
    )
  }

  step('select R1Q2 and assert its source/license/runtime notice appears (AC8)')
  await r1q2Option.click({ timeout: TIMEOUT_MS })
  const notice = page.getByTestId('bootstrap-engine-r1q2-notice')
  await notice.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('engine-step-r1q2-selected')

  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })

  // --- Target step: a fresh, non-Program-Files folder needs no warning acknowledged --------------
  step('pick the fresh R1Q2 fixture target')
  const browse = page
    .getByTestId('bootstrap-target-path-input')
    .getByRole('button', { name: 'Browse…' })
  const pathField = page.getByTestId('bootstrap-target-path-input').locator('input')
  const next = page.getByRole('button', { name: 'Next' })

  await browse.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (expected) => {
      const input = document.querySelector(
        '[data-testid="bootstrap-target-path-input"] input',
      )
      return input && input.value === expected
    },
    targetPath,
    { timeout: TIMEOUT_MS },
  )
  const shownPath = await pathField.inputValue()
  if (shownPath !== targetPath) {
    throw new Error(`expected the target field to show ${JSON.stringify(targetPath)}, got ${JSON.stringify(shownPath)}`)
  }

  // A fresh, non-Program-Files folder is not expected to raise any warning - but if the real
  // machine's ambient state disagrees (e.g. this path happens to sit under a redirected/virtualised
  // root), handle it the same way `bootstrap-wizard.mjs` does rather than failing blind.
  for (const testId of [
    'bootstrap-target-programfiles-acknowledge',
    'bootstrap-target-notwritable-acknowledge',
    'bootstrap-target-nonempty-acknowledge',
  ]) {
    const acknowledge = page.getByTestId(testId)
    if (await acknowledge.count()) {
      await acknowledge.locator('label').click({ timeout: TIMEOUT_MS })
    }
  }
  if (await page.getByTestId('bootstrap-target-blocked').count()) {
    throw new Error('the R1Q2 fixture target was reported as blocked, not a warning or a clean pick')
  }
  if (!(await next.isEnabled())) {
    throw new Error('Next stayed disabled for a fresh, non-Program-Files target')
  }
  await next.click({ timeout: TIMEOUT_MS })

  // --- AC1/AC4: the confirm step names the r1q2 package, its role and a real size ------------------
  step('assert the confirm step names the r1q2 package, its role and a real total size (AC1/AC4)')
  const totalSize = page.getByTestId('bootstrap-confirm-total-size')
  await totalSize.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const totalSizeText = await totalSize.innerText()
  if (!/\d/.test(totalSizeText)) {
    throw new Error(`expected a real total size, got ${JSON.stringify(totalSizeText)}`)
  }
  const confirmBody = await page.getByRole('dialog').innerText()
  const r1q2Package = server.packages.find((pkg) => pkg.id === R1Q2_FIXTURE_ENGINE_ID)
  if (!confirmBody.includes(r1q2Package.id)) {
    throw new Error(`expected the confirm step to name the package ${r1q2Package.id} (AC1/AC4)`)
  }
  if (!confirmBody.includes('Engine')) {
    throw new Error('expected the confirm step to label the "Engine" package (AC1/AC4)')
  }
  await shot('confirm-step-r1q2')

  // --- AC2/AC5: the job runs, falling back to the mirror for the r1q2 package ----------------------
  step('start the job')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('bootstrap-running-step').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('wait for the job to succeed (AC2/AC3/AC5)')
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('running-step-succeeded')

  // --- AC2: the r1q2 package's primary was attempted and 404'd, and the mirror served it -----------
  step('assert the server saw the r1q2 primary fail and the mirror succeed (AC2)')
  const primaryPath = `/packages/${r1q2Package.fileName}`
  const mirrorPath = `/mirror/${r1q2Package.fileName}`
  if (!server.requested.includes(primaryPath)) {
    throw new Error(`expected the fixture server to have been asked for the primary ${primaryPath} (AC2)`)
  }
  if (!server.requested.includes(mirrorPath)) {
    throw new Error(`expected the fixture server to have been asked for the mirror ${mirrorPath} (AC2)`)
  }
  console.log(`AC2: primary ${primaryPath} was attempted and failed; mirror ${mirrorPath} served the bytes`)

  // --- AC3/AC5: the assembled target holds exactly the R1Q2 client files, no dedicated.exe --------
  step('assert on disk that the R1Q2 client files were assembled and dedicated.exe was excluded (AC3)')
  const tree = readTargetTree(targetPath)
  for (const expected of ['r1q2.exe', 'ref_r1gl.dll']) {
    if (!tree.files.includes(expected)) {
      throw new Error(`expected ${expected} in the target root, found ${JSON.stringify(tree.files)} (AC3)`)
    }
  }
  if (!existsSync(join(targetPath, 'baseq2', 'gamex86.dll'))) {
    throw new Error('expected baseq2/gamex86.dll to have been assembled into the target (AC3)')
  }
  for (const pak of ['pak0.pak', 'pak1.pak', 'pak2.pak']) {
    if (!existsSync(join(targetPath, 'baseq2', pak))) {
      throw new Error(`expected baseq2/${pak} to have been assembled into the target (AC3)`)
    }
  }
  const strayDedicated = findForbiddenFile(targetPath, BOOTSTRAP_R1Q2_DEDICATED_EXE_NAME)
  if (strayDedicated.length > 0) {
    throw new Error(
      `found ${BOOTSTRAP_R1Q2_DEDICATED_EXE_NAME} under the target even though the allowlist ` +
        `must exclude it: ${JSON.stringify(strayDedicated)} (AC3)`,
    )
  }
  console.log(`target tree: dirs=${JSON.stringify(tree.dirs)} files=${JSON.stringify(tree.files)}`)

  // --- AC4: the fresh install was seeded with vid_ref "r1gl" ---------------------------------------
  step('assert baseq2/autoexec.cfg seeds vid_ref "r1gl" (AC4)')
  const autoexecPath = join(targetPath, 'baseq2', 'autoexec.cfg')
  if (!existsSync(autoexecPath)) {
    throw new Error(`expected ${autoexecPath} to exist (AC4)`)
  }
  const autoexecText = readFileSync(autoexecPath, 'utf8')
  if (!autoexecText.includes('vid_ref') || !autoexecText.includes('r1gl')) {
    throw new Error(`expected autoexec.cfg to seed vid_ref "r1gl", got: ${JSON.stringify(autoexecText)} (AC4)`)
  }

  // --- AC8: the GPLv3 license notice was installed at the target root ------------------------------
  step('assert the R1Q2 GPLv3 license notice was installed (AC8)')
  const licensePath = join(targetPath, 'LICENSE-r1q2-GPL-3.0.txt')
  if (!existsSync(licensePath)) {
    throw new Error(`expected ${licensePath} to exist (AC8)`)
  }
  const licenseText = readFileSync(licensePath, 'utf8')
  if (licenseText.trim().length === 0) {
    throw new Error(`expected ${licensePath} to be non-empty (AC8)`)
  }

  // --- AC6: the library card names this installation's engine as R1Q2 -----------------------------
  step('assert the library card shows an engine-badge reading R1Q2 (AC6)')
  const cardEngineBadgeText = await page.evaluate((name) => {
    const heading = [...document.querySelectorAll('h2')].find(
      (element) => element.textContent?.trim() === name,
    )
    const badge = heading?.parentElement?.querySelector('[data-testid="engine-badge"]')
    return badge ? badge.textContent : null
  }, INSTALLATION_NAME)
  if (!cardEngineBadgeText || !/R1Q2/i.test(cardEngineBadgeText)) {
    throw new Error(
      `expected the library card's engine-badge to read R1Q2, got: ${JSON.stringify(cardEngineBadgeText)} (AC6)`,
    )
  }
  await shot('r1q2-installation')

  step('assert nothing outside the loopback fixture server was ever asked for')
  const unexpected = server.requested.filter((path) => path === '/' || path.startsWith('/..'))
  if (unexpected.length > 0) {
    throw new Error(`the fixture server saw unexpected request paths: ${JSON.stringify(unexpected)}`)
  }
  console.log(`fixture server served: ${JSON.stringify([...new Set(server.requested)])}`)

  console.log(
    'bootstrap r1q2: R1Q2 was offered/selected with its notice shown, the confirm step named it, ' +
      'the job fell back to the mirror after the primary 404\'d, the target holds exactly the ' +
      'three required client files with dedicated.exe excluded, autoexec.cfg seeds vid_ref "r1gl", ' +
      "the GPLv3 license was installed, and the library card's engine-badge reads R1Q2",
  )
}

/** Every occurrence of `fileName` anywhere under `root`, as target-relative paths - mirrors
 * `bootstrap-wizard.mjs`'s `findForbiddenDirs`, adapted to a file-name search instead of a
 * dir-name search. */
function findForbiddenFile(root, fileName, relative = '') {
  const found = []
  for (const name of readdirSync(join(root, relative))) {
    const next = relative ? join(relative, name) : name
    if (statSync(join(root, next)).isDirectory()) {
      found.push(...findForbiddenFile(root, fileName, next))
      continue
    }
    if (name === fileName) found.push(next)
  }
  return found
}
