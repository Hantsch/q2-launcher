// A name dialog submits once: Enter pressed twice back to back creates exactly one section and
// closes the dialog. Launch against the populated fixture; `ui:flow` never reseeds it, so the name
// carries a per-run suffix to stay unique across runs.
const RUN_SUFFIX = Date.now().toString(36)
const SECTION_NAME = `Enter Once Section ${RUN_SUFFIX}`

export default async function nameDialogEnterOnce({ page, shot, step }) {
  step('open Config > Plain Profile > Settings')
  await page.getByTestId('nav-config').click()
  await page.getByTestId('config-profile-row').filter({ hasText: 'Plain Profile' }).first().click()
  await page.getByTestId('config-tab-settings').click()
  await page.getByText('Fixture Section', { exact: true }).waitFor({ timeout: 8000 })

  step('open the create-section dialog and check the name input has focus')
  await page.getByRole('button', { name: 'New section', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const input = dialog.getByLabel('Name', { exact: true })
  await input.waitFor({ timeout: 8000 })
  await page.waitForFunction(
    () => document.activeElement?.closest('[role="dialog"]') !== null &&
      document.activeElement?.tagName === 'INPUT',
    undefined,
    { timeout: 4000 },
  )

  step('type the name and press Enter twice without waiting')
  await input.fill(SECTION_NAME)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')

  step('assert the dialog closed and exactly one section carries the name')
  await dialog.waitFor({ state: 'detached', timeout: 8000 })
  const header = page.getByText(SECTION_NAME, { exact: true })
  await header.first().waitFor({ timeout: 8000 })
  const count = await header.count()
  if (count !== 1) throw new Error(`expected exactly 1 section named '${SECTION_NAME}', found ${count}`)
  await shot('section-created-once')
}
