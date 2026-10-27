// e2e: the footer's Map select - Play starts a deathmatch in the saved map, a join never does.
// Fixture: one r1q2 installation with game dirs baseq2 + ctf - baseq2/maps/q2dm1.bsp ("The Edge"),
// an unsafe-named baseq2/maps/bad name.bsp, base1 inside baseq2/pak0.pak, and ctf/maps/ctf1.bsp -
// plus one loopback server (baseq2, no password) to join.
import { SERVERS_DISABLED_SOURCES, writePlayWithFixture } from '../lib/fixture.mjs'
import { invoke, launchLines, makeFail, nextLaunchLine } from '../lib/flow-common.mjs'
import { variantUserDataDir } from '../lib/harness.mjs'
import { closeResponder, makeResponderBinder } from '../lib/servers-stub.mjs'
import { readFinishedAt, waitForFinishedAtChange } from '../lib/servers-flow.mjs'
import { waitForStateJson } from '../lib/state-json.mjs'

export const variant = 'footer-map'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

const bindResponder = makeResponderBinder((hostname, playerLines) => ({
  infoLine:
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
    `\\maxclients\\8\\version\\3.20`,
  playerLines,
}))

let server = null
let spawnable = true

export async function setup() {
  server = await bindResponder('Fixture Map Server', ['5 20 "Bravo1"'])
  spawnable = writePlayWithFixture({
    variant,
    servers: {
      sources: SERVERS_DISABLED_SOURCES,
      favourites: [],
      manualServers: [{ address: server.address, origin: 'manual', addedAt: FIXED_ADDED_AT }],
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
  }).spawnable
  return {}
}

export async function teardown() {
  if (server) await closeResponder(server)
}

export default async function footerMap({ page, step, shot }) {
  if (!spawnable) {
    console.log(
      'footer-map: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored locally ' +
        '(`npm run fetch:7za` never ran), so there is no spawnable stand-in client.',
    )
    return
  }

  const { logPath } = await invoke(page, 'app:getInfo')
  const userDataDir = variantUserDataDir(variant)
  const footer = page.locator('footer')
  const mapSelect = footer.getByTestId('actionbar-map')
  const modSelect = footer.getByLabel('Launch with')
  const fail = makeFail('footer-map')

  const goTo = async (id, viewMarker) => {
    await page.getByTestId(`nav-${id}`).click({ timeout: TIMEOUT_MS })
    await footer.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    // The footer is visible before the navigation lands; a view's own control proves it did.
    if (viewMarker)
      await page.getByTestId(viewMarker).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  // A mod switch changes the list asynchronously; the select is enabled with the old list until
  // the new query starts, so a settled list is one that is enabled and has more than "No map".
  const mapEnabled = () =>
    page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="actionbar-map"]')
        return !!el && !el.hasAttribute('disabled') && el.options.length > 1
      },
      undefined,
      { timeout: TIMEOUT_MS },
    )
  const mapOptions = async () =>
    (await mapSelect.locator('option').allTextContents()).map((text) => text.trim())
  const listSettled = (names) =>
    page.waitForFunction(
      (want) => {
        const el = document.querySelector('[data-testid="actionbar-map"]')
        const got = Array.from(el?.options ?? [])
          .slice(1)
          .map((o) => (o.textContent ?? '').trim().split(' ')[0])
        return got.join(',') === want
      },
      names,
      { timeout: TIMEOUT_MS },
    )
  const chooseMod = async (value) => {
    await modSelect.selectOption(value)
    await mapEnabled()
  }
  const chooseMap = async (value) => {
    await mapEnabled()
    await mapSelect.selectOption(value)
  }
  const savedMap = (expected) =>
    waitForStateJson(
      userDataDir,
      (state) => state.installations?.[0]?.activeMap === expected,
      `activeMap ${JSON.stringify(expected)}`,
    )
  // The stand-in client exits within milliseconds; the button is pressable again afterwards.
  const pressAndRead = async (testId) => {
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector(`[data-testid="${id}"]`)
        return !!el && !el.hasAttribute('disabled')
      },
      testId,
      { timeout: TIMEOUT_MS },
    )
    const before = launchLines(logPath).length
    await page.getByTestId(testId).first().click({ timeout: TIMEOUT_MS })
    return nextLaunchLine(logPath, before)
  }

  step('AC1: the footer shows a Map select on Home and Library')
  for (const id of ['home', 'library']) {
    await goTo(id)
    await mapSelect.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  await goTo('home')
  await shot('footer-map')

  step('AC2: no Map select on Servers and Demos')
  await goTo('servers', 'servers-filter-search')
  if ((await mapSelect.count()) !== 0) fail('Servers still shows the Map select')
  await goTo('replays', 'replays-refresh')
  if ((await mapSelect.count()) !== 0) fail('Demos still shows the Map select')
  await goTo('home')

  step('AC3: the map list follows the mod and is sorted')
  await chooseMod('ctf')
  await listSettled('base1,ctf1,q2dm1')
  const ctfMaps = await mapOptions()
  const ctfNames = ctfMaps.slice(1).map((label) => label.split(' ')[0])
  if (
    ctfMaps[0] !== 'No map' ||
    ctfNames.join(',') !== 'base1,ctf1,q2dm1' ||
    !ctfMaps.some((label) => label.includes('The Edge'))
  ) {
    fail(`ctf maps were ${JSON.stringify(ctfMaps)}`)
  }
  await chooseMod('')
  await listSettled('base1,q2dm1')
  const baseMaps = await mapOptions()
  const baseNames = baseMaps.slice(1).map((label) => label.split(' ')[0])
  if (baseMaps[0] !== 'No map' || baseNames.join(',') !== 'base1,q2dm1') {
    fail(`base maps were ${JSON.stringify(baseMaps)}`)
  }
  for (const labels of [ctfMaps, baseMaps]) {
    if (labels.some((label) => label.includes('bad name'))) fail('"bad name" is offered')
  }

  step('AC4: Play with a map starts a deathmatch in it')
  await chooseMod('ctf')
  await chooseMap('ctf1')
  const withMap = await pressAndRead('actionbar-play')
  if (
    !withMap.includes('+set game ctf +set deathmatch 1') ||
    !withMap.trimEnd().endsWith('+map ctf1')
  ) {
    fail(`unexpected launching line ${JSON.stringify(withMap)}`)
  }

  step('AC5: No map starts at the menu')
  await chooseMap('')
  const noMap = await pressAndRead('actionbar-play')
  if (noMap.includes('+map') || noMap.includes('deathmatch')) {
    fail(`a start without a map carried map arguments: ${JSON.stringify(noMap)}`)
  }

  step('AC6: the map is saved and the rail and Library card start in it')
  await chooseMap('ctf1')
  await savedMap('ctf1')
  await goTo('library')
  const fromCard = await pressAndRead('library-play')
  if (!fromCard.trimEnd().endsWith('+map ctf1')) {
    fail(`the Library card did not start in ctf1: ${JSON.stringify(fromCard)}`)
  }
  // The rail's Play lives on the tile's hover card.
  await page.getByTestId('installation-tile').first().hover({ timeout: TIMEOUT_MS })
  const fromRail = await pressAndRead('rail-play')
  if (!fromRail.trimEnd().endsWith('+map ctf1')) {
    fail(`the rail did not start in ctf1: ${JSON.stringify(fromRail)}`)
  }
  await goTo('home')

  step('AC7: switching to a mod without the map resets it')
  await mapSelect.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await mapEnabled()
  if ((await mapSelect.inputValue()) !== 'ctf1') fail('ctf1 was not restored on Home')
  await chooseMod('')
  await page.waitForFunction(
    () => document.querySelector('[data-testid="actionbar-map"]')?.value === '',
    undefined,
    { timeout: TIMEOUT_MS },
  )
  await savedMap('')
  await shot('map-reset')

  step('AC8: a server join never passes the saved map')
  await chooseMap('q2dm1')
  await savedMap('q2dm1')
  await goTo('servers', 'servers-refresh')
  const finishedAtBefore = await readFinishedAt(page)
  await page.getByTestId('servers-refresh').click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await page.getByTestId(`servers-row-${server.address}`).click({ timeout: TIMEOUT_MS })
  const joinLine = await pressAndRead('actionbar-play')
  if (
    !joinLine.includes(`+connect ${server.address}`) ||
    joinLine.includes('+map') ||
    joinLine.includes('deathmatch')
  ) {
    fail(`a join carried the saved map: ${JSON.stringify(joinLine)}`)
  }
  await shot('join')
}
