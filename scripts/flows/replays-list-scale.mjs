// Story 150+ D5 acceptance flow: proves the demos list actually virtualises on the built UI - with
// 3 000 demo files seeded (`scripts/lib/fixture.mjs`'s `replays-scale` variant), fewer than 100
// `replays-demo-row` elements ever sit in the DOM at once, and scrolling the list's own scroll
// container to the end reveals the very last seeded file. Mirrors
// `scripts/flows/replays-discovered-list.mjs`'s structure.
//
// Selectors - read `src/renderer/src/modules/replays/components/VirtualDemoList.tsx` before
// changing any of these:
//   nav-replays            TitleBar.tsx - primary nav entry
//   replays-demo-list       ReplaysView.tsx - the `<ul>` of discovered demos
//   replays-demo-scroll     VirtualDemoList.tsx - the list's own scrollable container
//   replays-demo-row        DemoRow.tsx - one row, `data-demo-id` carries its id
//   replays-demo-name       DemoRow.tsx - the row's file name text

import { REPLAYS_SCALE_LAST_FILE_NAME } from '../lib/fixture.mjs'
import { openDemosRoot, waitForDemosScanToFinish } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000
/** However many rows the virtualised list may ever mount at once - well above the actual window
 * (viewport height / row height + 2*overscan), generously below the 3 000 seeded files, so this
 * assertion proves virtualisation without being tied to the exact overscan math. */
const MAX_MOUNTED_ROWS = 100

export const variant = 'replays-scale'

export default async function replaysListScale({ page, shot, step }) {
  step('navigating to the Demos view renders the discovered list')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page, { timeout: TIMEOUT_MS * 4 })
  await openDemosRoot(page)

  step('fewer than 100 rows are mounted in the DOM at once')
  const mountedCount = await page.getByTestId('replays-demo-row').count()
  if (mountedCount >= MAX_MOUNTED_ROWS) {
    throw new Error(
      `replays-list-scale: expected fewer than ${MAX_MOUNTED_ROWS} mounted rows, got ${mountedCount}`,
    )
  }

  step('scrolling the list to the end reveals the last seeded demo')
  const scroll = page.getByTestId('replays-demo-scroll')
  await scroll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_SCALE_LAST_FILE_NAME })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await shot('replays-list-scale')
}
