// Story 244 AC1 acceptance flow: the demos list selects several demos - every row has a checkbox,
// Ctrl-click toggles one, Shift-click selects the range from the last plain/Ctrl-clicked row,
// Ctrl+A (focus in the list) selects every row of the view and Escape clears.
//
// Selectors - read `DemoRow.tsx`, `VirtualDemoList.tsx` and `ReplaysView.tsx` before changing:
//   replays-filter-search      DemoListFilterBar.tsx - narrows the list to this flow's demos
//   replays-demo-row           DemoRow.tsx - one row (data-demo-id)
//   replays-row-select         DemoRow.tsx - the row's checkbox
//   replays-demo-scroll        VirtualDemoList.tsx - the focusable list container
//   replays-multi-selection    ReplaysView.tsx - the pane shown while two or more are selected
//   replays-detail             DemoDetailPanel.tsx - shown only while exactly one is selected

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { INSTALL_ONE_ID, installationConfigFilePath } from '../lib/fixture.mjs'
import { openAllDemos, openFolder, poll } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000
const PLACEHOLDER_DEMO_BYTES = 'q2l-fixture-demo-placeholder\n'
const PREFIX = 'q2lms-'
const NAMES = ['a', 'b', 'c', 'd', 'e'].map((letter) => `${PREFIX}${letter}.dm2`)
const demoPath = (name) => installationConfigFilePath(INSTALL_ONE_ID, `demos/${name}`)

export async function setup() {
  mkdirSync(dirname(demoPath(NAMES[0])), { recursive: true })
  for (const name of NAMES) writeFileSync(demoPath(name), PLACEHOLDER_DEMO_BYTES)
  return {}
}

export async function teardown() {
  for (const name of NAMES) rmSync(demoPath(name), { force: true })
}

export default async function replaysMultiSelect({ page, shot, step }) {
  await openAllDemos(page)
  await openFolder(page, 'Fixture Favorite Install')
  await page.getByTestId('replays-filter-search').fill(PREFIX)

  const rows = page.getByTestId('replays-demo-row')
  await poll('the five demos to be listed', async () => (await rows.count()) === NAMES.length)

  /** The ids of the rows in list order, and which of them are checked. */
  const snapshot = () =>
    rows.evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute('data-demo-id'),
        checked: el.querySelector('[data-testid="replays-row-select"]').checked,
      })),
    )
  const checkedIds = async () =>
    (await snapshot()).filter((row) => row.checked).map((row) => row.id)
  const expectChecked = async (what, expected) => {
    await poll(
      what,
      async () => JSON.stringify(await checkedIds()) === JSON.stringify(expected),
      TIMEOUT_MS,
    )
  }

  step('every row has a checkbox')
  const boxes = await rows.evaluateAll(
    (els) => els.filter((el) => el.querySelector('[data-testid="replays-row-select"]')).length,
  )
  if (boxes !== NAMES.length) {
    throw new Error(`replays-multi-select: expected a checkbox on all ${NAMES.length} rows`)
  }
  const order = (await snapshot()).map((row) => row.id)

  step('Ctrl-click toggles a row into the selection')
  await rows.nth(0).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-detail').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await rows.nth(2).click({ modifiers: ['Control'], timeout: TIMEOUT_MS })
  await expectChecked('two rows to be checked', [order[0], order[2]])
  await page
    .getByTestId('replays-multi-selection')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-detail').waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  await rows.nth(0).click({ modifiers: ['Control'], timeout: TIMEOUT_MS })
  await expectChecked('Ctrl-click to uncheck the first row', [order[2]])
  await page.getByTestId('replays-detail').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('Shift-click selects the range from the last clicked row')
  await rows.nth(1).click({ timeout: TIMEOUT_MS })
  await expectChecked('a plain click to select just that row', [order[1]])
  await rows.nth(3).click({ modifiers: ['Shift'], timeout: TIMEOUT_MS })
  await expectChecked('the range of three rows', [order[1], order[2], order[3]])

  step('Ctrl+A selects every row and Escape clears')
  await page.getByTestId('replays-demo-scroll').focus()
  await page.keyboard.press('Control+A')
  await expectChecked('every row to be checked', order)
  await page.keyboard.press('Escape')
  await expectChecked('the selection to be cleared', [])

  step('Ctrl+A and Escape keep working while a row checkbox has focus')
  await rows.nth(1).getByTestId('replays-row-select').click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Control+A')
  await expectChecked('every row to be checked', order)
  await shot('replays-multi-select')

  await page.keyboard.press('Escape')
  await expectChecked('the selection to be cleared', [])
  await page
    .getByTestId('replays-multi-selection')
    .waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  // The filter is persisted after a debounce: leave it empty for the flows that follow.
  await page.getByTestId('replays-filter-search').fill('')
  await page.waitForTimeout(600)
}
