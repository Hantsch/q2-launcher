// Story 196 D5 (AC6): a LAN scan whose only target answers nothing shows the LAN empty state.
import { writeServersLanFixture } from '../lib/fixture.mjs'
import {
  SCAN_SETTLE_TIMEOUT_MS,
  lanTargetsEnv,
  openServers,
  refreshAndWait,
  rowAddresses,
  setMode,
} from '../lib/servers-lan-flow.mjs'
import { SERVERS_LAN_DEAD_PORT } from '../lib/servers-stub.mjs'

export const variant = 'servers-lan'

export async function setup() {
  writeServersLanFixture()
  return { env: { Q2L_UI_LAN_TARGETS: lanTargetsEnv([SERVERS_LAN_DEAD_PORT]) } }
}

export default async function serversLanEmpty({ page, step, shot }) {
  await openServers(page)
  step('AC6: scan LAN against a target nobody answers')
  await setMode(page, 'lan')
  await refreshAndWait(page)
  const empty = page.getByTestId('servers-list-lan-empty')
  await empty.waitFor({ state: 'visible', timeout: SCAN_SETTLE_TIMEOUT_MS })
  if (((await empty.textContent()) ?? '').trim().length === 0) {
    throw new Error('expected servers-list-lan-empty to carry visible text')
  }
  if ((await rowAddresses(page)).length !== 0) throw new Error('expected no rows in the LAN list')
  await shot('lan-empty')
  console.log('servers-lan-empty: the LAN empty state shows when nothing answers (AC6).')
}
