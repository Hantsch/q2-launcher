// The demos search box's quoted (exact) mode on the real Demos surface. Setup/teardown and helpers
// are copied from `replays-filter-search.mjs` - flows never import each other. Seeds the same
// fixture: q2ctf5 is the map of two demos, "Zephyr" the name-fact player of one.
import {
  REPLAYS_FILTER_HEADERONLY_DEMO,
  REPLAYS_FILTER_NAMEFACT_DEMO,
  REPLAYS_FILTER_NAMEFACT_PLAYER,
  REPLAYS_FILTER_NONFAV_DEMO,
  REPLAYS_FILTER_SHARED_MAP,
  REPLAYS_FILTER_SIDECAR_NAME,
  REPLAYS_FILTER_VARIANT,
  removeReplaysFilterFixture,
  writeReplaysFilterFixture,
} from '../lib/fixture.mjs'
import { openDemosRoot } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000
const POLL_INTERVAL_MS = 100

export const variant = REPLAYS_FILTER_VARIANT

export async function setup() {
  writeReplaysFilterFixture()
  return {}
}

export async function teardown() {
  removeReplaysFilterFixture()
}

async function waitForCondition(predicate, label, timeout = TIMEOUT_MS) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

async function visibleNames(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="replays-demo-row"]')).map(
      (row) => row.querySelector('[data-testid="replays-demo-name"]')?.textContent?.trim() ?? null,
    ),
  )
}

async function waitForVisibleSet(page, expected, label) {
  const key = (names) => [...names].sort().join('|')
  await waitForCondition(async () => {
    const actual = await visibleNames(page)
    return actual.length === expected.length && key(actual) === key(expected)
  }, label)
}

async function fillSearch(page, term) {
  await page.getByTestId('replays-filter-search').fill(term)
}

const ALL_NAMES = [
  REPLAYS_FILTER_SIDECAR_NAME,
  REPLAYS_FILTER_NONFAV_DEMO,
  REPLAYS_FILTER_HEADERONLY_DEMO,
  REPLAYS_FILTER_NAMEFACT_DEMO,
]

export default async function replaysQuotedSearch({ page, step, shot }) {
  step('navigate to Demos and wait for the scan to settle')
  await openDemosRoot(page)
  await waitForVisibleSet(page, ALL_NAMES, 'the unfiltered list')

  step('the placeholder advertises quoted search')
  const placeholder = await page.getByTestId('replays-filter-search').getAttribute('placeholder')
  if (!placeholder?.includes('"quotes"')) {
    throw new Error(`expected the search placeholder to contain "quotes", got "${placeholder}"`)
  }

  step('an unquoted term matches several demos, the same text quoted only the exact field')
  await fillSearch(page, `"${REPLAYS_FILTER_NAMEFACT_PLAYER}"`)
  await waitForVisibleSet(page, [REPLAYS_FILTER_NAMEFACT_DEMO], 'quoted whole player name')

  await fillSearch(page, `"${REPLAYS_FILTER_SHARED_MAP}"`)
  await waitForVisibleSet(
    page,
    [REPLAYS_FILTER_SIDECAR_NAME, REPLAYS_FILTER_NAMEFACT_DEMO],
    'quoted whole map',
  )
  await shot('quoted-map')

  step('a partial player name matches unquoted but not quoted')
  const partialPlayer = REPLAYS_FILTER_NAMEFACT_PLAYER.slice(0, -1)
  await fillSearch(page, partialPlayer)
  await waitForVisibleSet(page, [REPLAYS_FILTER_NAMEFACT_DEMO], 'unquoted partial player name')
  await fillSearch(page, `"${partialPlayer}"`)
  await waitForVisibleSet(page, [], 'quoted partial player name')
  step('a quoted partial word matches nothing')
  const partial = REPLAYS_FILTER_SHARED_MAP.slice(0, -1)
  await fillSearch(page, partial)
  await waitForCondition(
    async () => (await visibleNames(page)).length >= 2,
    'the unquoted partial map to match several demos',
  )
  await fillSearch(page, `"${partial}"`)
  await waitForVisibleSet(page, [], 'quoted partial map')
  await shot('quoted-partial-no-match')

  await fillSearch(page, '')
  await waitForVisibleSet(page, ALL_NAMES, 'search cleared')

  console.log(
    'replays-quoted-search: quoted terms match whole fields exactly, unquoted terms still match ' +
      'substrings, and a quoted partial word matches nothing',
  )
}
