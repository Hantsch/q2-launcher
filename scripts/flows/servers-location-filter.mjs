// Location column, detail field and location filter on the real Servers surface: four loopback
// `dgram` responders, three located by the harness in Germany, France and the US (public IPv4s the
// bundled DB-IP database resolves) and the fourth left on loopback (LAN) (story 263).
import { variantUserDataDir } from '../lib/harness.mjs'
import { waitForStateJson } from '../lib/state-json.mjs'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'
import { makeResponderBinder, closeResponder } from '../lib/servers-stub.mjs'
import {
  DEFAULT_ROW_SELECTOR,
  chipNamed,
  clearFilters,
  readFinishedAt,
  readMultiFilter,
  setMultiFilter,
  waitForFinishedAtChange,
  multiRoot,
  makeVisibleLabels,
} from '../lib/servers-flow.mjs'

export const variant = 'servers-location-filter'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'
const FILTER = 'servers-filter-location'

// Public IPv4s the committed database resolves to Germany, France and the United States.
const GEO_IPS = { A: '5.9.0.1', B: '80.67.169.12', C: '8.8.8.8' }

const bindResponder = makeResponderBinder(
  (hostname, playerLines, { mod, map, maxclients, extraInfoFlags = '' }) => ({
    infoLine:
      `\\gamename\\${mod}\\hostname\\${hostname}\\mapname\\${map}\\clients\\${playerLines.length}` +
      `\\maxclients\\${maxclients}\\version\\3.20\\needpass\\0${extraInfoFlags}`,
    playerLines,
    extra: { hostname },
  }),
)

// A quick filter saved before the location field existed: no `location` key at all.
const SEEDED_QUICK_FILTERS = [
  {
    id: 'seed-legacy',
    name: 'Legacy CTF',
    criteria: {
      mod: 'ctf',
      gamemode: null,
      map: null,
      empty: false,
      hideBotsOnly: false,
      waitingForOpponent: false,
    },
  },
]

let serverA = null
let serverB = null
let serverC = null
let serverD = null
let responders = []

export async function setup() {
  serverA = await bindResponder('Fixture Server A', ['5 20 "Alpha"'], {
    mod: 'opentdm',
    map: 'q2dm1',
    maxclients: 8,
    extraInfoFlags: '\\deathmatch\\1',
  })
  serverB = await bindResponder('Fixture Server B', ['7 15 "Bravo"'], {
    mod: 'baseq2',
    map: 'q2dm1',
    maxclients: 8,
    extraInfoFlags: '\\deathmatch\\1',
  })
  serverC = await bindResponder('Fixture Server C', ['4 10 "Charlie"'], {
    mod: 'baseq2',
    map: 'q2dm8',
    maxclients: 8,
    extraInfoFlags: '\\deathmatch\\1',
  })
  serverD = await bindResponder('Fixture Server D', ['1 1 "Delta"'], {
    mod: 'ctf',
    map: 'q2ctf1',
    maxclients: 8,
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
        quickFilters: SEEDED_QUICK_FILTERS,
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

  return {
    env: {
      Q2L_UI_GEO_ADDRESSES: [
        `${serverA.address}=${GEO_IPS.A}`,
        `${serverB.address}=${GEO_IPS.B}`,
        `${serverC.address}=${GEO_IPS.C}`,
      ].join(','),
    },
  }
}

export async function teardown() {
  await Promise.all(responders.map((responder) => closeResponder(responder)))
}

const visibleLabels = makeVisibleLabels(() => [
  ['A', serverA],
  ['B', serverB],
  ['C', serverC],
  ['D', serverD],
])

function assertEq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const text = async (locator) => ((await locator.textContent()) ?? '').trim()
const triggerText = (page, testId) => text(page.getByTestId(testId))
const rowLocation = (page, server) =>
  text(page.getByTestId(`servers-row-${server.address}`).getByTestId('servers-row-location'))

/** The labels of the rows in list order. */
async function listOrder(page) {
  const byAddress = new Map(responders.map((r, i) => [`servers-row-${r.address}`, 'ABCD'[i]]))
  const ids = await page
    .locator(DEFAULT_ROW_SELECTOR)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  return ids.map((id) => byAddress.get(id))
}

async function optionTexts(page) {
  return (await page.getByTestId(`${FILTER}-option`).allTextContents()).map((x) => x.trim())
}

export default async function serversLocationFilter({ page, step, shot }) {
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await page
    .getByTestId(`servers-row-${serverD.address}`)
    .waitFor({ state: 'attached', timeout: TIMEOUT_MS })
  assertEq(await visibleLabels(page), ['A', 'B', 'C', 'D'], 'unfiltered')

  step('AC1: the Location column shows EU · Germany left of Mod and sorts by its header')
  assertEq(await rowLocation(page, serverA), 'EU · Germany', 'server A location cell')
  assertEq(await rowLocation(page, serverB), 'EU · France', 'server B location cell')
  assertEq(await rowLocation(page, serverC), 'NA · United States', 'server C location cell')
  const locationBox = await page.getByTestId('servers-sort-location').boundingBox()
  const modBox = await page.getByTestId('servers-sort-mod').boundingBox()
  if (!locationBox || !modBox || locationBox.x + locationBox.width > modBox.x + 1) {
    throw new Error(
      `Location header is not left of Mod: ${JSON.stringify({ locationBox, modBox })}`,
    )
  }
  await page.getByTestId('servers-sort-location').click({ timeout: TIMEOUT_MS })
  assertEq(await listOrder(page), ['B', 'A', 'C', 'D'], 'ascending by location')
  await page.getByTestId('servers-sort-location').click({ timeout: TIMEOUT_MS })
  assertEq((await listOrder(page)).slice(0, 3), ['C', 'A', 'B'], 'descending by location')
  await shot('location-column')

  step('AC3: the loopback server shows LAN')
  assertEq(await rowLocation(page, serverD), 'LAN', 'server D location cell')

  step('AC4: the detail pane shows Germany, Europe')
  await page.getByTestId(`servers-row-${serverA.address}`).click({ timeout: TIMEOUT_MS })
  const detail = page.getByTestId('servers-detail-field-location')
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertEq(await text(detail), 'Germany, Europe', 'detail location')

  step(
    'AC5: the location filter offers Europe with France and Germany, North America with the US, and LAN',
  )
  await page.getByTestId(FILTER).click({ timeout: TIMEOUT_MS })
  const offered = await optionTexts(page)
  await page.keyboard.press('Escape')
  const at = (name) => offered.indexOf(name)
  assertEq(
    [...offered].sort(),
    ['Europe', 'France', 'Germany', 'LAN', 'North America', 'United States'],
    'offered options',
  )
  if (!(at('Europe') < at('France') && at('Europe') < at('Germany'))) {
    throw new Error(`France and Germany are not listed under Europe: ${offered.join(', ')}`)
  }
  if (!(at('Germany') < at('North America') && at('North America') < at('United States'))) {
    throw new Error(`United States is not listed under North America: ${offered.join(', ')}`)
  }
  await shot('location-options')

  step('AC6: Europe shows both European servers, Germany alone shows one, clearing shows all')
  await setMultiFilter(page, FILTER, ['Europe'])
  assertEq(await visibleLabels(page), ['A', 'B'], 'Europe')
  assertEq(await triggerText(page, FILTER), 'Europe', 'closed control names Europe')
  // Countries under a checked region show checked and cannot be toggled, so Europe goes first.
  await setMultiFilter(page, FILTER, [])
  await setMultiFilter(page, FILTER, ['Germany'])
  assertEq(await visibleLabels(page), ['A'], 'Germany alone')
  await setMultiFilter(page, FILTER, [])
  assertEq(await triggerText(page, FILTER), 'Any', 'control reads Any')
  assertEq(await visibleLabels(page), ['A', 'B', 'C', 'D'], 'cleared')

  step('AC7: typing ger leaves Europe and Germany in the open dropdown')
  await page.getByTestId(FILTER).click({ timeout: TIMEOUT_MS })
  await multiRoot(page, FILTER)
    .getByRole('listbox')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.keyboard.type('ger')
  await page.waitForFunction(
    (id) => document.querySelectorAll(`[data-testid="${id}-option"]`).length === 2,
    FILTER,
    { timeout: TIMEOUT_MS },
  )
  assertEq(await optionTexts(page), ['Europe', 'Germany'], 'options after typing ger')
  assertEq(await page.getByTestId(`${FILTER}-filter`).inputValue(), 'ger', 'filter text')
  await shot('location-typed')
  await page.keyboard.press('Escape')
  await multiRoot(page, FILTER)
    .getByRole('listbox')
    .waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('AC8: the location filter is operated by keyboard alone and announces the count')
  const trigger = page.getByTestId(FILTER)
  const status = multiRoot(page, FILTER).getByRole('status')
  const list = multiRoot(page, FILTER).getByRole('listbox')
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await list.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.keyboard.press('Home')
  await page.keyboard.press('Space')
  await page.waitForFunction(
    (el) => (el?.textContent ?? '').trim() === '1 selected',
    await status.elementHandle(),
    { timeout: TIMEOUT_MS },
  )
  await page.keyboard.press('End')
  await page.keyboard.press('Space')
  await page.waitForFunction(
    (el) => (el?.textContent ?? '').trim() === '2 selected',
    await status.elementHandle(),
    { timeout: TIMEOUT_MS },
  )
  await page.keyboard.press('Escape')
  await list.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  assertEq(
    await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? ''),
    FILTER,
    'focus returns to the trigger',
  )
  assertEq(
    (await readMultiFilter(page, FILTER)).sort(),
    ['Europe', 'France', 'Germany', 'LAN'],
    'keyboard selection',
  )
  assertEq(await visibleLabels(page), ['A', 'B', 'D'], 'Europe and LAN')
  await clearFilters(page)

  step(
    'AC9: a quick filter saves the location selection and the legacy chip applies with location Any',
  )
  await setMultiFilter(page, FILTER, ['Europe'])
  await page.getByTestId('servers-quickfilter-save').click({ timeout: TIMEOUT_MS })
  const nameInput = page.getByTestId('servers-quickfilter-name')
  await nameInput.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await nameInput.fill('Europe only')
  await page.getByTestId('servers-quickfilter-dialog-save').click({ timeout: TIMEOUT_MS })
  await chipNamed(page, 'Europe only').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const stored = await waitForStateJson(
    variantUserDataDir(variant),
    (doc) => doc.servers?.quickFilters?.some((q) => q.name === 'Europe only'),
    'Europe only in servers.quickFilters',
  )
  assertEq(
    stored.servers.quickFilters.find((q) => q.name === 'Europe only').criteria.location,
    ['region:EU'],
    'persisted location criteria',
  )
  await clearFilters(page)
  await chipNamed(page, 'Europe only').click({ timeout: TIMEOUT_MS })
  assertEq(
    await readMultiFilter(page, FILTER),
    ['Europe', 'France', 'Germany'],
    'saved chip location',
  )
  assertEq(await visibleLabels(page), ['A', 'B'], 'saved chip rows')
  await chipNamed(page, 'Legacy CTF').click({ timeout: TIMEOUT_MS })
  assertEq(await triggerText(page, FILTER), 'Any', 'legacy chip leaves location Any')
  assertEq(await visibleLabels(page), ['D'], 'legacy chip rows')
  await clearFilters(page)
  await shot('location-quick-filters')

  step('AC11: Settings > About names DB-IP and CC BY 4.0')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('settings-about').click({ timeout: TIMEOUT_MS })
  const attribution = page.getByTestId('about-geoip-attribution')
  await attribution.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const attributionText = await text(attribution)
  for (const needle of ['DB-IP', 'CC BY 4.0']) {
    if (!attributionText.includes(needle)) {
      throw new Error(`About attribution "${attributionText}" lacks "${needle}"`)
    }
  }
  await shot('about-attribution')

  console.log(
    'servers-location-filter: location column, sort, LAN and detail field (AC1, AC3, AC4), region and ' +
      'country filter with type-to-filter and keyboard operation (AC5-AC8), quick filters persist ' +
      'location and load legacy ones (AC9), About attribution (AC11).',
  )
}
