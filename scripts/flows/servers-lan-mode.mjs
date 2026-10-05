// Story 196 (docs/requirements/196-i-switch-the-browser-between-online-and-lan.md) D5: the e2e
// proof of the Online/LAN toggle (AC1, AC2, AC3, AC4, AC5, AC8) through the real UI.
//
// Fixture: `writeServersLanFixture()` - favourite (stub A), manual (dead) and the stub http-list
// source (stub B). The LAN target is a responder in none of those, listed TWICE in
// `Q2L_UI_LAN_TARGETS` (harness-only, replaces interface enumeration) to prove de-duplication.
import { SERVERS_MANUAL_SERVER_ADDRESS, writeServersLanFixture } from '../lib/fixture.mjs'
import {
  ONLINE_RESPONDERS,
  TIMEOUT_MS,
  assertMode,
  assertRows,
  assertRowsSoon,
  lanTargetsEnv,
  openServers,
  refreshAndWait,
  rowAddresses,
  setMode,
  waitForScanIdle,
} from '../lib/servers-lan-flow.mjs'
import {
  SERVERS_STUB_LAN_RESPONDER,
  SERVERS_STUB_LIST_PORT,
  startListServer,
  startServerResponders,
} from '../lib/servers-stub.mjs'

export const variant = 'servers-lan'

const LAN = SERVERS_STUB_LAN_RESPONDER
const LAN_ADDRESS = `127.0.0.1:${LAN.port}`
const ONLINE_RESPONDER_ADDRESSES = ONLINE_RESPONDERS.map((spec) => `127.0.0.1:${spec.port}`)
// favourite + list-source server + the (unanswering) manual server: every online origin has a row
const ONLINE_ADDRESSES = [...ONLINE_RESPONDER_ADDRESSES, SERVERS_MANUAL_SERVER_ADDRESS]

let responders = null
let listServer = null

export async function setup() {
  writeServersLanFixture()
  listServer = await startListServer(SERVERS_STUB_LIST_PORT)
  listServer.setAddresses([ONLINE_RESPONDER_ADDRESSES[1]])
  responders = await startServerResponders([...ONLINE_RESPONDERS, LAN])
  return { env: { Q2L_UI_LAN_TARGETS: lanTargetsEnv([LAN.port, LAN.port]) } }
}

export async function teardown() {
  try {
    if (responders) responders.close()
  } finally {
    if (listServer) listServer.close()
  }
}

export default async function serversLanMode({ page, step, shot }) {
  await openServers(page)

  step('AC1: the browser opens on Online')
  await assertMode(page, 'online')

  step('online scan: favourite + list rows, no LAN-only row')
  await refreshAndWait(page)
  assertRows(await rowAddresses(page), ONLINE_ADDRESSES, 'online after scan')
  const listRequestsBefore = listServer.requestCount()
  if (listRequestsBefore < 1) throw new Error('expected the online scan to query the list source')
  await shot('online')

  step('AC2/AC3: switching to LAN and scanning shows exactly one LAN row, without touching sources')
  await setMode(page, 'lan')
  await assertMode(page, 'lan')
  await refreshAndWait(page)
  assertRows(await rowAddresses(page), [LAN_ADDRESS], 'LAN after scan (target listed twice)')
  if (listServer.requestCount() !== listRequestsBefore) {
    throw new Error(
      `expected no http-list request during the LAN scan, saw ${listServer.requestCount() - listRequestsBefore}`,
    )
  }
  await shot('lan')

  step('AC4: the LAN row carries name, map, players and ping')
  const row = page.getByTestId(`servers-row-${LAN_ADDRESS}`)
  const text = (await row.textContent()) ?? ''
  for (const [what, ok] of [
    ['name', text.includes(LAN.hostname)],
    ['map', text.includes(LAN.map)],
    ['players', /\d+\s*\/\s*\d+/.test(text)],
    ['ping', /\d+\s*ms/.test(text)],
  ]) {
    if (!ok) throw new Error(`LAN row is missing its ${what}: ${JSON.stringify(text)}`)
  }

  step('AC4: the LAN row opens the detail with Join')
  await row.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-detail').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('servers-detail-join').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('lan-detail')
  await page.getByTestId('servers-detail-close').click({ timeout: TIMEOUT_MS })

  step('AC5: Online again shows its rows at once, without the LAN-only row')
  await setMode(page, 'online')
  await waitForScanIdle(page, 1_000)
  await assertRowsSoon(page, ONLINE_ADDRESSES, 'back on Online')

  step('AC5: back to LAN shows the LAN row at once')
  await setMode(page, 'lan')
  await waitForScanIdle(page, 1_000)
  await assertRowsSoon(page, [LAN_ADDRESS], 'back on LAN')

  step('AC8: the search filter applies to the LAN list')
  const search = page.getByTestId('servers-filter-search')
  await search.fill('no-such-lan-server')
  await page
    .getByTestId('servers-filter-no-match')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertRows(await rowAddresses(page), [], 'LAN list filtered to nothing')
  await search.fill('LAN Server')
  await page
    .getByTestId(`servers-row-${LAN_ADDRESS}`)
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertRows(await rowAddresses(page), [LAN_ADDRESS], 'LAN list filtered by name')
  await shot('lan-filtered')
  await search.fill('')

  step('the ping limit applies to the LAN list')
  const maxPing = page.getByTestId('servers-filter-max-ping')
  await maxPing.selectOption('50')
  assertRows(await rowAddresses(page), [LAN_ADDRESS], 'LAN row under < 50')
  responders.setDelayMs(100)
  await refreshAndWait(page)
  await page
    .getByTestId(`servers-row-${LAN_ADDRESS}`)
    .waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  assertRows(await rowAddresses(page), [], 'slow LAN row under < 50')
  await maxPing.selectOption('150')
  await page
    .getByTestId(`servers-row-${LAN_ADDRESS}`)
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertRows(await rowAddresses(page), [LAN_ADDRESS], 'slow LAN row under < 150')
  await maxPing.selectOption('')
  responders.setDelayMs(0)

  console.log('servers-lan-mode: AC1-AC5, AC8 and the ping limit verified through the UI.')
}
