// Story 052 D10 acceptance flow: renames and reorders a former built-in category through the
// real UI, mirroring the story's own manual Test Plan step 3 ("rename 'Weapon dropping' to
// 'Drops', move it above 'Weapons', Save"). Runs against the `populated` fixture's Plain Profile
// (`scripts/flow.mjs` always launches that fixture) - its "Weapon dropping" category is not
// hand-authored in `scripts/lib/fixture.mjs` at all; it is materialised at runtime by the real
// story 052 D6 migration (see that file's D10 comment block), so this flow also stands as live
// evidence that a migrated former built-in is an ordinary, rename/reorder-able category like any
// other (AC2).
//
// Selectors, not guesses:
//   nav-config              TitleBar.tsx
//   config-profile-row      ConfigView.tsx
//   config-tab-controls     ConfigView.tsx
//   role=button "Weapon dropping"/"Weapons"/"Drops"   category chips in the rail
//                           (ControlsTab.tsx, `categoryDisplayName()`; no testid, see the rail's
//                           own comment on why a full ARIA tabs pattern does not fit)
//   role=button "Rename…"/"Move category up"          IconButtons next to a category chip
//                           (ControlsTab.tsx, `t('config.controls.rename')`/
//                           `t('config.controls.categoryMoveUp')`)
//   role=dialog             RenameCategoryDialog (ControlsTab.tsx), via `components/ui/Modal.tsx`

const TIMEOUT_MS = 8_000
const OLD_NAME = 'Weapon dropping'
const NEW_NAME = 'Drops'

/** The category chip's own container: the category button plus its rename/delete/move icon
 * buttons are rendered as siblings under one `<div>` (ControlsTab.tsx's rail), with no shared
 * testid to scope by - walking up from the category button by one level is the stable handle. */
function categoryChip(page, name) {
  return page.getByRole('button', { name, exact: true }).locator('xpath=..')
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
  await page.getByRole('button', { name: 'Movement', exact: true }).waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
  await page.getByRole('button', { name: 'Weapons', exact: true }).waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
  await page.getByRole('button', { name: OLD_NAME, exact: true }).waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })

  await shot('before')

  step('open the "Weapon dropping" category\'s rename dialog')
  await categoryChip(page, OLD_NAME)
    .getByRole('button', { name: 'Rename…' })
    .click({ timeout: TIMEOUT_MS })

  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('type the new name and save')
  const nameInput = dialog.locator('input').first()
  await nameInput.fill(NEW_NAME, { timeout: TIMEOUT_MS })
  await dialog.getByRole('button', { name: 'Save' }).click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('assert the category now shows the new name')
  await page.getByRole('button', { name: NEW_NAME, exact: true }).waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
  const oldNameGone = await page
    .getByRole('button', { name: OLD_NAME, exact: true })
    .isVisible()
    .catch(() => false)
  if (oldNameGone) {
    throw new Error(`category chip still shows the old name "${OLD_NAME}" after rename`)
  }

  await shot('renamed')

  step('move the renamed category up, above "Weapons"')
  await categoryChip(page, NEW_NAME)
    .getByRole('button', { name: 'Move category up' })
    .click({ timeout: TIMEOUT_MS })

  step('assert the rail order is now Movement, Drops, Weapons')
  const expectedOrder = ['Movement', NEW_NAME, 'Weapons']
  try {
    await page.waitForFunction(
      (expected) => {
        const rail = document.querySelector('.ctrl-category-rail')
        if (!rail) return false
        const labels = [...rail.querySelectorAll(':scope > div')]
          .map((chip) => chip.querySelector('button')?.textContent?.trim())
          .filter(Boolean)
        return JSON.stringify(labels) === JSON.stringify(expected)
      },
      expectedOrder,
      { timeout: TIMEOUT_MS },
    )
  } catch {
    const chipOrder = await page.evaluate(() => {
      const rail = document.querySelector('.ctrl-category-rail')
      if (!rail) return []
      return [...rail.querySelectorAll(':scope > div')]
        .map((chip) => chip.querySelector('button')?.textContent?.trim())
        .filter(Boolean)
    })
    throw new Error(
      `expected category rail order ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(chipOrder)}`,
    )
  }

  await shot('reordered')
}
