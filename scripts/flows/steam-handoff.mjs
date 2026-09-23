// Story 104 (docs/requirements/104-steam-launches-the-client-i-choose.md) D6: the story's own
// end-to-end proof, mirroring `windows-build-on-linux.mjs`'s (story 103 D8) own shape - branch on
// the REAL host's `process.platform`, scrub/override the environment in `setup()`, stub a binary on
// `PATH` at runtime via `app.evaluate()`, and (Linux only) actually press Play and assert on a real
// spawned process's own recorded argv.
//
// Three fixture installations, all Steam's own `steamapps/common/<name>` shape
// (`writeSteamLibraryFixture()`, `scripts/lib/fixture.mjs` - matches the literal `"key" "value"`
// manifest format `readSteamAppId()`, `src/main/services/steam.ts`, already proven correct by
// `steam.test.ts`), plus one reused from story 103's own fixture (`writeWindowsBuildFixture()`) for
// the "not a Steam folder at all" case - a folder living anywhere else is exactly what "not owned by
// Steam" needs, and that fixture is already a real MZ-header `quake2.exe` behind retail-sized paks:
//
//   `notOwnedRoot`   - `writeWindowsBuildFixture()`'s own root: PE-only, NOT under any
//                      `steamapps/common` - `readSteamAppId()` returns `undefined` for it.
//   `unknownAppRoot` - `writeSteamLibraryFixture({ appid: '9999' })`: Steam-owned, but 9999 has no
//                      entry in `STEAM_APP_CLIENTS` (`src/shared/types/steam.ts`).
//   `knownAppRoot`   - `writeSteamLibraryFixture({ appid: '2320' })`: Steam-owned, and 2320 lists
//                      four clients (Enhanced/Original/Reckoning/Ground Zero).
//
// `steamUnavailableReason()`'s three cases (`src/main/services/runners.ts`) are judged in order -
// "steam not found" beats "not owner" beats "unknown app" - so `notOwnedRoot` is reused for BOTH the
// not-found step (PATH/override absent) and the not-owner step (PATH/override present): toggling
// Steam's own availability is all it takes to move from the first reason to the second on the exact
// same folder, no second fixture needed.
//
// ## Selectors, not guesses
//
// Every testid this flow drives against is real, and every RunnerSection testid is scoped through a
// row locator exactly the way `windows-build-on-linux.mjs` documents it must be
// (`installation-runner-option-<kind>`, `installation-runner-reason-<kind>`,
// `installation-runner-steam-caveat`, `installation-runner-steam-client`,
// `installation-runner-preview` are NOT installation-scoped, and this flow puts THREE installations
// on screen at once) - `page.locator('div.panel', { has: page.getByTestId('installation-remove-<id>') })`
// per installation, same as that file's own `row`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { UI_VERIFY_ROOT } from '../lib/paths.mjs'
import {
  writePopulatedFixture,
  writeSteamLibraryFixture,
  writeSteamStub,
  writeWindowsBuildFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** A real handoff process spawn/exit, end to end - generous, but this is never a download job. */
const LAUNCH_TIMEOUT_MS = 15_000
/** How long to poll for the Runner section to pick up a freshly-changed PATH/steamClient. */
const RUNNER_REFRESH_TIMEOUT_MS = 8_000

const ADD_EXISTING_BUTTON_LABEL = 'Add existing'
const BROWSE_LABEL = 'Browse…'
const SUBMIT_LABEL = 'Add installation'

const NOT_OWNED_NAME = 'Fixture Steam Not Owned Install'
const UNKNOWN_APP_NAME = 'Fixture Steam Unknown App Install'
const KNOWN_APP_NAME = 'Fixture Steam Known App Install'

const UNKNOWN_APPID = '9999'
/** Quake II's own seed entry in `STEAM_APP_CLIENTS` (`src/shared/types/steam.ts`). */
const KNOWN_APPID = '2320'

// Mirrors src/renderer/src/i18n/locales/en.json's `runner.unavailable.*`/`runner.steam.caveat` -
// asserted verbatim, the same way `windows-build-on-linux.mjs` asserts the wine reason text.
const STEAM_NOT_FOUND_TEXT = 'Steam not found — install Steam to hand this game off to it'
const STEAM_NOT_OWNER_TEXT = 'this folder is not a Steam install — Steam can only start games it owns'
const STEAM_UNKNOWN_APP_TEXT = 'this Steam game has no known launch options'
const STEAM_CAVEAT_TEXT =
  "Steam runs its own copy of the game: the launcher's launch arguments and active game directory " +
  'are not applied, there is no process to observe so no playtime is recorded, and the launcher ' +
  'cannot hold back its own writes (downloads, jobs) into this folder while the game runs.'

/** Set by `setup()`, read by the flow body. */
let notOwnedRoot = null
let unknownAppRoot = null
let knownAppRoot = null

function windowsSteamExecutableFixturePath() {
  return join(UI_VERIFY_ROOT, 'fixture', 'steam-handoff-windows-steam-exe', 'steam.exe')
}

/** A plain, real file - `findSteam()`'s harness override (`Q2L_UI_STEAM_EXECUTABLE`) only checks
 * `isFile()`, never runs it - so Steam "exists" deterministically on a Windows dev machine with no
 * real Steam install (and without a real one interfering, since the override wins unconditionally). */
function writeWindowsSteamExecutableFixture() {
  const path = windowsSteamExecutableFixturePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'not a real steam.exe - ui-verify fixture only\n')
  return path
}

export async function setup() {
  // Reseeded for the reason every installation-adding flow reseeds (`windows-build-on-linux.mjs`,
  // `linux-user-journey.mjs`): `InstallationsService.addExisting()` refuses a second registration at
  // the same path, so a second run of this flow would fail at "add installation" without a fresh
  // fixture underneath it.
  writePopulatedFixture()

  const notOwned = writeWindowsBuildFixture()
  const unknownApp = writeSteamLibraryFixture({ appid: UNKNOWN_APPID })
  const knownApp = writeSteamLibraryFixture({ appid: KNOWN_APPID })
  notOwnedRoot = notOwned.root
  unknownAppRoot = unknownApp.root
  knownAppRoot = knownApp.root

  console.log(`  fixture "not owned" root:    ${notOwnedRoot}`)
  console.log(`  fixture "unknown app" root:  ${unknownAppRoot}`)
  console.log(`  fixture "known app" root:    ${knownAppRoot}`)

  const env = {
    Q2L_UI_PICK_FOLDER: [notOwnedRoot, unknownAppRoot, knownAppRoot].join(delimiter),
  }

  if (process.platform === 'win32') {
    // No PATH scrubbing needed: `findSteam()` checks the harness override before anything else, on
    // every platform, so a real Steam install (or its absence) on this machine cannot change the
    // outcome.
    env.Q2L_UI_STEAM_EXECUTABLE = writeWindowsSteamExecutableFixture()
  } else {
    // AC (steam not found) needs Steam provably absent, not merely "probably absent on this CI
    // runner" - PATH is scrubbed for the whole app lifetime here; the Linux branch prepends its own
    // steam stub back onto it later, at runtime, via Playwright's `app.evaluate()`.
    console.log('  scrubbing PATH for the whole run: steam must be provably absent (first assertion)')
    env.PATH = ''
  }

  return { env }
}

export default async function steamHandoff({ page, app, step, shot }) {
  if (process.platform === 'win32') {
    await runWindowsBranch({ page, step, shot })
    console.log(
      "steam-handoff: SKIPPING the Linux branch (pressing Play, and the steam-not-found step) " +
        "LOUDLY - this host's process.platform is 'win32'. The ubuntu xvfb CI job runs the Linux " +
        'branch for real - see .github/workflows/ci.yml.',
    )
    return
  }

  console.log(
    "steam-handoff: running the LINUX branch (process.platform !== 'win32'). SKIPPING the Windows " +
      "branch's harness-executable-override half LOUDLY: that half needs a win32 host and is proven " +
      'separately by running this exact same flow there (a dev machine, or a future windows-latest leg).',
  )
  await runLinuxBranch({ page, app, step, shot })
}

// --- shared: add an installation through the real folder-pick stub, return its row's own scope ---

async function addInstallation({ page, step, folderRoot, name }) {
  step(`open the library and start "Add existing" for "${name}"`)
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page
    .getByRole('button', { name: ADD_EXISTING_BUTTON_LABEL, exact: true })
    .click({ timeout: TIMEOUT_MS })

  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('browse for the fixture install root (the stubbed folder pick)')
  await dialog.getByRole('button', { name: BROWSE_LABEL }).click({ timeout: TIMEOUT_MS })

  // Mirrors `windows-build-on-linux.mjs`: the engine badge only renders once `installations:inspectPath`
  // resolves, so waiting on it first makes reading the path field race-proof.
  const engineBadge = dialog.getByTestId('engine-badge')
  await engineBadge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const shownPath = await dialog.getByLabel('Installation folder').inputValue()
  if (shownPath !== folderRoot) {
    throw new Error(
      `expected the folder field to show ${JSON.stringify(folderRoot)}, got ${JSON.stringify(shownPath)}`,
    )
  }

  step('name it and submit')
  const nameInput = dialog.getByLabel('Name in the launcher')
  await nameInput.fill(name)
  await dialog.getByRole('button', { name: SUBMIT_LABEL }).click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('assert the installation is registered for real, via the real IPC surface')
  const registered = await page.evaluate(async (installName) => {
    const installations = await window.q2.invoke('installations:list')
    return installations.find((installation) => installation.name === installName) ?? null
  }, name)
  if (!registered) {
    throw new Error(`no installation named "${name}" was registered`)
  }

  const row = page.locator('div.panel', { has: page.getByTestId(`installation-remove-${registered.id}`) })
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  return { registered, row }
}

/** Asserts the Steam runner option is disabled with exactly `expectedReasonText` as its visible
 * reason - the platform-parity rule (CLAUDE.md) `RunnerOptionRow` (`RunnerSection.tsx`) implements. */
async function assertSteamDisabled(row, expectedReasonText) {
  const steamOption = row.getByTestId('installation-runner-option-steam')
  await steamOption.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await steamOption.isDisabled())) {
    throw new Error(`expected the steam runner option to be disabled (reason: ${JSON.stringify(expectedReasonText)})`)
  }
  const reason = row.getByTestId('installation-runner-reason-steam')
  await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const reasonText = await reason.innerText()
  if (reasonText !== expectedReasonText) {
    throw new Error(`unexpected steam reason text: ${JSON.stringify(reasonText)}`)
  }
}

/** Polls `locator.innerText()` until it contains `expectedSubstring`, or throws once `timeoutMs`
 * elapses - `RunnerSection.tsx`'s preview effect is async, so it never flips synchronously with
 * whatever DOM interaction triggered it. */
async function waitForPreviewContains(locator, expectedSubstring, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const text = await locator.innerText()
    if (text.includes(expectedSubstring)) return text
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for the runner preview to contain ` +
          `${JSON.stringify(expectedSubstring)}, last seen: ${JSON.stringify(text)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/** Polls the real `installations:list` IPC surface until `installationId`'s recorded `steamClient`
 * matches `expectedClient` - `updateInstallation()`'s `installations:update` round trip is async.
 * `RunnerSection.tsx`'s preview-refresh effect is keyed on `installation.steamClient` too (alongside
 * `installation.id`/`installation.runner`), so once this resolves the previewed launch string
 * refreshes on its own - no remount needed, see the two call sites below. */
async function waitForRecordedSteamClient(page, installationId, expectedClient, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const installations = await page.evaluate(() => window.q2.invoke('installations:list'))
    const installation = installations.find((entry) => entry.id === installationId)
    if (installation?.steamClient === expectedClient) return
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for installation ${installationId}'s recorded ` +
          `steamClient to become ${expectedClient}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/** Selects the Steam runner option, waits for the choice to render as checked (a synchronous
 * `installation.runner` prop update, not the async preview effect), then chooses "Ground Zero" in
 * the client picker and waits for the choice to persist. Once `steamClient` is recorded, the
 * preview refreshes on its own (see `waitForRecordedSteamClient`'s doc comment) - callers assert on
 * it directly, no remount needed. */
async function selectSteamAndGroundZero({ page, row, registered }) {
  const steamOption = row.getByTestId('installation-runner-option-steam')
  await steamOption.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (el) => el?.getAttribute('aria-checked') === 'true',
    await steamOption.elementHandle(),
    { timeout: TIMEOUT_MS },
  )

  const clientPicker = row.getByTestId('installation-runner-steam-client')
  await clientPicker.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await clientPicker.selectOption({ label: 'Ground Zero' })

  await waitForRecordedSteamClient(page, registered.id, 4, TIMEOUT_MS)
}

// --- Windows branch: disabled/enabled reasons + preview, never Play ------------------------------

async function runWindowsBranch({ page, step, shot }) {
  const { row: notOwnedRow } = await addInstallation({
    page,
    step,
    folderRoot: notOwnedRoot,
    name: NOT_OWNED_NAME,
  })
  step('assert Steam is disabled with the not-owner reason (Steam "exists" via the harness override, but this folder is not one of its own)')
  await assertSteamDisabled(notOwnedRow, STEAM_NOT_OWNER_TEXT)
  await shot('windows-steam-not-owner')

  const { row: unknownRow } = await addInstallation({
    page,
    step,
    folderRoot: unknownAppRoot,
    name: UNKNOWN_APP_NAME,
  })
  step('assert Steam is disabled with the unknown-app reason')
  await assertSteamDisabled(unknownRow, STEAM_UNKNOWN_APP_TEXT)
  await shot('windows-steam-unknown-app')

  const { registered: knownInstall, row: knownRow } = await addInstallation({
    page,
    step,
    folderRoot: knownAppRoot,
    name: KNOWN_APP_NAME,
  })

  step('assert Steam is enabled, with the caveat paragraph visible as DOM text')
  const steamOption = knownRow.getByTestId('installation-runner-option-steam')
  await steamOption.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await steamOption.isDisabled()) {
    throw new Error('expected the steam runner option to be enabled via the harness executable override')
  }
  const caveat = knownRow.getByTestId('installation-runner-steam-caveat')
  await caveat.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('windows-steam-enabled-caveat')

  step('select Steam, choose "Ground Zero", and wait for the choice to persist')
  await selectSteamAndGroundZero({ page, row: knownRow, registered: knownInstall })

  step('assert the previewed launch string refreshes live to the Ground Zero URL - no remount needed - Play is NOT pressed on Windows (a real Steam client may be installed on this machine)')
  const expectedUrl = `steam://launch/${KNOWN_APPID}/client/4`
  const previewLocator = knownRow.getByTestId('installation-runner-preview')
  await previewLocator.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const previewText = await waitForPreviewContains(previewLocator, expectedUrl, RUNNER_REFRESH_TIMEOUT_MS)
  await shot('windows-steam-client-selected')

  console.log(
    `steam-handoff (Windows branch): Steam disabled with the not-owner/unknown-app reasons, then ` +
      `enabled with its caveat for a Steam-owned folder with a known appid; picking Ground Zero ` +
      `previewed ${JSON.stringify(previewText)}. Play deliberately not pressed on this platform.`,
  )
}

// --- Linux branch: disabled/enabled reasons + preview, then a real Play press --------------------

async function runLinuxBranch({ page, app, step, shot }) {
  const { row: notOwnedRow } = await addInstallation({
    page,
    step,
    folderRoot: notOwnedRoot,
    name: NOT_OWNED_NAME,
  })

  step('assert Steam is disabled with the "not found" reason - PATH is scrubbed of any steam binary')
  await assertSteamDisabled(notOwnedRow, STEAM_NOT_FOUND_TEXT)
  await shot('steam-not-found')

  step('write a stub steam binary and put it on PATH')
  const steamStub = writeSteamStub()
  await app.evaluate(
    ({ dir }) => {
      process.env.PATH = process.env.PATH ? `${dir}:${process.env.PATH}` : dir
    },
    { dir: steamStub.dir },
  )
  console.log(`  steam stub dir: ${steamStub.dir}`)
  console.log(`  steam stub log: ${steamStub.logPath}`)

  step('force the Runner section to re-detect runners - navigate away and back, remounting it')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await notOwnedRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert Steam is now found but disabled with the not-owner reason (this folder is not a Steam install)')
  await assertSteamDisabled(notOwnedRow, STEAM_NOT_OWNER_TEXT)
  await shot('steam-not-owner')

  const { row: unknownRow } = await addInstallation({
    page,
    step,
    folderRoot: unknownAppRoot,
    name: UNKNOWN_APP_NAME,
  })
  step('assert Steam is disabled with the unknown-app reason')
  await assertSteamDisabled(unknownRow, STEAM_UNKNOWN_APP_TEXT)
  await shot('steam-unknown-app')

  const { registered: knownInstall, row: knownRow } = await addInstallation({
    page,
    step,
    folderRoot: knownAppRoot,
    name: KNOWN_APP_NAME,
  })

  step('assert Steam is enabled, with the caveat paragraph visible as DOM text')
  const steamOption = knownRow.getByTestId('installation-runner-option-steam')
  await steamOption.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await steamOption.isDisabled()) {
    throw new Error('expected the steam runner option to be enabled for a folder steam owns with a known appid')
  }
  const caveat = knownRow.getByTestId('installation-runner-steam-caveat')
  await caveat.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const caveatText = await caveat.innerText()
  if (caveatText !== STEAM_CAVEAT_TEXT) {
    throw new Error(`unexpected steam caveat text: ${JSON.stringify(caveatText)}`)
  }
  await shot('steam-enabled-caveat')

  step('select Steam, choose "Ground Zero", and wait for the choice to persist')
  await selectSteamAndGroundZero({ page, row: knownRow, registered: knownInstall })

  step('assert the previewed launch string refreshes live to the Ground Zero URL - no remount needed')
  const expectedUrl = `steam://launch/${KNOWN_APPID}/client/4`
  const previewLocator = knownRow.getByTestId('installation-runner-preview')
  await previewLocator.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const previewText = await waitForPreviewContains(previewLocator, expectedUrl, RUNNER_REFRESH_TIMEOUT_MS)
  await shot('steam-client-selected')
  console.log(`previewed launch string: ${JSON.stringify(previewText)}`)

  step('arm a launch:state listener before pressing Play, so no transition can be missed')
  await page.evaluate(() => {
    window.__q2lPhases = []
    window.q2.on('launch:state', (state) => {
      window.__q2lPhases.push(state.phase)
    })
  })

  step('press the real library-row Play button - a genuine handoff, not a bypass')
  const playButton = knownRow.getByRole('button', { name: 'Play', exact: true })
  await playButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await playButton.isDisabled()) {
    throw new Error('expected the library row Play button to be enabled')
  }
  await playButton.click({ timeout: TIMEOUT_MS })

  step("wait for launch:state to reach 'handed-off'")
  await page.waitForFunction(
    () => Array.isArray(window.__q2lPhases) && window.__q2lPhases.includes('handed-off'),
    { timeout: LAUNCH_TIMEOUT_MS },
  )

  step("assert 'running' was never observed, and the stub recorded exactly the expected URL")
  const phases = await page.evaluate(() => window.__q2lPhases)
  if (phases.includes('running')) {
    throw new Error(`launch:state broadcast a 'running' phase during a steam handoff: ${JSON.stringify(phases)}`)
  }
  const logContents = readFileSync(steamStub.logPath, 'utf8').trim()
  if (logContents !== expectedUrl) {
    throw new Error(
      `expected the steam stub's log to contain exactly ${JSON.stringify(expectedUrl)}, got ` +
        JSON.stringify(logContents),
    )
  }
  await shot('steam-handed-off')

  console.log(
    'steam-handoff (Linux branch): Steam showed disabled with the not-found reason on a scrubbed ' +
      'PATH, then the not-owner reason once found but on a non-Steam folder, then the unknown-app ' +
      'reason for an appid with no client table, then enabled with its caveat for a real Steam-owned ' +
      'folder with a known appid; picking Ground Zero previewed the matching steam://launch URL, and ' +
      'pressing Play for real produced a genuine handoff - the stub recorded the exact URL ' +
      `(${JSON.stringify(logContents)}), launch:state reached 'handed-off', and 'running' was never ` +
      `observed (phases: ${JSON.stringify(phases)}).`,
  )
}
