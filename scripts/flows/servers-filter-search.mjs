// Story 120 (docs/requirements/120-i-filter-and-search-the-list.md) D2: the filter bar e2e proof on
// the real Servers surface - four genuine loopback `dgram` responders (A/B/C/D), each answering both
// `info` and `status`, proving every filter field (search, mod, gamemode, map, empty, waiting)
// actually narrows the real rendered list, not just the pure engine's own unit tests
// (`src/shared/servers/list-filter.test.ts`).
//
// Mirrors `servers-row-markers.mjs`'s `bindResponder`/fixture-seeding/`waitForFinishedAtChange`
// pattern verbatim (copied, not imported - `scripts/*.mjs` never imports another flow file).
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'
import { makeResponderBinder, closeResponder } from '../lib/servers-stub.mjs'
import { readFinishedAt, waitForFinishedAtChange } from '../lib/servers-flow.mjs'

export const variant = 'servers-filter-search'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000

/** Binds one loopback responder with full control over its `gamename`/`mapname`/`maxclients`/
 * gamemode flags/`needpass`, so each of A-D can exercise a different filter field. */
const bindResponder = makeResponderBinder(
  (hostname, playerLines, { mod, map, maxclients, extraInfoFlags = '', needpass = false }) => ({
    infoLine:
      `\\gamename\\${mod}\\hostname\\${hostname}\\mapname\\${map}\\clients\\${playerLines.length}` +
      `\\maxclients\\${maxclients}\\version\\3.20\\needpass\\${needpass ? 1 : 0}${extraInfoFlags}`,
    playerLines,
    extra: { hostname },
  }),
)

const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

let serverA = null
let serverB = null
let serverC = null
let serverD = null
let responders = []

export async function setup() {
  serverA = await bindResponder('Fixture Server A', ['5 20 "Alpha"'], {
    mod: 'opentdm',
    map: 'q2dm1',
    maxclients: 2,
    extraInfoFlags: '\\deathmatch\\1',
  })
  serverB = await bindResponder('Fixture Server B', ['7 15 "Bravo"', '3 9 "Zulu"'], {
    mod: 'baseq2',
    map: 'q2dm1',
    maxclients: 2,
    extraInfoFlags: '\\deathmatch\\1',
  })
  serverC = await bindResponder('Empty Cellar', [], {
    mod: 'baseq2',
    map: 'q2dm8',
    maxclients: 16,
    needpass: true,
    extraInfoFlags: '\\deathmatch\\1',
  })
  // The dm/coop/ctf flags only yield a gamemode on stock baseq2 - a mod's gamemode stays unknown -
  // so the one CTF server is baseq2 running with the ctf flag.
  serverD = await bindResponder('Fixture Server D', ['1 1 "Zulu"', '2 2 "Yankee"', '3 3 "Xray"'], {
    mod: 'baseq2',
    map: 'q2ctf1',
    maxclients: 16,
    extraInfoFlags: '\\ctf\\1',
  })
  responders = [serverA, serverB, serverC, serverD]

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
        manualServers: responders.map((entry) => ({
          address: entry.address,
          origin: 'manual',
          addedAt: FIXED_ADDED_AT,
        })),
        history: [],
        scan: {
          concurrency: 4,
          timeoutMs: 500,
          retries: 0,
          minSpacingMs: 0,
          autoScanOnOpen: false,
          autoRefreshEnabled: false,
          autoRefreshIntervalMs: 60_000,
        },
      },
    },
  })

  return {}
}

export async function teardown() {
  await Promise.all(responders.map((responder) => closeResponder(responder)))
}

/** Reads the set of visible row addresses (as their bound loopback port suffix) among A-D, by
 * checking which of the four `servers-row-<address>` testids are currently attached. */
async function visibleLabels(page) {
  const labels = {
    [serverA.address]: 'A',
    [serverB.address]: 'B',
    [serverC.address]: 'C',
    [serverD.address]: 'D',
  }
  const visible = []
  for (const responder of [serverA, serverB, serverC, serverD]) {
    const count = await page.getByTestId(`servers-row-${responder.address}`).count()
    if (count > 0) visible.push(labels[responder.address])
  }
  return visible.sort()
}

function assertSet(actual, expected, label) {
  const a = [...actual].sort()
  const e = [...expected].sort()
  if (a.join(',') !== e.join(',')) {
    throw new Error(`${label}: expected {${e.join(',')}}, got {${a.join(',')}}`)
  }
}

async function clearFilters(page) {
  await page.getByTestId('servers-filter-clear').click({ timeout: TIMEOUT_MS })
}

export default async function serversFilterSearch({ page, step, shot }) {
  step('navigate to the Servers view')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('click "Refresh servers" and wait for the round to finish')
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await page
    .getByTestId(`servers-row-${serverA.address}`)
    .waitFor({ state: 'attached', timeout: TIMEOUT_MS })

  // The `info` reply carries only hostname/map/player counts; mod (`gamename`) comes from `status`,
  // which a full round skips for a server whose `info` reported 0 players - unless that server is
  // the selected one. So the empty server C's mod is only known once a user has selected it during
  // a refresh; without this, mod=baseq2 correctly cannot list C.
  step('select the empty server C and refresh again, so its status (and mod) is read')
  const rowC = page.getByTestId(`servers-row-${serverC.address}`)
  await rowC.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (testId) =>
      document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-pressed') === 'true',
    `servers-row-${serverC.address}`,
    { timeout: TIMEOUT_MS },
  )
  const finishedAtBeforeSelected = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBeforeSelected, SCAN_SETTLE_TIMEOUT_MS)
  await rowC.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (testId) =>
      document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-pressed') === 'false',
    `servers-row-${serverC.address}`,
    { timeout: TIMEOUT_MS },
  )

  step('AC3: with no filter, all four rows are visible, including the empty (0 player) server C')
  assertSet(await visibleLabels(page), ['A', 'B', 'C', 'D'], 'no filter')
  await shot('no-filter')

  step('AC1: mod=baseq2 shows B, C and D')
  await page.getByTestId('servers-filter-mod').selectOption('baseq2')
  assertSet(await visibleLabels(page), ['B', 'C', 'D'], 'mod=baseq2')
  await shot('filter-mod')
  await clearFilters(page)

  step('AC1: gamemode=ctf shows D only')
  await page.getByTestId('servers-filter-gamemode').selectOption('ctf')
  assertSet(await visibleLabels(page), ['D'], 'gamemode=ctf')
  await clearFilters(page)

  step('AC1: "Empty" shows C only (the 0 player server)')
  await page.getByTestId('servers-filter-empty').click({ timeout: TIMEOUT_MS })
  assertSet(await visibleLabels(page), ['C'], 'empty')
  await clearFilters(page)

  step('AC1: "Waiting for an opponent" shows A only (exactly one known player)')
  await page.getByTestId('servers-filter-waiting').click({ timeout: TIMEOUT_MS })
  assertSet(await visibleLabels(page), ['A'], 'waitingForOpponent')
  await clearFilters(page)

  step('AC1: map=q2dm1 shows A and B')
  await page.getByTestId('servers-filter-map').selectOption('q2dm1')
  assertSet(await visibleLabels(page), ['A', 'B'], 'map=q2dm1')
  await clearFilters(page)
  await shot('filter-toggles')

  step('AC2: mod=baseq2 + map=q2dm1 combine to just B')
  await page.getByTestId('servers-filter-mod').selectOption('baseq2')
  await page.getByTestId('servers-filter-map').selectOption('q2dm1')
  assertSet(await visibleLabels(page), ['B'], 'mod=baseq2 + map=q2dm1')

  step('AC2: adding "Empty" too leaves an empty set, with the no-match line visible')
  await page.getByTestId('servers-filter-empty').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-filter-no-match')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertSet(await visibleLabels(page), [], 'mod=baseq2 + map=q2dm1 + empty')
  await shot('no-match')
  await clearFilters(page)

  step('AC4: search "cellar" matches C only (hostname match)')
  await page.getByTestId('servers-filter-search').fill('cellar')
  assertSet(await visibleLabels(page), ['C'], 'search=cellar')
  await clearFilters(page)

  step('AC5: search "zulu" matches B and D (player-name match), not A or C')
  await page.getByTestId('servers-filter-search').fill('zulu')
  assertSet(await visibleLabels(page), ['B', 'D'], 'search=zulu')
  await shot('search')
  await clearFilters(page)

  step('AC6: filter + sort combine without disturbing each other')
  await page.getByTestId('servers-filter-mod').selectOption('baseq2')
  assertSet(await visibleLabels(page), ['B', 'C', 'D'], 'mod=baseq2 (pre-sort)')
  // Default sort: favourites first (none here), then occupancy descending - B (2 players) above C (0).
  const rowsBeforeSort = await page
    .getByRole('button', { name: /Fixture Server B|Empty Cellar/ })
    .all()
  const orderBefore = []
  for (const row of rowsBeforeSort) orderBefore.push(await row.getAttribute('data-testid'))
  if (orderBefore[0] !== `servers-row-${serverB.address}`) {
    throw new Error(`expected B above C under the default sort, got order ${orderBefore.join(',')}`)
  }

  await page.getByTestId('servers-sort-map').click({ timeout: TIMEOUT_MS })
  assertSet(await visibleLabels(page), ['B', 'C', 'D'], 'mod=baseq2 (post-sort, still same set)')
  const modAfterSort = await page.getByTestId('servers-filter-mod').inputValue()
  if (modAfterSort !== 'baseq2') {
    throw new Error(
      `expected the mod filter to keep its value after sorting, got "${modAfterSort}"`,
    )
  }
  await shot('filter-plus-sort')

  await clearFilters(page)
  const sortAfterClear = await page.getByTestId('servers-sort-map').getAttribute('aria-pressed')
  if (sortAfterClear !== 'true') {
    throw new Error('expected the sort control to keep its own state after clearing the filter')
  }

  console.log(
    'servers-filter-search: every filter field (mod/gamemode/map/search/toggles) narrows the real ' +
      'rendered list on its own (AC1) and in combination (AC2), search matches hostnames and roster ' +
      'player names (AC4/AC5), an unfiltered list still shows the empty server (AC3), and filtering ' +
      "and sorting compose without disturbing each other's state (AC6).",
  )
}
