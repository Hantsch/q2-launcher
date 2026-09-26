// Story 118 (docs/requirements/118-a-server-row-says-whats-going-on.md) D3: the row-marker e2e
// proof on the real Servers surface - four genuine loopback `dgram` responders (A/B/C/D) plus a
// fifth manual address with no responder at all, proving every marker `ServerRow.tsx` can show
// (password/gamemode/favourite/stale/waiting/pending) actually appears on real scan data, not just
// in the component's own unit tests.
//
// Mirrors `servers-scoped-refresh.mjs`'s `bindResponder`/fixture-seeding/`waitForFinishedAtChange`
// pattern verbatim (copied, not imported - `scripts/*.mjs` never imports another flow file, same
// discipline as that file's own header comment about not importing `src/` TypeScript).
import { createSocket } from 'node:dgram'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'

export const variant = 'servers-row-markers'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000

const OOB_PREFIX = Buffer.from([0xff, 0xff, 0xff, 0xff])

function encodeLatin1(text) {
  const bytes = Buffer.alloc(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

function buildInfoReplyBytes(serverinfoLine) {
  // A real `info` reply is not an infostring but Quake II's `"%16s %8s %2i/%2i\n"` summary line
  // (`src/shared/servers/reply-fixtures.ts`'s `formatInfoLine`) - only these four keys survive.
  const parts = serverinfoLine.split('\\').slice(1)
  const kv = {}
  for (let i = 0; i + 1 < parts.length; i += 2) kv[parts[i]] = parts[i + 1]
  const count = (value) => (/^\d+$/.test(value ?? '') ? value : '0') // `%2i` always prints a number
  const line =
    `${(kv.hostname ?? '').padStart(16)} ${(kv.mapname ?? '').padStart(8)} ` +
    `${count(kv.clients).padStart(2)}/${count(kv.maxclients).padStart(2)}\n`
  return Buffer.concat([OOB_PREFIX, encodeLatin1(`info\n${line}`)])
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

/** Binds one loopback responder. `extraInfoFlags` is appended verbatim to the `info`/`status`
 * serverinfo line (e.g. `\deathmatch\1\ctf\1`) and `needpass` toggles the `\needpass\1` key -
 * both feed `deriveGamemode`/the password marker on the real row. */
async function bindResponder(hostname, playerLines, { extraInfoFlags = '', needpass = false } = {}) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`
  const infoLine =
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
    `\\maxclients\\8\\version\\3.20${needpass ? '\\needpass\\1' : ''}${extraInfoFlags}`
  const responder = { socket, port, address, hostname, log: { info: 0, status: 0 }, closed: false }

  socket.on('message', (message, rinfo) => {
    const kind = decodeQueryKind(message)
    if (kind === 'info') {
      responder.log.info += 1
      socket.send(buildInfoReplyBytes(infoLine), rinfo.port, rinfo.address)
    } else if (kind === 'status') {
      responder.log.status += 1
      socket.send(buildStatusReplyBytes(infoLine, playerLines), rinfo.port, rinfo.address)
    }
  })

  return responder
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
let serverD = null
/** The fifth manual address: a real, bound-then-closed loopback port, so it is a syntactically
 * valid, currently-unreachable address rather than a guessed free port that might collide. */
let ghostAddress = null
let ghostSocket = null
let responders = []

export async function setup() {
  serverA = await bindResponder('Fixture Server A (Favourite)', ['5 20 "Alpha1"'], {
    needpass: true,
    extraInfoFlags: '\\deathmatch\\1\\ctf\\1',
  })
  serverB = await bindResponder('Fixture Server B', ['7 15 "Bravo1"', '3 9 "Bravo2"'], {
    extraInfoFlags: '\\deathmatch\\1',
  })
  serverC = await bindResponder('Fixture Server C', [])
  serverD = await bindResponder('Fixture Server D', ['1 1 "Delta1"'], {
    extraInfoFlags: '\\deathmatch\\1',
  })
  responders = [serverA, serverB, serverC, serverD]

  // Bind a socket only to mint a real, currently-free loopback port, then close it immediately -
  // the fifth manual address answers nobody, ever.
  ghostSocket = createSocket('udp4')
  await new Promise((resolve) => ghostSocket.bind(0, '127.0.0.1', resolve))
  const ghostPort = ghostSocket.address().port
  ghostAddress = `127.0.0.1:${ghostPort}`
  await new Promise((resolve) => ghostSocket.close(() => resolve()))

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [{ address: serverA.address, addedAt: FIXED_ADDED_AT }],
        manualServers: [...responders, { address: ghostAddress }].map((entry) => ({
          address: entry.address,
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

/** Waits for the element to actually appear (the initial `readScan()` after mount, and each
 * post-round `readScan()` after a `scan.changed` push, are both async) before asserting on it -
 * an instant `.count()` would race a render that just hasn't landed yet. */
async function assertExists(page, testId, label) {
  try {
    await page.getByTestId(testId).first().waitFor({ state: 'attached', timeout: TIMEOUT_MS })
  } catch {
    throw new Error(`expected ${label} (${testId}) to be present`)
  }
}

async function assertAbsent(page, testId, label) {
  const count = await page.getByTestId(testId).count()
  if (count > 0) throw new Error(`expected ${label} (${testId}) to be absent`)
}

export default async function serversRowMarkers({ page, step, shot }) {
  step('navigate to the Servers view')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC4/AC7: before any scan, the ghost address is pending-with-dashes and A shows favourite')
  await assertExists(page, `servers-row-${serverA.address}`, "A's row")
  await assertExists(page, `servers-row-${ghostAddress}`, "the ghost address's row")
  await assertExists(page, `servers-row-pending-${ghostAddress}`, 'the pending marker on the ghost row')
  const ghostRowBefore = page.getByTestId(`servers-row-${ghostAddress}`)
  const ghostTextBefore = await ghostRowBefore.textContent()
  if (!ghostTextBefore || !ghostTextBefore.includes('—/—')) {
    throw new Error(`expected the ghost row to show dashes before any scan, got "${ghostTextBefore}"`)
  }
  await assertExists(
    page,
    `servers-row-favourite-${serverA.address}`,
    "the favourite marker on A's row",
  )
  await shot('before-scan')

  step('click "Refresh servers" and wait for the round to finish')
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)

  step('AC1: B\'s row shows all five known fields')
  await assertExists(page, `servers-row-${serverB.address}`, "B's row")
  const rowB = page.getByTestId(`servers-row-${serverB.address}`)
  const textB = await rowB.textContent()
  for (const expected of ['Fixture Server B', serverB.address, 'baseq2', '2/8', 'q2dm1', 'ms']) {
    if (!textB || !textB.includes(expected)) {
      throw new Error(`expected B's row to contain "${expected}", got "${textB}"`)
    }
  }

  step('AC2: password marker present on A only')
  await assertExists(page, `servers-row-password-${serverA.address}`, "A's password marker")
  await assertAbsent(page, `servers-row-password-${serverB.address}`, "B's password marker")
  await assertAbsent(page, `servers-row-password-${serverC.address}`, "C's password marker")

  step('AC3: ctf marker on A, deathmatch marker on B')
  const gamemodeA = await page.getByTestId(`servers-row-gamemode-${serverA.address}`).textContent()
  if (gamemodeA !== 'CTF') throw new Error(`expected A's gamemode marker to read "CTF", got "${gamemodeA}"`)
  const gamemodeB = await page.getByTestId(`servers-row-gamemode-${serverB.address}`).textContent()
  if (gamemodeB !== 'Deathmatch') {
    throw new Error(`expected B's gamemode marker to read "Deathmatch", got "${gamemodeB}"`)
  }

  step('AC4: favourite marker on A only')
  await assertExists(page, `servers-row-favourite-${serverA.address}`, "A's favourite marker")
  await assertAbsent(page, `servers-row-favourite-${serverB.address}`, "B's favourite marker")
  await assertAbsent(page, `servers-row-favourite-${serverC.address}`, "C's favourite marker")

  step('AC6: waiting marker on A (1 player) only, not B (2 players) or C (0 players)')
  await assertExists(page, `servers-row-waiting-${serverA.address}`, "A's waiting marker")
  await assertAbsent(page, `servers-row-waiting-${serverB.address}`, "B's waiting marker")
  await assertAbsent(page, `servers-row-waiting-${serverC.address}`, "C's waiting marker")
  await shot('after-first-refresh')

  step("close D's responder, then refresh again")
  await closeResponder(serverD)
  const finishedAtBeforeSecond = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBeforeSecond, SCAN_SETTLE_TIMEOUT_MS)

  step('AC5: D is stale but keeps its last-known hostname/map')
  await assertExists(page, `servers-row-stale-${serverD.address}`, "D's stale marker")
  const rowD = page.getByTestId(`servers-row-${serverD.address}`)
  const textD = await rowD.textContent()
  for (const expected of ['Fixture Server D', 'q2dm1']) {
    if (!textD || !textD.includes(expected)) {
      throw new Error(`expected D's stale row to still contain "${expected}", got "${textD}"`)
    }
  }

  step('the ghost address is stale-with-dashes after a second round with no responder')
  await assertExists(page, `servers-row-stale-${ghostAddress}`, "the ghost row's stale marker")
  const ghostRowAfter = page.getByTestId(`servers-row-${ghostAddress}`)
  const ghostTextAfter = await ghostRowAfter.textContent()
  if (!ghostTextAfter || !ghostTextAfter.includes('—/—')) {
    throw new Error(`expected the ghost row to still show dashes after a scan, got "${ghostTextAfter}"`)
  }
  await shot('after-second-refresh')

  console.log(
    'servers-row-markers: pending/favourite show before any scan (AC4/AC7), a full refresh ' +
      "populated every field and every marker (AC1-AC3, AC6), and a responder going away flips " +
      'its row to stale while keeping its last-known values (AC5)',
  )
}
