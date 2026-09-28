// Story 151 D4 acceptance flow: proves the Demos view's loading strip shows real, non-zero numbers
// while a scan is running (AC "the loading state says how many demos it has found so far"), and
// that the strip disappears - without an app reload - once the scan settles into the populated
// list. `replays-list-loading`'s fixture (`scripts/lib/fixture.mjs`'s
// `writeReplaysListLoadingFixture()`) seeds the plain `populated` demo set plus a harness-only scan
// hold, so this flow has a real window to make its first assertion before the scan finishes on its
// own.
//
// Selectors - read `src/renderer/src/modules/replays/ReplaysListStatus.tsx` and
// `src/renderer/src/modules/replays/ReplaysView.tsx` before changing any of these:
//   nav-replays            TitleBar.tsx - primary nav entry
//   replays-list-loading   ReplaysListStatus.tsx - the loading strip, carries `data-scanned`/
//                          `data-total`
//   replays-demo-list      ReplaysView.tsx - the demo rows' list container
//   replays-demo-row       DemoRow.tsx - one row per discovered demo

import { REPLAYS_FIXTURE_DEMOS, writeReplaysListLoadingFixture } from '../lib/fixture.mjs'

export const variant = 'replays-list-loading'

const TIMEOUT_MS = 8_000
/** Long enough for a fresh profile switch/re-render... - mirrors this file's own scan-hold value,
 * see `setup()` below. Left generous (hold + 8s) so the incremental scan itself has room to finish
 * on a slow machine too. */
const HOLD_MS = 3_000
const SETTLE_TIMEOUT_MS = HOLD_MS + 8_000

export async function setup() {
  writeReplaysListLoadingFixture({ holdMs: HOLD_MS })
  return {}
}

export default async function replaysListLoading({ page, shot, step }) {
  step('mark the page so a later check can prove nothing reloaded')
  await page.evaluate(() => {
    window.__q2lFlowMarker = 'replays-list-loading'
  })

  step('opening the Demos view shows the loading strip with real, non-zero counts')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })

  const loading = page.getByTestId('replays-list-loading')
  await loading.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  // The strip is visible from mount (`ReplaysView`'s `scanning` starts `true`), before the first
  // real `scan.progress` push has landed - so `data-total` can still read `0` right after
  // `waitFor('visible')`. Poll until a source has actually reported the fixture's total before
  // reading it as the assertion value.
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="replays-list-loading"]')?.getAttribute('data-total') ===
      String(expected),
    REPLAYS_FIXTURE_DEMOS.length,
    { timeout: TIMEOUT_MS },
  )

  const total = await loading.getAttribute('data-total')
  if (Number(total) !== REPLAYS_FIXTURE_DEMOS.length) {
    throw new Error(
      `replays-list-loading: expected data-total="${REPLAYS_FIXTURE_DEMOS.length}", got "${total}"`,
    )
  }

  const scanned = await loading.getAttribute('data-scanned')
  const text = await loading.innerText()
  if (!text.includes(String(scanned)) || !text.includes(String(total))) {
    throw new Error(
      `replays-list-loading: expected the loading text to mention both "${scanned}" and "${total}", got ${JSON.stringify(text)}`,
    )
  }
  await shot('replays-list-loading')

  step('once the scan settles, the loading strip is gone and every demo is listed - no reload')
  const list = page.getByTestId('replays-demo-list')
  await list.waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS })
  await page
    .getByTestId('replays-demo-row')
    .nth(REPLAYS_FIXTURE_DEMOS.length - 1)
    .waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS })
  const rowCount = await page.getByTestId('replays-demo-row').count()
  if (rowCount !== REPLAYS_FIXTURE_DEMOS.length) {
    throw new Error(
      `replays-list-loading: expected exactly ${REPLAYS_FIXTURE_DEMOS.length} demo rows once settled, got ${rowCount}`,
    )
  }
  await loading.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  const marker = await page.evaluate(() => window.__q2lFlowMarker)
  if (marker !== 'replays-list-loading') {
    throw new Error(
      `replays-list-loading: expected the page marker to survive (no reload), got ${JSON.stringify(marker)}`,
    )
  }

  await shot('replays-list-settled')
}
