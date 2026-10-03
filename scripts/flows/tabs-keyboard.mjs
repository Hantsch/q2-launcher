// Tab strips are manual-activation: arrow keys only move focus, Enter selects. Opens Plain Profile,
// focuses the Overview tab, ArrowRight then Enter, and asserts the Settings tab is selected,
// focused and the only tab in the tab order (roving tabindex).
export default async function tabsKeyboard({ page, shot, step }) {
  step('open Config > Plain Profile')
  await page.getByTestId('nav-config').click()
  await page.getByTestId('config-profile-row').filter({ hasText: 'Plain Profile' }).first().click()
  const overview = page.getByTestId('config-tab-overview')
  await overview.waitFor({ timeout: 8000 })

  step('focus the Overview tab, ArrowRight moves focus without selecting')
  await overview.focus()
  await page.keyboard.press('ArrowRight')
  const settings = page.getByTestId('config-tab-settings')
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('data-testid') === 'config-tab-settings',
    undefined,
    { timeout: 4000 },
  )
  if ((await settings.getAttribute('aria-selected')) !== 'false') {
    throw new Error('ArrowRight selected the tab; activation must wait for Enter')
  }

  step('Enter selects the focused tab')
  await page.keyboard.press('Enter')
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="config-tab-settings"]')
        ?.getAttribute('aria-selected') === 'true',
    undefined,
    { timeout: 4000 },
  )
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))
  if (focused !== 'config-tab-settings')
    throw new Error(`focus is on ${focused}, expected config-tab-settings`)

  const stops = await page.evaluate(
    () =>
      document.querySelectorAll('[data-testid="config-tab-strip"] [role="tab"][tabindex="0"]')
        .length,
  )
  if (stops !== 1) throw new Error(`expected exactly one tab with tabindex=0, found ${stops}`)
  await shot('tabs-keyboard')
}
