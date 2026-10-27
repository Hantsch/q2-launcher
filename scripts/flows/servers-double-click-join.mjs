// Double-clicking a server row joins it while Settings > Servers > "double-click joins" is on; with
// it off a double-click only selects. Fixture shape mirrors `servers-actionbar-join.mjs`: one
// loopback responder (baseq2, no password) and the stand-in client's `launching` log line as proof.
import { SERVERS_DISABLED_SOURCES, writeJoinFixture } from '../lib/fixture.mjs'
import { makeResponderBinder, closeResponder } from '../lib/servers-stub.mjs'
import { readFinishedAt, waitForFinishedAtChange } from '../lib/servers-flow.mjs'
import { invoke, launchLines, nextLaunchLine, sleep } from '../lib/flow-common.mjs'

export const variant = 'servers-double-click-join'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const NO_JOIN_WAIT_MS = 1_500
const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

const bindResponder = makeResponderBinder((hostname, playerLines) => ({
  infoLine:
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
    '\\maxclients\\8\\version\\3.20',
  playerLines,
}))

let server = null
let spawnable = true

export async function setup() {
  server = await bindResponder('Fixture Server B', ['5 20 "Bravo1"'])
  const fixture = writeJoinFixture({
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
  })
  spawnable = fixture.spawnable
  return {}
}

export async function teardown() {
  await closeResponder(server)
}

export default async function serversDoubleClickJoin({ page, step, shot }) {
  if (!spawnable) {
    console.log(
      'servers-double-click-join: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored locally ' +
        '(`npm run fetch:7za` never ran), so there is no spawnable stand-in client.',
    )
    return
  }

  const row = page.getByTestId(`servers-row-${server.address}`)
  const { logPath } = await invoke(page, 'app:getInfo')

  step('scan the fixture server into the list')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('double-click joins the server while the setting is on')
  const launchesBefore = launchLines(logPath).length
  await row.dblclick({ timeout: TIMEOUT_MS })
  const launchLine = await nextLaunchLine(logPath, launchesBefore)
  if (!launchLine.includes(`+connect ${server.address}`)) {
    throw new Error(
      `expected the new "launching" line to contain "+connect ${server.address}", got ${JSON.stringify(launchLine)}`,
    )
  }
  await shot('double-click-joined')

  step('with the setting off, double-click only selects')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  const doubleClickSwitch = page
    .getByTestId('servers-list-settings-double-click-joins')
    .getByRole('switch')
  await doubleClickSwitch.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await doubleClickSwitch.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="servers-list-settings-double-click-joins"] [role="switch"]')
        ?.getAttribute('aria-checked') === 'false',
    undefined,
    { timeout: TIMEOUT_MS },
  )

  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const launchesAfterJoin = launchLines(logPath).length
  await row.dblclick({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (testId) =>
      document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-selected') === 'true',
    `servers-row-${server.address}`,
    { timeout: TIMEOUT_MS },
  )
  // The join, were it going to happen, spawns within milliseconds; give it that long to not appear.
  await sleep(NO_JOIN_WAIT_MS)
  if (launchLines(logPath).length !== launchesAfterJoin) {
    throw new Error('a double-click launched the game although "double-click joins" is off')
  }
  await shot('double-click-selects-only')
}
