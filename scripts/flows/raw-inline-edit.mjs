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
//   config-tab-unsaved      ConfigView.tsx - the Unsaved tab, in the strip only while something is
//                           unsaved, which a raw draft raises just like a structured edit; its
//                           content (`config-save-summary`, UnsavedChangesTab.tsx)
//                           names the raw draft with `config.save.rawEdited` ("File text edited —
//                           Save writes exactly this text to the file on disk.")
//   config-save             ProfileSaveActions.tsx - the same Save button the structured flow uses,
//                           now in the detail header's right-hand cluster; while a raw draft is
//                           active its `onClick` calls `rawDraft.save()` instead of `handleSave()`
//                           (story 057 D5) - one button, two save paths
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

  step('assert the draft raises the Unsaved tab, and that the tab names it')
  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('draft-typed')

  // Story 069 D-13 regression coverage (editable branch): no e2e assertions existed anywhere for
  // this branch's own Ctrl+F/focus behaviour before this fix, even though the "Ctrl+F is a no-op
  // once the bar is already open" bug is destructive here specifically - a second Ctrl+F that fails
  // to refocus the find input leaves keystrokes landing in the textarea itself, corrupting the
  // config text. Mirrors the read-only branch's own already-open assertion in
  // `config-header-geometry.mjs`, against the editable find bar instead.
  step('press Ctrl+F in the editable raw editor and assert the find bar opens, focused (D-13)')
  await textarea.click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Control+f')
  const editSearchBar = page.locator('.cfg-code-search')
  await editSearchBar.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const editSearchInput = editSearchBar.locator('input')
  const editInputFocusedOnFirstOpen = await editSearchInput.evaluate(
    (el) => el === document.activeElement,
  )
  if (!editInputFocusedOnFirstOpen) {
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '(none)')
    throw new Error(
      `Ctrl+F opened the editable find bar but did not focus its input - document.activeElement ` +
        `is <${activeTag}> instead`,
    )
  }

  step(
    'click into the textarea to move focus off the input without closing the bar, then press ' +
      'Ctrl+F again (already-open regression)',
  )
  // The bar is still open and focused in its input from the previous step. Clicking the textarea
  // moves focus onto it without pressing Escape, so the bar stays mounted - exactly the
  // "already open" state the regression needs: `setIsFindOpen(true)` is then a no-op state update,
  // so the `isFindOpen`-keyed focus effect never re-runs on its own. Before the fix, the next
  // keystrokes landed in the textarea instead of the (still unfocused) find input, mutating the
  // config text.
  await textarea.click({ timeout: TIMEOUT_MS })
  const focusedOnTextareaAfterClick = await textarea.evaluate((el) => el === document.activeElement)
  if (!focusedOnTextareaAfterClick) {
    throw new Error(
      'clicking the textarea did not move focus onto it - cannot exercise the already-open ' +
        'regression',
    )
  }
  await page.keyboard.press('Control+f')
  const editInputFocusedOnSecondOpen = await editSearchInput.evaluate(
    (el) => el === document.activeElement,
  )
  if (!editInputFocusedOnSecondOpen) {
    throw new Error(
      'a second Ctrl+F while the editable find bar was already open (focus moved to the textarea) ' +
        'did not refocus its input - this is the already-open no-op regression',
    )
  }

  step(
    'type while the find input is focused and assert it lands in the find input, not the textarea',
  )
  const textareaValueBeforeFind = await textarea.inputValue()
  await page.keyboard.type('sensitivity')
  const textareaValueAfterFind = await textarea.inputValue()
  if (textareaValueAfterFind !== textareaValueBeforeFind) {
    throw new Error(
      'typing while the find input was focused changed the textarea value - keystrokes leaked ' +
        `into the config text (before=${JSON.stringify(textareaValueBeforeFind)} ` +
        `after=${JSON.stringify(textareaValueAfterFind)})`,
    )
  }
  const editSearchInputValue = await editSearchInput.inputValue()
  if (editSearchInputValue !== 'sensitivity') {
    throw new Error(
      `typed text did not land in the editable find input - got ${JSON.stringify(editSearchInputValue)}`,
    )
  }

  step('close the editable find bar before continuing')
  await page.keyboard.press('Escape')
  await editSearchBar.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  console.log(
    'editable find bar: opens focused on Ctrl+F, refocuses its input on a second Ctrl+F after ' +
      'focus moved to the textarea, and typing while it is focused never reaches the textarea',
  )

  // The draft lives in `RawDraftProvider` at detail level, not in the tab, so leaving the raw tab
  // and coming back keeps the typed text (`RawFileTab`'s editor seeds from `rawDraft.text`) - which
  // is what makes this round trip a real assertion rather than a risk to the save below.
  await page.getByTestId('config-tab-unsaved').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('config-save-summary')
    .filter({ hasText: 'File text edited' })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('config-tab-raw').click({ timeout: TIMEOUT_MS })

  step("save (the header's Save button - same path Ctrl+S in the editor calls, rawDraft.save())")
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

  step("assert the profile's canonical file on disk now contains the typed line")
  const canonicalPath = join(variantUserDataDir('populated'), PLAIN_PROFILE_FILE_NAME)
  const onDisk = readFileSync(canonicalPath, 'latin1')
  if (!onDisk.includes(TYPED_LINE)) {
    throw new Error(
      `expected ${canonicalPath} to contain ${JSON.stringify(TYPED_LINE)} after saving, it did not`,
    )
  }
}
