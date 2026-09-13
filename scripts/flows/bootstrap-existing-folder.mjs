// Story 089 (docs/requirements/089-wizard-gains-an-existing-folder-data-source.md) D4: the
// deliverable's offline end-to-end proof. Walks the whole bootstrap wizard in the real app with the
// new game-data step set to "point at an existing folder", and lets the REAL job run - real
// manifest fetch, a real verified engine download, a real `7za.exe` extraction, the real allowlist
// assemble, the real folder copy, the real `inspectInstallation` revalidations - against a
// `127.0.0.1` fixture server and one fixture "existing folder" on disk, with no outbound network
// access at all.
//
// Covers, in one app session:
//   AC1 - the existing-folder choice is offered even with zero detected store sources (unlike
//         `store-copy`, it never depends on detection at all).
//   AC2 - browsing for a folder resolves its `GameDataSourceVerdict` and the wizard reports it -
//         gating Next - before the user can proceed past the game-data step.
//   AC4 - a retail-sized folder yields a `kind: 'retail'` verdict and the finished installation
//         carries no Demo marker (asserted the same way `bootstrap-retail-import.mjs` asserts AC6
//         there).
//   AC5 - not exercised here (a `kind: 'unusable'` folder is D5's own flow,
//         `bootstrap-existing-folder-demo.mjs`).
//   AC6 - the confirm step names the chosen folder as the source, the engine-only download with its
//         size, and the target path.
//   AC7 - the target holds `baseq2` only: no `ctf`/`xatrix`/`rogue` anywhere, no stray `pak3.pak`,
//         no loose `quake2.exe` - all of which the fixture source DOES contain.
//
// ## How this run is offline
//
// Two harness-only overrides, both under the SAME double gate (`Q2L_UI_HARNESS === '1' && isDev`,
// `src/main/lib/ui-harness.ts`), both provably unreachable in a packaged build where `isDev` is
// always `false` - see `src/main/modules/downloads/harness.test.ts`. Same two
// `bootstrap-wizard.mjs` already uses:
//
//   Q2L_UI_CONTENT_REPO_BASE  the manifest/package base URL, refused unless it names a `127.0.0.1`
//                             origin.
//   Q2L_UI_PICK_FOLDER        the folders `installations:pickFolder` answers with instead of
//                             opening a native OS dialog, in call order - used here for BOTH the
//                             game-data step's own folder browse (the fixture source) and the
//                             target step's browse (the fixture target), in that order.
//
// Also reuses `bootstrap-retail-import.mjs`'s own `Q2L_UI_HARNESS_STORE_SOURCES` override, forced
// to `'[]'` for this entire flow (never restored, unlike that flow's own "empty half" which
// re-enables its two fixture sources afterwards for AC2/AC3) - AC1 needs a DETERMINISTIC "zero
// detected sources" machine state to prove the existing-folder choice is offered without depending
// on it, and a dev/CI box's real Steam/GOG detection result must not be what decides whether this
// flow's own core assertion is meaningful.
//
// ## Selectors, not guesses
//
// Everything `bootstrap-wizard.mjs`/`bootstrap-retail-import.mjs`'s own selector tables already
// list, plus (all from story 089 D4 - read `GameDataStep.tsx` before changing any of these):
//   bootstrap-gamedata-choice-existing-folder      modules/downloads/bootstrap/GameDataStep.tsx
//   bootstrap-gamedata-folder-path                 .../GameDataStep.tsx (wraps `PathPicker`)
//   bootstrap-gamedata-folder-checking              .../GameDataStep.tsx
//   bootstrap-gamedata-folder-verdict-retail/-demo/-unusable   .../GameDataStep.tsx
//   bootstrap-confirm-copy-source                  .../ConfirmStep.tsx - AC6's copy-source line
//     (story 089 D5 taught `ConfirmStep.tsx` to render this for `dataSource: 'existing-folder'`
//     too, the same way it already did for `'store-copy'`)
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import {
  RETAIL_PAK_SIZES,
  bootstrapExistingFolderSourceDir,
  bootstrapExistingFolderTargetDir,
  readTargetTree,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeBootstrapExistingFolderSource,
  writeBootstrapExistingFolderTargetDir,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** The whole job: one throttled engine download, one 7za spawn, the assemble, the folder copy and
 * two revalidations - the same budget `bootstrap-retail-import.mjs` gives its own copy run. */
const JOB_TIMEOUT_MS = 90_000

/** The name a non-`free-download` run gets: the engine's own product label (`engineLabel`,
 * `@shared/types/engine`), never `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` - same convention
 * `bootstrap-retail-import.mjs` documents, since AC4 says a retail-sized folder is not a demo. */
const INSTALLATION_NAME = 'Q2PRO'

/** Directories AC7 forbids; the fixture source ships all three, on purpose. */
const FORBIDDEN_DIRS = ['ctf', 'xatrix', 'rogue']

/** Files the fixture source carries that the allowlist must never copy. */
const FORBIDDEN_FILES = ['pak3.pak', 'quake2.exe']

/** Module-scoped, because `setup()` starts/writes them and the flow body needs them back. */
let server = null
let sourceRoot = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - this flow runs the REAL extractor against a real ' +
        'archive and will not pretend otherwise. Run `npm run fetch:7za` first.',
    )
  }

  // Reseeded for the same reason `bootstrap-wizard.mjs`/`bootstrap-retail-import.mjs` reseed: this
  // flow registers a real installation into the `populated` state document, and
  // `InstallationsService.create()` refuses a second one at the same path - so without this a
  // second run would fail at "start".
  writePopulatedFixture()
  const targetPath = writeBootstrapExistingFolderTargetDir()
  sourceRoot = writeBootstrapExistingFolderSource({ retail: true })
  server = await startBootstrapFixtureServer()

  console.log(`  fixture server: ${server.baseUrl}`)
  console.log(`  fixture target: ${targetPath}`)
  console.log(`  fixture existing-folder source: ${sourceRoot}`)

  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      // In call order: the game-data step's own folder browse (the fixture source), then the
      // target step's browse (the fixture target) - a stub's last entry repeats forever, so
      // whichever browse happens to run last is not starved.
      Q2L_UI_PICK_FOLDER: [sourceRoot, targetPath].join(delimiter),
      // Forced to zero detected sources for AC1 - see the file doc comment's "How this run is
      // offline" section for why this stays forced for the whole flow, unlike
      // `bootstrap-retail-import.mjs`'s own temporary use of the same override.
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

export default async function bootstrapExistingFolder({ page, shot, step }) {
  const targetPath = bootstrapExistingFolderTargetDir()
  const sourcePath = bootstrapExistingFolderSourceDir()

  // --- AC1: the existing-folder choice is offered with zero detected store sources ----------------
  step('open the wizard and assert the existing-folder choice is offered (AC1)')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-engine-q2pro')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })

  // Waiting on the free-download choice is what proves the detected-source list has RESOLVED:
  // `GameDataStep` renders a loading line while `sources` is still `null`, so an "offered" assertion
  // taken any earlier would pass vacuously.
  await page
    .getByTestId('bootstrap-gamedata-choice-free-download')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const storeCopyCount = await page.getByTestId('bootstrap-gamedata-choice-store-copy').count()
  if (storeCopyCount !== 0) {
    throw new Error(
      'the store-copy choice was offered although this flow forces zero detected sources ' +
        '(Q2L_UI_HARNESS_STORE_SOURCES="[]") - AC1 needs that choice absent for this assertion ' +
        'to mean anything',
    )
  }
  const existingFolderChoice = page.getByTestId('bootstrap-gamedata-choice-existing-folder')
  await existingFolderChoice.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('gamedata-step-existing-folder-offered')

  // --- AC2: browsing resolves the verdict, and it gates Next -------------------------------------
  step('select "point at an existing folder" and assert Next is blocked before a folder is picked (AC2)')
  await existingFolderChoice.click({ timeout: TIMEOUT_MS })
  const next = page.getByRole('button', { name: 'Next' })
  if (await next.isEnabled()) {
    throw new Error('Next was enabled for the existing-folder choice before any folder was picked (AC2)')
  }

  step('browse for the fixture source folder (first stubbed folder pick)')
  await page
    .getByTestId('bootstrap-gamedata-folder-path')
    .getByRole('button', { name: 'Browse…' })
    .click({ timeout: TIMEOUT_MS })

  step('assert the retail verdict appears and names the paks found, before Next enables (AC2/AC4)')
  const retailVerdict = page.getByTestId('bootstrap-gamedata-folder-verdict-retail')
  await retailVerdict.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const verdictText = await retailVerdict.innerText()
  for (const pak of ['pak0.pak', 'pak1.pak']) {
    if (!verdictText.includes(pak)) {
      throw new Error(`expected the retail verdict to name ${pak}, got: ${JSON.stringify(verdictText)} (AC2)`)
    }
  }
  const shownPath = await page
    .getByTestId('bootstrap-gamedata-folder-path')
    .locator('input')
    .inputValue()
  if (shownPath !== sourcePath) {
    throw new Error(
      `expected the folder field to show ${JSON.stringify(sourcePath)}, got ${JSON.stringify(shownPath)}`,
    )
  }
  if (!(await next.isEnabled())) {
    throw new Error('Next stayed disabled after a retail verdict resolved (AC2/AC4)')
  }
  await shot('gamedata-step-existing-folder-retail-verdict')

  await next.click({ timeout: TIMEOUT_MS })

  // --- Target step: a fresh, non-Program-Files folder needs no warning acknowledged ---------------
  step('pick the fresh existing-folder-import fixture target (second stubbed folder pick)')
  await page
    .getByTestId('bootstrap-target-path-input')
    .getByRole('button', { name: 'Browse…' })
    .click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (expected) => {
      const input = document.querySelector('[data-testid="bootstrap-target-path-input"] input')
      return input && input.value === expected
    },
    targetPath,
    { timeout: TIMEOUT_MS },
  )
  // Not expected for a fresh folder under `.ui-verify/`, but handled the same defensive way
  // `bootstrap-retail-import.mjs` handles it rather than failing blind on an odd machine.
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
    throw new Error('the existing-folder-import fixture target was reported as blocked, not a clean pick')
  }
  await next.click({ timeout: TIMEOUT_MS })

  // --- AC6: the confirm step names the chosen folder, the engine-only download and the target -----
  step('assert the confirm step names the engine-only download and the target (AC6)')
  const totalSize = page.getByTestId('bootstrap-confirm-total-size')
  await totalSize.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const enginePackage = server.packages.find((pkg) => pkg.role === 'engine')
  const gameDataPackages = server.packages.filter((pkg) => pkg.role !== 'engine')
  const confirmBody = await page.getByRole('dialog').innerText()
  if (!confirmBody.includes(enginePackage.id)) {
    throw new Error(`expected the confirm step to name the engine package ${enginePackage.id} (AC6)`)
  }
  for (const pkg of gameDataPackages) {
    if (confirmBody.includes(pkg.id)) {
      throw new Error(
        `the confirm step named the ${pkg.role} package ${pkg.id} - an existing-folder run ` +
          'downloads the engine alone (AC6)',
      )
    }
  }
  const totalSizeText = await totalSize.innerText()
  if (!/\d/.test(totalSizeText)) {
    throw new Error(`expected a real total size, got ${JSON.stringify(totalSizeText)} (AC6)`)
  }
  const confirmTarget = await page.getByTestId('bootstrap-confirm-target-path').innerText()
  if (confirmTarget !== targetPath) {
    throw new Error(
      `expected the confirm step to state ${JSON.stringify(targetPath)}, got ${JSON.stringify(confirmTarget)} (AC6)`,
    )
  }

  // AC6 also asks the confirm step to name the chosen folder as the source. D5 taught
  // `ConfirmStep.tsx` to render `bootstrap-confirm-copy-source` for `dataSource: 'existing-folder'`
  // too, the same way it already did for `'store-copy'` - `summary.copySource` itself was already
  // populated by main for this data source (`buildBootstrapSummary`, `bootstrap/job.ts`).
  const copySourceLine = page.getByTestId('bootstrap-confirm-copy-source')
  await copySourceLine.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const copySourceText = await copySourceLine.innerText()
  if (!copySourceText.includes(sourcePath)) {
    throw new Error(
      `expected the confirm step's copy-source line to name ${JSON.stringify(sourcePath)}, got: ` +
        JSON.stringify(copySourceText) + ' (AC6)',
    )
  }
  console.log('AC6: the confirm step names the chosen folder as the source')
  console.log(
    `confirm step: engine-only download of ${totalSizeText} (${enginePackage.sizeBytes} real bytes), ` +
      `copying from ${sourcePath}`,
  )
  await shot('confirm-step')

  // --- the job runs, downloading the engine only and copying the paks -----------------------------
  step('start the job')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-running-step')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('wait for the job to succeed')
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('running-step-succeeded')

  step('assert only the ENGINE package was ever fetched')
  const enginePaths = [`/packages/${enginePackage.fileName}`, `/mirror/${enginePackage.fileName}`]
  if (!server.requested.some((path) => enginePaths.includes(path))) {
    throw new Error(
      `expected the fixture server to have served the engine package ${enginePackage.fileName}`,
    )
  }
  for (const pkg of gameDataPackages) {
    const fetched = server.requested.filter((path) => path.endsWith(`/${pkg.fileName}`))
    if (fetched.length > 0) {
      throw new Error(
        `the ${pkg.role} package was downloaded on an existing-folder run: ${JSON.stringify(fetched)} - ` +
          'the game data must come from the copy source alone',
      )
    }
  }

  // --- AC4: the finished installation carries no Demo marker --------------------------------------
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
      `no installation named "${INSTALLATION_NAME}" was registered - a retail-sized existing-folder ` +
        'run must not fall back to the demo default name (AC4)',
    )
  }
  console.log(`AC4: installation "${INSTALLATION_NAME}" registered with status ${activated.status}`)

  step('assert no Demo marker on the library card or in the action bar (AC4)')
  await page.getByTestId('actionbar-play').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (marker) => document.querySelector('footer')?.innerText?.includes(marker) === true,
    'Existing Folder Import',
    { timeout: TIMEOUT_MS },
  )
  const actionBarDemoBadges = await page.locator('footer [data-testid="demo-badge"]').count()
  if (actionBarDemoBadges !== 0) {
    throw new Error('the action bar showed a Demo badge for a retail-copied existing-folder installation (AC4)')
  }
  const cardDemoBadge = await page.evaluate((name) => {
    const heading = [...document.querySelectorAll('h2')].find(
      (element) => element.textContent?.trim() === name,
    )
    if (!heading?.parentElement) return 'no-card'
    return heading.parentElement.querySelector('[data-testid="demo-badge"]') ? 'badge' : 'clean'
  }, INSTALLATION_NAME)
  if (cardDemoBadge === 'no-card') {
    throw new Error(`no library card headed "${INSTALLATION_NAME}" was found (AC4)`)
  }
  if (cardDemoBadge === 'badge') {
    throw new Error(`the "${INSTALLATION_NAME}" library card carried a Demo badge (AC4)`)
  }
  await shot('existing-folder-installation')

  // --- AC7: what is actually on disk ----------------------------------------------------------
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
  console.log(`target tree: dirs=${JSON.stringify(tree.dirs)} files=${JSON.stringify(tree.files)}`)

  step('assert the copied paks are byte-identical to the source, and real copies')
  for (const pak of ['pak0.pak', 'pak1.pak']) {
    const sourcePak = join(sourcePath, 'baseq2', pak)
    const targetPak = join(targetPath, 'baseq2', pak)
    if (!existsSync(targetPak)) {
      throw new Error(`expected baseq2/${pak} to have been copied into the target`)
    }
    const size = statSync(targetPak).size
    if (size !== RETAIL_PAK_SIZES[pak] || size !== statSync(sourcePak).size) {
      throw new Error(
        `baseq2/${pak} is ${size} bytes in the target; the source and the known retail size are ` +
          `${statSync(sourcePak).size}/${RETAIL_PAK_SIZES[pak]}`,
      )
    }
    if (lstatSync(targetPak).isSymbolicLink()) {
      throw new Error(`baseq2/${pak} in the target is a symlink, not a copy`)
    }
    const [sourceDigest, targetDigest] = await Promise.all([
      sha256OfFile(sourcePak),
      sha256OfFile(targetPak),
    ])
    if (sourceDigest !== targetDigest) {
      throw new Error(`baseq2/${pak} differs from its source: ${sourceDigest} vs ${targetDigest}`)
    }
    console.log(`AC7: baseq2/${pak} copied byte-identically (${size} bytes, sha256 ${targetDigest})`)
  }

  step('assert nothing outside the loopback fixture server was ever asked for')
  const unexpected = server.requested.filter((path) => path === '/' || path.startsWith('/..'))
  if (unexpected.length > 0) {
    throw new Error(`the fixture server saw unexpected request paths: ${JSON.stringify(unexpected)}`)
  }
  console.log(`fixture server served: ${JSON.stringify([...new Set(server.requested)])}`)

  console.log(
    'bootstrap existing-folder: the choice was offered with zero detected store sources, browsing ' +
      'resolved a retail verdict that gated Next, the confirm step named the engine-only download ' +
      'and the target, the real job downloaded the engine alone and copied pak0/pak1 byte-' +
      'identically into a target holding baseq2 only, and the finished installation carries no ' +
      'Demo marker',
  )
}

/** Streamed, so a large pak is hashed without being read into memory in one piece - same helper
 * `bootstrap-retail-import.mjs` uses. */
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
 * same helper `bootstrap-wizard.mjs`/`bootstrap-retail-import.mjs` use. */
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
