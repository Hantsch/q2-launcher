// Story 152 (docs/requirements/152-favourites-first-then-newest.md) D3: the demos list's sortable
// header + persistence's e2e proof on the real Demos surface. Mirrors
// `scripts/flows/servers-sort-order.mjs`'s structure (`waitForStateJson`/`statePath` polling, the
// reload-keeps-the-choice check, the third-click-clears-back-to-default check) and
// `scripts/flows/replays-demo-rows.mjs`'s `waitForDemosScanToFinish` helper.
//
// Fixture (`scripts/lib/fixture.mjs`'s `writeReplaysSortOrderFixture()`): four copies of
// `docs/fixtures/demos/test.dm2`, each paired with a sidecar overriding `favourite`/`map`/`date`:
//   sort-fav-newer.dm2      favourite, map q2dm2,  date 2026-01-10 (newer favourite)
//   sort-fav-older.dm2      favourite, map q2dm10, date 2026-01-05 (older favourite)
//   sort-nonfav-newest.dm2  not favourite, map q2dm5, date 2026-01-20 (newest of all four)
//   sort-nonfav-oldest.dm2  not favourite, map q2dm1, date 2026-01-01 (oldest of all four)
//
// The default order therefore groups the two favourites first (newest of the two first), then the
// two non-favourites newest-first - and AC5 ("a column sort never re-pins favourites") is provable
// because sort-nonfav-newest's map (q2dm5) sits alphabetically/numerically BETWEEN the two
// favourites' maps (q2dm2, q2dm10), so a map sort only groups it there if favourites are not pinned.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import {
  REPLAYS_SORT_ORDER_FAV_NEWER_SIDECAR_MAP,
  REPLAYS_SORT_ORDER_FAV_OLDER_SIDECAR_MAP,
  REPLAYS_SORT_ORDER_NONFAV_NEWEST_SIDECAR_MAP,
  REPLAYS_SORT_ORDER_NONFAV_OLDEST_SIDECAR_MAP,
  REPLAYS_SORT_ORDER_VARIANT,
  writeReplaysSortOrderFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
const STATE_WRITE_POLL_TIMEOUT_MS = 4_000
const STATE_WRITE_POLL_INTERVAL_MS = 100

export const variant = REPLAYS_SORT_ORDER_VARIANT

// Story 074 D8's `setup()` hook: reseeds this flow's own fixture right before the app launches -
// mirrors `servers-sort-order.mjs`'s `setup()` (there it seeds via `writePopulatedFixture`, here
// via this variant's own dedicated writer since there is no live network fixture to bind first).
export async function setup() {
  writeReplaysSortOrderFixture()
  return {}
}

function statePath() {
  return join(variantUserDataDir(variant), 'state.json')
}

function readStateJson() {
  return JSON.parse(readFileSync(statePath(), 'utf8'))
}

/** Polls `state.json` until `predicate` is satisfied or the timeout elapses - a sort click updates
 * the DOM optimistically (`ReplaysView.tsx`'s `handleSort`) before the `list.setSort` IPC round
 * trip that actually writes the file resolves, so a single immediate read can race the write. */
async function waitForStateJson(predicate, label) {
  const deadline = Date.now() + STATE_WRITE_POLL_TIMEOUT_MS
  let last
  for (;;) {
    last = readStateJson()
    if (predicate(last)) return last
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${label}, last state.json replays: ${JSON.stringify(last.replays)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, STATE_WRITE_POLL_INTERVAL_MS))
  }
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

/** Reads the DOM order of every mounted `replays-demo-row`, as the `map` value each one shows -
 * the fixture's four maps are distinct and known, so this is a stable stand-in for "which fixture
 * row is this" without depending on the row's content-derived id (opaque/unpredictable) or its
 * effective name (unset here - no sidecar `name` field). */
async function rowOrder(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="replays-demo-row"]')).map((row) =>
      row.querySelector('[data-testid="replays-demo-map"]')?.textContent?.trim() ?? null,
    ),
  )
}

async function waitForRowCount(page, count) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-testid="replays-demo-row"]').length >= expected,
    count,
    { timeout: TIMEOUT_MS },
  )
}

function assertOrder(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${label} order ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function clickSort(page, column) {
  await page.getByTestId(`replays-sort-${column}`).click({ timeout: TIMEOUT_MS })
}

async function waitForPressed(page, column, pressed) {
  await page.waitForFunction(
    ({ column, pressed }) =>
      document.querySelector(`[data-testid="replays-sort-${column}"]`)?.getAttribute('aria-pressed') ===
      String(pressed),
    { column, pressed },
    { timeout: TIMEOUT_MS },
  )
}

export default async function replaysSortOrder({ page, step, shot }) {
  step('navigate to Demos and wait for the scan to settle')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  await waitForRowCount(page, 4)

  step('the default order groups favourites first (newest of the two first), then newest-first')
  const defaultOrder = await rowOrder(page)
  assertOrder(
    defaultOrder,
    [
      REPLAYS_SORT_ORDER_FAV_NEWER_SIDECAR_MAP,
      REPLAYS_SORT_ORDER_FAV_OLDER_SIDECAR_MAP,
      REPLAYS_SORT_ORDER_NONFAV_NEWEST_SIDECAR_MAP,
      REPLAYS_SORT_ORDER_NONFAV_OLDEST_SIDECAR_MAP,
    ],
    'the default',
  )
  const currentDefault = await page.getByTestId('replays-sort-current').textContent()
  if (currentDefault !== 'Favourites first, then newest') {
    throw new Error(`expected the default sort-current text, got "${currentDefault}"`)
  }
  await shot('default-order')

  step('clicking the map column sorts ascending across all rows - favourites are not re-pinned')
  await clickSort(page, 'map')
  await waitForPressed(page, 'map', true)
  const ascOrder = await rowOrder(page)
  assertOrder(
    ascOrder,
    [
      REPLAYS_SORT_ORDER_NONFAV_OLDEST_SIDECAR_MAP,
      REPLAYS_SORT_ORDER_FAV_NEWER_SIDECAR_MAP,
      REPLAYS_SORT_ORDER_NONFAV_NEWEST_SIDECAR_MAP,
      REPLAYS_SORT_ORDER_FAV_OLDER_SIDECAR_MAP,
    ],
    'map ascending',
  )
  // AC5: the newest non-favourite (nonfav-newest, q2dm5) sits between the two favourites' maps,
  // not held under them - proof a column sort never re-pins favourites.
  const newestNonFavIndex = ascOrder.indexOf(REPLAYS_SORT_ORDER_NONFAV_NEWEST_SIDECAR_MAP)
  const favIndices = [
    ascOrder.indexOf(REPLAYS_SORT_ORDER_FAV_NEWER_SIDECAR_MAP),
    ascOrder.indexOf(REPLAYS_SORT_ORDER_FAV_OLDER_SIDECAR_MAP),
  ]
  if (!(newestNonFavIndex > Math.min(...favIndices) && newestNonFavIndex < Math.max(...favIndices))) {
    throw new Error('expected the newest non-favourite to sit between the two favourites under a map sort')
  }
  await shot('map-ascending')

  step('clicking the map column again reverses to descending')
  await clickSort(page, 'map')
  await waitForStateJson(
    (state) => state.replays?.listSort?.column === 'map' && state.replays?.listSort?.direction === 'desc',
    'state.json to persist map/desc',
  )
  const descOrder = await rowOrder(page)
  assertOrder(descOrder, [...ascOrder].reverse(), 'map descending')
  await shot('map-descending')

  step('clicking the date column twice proves both directions of a second column')
  await clickSort(page, 'date')
  await waitForPressed(page, 'date', true)
  const dateDescOrder = await rowOrder(page)
  assertOrder(
    dateDescOrder,
    [
      REPLAYS_SORT_ORDER_NONFAV_NEWEST_SIDECAR_MAP,
      REPLAYS_SORT_ORDER_FAV_NEWER_SIDECAR_MAP,
      REPLAYS_SORT_ORDER_FAV_OLDER_SIDECAR_MAP,
      REPLAYS_SORT_ORDER_NONFAV_OLDEST_SIDECAR_MAP,
    ],
    'date descending',
  )
  await clickSort(page, 'date')
  await waitForStateJson(
    (state) => state.replays?.listSort?.column === 'date' && state.replays?.listSort?.direction === 'asc',
    'state.json to persist date/asc',
  )
  const dateAscOrder = await rowOrder(page)
  assertOrder(dateAscOrder, [...dateDescOrder].reverse(), 'date ascending')
  await shot('date-both-directions')

  step('a third click on date resets to default, then two clicks on map sets map/desc again')
  await clickSort(page, 'date')
  await waitForStateJson((state) => !('listSort' in (state.replays ?? {})), 'state.json to drop replays.listSort')
  await clickSort(page, 'map')
  await clickSort(page, 'map')
  await waitForStateJson(
    (state) => state.replays?.listSort?.column === 'map' && state.replays?.listSort?.direction === 'desc',
    'state.json to persist map/desc again',
  )
  const mapDescAgain = await rowOrder(page)
  assertOrder(mapDescAgain, descOrder, 'map descending (again, before reload)')

  step('reloading the page keeps the map/descending order and the pressed state')
  await page.reload()
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  await waitForRowCount(page, 4)
  await waitForPressed(page, 'map', true)
  const afterReloadOrder = await rowOrder(page)
  assertOrder(afterReloadOrder, descOrder, 'map descending after a page reload')
  const persisted = readStateJson()
  const persistedSort = persisted.replays?.listSort
  if (persistedSort?.column !== 'map' || persistedSort?.direction !== 'desc') {
    throw new Error(`expected state.json's replays.listSort to be map/desc, got ${JSON.stringify(persistedSort)}`)
  }
  await shot('after-reload')

  step('a third click on the map column clears the sort back to the default order')
  await clickSort(page, 'map')
  await waitForPressed(page, 'map', false)
  const clearedOrder = await rowOrder(page)
  assertOrder(clearedOrder, defaultOrder, 'the default (after clearing the sort)')
  await waitForStateJson((state) => !('listSort' in (state.replays ?? {})), 'state.json to drop replays.listSort')
  await shot('cleared-back-to-default')

  console.log(
    'replays-sort-order: the default order groups favourites first then newest-first, a column ' +
      'click cycles asc -> desc -> default without ever re-pinning favourites, the choice survives ' +
      'a full reload, is persisted in state.json, and clearing it removes the persisted key',
  )
}
