// Story 057 D7 acceptance flow: type a line into the Raw file tab's real inline editor, save it, and
// assert both halves of the story's own promise - the read-back panel (D6) and the actual bytes on
// disk (D4/D5's whole point: "Save writes exactly this text to the file on disk", `RawFileTab.tsx`).
// Mirrors `scripts/flows/settings-section-rename-add-cvar.mjs`'s shape (real testids/roles, a `shot`
// per meaningful state, assertions on real DOM/disk state, not just a screenshot).
//
// Selectors, not guesses:
//   nav-config              TitleBar.tsx
//   config-profile-row      ConfigView.tsx
//   config-tab-raw          ConfigView.tsx (`{ id: 'raw', label: t('config.tabs.raw') }`)
//   .cfg-code-textarea      ConfigCodeView.tsx - the editable code view's real `<textarea>` (story
//                           057 D1), overlaid on the tokenised `<pre>`
//   config-save-summary     ProfileSaveBar.tsx - shows `config.save.rawEdited` ("File text edited
//                           — Save writes exactly this text to the file on disk.") while a raw
//                           draft is active (story 057 D5)
//   config-save             ProfileSaveBar.tsx - the same Save button the structured flow uses;
//                           while a raw draft is active its `onClick` calls `rawDraft.save()`
//                           instead of `handleSave()` (story 057 D5) - one button, two save paths
//   config-raw-save-result  RawFileTab.tsx - the inline read-back panel a raw save's result renders
//                           into (story 057 D6), holding the preserved-line count and any
//                           dropped-alias warning
//
// Unlike `ui:shot`/`ui:a11y`/`ui:verify`, `ui:flow` never reseeds the fixture before launching
// (`scripts/flow.mjs`'s `withApp()` opens `.ui-verify/fixture/populated/userdata` as-is), so a run
// really does append its typed line to whatever the *previous* run left on disk. A per-run suffix
// (same idiom `settings-section-rename-add-cvar.mjs` uses) keeps the flow re-runnable without a
// reseed: the new line is always distinct from anything an earlier run appended, so this run's own
// disk assertion can never accidentally pass against stale content.
//
// One precondition this flow cannot self-heal, though: `rawEditingMode` (`lib/raw-draft.tsx`)
// only allows typing while Plain Profile's *structured* changes are clean (`!profile.dirty`) - a
// real, persisted field, not something a reload clears. Running `npm run ui:verify`'s full
// registry immediately before this flow, with no reseed in between, leaves Plain Profile
// server-dirty (`config-save-expanded`/`config-discard-confirm`/`config-conflict-dialog` in
// `scripts/lib/screens.mjs` each dirty it and never save it), which locks the raw editor out from
// under this flow with no dialog or error to explain why - it just waits out
// `RAW_TAB_LOAD_TIMEOUT_MS` for a textarea that will never come. Run `npm run ui:seed` first if
// the fixture's last known state came from a `ui:verify` run.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000
/** The Raw file tab's own `getRawFiles` fetch (real IPC, reads the profile's canonical file plus
 * every assigned installation's copy off disk) has been observed taking noticeably longer than
 * `TIMEOUT_MS` to settle - mirrors `RAW_TAB_LOAD_TIMEOUT_MS` in `scripts/lib/screens.mjs`. */
const RAW_TAB_LOAD_TIMEOUT_MS = 20_000

/** Mirrors `scripts/lib/screens.mjs`'s `PLAIN_PROFILE_FILE_NAME` - `resolveProfileFileNames`
 * (`@shared/config/profile-files.ts`) sanitizes "Plain Profile"'s space to `-`, so the on-disk name
 * is `Plain-Profile.cfg`, not `Plain Profile.cfg`. */
const PLAIN_PROFILE_FILE_NAME = 'Plain-Profile.cfg'

const RUN_SUFFIX = Date.now().toString(36)
const TYPED_LINE = `// q2l_flow_raw_edit_${RUN_SUFFIX}`

export default async function rawInlineEdit({ page, shot, step }) {
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

  step('type a line at the end of the editor')
  await textarea.click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Control+End')
  await page.keyboard.type(`\n${TYPED_LINE}`)

  step('assert the save bar reports the raw draft ("file text edited")')
  await page
    .getByTestId('config-save-summary')
    .filter({ hasText: 'File text edited' })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('draft-typed')

  step('save (the save bar\'s Save button - same path Ctrl+S in the editor calls, rawDraft.save())')
  await page.getByTestId('config-save').click({ timeout: TIMEOUT_MS })

  step('assert the read-back result panel appears')
  const resultPanel = page.getByTestId('config-raw-save-result')
  await resultPanel.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const resultText = await resultPanel.innerText()
  if (!/line/i.test(resultText)) {
    throw new Error(
      `read-back panel did not mention preserved-line info - got: ${JSON.stringify(resultText)}`,
    )
  }

  await shot('saved')

  step('assert the profile\'s canonical file on disk now contains the typed line')
  const canonicalPath = join(variantUserDataDir('populated'), PLAIN_PROFILE_FILE_NAME)
  const onDisk = readFileSync(canonicalPath, 'latin1')
  if (!onDisk.includes(TYPED_LINE)) {
    throw new Error(
      `expected ${canonicalPath} to contain ${JSON.stringify(TYPED_LINE)} after saving, it did not`,
    )
  }
}
