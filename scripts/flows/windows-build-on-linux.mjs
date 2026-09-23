// Story 103 (docs/requirements/103-a-windows-build-runs-on-linux-through-a-runner-i-choose.md) D8:
// the story's own end-to-end proof, off one shared fixture (`writeWindowsBuildFixture()`,
// `scripts/lib/fixture.mjs`) - a real MZ-header `quake2.exe` plus a real ELF-header `quake2`
// alongside it, retail-sized paks so nothing else shows up in `installation.checks`.
//
// Two branches off that one fixture, the way `linux-user-journey.mjs` already branches on
// vendored-binary availability - loudly, never a silent no-op. Which branch runs is decided by the
// REAL host this script is running on (`process.platform`), not by an argument:
//
//   Linux (process.platform !== 'win32', the ubuntu xvfb CI job):
//     add a genuinely PE-only folder (`includeNativeElf: false` - see that function's own doc
//     comment for why the combined fixture cannot prove this half) -> assert the visible
//     `validation.executableRunnable` check text (AC2) and the Runner section's disabled `wine`
//     entry with its visible reason (AC6), on a PATH scrubbed of any real wine/umu-run; press the
//     real library-row Play button -> assert the refusal surfaces as a visible toast naming the
//     executable and that no `launch:state` `running` phase is ever broadcast (AC7); put BOTH a
//     stub `wine` and a stub `umu-run` shell script on PATH, so `resolveRunner()`'s cascade default
//     (wine, ranked first - `WRAPPING_KINDS`, `src/main/services/runners.ts`) and an explicit user
//     choice can differ; explicitly select `umu-run` (the runner the cascade did NOT default to) and
//     assert the previewed command changes to match THAT choice, not the cascade default (AC4 - this
//     is what proves the click persists an explicit choice, rather than merely coinciding with a
//     runner becoming available); then press the real Play button again and assert running -> exited
//     through the real `window.q2.on('launch:state', ...)` listener (AC5), reusing
//     `linux-user-journey.mjs`'s own listener pattern (L232-263).
//   Windows (process.platform === 'win32', a dev machine):
//     add the same (combined) fixture -> assert `quake2.exe` is the selected executable, the
//     `RunnerSection` renders with its Native option available (story 104 D5 made the section render
//     on every platform - Steam is a real runner choice on Windows too), and `launch:plan`'s preview
//     is still the plain, unwrapped executable - AC8.
//
// ## Why "press Play" now means the real library-row button, not a bypass
//
// The bug this story exists to fix (see the story's own reported log at the top of the story file)
// was exactly this: pressing Play produced a clean "exited" four seconds later with no visible
// refusal. An earlier draft of this flow worked around a *different* bug introduced by the fix
// itself: `executable-runnable` (D3, `src/main/services/inspector.ts`) had briefly been raised at
// `error` severity, which made `installation.status` `'invalid'` (`statusFrom`) and
// `isPlayable('invalid')` `false` (`src/renderer/src/lib/status.ts`) - so BOTH the library row's own
// Play button (`disabled={!isPlayable(...)}`, `LibraryView.tsx`) and the footer action bar's primary
// button (`resolvePrimaryAction`, `ActionBar.tsx`) were permanently disabled, whether or not a runner
// was ever chosen. That has since been corrected: `executable-runnable` is `warn` severity, so
// `installation.status` is `'warning'`, `isPlayable('warning')` is `true` (`isPlayable` accepts both
// `'ok'` and `'warning'`), and both buttons are genuinely clickable regardless of runner
// availability - exactly as they should be, since AC7's refusal is supposed to come from pressing
// Play and having it refuse, not from a permanently disabled control. So this flow now presses the
// real library row Play button (`row.getByRole('button', { name: 'Play', exact: true })`) - the same
// element and the same `useLauncher.play()` -> `launch:start` round trip a user's click makes - and
// asserts the refusal AC7 promises the way a user would actually see it: a toast (`useLauncher.ts`'s
// generic `toastError()`, rendered by `Toasts.tsx` as `role="status"`) carrying the
// `launch.error.noRunner` text with the executable's name.
//
// Review finding N2 (second round): the AC5 success-path press used to bypass this same button -
// `window.q2.invoke('launch:start', ...)` called directly from `page.evaluate()` - a leftover from
// before the Play-disabled-forever bug above was fixed, when Play truly was unclickable and a raw
// invoke was the only way to reach a real spawn at all. Now that Play is genuinely enabled once a
// runner resolves, that step also presses the same `playButton` locator AC7 already established is
// real and clickable, for the same reason: a launch flow this story is about should be proven the
// way a user actually triggers one.
//
// ## Selectors, not guesses
//
// Every testid/label this flow drives against is real: `nav-library`/`nav-config`
// (`InstallationRail.tsx`/shell), `library.addExisting`/`Browse…`/`Add installation`
// (`AddExistingDialog.tsx`, identical to `linux-user-journey.mjs`'s own dialog half),
// `installation-remove-<id>` (`LibraryView.tsx`, the one per-installation testid stable enough to
// scope every other assertion below to THIS flow's own row - `RunnerSection`'s own testids
// (`installation-runner`, `installation-runner-option-<kind>`, `installation-runner-reason-<kind>`,
// `installation-runner-preview`) are NOT installation-scoped, and every OTHER installation in the
// `populated` fixture also renders its own Runner section on Linux, so an unscoped
// `page.getByTestId(...)` would violate Playwright's strict mode the moment more than one
// installation is on screen - which `populated` always has). The one exception is the refusal toast
// (AC7): `Toasts.tsx` renders one global stack, not per-installation, so that assertion goes through
// `page.locator('[role="status"]', { hasText: ... })` instead, filtered by the executable's name so
// it cannot match an unrelated toast - mirroring `news-feed.mjs`'s own precedent for asserting on
// `[role="status"]` toasts (there, that a refresh failure raised none).
import {
  WINDOWS_BUILD_INSTALL_NAME,
  windowsBuildExecutablePath,
  writePopulatedFixture,
  writeWindowsBuildFixture,
  writeUmuStub,
  writeWineStub,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** A real process launch/exit, end to end - generous, but this is never a download job. */
const LAUNCH_TIMEOUT_MS = 15_000
/** How long to poll for the Runner section to pick up the freshly-added wine/umu-run stubs (AC4). */
const RUNNER_REFRESH_TIMEOUT_MS = 8_000

const ADD_EXISTING_BUTTON_LABEL = 'Add existing'
const BROWSE_LABEL = 'Browse…'
const SUBMIT_LABEL = 'Add installation'

/** Set by `setup()`, read by the flow body. */
let fixtureRoot = null

export async function setup() {
  // Reseeded for the reason every installation-adding flow reseeds
  // (`bootstrap-existing-folder.mjs`, `linux-user-journey.mjs`): `InstallationsService.addExisting()`
  // refuses a second registration at the same path, so a second run of this flow would fail at "add
  // installation" without a fresh fixture underneath it.
  writePopulatedFixture()
  const written = writeWindowsBuildFixture()
  fixtureRoot = written.root

  console.log(`  fixture install root:  ${fixtureRoot}`)
  console.log(`  fixture quake2.exe:    ${written.exePath}`)
  console.log(`  fixture native quake2: ${written.elfPath} (the story's own "ranking half" fixture requirement - not used by this flow's own assertions, which need PE-only on the Linux branch)`)

  const env = { Q2L_UI_PICK_FOLDER: fixtureRoot }
  if (process.platform !== 'win32') {
    // AC6/AC7 need wine/umu-run to be provably absent, not merely "probably absent on this CI
    // runner" - PATH is scrubbed for the whole app lifetime here; the Linux branch prepends its own
    // wine stub back onto it later, at runtime, via Playwright's `app.evaluate()` (AC4).
    console.log('  scrubbing PATH for the whole run: wine/umu-run must be provably absent (AC6/AC7)')
    env.PATH = ''
  }
  return { env }
}

export default async function windowsBuildOnLinux({ page, app, step, shot }) {
  if (process.platform === 'win32') {
    await runWindowsBranch({ page, step, shot })
    console.log(
      "windows-build-on-linux: SKIPPING the Linux branch (AC2, AC4-AC7) LOUDLY - this host's " +
        "process.platform is 'win32'. needsCompatRunner()/RunnerSection are both unconditional " +
        'no-ops there by design (AC8), so there is nothing for that half to prove on this machine. ' +
        'The ubuntu xvfb CI job runs the Linux branch for real - see .github/workflows/ci.yml.',
    )
    return
  }

  console.log(
    "windows-build-on-linux: running the LINUX branch (process.platform !== 'win32') - AC2, " +
      'AC4-AC7. SKIPPING the Windows branch (AC8) LOUDLY: that half needs a win32 host and is ' +
      'proven separately by running this exact same flow there (a dev machine, or a future ' +
      'windows-latest leg).',
  )
  await runLinuxBranch({ page, app, step, shot })
}

// --- shared: add the fixture through the real folder-pick stub, return its row's own scope -----

async function addFixtureInstallation({ page, step, shot }) {
  step('open the library and start "Add existing"')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page
    .getByRole('button', { name: ADD_EXISTING_BUTTON_LABEL, exact: true })
    .click({ timeout: TIMEOUT_MS })

  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('browse for the fixture install root (the stubbed folder pick)')
  await dialog.getByRole('button', { name: BROWSE_LABEL }).click({ timeout: TIMEOUT_MS })

  // `pickFolder()` (`AddExistingDialog.tsx`) awaits `installations:pickFolder` and then
  // `installations:inspectPath` - two real IPC round trips - before the path field's own state
  // updates land in the DOM. The engine badge only renders once that inspection resolves, so
  // waiting on IT first (mirroring `linux-user-journey.mjs`'s identical step) is what makes reading
  // the path field immediately afterwards race-proof, rather than reading it the instant the click
  // handler returns.
  const engineBadge = dialog.getByTestId('engine-badge')
  await engineBadge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const shownPath = await dialog.getByLabel('Installation folder').inputValue()
  if (shownPath !== fixtureRoot) {
    throw new Error(
      `expected the folder field to show ${JSON.stringify(fixtureRoot)}, got ${JSON.stringify(shownPath)}`,
    )
  }

  step('name it and submit')
  const nameInput = dialog.getByLabel('Name in the launcher')
  await nameInput.fill(WINDOWS_BUILD_INSTALL_NAME)
  await shot('add-existing-verdict')
  await dialog.getByRole('button', { name: SUBMIT_LABEL }).click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('assert the installation is registered for real, via the real IPC surface')
  const registered = await page.evaluate(async (name) => {
    const installations = await window.q2.invoke('installations:list')
    return installations.find((installation) => installation.name === name) ?? null
  }, WINDOWS_BUILD_INSTALL_NAME)
  if (!registered) {
    throw new Error(`no installation named "${WINDOWS_BUILD_INSTALL_NAME}" was registered`)
  }

  // `RunnerSection`'s own testids are NOT installation-scoped (see this file's header comment), so
  // every assertion below is scoped through this row's one per-installation testid instead of a
  // bare `page.getByTestId(...)`, which would violate Playwright's strict mode the moment a second
  // installation (every `populated` fixture install, or the elf/pe ranking install on Linux) is
  // also on screen.
  const row = page.locator('div.panel', { has: page.getByTestId(`installation-remove-${registered.id}`) })
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  return { registered, row }
}

// --- Windows branch (AC8): unchanged ranking, no Runner section, unwrapped preview --------------

async function runWindowsBranch({ page, step, shot }) {
  const { registered, row } = await addFixtureInstallation({ page, step, shot })

  step('assert quake2.exe was ranked and selected - unchanged from before this story (AC8)')
  const expectedExe = windowsBuildExecutablePath()
  if (registered.executablePath !== expectedExe) {
    throw new Error(
      `expected the selected executable to be ${JSON.stringify(expectedExe)}, got ` +
        JSON.stringify(registered.executablePath),
    )
  }

  // Story 104 D5 review finding: this used to assert NO Runner section rendered at all on win32 -
  // true under story 103, but D5 made `RunnerSection` render on every platform (Steam, D3, is a real
  // runner choice on Windows too). The new, correct claim for AC8 is narrower: nothing about the
  // *native* launch path changed - the section renders, its Native option is available (nothing off
  // Windows can make Native itself unavailable), and (checked below, unchanged) the preview is still
  // the plain unwrapped command.
  step('assert the Runner section renders on win32, with Native available (AC8)')
  const runnerSectionCount = await row.getByTestId('installation-runner').count()
  if (runnerSectionCount !== 1) {
    throw new Error(`expected exactly one Runner section on win32, found ${runnerSectionCount}`)
  }
  const nativeOption = row.getByTestId('installation-runner-option-native')
  await nativeOption.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await nativeOption.isDisabled()) {
    throw new Error('expected the native runner option to be available on win32')
  }
  // Story 104 review finding (Bug 2): a fresh installation has no stored `runner` at all - Native
  // must render CHECKED for that real default case, not merely enabled/clickable. `RunnerSection`
  // now defaults an unset `runner` to native the same way `resolveRunner()` does on the main side.
  if ((await nativeOption.getAttribute('aria-checked')) !== 'true') {
    throw new Error('expected the native runner option to render checked by default on win32')
  }

  step("assert launch:plan's preview is the plain, unwrapped executable - no runner involved (AC8)")
  const planned = await page.evaluate(
    (installationId) => window.q2.invoke('launch:plan', { installationId }),
    registered.id,
  )
  if (!planned.ok) {
    throw new Error(`expected launch:plan to succeed on win32, got: ${JSON.stringify(planned)}`)
  }
  if (planned.value.executablePath !== expectedExe || planned.value.args.length !== 0) {
    throw new Error(
      `expected an unwrapped plan (executablePath: ${JSON.stringify(expectedExe)}, args: []), got ` +
        JSON.stringify(planned.value),
    )
  }
  await shot('windows-branch-installation')
  console.log(
    `AC8: on win32, "${registered.name}" selected ${registered.executablePath}, the Runner ` +
      `section rendered with Native available, and the launch preview is unwrapped: ${planned.value.preview}`,
  )
}

// --- Linux branch (AC2, AC4-AC7) -----------------------------------------------------------------

async function runLinuxBranch({ page, app, step, shot }) {
  step('rewrite the fixture as genuinely PE-only (no native quake2) - see this file\'s header comment')
  writeWindowsBuildFixture({ includeNativeElf: false })

  const { registered, row } = await addFixtureInstallation({ page, step, shot })
  const expectedExeName = 'quake2.exe'

  step('assert the visible executable-runnable check text is present in the DOM (AC2)')
  const expectedCheckText = `${expectedExeName} is a Windows program and needs a runner to play on Linux.`
  // `exact: true`: the check's `<p>` (`ChecksList.tsx`) carries only this message, but its `fix`
  // renders a sibling "choose a runner" button right next to it inside the same `<li>` - a
  // non-exact (substring) match would also match that `<li>`/its wrapper `<div>`, since their own
  // text content still CONTAINS this string, and Playwright's strict mode would then refuse to
  // pick one.
  await row.getByText(expectedCheckText, { exact: true }).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step("assert the Runner section's wine entry is disabled, with its reason visible (AC6)")
  const wineOption = row.getByTestId('installation-runner-option-wine')
  await wineOption.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await wineOption.isDisabled())) {
    throw new Error('expected the wine runner option to be disabled on a PATH scrubbed of wine')
  }
  const wineReason = row.getByTestId('installation-runner-reason-wine')
  await wineReason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const wineReasonText = await wineReason.innerText()
  if (wineReasonText !== 'wine not found — install wine to run Windows builds') {
    throw new Error(`unexpected wine reason text: ${JSON.stringify(wineReasonText)}`)
  }
  await shot('linux-branch-no-runner')

  step('arm a launch:state listener before pressing Play, so no transition can be missed')
  await page.evaluate(() => {
    window.__q2lPhases = []
    window.q2.on('launch:state', (state) => {
      window.__q2lPhases.push(state.phase)
    })
  })

  // Capture the Runner section's current preview text before any runner is available - context for
  // where this flow starts from (no runner installed at all). `executable-runnable` is `warn`
  // severity (D3), so `installation.status` is `'warning'` and nothing here is disabled; with no
  // runner selected/available, `launch:plan` itself still fails, so this element currently shows the
  // `launch.error.noRunner` text (`RunnerSection.tsx`'s failed-plan branch), not a command. The
  // actual AC4 assertion ("choosing a runner changes the previewed command") is below, once a second
  // stub runner exists to tell an explicit choice apart from the cascade default - see the header
  // comment's "review finding N1" note.
  const previewLocator = row.getByTestId('installation-runner-preview')
  await previewLocator.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const previewBeforeWine = await previewLocator.innerText()

  // See this file's header comment ("why 'press Play' now means the real library-row button"):
  // `executable-runnable` is `warn`-severity, so `isPlayable('warning')` is `true` and the row's own
  // Play button is genuinely clickable, runner or not - the refusal has to come from pressing it.
  step('press the real library-row Play button - it is enabled (AC7)')
  const playButton = row.getByRole('button', { name: 'Play', exact: true })
  await playButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await playButton.isDisabled()) {
    throw new Error(
      'expected the library row Play button to be enabled (executable-runnable is warn, not error)',
    )
  }
  await playButton.click({ timeout: TIMEOUT_MS })

  step('assert the refusal surfaces as a visible toast naming the executable (AC7)')
  const expectedRefusalText =
    `${expectedExeName} is a Windows program and nothing on this machine can run it. Install wine ` +
    "or umu-run and pick it as the runner, or add this folder's game data to a native engine instead."
  // Mirrors `news-feed.mjs`'s own precedent for asserting on `[role="status"]` toasts (`Toasts.tsx`):
  // `useLauncher.ts`'s generic `toastError()` forwards the failed `launch:start` invoke's
  // `error.key`/`error.params` straight into this element's rendered text.
  const refusalToast = page.locator('[role="status"]', { hasText: expectedExeName })
  await refusalToast.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const refusalToastText = await refusalToast.innerText()
  if (!refusalToastText.includes(expectedRefusalText)) {
    throw new Error(
      `expected the refusal toast to read ${JSON.stringify(expectedRefusalText)}, got ${JSON.stringify(refusalToastText)}`,
    )
  }

  step('assert no launch:state running phase was ever broadcast (AC7)')
  const phasesAfterRefusal = await page.evaluate(() => window.__q2lPhases ?? [])
  if (phasesAfterRefusal.includes('running')) {
    throw new Error(
      `launch:state broadcast a 'running' phase despite the refusal: ${JSON.stringify(phasesAfterRefusal)}`,
    )
  }
  console.log(`AC7: Play refused via a visible toast, phases observed: ${JSON.stringify(phasesAfterRefusal)}`)

  step('dismiss the refusal toast so it does not linger over the later shots')
  await refusalToast.getByRole('button', { name: 'Close' }).click({ timeout: TIMEOUT_MS })
  await refusalToast.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  // Review finding N1: a single stub (`wine`) made "the cascade default became available" and "the
  // user explicitly chose it" produce the identical visible result, since `installation.runner` is
  // still unset here and `resolveRunner()`'s cascade (`WRAPPING_KINDS = ['wine', 'umu']`, wine ranked
  // first, `src/main/services/runners.ts`) already picks wine automatically the moment it is found -
  // before anything is clicked. Two stubs fix that: with both wine and umu-run on PATH, the cascade
  // still defaults to wine, so explicitly picking umu-run instead is the only path to the umu-wrapped
  // preview, and reaching it proves the click handler actually persisted the user's own choice.
  step('write stub wine and umu-run binaries on PATH (#!/bin/sh + exec "$@") and let the running app find them (AC4)')
  const wineDir = writeWineStub()
  const umuDir = writeUmuStub()
  await app.evaluate(
    ({ wineDir, umuDir }) => {
      const stubDirs = `${wineDir}:${umuDir}`
      process.env.PATH = process.env.PATH ? `${stubDirs}:${process.env.PATH}` : stubDirs
    },
    { wineDir, umuDir },
  )
  console.log(`  wine stub dir:    ${wineDir}`)
  console.log(`  umu-run stub dir: ${umuDir}`)

  step('force the Runner section to re-detect runners - navigate away and back, remounting it')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const umuOption = row.getByTestId('installation-runner-option-umu')

  step('wait for both wine and umu-run options to report available (AC4)')
  await waitForEnabled(wineOption, RUNNER_REFRESH_TIMEOUT_MS)
  await waitForEnabled(umuOption, RUNNER_REFRESH_TIMEOUT_MS)

  // This is the state the OLD, buggy version of this flow mistook for "choosing wine changed the
  // preview": no explicit choice has been made yet (`installation.runner` is still unset), so this is
  // purely `resolveRunner()`'s cascade default. Captured only so the NEXT step's explicit-choice
  // assertion has something concrete to differ from.
  step('assert the cascade default (no explicit choice made yet) is the wine-wrapped command')
  const previewAfterBothAvailable = await waitForPreviewChange(
    previewLocator,
    previewBeforeWine,
    RUNNER_REFRESH_TIMEOUT_MS,
  )
  const wineBinaryPath = `${wineDir}/wine`
  if (!previewAfterBothAvailable.includes(wineBinaryPath) || !previewAfterBothAvailable.includes(expectedExeName)) {
    throw new Error(
      `expected the cascade-default preview to contain both ${JSON.stringify(wineBinaryPath)} and ` +
        `${expectedExeName}, got ${JSON.stringify(previewAfterBothAvailable)}`,
    )
  }

  step('explicitly select umu-run - the runner the cascade did NOT default to - and assert it persists (AC4)')
  await umuOption.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (el) => el?.getAttribute('aria-checked') === 'true',
    await umuOption.elementHandle(),
    { timeout: TIMEOUT_MS },
  )
  const updated = await page.evaluate(async (id) => {
    const installations = await window.q2.invoke('installations:list')
    return installations.find((installation) => installation.id === id) ?? null
  }, registered.id)
  if (updated?.runner !== 'umu') {
    throw new Error(`expected the installation's recorded runner to be "umu", got: ${JSON.stringify(updated?.runner)}`)
  }

  step('assert the previewed command changed to the explicit umu-run choice, not the cascade default (AC4)')
  // This can only pass if the click handler genuinely persisted the explicit choice AND the preview
  // genuinely reflects it: the previous step's cascade default already produced a DIFFERENT (wine)
  // command, so a click handler that silently left the cascade default in place - the exact failure
  // mode the single-stub version of this flow could not have caught - would fail this assertion.
  const previewAfterUmu = await waitForPreviewChange(
    previewLocator,
    previewAfterBothAvailable,
    RUNNER_REFRESH_TIMEOUT_MS,
  )
  const umuBinaryPath = `${umuDir}/umu-run`
  if (!previewAfterUmu.includes(umuBinaryPath) || !previewAfterUmu.includes(expectedExeName)) {
    throw new Error(
      `expected the umu-run-wrapped preview to contain both ${JSON.stringify(umuBinaryPath)} and ` +
        `${expectedExeName}, got ${JSON.stringify(previewAfterUmu)}`,
    )
  }
  console.log(
    `AC4: explicitly choosing umu-run changed the preview from the cascade default ` +
      `${JSON.stringify(previewAfterBothAvailable)} to ${JSON.stringify(previewAfterUmu)}`,
  )

  await shot('linux-branch-umu-selected')

  // Review finding N2: this step used to bypass the button entirely
  // (`page.evaluate(() => window.q2.invoke('launch:start', ...))`), a leftover from before the
  // Play-disabled-forever bug (see this file's header comment) was fixed, when Play truly was
  // unclickable and a raw invoke was the only way to reach a real spawn. Play is genuinely enabled
  // now, so this presses the same real `playButton` locator AC7 already used above.
  step('press the real library-row Play button again - real spawn, through the real umu-run wrapper (AC5)')
  await playButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await playButton.click({ timeout: TIMEOUT_MS })

  step('wait for the real process to exit, then assert running -> exited, in order (AC5)')
  await page.waitForFunction(
    () => Array.isArray(window.__q2lPhases) && window.__q2lPhases.includes('exited'),
    { timeout: LAUNCH_TIMEOUT_MS },
  )
  const phases = await page.evaluate(() => window.__q2lPhases)
  const runningIndex = phases.indexOf('running')
  const exitedIndex = phases.indexOf('exited')
  if (runningIndex === -1) {
    throw new Error(`launch state never reported 'running' - observed phases: ${JSON.stringify(phases)}`)
  }
  if (exitedIndex === -1 || exitedIndex < runningIndex) {
    throw new Error(`launch state did not go running -> exited, in order - observed: ${JSON.stringify(phases)}`)
  }
  await shot('linux-branch-launch-exited')
  console.log(`AC4/AC5: umu-run explicitly selected, real launch state transitioned ${JSON.stringify(phases)}`)

  console.log(
    'windows-build-on-linux (Linux branch): a PE-only folder raised the visible executable-runnable ' +
      'check (AC2), the Runner section showed wine disabled with its reason on a scrubbed PATH ' +
      '(AC6), pressing the real Play button refused via a visible launch.error.noRunner toast and ' +
      'broadcast no running phase (AC7), and once wine and umu-run stubs were both on PATH, ' +
      'explicitly choosing umu-run over the wine cascade default changed the previewed command and ' +
      'pressing the real Play button again went running -> exited for real (AC4/AC5).',
  )
}

/** Polls `locator.isDisabled()` until it reports `false`, or throws once `timeoutMs` elapses -
 * `installations:listRunners` is an async fetch (`RunnerSection.tsx`'s own `useEffect`), so the
 * option does not flip from disabled to enabled synchronously with the remount above. */
async function waitForEnabled(locator, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (!(await locator.isDisabled())) return
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for the runner option to become enabled`)
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/** Polls `locator.innerText()` until it differs from `previousText`, or throws once `timeoutMs`
 * elapses - `RunnerSection.tsx`'s preview effect is keyed on `installation.runner` and re-fetches
 * `launch:plan` asynchronously after `installations:update` lands, so it does not flip from the
 * noRunner error text to the wrapped command synchronously with the runner-option click above.
 * Returns the new text so the caller can assert on its content. */
async function waitForPreviewChange(locator, previousText, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const text = await locator.innerText()
    if (text !== previousText) return text
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for the runner preview to change from ${JSON.stringify(previousText)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}
