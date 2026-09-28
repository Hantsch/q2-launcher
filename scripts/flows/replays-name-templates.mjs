// Story 140 (docs/requirements/140-i-teach-the-browser-a-name-pattern.md) D3 acceptance flow: the
// naming-pattern list a user actually edits in Settings, mirroring
// `scripts/flows/servers-master-sources.mjs`'s structure (open Settings, drive the list, read
// `state.json` off disk to prove persistence) and its keyboard-reorder idiom (a real pointer drag
// would only exercise dnd-kit's own, already-tested pointer path - the grip is a real button
// carrying dnd-kit's `attributes`/`listeners`, and `SortableZone` already wires a `KeyboardSensor`).
//
// Selectors - read `src/renderer/src/modules/replays/NameTemplatesList.tsx` before changing any of
// these:
//   nav-settings                        TitleBar.tsx
//   settings-section-replays            SettingsView.tsx - the shell's own Panel wrapper
//   replays-name-templates               NameTemplatesList.tsx - wraps the SortableList
//   replays-name-template-<index>        NameTemplatesList.tsx - one row, in rendered order
//   replays-name-template-input          NameTemplatesList.tsx - the add field
//   replays-name-template-error          NameTemplatesList.tsx - the add field's reason slot
//   replays-name-template-add            NameTemplatesList.tsx - the add submit button
//   replays-name-template-edit-input-<i> NameTemplatesList.tsx - a row's inline edit field
//   replays-name-template-remove-<i>     NameTemplatesList.tsx
//   replays-name-templates-restore       NameTemplatesList.tsx - only rendered once canRestore
//
// `ui:flow` never reseeds between runs (every flow in this directory says so) - this flow runs
// against the default fixture variant (a fresh profile's `replays.nameTemplates` is empty, so the
// list resolves to just the four shipped patterns, in `SHIPPED_NAME_PATTERNS`' own order) and undoes
// every edit it makes before it returns, so a second run without `npm run ui:seed` still finds the
// same starting point AC1's own assertion checks.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors `SHIPPED_NAME_PATTERNS` (`src/shared/replays/name-patterns.ts`) - the four shipped
 * patterns, in their defined order, with the exact stable ids that file documents as never-random. */
const SHIPPED_IDS = ['opentdm', 'aq2tng-mvd2', 'r1q2-autorecord', 'q2pro-beginmapcmd']

const NEW_TEMPLATE = '{date}_{map}_{p1}_vs_{p2}'

function listContainer(page) {
  return page.getByTestId('replays-name-templates')
}

function rowsLocator(page) {
  return listContainer(page).locator('[data-testid^="replays-name-template-"]')
}

async function rowIds(page) {
  const testIds = await rowsLocator(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-testid')),
  )
  // `[data-testid^="replays-name-template-"]` also matches the add field's own
  // `replays-name-template-input`/`-error`/`-add` testids - filter down to the numbered rows.
  return testIds.filter((id) => /^replays-name-template-\d+$/.test(id))
}

async function waitForRowCount(page, count) {
  await page.waitForFunction(
    (expected) =>
      Array.from(
        document.querySelectorAll('[data-testid="replays-name-templates"] [data-testid^="replays-name-template-"]'),
      ).filter((el) => /^replays-name-template-\d+$/.test(el.getAttribute('data-testid'))).length === expected,
    count,
    { timeout: TIMEOUT_MS },
  )
}

function rowLocator(page, index) {
  return page.getByTestId(`replays-name-template-${index}`)
}

function gripFor(page, index) {
  return rowLocator(page, index).getByRole('button', { name: 'Drag to reorder' }).first()
}

/** One picked-up/moved/dropped keyboard cycle - the "Space picks up, ArrowDown moves, Space drops"
 * pattern `servers-master-sources.mjs` establishes for a plain `SortableList`. */
async function keyboardReorder(page, grip, arrowKey, steps) {
  await grip.focus()
  await grip.press('Space')
  await page.waitForTimeout(150)
  for (let i = 0; i < steps; i += 1) {
    await grip.press(arrowKey)
    await page.waitForTimeout(150)
  }
  await grip.press('Space')
  await page.waitForTimeout(300)
}

function readStateJson(userDataDir) {
  return JSON.parse(readFileSync(join(userDataDir, 'state.json'), 'utf8'))
}

async function openReplaysSettings(page) {
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  const section = page.getByTestId('settings-section-replays')
  await section.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await listContainer(page).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

export default async function replaysNameTemplates({ page, shot, step, variant }) {
  const userDataDir = variantUserDataDir(variant)

  step('open Settings and reach the replays naming-pattern list')
  await openReplaysSettings(page)

  step('a fresh profile shows the shipped patterns, in their default order')
  await waitForRowCount(page, SHIPPED_IDS.length)
  await shot('replays-name-templates-default')

  step('an invalid pattern shows its reason and Add stays disabled')
  const input = page.getByTestId('replays-name-template-input')
  const addButton = page.getByTestId('replays-name-template-add')
  await input.fill('{map', { timeout: TIMEOUT_MS })
  const error = page.getByTestId('replays-name-template-error')
  await error.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await addButton.isDisabled())) {
    throw new Error('expected Add to stay disabled while the pattern is invalid')
  }

  step('a valid pattern can be added and lands as the last row')
  await input.fill(NEW_TEMPLATE, { timeout: TIMEOUT_MS })
  await error.waitFor({ state: 'hidden', timeout: TIMEOUT_MS }).catch(() => {})
  if (await addButton.isDisabled()) {
    throw new Error('expected Add to be enabled once the pattern is valid')
  }
  await addButton.click({ timeout: TIMEOUT_MS })
  await waitForRowCount(page, SHIPPED_IDS.length + 1)
  const newIndex = SHIPPED_IDS.length
  const addedRow = rowLocator(page, newIndex)
  await addedRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await addedRow.innerText()).includes(NEW_TEMPLATE)) {
    throw new Error(`expected the newly added row to show ${NEW_TEMPLATE}`)
  }

  step('dragging it to the top makes it the first row')
  await keyboardReorder(page, gripFor(page, newIndex), 'ArrowUp', newIndex)
  const firstRow = rowLocator(page, 0)
  await page.waitForFunction(
    (expected) => document.querySelector('[data-testid="replays-name-template-0"]')?.innerText.includes(expected),
    NEW_TEMPLATE,
    { timeout: TIMEOUT_MS },
  )
  if (!(await firstRow.innerText()).includes(NEW_TEMPLATE)) {
    throw new Error('expected the added pattern to be the first row after the reorder')
  }

  step('editing it changes its text')
  const editedTemplate = '{date}_{map}_{p1}'
  await rowLocator(page, 0)
    .getByRole('button', { name: 'Edit' })
    .click({ timeout: TIMEOUT_MS })
  const editInput = page.getByTestId('replays-name-template-edit-input-0')
  await editInput.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await editInput.fill(editedTemplate, { timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Save' }).click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (expected) => document.querySelector('[data-testid="replays-name-template-0"]')?.innerText.includes(expected),
    editedTemplate,
    { timeout: TIMEOUT_MS },
  )

  step('removing a shipped entry makes Restore appear')
  const restore = page.getByTestId('replays-name-templates-restore')
  if (await restore.isVisible()) {
    throw new Error('expected Restore to be hidden before any shipped pattern is removed')
  }
  // The shipped rows now sit at indices 1..4 (index 0 is the edited, formerly-added row) - remove
  // the one at index 1.
  await rowLocator(page, 1).getByRole('button', { name: 'Remove' }).click({ timeout: TIMEOUT_MS })
  await waitForRowCount(page, SHIPPED_IDS.length)
  await restore.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('replays-name-templates-edited')

  step('the persisted state matches the edited order, the override and the tombstone')
  const onDisk = readStateJson(userDataDir)
  const nameTemplates = onDisk.replays?.nameTemplates
  if (!nameTemplates || !Array.isArray(nameTemplates.entries)) {
    throw new Error(`expected state.json's replays.nameTemplates.entries, got ${JSON.stringify(nameTemplates)}`)
  }
  const first = nameTemplates.entries[0]
  if (first?.kind !== 'user' || first.template !== editedTemplate) {
    throw new Error(`expected the first stored entry to be the edited user entry, got ${JSON.stringify(first)}`)
  }
  if (nameTemplates.entries.length !== SHIPPED_IDS.length) {
    throw new Error(
      `expected ${SHIPPED_IDS.length} stored entries (the edited one plus the 3 remaining shipped patterns), got ${nameTemplates.entries.length}`,
    )
  }
  if (!Array.isArray(nameTemplates.removedShippedIds) || nameTemplates.removedShippedIds.length !== 1) {
    throw new Error(`expected exactly one tombstoned shipped id, got ${JSON.stringify(nameTemplates.removedShippedIds)}`)
  }

  step('restore the removed shipped pattern and revert the edit so a second run starts unchanged')
  await restore.click({ timeout: TIMEOUT_MS })
  await waitForRowCount(page, SHIPPED_IDS.length + 1)
  await restore.waitFor({ state: 'hidden', timeout: TIMEOUT_MS }).catch(() => {})

  await rowLocator(page, 0).getByRole('button', { name: 'Remove' }).click({ timeout: TIMEOUT_MS })
  await waitForRowCount(page, SHIPPED_IDS.length)
  const finalIds = await rowIds(page)
  if (finalIds.length !== SHIPPED_IDS.length) {
    throw new Error(`expected the revert to leave exactly the ${SHIPPED_IDS.length} shipped patterns, got ${finalIds.length}`)
  }

  // Every mutation persists the *full* merged state (shipped patterns included, explicitly, as
  // unedited entries) - not the fresh-profile's empty `entries: []` - so "reverted" here means the
  // 4 shipped patterns, each unedited, and no tombstone, not a literally empty array.
  const finalOnDisk = readStateJson(userDataDir)
  const finalNameTemplates = finalOnDisk.replays?.nameTemplates
  const stillTombstoned = finalNameTemplates?.removedShippedIds ?? []
  const remainingEntries = finalNameTemplates?.entries ?? []
  const anyEdited = remainingEntries.some((entry) => entry.kind !== 'shipped' || entry.template !== null)
  if (
    !finalNameTemplates ||
    remainingEntries.length !== SHIPPED_IDS.length ||
    stillTombstoned.length !== 0 ||
    anyEdited
  ) {
    throw new Error(
      `expected the revert to leave only the ${SHIPPED_IDS.length} unedited shipped patterns and no tombstone, got ${JSON.stringify(finalNameTemplates)}`,
    )
  }
}
