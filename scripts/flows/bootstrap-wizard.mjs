// Story 074 (docs/requirements/074-bootstrap-wizard-free-download.md) D8: the story's offline
// end-to-end proof. Walks the whole bootstrap wizard in the real app and lets the REAL job run -
// real manifest fetch, three real verified downloads, three real `7za.exe` extractions, the real
// allowlist assemble, the real `inspectInstallation` revalidations - against a `127.0.0.1` fixture
// server, with no outbound network access at all.
//
// Covers AC1 (Q2PRO is the only engine offered), AC2 (a Program Files target warns, offers the
// write-dir remedy and can be acknowledged), AC3 (a non-empty target lists its contents and can be
// continued), AC4 (the confirm step states the packages, the total size and the target), AC5 (the
// job completes: download -> verify -> extract -> assemble), AC6 (Play is enabled while the job is
// still running), AC7 (the finished installation is marked Demo on tile, card and action bar) and
// AC8 (the target holds `baseq2` only - no `ctf`/`xatrix`/`rogue`).
//
// ## How this run is offline
//
// Two harness-only overrides, both under the SAME double gate (`Q2L_UI_HARNESS === '1' && isDev`,
// `src/main/lib/ui-harness.ts`), both provably unreachable in a packaged build where `isDev` is
// always `false` - see `src/main/modules/downloads/harness.test.ts`:
//
//   Q2L_UI_CONTENT_REPO_BASE  the manifest/package base URL (`resolveDownloadSource()`,
//                             `src/main/modules/downloads/harness.ts`). Refused unless it names a
//                             `127.0.0.1` origin, so it can never redirect a run somewhere public.
//   Q2L_UI_PICK_FOLDER        the folders `installations:pickFolder` answers with instead of
//                             opening a native OS dialog (`src/main/ipc/installations.ts`), in
//                             call order. Needed because Playwright cannot drive an OS dialog and
//                             the target step's `PathPicker` input is `readOnly`, so there is
//                             nothing to type into. Two entries here: a `Program Files` path for
//                             AC2's warning, then the real fixture target for AC3's and the job.
//
// AC2's Program Files verdict is exercised by *naming* a path under the machine's real
// `%ProgramFiles%` that is never created and never written to (see
// `bootstrapProgramFilesProbePath()`), not by faking the variable: story 074's refine expected the
// latter ("point the child process's `ProgramFiles` at a fixture dir"), but Windows regenerates
// `ProgramFiles` for every new process, so a value passed in the child's environment block is
// discarded - measured, not assumed. The flow acknowledges that warning and then re-picks the real
// fixture target, so nothing is ever installed anywhere near Program Files.
//
// The evidence that nothing else was contacted is the run itself: the fixture server records every
// path it was asked for (printed at the end), the three archives are verified against sha256
// digests only this fixture knows, and the job cannot succeed without all three - so a run that
// silently fell back to the real content repo would fail on the very first digest. `PRODUCTION_CSP`
// already pins the renderer to `connect-src 'self'`, and `layering.test.ts` proves no renderer or
// preload file can reach the download pipeline at all, so the main process is the only thing that
// could have made a request in the first place.
//
// ## Selectors, not guesses
//
// Read the components before changing any of these:
//   library-download-install                      views/LibraryView.tsx (D5)
//   bootstrap-engine-q2pro                        modules/downloads/bootstrap/EngineStep.tsx
//   bootstrap-target-path-input                   .../TargetStep.tsx (wraps `PathPicker`)
//   bootstrap-target-programfiles-warning         .../TargetStep.tsx  (+ -acknowledge)
//   bootstrap-target-nonempty-warning             .../TargetStep.tsx  (+ -acknowledge)
//   bootstrap-target-blocked                      .../TargetStep.tsx  (must NOT appear here)
//   bootstrap-confirm-total-size / -target-path   .../ConfirmStep.tsx
//   bootstrap-confirm-start                       .../BootstrapWizard.tsx
//   bootstrap-running-step                        .../RunningStep.tsx - `data-status` = job status
//   bootstrap-running-dismiss                     .../BootstrapWizard.tsx
//   actionbar-play                                components/shell/ActionBar.tsx - `data-action`
//                                                 is `resolvePrimaryAction`'s own kind (D8)
//   demo-badge / installation-tile-demo-tag       components/ui/DemoBadge.tsx, InstallationTile.tsx
//
// ## Why this flow reseeds, unlike every other one
//
// Every other flow opens `.ui-verify/fixture/populated/userdata` as it finds it. This one cannot:
// it registers a real installation into that state document, and `InstallationsService.create()`
// refuses a second one at the same path (`installations.error.duplicate`) - so a second run would
// fail at step "start" rather than prove anything. `setup()` therefore reseeds `populated` and
// recreates the target folder, which is what makes the flow re-runnable.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import {
  BOOTSTRAP_FIXTURE_LAYOUT,
  BOOTSTRAP_TARGET_LOOSE_FILE,
  bootstrapProgramFilesProbePath,
  bootstrapTargetDir,
  readTargetTree,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeBootstrapTargetDir,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** The whole job: three throttled downloads, three 7za spawns, assemble, two revalidations. */
const JOB_TIMEOUT_MS = 90_000

/** The name `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` (`@shared/modules/downloads`) gives the install. */
const INSTALLATION_NAME = 'Q2PRO Demo'

/** Directories AC8 forbids - the point-release fixture archive ships all three, on purpose. */
const FORBIDDEN_DIRS = ['ctf', 'xatrix', 'rogue']

/**
 * How often the in-page sampler looks at the job status and the Play button (AC6). The window it
 * has to catch - the two `jobs:changed` renders between `markPlayable` and `finish` - measured
 * ~80ms here, so 5ms leaves an order of magnitude of margin on a faster machine while costing only
 * a couple of thousand array entries over the job's lifetime.
 */
const SAMPLE_INTERVAL_MS = 5

/** Module-scoped, because `setup()` starts it and `teardown()` has to close it. */
let server = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - this flow runs the REAL extractor against real ' +
        'archives and will not pretend otherwise. Run `npm run fetch:7za` first.',
    )
  }

  // See "Why this flow reseeds" above.
  writePopulatedFixture()
  const targetPath = writeBootstrapTargetDir()
  server = await startBootstrapFixtureServer()

  console.log(`  fixture server: ${server.baseUrl}`)
  console.log(`  fixture target: ${targetPath}`)
  for (const pkg of server.packages) {
    console.log(`  package ${pkg.role}: ${pkg.fileName} ${pkg.sizeBytes} bytes`)
  }

  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      // In call order: the Program Files path AC2 needs a warning for (never created), then the
      // real fixture target everything after step 2 uses. The second entry repeats for any further
      // pick, so the write-dir remedy button cannot exhaust the list.
      Q2L_UI_PICK_FOLDER: [bootstrapProgramFilesProbePath(), targetPath].join(delimiter),
    },
  }
}

export async function teardown() {
  if (server) {
    await server.close()
    server = null
  }
}

export default async function bootstrapWizard({ page, shot, step }) {
  const targetPath = bootstrapTargetDir()

  step('start sampling the job status and the Play button (AC6)')
  // Installed BEFORE anything is clicked, and it samples continuously rather than being read at a
  // moment the flow guesses at: "Play is enabled while the job is still running" is a window, and a
  // single `page.evaluate()` after the fact could only ever prove the state it happened to catch.
  await page.evaluate((intervalMs) => {
    window.__q2lBootstrapSamples = []
    window.__q2lBootstrapSampler = setInterval(() => {
      const runningStep = document.querySelector('[data-testid="bootstrap-running-step"]')
      const play = document.querySelector('[data-testid="actionbar-play"]')
      window.__q2lBootstrapSamples.push({
        job: runningStep ? runningStep.getAttribute('data-status') : null,
        playDisabled: play ? play.disabled : null,
        playAction: play ? play.getAttribute('data-action') : null,
      })
    }, intervalMs)
  }, SAMPLE_INTERVAL_MS)

  // --- AC1: the Library opens the wizard and offers Q2PRO only ------------------------------------
  step('open the Library and click "Download & install"')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })

  step('assert the engine step offers Q2PRO and nothing else (AC1)')
  const engineOption = page.getByTestId('bootstrap-engine-q2pro')
  await engineOption.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const engineOptionCount = await page.locator('[data-testid^="bootstrap-engine-"]').count()
  if (engineOptionCount !== 1) {
    throw new Error(`expected exactly one engine option, found ${engineOptionCount} (AC1)`)
  }
  const engineText = await engineOption.innerText()
  if (!/Q2PRO/i.test(engineText)) {
    throw new Error(`expected the engine option to name Q2PRO, got: ${JSON.stringify(engineText)}`)
  }
  // The version comes from the fixture manifest, so this also proves the manifest that was read is
  // the loopback one and not the real content repo's.
  if (!engineText.includes('fixture-1')) {
    throw new Error(
      `expected the engine option to show the fixture manifest's version "fixture-1" (proving the ` +
        `loopback manifest was used), got: ${JSON.stringify(engineText)}`,
    )
  }
  await shot('engine-step')

  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })

  // --- AC2: a Program Files target warns, offers the remedy and can be acknowledged --------------
  const browse = page
    .getByTestId('bootstrap-target-path-input')
    .getByRole('button', { name: 'Browse…' })
  const pathField = page.getByTestId('bootstrap-target-path-input').locator('input')
  const next = page.getByRole('button', { name: 'Next' })

  step('pick a Program Files target (first stubbed folder pick)')
  await browse.click({ timeout: TIMEOUT_MS })

  step('assert the Program Files warning, its write-dir remedy and its acknowledge (AC2)')
  // The warning is waited on before the field is read: the click only kicks off
  // `installations:pickFolder`, and the verdict that produces this warning is a second round trip.
  const programFilesWarning = page.getByTestId('bootstrap-target-programfiles-warning')
  await programFilesWarning.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const programFilesPath = bootstrapProgramFilesProbePath()
  const shownProgramFilesPath = await pathField.inputValue()
  if (shownProgramFilesPath !== programFilesPath) {
    throw new Error(
      `expected the target field to show ${JSON.stringify(programFilesPath)}, got ${JSON.stringify(shownProgramFilesPath)}`,
    )
  }

  const programFilesText = await programFilesWarning.innerText()
  if (!/write access/i.test(programFilesText)) {
    throw new Error(
      `expected the Program Files warning to name the write-access consequence, got: ${JSON.stringify(programFilesText)}`,
    )
  }
  // The `set-write-dir` remedy AC2 asks to be "offered". Asserted as present rather than clicked:
  // clicking it now genuinely threads the picked path into `StartBootstrapInput.writeDirPath`
  // (`BootstrapWizard.tsx`, `bootstrap/job.ts`) and is covered by `job.test.ts`'s unit test
  // instead - a click here would consume a queued `Q2L_UI_PICK_FOLDER` entry this flow still
  // needs for its own later target re-pick, since that stub's list does not repeat until
  // exhausted once, only its last entry does (see the stub's own doc comment).
  await programFilesWarning
    .getByRole('button', { name: 'Choose a different folder…' })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert Next stays disabled until the Program Files warning is acknowledged (AC2)')
  if (await next.isEnabled()) {
    throw new Error('Next was enabled with the Program Files warning unacknowledged (AC2)')
  }
  // `Checkbox` (`components/ui/controls.tsx`) hides its real `<input type="checkbox">` with
  // `sr-only` and paints a `<span>`, so the click has to land on the wrapping `<label>` - the same
  // thing a user clicks - rather than on the invisible input.
  await page
    .getByTestId('bootstrap-target-programfiles-acknowledge')
    .locator('label')
    .click({ timeout: TIMEOUT_MS })

  // A real, unelevated `%ProgramFiles%` is also genuinely not writable by this test's own user
  // account, so `computeTargetVerdict`'s independent `notWritable` fact is legitimately true here
  // too, alongside `programFiles` - both warnings are correct at once for this exact path, and the
  // wizard gates Next on every warning it shows (`BootstrapWizard.tsx`'s
  // `targetWarningsAcknowledged`), not only on the one this flow originally expected.
  const notWritableWarning = page.getByTestId('bootstrap-target-notwritable-warning')
  if (await notWritableWarning.count()) {
    await notWritableWarning
      .getByTestId('bootstrap-target-notwritable-acknowledge')
      .locator('label')
      .click({ timeout: TIMEOUT_MS })
  }

  if (!(await next.isEnabled())) {
    throw new Error('Next stayed disabled after acknowledging the Program Files warning (AC2)')
  }
  await shot('target-programfiles-warning')

  // --- AC3: a non-empty target lists its contents and can be continued ---------------------------
  step('re-pick the real fixture target (second stubbed folder pick)')
  await browse.click({ timeout: TIMEOUT_MS })

  step('assert the non-empty warning lists what is already in the folder (AC3)')
  const nonEmptyWarning = page.getByTestId('bootstrap-target-nonempty-warning')
  await nonEmptyWarning.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const shownPath = await pathField.inputValue()
  if (shownPath !== targetPath) {
    throw new Error(
      `expected the target field to show ${JSON.stringify(targetPath)}, got ${JSON.stringify(shownPath)}`,
    )
  }
  const nonEmptyText = await nonEmptyWarning.innerText()
  if (!nonEmptyText.includes(BOOTSTRAP_TARGET_LOOSE_FILE)) {
    throw new Error(
      `expected the non-empty warning to list ${BOOTSTRAP_TARGET_LOOSE_FILE}, got: ${JSON.stringify(nonEmptyText)}`,
    )
  }
  if (await page.getByTestId('bootstrap-target-blocked').count()) {
    throw new Error('the fixture target was reported as blocked; a warning was expected, not a block')
  }
  // Changing the target resets every acknowledge (`BootstrapWizard.tsx`: "an acknowledge for one
  // folder must never silently carry over to a different one") - so Next is disabled again here
  // even though a warning was already acknowledged for the previous folder.
  if (await next.isEnabled()) {
    throw new Error(
      'Next was enabled for a freshly picked non-empty target - the previous folder\'s ' +
        'acknowledge appears to have carried over (AC3)',
    )
  }
  await page
    .getByTestId('bootstrap-target-nonempty-acknowledge')
    .locator('label')
    .click({ timeout: TIMEOUT_MS })
  await shot('target-nonempty-warning')

  await next.click({ timeout: TIMEOUT_MS })

  // --- AC4: the confirm step states packages, size and target ------------------------------------
  step('assert the confirm step names the packages, the summed size and the target (AC4)')
  const totalSize = page.getByTestId('bootstrap-confirm-total-size')
  await totalSize.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const totalSizeText = await totalSize.innerText()
  if (!/\d/.test(totalSizeText)) {
    throw new Error(`expected a real total size, got ${JSON.stringify(totalSizeText)}`)
  }
  const confirmTarget = await page.getByTestId('bootstrap-confirm-target-path').innerText()
  if (confirmTarget !== targetPath) {
    throw new Error(
      `expected the confirm step to state ${JSON.stringify(targetPath)}, got ${JSON.stringify(confirmTarget)}`,
    )
  }
  const confirmBody = await page.getByRole('dialog').innerText()
  for (const pkg of server.packages) {
    if (!confirmBody.includes(pkg.id)) {
      throw new Error(`expected the confirm step to name the package ${pkg.id} (AC4)`)
    }
  }
  for (const role of ['Engine', 'Demo data', 'Point release']) {
    if (!confirmBody.includes(role)) {
      throw new Error(`expected the confirm step to label the "${role}" package (AC4)`)
    }
  }
  console.log(`confirm step: total ${totalSizeText} for ${server.totalSizeBytes} real bytes`)
  await shot('confirm-step')

  step('turn on "include videos and player models" (AC4 e2e half - exercises GLOB_DIRS\' baseq2/players candidate)')
  // `Checkbox` (`components/ui/controls.tsx`) hides its real `<input type="checkbox">` with
  // `sr-only` and paints a visible `<span>` checkmark box next to it, so the click has to land on
  // the wrapping `<label>` - same pattern as the Program-Files-acknowledge checkbox above. This
  // checkbox has no `data-testid`, so it is located by its text. `getByLabel` DOES resolve the
  // wrapping label's implicit association - but to the `<input>` itself, not the label - and
  // clicking that input directly times out: the visible checkmark `<span>` sits on top of it and
  // intercepts the pointer event (empirically confirmed here). `getByText(...).locator('..')`
  // walks back up to the wrapping `<label>`, which is what actually receives clicks.
  await page
    .getByText('Include videos and player models')
    .locator('..')
    .click({ timeout: TIMEOUT_MS })

  // --- AC5/AC6: the job runs, and Play lights up before it is finished ---------------------------
  step('start the job')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })
  const runningStep = page.getByTestId('bootstrap-running-step')
  await runningStep.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('activate the freshly registered installation so the action bar reflects its job (AC6)')
  // The `populated` fixture already has an active installation, so `activateIfFirst()` does not
  // make this one active - and the action bar's Play button always describes the ACTIVE one. Done
  // through a real `window.q2.invoke` round trip (same as `scripts/flows/import-from-files.mjs`
  // reads profiles) rather than a rail click, because the rail is behind the wizard's modal scrim
  // and the job must not be waited out first: the whole point is to observe it mid-run.
  const activatedId = await page.evaluate(async (name) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const installations = await window.q2.invoke('installations:list')
      const created = installations.find((installation) => installation.name === name)
      if (created) {
        await window.q2.invoke('installations:setActive', created.id)
        return created.id
      }
      await new Promise((done) => setTimeout(done, 20))
    }
    return null
  }, INSTALLATION_NAME)
  if (!activatedId) {
    throw new Error(`no installation named "${INSTALLATION_NAME}" was registered by the job start`)
  }
  await shot('running-step')

  step('wait for the job to succeed (AC5)')
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })

  step('assert Play was enabled while the job was still running (AC6)')
  const samples = await page.evaluate(() => {
    clearInterval(window.__q2lBootstrapSampler)
    return window.__q2lBootstrapSamples
  })
  const playableWhileRunning = samples.filter(
    (sample) => sample.job === 'running' && sample.playDisabled === false && sample.playAction === 'play',
  )
  const runningSamples = samples.filter((sample) => sample.job === 'running')
  if (playableWhileRunning.length === 0) {
    throw new Error(
      `Play was never enabled while the job status was still "running" (AC6). ` +
        `${runningSamples.length} running sample(s) at ${SAMPLE_INTERVAL_MS}ms; ` +
        `play states seen while running: ${JSON.stringify([
          ...new Set(runningSamples.map((s) => `${s.playAction}/${s.playDisabled ? 'disabled' : 'enabled'}`)),
        ])}`,
    )
  }
  console.log(
    `AC6: Play was enabled in ${playableWhileRunning.length} of ${runningSamples.length} ` +
      `samples taken while the job status was "running" (${SAMPLE_INTERVAL_MS}ms sampling)`,
  )

  // --- AC7: the Demo marker -----------------------------------------------------------------------
  step('dismiss the wizard and assert the Demo marker on tile, card and action bar (AC7)')
  await page.getByTestId('bootstrap-running-dismiss').click({ timeout: TIMEOUT_MS })

  const actionBarBadge = page.locator('footer [data-testid="demo-badge"]')
  await actionBarBadge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const cardBadgePresent = await page.evaluate((name) => {
    const heading = [...document.querySelectorAll('h2')].find(
      (element) => element.textContent?.trim() === name,
    )
    if (!heading?.parentElement) return false
    return heading.parentElement.querySelector('[data-testid="demo-badge"]') !== null
  }, INSTALLATION_NAME)
  if (!cardBadgePresent) {
    throw new Error(`no Demo badge next to the "${INSTALLATION_NAME}" library card heading (AC7)`)
  }

  const tileTagCount = await page.getByTestId('installation-tile-demo-tag').count()
  if (tileTagCount === 0) {
    throw new Error('no DEMO microtag rendered on any installation tile (AC7)')
  }

  const playAction = await page.getByTestId('actionbar-play').getAttribute('data-action')
  if (playAction !== 'play') {
    throw new Error(`expected the action bar to offer Play after the job, got "${playAction}"`)
  }
  await shot('demo-installation')

  // --- AC8: the target holds baseq2 only ----------------------------------------------------------
  step('assert on disk that the target holds baseq2 only (AC8)')
  const tree = readTargetTree(targetPath)
  if (tree.dirs.join(',') !== 'baseq2') {
    throw new Error(
      `expected exactly one directory ("baseq2") in the target, found ${JSON.stringify(tree.dirs)} (AC8)`,
    )
  }
  // Belt and braces: not just "not at the top level", but nowhere under the target at all.
  const strays = findForbiddenDirs(targetPath)
  if (strays.length > 0) {
    throw new Error(`forbidden directories found under the target: ${JSON.stringify(strays)} (AC8)`)
  }
  for (const expected of ['q2pro.exe', BOOTSTRAP_TARGET_LOOSE_FILE]) {
    if (!tree.files.includes(expected)) {
      throw new Error(`expected ${expected} in the target root, found ${JSON.stringify(tree.files)}`)
    }
  }
  for (const pak of ['pak0.pak', 'pak1.pak', 'pak2.pak']) {
    if (!existsSync(join(targetPath, 'baseq2', pak))) {
      throw new Error(`expected baseq2/${pak} to have been assembled into the target (AC5)`)
    }
  }

  step('assert players/ landed and video/ stayed absent (AC4)')
  // The extras toggle was turned on above, so `GLOB_DIRS`' `baseq2/players` candidate
  // (`assemble.ts`) should have expanded for real. `BOOTSTRAP_FIXTURE_LAYOUT`'s point-release
  // entry is the source of truth for the players filename rather than a second hardcoded copy.
  const playersRelative = BOOTSTRAP_FIXTURE_LAYOUT['point-release'].find((path) =>
    path.startsWith('baseq2/players/'),
  )
  if (!playersRelative) {
    throw new Error('BOOTSTRAP_FIXTURE_LAYOUT["point-release"] has no baseq2/players/ entry')
  }
  const playersPath = join(targetPath, ...playersRelative.split('/'))
  if (!existsSync(playersPath)) {
    throw new Error(`expected ${playersRelative} to have been assembled into the target (AC4)`)
  }
  if (existsSync(join(targetPath, 'baseq2', 'video'))) {
    throw new Error('expected baseq2/video to be absent - no real archive ships one (AC4)')
  }
  console.log(`target tree: dirs=${JSON.stringify(tree.dirs)} files=${JSON.stringify(tree.files)}`)

  step('assert nothing outside the loopback fixture server was ever asked for')
  const unexpected = server.requested.filter((path) => path === '/' || path.startsWith('/..'))
  if (unexpected.length > 0) {
    throw new Error(`the fixture server saw unexpected request paths: ${JSON.stringify(unexpected)}`)
  }
  console.log(`fixture server served: ${JSON.stringify([...new Set(server.requested)])}`)

  console.log(
    'bootstrap wizard: Q2PRO-only engine step, Program Files + non-empty target warnings both ' +
      'acknowledged, confirm step stated packages/size/target, the real job downloaded, verified, ' +
      'extracted and assembled three loopback packages, Play lit up while it was still running, ' +
      'the installation is marked Demo, and the target holds baseq2 only',
  )
}

/** Every `ctf`/`xatrix`/`rogue` directory anywhere under `root`, as target-relative paths. */
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
