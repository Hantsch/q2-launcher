// Story 053 D8 acceptance flow: create a new sub-category from the Controls tab's Weapons
// category (D6's "New sub-category" dialog) and move an existing entry into it (D7's
// ActionEditor sub-category select) - the two live interactions the story's own acceptance
// criterion names ("a `ui:flow` creates one and moves an entry into it through the real UI").
// Mirrors scripts/flows/custom-action-row.mjs's shape: launch against the populated fixture,
// drive real testids/roles, assert on real DOM state rather than trusting a screenshot alone.
//
// Unlike `ui:shot`/`ui:a11y`/`ui:verify`, `ui:flow` never reseeds the fixture before launching
// (`scripts/flow.mjs`'s `withApp()` just opens the existing `.ui-verify/fixture/populated/userdata`
// as-is) - so a name reused across two runs in a row would find a *previous* run's already-
// populated sub-category still on disk instead of a fresh, empty one. A per-run suffix keeps this
// flow idempotent regardless of what an earlier run left behind.
const SUBCATEGORY_NAME = `Ambush Loadout ${Date.now().toString(36)}`

export default async function controlsSubcategory({ page, shot, step }) {
  step('open Config > Plain Profile > Controls')
  await page.getByTestId('nav-config').click()
  await page.getByTestId('config-profile-row').filter({ hasText: 'Plain Profile' }).first().click()
  await page.getByTestId('config-tab-controls').click()

  step('select the Weapons category')
  // No testid/role on the rail's category chips (plain `<button>`s, text is the category's own
  // display name) - same convention `scripts/lib/screens.mjs`'s `config-controls-message`/
  // `config-controls-drop-message` entries already use.
  await page.getByRole('button', { name: 'Weapons' }).click()

  step('create a new sub-category')
  await page.getByRole('button', { name: 'New sub-category' }).click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(SUBCATEGORY_NAME)
  await page.getByRole('button', { name: 'Create sub-category' }).click()

  step('assert the new sub-category has its own (empty) group header')
  const group = page.locator('.ctrl-group', { hasText: SUBCATEGORY_NAME })
  await group.waitFor({ timeout: 8000 })
  const emptyCount = await group.locator('.ctrl-group-eyebrow').last().innerText()
  if (!/\b0\b/.test(emptyCount)) {
    throw new Error(`expected the freshly created sub-category to start empty, count read "${emptyCount}"`)
  }
  await shot('subcategory-created')

  step('open "Weapon Combo" (a pre-existing Weapons entry) for editing')
  const row = page.locator('.ctrl-row', { hasText: 'Weapon Combo' }).first()
  await row.waitFor({ timeout: 8000 })
  await row.getByTestId('action-edit-fixture-action-weapons').click()

  step('move it into the new sub-category')
  await page.getByRole('dialog').getByLabel('Sub-category', { exact: true }).selectOption({ label: SUBCATEGORY_NAME })
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()

  step('assert "Weapon Combo" now renders under the new sub-category group')
  // The group header (`.ctrl-group`) and its rows are siblings inside the same `role="rowgroup"`
  // container (`ControlsGrid.tsx`), not nested under the header - locate that shared container
  // rather than relying on DOM-order siblings of the header span itself.
  const rowGroupContainer = page.locator('[role="rowgroup"]', {
    has: page.locator('.ctrl-group', { hasText: SUBCATEGORY_NAME }),
  })
  const movedRow = rowGroupContainer.locator('.ctrl-row', { hasText: 'Weapon Combo' })
  await movedRow.waitFor({ timeout: 8000 })

  step('assert the group count updated from 0 to 1')
  const updatedCount = await group.locator('.ctrl-group-eyebrow').last().innerText()
  if (!/\b1\b/.test(updatedCount)) {
    throw new Error(`expected the sub-category's count to read 1 after the move, count read "${updatedCount}"`)
  }

  // Scroll the header into view first: it sits above the row in DOM order, and `shot()`
  // screenshots the current viewport, not the whole scrollable grid - without this the group
  // header the run just proved can end up scrolled out of frame while the row is in view.
  await group.scrollIntoViewIfNeeded()
  await shot('entry-moved')
}
