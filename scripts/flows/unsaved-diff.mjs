// Story 064 D3 acceptance flow: dirty three sections through the real UI (Raw tab's "Section
// header style" select for `settings`, a Settings-tab plain cvar for `cvars`, a Controls-row key
// for `actions`/`binds`) and read the Unsaved tab back - the surface D1 (shared diff model,
// `src/shared/config/profile-diff.ts`) and D2 (`ProfileChangeList.tsx`) already built, checked
// against real testids/DOM rather than a screenshot alone. Mirrors
// `scripts/flows/raw-inline-edit.mjs`'s shape (`shot`/`step`, real testids, real assertions, no
// mocked state) and reuses the Raw tab's idempotent "Section header style" setter the same way
// `scripts/lib/screens.mjs:409-424`'s `config-save-expanded` screen does.
//
// Unlike `ui:shot`/`ui:a11y`/`ui:verify`, `ui:flow` never reseeds the fixture before launching
// (`scripts/flow.mjs`'s `withApp()` opens `.ui-verify/fixture/populated/userdata` as-is), so this
// flow's own precondition note applies exactly as `raw-inline-edit.mjs`'s does: run
// `npm run ui:seed` first if the fixture's last known state came from a previous `ui:flow`/
// `ui:verify` run. Two of the three edits below (the key capture/clear, the raw-cvar value) are
// idempotent or reversible on a *fresh* fixture, but not against another run's leftovers - so a
// stale fixture is not just slower to reason about, it can silently make the "added"/"removed"
// bind rows this flow depends on disappear (e.g. if `y` is already bound from a previous run of
// this very flow, binding it again is a no-op `changed`-or-nothing, not `added`).
//
// Selectors, not guesses - read `ProfileChangeList.tsx`, `ActionEditor.tsx`, `CvarRow.tsx` and
// `ControlsTab.tsx`/`RawFileTab.tsx` before changing any of these:
//   nav-config                 TitleBar.tsx
//   config-profile-row         ConfigView.tsx
//   config-tab-raw/-settings/  ConfigView.tsx (`config-tab-${tab.id}`)
//   -controls/-unsaved
//   select (Raw tab)           RawFileTab.tsx - the one native <select>, "Section header style"
//                               (no `<label for>`/testid since story 057 D3 compacted it into a
//                               `HoverCard`-wrapped `<span>` - see `screens.mjs`'s own comment)
//   action-edit-<id>           ControlsTab.tsx - the per-row "Edit" icon button, opens `ActionEditor`
//   role=dialog                ActionEditor.tsx via `Modal` - the raw-command input
//                               (`config.controls.editor.rawCommandLabel`, "Add a raw command"),
//                               "Add" button, "Press a key…" capture button, "Clear" key button,
//                               "Save" footer button
//   config-save-changes        ProfileChangeList.tsx - the rendered change list
//   profile-change-detail-value ProfileChangeList.tsx's `DetailRow` - the bounded/scrollable
//                               before/after value blocks (`max-h-24 overflow-y-auto`)
//   config-tab-unsaved          ConfigView.tsx - only in the strip while something is unsaved; its
//                               `UnsavedTabBadge` (`components/UnsavedIndicator.tsx`) renders the
//                               same `changeSet.count` this flow checks the row count against
//
// Rows chosen from the populated fixture (`scripts/lib/fixture.mjs`):
//   - `fixture-action-keyless` ("Keyless Combo") has no key and no `binds` entry at all - binding
//     `y` (unused anywhere else in the fixture, same key `controls-extra-keys.mjs` relies on being
//     free) turns it into an `actions` `changed` row (a `keys` detail, added) and a `binds` `added`
//     row for `y` - AC2's "added" case, produced through the real UI rather than invented.
//   - `fixture-action-attack` ("Attack") starts bound to `MOUSE1` (`binds.MOUSE1: '+attack'`) -
//     clearing its key turns it into an `actions` `changed` row (a `keys` detail, removed) and a
//     `binds` `removed` row for `MOUSE1` - AC2's "removed" case, from the same section this story
//     names ("actions/binds").
//   - The same `fixture-action-keyless` edit also appends many raw commands to the entry's command
//     list, so its `commands` detail is long enough to exercise AC5's bounded/scrollable value
//     block for real, rather than needing a separate fixture change.
//   - `q2l_fixture_note` (`PlainCvarRow`, Settings tab's "Fixture Section") is the `cvars` edit -
//     a plain-text value, no engine facts/validation involved.
//   - The Raw tab's "Section header style" select, set to `brackets` (the fixture never sets
//     `sectionHeaderStyle`, so it defaults to `dashes` - `profile-diff.ts`'s own doc comment),
//     mirrors `screens.mjs`'s `config-save-expanded` setup exactly.

const CLICK_TIMEOUT_MS = 8_000
const RAW_TAB_LOAD_TIMEOUT_MS = 20_000

const RUN_SUFFIX = Date.now().toString(36)
const NOTE_VALUE = `flow-edited-note-${RUN_SUFFIX}`
const NEW_KEY = 'y'
// One genuinely long single command (stresses horizontal wrapping/overflow, AC5) plus a handful of
// short ones (stresses the block's vertical bound via `overflow-y-auto`, since `max-h-24` clips
// long before a handful of one-line commands would on their own). Kept modest (not dozens) because
// `configActionSchema` caps `commands` at 64 (`main/modules/config/schemas.ts`) and this flow is not
// reseeded between runs (see the file doc comment) - each run appends to whatever a previous run
// already saved, so a large per-run count would only survive a couple of reruns before tripping that
// cap and leaving the editor's Save silently rejected (observed while writing this flow).
const LONG_COMMAND = `say ${'flow test overflow guard '.repeat(12).trim()}`
const EXTRA_COMMANDS = [LONG_COMMAND, ...Array.from({ length: 7 }, (_, i) => `wait; echo step${i}`)]

async function openConfig(page) {
  await page.getByTestId('nav-config').click({ timeout: CLICK_TIMEOUT_MS })
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: CLICK_TIMEOUT_MS })
}

/** Opens `ActionEditor` for `rowId` via its real "Edit" icon button. */
async function openActionEditor(page, rowId) {
  const editButton = page.getByTestId(`action-edit-${rowId}`)
  await editButton.scrollIntoViewIfNeeded({ timeout: CLICK_TIMEOUT_MS })
  await editButton.click({ timeout: CLICK_TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
}

/** Saves and waits for the dialog to close - `ActionEditor`'s "Save" awaits the real IPC call
 * before `ControlsTab` clears `editingActionId` (see the file's own doc comment on
 * `handleSaveAction`), so the dialog closing is proof the change already reached the server. */
async function saveActionEditor(page) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click({ timeout: CLICK_TIMEOUT_MS })
  await dialog.waitFor({ state: 'hidden', timeout: CLICK_TIMEOUT_MS })
}

export default async function unsavedDiff({ page, shot, step }) {
  step('open Config > Plain Profile > Controls')
  await openConfig(page)
  await page.getByTestId('config-tab-controls').click({ timeout: CLICK_TIMEOUT_MS })

  step('select the Weapons category (fixture-action-keyless lives there)')
  // No testid/role on the rail's category chips (plain `<button>`s, text is the category's own
  // display name) - same convention `scripts/flows/controls-subcategory.mjs` already uses.
  await page.getByRole('button', { name: 'Weapons', exact: true }).click({ timeout: CLICK_TIMEOUT_MS })

  step('dirty actions/binds: bind the keyless action to an unused key, and give it a long body')
  await openActionEditor(page, 'fixture-action-keyless')
  {
    const dialog = page.getByRole('dialog')
    const rawCommandInput = dialog.getByLabel('Add a raw command', { exact: true })
    for (const command of EXTRA_COMMANDS) {
      await rawCommandInput.fill(command)
      await dialog.getByRole('button', { name: 'Add', exact: true }).click({ timeout: CLICK_TIMEOUT_MS })
    }
    await dialog.getByRole('button', { name: 'Press a key…', exact: true }).click({ timeout: CLICK_TIMEOUT_MS })
    await page.keyboard.press(NEW_KEY)
    // `resolveQuakeKeyName` (`lib/keyboard-layout.ts`) resolves a letter key to its lower-case
    // Quake spelling (`KeyY` -> `'y'`), which is exactly what `ActionEditor`'s key `Badge` prints -
    // matching `NEW_KEY` verbatim, not upper-cased.
    await dialog.getByText(NEW_KEY, { exact: true }).waitFor({ timeout: CLICK_TIMEOUT_MS })
  }
  await saveActionEditor(page)

  step('select the Movement category (fixture-action-attack lives there)')
  await page.getByRole('button', { name: 'Movement', exact: true }).click({ timeout: CLICK_TIMEOUT_MS })

  step('dirty actions/binds further: clear the attack action\'s primary key (a removal)')
  // Unlike `fixture-action-keyless` (a plain, free-form action with the full edit/rename/remove
  // Options cell), `fixture-action-attack` carries a `catalogId` (`movement:attack`) - a catalogue
  // row, which `ControlsTab.tsx` renders through its own catalogue path with a live `BindSlot`
  // capture, never the plain row's `action-edit-<id>` button (`ActionEditor` has no affordance for a
  // catalogue row at all). Cleared directly through the grid instead, the same technique
  // `scripts/flows/controls-extra-keys.mjs` uses (its own comment explains the `Delete` ->
  // `BindSlot.tsx`'s clear handler mapping) - `.ctrl-keycell .ctrl-slot` is always slot 0 first,
  // bound or not.
  const attackRow = page.locator('.ctrl-row[data-row-id="fixture-action-attack"]')
  await attackRow.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await attackRow.scrollIntoViewIfNeeded()
  await attackRow.locator('.ctrl-keycell .ctrl-slot').first().click({ timeout: CLICK_TIMEOUT_MS })
  await page.keyboard.press('Delete')
  // The row's own "unsaved" left-border/glyph confirms the write landed (`ControlsRow`'s `edited`
  // prop, fed by `changeSet.keys.actions` - the same real change set the Unsaved tab reads), rather
  // than racing straight into the tab switch below.
  await page
    .getByRole('img', { name: 'Unsaved change' })
    .first()
    .waitFor({ timeout: CLICK_TIMEOUT_MS })

  await shot('controls-dirtied')

  step('dirty cvars: edit the plain, non-catalogue fixture cvar')
  await page.getByTestId('config-tab-settings').click({ timeout: CLICK_TIMEOUT_MS })
  const noteRow = page
    .locator('div.border-l-2', { hasText: 'q2l_fixture_note' })
    .filter({ has: page.locator('input') })
    .first()
  await noteRow.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await noteRow.locator('input').fill(NOTE_VALUE)
  // `SettingsTab`'s value edits are debounced 500ms before the real IPC save fires - waiting for
  // the row's own "Unsaved change" glyph (the same non-colour AC10 marker `CvarRow`/`PlainCvarRow`
  // already render) is proof the change reached the server profile, not just this draft.
  await noteRow.getByRole('img', { name: 'Unsaved change' }).waitFor({ timeout: CLICK_TIMEOUT_MS })

  await shot('cvar-dirtied')

  step('dirty settings: change the Raw tab\'s "Section header style" (the idempotent setter)')
  await page.getByTestId('config-tab-raw').click({ timeout: CLICK_TIMEOUT_MS })
  await page.locator('select').selectOption('brackets', { timeout: RAW_TAB_LOAD_TIMEOUT_MS })

  step('open the Unsaved tab')
  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await page.getByTestId('config-tab-unsaved').click({ timeout: CLICK_TIMEOUT_MS })
  const changeList = page.getByTestId('config-save-changes')
  await changeList.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })

  await shot('unsaved-diff')

  // Top-level change rows only (direct grandchildren of the list through each section's own
  // `<ul>`) - excludes the nested per-field detail `<li>`s, which are one level deeper (inside a
  // second `<ul>` nested in the row's own `<li>`) and are not what the tab badge counts.
  const rowLocator = changeList.locator('> div > ul > li')

  step('the unsaved tab reads as a diff')
  const rowCount = await rowLocator.count()
  if (rowCount === 0) {
    throw new Error('expected config-save-changes to render at least one row, found none')
  }
  const rowReport = await rowLocator.evaluateAll((rows) =>
    rows.map((row) => {
      const text = row.textContent ?? ''
      // The header line: `<label> <kind badge> <before> → <after>` - both concrete sides render as
      // either a real value or the "unset"/"unbound" placeholder (never blank), so a row whose
      // header has no text at all past the label+badge would mean a missing side.
      const header = row.firstElementChild
      const headerText = header?.textContent ?? ''
      return { text, headerText, hasLabel: headerText.trim().length > 0 }
    }),
  )
  const missingLabel = rowReport.filter((row) => !row.hasLabel)
  if (missingLabel.length > 0) {
    throw new Error(`expected every row to have a label, found ${missingLabel.length} without one`)
  }
  // Every header must carry the "→" separator between a before and an after side (both concrete,
  // per AC1) - the placeholders ("unset"/"unbound") count as concrete text for the missing side of
  // an added/removed row, same as the story's own AC2 wording distinguishes.
  const missingArrow = rowReport.filter((row) => !row.headerText.includes('→'))
  if (missingArrow.length > 0) {
    throw new Error(
      `expected every row's header to show a before → after pair, found ${missingArrow.length} without the arrow: ${JSON.stringify(missingArrow)}`,
    )
  }

  step('no row renders a bare count or an unlabelled sentence (AC3)')
  const bareCount = rowReport.filter((row) => /^\d+$/.test(row.headerText.trim()))
  if (bareCount.length > 0) {
    throw new Error(`expected no row to be a bare count, found: ${JSON.stringify(bareCount)}`)
  }

  step('added and removed rows are marked in text')
  const addedRows = rowReport.filter((row) => row.text.includes('Added'))
  const removedRows = rowReport.filter((row) => row.text.includes('Removed'))
  if (addedRows.length === 0) {
    throw new Error('expected at least one row marked "Added" in text, found none')
  }
  if (removedRows.length === 0) {
    throw new Error('expected at least one row marked "Removed" in text, found none')
  }

  step('the badge count equals the number of rows')
  const badgeText = (await page.getByTestId('config-tab-unsaved').innerText()).trim()
  const badgeMatch = badgeText.match(/(\d+)\s*$/)
  if (!badgeMatch) {
    throw new Error(`expected the Unsaved tab's own text to end in a number, got ${JSON.stringify(badgeText)}`)
  }
  const badgeCount = Number(badgeMatch[1])
  if (badgeCount !== rowCount) {
    throw new Error(`expected the tab badge (${badgeCount}) to equal the rendered row count (${rowCount})`)
  }

  step('a long command body does not overflow the panel')
  const listGeometry = await changeList.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  if (listGeometry.scrollWidth > listGeometry.clientWidth) {
    throw new Error(
      `expected config-save-changes not to overflow horizontally, got scrollWidth ${listGeometry.scrollWidth} > clientWidth ${listGeometry.clientWidth}`,
    )
  }

  const detailValues = page.getByTestId('profile-change-detail-value')
  const detailCount = await detailValues.count()
  if (detailCount === 0) {
    throw new Error('expected at least one profile-change-detail-value block (the long command body)')
  }
  const detailGeometry = await detailValues.evaluateAll((blocks) =>
    blocks.map((block) => ({
      scrollWidth: block.scrollWidth,
      clientWidth: block.clientWidth,
      clientHeight: block.clientHeight,
    })),
  )
  // `max-h-24` is 6rem = 96px - a small tolerance covers sub-pixel rounding, never a real second
  // line's worth of slack.
  const MAX_BLOCK_HEIGHT_PX = 98
  const overflowing = detailGeometry.filter(
    (block) => block.scrollWidth > block.clientWidth || block.clientHeight > MAX_BLOCK_HEIGHT_PX,
  )
  if (overflowing.length > 0) {
    throw new Error(
      `expected every detail value block to stay within its bound, found overflow: ${JSON.stringify(overflowing)}`,
    )
  }

  await shot('unsaved-diff-verified')
}
