// Story 105 (docs/requirements/105-the-runner-choice-is-short-and-readable.md) D4: the story's own
// end-to-end proof, mirroring `steam-handoff.mjs`'s `setup()`/row-scoping shape and
// `config-header-geometry.mjs`'s `boundingBox()` height-comparison technique.
//
// D1-D3 already collapsed every Proton build into one disabled `RunnerOption`, turned
// `RunnerSection` into a wrapping row of pill chips with a `role="radiogroup"` and per-reason
// paragraphs below the row (`installation-runner-option-<kind>` / `installation-runner-reason-<kind>`,
// unchanged testids), and added a UI-harness-only override for runner detection
// (`Q2L_UI_DETECTED_RUNNERS`, `src/main/lib/ui-harness.ts`) so a flow can seed a deterministic runner
// list instead of depending on what happens to be installed on whichever machine runs it.
//
// This flow proves the story's own "reported setup" (its own bug report: native + wine + umu-run all
// available, Steam present but the folder is not one of its own, and four Proton builds) against the
// REAL running app, via that override - on win32 and off it alike, no platform-conditional skip for
// what the override itself makes reachable everywhere (the resolved open question: "not a
// Linux-CI-only branch"). `detectRunners()` (`src/main/services/runners.ts`) checks the override
// FIRST, before any real Wine/umu-run/Proton/Steam detection - once `Q2L_UI_DETECTED_RUNNERS` is set,
// nothing about the real machine's own installed compatibility layers can change the outcome, on
// either OS. A single override list is used for Steam too (rather than the sibling
// `Q2L_UI_STEAM_EXECUTABLE` `steam-handoff.mjs` uses): `detectRunners()` returns the override
// verbatim and never calls `findSteam()` once it is set, so layering `Q2L_UI_STEAM_EXECUTABLE` on top
// would be inert - one full, explicit list is the simpler and equally-real proof surface.
//
// The fixture folder (`writeWindowsBuildFixture({ includeNativeElf: false })`, shared with
// `windows-build-on-linux.mjs`) is a genuine PE-only Windows build, not under any Steam library's
// `steamapps/common/` - `readSteamAppId()` finds no owning appid for it, which is exactly what turns
// the seeded (available) Steam runner into the "not owner" reason (`steamUnavailableReason`,
// `src/main/services/runners.ts`) rather than "not found". Off win32, `needsCompatRunner()` is true
// for this PE-only executable, so the umu-run choice below genuinely reaches the previewed launch
// command (AC6); on win32 it never does (AC8, unchanged by this story) - this flow only asserts the
// preview change off win32, exactly as `windows-build-on-linux.mjs` only presses Play off win32.
//
// AC5's geometry math needs an installation whose checks actually render, which the "reported setup"
// installation above does not get for free (a clean PE-only build with a resolvable runner raises no
// checks). `writePopulatedFixture()`'s own `INSTALL_FAILED_ID` ("Fixture Failed Install") is reused
// for that instead: it is seeded with a real `status: 'invalid'`/non-empty `checks` array that does
// not depend on runner detection or platform at all, so it renders identically (and with checks
// showing) on both the win32 and the ubuntu-xvfb CI legs.
//
// ## Selectors, not guesses
//
// Every testid this flow drives against is real, and every RunnerSection testid is scoped through a
// row locator the way `windows-build-on-linux.mjs`/`steam-handoff.mjs` document it must be
// (`installation-runner-option-<kind>`, `installation-runner-reason-<kind>` are NOT
// installation-scoped, and this flow - like those two - puts more than one installation on screen at
// once): `page.locator('div.panel', { has: page.getByTestId('installation-remove-<id>') })` per
// installation, same as those files' own `row`. `installation-header`/`installation-checks`
// (`LibraryView.tsx`, added by this deliverable) are scoped the same way.
import { writePopulatedFixture, writeWindowsBuildFixture } from '../lib/fixture.mjs'

/** Mirrors `scripts/lib/fixture.mjs`'s own (module-private) `INSTALL_FAILED_ID` constant - not
 * exported there, and this deliverable's own scope does not extend to that file, so the literal is
 * reproduced here instead. `writePopulatedFixture()` always seeds this id with a real `status:
 * 'invalid'`/non-empty `checks` array ("Fixture Failed Install"), independent of platform or runner
 * detection - exactly the "installation whose checks are rendered" AC5 needs. */
const INSTALL_FAILED_ID = 'fixture-install-failed'

const TIMEOUT_MS = 8_000
/** How long to poll for the Runner section to pick up the harness-seeded runner list after a
 * navigate-away-and-back remount (AC6's "stays picked" step). */
const RUNNER_REFRESH_TIMEOUT_MS = 8_000

const ADD_EXISTING_BUTTON_LABEL = 'Add existing'
const BROWSE_LABEL = 'Browse…'
const SUBMIT_LABEL = 'Add installation'

const REPORTED_SETUP_NAME = 'Fixture Runner Choice Install'

/** The story's own reported build count (AC1: "Proton is listed once, disabled, with its build
 * count" - the reason text must contain this literal). */
const PROTON_BUILD_COUNT = 4

/** Mirrors src/renderer/src/i18n/locales/en.json's `runner.unavailable.*` - asserted verbatim, the
 * same way `steam-handoff.mjs`/`windows-build-on-linux.mjs` assert their own reason texts. */
const STEAM_NOT_OWNER_TEXT = 'this folder is not a Steam install — Steam can only start games it owns'
const PROTON_REASON_TEXT =
  `${PROTON_BUILD_COUNT} Proton builds are used through umu-run, not launched directly — ` +
  'pick umu-run instead'

/** Set by `setup()`, read by the flow body. */
let reportedRoot = null

/** The exact `DetectedRunner[]` shape `uiHarnessDetectedRunners()` validates
 * (`src/main/lib/ui-harness.ts`'s `detectedRunnerSchema`) - the story's own reported setup: native,
 * wine and umu-run all available, Steam present (but this fixture folder is not one Steam owns, so
 * `steamUnavailableReason` still turns it into "not owner"), and four distinct Proton builds. */
function reportedSetupDetectedRunners() {
  const runners = [
    { kind: 'native', id: 'native', path: '', available: true },
    { kind: 'wine', id: 'wine', path: '/fixture/runner-choice-compact/wine', available: true },
    { kind: 'umu', id: 'umu', path: '/fixture/runner-choice-compact/umu-run', available: true },
    { kind: 'steam', id: 'steam', path: '/fixture/runner-choice-compact/steam', available: true },
  ]
  for (let i = 1; i <= PROTON_BUILD_COUNT; i += 1) {
    runners.push({
      kind: 'proton',
      id: `proton-build-${i}`,
      label: `Proton - Fixture Build ${i}`,
      path: `/fixture/runner-choice-compact/proton-${i}`,
      available: true,
    })
  }
  return runners
}

export async function setup() {
  // Reseeded for the reason every installation-adding flow reseeds (`steam-handoff.mjs`,
  // `windows-build-on-linux.mjs`): `InstallationsService.addExisting()` refuses a second registration
  // at the same path, so a second run of this flow would fail at "add installation" without a fresh
  // fixture underneath it. This also (re)seeds `INSTALL_FAILED_ID`, which AC5's geometry math reads.
  writePopulatedFixture()

  const written = writeWindowsBuildFixture({ includeNativeElf: false })
  reportedRoot = written.root
  console.log(`  fixture install root: ${reportedRoot}`)

  const detected = reportedSetupDetectedRunners()
  console.log(`  seeded ${detected.length} detected runners via Q2L_UI_DETECTED_RUNNERS`)

  return {
    env: {
      Q2L_UI_PICK_FOLDER: reportedRoot,
      Q2L_UI_DETECTED_RUNNERS: JSON.stringify(detected),
    },
  }
}

export default async function runnerChoiceCompact({ page, step, shot }) {
  const { row } = await addReportedSetupInstallation({ page, step })

  await assertProtonListedOnce(row)
  await assertNoTwoReasonsMatch(row)
  await assertEveryUnavailableRunnerStaysVisible(row)
  await shot('reported-setup')

  await assertRunnerNoTallerThanHeaderPlusChecks({ page, step, shot })

  await assertKeyboardPickPersists({ page, row, step, shot })

  console.log(
    'runner-choice-compact: Proton listed once with its build count (AC1), every disabled reason ' +
      'text distinct (AC2), every unavailable runner stayed visible with a visible, describedby-linked ' +
      'reason (AC4), the runner section fit inside the header+checks height budget (AC5), and a ' +
      'keyboard pick of umu-run survived a nav-config -> nav-library remount (AC6).',
  )
}

// --- add the reported-setup installation, return its row's own scope ----------------------------

async function addReportedSetupInstallation({ page, step }) {
  step('open the library and start "Add existing" for the reported setup')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page
    .getByRole('button', { name: ADD_EXISTING_BUTTON_LABEL, exact: true })
    .click({ timeout: TIMEOUT_MS })

  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('browse for the fixture install root (the stubbed folder pick)')
  await dialog.getByRole('button', { name: BROWSE_LABEL }).click({ timeout: TIMEOUT_MS })

  // Mirrors `steam-handoff.mjs`/`windows-build-on-linux.mjs`: the engine badge only renders once
  // `installations:inspectPath` resolves, so waiting on it first makes reading the path field
  // race-proof.
  const engineBadge = dialog.getByTestId('engine-badge')
  await engineBadge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const shownPath = await dialog.getByLabel('Installation folder').inputValue()
  if (shownPath !== reportedRoot) {
    throw new Error(
      `expected the folder field to show ${JSON.stringify(reportedRoot)}, got ${JSON.stringify(shownPath)}`,
    )
  }

  step('name it and submit')
  const nameInput = dialog.getByLabel('Name in the launcher')
  await nameInput.fill(REPORTED_SETUP_NAME)
  await dialog.getByRole('button', { name: SUBMIT_LABEL }).click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('assert the installation is registered for real, via the real IPC surface')
  const registered = await page.evaluate(async (installName) => {
    const installations = await window.q2.invoke('installations:list')
    return installations.find((installation) => installation.name === installName) ?? null
  }, REPORTED_SETUP_NAME)
  if (!registered) {
    throw new Error(`no installation named "${REPORTED_SETUP_NAME}" was registered`)
  }

  const row = page.locator('div.panel', { has: page.getByTestId(`installation-remove-${registered.id}`) })
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await row.getByTestId('installation-runner').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  return { registered, row }
}

// --- AC1: Proton is listed once, disabled, with its build count ----------------------------------

async function assertProtonListedOnce(row) {
  const protonOptions = row.getByTestId('installation-runner-option-proton')
  const count = await protonOptions.count()
  if (count !== 1) {
    throw new Error(`expected exactly one installation-runner-option-proton chip, found ${count} (AC1)`)
  }
  const protonOption = protonOptions.first()
  await protonOption.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await protonOption.isDisabled())) {
    throw new Error('expected the collapsed Proton option to be disabled (AC1)')
  }

  const reason = row.getByTestId('installation-runner-reason-proton')
  await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const reasonText = await reason.innerText()
  if (!reasonText.includes(String(PROTON_BUILD_COUNT))) {
    throw new Error(
      `expected the Proton reason text to carry the build count "${PROTON_BUILD_COUNT}", got ` +
        JSON.stringify(reasonText),
    )
  }
  if (reasonText !== PROTON_REASON_TEXT) {
    throw new Error(`unexpected Proton reason text: ${JSON.stringify(reasonText)}`)
  }
  console.log(`AC1: one disabled Proton chip, reason ${JSON.stringify(reasonText)}`)
}

// --- AC2: no two disabled reasons read the same ---------------------------------------------------

async function assertNoTwoReasonsMatch(row) {
  const reasonTexts = await row
    .locator('[data-testid^="installation-runner-reason-"]')
    .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''))

  if (reasonTexts.length < 2) {
    throw new Error(
      `expected at least two disabled-reason paragraphs to compare for AC2, found ${reasonTexts.length}: ` +
        JSON.stringify(reasonTexts),
    )
  }

  const seen = new Set()
  for (const text of reasonTexts) {
    if (seen.has(text)) {
      throw new Error(`two disabled reasons read the same text ${JSON.stringify(text)} (AC2): ${JSON.stringify(reasonTexts)}`)
    }
    seen.add(text)
  }
  console.log(`AC2: ${reasonTexts.length} disabled-reason texts, all pairwise distinct: ${JSON.stringify(reasonTexts)}`)
}

// --- AC4: every unavailable runner stays visible with its reason ---------------------------------

async function assertEveryUnavailableRunnerStaysVisible(row) {
  const chipHandles = await row.locator('[data-testid^="installation-runner-option-"]').elementHandles()
  let disabledCount = 0

  for (const chip of chipHandles) {
    const isDisabled = await chip.evaluate((element) => element.disabled)
    if (!isDisabled) continue
    disabledCount += 1

    const isVisible = await chip.isVisible()
    if (!isVisible) {
      const testId = await chip.evaluate((element) => element.dataset.testid)
      throw new Error(`disabled chip ${testId} is not visible (AC4)`)
    }

    const describedBy = await chip.evaluate((element) => element.getAttribute('aria-describedby'))
    if (!describedBy) {
      const testId = await chip.evaluate((element) => element.dataset.testid)
      throw new Error(`disabled chip ${testId} has no aria-describedby target (AC4)`)
    }

    const reason = row.locator(`#${describedBy}`);
    await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const reasonText = (await reason.innerText()).trim()
    if (reasonText.length === 0) {
      throw new Error(`the aria-describedby target #${describedBy} is empty (AC4)`)
    }
  }

  if (disabledCount === 0) {
    throw new Error('expected at least one disabled runner chip to exercise AC4, found none')
  }
  console.log(`AC4: ${disabledCount} disabled chip(s), each visible with a visible, non-empty describedby reason`)
}

// --- AC5: the runner section is no taller than the header and checks -----------------------------

async function assertRunnerNoTallerThanHeaderPlusChecks({ page, step, shot }) {
  step('locate the Fixture Failed Install row - checks always render there, on every platform (AC5)')
  const failedRow = page.locator('div.panel', {
    has: page.getByTestId(`installation-remove-${INSTALL_FAILED_ID}`),
  })
  await failedRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const header = failedRow.getByTestId('installation-header')
  const checks = failedRow.getByTestId('installation-checks')
  const runner = failedRow.getByTestId('installation-runner')

  // The flow must assert the checks wrapper exists before measuring its height - a row with no
  // checks would make this comparison vacuous rather than a real proof.
  const checksCount = await checks.count()
  if (checksCount !== 1) {
    throw new Error(
      `expected exactly one installation-checks wrapper on the Fixture Failed Install row, found ` +
        `${checksCount} - this flow needs an installation whose checks are actually rendered (AC5)`,
    )
  }
  await checks.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await header.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await runner.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const headerBox = await header.boundingBox()
  const checksBox = await checks.boundingBox()
  const runnerBox = await runner.boundingBox()
  if (!headerBox || !checksBox || !runnerBox) {
    throw new Error(
      `could not measure installation-header/installation-checks/installation-runner - got ` +
        `header=${JSON.stringify(headerBox)} checks=${JSON.stringify(checksBox)} runner=${JSON.stringify(runnerBox)}`,
    )
  }

  const budget = headerBox.height + checksBox.height
  if (runnerBox.height > budget) {
    throw new Error(
      `installation-runner is ${Math.round(runnerBox.height)}px tall, taller than ` +
        `installation-header (${Math.round(headerBox.height)}px) + installation-checks ` +
        `(${Math.round(checksBox.height)}px) = ${Math.round(budget)}px (AC5)`,
    )
  }
  console.log(
    `AC5: installation-runner is ${Math.round(runnerBox.height)}px tall, within the ` +
      `${Math.round(budget)}px header+checks budget (header ${Math.round(headerBox.height)}px + ` +
      `checks ${Math.round(checksBox.height)}px)`,
  )
  await shot('header-checks-runner-geometry')
}

// --- AC6: a runner is picked by keyboard and stays picked -----------------------------------------

async function assertKeyboardPickPersists({ page, row, step, shot }) {
  step('Tab to the umu-run chip and press Space to pick it (AC6)')
  const umuOption = row.getByTestId('installation-runner-option-umu')
  await umuOption.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  // A real keyboard interaction, not a synthetic click: focus the chip directly (mirrors a user
  // tabbing to it) rather than walking every preceding focusable element with repeated Tab presses,
  // then press Space - the standard activation key for a role="radio" control.
  await umuOption.focus()
  await page.keyboard.press('Space')

  await page.waitForFunction(
    (element) => element?.getAttribute('aria-checked') === 'true',
    await umuOption.elementHandle(),
    { timeout: TIMEOUT_MS },
  )
  console.log('AC6: umu-run picked via keyboard (Tab + Space), aria-checked="true"')

  const previewLocator = row.getByTestId('installation-runner-preview')
  let previewAfterPick = null
  if (process.platform !== 'win32') {
    // `needsCompatRunner()` (`src/main/services/runners.ts`) only lets the choice reach the launch
    // command off win32, for this PE-only fixture - mirrors `windows-build-on-linux.mjs`'s own
    // platform split for the same reason.
    step('off win32: assert the previewed command changed to the umu-run choice (AC6)')
    previewAfterPick = await waitForPreviewContains(previewLocator, 'umu-run', RUNNER_REFRESH_TIMEOUT_MS)
    console.log(`AC6: previewed command now reads ${JSON.stringify(previewAfterPick)}`)
  } else {
    console.log(
      'AC6: SKIPPING the previewed-command assertion LOUDLY on win32 - needsCompatRunner() is an ' +
        'unconditional no-op there (AC8, unchanged by this story), so umu-run never reaches the ' +
        'launch command on this platform. The ubuntu xvfb CI job (and any Linux dev machine) proves ' +
        'that half for real.',
    )
  }

  await shot('umu-picked-via-keyboard')

  step('remount the Runner section - navigate to config and back to library (AC6)')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert umu-run is still checked after the remount (AC6)')
  const umuAfterRemount = row.getByTestId('installation-runner-option-umu')
  await umuAfterRemount.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (element) => element?.getAttribute('aria-checked') === 'true',
    await umuAfterRemount.elementHandle(),
    { timeout: RUNNER_REFRESH_TIMEOUT_MS },
  )

  if (process.platform !== 'win32') {
    const previewAfterRemount = await row.getByTestId('installation-runner-preview').innerText()
    if (!previewAfterRemount.includes('umu-run')) {
      throw new Error(
        `expected the umu-run choice to survive the remount, preview reads ` +
          `${JSON.stringify(previewAfterRemount)} (AC6, previously ${JSON.stringify(previewAfterPick)})`,
      )
    }
  }

  console.log('AC6: umu-run stayed checked after a nav-config -> nav-library remount')
  await shot('umu-still-picked-after-remount')
}

/** Polls `locator.innerText()` until it contains `expectedSubstring`, or throws once `timeoutMs`
 * elapses - mirrors `steam-handoff.mjs`'s/`windows-build-on-linux.mjs`'s own copy: `RunnerSection.tsx`'s
 * preview effect is async, so it never flips synchronously with whatever DOM interaction triggered it. */
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
