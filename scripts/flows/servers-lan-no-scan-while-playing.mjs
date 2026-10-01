// Story 196 D5 (AC7): no LAN scan runs while the game does. autoScanOnOpen is ON so switching to a
// never-scanned LAN would scan on its own if it were allowed to.
import { INSTALL_ONE_ID, writeServersLanFixture } from '../lib/fixture.mjs'
import {
  SCAN_SETTLE_TIMEOUT_MS,
  TIMEOUT_MS,
  assertRows,
  lanTargetsEnv,
  openServers,
  readFinishedAt,
  rowAddresses,
  setMode,
} from '../lib/servers-lan-flow.mjs'
import {
  SERVERS_STUB_LAN_RESPONDER,
  SERVERS_STUB_LIST_PORT,
  startListServer,
  startServerResponders,
} from '../lib/servers-stub.mjs'

export const variant = 'servers-lan'

let responders = null
let listServer = null

export async function setup() {
  writeServersLanFixture({ autoScanOnOpen: true })
  listServer = await startListServer(SERVERS_STUB_LIST_PORT)
  listServer.setAddresses([])
  responders = await startServerResponders([SERVERS_STUB_LAN_RESPONDER])
  return { env: { Q2L_UI_LAN_TARGETS: lanTargetsEnv([SERVERS_STUB_LAN_RESPONDER.port]) } }
}

export async function teardown() {
  try {
    if (responders) responders.close()
  } finally {
    if (listServer) listServer.close()
  }
}

export default async function serversLanNoScanWhilePlaying({ page, step, shot }) {
  await openServers(page)
  // Let the on-open online scan finish before the game "starts".
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid="servers-scan-status"]')?.getAttribute('data-finished-at') ??
        '') !== '',
    null,
    { timeout: SCAN_SETTLE_TIMEOUT_MS },
  )

  step('simulate the game running')
  const outcome = await page.evaluate(
    (id) => window.q2.invoke('dev:simulateLaunch', { installationId: id, phase: 'running' }),
    INSTALL_ONE_ID,
  )
  if (!outcome?.ok) throw new Error(`dev:simulateLaunch(running) failed: ${JSON.stringify(outcome)}`)
  const finishedAtBefore = await readFinishedAt(page)

  step('AC7: switching to LAN does not scan; the blocked reason is visible')
  await setMode(page, 'lan')
  const blocked = page.getByTestId('servers-scan-blocked')
  await blocked.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (((await blocked.textContent()) ?? '').trim().length === 0) {
    throw new Error('expected servers-scan-blocked to carry visible text')
  }
  await page.waitForTimeout(2_000)
  if ((await readFinishedAt(page)) !== finishedAtBefore) {
    throw new Error('expected no scan to finish while the game runs, data-finished-at changed')
  }
  assertRows(await rowAddresses(page), [], 'LAN list while the game runs')

  step('AC7: a LAN refresh is refused with the visible reason')
  if (!(await page.getByTestId('servers-refresh').isDisabled())) {
    throw new Error('expected servers-refresh to be disabled while the game runs')
  }
  await blocked.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('lan-blocked')
  console.log('servers-lan-no-scan-while-playing: LAN scan blocked with a visible reason (AC7).')
}
