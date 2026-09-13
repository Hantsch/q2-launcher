// Story 028 D1 acceptance flow: create a custom action ("test") in the
// Controls tab and assert its five CRUD icon buttons sit fully inside the
// row's Options cell — the screenshot alone is not sufficient evidence, the
// original bug wrapped buttons out of the 40px row (see the story's test plan).
export default async function customActionRow({ page, shot, step }) {
  step('open Config > Plain Profile > Controls')
  await page.getByTestId('nav-config').click()
  await page.getByTestId('config-profile-row').filter({ hasText: 'Plain Profile' }).first().click()
  await page.getByTestId('config-tab-controls').click()

  step('add custom action "test"')
  await page.getByRole('button', { name: 'Add action' }).click()
  // Story 052 review (finding 2): the Name field is located by its label, not by being the
  // dialog's first text input - D9's catalogue-suggestion filter now sits above it, so a
  // positional `.first()` filled the filter and left "Create action" permanently disabled.
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('test')
  await page.getByRole('button', { name: 'Create action' }).click()

  step('locate the test row')
  const row = page.locator('.ctrl-row', { hasText: 'test' }).first()
  await row.waitFor({ timeout: 8000 })
  await row.scrollIntoViewIfNeeded()

  step('assert all 5 icon buttons sit inside the Options cell and the row')
  const report = await row.evaluate((rowEl) => {
    const opts = rowEl.querySelector('.ctrl-opts')
    if (!opts) return { error: 'no .ctrl-opts in row' }
    const optsRect = opts.getBoundingClientRect()
    const rowRect = rowEl.getBoundingClientRect()
    const buttons = [...opts.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect()
      return {
        label: b.getAttribute('aria-label') ?? '?',
        insideOpts:
          r.left >= optsRect.left - 0.5 &&
          r.right <= optsRect.right + 0.5 &&
          r.top >= optsRect.top - 0.5 &&
          r.bottom <= optsRect.bottom + 0.5,
        insideRow: r.top >= rowRect.top - 0.5 && r.bottom <= rowRect.bottom + 0.5,
        visible: r.width > 0 && r.height > 0,
      }
    })
    return { buttons }
  })
  if (report.error) throw new Error(report.error)
  if (report.buttons.length !== 5) {
    throw new Error(`expected 5 icon buttons in the Options cell, found ${report.buttons.length}`)
  }
  const broken = report.buttons.filter((b) => !(b.insideOpts && b.insideRow && b.visible))
  if (broken.length > 0) {
    throw new Error(`buttons clipped or outside the row: ${JSON.stringify(broken)}`)
  }

  step('screenshot row')
  await row.screenshot({ path: '.ui-verify/screenshots/flows/custom-action-row.png' })
  await shot('controls-tab')
}
