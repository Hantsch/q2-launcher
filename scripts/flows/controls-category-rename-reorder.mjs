// Story 052 D10 acceptance flow: renames and reorders a former built-in category through the
// real UI, mirroring the story's own manual Test Plan step 3 ("rename 'Weapon dropping' to
// 'Drops', move it above 'Weapons', Save"). Runs against the `populated` fixture's Plain Profile
// (`scripts/flow.mjs` always launches that fixture) - its "Weapon dropping" category is not
// hand-authored in `scripts/lib/fixture.mjs` at all; it is materialised at runtime by the real
// story 052 D6 migration (see that file's D10 comment block), so this flow also stands as live
// evidence that a migrated former built-in is an ordinary, rename/reorder-able category like any
// other (AC2).
//
// Story 062 D3 rewrite: the chip's rename/move-up/move-down icon buttons are gone (D1's
// `ControlsCategoryMenu` kebab replaces them, D2 flattens the chip to one visual level), and the
// old "first `<button>` inside the chip `<div>`" order walk is gone too - the chip container now
// carries `data-category-id`/`data-category-name` (D2, `ControlsDragZone.tsx`'s
// `CategoryDropTarget`) as the stable handle. This flow now:
//   - selects a chip by clicking its label button and asserts `data-selected="true"` plus the
//     grid header (`config.controls.actions.label`) following the selection (AC4);
//   - opens the per-chip kebab menu and renames through its "Rename…" item (AC3);
//   - reorders through the same menu's "Move up" item rather than drag-simulation - story 054's
//     own `controls-drag-reorder` flow (docs/UI-VERIFICATION.md) already covers pointer-drag
//     reordering, so this flow's job is proving the *menu* path works end to end (Decisions);
//   - reads chip order off `data-category-name` directly, not off any button's text content.
//
// Selectors, not guesses:
//   nav-config              TitleBar.tsx
//   config-profile-row      ConfigView.tsx
//   config-tab-controls     ConfigView.tsx
//   [data-category-name]    category chip container (ControlsDragZone.tsx's `CategoryDropTarget`,
//                           story 062 D2) - also carries `data-category-id` and, when selected,
//                           `data-selected="true"`
//   role=button "Weapon dropping"/"Weapons"/"Drops"   the chip's own ghost label button
//                           (ControlsTab.tsx, `categoryDisplayName()`; no testid, see the rail's
//                           own comment on why a full ARIA tabs pattern does not fit)
//   role=button "Actions for “<name>”"   the chip's kebab trigger
//                           (ControlsCategoryMenu.tsx, `t('config.controls.categoryMenuFor')`)
//   role=menu / role=menuitem "Move category up"/"Rename…"   the kebab's menu and its items
//                           (components/ui/Menu.tsx, ControlsCategoryMenu.tsx)
//   role=dialog             RenameCategoryDialog (ControlsTab.tsx), via `components/ui/Modal.tsx`

const TIMEOUT_MS = 8_000
const OLD_NAME = 'Weapon dropping'
const NEW_NAME = 'Drops'

/** The category chip's own container - story 062 D2's stable handle, replacing the old
 * "walk up from the label button" trick. */
function categoryChip(page, name) {
  return page.locator(`[data-category-name="${name}"]`)
}

/** The chip's kebab trigger, named via `config.controls.categoryMenuFor`
 * ("Actions for “{{name}}”" - en.json, curly quotes and all). */
function categoryMenuTrigger(page, name) {
  return categoryChip(page, name).getByRole('button', { name: `Actions for “${name}”` })
}

/** Reads the rail's chip order straight off `data-category-name`, not off any button's text -
 * the fragile part story 062 D3 replaces. */
async function chipOrder(page) {
  return page.evaluate(() => {
    const rail = document.querySelector('.ctrl-category-rail')
    if (!rail) return []
    return [...rail.querySelectorAll('[data-category-name]')].map(
      (chip) => chip.getAttribute('data-category-name'),
    )
  })
}

export default async function controlsCategoryRenameReorder({ page, shot, step }) {
  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })

  step('select Plain Profile')
  await page.getByTestId('config-profile-row').filter({ hasText: 'Plain Profile' }).first().click({
    timeout: TIMEOUT_MS,
  })

  step('open controls tab')
  await page.getByTestId('config-tab-controls').click({ timeout: TIMEOUT_MS })

  step('assert the former built-in categories are present, in their original order')
  await categoryChip(page, 'Movement').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await categoryChip(page, 'Weapons').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await categoryChip(page, OLD_NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('before')

  step('select the "Weapon dropping" chip and assert selection follows it')
  await categoryChip(page, OLD_NAME)
    .getByRole('button', { name: OLD_NAME, exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (name) => document.querySelector(`[data-category-name="${name}"]`)?.getAttribute('data-selected') === 'true',
    OLD_NAME,
    { timeout: TIMEOUT_MS },
  )
  await page
    .getByText(`Actions — ${OLD_NAME}`, { exact: true })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('hover the chip so its grip and kebab are visible, then open its action menu')
  await categoryChip(page, OLD_NAME).hover({ timeout: TIMEOUT_MS })
  await categoryMenuTrigger(page, OLD_NAME).click({ timeout: TIMEOUT_MS })

  const menu = page.getByRole('menu')
  await menu.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('rename through the menu\'s "Rename…" item')
  await menu.getByRole('menuitem', { name: 'Rename…' }).click({ timeout: TIMEOUT_MS })

  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('type the new name and save')
  const nameInput = dialog.locator('input').first()
  await nameInput.fill(NEW_NAME, { timeout: TIMEOUT_MS })
  await dialog.getByRole('button', { name: 'Save' }).click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('assert the chip now carries the new name, still selected')
  await categoryChip(page, NEW_NAME).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const oldChipGone = await categoryChip(page, OLD_NAME)
    .isVisible()
    .catch(() => false)
  if (oldChipGone) {
    throw new Error(`category chip still shows the old name "${OLD_NAME}" after rename`)
  }
  const stillSelected = await categoryChip(page, NEW_NAME).getAttribute('data-selected')
  if (stillSelected !== 'true') {
    throw new Error(`renamed chip lost its selection: data-selected="${stillSelected}"`)
  }

  await shot('renamed')

  step('open the renamed chip\'s menu and move it up, above "Weapons"')
  await categoryChip(page, NEW_NAME).hover({ timeout: TIMEOUT_MS })
  await categoryMenuTrigger(page, NEW_NAME).click({ timeout: TIMEOUT_MS })
  await menu.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await menu.getByRole('menuitem', { name: 'Move category up' }).click({ timeout: TIMEOUT_MS })

  step('assert the rail order is now Movement, Drops, Weapons')
  const expectedOrder = ['Movement', NEW_NAME, 'Weapons']
  try {
    await page.waitForFunction(
      (expected) => {
        const rail = document.querySelector('.ctrl-category-rail')
        if (!rail) return false
        const names = [...rail.querySelectorAll('[data-category-name]')].map((chip) =>
          chip.getAttribute('data-category-name'),
        )
        return JSON.stringify(names) === JSON.stringify(expected)
      },
      expectedOrder,
      { timeout: TIMEOUT_MS },
    )
  } catch {
    const order = await chipOrder(page)
    throw new Error(
      `expected category rail order ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(order)}`,
    )
  }

  await shot('reordered')
}
