// Story 197 D3: saving the current filter as a named quick filter and applying it from a chip, on the
// real Servers surface. Same four loopback responders as servers-filter-search.mjs (helpers copied, not
// imported). Steps are kept separate so D4 can append rename/delete/persistence/resilience steps.
import { variantUserDataDir } from '../lib/harness.mjs'
import { waitForStateJson } from '../lib/state-json.mjs'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'
import { makeResponderBinder, closeResponder } from '../lib/servers-stub.mjs'
import {
  readFinishedAt,
  readMultiFilter,
  setMultiFilter,
  waitForFinishedAtChange,
} from '../lib/servers-flow.mjs'

export const variant = 'servers-quick-filters'

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

const NO_CRITERIA = {
  mod: null,
  gamemode: null,
  map: null,
  empty: false,
  hideBotsOnly: false,
  waitingForOpponent: false,
}
// Story 197 AC7/AC8: a filter whose mod no row carries, one damaged entry between two good ones.
const SEEDED_QUICK_FILTERS = [
  { id: 'seed-ghost', name: 'Ghost mod', criteria: { ...NO_CRITERIA, mod: 'nosuchmod' } },
  { id: 'seed-broken', name: 7, criteria: 'not-an-object' },
  { id: 'seed-waiting', name: 'Waiting', criteria: { ...NO_CRITERIA, waitingForOpponent: true } },
]

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
  serverD = await bindResponder('Fixture Server D', ['1 1 "Zulu"', '2 2 "Yankee"', '3 3 "Xray"'], {
    mod: 'ctf',
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

const chips = (page) => page.getByTestId('servers-quickfilter-chip')
const chipNamed = (page, name) => chips(page).filter({ hasText: name })

async function pressed(locator) {
  return (await locator.getAttribute('aria-pressed')) === 'true'
}

function assertEq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function saveAs(page, name) {
  await page.getByTestId('servers-quickfilter-save').click({ timeout: TIMEOUT_MS })
  const input = page.getByTestId('servers-quickfilter-name')
  await input.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await input.fill(name)
}

export default async function serversQuickFilters({ page, step, shot }) {
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

  step('AC1: save is disabled with a visible reason while the filter has no criteria')
  const save = page.getByTestId('servers-quickfilter-save')
  if (!(await save.isDisabled())) throw new Error('save should be disabled on an empty filter')
  const reason = (await page.getByTestId('servers-quickfilter-save-reason').textContent()) ?? ''
  if (!reason.includes('Set a mod')) throw new Error(`unexpected save reason "${reason}"`)
  assertEq(await chips(page).count(), 2, 'only the two seeded chips yet')
  await shot('save-disabled')

  step('AC1: search text alone is not a criterion')
  await page.getByTestId('servers-filter-search').fill('zulu')
  if (!(await save.isDisabled())) throw new Error('save should stay disabled with only a search')
  await page.getByTestId('servers-filter-search').fill('')

  step('AC1: picking a mod enables save, and the dialog asks for a name')
  await setMultiFilter(page, 'servers-filter-mod', ['baseq2'])
  if (await save.isDisabled()) throw new Error('save should be enabled once a mod is picked')
  if ((await page.getByTestId('servers-quickfilter-save-reason').count()) !== 0) {
    throw new Error('the save reason should be gone once save is enabled')
  }
  await save.click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-quickfilter-name')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await page.getByTestId('servers-quickfilter-dialog-save').isDisabled())) {
    throw new Error('dialog save should be disabled until a name is entered')
  }
  await shot('name-dialog')

  step('AC2: save as "Base duels" -> the chip appears, pressed, and state.json holds it')
  await page.getByTestId('servers-quickfilter-name').fill('Base duels')
  await page.getByTestId('servers-quickfilter-dialog-save').click({ timeout: TIMEOUT_MS })
  await chipNamed(page, 'Base duels').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertEq(await chips(page).count(), 3, 'three chips')
  assertEq(
    ((await chipNamed(page, 'Base duels').textContent()) ?? '').trim(),
    'Base duels',
    'chip label',
  )
  if (!(await pressed(chipNamed(page, 'Base duels'))))
    throw new Error('chip should be pressed while the filter equals it')
  await shot('chip-saved')
  const persisted = (
    await waitForStateJson(
      variantUserDataDir(variant),
      (doc) => doc.servers?.quickFilters?.some((q) => q.name === 'Base duels'),
      'Base duels in servers.quickFilters',
    )
  ).servers.quickFilters
  assertEq(
    persisted.filter((q) => q.name === 'Base duels').map((q) => q.criteria.mod),
    [['baseq2']],
    'persisted Base duels',
  )

  step('AC2: change the filter, then clicking the chip restores exactly the saved criteria')
  await setMultiFilter(page, 'servers-filter-mod', ['ctf'])
  await page.getByTestId('servers-filter-empty').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-filter-search').fill('keepme')
  if (await pressed(chipNamed(page, 'Base duels')))
    throw new Error('chip should not be pressed after changing the filter')
  await chipNamed(page, 'Base duels').click({ timeout: TIMEOUT_MS })
  assertEq(await readMultiFilter(page, 'servers-filter-mod'), ['baseq2'], 'mod restored')
  assertEq(await pressed(page.getByTestId('servers-filter-empty')), false, 'empty restored off')
  assertEq(await page.getByTestId('servers-filter-search').inputValue(), 'keepme', 'search kept')

  step('AC3: pressed chip shows aria-pressed and a check icon; clicking it clears the criteria')
  await page.getByTestId('servers-filter-search').fill('')
  if (!(await pressed(chipNamed(page, 'Base duels')))) throw new Error('chip should be pressed')
  assertEq(
    await chipNamed(page, 'Base duels').locator('svg.lucide-check').count(),
    1,
    'check icon while pressed',
  )
  await chipNamed(page, 'Base duels').click({ timeout: TIMEOUT_MS })
  assertEq(await pressed(chipNamed(page, 'Base duels')), false, 'chip unpressed after clear')
  assertEq(
    await chipNamed(page, 'Base duels').locator('svg.lucide-check').count(),
    0,
    'no check icon when off',
  )
  assertEq(await readMultiFilter(page, 'servers-filter-mod'), [], 'mod cleared')

  step('AC5: a taken name shows the reason plus Overwrite; overwriting keeps a single chip')
  await setMultiFilter(page, 'servers-filter-mod', ['ctf'])
  await saveAs(page, 'base DUELS')
  await page
    .getByTestId('servers-quickfilter-overwrite')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const dialogText = (await page.getByTestId('servers-quickfilter-dialog').textContent()) ?? ''
  if (!dialogText.includes('already exists'))
    throw new Error(`taken reason missing: "${dialogText}"`)
  if (!(await page.getByTestId('servers-quickfilter-dialog-save').isDisabled())) {
    throw new Error('plain save must stay disabled for a taken name')
  }
  await shot('taken-name')
  await page.getByTestId('servers-quickfilter-overwrite').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-quickfilter-name')
    .waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  assertEq(await chips(page).count(), 3, 'still three chips after overwrite')
  if (!(await pressed(chipNamed(page, 'Base duels'))))
    throw new Error('overwritten chip should equal the current filter (ctf)')
  await chipNamed(page, 'Base duels').click({ timeout: TIMEOUT_MS })
  assertEq(await readMultiFilter(page, 'servers-filter-mod'), [], 'cleared via overwritten chip')

  step('AC9: the built-in toggles still toggle with custom chips present')
  for (const id of ['servers-filter-waiting', 'servers-filter-empty', 'servers-filter-hide-bots']) {
    const toggle = page.getByTestId(id)
    await toggle.click({ timeout: TIMEOUT_MS })
    assertEq(await pressed(toggle), true, `${id} on`)
    await toggle.click({ timeout: TIMEOUT_MS })
    assertEq(await pressed(toggle), false, `${id} off`)
  }
  await shot('builtins-with-custom-chip')

  step('AC8: the damaged seeded entry is dropped silently - two good chips, no toast')
  assertEq(await chipNamed(page, 'Ghost mod').count(), 1, 'Ghost mod chip')
  assertEq(await chipNamed(page, 'Waiting').count(), 1, 'Waiting chip')
  const toasts = await page.locator('div[role="status"].panel-raised').allTextContents()
  // The populated fixture raises its own unrelated "installations need attention" toast.
  assertEq(
    toasts.filter((text) => /quick filter|filter/i.test(text)),
    [],
    'no quick-filter toast',
  )

  step(
    'AC7: a chip whose mod no row carries applies, shows the value, and the no-match state keeps the bar intact',
  )
  await chipNamed(page, 'Ghost mod').click({ timeout: TIMEOUT_MS })
  assertEq(
    await readMultiFilter(page, 'servers-filter-mod'),
    ['nosuchmod'],
    'mod select shows the value',
  )
  await page
    .getByTestId('servers-filter-no-match')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('servers-filter-clear').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertEq(await chips(page).count(), 3, 'bar intact')
  await shot('ghost-mod-no-match')

  step('AC4: rename via the kebab changes the chip label and state.json')
  const ghostMenu = chipNamed(page, 'Ghost mod')
    .locator('xpath=ancestor::div[2]')
    .getByTestId('servers-quickfilter-menu')
  await ghostMenu.click({ timeout: TIMEOUT_MS })
  await page.getByRole('menuitem', { name: 'Rename' }).click({ timeout: TIMEOUT_MS })
  const renameInput = page.getByTestId('servers-quickfilter-name')
  await renameInput.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertEq(await renameInput.inputValue(), 'Ghost mod', 'rename prefilled')
  if ((await page.getByTestId('servers-quickfilter-overwrite').count()) !== 0)
    throw new Error('rename must not offer Overwrite')
  await renameInput.fill('Phantom')
  await page.getByTestId('servers-quickfilter-dialog-save').click({ timeout: TIMEOUT_MS })
  await renameInput.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  assertEq(await chipNamed(page, 'Phantom').count(), 1, 'renamed chip')
  assertEq(await chipNamed(page, 'Ghost mod').count(), 0, 'old name gone')
  assertEq(
    await pressed(chipNamed(page, 'Phantom')),
    true,
    'renamed chip still pressed (criteria unchanged)',
  )

  step(
    'AC4: deleting the pressed chip leaves the current filter and the no-match state as they were',
  )
  await chipNamed(page, 'Phantom')
    .locator('xpath=ancestor::div[2]')
    .getByTestId('servers-quickfilter-menu')
    .click({ timeout: TIMEOUT_MS })
  await page.getByRole('menuitem', { name: 'Delete' }).click({ timeout: TIMEOUT_MS })
  await chipNamed(page, 'Phantom').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  assertEq(
    await readMultiFilter(page, 'servers-filter-mod'),
    ['nosuchmod'],
    'filter untouched by delete',
  )
  await page
    .getByTestId('servers-filter-no-match')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC6: state.json holds the list and the chips survive a reload')
  const expectedNames = ['Base duels', 'Waiting']
  const storedNames = (doc) => doc.servers.quickFilters.map((q) => q.name).sort()
  const stored = await waitForStateJson(
    variantUserDataDir(variant),
    (doc) => storedNames(doc).join('|') === expectedNames.join('|'),
    'state.json quickFilters',
  )
  assertEq(storedNames(stored), expectedNames, 'state.json quickFilters')
  await page.reload()
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await chips(page).first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertEq(
    (await chips(page).allTextContents()).map((x) => x.trim()).sort(),
    expectedNames,
    'chips after reload',
  )
  await shot('after-reload')

  console.log(
    'servers-quick-filters: save gating (AC1), chip apply (AC2), pressed/clear (AC3), rename/delete (AC4), overwrite (AC5), persistence (AC6), unknown mod (AC7), damaged entry (AC8), built-ins intact (AC9).',
  )
}
