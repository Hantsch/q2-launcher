// Story 196 D5 (AC9): with no usable network interface the toggle stays and the LAN failure says why.
import { writeServersLanFixture } from '../lib/fixture.mjs'
import {
  TIMEOUT_MS,
  lanTargetsEnv,
  openServers,
  refreshAndWait,
  setMode,
} from '../lib/servers-lan-flow.mjs'

export const variant = 'servers-lan'

// en.json servers.lan.error.noInterface
const NO_INTERFACE_TEXT = 'No local network connection found.'

export async function setup() {
  writeServersLanFixture()
  return { env: { Q2L_UI_LAN_TARGETS: lanTargetsEnv('none') } }
}

export default async function serversLanUnavailable({ page, step, shot }) {
  await openServers(page)
  step('AC9: the toggle is visible even though LAN cannot work')
  await page.getByTestId('servers-mode-lan').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await setMode(page, 'lan')
  await refreshAndWait(page)
  const failure = page.getByTestId('servers-lan-failure')
  await failure.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = ((await failure.textContent()) ?? '').trim()
  if (!text.includes(NO_INTERFACE_TEXT)) {
    throw new Error(
      `expected the failure to say ${JSON.stringify(NO_INTERFACE_TEXT)}, got ${JSON.stringify(text)}`,
    )
  }
  await page.getByTestId('servers-mode-lan').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('lan-unavailable')
  console.log('servers-lan-unavailable: toggle stays, failure names the missing connection (AC9).')
}
