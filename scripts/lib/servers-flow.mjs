// Page-side helpers shared by the `servers-*` flows (scripts/flows/): the scan-status element
// (`servers-scan-status`, `data-running`/`data-finished-at`) and server-row counting.

export const DEFAULT_ROW_SELECTOR = '[role="button"][data-testid^="servers-row-"]'

export function scanStatusLocator(page, testId = 'servers-scan-status') {
  return page.getByTestId(testId)
}

export async function readFinishedAt(page, testId) {
  return (await scanStatusLocator(page, testId).getAttribute('data-finished-at')) ?? ''
}

// No default timeout: a caller that passes none gets Playwright's own default, as before.
export async function waitForFinishedAtChange(
  page,
  previous,
  timeout,
  testId = 'servers-scan-status',
) {
  await page.waitForFunction(
    ({ before, id }) => {
      const el = document.querySelector(`[data-testid="${id}"]`)
      return (
        el?.getAttribute('data-running') === 'false' &&
        (el?.getAttribute('data-finished-at') ?? '') !== before &&
        (el?.getAttribute('data-finished-at') ?? '') !== ''
      )
    },
    { before: previous, id: testId },
    { timeout },
  )
}

/** Waits until `selector` matches at least `count` elements (exactly `count` with `exact`). */
export async function waitForRowCount(
  page,
  count,
  { selector = DEFAULT_ROW_SELECTOR, exact = false, timeout = 8_000 } = {},
) {
  await page.waitForFunction(
    ({ sel, expected, strict }) => {
      const n = document.querySelectorAll(sel).length
      return strict ? n === expected : n >= expected
    },
    { sel: selector, expected: count, strict: exact },
    { timeout },
  )
}

/** The MultiSelect root: the nearest ancestor of the trigger that also holds its status region. */
export const multiRoot = (page, testId) =>
  page.getByTestId(testId).locator('xpath=ancestor::div[.//*[@role="status"]][1]')

const multiPanel = (page, testId) => multiRoot(page, testId).getByRole('listbox')

async function openMulti(page, testId) {
  const trigger = page.getByTestId(testId)
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await multiPanel(page, testId).waitFor({ state: 'visible', timeout: 8_000 })
}

async function closeMulti(page, testId) {
  await page.keyboard.press('Escape')
  await multiPanel(page, testId).waitFor({ state: 'detached', timeout: 8_000 })
}

/** Reads the checked option texts of a MultiSelect (`aria-selected="true"`), leaving it closed. */
export async function readMultiFilter(page, testId) {
  await openMulti(page, testId)
  const checked = await page
    .getByTestId(`${testId}-option`)
    .evaluateAll((els) =>
      els
        .filter((el) => el.getAttribute('aria-selected') === 'true')
        .map((el) => (el.textContent ?? '').trim()),
    )
  await closeMulti(page, testId)
  return checked
}

/** Sets a MultiSelect to exactly `values` by clicking its options by text, leaving it closed. */
export async function setMultiFilter(page, testId, values) {
  await openMulti(page, testId)
  const options = page.getByTestId(`${testId}-option`)
  const texts = (await options.allTextContents()).map((x) => x.trim())
  for (const [i, text] of texts.entries()) {
    const option = options.nth(i)
    const on = (await option.getAttribute('aria-selected')) === 'true'
    if (on !== values.includes(text)) await option.click()
  }
  await closeMulti(page, testId)
}
