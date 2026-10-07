// A new alias is filed under the profile's first category, so it is visible in the Controls rail
// right after creation. Seeds a custom first category through the real config IPC, creates an alias
// in the Aliases tab and looks for its row in Controls under that category.
const CLICK_TIMEOUT_MS = 8_000
const CATEGORY = { id: 'flow-first-cat', name: 'Flow First' }

export default async function aliasNewLandsInFirstCategory({ page, shot, step }) {
  step('seed a custom first category on Plain Profile')
  await page.getByTestId('nav-config').click({ timeout: CLICK_TIMEOUT_MS })
  const seeded = await page.evaluate(async (category) => {
    const call = (type, payload) =>
      window.q2.invoke('module:invoke', { moduleId: 'config', type, payload })
    const list = await call('list')
    const profile = list.value.find((p) => p.name === 'Plain Profile')
    const others = (profile.categories ?? []).filter((c) => c.id !== category.id)
    const result = await call('setActions', {
      profileId: profile.id,
      categories: [category, ...others],
      actions: profile.actions ?? [],
    })
    return result.ok
  }, CATEGORY)
  if (!seeded) throw new Error('seeding the custom category was refused')

  step('open Config > Plain Profile > Aliases')
  await page.getByTestId('config-profile-row').filter({ hasText: 'Plain Profile' }).first().click({
    timeout: CLICK_TIMEOUT_MS,
  })
  await page.getByTestId('config-tab-aliases').click({ timeout: CLICK_TIMEOUT_MS })

  step('create alias "Lands Here"')
  await page.getByRole('button', { name: 'New alias' }).click({ timeout: CLICK_TIMEOUT_MS })
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Lands Here')
  await page.getByRole('button', { name: 'Create alias' }).click({ timeout: CLICK_TIMEOUT_MS })
  // Creation opens the body editor as a modal; close it before leaving the tab.
  const editor = page.getByRole('dialog').filter({ hasText: 'Lands Here' })
  await editor.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await page.keyboard.press('Escape')
  await editor.waitFor({ state: 'hidden', timeout: CLICK_TIMEOUT_MS })
  await page.getByTestId('config-tab-controls').click({ timeout: CLICK_TIMEOUT_MS })

  step('the row is visible in Controls under the seeded category')
  // The first category is the one Controls opens on.
  await page
    .locator('.ctrl-row', { hasText: 'Lands Here' })
    .first()
    .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await shot('new-alias-in-first-category')
}
