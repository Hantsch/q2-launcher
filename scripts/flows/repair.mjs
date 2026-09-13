// Story 093 (docs/requirements/093-repair-fixes-exactly-what-it-can.md) D7: the story's offline
// end-to-end proof. Walks the Repair trigger - the action bar's primary button (only ever shown for
// an `invalid`/`missing` installation - `resolvePrimaryAction()`, `ActionBar.tsx`) and the checks
// list's own `install-game-files` fix button - across six fixture installations, runs the two REAL
// repairs the job performs (`reinstall-engine`, `install-point-release`) against the loopback
// fixture server, and asserts on disk that exactly the expected files appeared. No outbound network
// access at all.
//
// ## Which trigger reaches which fixture, and why (read this before touching the fixtures below)
//
// `isPlayable()` (`src/renderer/src/lib/status.ts`) treats `'warning'` (and `'ok'`) as playable, so
// the action bar's Repair button (`resolvePrimaryAction`) only ever appears for `status: 'invalid'`
// or `'missing'` - i.e. for an `error`-severity finding. A `warn`/`info`-only finding
// (`validation.executableMissing`, `.pointReleaseMissing`, `.pak0NotRetail`, `.retailPaksMissing`,
// `.notWritable`) is real and repairable, but only ever reachable through the checks list's own
// `fix: 'install-game-files'` button (`ChecksList.tsx`'s `useFixAction`) - the action bar shows Play
// for all of them. Separately, `src/main/services/inspector.ts`'s `classifyEngine()` only recognises
// r1q2/q2pro by one of THEIR OWN executable file names being present at the root - so once every
// such file is gone, a fresh inspection reports `engineKind: 'unknown'` and raises
// `validation.noExecutable` (`error`). `buildRepairPlan`'s `reinstall-engine` gate
// (`repair/plan.ts`) asks the manifest about the installation's *recorded* `engineKind`, not that
// fresh one, so `validation.noExecutable` and "the manifest can supply this installation's engine"
// CAN co-occur - a marker-less installation whose record still says `r1q2` legitimately offers
// `reinstall-engine` from an `error`-severity finding. This flow does not build that exact fixture,
// though: AC1 here is built as `validation.executableMissing` (a stale recorded `executablePath`
// next to a DIFFERENT, still-present engine marker file - which keeps the fresh and recorded engine
// kind equal), which is `warn`, not `error` - so the engine-repair fixture also carries an empty
// `baseq2` (`validation.pak0Missing`, error) purely so the action bar's Repair button exists to
// click at all; see `scripts/lib/fixture.mjs`'s own block comment above `INSTALL_REPAIR_ENGINE_ID`
// for the fuller version of this reasoning. The recorded-vs-fresh gate itself is proven at the unit
// level instead, by `repair/plan.test.ts`'s "gates reinstall-engine on the recorded engine kind, not
// a fresh inspection that can no longer identify one".
//
// One consequence worth calling out explicitly: every fixture in THIS flow pairs its `reinstall-
// engine`/`install-point-release` trigger with an unrelated `error`-severity finding this job never
// touches (`validation.pak0Missing`/`.baseDirMissing`/`.retailPaksMissing`/`.pak0NotRetail` all
// route to [[088]]'s retail-copy flow instead) - so, HERE, running one of this job's own repairs
// never flips the action bar from Repair to Play; the marker-less-but-recorded-engine shape above
// could in principle do that, but no fixture in this flow constructs it. AC9's own e2e mapping
// suggests asserting "the action bar no longer shows Repair" after a repair; this flow instead
// asserts the always-true half of AC9 that every one of its fixtures CAN prove - that the engine
// repair (AC1) succeeds while `validation.pak0Missing` is still unresolved, and the action bar's
// status honestly keeps showing Repair rather than being hand-set to healthy. AC9's unit test
// (`repair/job.test.ts`) already covers "the status comes from `InstallationsService.validate()`,
// never hand-set" directly; this is the same fact observed through the real UI.
//
// ## How this run is offline
//
// One harness-only override (`Q2L_UI_HARNESS === '1' && isDev`, `src/main/lib/ui-harness.ts`,
// unreachable in a packaged build), the same ones `engine-update.mjs`/`retail-upgrade.mjs` already
// use:
//
//   Q2L_UI_CONTENT_REPO_BASE     the manifest/package base URL (`resolveDownloadSource()`,
//                                 `src/main/modules/downloads/harness.ts`) - refused unless it names
//                                 a `127.0.0.1` origin. Points at `startBootstrapFixtureServer({
//                                 includeR1q2: true })`, which serves BOTH the Q2PRO and R1Q2 fixture
//                                 engine packages (090/092 only ever needed one).
//   Q2L_UI_HARNESS_STORE_SOURCES  set to `'[]'` for the WHOLE session (unlike `retail-upgrade.mjs`,
//                                 which flips it mid-run): this flow never runs [[088]]'s retail-copy
//                                 job to completion, only proves that clicking the `retail-copy`
//                                 offer switches the module dialog to 090's own `retail-upgrade` view
//                                 - AC3's "opens 090's picker" and AC4's "no store installation
//                                 detected" are the SAME empty state 090 already built and tested;
//                                 nothing here needs a real detected source.
//
// ## The six fixture installations
//
// `scripts/lib/fixture.mjs`'s `populatedInstallations()` gains five additive installations (last
// `sortOrder`s, assigned to no config profile - the convention every fixture since 090 documents):
// `INSTALL_REPAIR_ENGINE_ID` (AC1), `INSTALL_REPAIR_POINT_RELEASE_ID` (AC2),
// `INSTALL_REPAIR_RETAIL_ID` (AC4), `INSTALL_REPAIR_WRITEDIR_ID` (AC5),
// `INSTALL_REPAIR_UNREPAIRABLE_ID` (AC6). AC3's demo-pak0 case reuses `INSTALL_DEMO_UPGRADE_ID`
// verbatim (090 D6) rather than a seventh near-duplicate; its seeded `checks` array gained
// `fix: 'install-game-files'` to match what a live `inspectInstallation()` now produces after D1.
//
// ## Selectors
//
// `repair-dialog` / `repair-empty` / `repair-offer-<kind>` / `repair-error` / `repair-dismiss`
//   RepairDialog.tsx (D5), mirroring RetailUpgradeDialog's own convention.
// `bootstrap-running-step`         RunningStep.tsx - reused as-is, `data-status`.
// `retail-upgrade-dialog` / `-no-sources`   RetailUpgradeDialog.tsx (090) - the AC3/AC4 handover.
// `actionbar-play[data-action="repair"]`    ActionBar.tsx - the action-bar trigger.
// the checks list's own fix button           ChecksList.tsx - addressed by its translated label,
//                                              same as every other un-testid'd button this harness
//                                              already selects by accessible name.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  BOOTSTRAP_R1Q2_ENGINE_FIXTURE_LAYOUT,
  INSTALL_DEMO_UPGRADE_ID,
  INSTALL_DEMO_UPGRADE_NAME,
  INSTALL_REPAIR_ENGINE_ID,
  INSTALL_REPAIR_ENGINE_NAME,
  INSTALL_REPAIR_POINT_RELEASE_ID,
  INSTALL_REPAIR_POINT_RELEASE_NAME,
  INSTALL_REPAIR_RETAIL_ID,
  INSTALL_REPAIR_RETAIL_NAME,
  INSTALL_REPAIR_UNREPAIRABLE_ID,
  INSTALL_REPAIR_UNREPAIRABLE_NAME,
  INSTALL_REPAIR_WRITEDIR_ID,
  INSTALL_REPAIR_WRITEDIR_NAME,
  RETAIL_PAK_SIZES,
  installationConfigFilePath,
  installationRootFilePath,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** One throttled download + one 7za spawn + one narrow assemble copy - mirrors `engine-update.mjs`'s
 * own single-package budget. */
const JOB_TIMEOUT_MS = 60_000

/** Mirrors `validation.fix.install-game-files` (`src/renderer/src/i18n/locales/en.json`) - the
 * checks list's own fix button for every `base-paks`/`base-game-dir` finding this job can act on. */
const GET_GAME_FILES_LABEL = 'Get game files'

let server = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - this flow runs the REAL extractor against a real ' +
        'archive and will not pretend otherwise. Run `npm run fetch:7za` first.',
    )
  }

  // Reseeds `populated`, which is also what (re)writes every repair fixture's own files fresh for
  // this run - a previous run's engine/pak2 repair must never leave a half-fixed installation behind
  // for this one to find.
  writePopulatedFixture()
  server = await startBootstrapFixtureServer({ includeR1q2: true })

  console.log(`  fixture server: ${server.baseUrl}`)
  for (const pkg of server.packages) {
    console.log(`  package ${pkg.role}/${pkg.id}: ${pkg.fileName} ${pkg.sizeBytes} bytes`)
  }

  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      Q2L_UI_HARNESS_STORE_SOURCES: '[]',
    },
  }
}

export async function teardown() {
  if (server) {
    await server.close()
    server = null
  }
}

/**
 * The library row's own `<li>` (`LibraryView.tsx`'s `installations.map(...)`) - no dedicated
 * testid. Unlike `retail-upgrade.mjs`'s own `libraryCard()` (`div.items-start`, which only reaches
 * that row's top flex line - avatar button, name, badges), this flow also needs the checks list,
 * which is a LATER sibling inside the same `<li>` but outside that inner div - so the `<li>` itself
 * is the scope this flow needs.
 */
function libraryCard(page, name) {
  return page.locator('li').filter({ has: page.getByRole('heading', { name, exact: true }) })
}

/** Selects `name` in the library and waits for the action bar to reflect it - the same two-step
 * every other flow in this repo uses before touching either trigger. */
async function selectInstallation(page, name) {
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  const card = libraryCard(page, name)
  await card.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await card.getByRole('button', { name, exact: true }).click({ timeout: TIMEOUT_MS })
  await page.locator('footer').filter({ hasText: name }).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  return card
}

/** A CSS attribute-selector version of the action bar's primary button, for waiting on its
 * `data-action` specifically - the same reason `retail-upgrade.mjs`'s
 * `importRetailButtonWithDisabled()` avoids a hand-rolled `page.evaluate()` poll (observed to hang
 * under this app's CSP even when already true). */
function repairAction(page) {
  return page.locator('[data-testid="actionbar-play"][data-action="repair"]')
}

/** Opens the repair dialog from the action bar's own Repair button - only ever present for an
 * `invalid`/`missing` installation, per this file's own header comment. */
async function openRepairFromActionBar(page) {
  await repairAction(page).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('actionbar-play').click({ timeout: TIMEOUT_MS })
  const dialog = page.getByTestId('repair-dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  return dialog
}

/** Opens the repair dialog from the checks list's own `install-game-files` fix button
 * (`ChecksList.tsx`'s `useFixAction`) - the only way this app's UI reaches the dialog for a
 * `warn`/`info`-severity finding. */
async function openRepairFromChecksList(page, card) {
  const fixButton = card.getByRole('button', { name: GET_GAME_FILES_LABEL })
  await fixButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await fixButton.click({ timeout: TIMEOUT_MS })
  const dialog = page.getByTestId('repair-dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  return dialog
}

async function closeDialog(page) {
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
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

export default async function repair({ page, shot, step }) {
  // ================================================================================================
  // AC1 - engine-executable-less: `validation.executableMissing` offers `reinstall-engine`, and the
  // job writes the real fixture engine bytes. Reached from BOTH triggers (the co-occurring
  // `validation.pak0Missing` is what makes the action bar's Repair button exist at all).
  // ================================================================================================
  step('AC1: select the engine-executable-less installation')
  const engineCard = await selectInstallation(page, INSTALL_REPAIR_ENGINE_NAME)

  step('AC1: the action bar offers Repair (pak0Missing => invalid), and the dialog offers reinstall-engine')
  let dialog = await openRepairFromActionBar(page)
  await dialog.getByTestId('repair-offer-reinstall-engine').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('engine-offer-actionbar')
  await closeDialog(page)

  step('AC1: the checks list (Get game files, from pak0Missing) reaches the very same dialog')
  dialog = await openRepairFromChecksList(page, engineCard)
  await dialog.getByTestId('repair-offer-reinstall-engine').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC1: run the engine repair against the real fixture server')
  await dialog.getByTestId('repair-offer-reinstall-engine').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('bootstrap-running-step').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('engine-repair-succeeded')
  await page.getByTestId('repair-dismiss').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('AC1: on disk, exactly the engine files appeared - pak0.pak is still absent')
  for (const relative of BOOTSTRAP_R1Q2_ENGINE_FIXTURE_LAYOUT) {
    const path = installationRootFilePath(INSTALL_REPAIR_ENGINE_ID, relative)
    if (!existsSync(path) || statSync(path).size === 0) {
      throw new Error(`expected the reinstalled engine file ${relative} on disk (AC1), found none`)
    }
  }
  if (existsSync(installationConfigFilePath(INSTALL_REPAIR_ENGINE_ID, 'pak0.pak'))) {
    throw new Error('pak0.pak appeared after the engine repair - it must touch engine files only (AC1/AC7)')
  }

  step(
    "AC9 (the half this fixture can prove): pak0Missing is still unresolved, so the action bar " +
      'honestly keeps showing Repair rather than being hand-set to healthy',
  )
  await repairAction(page).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // ================================================================================================
  // AC2 - pak2-less: `validation.pointReleaseMissing` (warn - Play stays the action bar's primary
  // button) offers `install-point-release`, reachable only via the checks list. Combined with AC8:
  // simulate the game running before starting the job, assert the write phase waits, then let it run.
  // ================================================================================================
  step('AC2: select the pak2-less installation')
  const pointCard = await selectInstallation(page, INSTALL_REPAIR_POINT_RELEASE_NAME)

  step('AC2: a warn-only finding leaves the action bar on Play, not Repair')
  if (await repairAction(page).count()) {
    throw new Error('expected Play (not Repair) for a warn-only finding (isPlayable("warning"))')
  }

  step('AC2: the checks list opens the dialog, offering install-point-release')
  dialog = await openRepairFromChecksList(page, pointCard)
  await dialog.getByTestId('repair-offer-install-point-release').waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
  await shot('point-release-offer')

  const baseq2Dir = dirname(installationConfigFilePath(INSTALL_REPAIR_POINT_RELEASE_ID, 'pak0.pak'))
  const filesBefore = readdirSync(baseq2Dir).sort()

  step('AC8: simulate the game running, then start the repair - it must wait, not write')
  await simulateLaunch(page, INSTALL_REPAIR_POINT_RELEASE_ID, 'running')
  await dialog.getByTestId('repair-offer-install-point-release').click({ timeout: TIMEOUT_MS })
  const waitingStep = page.locator('[data-testid="bootstrap-running-step"][data-status="waiting"]')
  await waitingStep.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const waitingText = await waitingStep.innerText()
  if (!/waiting for the game to close/i.test(waitingText)) {
    throw new Error(`expected the waiting job to name the running game (AC8), got: ${JSON.stringify(waitingText)}`)
  }
  if (readdirSync(baseq2Dir).sort().join(',') !== filesBefore.join(',')) {
    throw new Error('the waiting job wrote to baseq2 before the game exited (AC8)')
  }
  await shot('point-release-waiting-while-running')

  step('AC8: the game exits, and the deferred write resumes and completes on its own')
  await simulateLaunch(page, INSTALL_REPAIR_POINT_RELEASE_ID, 'idle')
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('point-release-repair-succeeded')
  await page.getByTestId('repair-dismiss').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('AC2: on disk, only baseq2/pak2.pak appeared - pak0.pak/pak1.pak are untouched')
  const filesAfter = readdirSync(baseq2Dir).sort()
  if (filesAfter.join(',') !== ['pak0.pak', 'pak1.pak', 'pak2.pak'].join(',')) {
    throw new Error(`expected exactly pak0/pak1/pak2.pak in baseq2 (AC2), found ${filesAfter.join(', ')}`)
  }
  const pak0Size = statSync(installationConfigFilePath(INSTALL_REPAIR_POINT_RELEASE_ID, 'pak0.pak')).size
  const pak1Size = statSync(installationConfigFilePath(INSTALL_REPAIR_POINT_RELEASE_ID, 'pak1.pak')).size
  const pak2Size = statSync(installationConfigFilePath(INSTALL_REPAIR_POINT_RELEASE_ID, 'pak2.pak')).size
  if (pak0Size !== RETAIL_PAK_SIZES['pak0.pak'] || pak1Size !== RETAIL_PAK_SIZES['pak1.pak']) {
    throw new Error('pak0.pak/pak1.pak changed size during the pak2 repair (AC2)')
  }
  if (pak2Size !== RETAIL_PAK_SIZES['pak2.pak']) {
    throw new Error(`expected pak2.pak to be ${RETAIL_PAK_SIZES['pak2.pak']} bytes (AC2), got ${pak2Size}`)
  }

  // ================================================================================================
  // AC3 - demo-pak0: `validation.pak0NotRetail` (info) offers `retail-copy`, which switches the
  // module dialog to 090's own `retail-upgrade` view rather than running a job here.
  // ================================================================================================
  step('AC3: select the demo installation and open Repair from its checks-list fix')
  const demoCard = await selectInstallation(page, INSTALL_DEMO_UPGRADE_NAME)
  if (await repairAction(page).count()) {
    throw new Error('expected Play (not Repair) for an info-only finding (isPlayable("ok"))')
  }
  dialog = await openRepairFromChecksList(page, demoCard)
  await dialog.getByTestId('repair-offer-retail-copy').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('demo-retail-copy-offer')

  step("AC3: clicking retail-copy opens 090's retail-upgrade picker")
  await dialog.getByTestId('repair-offer-retail-copy').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('retail-upgrade-dialog').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('demo-opens-retail-upgrade-view')
  await closeDialog(page)

  // ================================================================================================
  // AC4 - retail-pak-less: `validation.pak0Missing` (error - reachable from the action bar) offers
  // the same `retail-copy` repair; with zero detected store sources, the picker says so plainly.
  // ================================================================================================
  step('AC4: select the retail-pak-less installation and open Repair from the action bar')
  const retailCard = await selectInstallation(page, INSTALL_REPAIR_RETAIL_NAME)
  dialog = await openRepairFromActionBar(page)
  await dialog.getByTestId('repair-offer-retail-copy').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('retail-pak-less-offer')

  step('AC4: the checks list reaches the very same dialog too')
  await closeDialog(page)
  dialog = await openRepairFromChecksList(page, retailCard)
  await dialog.getByTestId('repair-offer-retail-copy').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC4: with no store installation detected, the picker says so instead of an empty list')
  await dialog.getByTestId('repair-offer-retail-copy').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('retail-upgrade-no-sources').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await page.getByTestId('retail-upgrade-source-list').count()) {
    throw new Error('the source picker rendered with zero detected sources (AC4)')
  }
  await shot('retail-pak-less-no-sources')
  await closeDialog(page)

  // ================================================================================================
  // AC5 - non-writable location: `validation.notWritable` (warn) offers `set-write-dir`. This
  // fixture's `writeDirPath` is a real, never-created path under the machine's own `%ProgramFiles%`
  // (`repairNonWritableDir()`, `fixture.mjs`) - deterministic on every machine regardless of this
  // process's own elevation, since `isWritableDir()` fails closed on a non-existent path exactly as
  // it does on a genuinely locked-down one. The co-occurring `pak0Missing` is what makes the action
  // bar's Repair button exist to click; only the `set-write-dir` offer's PRESENCE is asserted here -
  // clicking through it opens a native OS folder picker this harness cannot drive, and the story's
  // own unit test (`RepairDialog.test.tsx`) already proves the click itself calls `useFixAction`.
  // ================================================================================================
  step('AC5: select the non-writable-location installation and open Repair from the action bar')
  await selectInstallation(page, INSTALL_REPAIR_WRITEDIR_NAME)
  dialog = await openRepairFromActionBar(page)
  await dialog.getByTestId('repair-offer-set-write-dir').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('set-write-dir-offer')
  await closeDialog(page)

  // ================================================================================================
  // AC6 - unrepairable: the only finding (`validation.noExecutable`, error - no engine marker on
  // disk to identify what to reinstall) offers nothing at all.
  // ================================================================================================
  step('AC6: select the unrepairable installation and open Repair from the action bar')
  await selectInstallation(page, INSTALL_REPAIR_UNREPAIRABLE_NAME)
  dialog = await openRepairFromActionBar(page)
  await dialog.getByTestId('repair-empty').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await page.locator('[data-testid^="repair-offer-"]').count()) {
    throw new Error('expected no offers for an unrepairable finding (AC6)')
  }
  await shot('nothing-repairable')
  await closeDialog(page)

  console.log(
    'repair: the action bar offered Repair only for the invalid/missing fixtures and the checks ' +
      "list's own install-game-files fix reached the same dialog for every base-paks finding; the " +
      'real engine and pak2 repairs each wrote exactly their own narrow file set (and the pak2 ' +
      'repair genuinely waited for a simulated running game before writing); retail-copy switched ' +
      "to 090's picker for both the demo and the retail-pak-less installation, showing the " +
      "no-detected-sources state for the latter; the non-writable installation offered set-write-dir; " +
      'and the unrepairable installation offered nothing at all.',
  )
}
