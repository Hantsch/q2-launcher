// Story 100 (docs/requirements/100-the-launcher-runs-on-linux.md) D8: AC7's e2e half - "when the
// running platform has no installable engine at all, the bootstrap wizard says so and points the
// user at adding an existing installation. It never shows an empty engine list...".
//
// This is deliberately NOT a Linux-only proof: `startNoEngineForPlatformFixtureServer()`
// (`scripts/lib/fixture.mjs`) pins Q2PRO only for a platform literal no real host process ever
// reports (`NO_ENGINE_FOR_PLATFORM_PLATFORM`), so `bootstrapEngineOptions` answers
// `emptyReason: 'none-for-platform'` on every host this flow runs on - a Windows dev box or either
// CI leg alike - the same way a real Linux host would see it against today's shipped,
// Windows-only manifest (story's own Engine decision). D5/D6's actual per-platform resolution is
// covered by `manifest-parse.test.ts`/`engine-options.test.ts`; this flow only proves the UI half:
// the wizard names the gap and its action reaches the add-installation dialog.
//
// Mirrors `bootstrap-wizard.mjs`'s `setup()`/`teardown()` shape and its `Q2L_UI_CONTENT_REPO_BASE`
// harness override (`src/main/modules/downloads/harness.ts`, gated the same way - read that file's
// own top comment for how the loopback override is proven unreachable in a packaged build). Unlike
// that flow, nothing is ever downloaded or installed here, so there is no `Q2L_UI_PICK_FOLDER` and
// no vendored-extractor precondition - the flow never gets past the engine step.
//
// ## Selectors, not guesses
//
//   library-download-install         views/LibraryView.tsx - opens this wizard (same as
//                                     `bootstrap-wizard.mjs`)
//   bootstrap-engine-empty           modules/downloads/bootstrap/EngineStep.tsx (D8) - the empty
//                                     state's own `Panel`, wraps the platform-specific sentence
//   bootstrap-engine-empty-action    modules/downloads/bootstrap/EngineStep.tsx (D8) - opens
//                                     `add-existing` via `BootstrapWizard.tsx`'s `onAddExisting`
//   dialog role="dialog" aria-label  components/ui/Modal.tsx - `AddExistingDialog`'s own title
import { startNoEngineForPlatformFixtureServer } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

/** The exact `bootstrapWizard.engine.empty.platformTitle`/`platformBody` strings
 * (`src/renderer/src/i18n/locales/en.json`) - asserted against the literal, not merely "some text
 * changed", so a future wording edit here fails loudly rather than silently drifting from the copy
 * a real user would read. */
const EXPECTED_TITLE = 'No engine for this platform yet'
const EXPECTED_BODY =
  "There's no installable engine for this platform yet. If you already have Quake II installed, " +
  'add it as an existing installation instead.'

/** `dialog.addExisting.title` (`en.json`) - `Modal`'s `aria-label` on the real `AddExistingDialog`. */
const ADD_EXISTING_DIALOG_TITLE = 'Add existing installation'

/** Module-scoped, because `setup()` starts it and `teardown()` has to close it. */
let server = null

export async function setup() {
  server = await startNoEngineForPlatformFixtureServer()
  console.log(`  fixture server: ${server.baseUrl}`)
  console.log('  engines manifest: pins q2pro for a platform no real host ever reports as')

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

export default async function bootstrapNoEngineForPlatform({ page, shot, step }) {
  step('open the Library and click "Download & install"')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })

  step('assert the engine step shows the empty state and no engine option rows (AC7)')
  const emptyState = page.getByTestId('bootstrap-engine-empty')
  await emptyState.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const rowIds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="bootstrap-engine-"]')]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id !== 'bootstrap-engine-empty' && id !== 'bootstrap-engine-empty-action'),
  )
  if (rowIds.length > 0) {
    throw new Error(`expected no engine option rows, found: ${JSON.stringify(rowIds)} (AC7)`)
  }

  step('assert the platform-specific message is shown, not the generic one (AC7)')
  // The title renders through the app's own `uppercase` heading style (`EmptyState`'s `h2`), so
  // this compares case-insensitively - the wording, not the CSS, is what this assertion is about.
  const emptyText = await emptyState.innerText()
  if (!emptyText.toLowerCase().includes(EXPECTED_TITLE.toLowerCase())) {
    throw new Error(
      `expected the empty state to show the platform-gap title ${JSON.stringify(EXPECTED_TITLE)}, got: ${JSON.stringify(emptyText)}`,
    )
  }
  if (!emptyText.includes(EXPECTED_BODY)) {
    throw new Error(
      `expected the empty state to show the platform-gap body ${JSON.stringify(EXPECTED_BODY)}, got: ${JSON.stringify(emptyText)}`,
    )
  }
  if (/nothing available to install/i.test(emptyText)) {
    throw new Error(
      `the generic "nothing pinned" copy leaked through instead of the platform-specific one: ${JSON.stringify(emptyText)}`,
    )
  }
  await shot('engine-step-empty')

  step('follow the action to the add-installation dialog (AC7)')
  await page.getByTestId('bootstrap-engine-empty-action').click({ timeout: TIMEOUT_MS })

  const addExistingDialog = page.getByRole('dialog', { name: ADD_EXISTING_DIALOG_TITLE })
  await addExistingDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('add-existing-dialog')

  console.log(
    'bootstrap no-engine-for-platform: the engine step showed no rows, named the platform gap ' +
      'explicitly, and its action opened the add-installation dialog',
  )
}
