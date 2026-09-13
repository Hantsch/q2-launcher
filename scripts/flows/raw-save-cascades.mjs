// Story 079 D3 acceptance flow (AC1): a raw save (story 057) is a content mutation like any
// other, so it now cascades to every assigned, not-running installation the same way a structured
// `save` (story 043 D4) always has - and it must reach them BYTE-IDENTICAL to the typed text, never
// a re-render of it (`index.ts#saveRawText`'s `refuseCanonicalWriteFor`, `sync.ts#installationCopySource`).
//
// Mirrors `scripts/flows/raw-inline-edit.mjs`'s shape almost exactly (real testids/roles, the same
// `.cfg-code-textarea`/`config-save` path) - the difference is what this flow asserts afterwards:
// not just the canonical file, but BOTH of Plain Profile's assigned installations' own copies
// (`INSTALL_ONE_ID`/`INSTALL_TWO_ID`, story 079 D3's fixture addition - see `fixture.mjs`).
//
// Selectors, not guesses:
//   nav-config              TitleBar.tsx
//   config-profile-row      ConfigView.tsx
//   config-tab-raw          ConfigView.tsx
//   .cfg-code-textarea      ConfigCodeView.tsx - the editable code view's real `<textarea>`
//   config-tab-unsaved      ConfigView.tsx - appears while a raw draft is active
//   config-save             ProfileSaveActions.tsx - the header's Save button; while a raw draft is
//                           active its `onClick` calls `rawDraft.save()` (`saveRawText`)
//   config-raw-save-result  RawFileTab.tsx - the inline read-back panel a raw save's result renders
//
// Unlike `ui:shot`/`ui:a11y`/`ui:verify`, `ui:flow` never reseeds the fixture before launching
// (`scripts/flow.mjs`'s `withApp()` opens `.ui-verify/fixture/populated/userdata` as-is), so a
// per-run suffix (same idiom `raw-inline-edit.mjs`/`settings-section-rename-add-cvar.mjs` use) keeps
// this flow re-runnable without a reseed.
//
// Same precondition `raw-inline-edit.mjs` documents: `rawEditingMode` only allows typing while
// Plain Profile's *structured* changes are clean. Run `npm run ui:seed` first if the fixture's last
// known state came from a `ui:verify` run (which leaves Plain Profile server-dirty).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import { INSTALL_ONE_ID, INSTALL_TWO_ID, installationConfigFilePath } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** Mirrors `raw-inline-edit.mjs`'s own comment: the Raw file tab's `getRawFiles` fetch has been
 * observed taking noticeably longer than `TIMEOUT_MS` to settle. */
const RAW_TAB_LOAD_TIMEOUT_MS = 20_000

/** Mirrors `scripts/lib/screens.mjs`'s `PLAIN_PROFILE_FILE_NAME` - `resolveProfileFileNames`
 * sanitizes "Plain Profile"'s space to `-`, so the on-disk name is `Plain-Profile.cfg`. */
const PLAIN_PROFILE_FILE_NAME = 'Plain-Profile.cfg'

const RUN_SUFFIX = Date.now().toString(36)
const TYPED_LINE = `// q2l_flow_raw_cascade_${RUN_SUFFIX}`

export default async function rawSaveCascades({ page, shot, step }) {
  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })

  step('select Plain Profile')
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })

  step('open Raw file tab')
  await page.getByTestId('config-tab-raw').click({ timeout: TIMEOUT_MS })

  const textarea = page.locator('.cfg-code-textarea')
  await textarea.waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })

  step('type a hand-formatted line at the end of the editor (deliberately not a render fixed point)')
  await textarea.click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Control+End')
  // A tab, extra spaces and no trailing newline - hand formatting `renderProfileFile` would never
  // produce, which is exactly what proves the cascade copies the typed bytes and never re-renders
  // them (AC1/AC9's whole point, `index.ts#saveRawText`'s `refuseCanonicalWriteFor`).
  await page.keyboard.type(`\n\t${TYPED_LINE}   `)

  step('assert the draft raises the Unsaved tab')
  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('draft-typed')

  step("save via the header's Save button (rawDraft.save() -> saveRawText)")
  await page.getByTestId('config-save').click({ timeout: TIMEOUT_MS })

  step('assert the read-back result panel appears')
  const resultPanel = page.getByTestId('config-raw-save-result')
  await resultPanel.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('saved')

  step('assert the canonical file on disk contains exactly the typed bytes')
  const canonicalPath = join(variantUserDataDir('populated'), PLAIN_PROFILE_FILE_NAME)
  const canonical = readFileSync(canonicalPath, 'latin1')
  if (!canonical.includes(`\t${TYPED_LINE}   `)) {
    throw new Error(
      `expected ${canonicalPath} to contain the exact typed bytes after saving, it did not - got: ` +
        JSON.stringify(canonical.slice(-200)),
    )
  }

  step(
    'assert BOTH of Plain Profile\'s assigned installations now hold a byte-identical copy of the ' +
      'canonical file (AC1) - never a re-render of it',
  )
  for (const installId of [INSTALL_ONE_ID, INSTALL_TWO_ID]) {
    const copyPath = installationConfigFilePath(installId, PLAIN_PROFILE_FILE_NAME)
    const copy = readFileSync(copyPath, 'latin1')
    if (copy !== canonical) {
      throw new Error(
        `expected installation ${installId}'s copy (${copyPath}) to be byte-identical to the ` +
          `canonical file after a raw save; it was not`,
      )
    }
  }
}
