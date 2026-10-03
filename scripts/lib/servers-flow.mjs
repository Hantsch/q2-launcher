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
