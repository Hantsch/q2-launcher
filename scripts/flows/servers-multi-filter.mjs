// Mod and map filters are sets on the real Servers surface: four loopback `dgram` responders
// (A opentdm, B baseq2, C baseq2, D ctf), the closed control naming its selection, cross-field
// narrowing, vanished values, quick-filter persistence and keyboard-only operation (story 248).
import { variantUserDataDir } from '../lib/harness.mjs'
import { waitForStateJson } from '../lib/state-json.mjs'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'
import { makeResponderBinder, closeResponder } from '../lib/servers-stub.mjs'
import {
  readFinishedAt,
  readMultiFilter,
  setMultiFilter,
  waitForFinishedAtChange,
  multiRoot,
  makeVisibleLabels,
} from '../lib/servers-flow.mjs'

export const variant = 'servers-multi-filter'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

const bindResponder = makeResponderBinder(
  (hostname, playerLines, { mod, map, maxclients, extraInfoFlags = '' }) => ({
    infoLine:
      `\\gamename\\${mod}\\hostname\\${hostname}\\mapname\\${map}\\clients\\${playerLines.length}` +
      `\\maxclients\\${maxclients}\\version\\3.20\\needpass\\0${extraInfoFlags}`,
    playerLines,
    extra: { hostname },
  }),
)

const NO_CRITERIA = {
  mod: null,
  gamemode: null,
  map: null,
  empty: false,
  hideBotsOnly: false,
  waitingForOpponent: false,
}
// Legacy scalars on purpose: a state.json written before the filters became sets.
const SEEDED_QUICK_FILTERS = [
  { id: 'seed-legacy', name: 'Legacy CTF', criteria: { ...NO_CRITERIA, mod: 'ctf' } },
  { id: 'seed-gone-mod', name: 'Gone mod', criteria: { ...NO_CRITERIA, mod: 'vanishedmod' } },
  { id: 'seed-gone-map', name: 'Gone map', criteria: { ...NO_CRITERIA, map: 'vanishedmap' } },
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

  return {}
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

const sorted = (list) => [...list].sort()
const triggerText = async (page, testId) =>
  ((await page.getByTestId(testId).textContent()) ?? '').trim()

async function expectNamed(page, testId, names, label) {
  const text = await triggerText(page, testId)
  for (const name of names) {
    if (!text.includes(name)) throw new Error(`${label}: closed control "${text}" lacks "${name}"`)
  }
}

const chipNamed = (page, name) =>
  page.getByTestId('servers-quickfilter-chip').filter({ hasText: name })

async function clearFilters(page) {
  await page.getByTestId('servers-filter-clear').click({ timeout: TIMEOUT_MS })
}

/** AC1-AC4 for one field; `a`/`b` are two values with `both` the servers they list together. */
async function fieldSteps(page, step, shot, spec) {
  const { prefix, testId, a, b, both, extraField, vanished } = spec

  step(`${prefix}AC1: checking ${a} and ${b} shows both names on the closed control`)
  await setMultiFilter(page, testId, [a, b])
  await expectNamed(page, testId, [a, b], `${prefix}two values`)
  assertEq(sorted(await readMultiFilter(page, testId)), sorted([a, b]), `${prefix}checked options`)
  await shot(`${prefix.replace(':', '').trim() || 'mod'}-two-values`)

  step(
    `${prefix}AC2: ${a} + ${b} lists servers ${both.slice(0, -1).join(', ')} and ${both.at(-1)} only, and adding ${
      prefix ? 'a mod' : 'a map'
    } narrows across fields`,
  )
  assertEq(await visibleLabels(page), both, `${prefix}${a}+${b}`)
  await setMultiFilter(page, extraField.testId, [extraField.value])
  assertEq(await visibleLabels(page), extraField.narrowed, `${prefix}cross-field`)
  await setMultiFilter(page, extraField.testId, [])

  step(`${prefix}AC3: unchecking every ${prefix ? 'map' : 'mod'} shows Any and all servers`)
  await setMultiFilter(page, testId, [])
  assertEq(await triggerText(page, testId), 'Any', `${prefix}control reads Any`)
  assertEq(await visibleLabels(page), ['A', 'B', 'C', 'D'], `${prefix}all servers`)

  step(
    `${prefix}AC4: a selected ${prefix ? 'map' : 'mod'} no server reports stays checked and named in the control`,
  )
  await chipNamed(page, vanished.chip).click({ timeout: TIMEOUT_MS })
  assertEq(await triggerText(page, testId), vanished.value, `${prefix}vanished named`)
  assertEq(await readMultiFilter(page, testId), [vanished.value], `${prefix}vanished checked`)
  await page
    .getByTestId('servers-filter-no-match')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await setMultiFilter(page, testId, [])
  assertEq(await triggerText(page, testId), 'Any', `${prefix}vanished unchecked`)
}

export default async function serversMultiFilter({ page, step, shot }) {
  step('navigate to the Servers view and scan')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await page
    .getByTestId(`servers-row-${serverA.address}`)
    .waitFor({ state: 'attached', timeout: TIMEOUT_MS })
  assertEq(await visibleLabels(page), ['A', 'B', 'C', 'D'], 'unfiltered')

  await fieldSteps(page, step, shot, {
    prefix: '',
    testId: 'servers-filter-mod',
    a: 'opentdm',
    b: 'ctf',
    both: ['A', 'D'],
    extraField: { testId: 'servers-filter-map', value: 'q2dm1', narrowed: ['A'] },
    vanished: { chip: 'Gone mod', value: 'vanishedmod' },
  })

  step(
    'AC5: a two-mod quick filter persists as an array, and the legacy chip applies as a set of one',
  )
  await setMultiFilter(page, 'servers-filter-mod', ['opentdm', 'ctf'])
  await page.getByTestId('servers-quickfilter-save').click({ timeout: TIMEOUT_MS })
  const nameInput = page.getByTestId('servers-quickfilter-name')
  await nameInput.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await nameInput.fill('Two mods')
  await page.getByTestId('servers-quickfilter-dialog-save').click({ timeout: TIMEOUT_MS })
  await chipNamed(page, 'Two mods').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const stored = await waitForStateJson(
    variantUserDataDir(variant),
    (doc) => doc.servers?.quickFilters?.some((q) => q.name === 'Two mods'),
    'Two mods in servers.quickFilters',
  )
  const twoMods = stored.servers.quickFilters.find((q) => q.name === 'Two mods').criteria.mod
  if (!Array.isArray(twoMods)) throw new Error(`mod persisted as ${JSON.stringify(twoMods)}`)
  assertEq(sorted(twoMods), ['ctf', 'opentdm'], 'persisted two-mod criteria')
  await clearFilters(page)
  await chipNamed(page, 'Legacy CTF').click({ timeout: TIMEOUT_MS })
  assertEq(await readMultiFilter(page, 'servers-filter-mod'), ['ctf'], 'legacy chip as set of one')
  assertEq(await visibleLabels(page), ['D'], 'legacy chip rows')
  await clearFilters(page)
  await shot('quick-filters')

  step('AC6: the mod filter is operated by keyboard alone and announces the count')
  const trigger = page.getByTestId('servers-filter-mod')
  const status = multiRoot(page, 'servers-filter-mod').getByRole('status')
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const list = multiRoot(page, 'servers-filter-mod').getByRole('listbox')
  await list.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.keyboard.press('Space')
  await page.waitForFunction(
    () => document.querySelector('[role="listbox"] [aria-selected="true"]') !== null,
    undefined,
    { timeout: TIMEOUT_MS },
  )
  assertEq(((await status.textContent()) ?? '').trim(), '1 selected', 'live region after one')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await page.waitForFunction(
    (el) => (el?.textContent ?? '').trim() === '2 selected',
    await status.elementHandle(),
    { timeout: TIMEOUT_MS },
  )
  await page.keyboard.press('Escape')
  await list.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  const focusedTestId = await page.evaluate(
    () => document.activeElement?.getAttribute('data-testid') ?? '',
  )
  assertEq(focusedTestId, 'servers-filter-mod', 'focus returns to the trigger')
  await clearFilters(page)

  await fieldSteps(page, step, shot, {
    prefix: 'map: ',
    testId: 'servers-filter-map',
    a: 'q2dm1',
    b: 'q2ctf1',
    both: ['A', 'B', 'D'],
    extraField: { testId: 'servers-filter-mod', value: 'baseq2', narrowed: ['B'] },
    vanished: { chip: 'Gone map', value: 'vanishedmap' },
  })

  console.log(
    'servers-multi-filter: mod and map filters are sets - closed control names the selection (AC1), ' +
      'any-of narrowing across fields (AC2), unchecking all returns to Any (AC3), a vanished value stays ' +
      'checked (AC4), quick filters persist arrays and load legacy scalars (AC5), keyboard operation ' +
      'announces the count (AC6).',
  )
}
