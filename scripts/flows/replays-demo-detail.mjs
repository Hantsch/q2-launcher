// Story 155 D1 acceptance flow: proves the demo detail panel actually renders each field with its
// source as visible text on the real UI - not just in unit tests. Runs against the `replays-rows`
// fixture variant (`scripts/lib/fixture.mjs`'s `writeReplaysRowsFixture()`), the same fixture the
// `replays-detail` screen (`scripts/lib/screens.mjs`) and `replays-demo-rows.mjs` already use, so
// this flow needs no `setup()`/`teardown()` of its own.
//
// Selectors, not guesses - read `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`
// and `scripts/lib/fixture.mjs`'s `writeReplaysRowsFixture()` before changing any of these:
//   nav-replays                    TitleBar.tsx - primary nav entry
//   replays-demo-list              ReplaysView.tsx - the `<ul>` of discovered demos
//   replays-demo-row               DemoRow.tsx - one row
//   replays-detail                 DemoDetailPanel.tsx - the panel itself
//   replays-detail-field-<id>      DemoDetailPanel.tsx - one wrapper per rendered `DetailFieldId`
//   replays-detail-close           DemoDetailPanel.tsx - the panel's close IconButton
//   replays-refresh                ReplaysView.tsx - toggles back to "Refresh" once the scan settles

import {
  REPLAYS_ROWS_DUEL_DEMO,
  REPLAYS_ROWS_MVD_DEMO,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

/** Runs against the `replays-rows` fixture variant - mirrors `replays-demo-rows.mjs`'s own
 * `export const variant` convention. */
export const variant = 'replays-rows'

function rowFor(page, fileName) {
  return page.getByTestId('replays-demo-row').filter({ hasText: fileName })
}

/** Same reasoning as `replays-demo-rows.mjs`'s own helper: the first `index.read` on mount can
 * render a stale/empty snapshot before the scan this same mount triggers finishes and swaps the
 * whole list in - waiting for `replays-refresh` to re-enable is the real "settled" signal. */
async function waitForDemosScanToFinish(page) {
  const refreshButton = page.getByTestId('replays-refresh')
  await refreshButton.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await refreshButton.isDisabled())) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timed out waiting for replays-refresh to become enabled (scan finished)')
}

export default async function replaysDemoDetail({ page, shot, step }) {
  step('navigating to the Demos view renders the discovered list')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)

  step('a no-sidecar demo (mvd2) shows its map field sourced "from the demo"')
  const mvdRow = rowFor(page, REPLAYS_ROWS_MVD_DEMO)
  await mvdRow.click({ timeout: TIMEOUT_MS })
  const detail = page.getByTestId('replays-detail')
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const mapField = detail.getByTestId('replays-detail-field-map')
  await mapField.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const mapFieldText = await mapField.textContent()
  if (!mapFieldText.includes('from the demo')) {
    throw new Error(`replays-demo-detail: mvd map field expected "from the demo", got "${mapFieldText}"`)
  }

  step('the sidecar\'d row shows its reported name sourced "set by you"')
  const tdmRow = rowFor(page, 'Fixture TDM Match')
  await tdmRow.click({ timeout: TIMEOUT_MS })
  const nameField = detail.getByTestId('replays-detail-field-name')
  await nameField.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const nameFieldText = await nameField.textContent()
  if (!nameFieldText.includes('Fixture TDM Match') || !nameFieldText.includes('set by you')) {
    throw new Error(`replays-demo-detail: tdm name field expected the reported name + "set by you", got "${nameFieldText}"`)
  }

  step('the duel row (no sidecar date) shows its date field sourced "file time"')
  const duelRow = rowFor(page, REPLAYS_ROWS_DUEL_DEMO)
  await duelRow.click({ timeout: TIMEOUT_MS })
  const dateField = detail.getByTestId('replays-detail-field-date')
  await dateField.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const dateFieldText = await dateField.textContent()
  if (!dateFieldText.includes('file time')) {
    throw new Error(`replays-demo-detail: duel date field expected "file time", got "${dateFieldText}"`)
  }

  await shot('replays-demo-detail')

  step('closing the panel hides it')
  await detail.getByTestId('replays-detail-close').click({ timeout: TIMEOUT_MS })
  await detail.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
}
