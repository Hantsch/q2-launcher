// Story 100 (docs/requirements/100-the-launcher-runs-on-linux.md) D10: the story's own end-to-end
// proof, AC9 - "A user on Linux can add an existing Quake II installation, open a config profile,
// change a setting, have it written to the real file, and launch the game from the action bar."
// Runs unchanged on Windows too (this is how it is debugged on a dev machine before the ubuntu
// xvfb CI job proves it for real - see the Plan's own D10 note).
//
// Three halves, each reusing an existing flow's already-proven mechanism rather than reinventing
// it:
//
//   add-installation   `bootstrap-existing-folder.mjs`'s own `Q2L_UI_PICK_FOLDER` folder-pick stub
//                       setup (its header explains the double-gate/no-network mechanics), pointed
//                       here at a fixture root `scripts/lib/fixture.mjs`'s
//                       `writeLinuxJourneyInstallRoot()` builds fresh - `baseq2/pak0.pak` plus a
//                       REAL, platform-appropriate spawn target named `q2pro`/`q2pro.exe`. See that
//                       function's own doc comment for exactly what that binary is and why.
//   config-edit        `raw-inline-edit.mjs`'s own steps (nav-config, config-profile-row,
//                       config-tab-raw, type, save, read the real file back off disk), reused
//                       against `populated`'s own "Plain Profile" - AC9 only asks for "a config
//                       profile", not one assigned to the installation this flow itself adds.
//   play                `job-waits-for-running-game.mjs`'s `actionbar-play`/`data-action` selector
//                       pattern, but proven a different way: rather than polling the DOM for a
//                       translated "running"/"exited" string (a real race against a stub that
//                       "exits immediately"), this listens to every real `launch:state` broadcast
//                       the preload bridge exposes (`window.q2.on('launch:state', ...)`) and
//                       asserts `running` was observed before `exited`. Node guarantees a child's
//                       `'spawn'` event fires before its `'exit'`, so this is race-proof however
//                       fast the stub exits (`LaunchService.start()`, `src/main/services/launch.ts`).
//
// ## Why this needs no `dev:simulateLaunch`
//
// Every other flow that proves a "running" launch state fakes it (`dev:simulateLaunch`,
// `src/main/lib/ui-harness.ts`'s double gate) because their own fixture engine binaries are inert
// filler bytes - nothing the real OS could exec. This flow's whole point is the opposite: prove the
// REAL spawn path end to end, on both platforms, which needs a REAL executable - see
// `writeLinuxJourneyInstallRoot()` in `scripts/lib/fixture.mjs`.
//
// ## What happens when `resources/bin/7za.exe` (Windows only) was never vendored
//
// `writeLinuxJourneyInstallRoot()` still writes a placeholder file named `q2pro.exe` in that case -
// `looksExecutable`'s Windows rule is extension-only (`fs-utils.ts`), so the installation still
// adds and classifies as q2pro, and the config-edit half is entirely unaffected. Only this flow's
// own Play/launch assertions are skipped - LOUDLY (a `console.warn`, never a silent no-op), the
// same "state the reason, never pretend" gate every other flow's own `vendoredExtractorExists()`
// check already uses (e.g. `bootstrap-existing-folder.mjs`'s `setup()`), just scoped to one step of
// this flow instead of refusing the whole run. Off Windows this gate never applies at all: the
// shell-script stub needs no vendored binary, so the Play step always runs there.
//
// ## Selectors, not guesses
//
// `library.addExisting` ("Add existing", `LibraryView.tsx`'s own header button - not to be
// confused with the sidebar's longer `rail.addExisting`, "Add existing installation…", which
// opens the identical dialog from a different trigger), the real `AddExistingDialog.tsx` (a
// `role="dialog"` with no dedicated testids - its `Field`/`Input` controls have real accessible
// labels via `Field`'s `htmlFor`, so `getByLabel` finds them; its engine verdict is `EngineBadge`'s
// own `engine-badge` testid), and every testid `raw-inline-edit.mjs`/
// `job-waits-for-running-game.mjs` already document for the config and action-bar halves.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import {
  LINUX_JOURNEY_INSTALL_NAME,
  writeLinuxJourneyInstallRoot,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** A real process launch/exit, end to end - generous, but this is never a download job. */
const LAUNCH_TIMEOUT_MS = 15_000

/** Mirrors `raw-inline-edit.mjs`'s own `PLAIN_PROFILE_FILE_NAME` - `resolveProfileFileNames`
 * (`@shared/config/profile-files.ts`) sanitizes "Plain Profile"'s space to `-`. */
const PLAIN_PROFILE_FILE_NAME = 'Plain-Profile.cfg'

const RUN_SUFFIX = Date.now().toString(36)
const TYPED_LINE = `// q2l_flow_linux_journey_${RUN_SUFFIX}`

/** Mirrors `src/renderer/src/i18n/locales/en.json`'s real strings - this flow drives the real
 * `AddExistingDialog`, which carries no dedicated testids of its own. `library.addExisting` (the
 * library header's own button) is the SHORT "Add existing" - not to be confused with
 * `rail.addExisting`'s longer "Add existing installation…", used by the sidebar's own trigger. */
const ADD_EXISTING_BUTTON_LABEL = 'Add existing'
const BROWSE_LABEL = 'Browse…'
const SUBMIT_LABEL = 'Add installation'

/** Set by `setup()`, read by the flow body. */
let journeyRoot = null
let spawnable = true

export async function setup() {
  // Reseeded for the same reason every installation-adding flow reseeds
  // (`bootstrap-existing-folder.mjs`, `job-waits-for-running-game.mjs`): this flow registers a real
  // installation through the real dialog, and `InstallationsService.addExisting()` refuses a
  // second one at the same path - so without this a second run would fail at "add installation".
  writePopulatedFixture()
  const written = writeLinuxJourneyInstallRoot()
  journeyRoot = written.root
  spawnable = written.spawnable

  console.log(`  fixture install root: ${journeyRoot}`)
  console.log(`  fixture executable:   ${written.executablePath} (spawnable: ${spawnable})`)
  if (!spawnable) {
    console.warn(
      '  resources/bin/7za.exe is not vendored locally (run `npm run fetch:7za` first) - the ' +
        "Play/launch half of this flow will be SKIPPED, loudly, at the step that needs it.",
    )
  }

  return {
    env: {
      // In call order: this flow's dialog browses exactly once.
      Q2L_UI_PICK_FOLDER: journeyRoot,
    },
  }
}

export default async function linuxUserJourney({ page, step, shot }) {
  // --- add an existing installation, through the real folder-pick stub ---------------------------
  step('open the library and start "Add existing"')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  // `exact: true`: the rail's own trigger is labelled "Add existing installation…"
  // (`rail.addExisting`), which contains this button's own "Add existing" (`library.addExisting`)
  // as a substring - Playwright's default name match is substring, so both would otherwise match.
  await page
    .getByRole('button', { name: ADD_EXISTING_BUTTON_LABEL, exact: true })
    .click({ timeout: TIMEOUT_MS })

  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('browse for the fixture install root (the stubbed folder pick)')
  await dialog.getByRole('button', { name: BROWSE_LABEL }).click({ timeout: TIMEOUT_MS })

  step('assert the folder was inspected in real time and classified as q2pro')
  const engineBadge = dialog.getByTestId('engine-badge')
  await engineBadge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const engineBadgeText = await engineBadge.innerText()
  if (engineBadgeText !== 'Q2PRO') {
    throw new Error(`expected the folder to classify as Q2PRO, got: ${JSON.stringify(engineBadgeText)}`)
  }
  const shownPath = await dialog.getByLabel('Installation folder').inputValue()
  if (shownPath !== journeyRoot) {
    throw new Error(
      `expected the folder field to show ${JSON.stringify(journeyRoot)}, got ${JSON.stringify(shownPath)}`,
    )
  }

  step('name it and submit')
  const nameInput = dialog.getByLabel('Name in the launcher')
  await nameInput.fill(LINUX_JOURNEY_INSTALL_NAME)
  await shot('add-existing-verdict')
  await dialog.getByRole('button', { name: SUBMIT_LABEL }).click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('assert the installation is registered for real, via the real IPC surface')
  const registered = await page.evaluate(async (name) => {
    const installations = await window.q2.invoke('installations:list')
    return installations.find((installation) => installation.name === name) ?? null
  }, LINUX_JOURNEY_INSTALL_NAME)
  if (!registered) {
    throw new Error(`no installation named "${LINUX_JOURNEY_INSTALL_NAME}" was registered`)
  }
  if (registered.rootPath !== journeyRoot) {
    throw new Error(
      `expected the registered installation's rootPath to be ${JSON.stringify(journeyRoot)}, got ` +
        JSON.stringify(registered.rootPath),
    )
  }
  console.log(
    `AC9 (add): "${registered.name}" registered at ${registered.rootPath} ` +
      `(engineKind: ${registered.engineKind}, status: ${registered.status})`,
  )

  // `useLauncher.addExisting()` (src/renderer/src/store/useLauncher.ts) activates the freshly
  // added installation itself, as part of the same submit - the action bar, which is part of the
  // persistent shell (`AppShell.tsx`) rather than the library view, already names it by the time
  // the dialog above closed. No separate "select it" click is needed before Play, later.
  step('assert the action bar already reflects the newly added, now-active installation')
  await page
    .locator('footer')
    .filter({ hasText: LINUX_JOURNEY_INSTALL_NAME })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // --- open a config profile, change a setting, save, read the real file back off disk -----------
  step('open the config module and select Plain Profile')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })

  step('open the Raw file tab and type a line at the end of the editor')
  await page.getByTestId('config-tab-raw').click({ timeout: TIMEOUT_MS })
  const textarea = page.locator('.cfg-code-textarea')
  await textarea.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await textarea.click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Control+End')
  await page.keyboard.type(`\n${TYPED_LINE}`)
  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('config-draft-typed')

  step('save - the read-back panel proves main wrote exactly this text')
  await page.getByTestId('config-save').click({ timeout: TIMEOUT_MS })
  const resultPanel = page.getByTestId('config-raw-save-result')
  await resultPanel.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('config-saved')

  step("assert the profile's canonical file on disk now contains the typed line (AC9's 'real file')")
  const canonicalPath = join(variantUserDataDir('populated'), PLAIN_PROFILE_FILE_NAME)
  const onDisk = readFileSync(canonicalPath, 'latin1')
  if (!onDisk.includes(TYPED_LINE)) {
    throw new Error(
      `expected ${canonicalPath} to contain ${JSON.stringify(TYPED_LINE)} after saving, it did not`,
    )
  }
  console.log(`AC9 (config): ${canonicalPath} was written to disk with the typed change`)

  // --- press Play from the action bar, on the already-active installation -------------------------
  await shot('installation-active')

  if (!spawnable) {
    console.warn(
      'SKIPPING the Play/launch assertions (AC9\'s launch half): resources/bin/7za.exe is not ' +
        'vendored locally on this Windows machine, so the fixture install root only carries a ' +
        'non-executable placeholder, not a real spawn target. The add-installation and ' +
        'config-edit halves above both ran for real. Run `npm run fetch:7za` and re-run this flow ' +
        'to prove the launch half too.',
    )
    return
  }

  step('arm a launch:state listener before pressing Play, so no transition can be missed')
  await page.evaluate(() => {
    window.__q2lJourneyPhases = []
    window.q2.on('launch:state', (state) => {
      window.__q2lJourneyPhases.push(state.phase)
    })
  })

  step('press Play - a REAL spawn, not dev:simulateLaunch')
  await page
    .locator('button[data-testid="actionbar-play"][data-action="play"]')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('actionbar-play').click({ timeout: TIMEOUT_MS })

  step('wait for the real process to exit, then assert running -> exited, in order')
  await page.waitForFunction(
    () => Array.isArray(window.__q2lJourneyPhases) && window.__q2lJourneyPhases.includes('exited'),
    { timeout: LAUNCH_TIMEOUT_MS },
  )
  const phases = await page.evaluate(() => window.__q2lJourneyPhases)
  const runningIndex = phases.indexOf('running')
  const exitedIndex = phases.indexOf('exited')
  if (runningIndex === -1) {
    throw new Error(`launch state never reported 'running' - observed phases: ${JSON.stringify(phases)}`)
  }
  if (exitedIndex === -1 || exitedIndex < runningIndex) {
    throw new Error(
      `launch state did not go running -> exited, in that order - observed: ${JSON.stringify(phases)}`,
    )
  }
  await shot('launch-exited')
  console.log(`AC9 (play): real launch state transitioned ${JSON.stringify(phases)}`)

  console.log(
    'linux-user-journey: added an existing installation through the real folder-pick stub, edited ' +
      'and saved a config profile with the change landing on the real file on disk, then pressed ' +
      'Play and watched a REAL spawned process go running -> exited',
  )
}
