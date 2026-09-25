// Story 117 (docs/requirements/117-a-refresh-only-reloads-what-changed.md) D6: the story's own
// e2e proof that "Refresh servers", "Refresh favourites" and "Refresh this server" all go through
// the exact same `scan.start`/`ScanService` machinery (114/115/116's scheduler), differing only in
// which addresses each round actually touches (`ScanScope`, D1-D4). This flow proves that with real
// (loopback-only) UDP sockets rather than by reading `scan-scope.ts`'s unit tests: three genuine
// `dgram` responders, one packet log apiece, and a direct assertion per phase of who got queried and
// who did not.
//
// ## Wire protocol - mirrored, not imported
//
// `scripts/*.mjs` never imports `src/` TypeScript (see `scripts/lib/fixture.mjs`'s own header
// comment) - `encodeLatin1`/`buildInfoReplyBytes`/`buildStatusReplyBytes`/`decodeQueryKind` below are
// copied verbatim from `scripts/flows/servers-no-scan-while-playing.mjs` (116 D6), which itself
// mirrors `src/main/modules/servers/scan-integration.test.ts`'s `bindResponder`/`decodeQueryKind`.
//
// ## Three responders instead of one - the reusable helper this D asks for
//
// 116's own flow only ever needed one live responder. This flow needs three, each tracking its own
// received-packet counts per query kind (`info`/`status`) so a phase's assertions can tell "server A
// got queried this round" apart from "server B did not" - `bindResponder()` below therefore returns
// a `{ socket, port, address, log }` object (mirrors 116's shape, plus the per-responder `log`), and
// `packetLogOf()`/`resetPacketLogs()` are the small multi-responder log-and-reset pair the story's
// own text asks for. No `scripts/flows/lib/` directory exists yet (checked before adding one), and
// nothing else needs this helper today, so it stays colocated in this file rather than starting a
// new shared-helpers convention for a single caller.
//
// ## Fixture: three manual servers, one also a favourite, every master source disabled
//
// `sources: SERVERS_DISABLED_SOURCES` (GB-A5: never touch a real master/internet host).
// `manualServers` seeds all three loopback addresses; `favourites` names only server A's, so
// "Refresh favourites" (AC2) and "Refresh this server" against a NON-favourite (AC3) are cleanly
// distinguishable, per the story's own design. Every responder's `info` reply reports a non-empty
// `clients` count and a real player roster on `status`, so a full/favourites round's stage 2 is
// actually exercised for every touched address (proving AC1's "both stages", not just stage 1), and
// so each address's data is genuinely comparable (not just present/absent) before and after a round
// that must leave it untouched.
//
// `scan` is seeded with both auto-behaviours OFF (`autoScanOnOpen: false`, `autoRefreshEnabled:
// false`) - the same discipline 116's own flow doc comment states - so every packet any responder
// ever sees is attributable to one of this flow's own deliberate clicks, never a background trigger
// racing the assertions.
//
// ## Selectors
//
// `nav-servers` (TitleBar.tsx), `servers-refresh`/`servers-refresh-favourites`/
// `servers-refresh-selected` (ServersView.tsx, story 117 D5), `servers-row-<address>` (a row is
// selected by clicking it - `ServersView.tsx`'s `handleToggleRowSelected`, confirmed by reading the
// file rather than assumed), `servers-scan-status` (`data-finished-at`, same test-observability
// attribute 116's flow reads). `module:invoke` direct calls (`scan.read`) prove the "rest of the
// list is untouched" half of AC2/AC3 - a screenshot alone cannot prove a field-by-field data
// survival, only that a row still exists on screen.
import { createSocket } from 'node:dgram'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'

export const variant = 'servers-scoped-refresh'

const TIMEOUT_MS = 8_000
/** Generous headroom around the seeded scan budget (`timeoutMs: 500`/`retries: 0` against three
 * live, instantly-answering loopback responders) - mirrors `servers-no-scan-while-playing.mjs`'s own
 * `SCAN_SETTLE_TIMEOUT_MS`. */
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

/**
 * Binds one loopback responder answering both `info` and `status` queries with its own
 * hostname/player roster, and tracks how many of each kind it has received since the last
 * `resetPacketLogs()` call. `clients` in the `info` reply is always `playerLines.length` (never
 * zero), so a round that reaches this address exercises stage 2's `status` query too, not only
 * stage 1's `info`.
 */
async function bindResponder(hostname, playerLines) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`
  const infoLine =
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
    `\\maxclients\\8\\version\\3.20`
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

/** A snapshot of one responder's received-packet counts since the last reset - a plain copy, so a
 * caller can hold onto "what this round saw" across the very next `resetPacketLogs()` call. */
function packetLogOf(responder) {
  return { info: responder.log.info, status: responder.log.status }
}

/** Resets every responder's log to `{ info: 0, status: 0 }` - called at the start of each phase so
 * the next phase's assertions are never confused by a previous phase's traffic. */
function resetPacketLogs(responders) {
  for (const responder of responders) {
    responder.log.info = 0
    responder.log.status = 0
  }
}

async function closeResponder(responder) {
  if (responder.closed) return
  responder.closed = true
  await new Promise((resolve) => responder.socket.close(() => resolve()))
}

/** A fixed ISO instant, mirroring every fixture writer's "never `Date.now()`" discipline
 * (`scripts/lib/fixture.mjs`'s own `FIXED_TIMESTAMP`, not exported so this is a local copy of the
 * same literal). */
const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

let serverA = null
let serverB = null
let serverC = null
let responders = []

export async function setup() {
  // Distinct hostnames/rosters (never all-empty `clients`) so the three rows are visibly
  // distinguishable in a screenshot and each address's data is genuinely comparable, not merely
  // present, before and after a round that must leave it untouched.
  serverA = await bindResponder('Fixture Server A (Favourite)', ['5 20 "Alpha1"', '3 10 "Alpha2"'])
  serverB = await bindResponder('Fixture Server B', ['7 15 "Bravo1"'])
  serverC = await bindResponder('Fixture Server C', [
    '9 25 "Charlie1"',
    '2 5 "Charlie2"',
    '4 12 "Charlie3"',
  ])
  responders = [serverA, serverB, serverC]

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        // GB-A5: every shipped master source present but disabled - never touch a real master.
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [{ address: serverA.address, addedAt: FIXED_ADDED_AT }],
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

async function invokeScanRead(page) {
  return page.evaluate(() =>
    window.q2.invoke('module:invoke', { moduleId: 'servers', type: 'scan.read' }),
  )
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

/** Deep-equality by canonical (recursively key-sorted) JSON - object-key order must not matter for
 * "byte-for-byte unchanged" (AC2/AC3's untouched-row proof), only values. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

function entriesEqual(a, b) {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

function findEntry(snapshot, address) {
  return snapshot.value.entries.find((candidate) => candidate.address === address)
}

/** Asserts every entry in `after` at an address OTHER than `excludedAddress` is byte-for-byte
 * identical to what `before` held for that same address - the untouched-rows half of AC2/AC3. */
function assertOtherEntriesUnchanged(before, after, excludedAddress, addresses, label) {
  for (const address of addresses) {
    if (address === excludedAddress) continue
    const beforeEntry = findEntry(before, address)
    const afterEntry = findEntry(after, address)
    if (!beforeEntry || !afterEntry) {
      throw new Error(`expected an entry for ${address} to exist both before and after ${label}`)
    }
    if (!entriesEqual(beforeEntry, afterEntry)) {
      throw new Error(
        `expected ${address}'s entry to be untouched by ${label}, got before=${JSON.stringify(
          beforeEntry,
        )} after=${JSON.stringify(afterEntry)}`,
      )
    }
  }
}

export default async function serversScopedRefresh({ page, step, shot }) {
  const allAddresses = responders.map((responder) => responder.address)

  step('navigate to the Servers view')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC1: "Refresh servers" sweeps all three servers through both stages')
  resetPacketLogs(responders)
  const finishedAtBeforeAll = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBeforeAll, SCAN_SETTLE_TIMEOUT_MS)
  for (const responder of responders) {
    const log = packetLogOf(responder)
    if (log.info < 1 || log.status < 1) {
      throw new Error(
        `expected ${responder.address} to receive both an info and a status packet from ` +
          `"Refresh servers" (AC1), got ${JSON.stringify(log)}`,
      )
    }
  }
  await shot('all-servers-refreshed')

  step('AC2: "Refresh favourites" touches only the favourite, leaving the rest untouched')
  resetPacketLogs(responders)
  const beforeFavourites = await invokeScanRead(page)
  if (beforeFavourites?.ok !== true) {
    throw new Error(`expected scan.read to succeed, got ${JSON.stringify(beforeFavourites)}`)
  }
  const finishedAtBeforeFavourites = await readFinishedAt(page)
  await page.getByTestId('servers-refresh-favourites').click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBeforeFavourites, SCAN_SETTLE_TIMEOUT_MS)

  const favouriteLog = packetLogOf(serverA)
  if (favouriteLog.info < 1 || favouriteLog.status < 1) {
    throw new Error(
      `expected the favourite ${serverA.address} to receive both an info and a status packet ` +
        `from "Refresh favourites" (AC2), got ${JSON.stringify(favouriteLog)}`,
    )
  }
  for (const responder of [serverB, serverC]) {
    const log = packetLogOf(responder)
    if (log.info !== 0 || log.status !== 0) {
      throw new Error(
        `expected non-favourite ${responder.address} to receive zero packets from ` +
          `"Refresh favourites" (AC2), got ${JSON.stringify(log)}`,
      )
    }
  }

  const afterFavourites = await invokeScanRead(page)
  if (afterFavourites?.ok !== true) {
    throw new Error(`expected scan.read to succeed, got ${JSON.stringify(afterFavourites)}`)
  }
  assertOtherEntriesUnchanged(
    beforeFavourites,
    afterFavourites,
    serverA.address,
    allAddresses,
    '"Refresh favourites"',
  )
  await shot('favourites-refreshed')

  step('select a non-favourite row, then "Refresh this server" touches only it')
  const selected = serverB
  await page.getByTestId(`servers-row-${selected.address}`).click({ timeout: TIMEOUT_MS })
  const refreshSelected = page.getByTestId('servers-refresh-selected')
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="servers-refresh-selected"]')?.disabled,
    null,
    { timeout: TIMEOUT_MS },
  )

  resetPacketLogs(responders)
  const beforeSelected = await invokeScanRead(page)
  if (beforeSelected?.ok !== true) {
    throw new Error(`expected scan.read to succeed, got ${JSON.stringify(beforeSelected)}`)
  }
  const finishedAtBeforeSelected = await readFinishedAt(page)
  await refreshSelected.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBeforeSelected, SCAN_SETTLE_TIMEOUT_MS)

  const selectedLog = packetLogOf(selected)
  if (selectedLog.status !== 1 || selectedLog.info !== 0) {
    throw new Error(
      `expected the selected server ${selected.address} to receive exactly one status packet ` +
        `and zero info packets from "Refresh this server" (AC3), got ${JSON.stringify(selectedLog)}`,
    )
  }
  for (const responder of [serverA, serverC]) {
    const log = packetLogOf(responder)
    if (log.info !== 0 || log.status !== 0) {
      throw new Error(
        `expected ${responder.address} to receive zero packets from "Refresh this server" ` +
          `(AC3), got ${JSON.stringify(log)}`,
      )
    }
  }

  const afterSelected = await invokeScanRead(page)
  if (afterSelected?.ok !== true) {
    throw new Error(`expected scan.read to succeed, got ${JSON.stringify(afterSelected)}`)
  }
  assertOtherEntriesUnchanged(
    beforeSelected,
    afterSelected,
    selected.address,
    allAddresses,
    '"Refresh this server"',
  )
  await shot('selected-server-refreshed')

  console.log(
    'servers-scoped-refresh: "Refresh servers" swept all three addresses through both stages ' +
      '(AC1), "Refresh favourites" queried only the favourite and left the other two rows byte-' +
      'for-byte untouched (AC2), and "Refresh this server" queried exactly the selected address ' +
      "with a single status query and left every other row untouched (AC3)",
  )
}
