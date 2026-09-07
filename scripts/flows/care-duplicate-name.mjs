// Bug-fix acceptance flow (2026-09-07): a duplicate alias name is ONE Care row, its colliding
// entries are named in an expandable detail block, and each side can be resolved from Care itself.
//
// The populated fixture's "Plain Profile" carries the collision out of the box: the standard drops
// catalogue every profile is migrated onto (story 052 D6) contains both `dropWeapon:grenades` and
// `dropAmmo:hgrenades`, and both render the command `drop grenades`, so both derive the alias name
// `drop_grenades` (`care-fix-item.mjs`'s own header already notes this pre-existing row).
//
// Selectors, not guesses:
//   nav-config, config-profile-row, config-tab-care     ConfigView.tsx / TitleBar.tsx
//   config.care.item.tidy.title.duplicateAlias          CareItemRow.tsx, via lib/care-items.ts
//   config.care.action.showDetails ("Show details")      CareItemRow.tsx's disclosure
//   config.care.tidyUp.action.deleteEntry / .rename      CareItemRow.tsx's CareDetailRow
const TIMEOUT_MS = 8_000

export default async function careDuplicateName({ page, shot, step }) {
  step('open config module')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })

  step('select Plain Profile')
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })

  step('open Care')
  await page.getByTestId('config-tab-care').click({ timeout: TIMEOUT_MS })

  step('assert the collision is reported exactly once')
  const rows = page.locator('li').filter({ hasText: 'write the same alias name' })
  await rows.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const count = await rows.count()
  if (count !== 1) {
    throw new Error(`expected exactly one duplicate-name row, got ${count}`)
  }
  const row = rows.first()
  console.log(`row: ${JSON.stringify(await row.innerText())}`)
  await shot('row-collapsed')

  step('expand the details')
  await row.getByRole('button', { name: 'Show details' }).click({ timeout: TIMEOUT_MS })
  const details = row.locator('ul > li')
  await details.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  console.log(`details: ${JSON.stringify(await details.allInnerTexts())}`)
  await shot('details-expanded')

  step('resolve it from Care: delete one of the two colliding entries')
  await details.first().getByRole('button', { name: 'Delete entry' }).click({ timeout: TIMEOUT_MS })

  step('assert the row is gone')
  await rows.first().waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await shot('resolved')
}
