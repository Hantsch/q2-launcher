// Story 122 (docs/requirements/122-a-servers-detail-opens.md) D3: proves the detail pane opens on a
// row click and shows the header fields this D actually ships - engine/protocol (derived from the
// last-known `serverinfo`), the password marker, occupancy and the rest of `ServerDetailHeader.tsx`'s
// fields - against real loopback responders, plus that a malformed field (a bad `protocol`, an
// absent `gamename`/`maxclients`) degrades to a dash instead of breaking the pane.
//
// D4 (players) extends this same flow with a players-section phase - this file only covers the
// header, per this deliverable's own scope.
//
// ## Wire protocol - mirrored, not imported
//
// Same discipline as `scripts/flows/servers-scoped-refresh.mjs`'s own header comment:
// `scripts/*.mjs` never imports `src/` TypeScript, so `encodeLatin1`/`buildInfoReplyBytes`/
// `buildStatusReplyBytes`/`decodeQueryKind` below are copied verbatim from that file (itself mirrored
// from `src/main/modules/servers/scan-integration.test.ts` and matching the byte shape
// `src/shared/servers/reply-fixtures.ts`'s own builders produce).
//
// ## Fixture: three manual servers, every master source disabled, scan autos off
//
// `sources: SERVERS_DISABLED_SOURCES` (GB-A5: never touch a real master/internet host). Three
// loopback `dgram` responders, seeded as manual servers (no favourites needed - this flow never
// exercises scoped refresh):
// - A: a normal, fully-populated server - `hostname`, `mapname q2dm1`, `gamename baseq2`,
//   `maxclients 16`, `protocol 35` (r1q2), `deathmatch 1`, `needpass 1` (odd -> password on, per
//   `scan-service.ts`'s `readServerInfoFields` bit-0 rule), three players (scores 12/0/5, one with
//   `ping 0` - proves a zero ping is shown, not mistaken for "unknown").
// - B: the same info/status shape as A but zero players - not directly asserted on by name in this
//   D's phases, but keeps the round realistic (an all-full-house fixture would be suspicious) and is
//   free groundwork for D4's players-section flow.
// - C: the malformed one - no `gamename` key at all, `maxclients x` (non-numeric) and `protocol abc`
//   (non-numeric), two players. Proves mod/maxclients/engine/protocol all degrade to `—` rather than
//   throwing or showing garbage, while name/map/address (which don't depend on those keys) still
//   render normally.
//
// `scan` is seeded with both auto-behaviours off (mirrors 117 D6's own flow) so every packet is
// attributable to this flow's own "Refresh servers" click.
//
// ## Selectors
//
// `nav-servers` (TitleBar.tsx), `servers-refresh` (ServersView.tsx), `servers-row-<address>` (click
// to select/open detail), `servers-detail` (the pane itself), `servers-detail-field-<key>`
// (ServerDetailHeader.tsx, story 122 D3), `servers-detail-close`.
import { createSocket } from 'node:dgram'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'

export const variant = 'servers-detail'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000

const OOB_PREFIX = Buffer.from([0xff, 0xff, 0xff, 0xff])

function encodeLatin1(text) {
  const bytes = Buffer.alloc(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

function buildInfoReplyBytes(serverinfoLine) {
  return Buffer.concat([OOB_PREFIX, encodeLatin1(`info\n${serverinfoLine}`)])
}

function buildStatusReplyBytes(serverinfoLine, playerLines) {
  const players = playerLines.map((line) => `\n${line}`).join('')
  return Buffer.concat([OOB_PREFIX, encodeLatin1(`print\n${serverinfoLine}${players}`)])
}

function decodeQueryKind(message) {
  const text = message.subarray(4).toString('latin1')
  if (text.startsWith('info')) return 'info'
  if (text.startsWith('status')) return 'status'
  return 'unknown'
}

/** Binds one loopback responder answering both `info` and `status` queries with a fixed serverinfo
 * line and player roster - mirrors `servers-scoped-refresh.mjs`'s `bindResponder`, minus the packet
 * log (this flow never asserts on who-got-queried, only on what the detail pane then shows). */
async function bindResponder(infoLine, playerLines) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`

  socket.on('message', (message, rinfo) => {
    const kind = decodeQueryKind(message)
    if (kind === 'info') {
      socket.send(buildInfoReplyBytes(infoLine), rinfo.port, rinfo.address)
    } else if (kind === 'status') {
      socket.send(buildStatusReplyBytes(infoLine, playerLines), rinfo.port, rinfo.address)
    }
  })

  return { socket, port, address, closed: false }
}

async function closeResponder(responder) {
  if (responder.closed) return
  responder.closed = true
  await new Promise((resolve) => responder.socket.close(() => resolve()))
}

const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

let serverA = null
let serverB = null
let serverC = null
let responders = []

export async function setup() {
  serverA = await bindResponder(
    '\\gamename\\baseq2\\hostname\\Fixture Server A\\mapname\\q2dm1\\clients\\3\\maxclients\\16' +
      '\\protocol\\35\\deathmatch\\1\\needpass\\1\\version\\3.20',
    ['12 5 "Alpha1"', '0 0 "Alpha2"', '5 8 "Alpha3"'],
  )
  serverB = await bindResponder(
    '\\gamename\\baseq2\\hostname\\Fixture Server B\\mapname\\q2dm1\\clients\\0\\maxclients\\16' +
      '\\protocol\\35\\deathmatch\\1\\version\\3.20',
    [],
  )
  serverC = await bindResponder(
    '\\hostname\\Fixture Server C\\mapname\\q2dm2\\clients\\2\\maxclients\\x\\protocol\\abc' +
      '\\deathmatch\\1\\version\\3.20',
    ['3 10 "Charlie1"', '1 20 "Charlie2"'],
  )
  responders = [serverA, serverB, serverC]

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        // GB-A5: every shipped master source present but disabled - never touch a real master.
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
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

function scanStatusLocator(page) {
  return page.getByTestId('servers-scan-status')
}

async function readFinishedAt(page) {
  return (await scanStatusLocator(page).getAttribute('data-finished-at')) ?? ''
}

async function waitForFinishedAtChange(page, previous, timeout) {
  await page.waitForFunction(
    (before) => {
      const el = document.querySelector('[data-testid="servers-scan-status"]')
      return (
        el?.getAttribute('data-running') === 'false' &&
        (el?.getAttribute('data-finished-at') ?? '') !== before &&
        (el?.getAttribute('data-finished-at') ?? '') !== ''
      )
    },
    previous,
    { timeout },
  )
}

async function fieldText(page, key) {
  return page.getByTestId(`servers-detail-field-${key}`).textContent()
}

export default async function serversDetail({ page, step, shot }) {
  step('navigate to the Servers view and run a full scan')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await shot('servers-scanned')

  step('clicking server A opens the detail pane with its header fields')
  await page.getByTestId(`servers-row-${serverA.address}`).click({ timeout: TIMEOUT_MS })
  const detail = page.getByTestId('servers-detail')
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('servers-detail-field-engine').waitFor({ timeout: TIMEOUT_MS })

  const engineA = await fieldText(page, 'engine')
  if (engineA !== 'R1Q2') {
    throw new Error(`expected server A's engine to read "R1Q2", got ${JSON.stringify(engineA)}`)
  }
  const protocolA = await fieldText(page, 'protocol')
  if (protocolA !== '35') {
    throw new Error(`expected server A's protocol to read "35", got ${JSON.stringify(protocolA)}`)
  }
  const gamemodeA = await fieldText(page, 'gamemode')
  if (gamemodeA !== 'Deathmatch') {
    throw new Error(
      `expected server A's gamemode to read "Deathmatch", got ${JSON.stringify(gamemodeA)}`,
    )
  }
  const occupancyA = await fieldText(page, 'occupancy')
  if (occupancyA !== '3/16') {
    throw new Error(`expected server A's occupancy to read "3/16", got ${JSON.stringify(occupancyA)}`)
  }
  const passwordA = await fieldText(page, 'password')
  if (!passwordA || !passwordA.includes('Password')) {
    throw new Error(
      `expected server A's password field to show the password marker, got ${JSON.stringify(passwordA)}`,
    )
  }
  const pingA = await fieldText(page, 'ping')
  if (!pingA || !pingA.endsWith('ms')) {
    throw new Error(`expected server A's ping field to read "<n> ms", got ${JSON.stringify(pingA)}`)
  }
  await shot('detail-server-a')

  step('server A shows its three players, sorted by score by default')
  const playerRows = page.getByTestId('servers-detail-player-row')
  await playerRows.first().waitFor({ timeout: TIMEOUT_MS })
  const scoresByDefault = await playerRows.evaluateAll((rows) =>
    rows.map((row) => row.textContent ?? ''),
  )
  if (scoresByDefault.length !== 3) {
    throw new Error(`expected 3 player rows, got ${scoresByDefault.length}`)
  }
  const scoreOrder = scoresByDefault.map((text) => {
    const match = text.match(/Alpha\d/)
    return match ? match[0] : text
  })
  if (scoreOrder.join(',') !== 'Alpha1,Alpha3,Alpha2') {
    throw new Error(
      `expected default sort order Alpha1(12),Alpha3(5),Alpha2(0), got ${JSON.stringify(scoreOrder)}`,
    )
  }

  const detailPaneTextBefore = await detail.innerText()
  if (/spectat/i.test(detailPaneTextBefore)) {
    throw new Error('detail pane text must not mention spectating (AC4)')
  }

  step('sorting by ping brings the ping-0 player to the top')
  await page.getByTestId('servers-detail-players-sort-ping').click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="servers-detail-player-row"]')?.textContent?.includes(
        'Alpha2',
      ) ?? false,
    { timeout: TIMEOUT_MS },
  )
  await shot('detail-server-a-players-sorted-by-ping')

  step('clicking server C shows dashes for the malformed fields, real values for the rest')
  await page.getByTestId(`servers-row-${serverC.address}`).click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (expectedName) =>
      document.querySelector('[data-testid="servers-detail-field-name"]')?.textContent ===
      expectedName,
    'Fixture Server C',
    { timeout: TIMEOUT_MS },
  )

  const engineC = await fieldText(page, 'engine')
  const protocolC = await fieldText(page, 'protocol')
  const modC = await fieldText(page, 'mod')
  if (engineC !== '—' || protocolC !== '—' || modC !== '—') {
    throw new Error(
      `expected server C's engine/protocol/mod to all read "—", got ${JSON.stringify({
        engineC,
        protocolC,
        modC,
      })}`,
    )
  }
  const nameC = await fieldText(page, 'name')
  const mapC = await fieldText(page, 'map')
  const addressC = await fieldText(page, 'address')
  if (nameC !== 'Fixture Server C' || mapC !== 'q2dm2' || addressC !== serverC.address) {
    throw new Error(
      `expected server C's name/map/address to still render, got ${JSON.stringify({
        nameC,
        mapC,
        addressC,
      })}`,
    )
  }
  await shot('detail-server-c-malformed-fields')

  step('clicking server B (no players) shows the players empty state')
  await page.getByTestId(`servers-row-${serverB.address}`).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-detail-players-empty').waitFor({ timeout: TIMEOUT_MS })
  const detailPaneTextB = await detail.innerText()
  if (/spectat/i.test(detailPaneTextB)) {
    throw new Error('detail pane text must not mention spectating (AC4)')
  }
  await shot('detail-server-b-players-empty')

  step('closing the pane')
  await page.getByTestId('servers-detail-close').click({ timeout: TIMEOUT_MS })
  await page.waitForSelector('[data-testid="servers-detail"]', { state: 'detached', timeout: TIMEOUT_MS })
  await shot('detail-closed')

  console.log(
    'servers-detail: selecting a row opens the detail pane and shows its header fields - engine ' +
      '"R1Q2"/protocol 35/gamemode "Deathmatch"/occupancy "3/16"/password marker/a real ping for a ' +
      "well-formed server, and a dash for engine/protocol/mod (while name/map/address still render) " +
      'for a malformed one - and the close button dismisses the pane.',
  )
}
