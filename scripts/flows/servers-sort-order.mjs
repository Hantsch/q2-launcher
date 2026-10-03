// Story 119 (docs/requirements/119-busy-servers-rise-to-the-top.md) D3: the sort bar's e2e proof
// on the real Servers surface. Five genuine loopback `dgram` responders (F/E/B/C/D) prove the
// default order (favourites pinned, then occupancy descending, gamemode only breaking ties), a
// column click's asc/desc cycle, that the choice survives navigating away and a full page reload,
// that it is actually persisted in `state.json`'s `servers.listSort`, and that a third click on the
// same column clears it back to the default order and persists listSort as null.
//
// Mirrors `servers-row-markers.mjs`'s `bindResponder`/fixture-seeding/`waitForFinishedAtChange`
// pattern (copied, not imported - `scripts/*.mjs` never imports another flow file) and
// `servers-scan-settings.mjs`'s approach for reading `state.json` off disk.
import { variantUserDataDir } from '../lib/harness.mjs'
import { readStateJson, waitForStateJson } from '../lib/state-json.mjs'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'
import { makeResponderBinder, closeResponder } from '../lib/servers-stub.mjs'
import { readFinishedAt, waitForFinishedAtChange, waitForRowCount } from '../lib/servers-flow.mjs'

export const variant = 'servers-sort-order'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
/** How long to keep retrying a `state.json` read after a sort click - the click updates the DOM
 * optimistically (`ServersView.tsx`'s `handleSort`) before the `list.setSort` IPC round trip that
 * actually writes the file resolves, so a single immediate read can race the write. */

/** Binds one loopback responder. `extraInfoFlags` is appended verbatim to the `info`/`status`
 * serverinfo line (e.g. `\deathmatch\1`) - feeds `deriveGamemode` on the real row. `mapName`
 * feeds the row's `map` field, the column this flow sorts by. */
const bindResponder = makeResponderBinder(
  (hostname, playerLines, { extraInfoFlags = '', mapName = 'q2dm1' } = {}) => ({
    infoLine:
      `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\${mapName}\\clients\\${playerLines.length}` +
      `\\maxclients\\8\\version\\3.20${extraInfoFlags}`,
    playerLines,
    extra: { hostname },
  }),
  { counted: true },
)

const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

function playerLinesFor(count) {
  return Array.from(
    { length: count },
    (_, index) => `${index + 1} ${index * 5} "Player${index + 1}"`,
  )
}

let serverF = null
let serverE = null
let serverB = null
let serverC = null
let serverD = null
let responders = []

export async function setup() {
  // F: favourite, 0 players, map q2dm8 - no gamemode flags, pinned first regardless of the others.
  serverF = await bindResponder('Fixture Server F (Favourite)', playerLinesFor(0), {
    mapName: 'q2dm8',
  })
  // E: ctf 1, 6 players, map q2dm3.
  serverE = await bindResponder('Fixture Server E', playerLinesFor(6), {
    extraInfoFlags: '\\ctf\\1',
    mapName: 'q2dm3',
  })
  // B: deathmatch 1, 3 players, map q2dm1.
  serverB = await bindResponder('Fixture Server B', playerLinesFor(3), {
    extraInfoFlags: '\\deathmatch\\1',
    mapName: 'q2dm1',
  })
  // C: ctf 1, 3 players, map q2dm5.
  serverC = await bindResponder('Fixture Server C', playerLinesFor(3), {
    extraInfoFlags: '\\ctf\\1',
    mapName: 'q2dm5',
  })
  // D: deathmatch 1, 1 player, map q2dm2.
  serverD = await bindResponder('Fixture Server D', playerLinesFor(1), {
    extraInfoFlags: '\\deathmatch\\1',
    mapName: 'q2dm2',
  })
  responders = [serverF, serverE, serverB, serverC, serverD]

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        // GB-A5: every shipped master source present but disabled - never touch a real master.
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [{ address: serverF.address, addedAt: FIXED_ADDED_AT }],
        manualServers: responders.map((responder) => ({
          address: responder.address,
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

// The bare `servers-row-` prefix also matches elements inside a row (`servers-row-copy-`,
// `-favourite-`, `-gamemode-` ...); only the row itself carries an explicit `role="button"`.
const ROW_SELECTOR = '[role="button"][data-testid^="servers-row-"]'

/** Reads the DOM order of every `servers-row-<address>` row button, in the order they appear. */
async function rowOrder(page) {
  return page.evaluate(
    (selector) =>
      Array.from(document.querySelectorAll(selector)).map((el) => el.getAttribute('data-testid')),
    ROW_SELECTOR,
  )
}

/** Waits until at least `count` row buttons are attached - re-mounting the view re-runs its
 * `readScan()`/`getListSort()` mount effects, both async, so the rows are not there the instant
 * navigation lands. */
function assertOrder(actual, expectedAddresses, label) {
  const expected = expectedAddresses.map((address) => `servers-row-${address}`)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${label} order ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

export default async function serversSortOrder({ page, step, shot }) {
  step('navigate to the Servers view and run a full refresh')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)

  step(
    'the default order is favourite-pinned, then occupancy descending (gamemode only breaks ties)',
  )
  const defaultOrder = await rowOrder(page)
  assertOrder(
    defaultOrder,
    [serverF.address, serverE.address, serverB.address, serverC.address, serverD.address],
    'the default',
  )
  const currentDefault = await page.getByTestId('servers-sort-current').textContent()
  if (currentDefault !== 'Favourites first, then busiest') {
    throw new Error(`expected the default sort-current text, got "${currentDefault}"`)
  }
  await shot('default-order')

  step('clicking the map column sorts ascending (favourite still pinned first)')
  await page.getByTestId('servers-sort-map').click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="servers-sort-map"]')?.getAttribute('aria-pressed') ===
      'true',
    null,
    { timeout: TIMEOUT_MS },
  )
  const ascOrder = await rowOrder(page)
  assertOrder(
    ascOrder,
    [serverF.address, serverB.address, serverD.address, serverE.address, serverC.address],
    'map ascending',
  )
  await shot('map-ascending')

  step('clicking the map column again reverses to descending')
  await page.getByTestId('servers-sort-map').click({ timeout: TIMEOUT_MS })
  await waitForStateJson(
    variantUserDataDir(variant),
    (state) =>
      state.servers?.listSort?.column === 'map' && state.servers?.listSort?.direction === 'desc',
    'state.json to persist map/desc',
  )
  const descOrder = await rowOrder(page)
  assertOrder(
    descOrder,
    [serverF.address, serverC.address, serverE.address, serverD.address, serverB.address],
    'map descending',
  )
  await shot('map-descending')

  step('navigating away and back keeps the map/descending order')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForRowCount(page, responders.length)
  const afterNavOrder = await rowOrder(page)
  assertOrder(
    afterNavOrder,
    [serverF.address, serverC.address, serverE.address, serverD.address, serverB.address],
    'map descending after navigating away and back',
  )

  step('reloading the page keeps the map/descending order')
  await page.reload()
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForRowCount(page, responders.length)
  const afterReloadOrder = await rowOrder(page)
  assertOrder(
    afterReloadOrder,
    [serverF.address, serverC.address, serverE.address, serverD.address, serverB.address],
    'map descending after a page reload',
  )
  const persisted = readStateJson(variantUserDataDir(variant))
  const persistedSort = persisted.servers?.listSort
  if (persistedSort?.column !== 'map' || persistedSort?.direction !== 'desc') {
    throw new Error(
      `expected state.json's servers.listSort to be map/desc, got ${JSON.stringify(persistedSort)}`,
    )
  }
  await shot('after-reload')

  step('a third click on the map column clears the sort back to the default order')
  await page.getByTestId('servers-sort-map').click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="servers-sort-map"]')?.getAttribute('aria-pressed') ===
      'false',
    null,
    { timeout: TIMEOUT_MS },
  )
  const clearedOrder = await rowOrder(page)
  assertOrder(
    clearedOrder,
    [serverF.address, serverE.address, serverB.address, serverC.address, serverD.address],
    'the default (after clearing the sort)',
  )
  await waitForStateJson(
    variantUserDataDir(variant),
    (state) => state.servers?.listSort === null,
    'state.json servers.listSort to be null',
  )
  await shot('cleared-back-to-default')

  console.log(
    'servers-sort-order: the default order pins favourites then sorts by occupancy with ' +
      'gamemode only breaking ties, a column click cycles asc -> desc -> default, the choice ' +
      'survives navigating away and a full reload, is persisted in state.json, and clearing it ' +
      'persists null',
  )
}
