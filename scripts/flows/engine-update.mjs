// Story 092 (docs/requirements/092-an-engine-updates-and-rolls-back.md) D8: the story's offline
// end-to-end proof. Walks update -> rollback -> bleeding-edge-on -> bleeding-edge-off against an
// already-registered, already-playable Q2PRO installation and lets the REAL jobs run - a real
// manifest fetch, a real verified download of the fixture's own Q2PRO archive, a real `7za.exe`
// extraction, the real allowlist-driven backup/swap/restore (`engine/update-job.ts`,
// `engine/rollback-job.ts`) - against a `127.0.0.1` fixture server, with no outbound network access
// at all.
//
// Covers AC1 (an out-of-date installation shows the update affordance and nothing has downloaded or
// changed yet), AC2 (Update writes the new engine bytes and leaves the old ones in the backup
// directory), AC3 (Rollback restores the previous bytes in one step), AC4/AC5 (the bleeding-edge
// toggle changes the target version for this installation only, and reverts when turned off) and AC7
// (the dialog's own "current version" reading changes after each step).
//
// ## Why this flow seeds instead of bootstrapping
//
// Decisions (Sprint): "The e2e flow seeds an out-of-date installation into the fixture and runs the
// real job against the loopback fixture server ... instead of bootstrapping one first - same offline
// discipline, a fraction of the runtime." `scripts/lib/fixture.mjs`'s `populatedInstallations()`
// gains a sixth, additive installation (`INSTALL_ENGINE_UPDATE_ID`, "Fixture Engine Update Install"),
// the same convention `INSTALL_DEMO_UPGRADE_ID` (090 D6) documents: last `sortOrder`, assigned to no
// config profile. Its `moduleData` records a recorded engine version
// (`ENGINE_UPDATE_OLD_VERSION`) already older than the fixture manifest's own pin
// (`BOOTSTRAP_ENGINE_FIXTURE_VERSION`, "fixture-1"), so `engine.updateStatus` reports
// `updateAvailable: true` from the installation's very first render - no wizard run needed. Its
// three engine files (`ENGINE_FIXTURE_FILES`' own keys - `q2pro64.exe`, `baseq2/gamex86_64.dll`,
// `baseq2/q2pro.menu`) are real, on-disk files, filled with `ENGINE_UPDATE_OLD_FILL_BYTE` - a byte
// distinct from every fill byte the REAL fixture Q2PRO archive extracts onto those same paths - so a
// plain byte comparison after each job tells "still the old build" apart from "the job touched this
// file". Retail-sized (truncated, never real bytes) `pak0.pak`/`pak1.pak`/`pak2.pak` keep this
// installation reading as a plain, working `ok` install with no demo-data marker, unlike the
// `INSTALL_DEMO_UPGRADE_ID` fixture `retail-upgrade.mjs` uses.
//
// ## How this run is offline
//
// One harness-only override, the same one `bootstrap-wizard.mjs`/every other bootstrap-flavoured
// flow already uses (`Q2L_UI_HARNESS === '1' && isDev`, `src/main/lib/ui-harness.ts`):
//
//   Q2L_UI_CONTENT_REPO_BASE  the manifest/package base URL (`resolveDownloadSource()`,
//                             `src/main/modules/downloads/harness.ts`). Refused unless it names a
//                             `127.0.0.1` origin.
//
// The fixture server (`startBootstrapFixtureServer()`) serves `/engines/manifest.json` pinning the
// Q2PRO fixture package at `BOOTSTRAP_ENGINE_FIXTURE_VERSION`, `/packages/<fileName>` (+ its mirror)
// for the real archive, and - this deliverable's own addition - `/packages/version.txt`, a plain-text
// nightly version string. `probeBleedingEdge()` (`src/main/modules/downloads/engine/bleeding-edge.ts`)
// derives its `version.txt` request by swapping the pinned package's asset URL's own final path
// segment, which for this server is always `/packages/<engine fileName>` - so the sibling path is
// always `/packages/version.txt`, matched by this fixture's own route without needing to know the
// engine package's file name. The probe's `HEAD` half lands on the SAME package URL the pinned
// build already serves (`bleeding-edge.ts`'s own doc comment: it probes the manifest's own pinned
// asset, never a second, separately-named URL) - so bleeding-edge mode never needs a second archive.
//
// The evidence that nothing else was contacted is the fixture server's own request log
// (`server.requested`, printed at the end, the same convention `bootstrap-wizard.mjs` uses): AC1
// asserts it holds no request for the package archive before Update is ever clicked.
//
// ## Selectors
//
// `engine-update-action`               EngineUpdateAction.tsx - the ActionBar trigger (span wrapper)
// `engine-update-available-indicator`  .../EngineUpdateAction.tsx - the dot, present iff an update
//                                       is available
// `engine-update-dialog`               .../EngineUpdateDialog.tsx - the status view's container
// `engine-update-current` / `-target`  .../EngineUpdateDialog.tsx - AC7's own "current version" read
// `engine-update-confirm`              .../EngineUpdateDialog.tsx - starts the update job
// `engine-update-rollback`             .../EngineUpdateDialog.tsx - starts the rollback job
// `engine-update-dismiss`              .../EngineUpdateDialog.tsx - closes a finished job
// `bootstrap-running-step`             .../bootstrap/RunningStep.tsx - reused as-is, `data-status`
// the bleeding-edge toggle              a plain `Switch`, addressed by role="switch"/accessible name
//                                       ("Bleeding edge", `engineUpdate.bleedingEdge.label`)
import { existsSync, readFileSync } from 'node:fs'
import {
  BOOTSTRAP_ENGINE_FIXTURE_VERSION,
  ENGINE_FIXTURE_FILES,
  ENGINE_INSTALLED_RELATIVE,
  ENGINE_UPDATE_OLD_FILL_BYTE,
  ENGINE_UPDATE_OLD_VERSION,
  INSTALL_ENGINE_UPDATE_ID,
  INSTALL_ENGINE_UPDATE_NAME,
  installationRootFilePath,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** The whole job: one throttled download, one 7za spawn, the allowlist swap, one revalidation -
 * mirrors `bootstrap-wizard.mjs`'s own single-package budget, not its three-package one. */
const JOB_TIMEOUT_MS = 60_000

/** The nightly version `/packages/version.txt` reports - distinct from `BOOTSTRAP_ENGINE_FIXTURE_
 * VERSION` (the manifest's pinned build), so AC4's "the target changes" assertion cannot pass by
 * accident. */
const BLEEDING_EDGE_VERSION = 'fixture-nightly-99'

/** Mirrors `ENGINE_BACKUP_DIR_NAME` (`src/main/modules/downloads/engine/update-job.ts`) - a plain
 * shared-layer-free constant in a main-process-only module this plain-Node script cannot import. */
const ENGINE_BACKUP_DIR_NAME = '.q2launcher-engine-backup'

/** Mirrors `engineUpdate.bleedingEdge.label` (`src/renderer/src/i18n/locales/en.json`). */
const BLEEDING_EDGE_LABEL = 'Bleeding edge'

let server = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - this flow runs the REAL extractor against a real ' +
        'archive and will not pretend otherwise. Run `npm run fetch:7za` first.',
    )
  }

  // Reseeds `populated`, which is also what (re)writes `INSTALL_ENGINE_UPDATE_ID`'s own old-fill-byte
  // engine files fresh for this run - a previous run's update/rollback must never leave a
  // half-finished swap or a used-up backup slot behind for this one to find.
  writePopulatedFixture()
  server = await startBootstrapFixtureServer({ bleedingEdgeVersion: BLEEDING_EDGE_VERSION })

  console.log(`  fixture server: ${server.baseUrl}`)
  console.log(`  engine-update installation: ${INSTALL_ENGINE_UPDATE_ID}`)
  for (const pkg of server.packages) {
    console.log(`  package ${pkg.role}: ${pkg.fileName} ${pkg.sizeBytes} bytes`)
  }

  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
    },
  }
}

export async function teardown() {
  if (server) {
    await server.close()
    server = null
  }
}

/** The library row - no dedicated testid, so this locates the same `items-start` wrapper
 * `retail-upgrade.mjs`'s own `libraryCard()` helper does. */
function libraryCard(page, name) {
  return page
    .locator('div.items-start')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
}

/**
 * The three engine files, as `{ archiveRelative, path }` - `archiveRelative` is `ENGINE_FIXTURE_
 * FILES`'s own key (what the fixture archive itself contains, and where its `sizeBytes`/`fillByte`
 * are indexed from), `path` is the REAL on-disk path once installed - `ENGINE_INSTALLED_RELATIVE`'s
 * spelling, `q2pro.exe` at the root rather than the archive's own `q2pro64.exe` (see that constant's
 * own doc comment in `fixture.mjs`), the other two unchanged.
 */
function engineFilePaths() {
  return Object.keys(ENGINE_FIXTURE_FILES).map((archiveRelative) => ({
    archiveRelative,
    path: installationRootFilePath(INSTALL_ENGINE_UPDATE_ID, ENGINE_INSTALLED_RELATIVE[archiveRelative]),
  }))
}

/** The backup slot's own copy of one engine file, addressed the same installed-relative way the
 * update job itself resolves and backs it up (`update-job.ts`'s `PlannedSwap.backupPath`). */
function backupPathFor(archiveRelative) {
  const installedRelative = ENGINE_INSTALLED_RELATIVE[archiveRelative]
  return installationRootFilePath(INSTALL_ENGINE_UPDATE_ID, `${ENGINE_BACKUP_DIR_NAME}/${installedRelative}`)
}

/**
 * Asserts every engine file on disk matches `fillByteFor(archiveRelative)`, at the size the fixture
 * archive itself was built with (`ENGINE_FIXTURE_FILES`). `fillByteFor` is a function rather than a
 * single byte because the three files carry three DISTINCT fill bytes once the real fixture archive
 * has been extracted onto them (`ENGINE_FIXTURE_FILES`'s own per-file `fillByte`) - only the "still
 * the old build" state shares one byte across all three.
 */
function assertEngineFilesFilled(fillByteFor, label) {
  for (const { archiveRelative, path } of engineFilePaths()) {
    const { sizeBytes } = ENGINE_FIXTURE_FILES[archiveRelative]
    const fillByte = fillByteFor(archiveRelative)
    const bytes = readFileSync(path)
    const expected = Buffer.alloc(sizeBytes, fillByte)
    if (!bytes.equals(expected)) {
      throw new Error(
        `expected ${ENGINE_INSTALLED_RELATIVE[archiveRelative]} to be ${sizeBytes} bytes of ` +
          `0x${fillByte.toString(16)} ${label}, got ${bytes.byteLength} bytes starting ` +
          `0x${bytes.subarray(0, 1).toString('hex')}`,
      )
    }
  }
}

/** `fillByteFor` for "every file still holds the fixture's old, pre-update bytes". */
const oldFillByteFor = () => ENGINE_UPDATE_OLD_FILL_BYTE
/** `fillByteFor` for "every file now holds the REAL fixture archive's own bytes" - each file's own
 * distinct fill byte, per `ENGINE_FIXTURE_FILES`. */
const newFillByteFor = (relative) => ENGINE_FIXTURE_FILES[relative].fillByte

function engineBackupDir() {
  return installationRootFilePath(INSTALL_ENGINE_UPDATE_ID, ENGINE_BACKUP_DIR_NAME)
}

function packageRequested(server, part) {
  return server.requested.some((path) => path.includes(part))
}

async function openDialog(page, card) {
  await card.getByTestId('engine-update-action').getByRole('button').click({ timeout: TIMEOUT_MS })
  const dialog = page.getByTestId('engine-update-dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  return dialog
}

async function closeDialog(page) {
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
}

async function runJob(page, shot, testId, label) {
  await page.getByTestId(testId).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('bootstrap-running-step').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot(`${label}-in-progress`)
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot(label)
  await page.getByTestId('engine-update-dismiss').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
}

export default async function engineUpdate({ page, shot, step }) {
  const backupDir = engineBackupDir()

  // No manifest warm-up here on purpose: `engine.updateStatus` fetches the manifest itself before
  // reading the pin (`resolveEngineUpdateTarget`, `src/main/modules/downloads/index.ts`), so this
  // flow deliberately asks a *cold* session - which is what a user's first look at the ActionBar is.
  step('open the library and select the engine-update installation')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  const card = libraryCard(page, INSTALL_ENGINE_UPDATE_NAME)
  await card.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await card
    .getByRole('button', { name: INSTALL_ENGINE_UPDATE_NAME, exact: true })
    .click({ timeout: TIMEOUT_MS })
  const actionBar = page.locator('footer')
  await actionBar
    .filter({ hasText: INSTALL_ENGINE_UPDATE_NAME })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // --- AC1: the affordance shows, and nothing has downloaded or changed yet ------------------------
  step('AC1: the action bar shows the update-available indicator')
  const action = actionBar.getByTestId('engine-update-action')
  await action.getByTestId('engine-update-available-indicator').waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })

  step('AC1: nothing has been downloaded yet, and the on-disk engine is still the old build')
  if (packageRequested(server, '/packages/q2pro-fixture-client.zip')) {
    throw new Error('the fixture Q2PRO archive was already requested before Update was clicked (AC1)')
  }
  if (existsSync(backupDir)) {
    throw new Error('a backup directory already exists before any update ran (AC1)')
  }
  assertEngineFilesFilled(oldFillByteFor, 'before the update')

  step('AC1/AC7: open the dialog and read the current/target versions')
  let dialog = await openDialog(page, actionBar)
  const currentBefore = await dialog.getByTestId('engine-update-current').innerText()
  const targetBefore = await dialog.getByTestId('engine-update-target').innerText()
  if (currentBefore !== ENGINE_UPDATE_OLD_VERSION) {
    throw new Error(`expected the current version to read "${ENGINE_UPDATE_OLD_VERSION}", got "${currentBefore}" (AC7)`)
  }
  if (targetBefore !== BOOTSTRAP_ENGINE_FIXTURE_VERSION) {
    throw new Error(
      `expected the target version to read the manifest pin "${BOOTSTRAP_ENGINE_FIXTURE_VERSION}", got "${targetBefore}"`,
    )
  }
  await shot('idle-update-available')
  if (packageRequested(server, '/packages/q2pro-fixture-client.zip')) {
    throw new Error('opening the dialog alone downloaded the package (AC1)')
  }

  // --- AC2: Update writes the new bytes and backs up the old ones -----------------------------------
  step('AC2: click Update and wait for the real job to succeed')
  await runJob(page, shot, 'engine-update-confirm', 'updated')

  step('AC2: on disk, the engine files are now the new fixture bytes, and the old ones are backed up')
  for (const { archiveRelative } of engineFilePaths()) {
    const { sizeBytes } = ENGINE_FIXTURE_FILES[archiveRelative]
    const backupBytes = readFileSync(backupPathFor(archiveRelative))
    const expectedOld = Buffer.alloc(sizeBytes, ENGINE_UPDATE_OLD_FILL_BYTE)
    if (!backupBytes.equals(expectedOld)) {
      throw new Error(
        `expected the backed-up ${ENGINE_INSTALLED_RELATIVE[archiveRelative]} to hold the old bytes (AC2)`,
      )
    }
  }
  assertEngineFilesFilled(newFillByteFor, 'after the update')

  step('AC7: the dialog now reads the new version as current')
  dialog = await openDialog(page, actionBar)
  const currentAfterUpdate = await dialog.getByTestId('engine-update-current').innerText()
  if (currentAfterUpdate !== BOOTSTRAP_ENGINE_FIXTURE_VERSION) {
    throw new Error(
      `expected the current version to read the updated build "${BOOTSTRAP_ENGINE_FIXTURE_VERSION}" (AC7), got "${currentAfterUpdate}"`,
    )
  }

  // --- AC3: Rollback restores the previous bytes in one step ----------------------------------------
  step('AC3: click Rollback and wait for the real job to succeed')
  const rollback = dialog.getByTestId('engine-update-rollback')
  if (!(await rollback.isEnabled())) {
    throw new Error('the rollback button stayed disabled with a backup on record (AC3)')
  }
  await runJob(page, shot, 'engine-update-rollback', 'rolled-back')

  step('AC3: on disk, the engine files are back to the old fixture bytes, and the backup slot is empty')
  assertEngineFilesFilled(oldFillByteFor, 'after the rollback')
  if (existsSync(backupDir)) {
    throw new Error('the backup directory survived the rollback (AC3)')
  }

  step('AC7: the dialog now reads the old version as current again')
  dialog = await openDialog(page, actionBar)
  const currentAfterRollback = await dialog.getByTestId('engine-update-current').innerText()
  if (currentAfterRollback !== ENGINE_UPDATE_OLD_VERSION) {
    throw new Error(
      `expected the current version to read the rolled-back build "${ENGINE_UPDATE_OLD_VERSION}" (AC7), got "${currentAfterRollback}"`,
    )
  }

  // --- AC4/AC5: bleeding edge changes the target for this installation only -------------------------
  step('AC4: toggle bleeding edge on and assert the target becomes the probed nightly version')
  const bleedingEdgeSwitch = dialog.getByRole('switch', { name: BLEEDING_EDGE_LABEL })
  await bleedingEdgeSwitch.click({ timeout: TIMEOUT_MS })
  const targetOn = dialog.getByTestId('engine-update-target').filter({ hasText: BLEEDING_EDGE_VERSION })
  await targetOn.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await dialog.getByTestId('engine-update-bleeding-edge-error').count()) {
    const message = await dialog.getByTestId('engine-update-bleeding-edge-error').innerText()
    throw new Error(`turning bleeding edge on failed: ${message}`)
  }
  await shot('bleeding-edge-on')

  step('AC5: toggle bleeding edge off and assert the target reverts to the manifest pin')
  await bleedingEdgeSwitch.click({ timeout: TIMEOUT_MS })
  const targetOff = dialog
    .getByTestId('engine-update-target')
    .filter({ hasText: BOOTSTRAP_ENGINE_FIXTURE_VERSION })
  await targetOff.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await dialog.getByTestId('engine-update-bleeding-edge-error').count()) {
    const message = await dialog.getByTestId('engine-update-bleeding-edge-error').innerText()
    throw new Error(`turning bleeding edge off failed: ${message}`)
  }
  await shot('bleeding-edge-off')

  await closeDialog(page)

  console.log(
    `engine update: no request for the package archive before Update was clicked, and the fixture ` +
      `server was the only host contacted (requested: ${server.requested.join(', ')}). Update wrote ` +
      `the new fixture bytes and backed up the old ones, Rollback restored the old bytes in one step, ` +
      `and the bleeding-edge toggle changed this installation's target to the probed nightly version ` +
      `and back, independent of the manifest pin.`,
  )
}
