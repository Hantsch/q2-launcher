// Story 153 (docs/requirements/153-i-search-and-filter-my-demos.md) D5: the demos list's
// filter/search rail's e2e proof on the real Demos surface. Mirrors `replays-sort-order.mjs`'s
// structure (`setup()`/`teardown()`, `waitForDemosScanToFinish`, `waitForStateJson`) and
// `replays-zip-entries.mjs`'s setup/teardown shape - copied, not imported.
//
// Fixture (`scripts/lib/fixture.mjs`'s `writeReplaysFilterFixture()`): four demos under one extra
// folder - a favourite (rated 9, mod/gamemode ctf, map q2ctf5, tags final+lan, sidecar player
// "Tom", sidecar name "CTF Grand Final"), a non-favourite (rated 5, tag fun, map q2dm4, a
// description containing "zephyrgrove"), an unrated demo with no sidecar at all (searchable only
// through its real header player "WallFly[BZZZ]"), and a name-fact demo whose file name itself
// ("Zephyr_vs_Rook_q2ctf5.mvd2") matches a fixture-registered user name template
// (`{p1}_vs_{p2}_{map}.mvd2`), searchable through its name-fact player "Zephyr" - its own sidecar
// pins its map to q2ctf5 too, so map+tag combos are deterministic regardless of the real demo
// bytes' own embedded map.
import { variantUserDataDir } from '../lib/harness.mjs'
import { readStateJson, waitForStateJson } from '../lib/state-json.mjs'
import {
  REPLAYS_FILTER_FAVOURITE_TAG,
  REPLAYS_FILTER_FUN_TAG,
  REPLAYS_FILTER_GAMEMODE_OPTIONS,
  REPLAYS_FILTER_HEADERONLY_DEMO,
  REPLAYS_FILTER_HEADER_PLAYER,
  REPLAYS_FILTER_MAP_OPTIONS,
  REPLAYS_FILTER_MOD_OPTIONS,
  REPLAYS_FILTER_NAMEFACT_DEMO,
  REPLAYS_FILTER_NAMEFACT_PLAYER,
  REPLAYS_FILTER_NONFAV_DEMO,
  REPLAYS_FILTER_SHARED_MAP,
  REPLAYS_FILTER_SIDECAR_NAME,
  REPLAYS_FILTER_SIDECAR_PLAYER,
  REPLAYS_FILTER_DESCRIPTION_WORD,
  REPLAYS_FILTER_VARIANT,
  removeReplaysFilterFixture,
  writeReplaysFilterFixture,
} from '../lib/fixture.mjs'
import { waitForDemosScanToFinish } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000
const POLL_INTERVAL_MS = 100

export const variant = REPLAYS_FILTER_VARIANT

// Story 074 D8's `setup()`/`teardown()` hooks: reseeds/removes this flow's own fixture right
// around the app's lifetime - mirrors `replays-sort-order.mjs`'s `setup()`, plus a `teardown()`
// since this fixture (unlike the sort-order one) ships a `remove*` counterpart.
export async function setup() {
  writeReplaysFilterFixture()
  return {}
}

export async function teardown() {
  removeReplaysFilterFixture()
}

/** Polls a predicate until it is true or the timeout elapses - used both for `state.json` writes
 * (a debounced/async persist can lag a UI change) and for the visible row set (a filter change is
 * a synchronous React state update, but Playwright's own event loop still needs a tick to see the
 * new DOM). */
async function waitForCondition(predicate, label, timeout = TIMEOUT_MS) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

/** The displayed name of every mounted `replays-demo-row` - a demo with a sidecar `name` shows
 * that; every other demo here falls back to its own file name, and all four are distinct strings,
 * so this is a stable stand-in for "which fixture row is this". */
async function visibleNames(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="replays-demo-row"]')).map(
      (row) => row.querySelector('[data-testid="replays-demo-name"]')?.textContent?.trim() ?? null,
    ),
  )
}

function assertVisibleSet(actual, expected, label) {
  const sortedActual = [...actual].sort()
  const sortedExpected = [...expected].sort()
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `expected ${label} to show exactly ${JSON.stringify(sortedExpected)}, got ${JSON.stringify(sortedActual)}`,
    )
  }
}

async function waitForVisibleSet(page, expected, label) {
  await waitForCondition(async () => {
    const actual = await visibleNames(page)
    return (
      actual.length === expected.length &&
      [...actual].sort().join('|') === [...expected].sort().join('|')
    )
  }, label)
  assertVisibleSet(await visibleNames(page), expected, label)
}

async function fillSearch(page, term) {
  await page.getByTestId('replays-filter-search').fill(term)
}

async function clearFilters(page) {
  await page.getByTestId('replays-filter-clear').click({ timeout: TIMEOUT_MS })
}

/** Every non-"Any" `<option>` value of a filter `<select>`, in DOM order (already ascending per
 * `demoFilterOptions`'s own `distinctSorted`). */
async function selectValues(page, testid) {
  return page
    .locator(`[data-testid="${testid}"] option`)
    .evaluateAll((options) => options.map((o) => o.value).filter((v) => v !== ''))
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${label} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

const ALL_NAMES = [
  REPLAYS_FILTER_SIDECAR_NAME,
  REPLAYS_FILTER_NONFAV_DEMO,
  REPLAYS_FILTER_HEADERONLY_DEMO,
  REPLAYS_FILTER_NAMEFACT_DEMO,
]

export default async function replaysFilterSearch({ page, step, shot }) {
  step('navigate to Demos and wait for the scan to settle')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)
  await waitForVisibleSet(page, ALL_NAMES, 'the unfiltered list')
  await shot('unfiltered')

  step(
    'AC1: searching by the sidecar name, description word, tag, sidecar player, header ' +
      'player, name-fact player, map and a file-name fragment each narrows to the expected demo(s)',
  )
  await fillSearch(page, REPLAYS_FILTER_SIDECAR_NAME)
  await waitForVisibleSet(page, [REPLAYS_FILTER_SIDECAR_NAME], 'search by sidecar name')

  await fillSearch(page, REPLAYS_FILTER_DESCRIPTION_WORD)
  await waitForVisibleSet(page, [REPLAYS_FILTER_NONFAV_DEMO], 'search by description word')

  await fillSearch(page, REPLAYS_FILTER_FAVOURITE_TAG)
  await waitForVisibleSet(page, [REPLAYS_FILTER_SIDECAR_NAME], 'search by tag')

  await fillSearch(page, REPLAYS_FILTER_SIDECAR_PLAYER.toLowerCase())
  await waitForVisibleSet(
    page,
    [REPLAYS_FILTER_SIDECAR_NAME],
    'search by sidecar player (lower-case)',
  )

  await fillSearch(page, REPLAYS_FILTER_HEADER_PLAYER)
  await waitForVisibleSet(page, [REPLAYS_FILTER_HEADERONLY_DEMO], 'search by header player')

  await fillSearch(page, REPLAYS_FILTER_NAMEFACT_PLAYER)
  await waitForVisibleSet(page, [REPLAYS_FILTER_NAMEFACT_DEMO], 'search by name-fact player')

  await fillSearch(page, REPLAYS_FILTER_SHARED_MAP)
  await waitForVisibleSet(
    page,
    [REPLAYS_FILTER_SIDECAR_NAME, REPLAYS_FILTER_NAMEFACT_DEMO],
    'search by map',
  )

  await fillSearch(page, 'headeronly')
  await waitForVisibleSet(page, [REPLAYS_FILTER_HEADERONLY_DEMO], 'search by file-name fragment')
  await shot('search-narrows')

  await fillSearch(page, '')
  await waitForVisibleSet(page, ALL_NAMES, 'search cleared')

  step('AC2: the mod/gamemode/map dropdown options equal the values present in the fixture')
  assertEqual(
    await selectValues(page, 'replays-filter-mod'),
    REPLAYS_FILTER_MOD_OPTIONS,
    'mod options',
  )
  assertEqual(
    await selectValues(page, 'replays-filter-gamemode'),
    REPLAYS_FILTER_GAMEMODE_OPTIONS,
    'gamemode options',
  )
  assertEqual(
    await selectValues(page, 'replays-filter-map'),
    REPLAYS_FILTER_MAP_OPTIONS,
    'map options',
  )

  step('AC3: favourites-only narrows to the one favourite')
  await page.getByTestId('replays-filter-favourites').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, [REPLAYS_FILTER_SIDECAR_NAME], 'favourites only')
  await page.getByTestId('replays-filter-favourites').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, ALL_NAMES, 'favourites only cleared')

  step('AC4: rating >= 6 keeps only the rated-9 demo - the unrated demo is gone')
  await page.selectOption('[data-testid="replays-filter-rating"]', '6')
  await waitForVisibleSet(page, [REPLAYS_FILTER_SIDECAR_NAME], 'rating at least 6')
  await page.selectOption('[data-testid="replays-filter-rating"]', '')
  await waitForVisibleSet(page, ALL_NAMES, 'rating cleared')

  step('AC5: selecting two tags shows the union of demos carrying either')
  await page
    .locator(`[data-testid="replays-filter-tag"][data-tag="${REPLAYS_FILTER_FAVOURITE_TAG}"]`)
    .click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, [REPLAYS_FILTER_SIDECAR_NAME], 'one tag selected')
  await page
    .locator(`[data-testid="replays-filter-tag"][data-tag="${REPLAYS_FILTER_FUN_TAG}"]`)
    .click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(
    page,
    [REPLAYS_FILTER_SIDECAR_NAME, REPLAYS_FILTER_NONFAV_DEMO],
    'two tags selected (union)',
  )
  await shot('two-tags-union')
  // Deselect both, back to the unfiltered list.
  await page
    .locator(`[data-testid="replays-filter-tag"][data-tag="${REPLAYS_FILTER_FAVOURITE_TAG}"]`)
    .click({ timeout: TIMEOUT_MS })
  await page
    .locator(`[data-testid="replays-filter-tag"][data-tag="${REPLAYS_FILTER_FUN_TAG}"]`)
    .click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, ALL_NAMES, 'tags cleared')

  step('AC6: a map filter combined with a tag filter intersects, narrower than either alone')
  await page.selectOption('[data-testid="replays-filter-map"]', REPLAYS_FILTER_SHARED_MAP)
  await waitForVisibleSet(
    page,
    [REPLAYS_FILTER_SIDECAR_NAME, REPLAYS_FILTER_NAMEFACT_DEMO],
    'map filter alone',
  )
  await page
    .locator(`[data-testid="replays-filter-tag"][data-tag="${REPLAYS_FILTER_FAVOURITE_TAG}"]`)
    .click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(
    page,
    [REPLAYS_FILTER_SIDECAR_NAME],
    'map + tag combined (narrower than map alone)',
  )
  const countText = await page.getByTestId('replays-filter-count').textContent()
  if (countText !== `Showing 1 of 4`) {
    throw new Error(`expected replays-filter-count to read "Showing 1 of 4", got "${countText}"`)
  }

  // Swap the tag for one the map-filtered demo never carries - the combination matches nothing.
  await page
    .locator(`[data-testid="replays-filter-tag"][data-tag="${REPLAYS_FILTER_FAVOURITE_TAG}"]`)
    .click({ timeout: TIMEOUT_MS })
  await page
    .locator(`[data-testid="replays-filter-tag"][data-tag="${REPLAYS_FILTER_FUN_TAG}"]`)
    .click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-filter-no-match')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('no-match')

  await page.getByTestId('replays-filter-no-match-clear').click({ timeout: TIMEOUT_MS })
  await waitForVisibleSet(page, ALL_NAMES, 'cleared via the no-match clear button')

  step(
    'AC7: under an active filter, visible rows keep the current sort order, unaffected by filtering',
  )
  // A deterministic non-default sort: click the map column once (ascending).
  await page.getByTestId('replays-sort-map').click({ timeout: TIMEOUT_MS })
  await waitForCondition(
    async () =>
      (await page.getByTestId('replays-sort-map').getAttribute('aria-pressed')) === 'true',
    'the map sort to engage',
  )
  const sortedNames = await visibleNames(page)

  await fillSearch(page, REPLAYS_FILTER_SHARED_MAP)
  await waitForVisibleSet(
    page,
    [REPLAYS_FILTER_SIDECAR_NAME, REPLAYS_FILTER_NAMEFACT_DEMO],
    'map search under an active sort',
  )
  const filteredNames = await visibleNames(page)
  const expectedSubsequence = sortedNames.filter((name) => filteredNames.includes(name))
  assertEqual(
    filteredNames,
    expectedSubsequence,
    'filtered rows keep the sorted order (a subsequence)',
  )
  if ((await page.getByTestId('replays-sort-map').getAttribute('aria-pressed')) !== 'true') {
    throw new Error('expected the map sort to remain engaged while a filter is active')
  }
  await clearFilters(page)
  await waitForVisibleSet(page, ALL_NAMES, 'filter cleared, sort still active')
  // Reset the sort back to default for the persistence check below.
  await page.getByTestId('replays-sort-map').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-sort-map').click({ timeout: TIMEOUT_MS })
  await waitForCondition(
    async () =>
      (await page.getByTestId('replays-sort-map').getAttribute('aria-pressed')) === 'false',
    'the sort to reset back to default',
  )

  step('persistence: a filter set here is restored after navigating away and back')
  await fillSearch(page, REPLAYS_FILTER_DESCRIPTION_WORD)
  await waitForVisibleSet(
    page,
    [REPLAYS_FILTER_NONFAV_DEMO],
    'the description search, before navigating away',
  )
  await waitForStateJson(
    variantUserDataDir(variant),
    (state) => state.replays?.listFilter?.search === REPLAYS_FILTER_DESCRIPTION_WORD,
    'state.json to persist the search term',
  )

  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForDemosScanToFinish(page)

  const restoredSearch = await page.getByTestId('replays-filter-search').inputValue()
  if (restoredSearch !== REPLAYS_FILTER_DESCRIPTION_WORD) {
    throw new Error(
      `expected the restored search box to read "${REPLAYS_FILTER_DESCRIPTION_WORD}", got "${restoredSearch}"`,
    )
  }
  await waitForVisibleSet(
    page,
    [REPLAYS_FILTER_NONFAV_DEMO],
    'the restored filter, after navigating back',
  )

  const persisted = readStateJson(variantUserDataDir(variant))
  if (persisted.replays?.listFilter?.search !== REPLAYS_FILTER_DESCRIPTION_WORD) {
    throw new Error(
      `expected state.json's replays.listFilter.search to be "${REPLAYS_FILTER_DESCRIPTION_WORD}", got ${JSON.stringify(persisted.replays?.listFilter)}`,
    )
  }
  await shot('persisted-after-navigation')

  await clearFilters(page)
  await waitForVisibleSet(page, ALL_NAMES, 'cleared at the end of the run')

  console.log(
    'replays-filter-search: search/mod/gamemode/map/favourites/rating/tags each narrow the list ' +
      'correctly (alone and combined), a filter never disturbs the active sort, a filter matching ' +
      'nothing shows the no-match state (recoverable via its clear button), and the chosen filter ' +
      'survives navigating away and back, persisted in state.json',
  )
}
