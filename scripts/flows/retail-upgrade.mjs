// Story 090 (docs/requirements/090-i-can-upgrade-a-demo-installation-to-retail-from-a-detected-
// store-installation.md) D6: the story's offline end-to-end proof. Walks the whole
// demo-to-retail upgrade in the real app: the trigger's three surfaces (rail hover card, library
// card, action bar), the empty-detected-sources state, the real picker (one verified source, one
// rejected with its reason), the REAL job (a real `copyRetailGameData` copy, staged then promoted
// by `rename`, per `src/main/modules/downloads/retail/upgrade-job.ts`), and the running-installation
// refusal - with no outbound network access at all (nothing here downloads anything; the "source"
// is a fixture folder already on disk).
//
// Covers, in one app session:
//   AC1 - the trigger appears on rail hover card, library card and action bar for a demo
//         installation (D4's `installation.action.importRetail` buttons).
//   AC2 - the dialog lists every detected store installation by store and by path.
//   AC3 - with no store installation detected, the dialog says so instead of an empty picker.
//   AC4 - on disk, only `pak0.pak`/`pak1.pak` changed; a marker file elsewhere in `baseq2`
//         (`RETAIL_UPGRADE_MARKER_FILE`) is untouched, and no `pak2.pak` was ever copied - this
//         story's own scope is "paks only" (Decisions (Sprint)), unlike 088/089's full copy.
//   AC5 - after the upgrade, the Demo marker (both `demo-badge` and the trigger itself, which is
//         gated on the same `isDemoData()`) is gone from all three surfaces.
//   AC6 - the wrong-size (GOG) source is listed, disabled, and states its reason.
//   AC7 - while the installation is `running` (`dev:simulateLaunch`), the trigger is disabled on
//         every surface - proven while the installation is STILL demo data, since a successful
//         upgrade removes the trigger from the DOM entirely (AC5).
//
// ## How this run is offline
//
// One harness-only override, the same double-gated backdoor 088/089 already use
// (`Q2L_UI_HARNESS === '1' && isDev`, `src/main/lib/ui-harness.ts`, unreachable in a packaged
// build - see `src/main/modules/downloads/harness.test.ts`):
//
//   Q2L_UI_HARNESS_STORE_SOURCES  story 088 D2's own override: the `DetectedRetailSource[]` this
//                                 dialog's `getDetectedRetailSources()` reads instead of running a
//                                 real detection scan - the exact same handler
//                                 (`DOWNLOADS_HANDLERS.bootstrapRetailSources`) the bootstrap
//                                 wizard's own game-data step calls, resolved fresh on every call
//                                 (`detectedRetailSourcesFor()`) so this flow can flip it to `'[]'`
//                                 for AC3 and back for the real run, all within one launch - the
//                                 exact mechanism `scripts/flows/bootstrap-retail-import.mjs` uses
//                                 for its own AC1 absent-half; see that flow for the fuller writeup.
//
// The two fixture "store installations" (`writeBootstrapStoreSources()`,
// `scripts/lib/fixture.mjs`, reused as-is - not duplicated) are real files on disk, truncated to
// their exact `RETAIL_PAK_SIZES` (or, for the GOG one, deliberately not). But note what this flow
// actually proves: the harness override (`resolveDetectedRetailSourcesOverride`,
// `src/main/modules/downloads/harness.ts`) returns the env-JSON-seeded `verified` verdict verbatim,
// without re-inspecting the bytes on disk - so this test proves "the job honours a
// `verified: false` source", not "a wrong-sized pak0 on disk produces `verified: false`". That
// second claim - the disk-level check itself - is covered separately by 088's own unit test,
// `src/main/modules/downloads/bootstrap/retail-source.test.ts`.
//
// The demo installation this flow upgrades (`INSTALL_DEMO_UPGRADE_ID`, added to
// `scripts/lib/fixture.mjs`'s `populatedInstallations()`/`writePopulatedFixture()` by this same
// deliverable) is likewise real: a `baseq2/pak0.pak` truncated to the classic demo size, an
// `r1q2.exe` marker so the installation identifies as a known engine with a real executable, and
// `RETAIL_UPGRADE_MARKER_FILE` - a file elsewhere in `baseq2` this flow proves the job never
// touches (AC4). Its `checks` array is ALSO seeded directly (`validation.pak0NotRetail`, info
// severity) rather than left for the real app's own startup `validateAll()` to derive - the same
// "seed the pre-derived value" trick `INSTALL_FAILED_ID` already uses for its `status`, just applied
// to `checks` too because AC1's very first assertion (the trigger's visibility) depends on
// `isDemoData()` reading it immediately, before any revalidation has necessarily run. Seeding an
// `info`-severity check also surfaced a real, pre-existing bug this deliverable fixes:
// `src/main/lib/schemas.ts`'s persisted-state `checkSchema.severity` enum was missing `'info'`
// (`CheckSeverity`, `@shared/types/installation`, is `'ok' | 'info' | 'warn' | 'error'`), so
// `.catch([])` silently discarded the WHOLE `checks` array on load for any installation whose only
// check was info-severity - exactly `validation.pak0NotRetail`, the demo-data marker itself.
//
// ## Selectors, not guesses
//
// `installation.action.importRetail` has no dedicated `data-testid` on any of its three trigger
// buttons (D4's own note in the story: "the agent that built D4 did not necessarily add explicit
// new data-testids") - each is a plain `IconButton` whose only identifying trait is its translated
// `aria-label`, so this flow selects all three by that accessible name
// (`IMPORT_RETAIL_LABEL` below, mirroring `src/renderer/src/i18n/locales/en.json`'s
// `installation.action.importRetail`), scoped per surface (`<aside>` for the rail,
// `footer` for the action bar, the library row for the library card) the same way
// `scripts/flows/installation-icon-tile.mjs` and `scripts/flows/engine-badge-surfaces.mjs` already
// scope same-named buttons that appear on more than one surface at once. Everything inside the
// dialog itself is D3's own real `data-testid`s:
//   retail-upgrade-dialog                     RetailUpgradeDialog.tsx - the picker's container
//   retail-upgrade-no-sources                 .../RetailUpgradeDialog.tsx - AC3's empty state
//   retail-upgrade-source-list                .../RetailUpgradeDialog.tsx
//   retail-upgrade-source-item[data-index]    .../RetailUpgradeDialog.tsx - one per row
//   retail-upgrade-source-item-unverified     .../RetailUpgradeDialog.tsx - AC6's rejection reason
//   retail-upgrade-confirm / -dismiss / -error .../RetailUpgradeDialog.tsx
//   bootstrap-running-step                    .../bootstrap/RunningStep.tsx - reused as-is, `data-status`
//   demo-badge                                components/ui/DemoBadge.tsx - must vanish (AC5)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
/** The real ~197 MB (but sparse/truncated, never real bytes) copy into a staging directory plus two
 * `rename`s and two `inspectInstallation()` revalidations - `bootstrap-retail-import.mjs` budgets
 * 90s for the same-sized copy alongside a real engine download/extraction; this job has neither of
 * those, but the budget stays generous rather than cutting it close. */
const JOB_TIMEOUT_MS = 60_000

/** Mirrors `src/renderer/src/i18n/locales/en.json`'s `installation.action.importRetail`. */
const IMPORT_RETAIL_LABEL = 'Import retail data…'

/** Module-scoped: `setup()` writes it, the flow body below reads it back to name the two fixture
 * sources' own paths/store labels - the same convention `bootstrap-retail-import.mjs` uses. */
let storeSources = null

export async function setup() {
  // Reseeds `populated`, which is also what (re)writes `INSTALL_DEMO_UPGRADE_ID`'s own demo-sized
  // `pak0.pak` fresh for this run - a previous run's upgrade must never leave a retail-sized pak0
  // behind for this one to find.
  writePopulatedFixture()
  storeSources = writeBootstrapStoreSources()

  console.log(`  demo installation: ${INSTALL_DEMO_UPGRADE_ID}`)
  for (const source of storeSources) {
    console.log(
      `  store source ${source.source}: ${source.rootPath} ` +
        `(verified=${source.inspection.verified}${
          source.inspection.unverifiedReason ? `, ${source.inspection.unverifiedReason}` : ''
        })`,
    )
  }

  return {
    env: {
      Q2L_UI_HARNESS_STORE_SOURCES: JSON.stringify(storeSources),
    },
  }
}

/** Scopes the rail's tile/hover-card lookups to `<aside>` - the rail's own landmark - so they
 * cannot resolve the library card's OWN `aria-label={installation.name}` button once both are
 * mounted (`installation-icon-tile.mjs`'s own review-finding comment documents the same hazard). */
function railTile(page, name) {
  return page.locator('aside').getByRole('button', { name, exact: true })
}

/** The library row - no dedicated testid, so this locates the same `items-start` wrapper
 * `installation-icon-tile.mjs`'s own `libraryCard()` helper does, which is what makes the row's
 * action-button cluster (this story's trigger among them) resolvable inside it. */
function libraryCard(page, name) {
  return page
    .locator('div.items-start')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
}

function importRetailButton(scope) {
  return scope.getByRole('button', { name: IMPORT_RETAIL_LABEL })
}

/**
 * A CSS attribute-selector version of `importRetailButton()`, for waiting on its `disabled` state
 * specifically. `locator.waitFor()` only knows attached/detached/visible/hidden - none of which is
 * "enabled"/"disabled" - and a hand-rolled polling loop calling `locator.isDisabled()` (or
 * `page.evaluate()`) repeatedly was observed to hang for the full timeout in this app EVEN WHEN the
 * condition was already true the moment the loop started (measured directly). A plain CSS selector
 * handed to `.locator()` and waited on with the native `.waitFor()`, by contrast, is resolved by
 * Playwright's own actionability engine rather than a hand-rolled retry loop, and was not affected.
 */
function importRetailButtonWithDisabled(scope, disabled) {
  const attr = disabled ? '[disabled]' : ':not([disabled])'
  return scope.locator(`button[aria-label="${IMPORT_RETAIL_LABEL}"]${attr}`)
}

/**
 * Opens one rail tile's hover card. Verbatim from `engine-badge-surfaces.mjs`'s own
 * `openRailCard()` - see that file's doc comment for why the pointer has to be parked away from
 * the rail first (Chromium only fires `pointerenter` on a genuine transition into the element).
 */
async function openRailCard(page, name) {
  const tile = railTile(page, name)
  const card = page.locator('[role="tooltip"]')
  await page.mouse.move(0, 0)
  await card.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await tile.hover({ timeout: TIMEOUT_MS })
  try {
    await card.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  } catch (error) {
    throw new Error(`the rail hover card for "${name}" never opened: ${error.message}`)
  }
  return card
}

/** Sets `Q2L_UI_HARNESS_STORE_SOURCES` inside the RUNNING main process - the same mechanism
 * `bootstrap-retail-import.mjs` uses for its own AC1 absent-half; see that flow for the fuller
 * writeup of why this is the only way to cover both the empty and non-empty cases in one launch. */
async function setStoreSourcesOverride(app, value) {
  await app.evaluate((_electron, next) => {
    process.env.Q2L_UI_HARNESS_STORE_SOURCES = next
  }, value)
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

/** AC2's "identified by its store and its path" / AC6's rejection reason, asserted on one rendered
 * block of text - mirrors `bootstrap-retail-import.mjs`'s own `assertRowNames()`. */
function assertRowNames(text, store, rootPath) {
  if (!text.toLowerCase().includes(store.toLowerCase())) {
    throw new Error(`expected ${JSON.stringify(text)} to name the store "${store}" (AC2)`)
  }
  if (!text.includes(rootPath)) {
    throw new Error(`expected ${JSON.stringify(text)} to name the path ${rootPath} (AC2)`)
  }
}

export default async function retailUpgrade({ page, app, shot, step }) {
  const pak0Path = installationConfigFilePath(INSTALL_DEMO_UPGRADE_ID, 'pak0.pak')
  const pak1Path = installationConfigFilePath(INSTALL_DEMO_UPGRADE_ID, 'pak1.pak')
  const pak2Path = installationConfigFilePath(INSTALL_DEMO_UPGRADE_ID, 'pak2.pak')
  const markerPath = installationConfigFilePath(INSTALL_DEMO_UPGRADE_ID, RETAIL_UPGRADE_MARKER_FILE)
  const baseDir = dirname(pak0Path)

  step('record the fixture demo installation before the upgrade (AC4 baseline)')
  const pak0SizeBefore = statSync(pak0Path).size
  if (pak0SizeBefore === RETAIL_PAK_SIZES['pak0.pak']) {
    throw new Error('fixture bug: the demo installation already has a retail-sized pak0.pak')
  }
  const markerBefore = readFileSync(markerPath)

  // --- AC1: the trigger on all three surfaces -----------------------------------------------------
  step('open the library and select the demo installation')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  const card = libraryCard(page, INSTALL_DEMO_UPGRADE_NAME)
  await card.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  // The row's own icon-tile button only calls `setActiveInstallation` - unlike its Play button,
  // which would also start a (fixture, non-launchable) game.
  await card.getByRole('button', { name: INSTALL_DEMO_UPGRADE_NAME, exact: true }).click({ timeout: TIMEOUT_MS })
  await page
    .locator('footer')
    .filter({ hasText: INSTALL_DEMO_UPGRADE_NAME })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC1: the library card offers the import-retail action')
  await importRetailButton(card).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('library-card-trigger')

  step('AC1: the action bar offers it too')
  const actionBar = page.locator('footer')
  await importRetailButton(actionBar).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC1: the rail hover card offers the import-retail action')
  const railCard = await openRailCard(page, INSTALL_DEMO_UPGRADE_NAME)
  await importRetailButton(railCard).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('rail-hover-card-trigger')

  // --- AC7: disabled while the installation is running, while it is still demo data ----------------
  step('AC7: dev:simulateLaunch(running) disables the action on every surface')
  await simulateLaunch(page, INSTALL_DEMO_UPGRADE_ID, 'running')
  await importRetailButtonWithDisabled(card, true).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await importRetailButtonWithDisabled(actionBar, true).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const railCardRunning = await openRailCard(page, INSTALL_DEMO_UPGRADE_NAME)
  await importRetailButtonWithDisabled(railCardRunning, true).waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
  await shot('trigger-disabled-while-running')

  step('restore idle so the rest of the run can actually open the dialog')
  await simulateLaunch(page, INSTALL_DEMO_UPGRADE_ID, 'idle')
  await importRetailButtonWithDisabled(card, false).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // --- AC3: no detected source --------------------------------------------------------------------
  step('AC3: tell main there are zero detected sources, then open the dialog')
  await setStoreSourcesOverride(app, '[]')
  await importRetailButton(card).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('retail-upgrade-no-sources').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await page.getByTestId('retail-upgrade-source-list').count()) {
    throw new Error('the source picker rendered with zero detected sources (AC3)')
  }
  await shot('no-sources-empty-state')

  step('close the dialog and restore the fixture store sources')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await setStoreSourcesOverride(app, JSON.stringify(storeSources))

  // --- AC2/AC6: the real picker --------------------------------------------------------------------
  step('AC2/AC6: reopen the dialog and assert both sources are listed, one rejected with its reason')
  const unverified = storeSources[0] // gog - wrong pak0 size
  const verified = storeSources[1] // steam - verifies

  await importRetailButton(card).click({ timeout: TIMEOUT_MS })
  const list = page.getByTestId('retail-upgrade-source-list')
  await list.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await page.getByTestId('retail-upgrade-source-item').count() !== 2) {
    throw new Error('expected exactly the two fixture sources in the picker (AC2)')
  }

  const unverifiedRow = page.locator('[data-testid="retail-upgrade-source-item"][data-index="0"]')
  const verifiedRow = page.locator('[data-testid="retail-upgrade-source-item"][data-index="1"]')
  assertRowNames(await unverifiedRow.innerText(), 'GOG', unverified.rootPath)
  assertRowNames(await verifiedRow.innerText(), 'Steam', verified.rootPath)

  if (!(await unverifiedRow.isDisabled())) {
    throw new Error('the wrong-size (GOG) source was selectable - AC6 requires it listed but not choosable')
  }
  if ((await unverifiedRow.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('the unverified source row reported itself as selected (AC6)')
  }
  const reason = await page.getByTestId('retail-upgrade-source-item-unverified').innerText()
  if (!/pak0\.pak/i.test(reason) || !/retail/i.test(reason)) {
    throw new Error(`expected the rejection reason to name pak0.pak and the retail size, got: ${JSON.stringify(reason)} (AC6)`)
  }
  await shot('picker-good-and-bad-sources')

  step('AC2: choose the verified source and start the upgrade')
  await verifiedRow.click({ timeout: TIMEOUT_MS })
  if ((await verifiedRow.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('clicking the verified source row did not select it (AC2)')
  }
  const confirm = page.getByTestId('retail-upgrade-confirm')
  if (!(await confirm.isEnabled())) {
    throw new Error('the confirm button stayed disabled with a verified source chosen')
  }
  await confirm.click({ timeout: TIMEOUT_MS })

  step('wait for the job to succeed')
  await page.getByTestId('bootstrap-running-step').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('upgrade-succeeded')
  await page.getByTestId('retail-upgrade-dismiss').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  // --- AC5: the Demo marker is gone from every surface ----------------------------------------------
  step('AC5: the Demo marker and the trigger are gone from the action bar')
  await page
    .locator('footer [data-testid="demo-badge"]')
    .waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  if (await importRetailButton(actionBar).count()) {
    throw new Error('the action bar still offered the import-retail action after the upgrade (AC5)')
  }

  step('AC5: the Demo marker and the trigger are gone from the library card')
  if (await card.getByTestId('demo-badge').count()) {
    throw new Error('the library card still showed a Demo badge after the upgrade (AC5)')
  }
  if (await importRetailButton(card).count()) {
    throw new Error('the library card still offered the import-retail action after the upgrade (AC5)')
  }

  step('AC5: the Demo marker and the trigger are gone from the rail hover card')
  const railCardAfter = await openRailCard(page, INSTALL_DEMO_UPGRADE_NAME)
  if (await railCardAfter.getByTestId('demo-badge').count()) {
    throw new Error('the rail hover card still showed a Demo badge after the upgrade (AC5)')
  }
  if (await importRetailButton(railCardAfter).count()) {
    throw new Error('the rail hover card still offered the import-retail action after the upgrade (AC5)')
  }
  await shot('post-upgrade-no-demo-marker')

  // --- AC4: on disk, only pak0.pak/pak1.pak changed -------------------------------------------------
  step('AC4: on disk, only pak0.pak/pak1.pak changed, and the marker file is untouched')
  // `runUpgrade`'s own staging-directory cleanup (`.q2launcher-upgrade-<jobId>`) is a best-effort
  // `finally` that starts only once `jobs.finish('succeeded')` has already fired - the "succeeded"
  // UI state this flow just waited on can therefore land a moment before that directory is actually
  // gone. Polled rather than asserted once, so this never flakes on that ordering.
  const expectedFiles = ['pak0.pak', 'pak1.pak', RETAIL_UPGRADE_MARKER_FILE].sort()
  let filesAfter = readdirSync(baseDir).sort()
  const filesDeadline = Date.now() + TIMEOUT_MS
  while (JSON.stringify(filesAfter) !== JSON.stringify(expectedFiles) && Date.now() < filesDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    filesAfter = readdirSync(baseDir).sort()
  }
  if (JSON.stringify(filesAfter) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `expected baseq2 to hold exactly ${JSON.stringify(expectedFiles)} after the upgrade, found ${JSON.stringify(filesAfter)} (AC4)`,
    )
  }
  if (existsSync(pak2Path)) {
    throw new Error('pak2.pak was copied - this story upgrades pak0.pak/pak1.pak only (AC4)')
  }

  const pak0SizeAfter = statSync(pak0Path).size
  const pak1SizeAfter = statSync(pak1Path).size
  if (pak0SizeAfter !== RETAIL_PAK_SIZES['pak0.pak']) {
    throw new Error(`expected pak0.pak to be ${RETAIL_PAK_SIZES['pak0.pak']} bytes, got ${pak0SizeAfter} (AC4)`)
  }
  if (pak1SizeAfter !== RETAIL_PAK_SIZES['pak1.pak']) {
    throw new Error(`expected pak1.pak to be ${RETAIL_PAK_SIZES['pak1.pak']} bytes, got ${pak1SizeAfter} (AC4)`)
  }

  const markerAfter = readFileSync(markerPath)
  if (!markerAfter.equals(markerBefore)) {
    throw new Error(`the marker file elsewhere in baseq2 changed - the upgrade must touch only pak0.pak/pak1.pak (AC4)`)
  }

  console.log(
    'retail upgrade: the trigger appeared on rail hover card, library card and action bar for the ' +
      'demo installation and was disabled while it was reported running, the empty-sources state ' +
      'showed instead of an empty picker, both fixture sources were listed by store and path with ' +
      'the wrong-size one rejected and its reason shown, the real job copied pak0.pak/pak1.pak into ' +
      'the installation leaving the marker file and pak2.pak untouched, and the Demo marker ' +
      'disappeared from every surface afterwards',
  )
}
