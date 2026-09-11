// Story 088 (docs/requirements/088-retail-import-from-a-detected-store-installation.md) D6: the
// story's offline end-to-end proof. Walks the whole bootstrap wizard in the real app with the new
// game-data step set to "copy from a detected installation", and lets the REAL job run - real
// manifest fetch, a real verified engine download, a real `7za.exe` extraction, the real allowlist
// assemble, the real retail copy, the real `inspectInstallation` revalidations - against a
// `127.0.0.1` fixture server and two fixture "store installations" on disk, with no outbound
// network access at all.
//
// Covers, in one app session:
//   AC1 - the game-data step offers the copy source when a store installation is detected, and
//         omits it (absent, not disabled) when none is - both halves, see "The empty-list half"
//         below for how one launch proves both.
//   AC2 - two detected installations are pickable, each identified by its store AND its path.
//   AC3 - the wrong-size `pak0.pak` source is listed, is not selectable, and states its reason.
//   AC4 - the run copies pak0/pak1 (+ the size-matching pak2) into the target and downloads the
//         ENGINE package only - asserted from the fixture server's own request log, so "the game
//         data was not downloaded" is evidence rather than an inference from a passing job.
//   AC5 - the confirm step names the copy source, the engine-only download with its size, and the
//         target path.
//   AC6 - the finished installation carries NO Demo marker (neither on its library card nor in the
//         action bar), because its pak0 is retail-sized - the marker is derived from
//         `validation.pak0NotRetail`, so this is an assertion about real assembled bytes.
//   AC7 - the target holds `baseq2` only: no `ctf`/`xatrix`/`rogue` anywhere, no stray `pak3.pak`,
//         no loose `quake2.exe` - all of which the fixture sources DO contain.
//
// ## How this run is offline
//
// Three harness-only overrides, all under the SAME double gate (`Q2L_UI_HARNESS === '1' && isDev`,
// `src/main/lib/ui-harness.ts`), all provably unreachable in a packaged build where `isDev` is
// always `false` - see `src/main/modules/downloads/harness.test.ts`:
//
//   Q2L_UI_CONTENT_REPO_BASE      the manifest/package base URL (`resolveDownloadSource()`,
//                                 `src/main/modules/downloads/harness.ts`), refused unless it names
//                                 a `127.0.0.1` origin. Same as `bootstrap-wizard.mjs`.
//   Q2L_UI_PICK_FOLDER            what `installations:pickFolder` answers instead of opening a
//                                 native OS dialog. One entry (this target is fresh and outside
//                                 Program Files), and a stub's last entry repeats forever.
//   Q2L_UI_HARNESS_STORE_SOURCES  story 088 D2's own override: the `DetectedRetailSource[]` the
//                                 wizard and the job both read instead of running a real detection
//                                 scan (`resolveDetectedRetailSourcesOverride()`, same file). It is
//                                 what makes this flow possible at all - no test can plant a real
//                                 Steam library - and it is also what keeps the harness's standing
//                                 promise that a run never triggers `detection:scan` (which shells
//                                 out to `reg.exe` and walks the developer's real Steam/GOG dirs).
//
// The JSON is produced by `writeBootstrapStoreSources()` (`scripts/lib/fixture.mjs`) from the
// fixture files it has just written, never hand-authored: main re-verifies the chosen source before
// copying (`verifyCopySource`, `bootstrap/job.ts`), so an injected verdict that disagreed with the
// bytes on disk would either fail the run or make a passing one prove nothing.
//
// ## The empty-list half of AC1
//
// A flow gets ONE app launch, and the environment block of a running process cannot be changed from
// outside - so the absent case cannot simply be a second launch with the variable unset. It does
// not need to be: `detectedRetailSourcesFor()` (`src/main/modules/downloads/index.ts`) resolves the
// override FRESH on every call, precisely so "a UI-verification flow needs to change its fixture
// between wizard runs within one launch" (its own doc comment, story 088 D2). This flow therefore
// sets `process.env.Q2L_UI_HARNESS_STORE_SOURCES` to `'[]'` inside the main process via
// `app.evaluate()`, opens the wizard once and asserts the copy choice is absent, then restores the
// fixture list before the real run. `'[]'` is an override that says "there are zero sources", NOT
// an unset variable - an unset one would fall through to the real `listDetectedRetailSources()` and
// its real detection scan, which is exactly what this harness must never do. The double gate is
// untouched by any of this: `isUiHarnessEnabled()` still has to be true for the value to be read at
// all.
//
// ## Selectors, not guesses
//
// Everything `bootstrap-wizard.mjs`'s own selector table already lists, plus (all from story 088
// D5 - read the components before changing any of them):
//   bootstrap-gamedata-choice-free-download        modules/downloads/bootstrap/GameDataStep.tsx
//   bootstrap-gamedata-choice-store-copy           .../GameDataStep.tsx - absent when the list is empty
//   bootstrap-gamedata-source-list                 .../GameDataStep.tsx
//   bootstrap-gamedata-source-<index>              .../GameDataStep.tsx - store + path, `disabled`
//                                                  and `aria-pressed` are the real state
//   bootstrap-gamedata-source-<index>-unverified   .../GameDataStep.tsx - AC3's reason line
//   bootstrap-confirm-copy-source                  .../ConfirmStep.tsx  - AC5's copy-source line
//   bootstrap-confirm-include-extras-disabled      .../ConfirmStep.tsx  - the toggle-availability rule
//   demo-badge                                     components/ui/DemoBadge.tsx - must NOT appear (AC6)
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import {
  RETAIL_PAK_SIZES,
  bootstrapRetailTargetDir,
  readTargetTree,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeBootstrapRetailTargetDir,
  writeBootstrapStoreSources,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** The whole job: one throttled engine download, one 7za spawn, the assemble, the ~197 MB retail
 * copy and two revalidations - the same budget `bootstrap-wizard.mjs` gives its own three-package
 * run, which this one is comfortably smaller than in every respect but the copy. */
const JOB_TIMEOUT_MS = 90_000

/** The name a `store-copy` run gets: the engine's own product label (`engineLabel`,
 * `@shared/types/engine`), never `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` ("Q2PRO Demo") - story 088's
 * "Decided during refine" note, since AC6 says the result is not a demo. */
const INSTALLATION_NAME = 'Q2PRO'

/** Directories AC7 forbids; both fixture store installations ship all three, on purpose. */
const FORBIDDEN_DIRS = ['ctf', 'xatrix', 'rogue']

/** Files the fixture sources carry that the allowlist must never copy. */
const FORBIDDEN_FILES = ['pak3.pak', 'quake2.exe']

/** Module-scoped, because `setup()` starts/writes them and the flow body needs them back. */
let server = null
let storeSources = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - this flow runs the REAL extractor against a real ' +
        'archive and will not pretend otherwise. Run `npm run fetch:7za` first.',
    )
  }

  // Reseeded for the same reason `bootstrap-wizard.mjs` reseeds: this flow registers a real
  // installation into the `populated` state document, and `InstallationsService.create()` refuses a
  // second one at the same path - so without this a second run would fail at "start".
  writePopulatedFixture()
  const targetPath = writeBootstrapRetailTargetDir()
  storeSources = writeBootstrapStoreSources()
  server = await startBootstrapFixtureServer()

  console.log(`  fixture server: ${server.baseUrl}`)
  console.log(`  fixture target: ${targetPath}`)
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
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      // One entry: this target is fresh and outside Program Files, so no warning is expected and
      // Browse is only ever clicked once (the stub's last entry repeats anyway).
      Q2L_UI_PICK_FOLDER: [targetPath].join(delimiter),
      Q2L_UI_HARNESS_STORE_SOURCES: JSON.stringify(storeSources),
    },
  }
}

export async function teardown() {
  if (server) {
    await server.close()
    server = null
  }
}

export default async function bootstrapRetailImport({ page, app, shot, step }) {
  const targetPath = bootstrapRetailTargetDir()
  const unverified = storeSources[0]
  const verified = storeSources[1]

  // --- AC1 (absent half): no detected installation, no copy choice -------------------------------
  step('tell the main process there are zero detected sources (AC1, absent half)')
  await setStoreSourcesOverride(app, '[]')

  step('open the wizard and assert the copy choice is absent, not disabled (AC1)')
  await openWizard(page)
  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })
  // Waiting on the free-download choice is what proves the list has RESOLVED: `GameDataStep`
  // renders a loading line while `sources` is still `null` and neither choice row exists yet, so
  // an "absent" assertion taken any earlier would pass vacuously.
  await page
    .getByTestId('bootstrap-gamedata-choice-free-download')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const emptyListCopyChoice = await page.getByTestId('bootstrap-gamedata-choice-store-copy').count()
  if (emptyListCopyChoice !== 0) {
    throw new Error(
      'the game-data step offered the copy choice with zero detected sources - AC1 requires it ' +
        'to be absent, not shown disabled',
    )
  }
  if (await page.getByTestId('bootstrap-gamedata-source-list').count()) {
    throw new Error('the source picker rendered with zero detected sources (AC1)')
  }
  await shot('gamedata-step-no-sources')

  step('close the wizard and restore the fixture store sources')
  await page.getByRole('button', { name: 'Cancel' }).click({ timeout: TIMEOUT_MS })
  await setStoreSourcesOverride(app, JSON.stringify(storeSources))

  // --- AC1 (present half) + AC2 + AC3: the picker --------------------------------------------------
  step('reopen the wizard and assert the engine step still offers the fixture Q2PRO build')
  await openWizard(page)
  const engineText = await page.getByTestId('bootstrap-engine-q2pro').innerText()
  if (!engineText.includes('fixture-1')) {
    throw new Error(
      `expected the engine option to show the fixture manifest's version "fixture-1" (proving the ` +
        `loopback manifest was used), got: ${JSON.stringify(engineText)}`,
    )
  }
  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })

  step('assert the copy choice is offered now that sources exist (AC1)')
  const copyChoice = page.getByTestId('bootstrap-gamedata-choice-store-copy')
  await copyChoice.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await copyChoice.click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-gamedata-source-list')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert both detected installations are listed with their store and their path (AC2)')
  const unverifiedRow = page.getByTestId('bootstrap-gamedata-source-0')
  const verifiedRow = page.getByTestId('bootstrap-gamedata-source-1')
  if (await page.getByTestId('bootstrap-gamedata-source-2').count()) {
    throw new Error('a third source row was rendered - the fixture injects exactly two (AC2)')
  }
  const unverifiedText = await unverifiedRow.innerText()
  const verifiedText = await verifiedRow.innerText()
  assertRowNames(unverifiedText, 'GOG', unverified.rootPath)
  assertRowNames(verifiedText, 'Steam', verified.rootPath)

  step('assert the wrong-size installation is listed, not selectable, and states its reason (AC3)')
  if (!(await unverifiedRow.isDisabled())) {
    throw new Error(
      `the source with a wrong-size pak0.pak (${unverified.inspection.pak0.sizeBytes} bytes, ` +
        `retail is ${RETAIL_PAK_SIZES['pak0.pak']}) was selectable - AC3 requires it to be listed ` +
        'but not choosable',
    )
  }
  if ((await unverifiedRow.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('the unverified source row reported itself as selected (AC3)')
  }
  const reason = await page.getByTestId('bootstrap-gamedata-source-0-unverified').innerText()
  if (!/pak0\.pak/i.test(reason) || !/retail/i.test(reason)) {
    throw new Error(
      `expected the unverified row's reason to name pak0.pak and the retail size, got: ${JSON.stringify(reason)} (AC3)`,
    )
  }
  await shot('gamedata-step-picker')

  step('choose the verified installation (AC2)')
  await verifiedRow.click({ timeout: TIMEOUT_MS })
  if ((await verifiedRow.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('clicking the verified source row did not select it (AC2)')
  }
  const next = page.getByRole('button', { name: 'Next' })
  if (!(await next.isEnabled())) {
    throw new Error('Next stayed disabled with a verified copy source chosen (AC2)')
  }
  await next.click({ timeout: TIMEOUT_MS })

  // --- Target step: a fresh, non-Program-Files folder needs no warning acknowledged ---------------
  step('pick the fresh retail-import fixture target')
  const browse = page
    .getByTestId('bootstrap-target-path-input')
    .getByRole('button', { name: 'Browse…' })
  await browse.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (expected) => {
      const input = document.querySelector('[data-testid="bootstrap-target-path-input"] input')
      return input && input.value === expected
    },
    targetPath,
    { timeout: TIMEOUT_MS },
  )
  // Not expected for a fresh folder under `.ui-verify/`, but handled the same way
  // `bootstrap-r1q2.mjs` handles it rather than failing blind on an odd machine.
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
    throw new Error('the retail-import fixture target was reported as blocked, not a clean pick')
  }
  await next.click({ timeout: TIMEOUT_MS })

  // --- AC5: the confirm step names the copy source, the engine-only download and the target -------
  step(
    'assert the confirm step names the copy source, the engine-only download and the target (AC5)',
  )
  const copySourceLine = page.getByTestId('bootstrap-confirm-copy-source')
  await copySourceLine.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const copySourceText = await copySourceLine.innerText()
  assertRowNames(copySourceText, 'Steam', verified.rootPath)

  const enginePackage = server.packages.find((pkg) => pkg.role === 'engine')
  const gameDataPackages = server.packages.filter((pkg) => pkg.role !== 'engine')
  const confirmBody = await page.getByRole('dialog').innerText()
  if (!confirmBody.includes(enginePackage.id)) {
    throw new Error(
      `expected the confirm step to name the engine package ${enginePackage.id} (AC5)`,
    )
  }
  for (const pkg of gameDataPackages) {
    if (confirmBody.includes(pkg.id)) {
      throw new Error(
        `the confirm step named the ${pkg.role} package ${pkg.id} - a store-copy run downloads the ` +
          'engine alone (AC5)',
      )
    }
  }
  for (const role of ['Demo data', 'Point release']) {
    if (confirmBody.includes(role)) {
      throw new Error(`the confirm step labelled a "${role}" package on a store-copy run (AC5)`)
    }
  }
  const totalSizeText = await page.getByTestId('bootstrap-confirm-total-size').innerText()
  if (!/\d/.test(totalSizeText)) {
    throw new Error(`expected a real total size, got ${JSON.stringify(totalSizeText)} (AC5)`)
  }
  const confirmTarget = await page.getByTestId('bootstrap-confirm-target-path').innerText()
  if (confirmTarget !== targetPath) {
    throw new Error(
      `expected the confirm step to state ${JSON.stringify(targetPath)}, got ${JSON.stringify(confirmTarget)} (AC5)`,
    )
  }

  // The binding user decision ("check up front ... hide/disable the toggle if video/players isn't
  // there, rather than reporting a copy failure afterwards"): neither fixture source has them.
  step('assert the video/players toggle is disabled with its reason (Decisions (Sprint))')
  const extrasDisabled = page.getByTestId('bootstrap-confirm-include-extras-disabled')
  await extrasDisabled.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  console.log(
    `confirm step: engine-only download of ${totalSizeText} (${enginePackage.sizeBytes} real bytes), ` +
      `copying from ${verified.rootPath}`,
  )
  await shot('confirm-step')

  // --- AC4: the job runs, downloading the engine only and copying the paks ------------------------
  step('start the job')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-running-step')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('wait for the job to succeed (AC4)')
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('running-step-succeeded')

  step('assert only the ENGINE package was ever fetched (AC4)')
  const enginePaths = [`/packages/${enginePackage.fileName}`, `/mirror/${enginePackage.fileName}`]
  if (!server.requested.some((path) => enginePaths.includes(path))) {
    throw new Error(
      `expected the fixture server to have served the engine package ${enginePackage.fileName} (AC4)`,
    )
  }
  for (const pkg of gameDataPackages) {
    const fetched = server.requested.filter((path) => path.endsWith(`/${pkg.fileName}`))
    if (fetched.length > 0) {
      throw new Error(
        `the ${pkg.role} package was downloaded on a store-copy run: ${JSON.stringify(fetched)} - ` +
          'the game data must come from the copy source alone (AC4)',
      )
    }
  }

  // --- AC6: the finished installation carries no Demo marker --------------------------------------
  step('dismiss the wizard and activate the new installation')
  await page.getByTestId('bootstrap-running-dismiss').click({ timeout: TIMEOUT_MS })
  const activated = await page.evaluate(async (name) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const installations = await window.q2.invoke('installations:list')
      const created = installations.find((installation) => installation.name === name)
      if (created) {
        await window.q2.invoke('installations:setActive', created.id)
        return { id: created.id, status: created.status }
      }
      await new Promise((done) => setTimeout(done, 20))
    }
    return null
  }, INSTALLATION_NAME)
  if (!activated) {
    throw new Error(
      `no installation named "${INSTALLATION_NAME}" was registered - a store-copy run must not ` +
        'fall back to the demo default name (AC6)',
    )
  }
  console.log(`AC6: installation "${INSTALLATION_NAME}" registered with status ${activated.status}`)

  step('assert no Demo marker on the library card or in the action bar (AC6)')
  // The action bar always describes the ACTIVE installation, which is the one just activated - so
  // an absent badge here is a statement about this installation, not about whichever one the
  // fixture happened to leave active. `setActive` is an IPC round trip whose re-render this has to
  // wait out, or an absent badge could still be the PREVIOUS installation's action bar: the footer
  // shows `shortenPath(rootPath)` ("C:\…\Retail Import"), and only this run's installation lives
  // there, so that is the signal the re-render has landed.
  await page.getByTestId('actionbar-play').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (marker) => document.querySelector('footer')?.innerText?.includes(marker) === true,
    'Retail Import',
    { timeout: TIMEOUT_MS },
  )
  const actionBarDemoBadges = await page.locator('footer [data-testid="demo-badge"]').count()
  if (actionBarDemoBadges !== 0) {
    throw new Error('the action bar showed a Demo badge for a retail-copied installation (AC6)')
  }
  // Per-card rather than a global count: the fixture's own installations are demo-sized by
  // construction, so a repo-wide "no demo badge anywhere" assertion would be false for reasons that
  // have nothing to do with this story.
  const cardDemoBadge = await page.evaluate((name) => {
    const heading = [...document.querySelectorAll('h2')].find(
      (element) => element.textContent?.trim() === name,
    )
    if (!heading?.parentElement) return 'no-card'
    return heading.parentElement.querySelector('[data-testid="demo-badge"]') ? 'badge' : 'clean'
  }, INSTALLATION_NAME)
  if (cardDemoBadge === 'no-card') {
    throw new Error(`no library card headed "${INSTALLATION_NAME}" was found (AC6)`)
  }
  if (cardDemoBadge === 'badge') {
    throw new Error(`the "${INSTALLATION_NAME}" library card carried a Demo badge (AC6)`)
  }
  await shot('retail-installation')

  // --- AC4/AC7: what is actually on disk ----------------------------------------------------------
  step('assert on disk that the target holds baseq2 only (AC7)')
  const tree = readTargetTree(targetPath)
  if (tree.dirs.join(',') !== 'baseq2') {
    throw new Error(
      `expected exactly one directory ("baseq2") in the target, found ${JSON.stringify(tree.dirs)} (AC7)`,
    )
  }
  const strays = findForbiddenDirs(targetPath)
  if (strays.length > 0) {
    throw new Error(`forbidden directories found under the target: ${JSON.stringify(strays)} (AC7)`)
  }
  for (const name of FORBIDDEN_FILES) {
    const found = findFile(targetPath, name)
    if (found.length > 0) {
      throw new Error(
        `${name} exists in the copy source but must never be copied; found ${JSON.stringify(found)} (AC7)`,
      )
    }
  }
  // The extras toggle was disabled (neither fixture source has them), so nothing may have arrived.
  for (const dir of ['video', 'players']) {
    if (existsSync(join(targetPath, 'baseq2', dir))) {
      throw new Error(`baseq2/${dir} was created although the copy source has none`)
    }
  }
  console.log(`target tree: dirs=${JSON.stringify(tree.dirs)} files=${JSON.stringify(tree.files)}`)

  step('assert the copied paks are byte-identical to the source, and real copies (AC4)')
  for (const pak of ['pak0.pak', 'pak1.pak', 'pak2.pak']) {
    const sourcePak = join(verified.rootPath, 'baseq2', pak)
    const targetPak = join(targetPath, 'baseq2', pak)
    if (!existsSync(targetPak)) {
      throw new Error(`expected baseq2/${pak} to have been copied into the target (AC4)`)
    }
    const size = statSync(targetPak).size
    if (size !== RETAIL_PAK_SIZES[pak] || size !== statSync(sourcePak).size) {
      throw new Error(
        `baseq2/${pak} is ${size} bytes in the target; the source and the known retail size are ` +
          `${statSync(sourcePak).size}/${RETAIL_PAK_SIZES[pak]} (AC4)`,
      )
    }
    // AC4's "never links or references them". `cp` (via `assembleInstallation`) copies real bytes;
    // this is the on-disk check that it did.
    if (lstatSync(targetPak).isSymbolicLink()) {
      throw new Error(`baseq2/${pak} in the target is a symlink, not a copy (AC4)`)
    }
    const [sourceDigest, targetDigest] = await Promise.all([
      sha256OfFile(sourcePak),
      sha256OfFile(targetPak),
    ])
    if (sourceDigest !== targetDigest) {
      throw new Error(
        `baseq2/${pak} differs from its source: ${sourceDigest} vs ${targetDigest} (AC4)`,
      )
    }
    console.log(
      `AC4: baseq2/${pak} copied byte-identically (${size} bytes, sha256 ${targetDigest})`,
    )
  }

  step('assert nothing outside the loopback fixture server was ever asked for')
  const unexpected = server.requested.filter((path) => path === '/' || path.startsWith('/..'))
  if (unexpected.length > 0) {
    throw new Error(
      `the fixture server saw unexpected request paths: ${JSON.stringify(unexpected)}`,
    )
  }
  console.log(`fixture server served: ${JSON.stringify([...new Set(server.requested)])}`)

  console.log(
    'bootstrap retail import: the copy choice was absent with zero detected sources and present ' +
      'with two, both listed with store and path, the wrong-size one listed-but-unselectable with ' +
      'its reason, the confirm step named the copy source, the engine-only download and the ' +
      'target, the real job downloaded the engine alone and copied pak0/pak1/pak2 byte-identically ' +
      'into a target holding baseq2 only, and the finished installation carries no Demo marker',
  )
}

/** Sets `Q2L_UI_HARNESS_STORE_SOURCES` inside the RUNNING main process - see "The empty-list half
 * of AC1" above for why this is the only way to cover both halves in one launch, and why it changes
 * nothing about the double gate that guards the variable. */
async function setStoreSourcesOverride(app, value) {
  await app.evaluate((_electron, next) => {
    process.env.Q2L_UI_HARNESS_STORE_SOURCES = next
  }, value)
}

/** Library -> "Download & install", waiting for the engine step to be up. */
async function openWizard(page) {
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-engine-q2pro')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

/**
 * AC2's "identified by its store and its path", asserted on one rendered block of text. The store
 * name is matched case-insensitively: the picker's own row renders it through a `uppercase` utility
 * class, so `innerText` reads "STEAM" there and "Steam" in the confirm step's copy-source line -
 * two renderings of the same `bootstrapWizard.gameData.store.*` string. The path is matched exactly.
 */
function assertRowNames(text, store, rootPath) {
  if (!text.toLowerCase().includes(store.toLowerCase())) {
    throw new Error(`expected ${JSON.stringify(text)} to name the store "${store}" (AC2)`)
  }
  if (!text.includes(rootPath)) {
    throw new Error(`expected ${JSON.stringify(text)} to name the path ${rootPath} (AC2)`)
  }
}

/** Streamed, so a 184 MB pak is hashed without being read into memory in one piece. */
function sha256OfFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** Every `ctf`/`xatrix`/`rogue` directory anywhere under `root`, as target-relative paths - the
 * same helper `bootstrap-wizard.mjs` uses for its own AC8. */
function findForbiddenDirs(root, relative = '') {
  const found = []
  for (const name of readdirSync(join(root, relative))) {
    const next = relative ? join(relative, name) : name
    if (!statSync(join(root, next)).isDirectory()) continue
    if (FORBIDDEN_DIRS.includes(name.toLowerCase())) found.push(next)
    found.push(...findForbiddenDirs(root, next))
  }
  return found
}

/** Every occurrence of `fileName` anywhere under `root`, as target-relative paths. */
function findFile(root, fileName, relative = '') {
  const found = []
  for (const name of readdirSync(join(root, relative))) {
    const next = relative ? join(relative, name) : name
    if (statSync(join(root, next)).isDirectory()) {
      found.push(...findFile(root, fileName, next))
      continue
    }
    if (name.toLowerCase() === fileName.toLowerCase()) found.push(next)
  }
  return found
}
