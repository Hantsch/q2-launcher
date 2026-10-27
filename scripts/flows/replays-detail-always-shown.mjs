// Demo detail pane acceptance flow: the pane sits beside the list from the first paint, empty
// until a demo is chosen, and neither selecting, deselecting nor filtering moves the list's width.
// Runs against the `replays-rows` fixture variant (`scripts/lib/fixture.mjs`'s
// `writeReplaysRowsFixture()`), so this flow needs no `setup()`/`teardown()` of its own.
//
// Selectors - read `ReplaysView.tsx` and `DemoDetailPanel.tsx` before changing:
//   replays-list-pane          ReplaysView.tsx - the list column
//   replays-detail-pane        ReplaysView.tsx - the pane beside it, always rendered
//   replays-detail-empty       ReplaysView.tsx - the empty state inside the pane
//   replays-detail             DemoDetailPanel.tsx - the panel, only while one demo is selected
//   replays-detail-input-name  DemoDetailPanel.tsx - the name field
//   replays-detail-close       absent - the pane has no close button
//   replays-demo-scroll        VirtualDemoList.tsx - the focusable list container
//   replays-filter-search      DemoListFilterBar.tsx - the free-text filter

import { openDemosRoot, rowFor } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000
/** The tdm fixture demo's display name, as its row and the pane's name field show it. */
const DEMO_NAME = 'Fixture TDM Match'

export const variant = 'replays-rows'

export default async function replaysDetailAlwaysShown({ page, shot, step }) {
  const pane = page.getByTestId('replays-detail-pane')
  const empty = page.getByTestId('replays-detail-empty')
  const list = page.getByTestId('replays-list-pane')

  const listWidth = async () => (await list.boundingBox()).width
  const expectEmptyPane = async () => {
    await pane.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await empty.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await pane.getByTestId('replays-detail').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  }
  const expectSameWidth = async (label, expected) => {
    const width = await listWidth()
    if (Math.abs(width - expected) > 1) {
      throw new Error(
        `replays-detail-always-shown: ${label} moved the list width from ${expected}px to ${width}px`,
      )
    }
  }

  step('the pane is beside the list and empty before any demo is chosen')
  await openDemosRoot(page)
  await expectEmptyPane()
  const width = await listWidth()
  await shot('replays-detail-empty')

  step('selecting a demo fills the pane without moving the list')
  await rowFor(page, DEMO_NAME).click({ timeout: TIMEOUT_MS })
  const detail = pane.getByTestId('replays-detail')
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const name = await detail.getByTestId('replays-detail-input-name').inputValue()
  if (!name.includes(DEMO_NAME)) {
    throw new Error(
      `replays-detail-always-shown: the pane should show "${DEMO_NAME}", got "${name}"`,
    )
  }
  await empty.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  const closeButtons = await detail.getByTestId('replays-detail-close').count()
  if (closeButtons !== 0) {
    throw new Error(
      `replays-detail-always-shown: the pane should have no close button, found ${closeButtons}`,
    )
  }
  await expectSameWidth('selecting a demo', width)

  step('Escape in the list returns the pane to its empty state')
  await page.getByTestId('replays-demo-scroll').press('Escape')
  await expectEmptyPane()
  await expectSameWidth('Escape', width)

  step('filtering the selected demo out empties the pane without moving the list')
  await rowFor(page, DEMO_NAME).click({ timeout: TIMEOUT_MS })
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const search = page.getByTestId('replays-filter-search')
  await search.fill('no-demo-is-named-like-this')
  await expectEmptyPane()
  await expectSameWidth('a non-matching filter', width)

  // The filter is persisted after a debounce: leave it empty for the flows that follow.
  await search.fill('')
  await page.waitForTimeout(600)
}
