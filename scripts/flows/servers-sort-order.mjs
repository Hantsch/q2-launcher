// Story 119 (docs/requirements/119-busy-servers-rise-to-the-top.md) D3: the sort bar's e2e proof
// on the real Servers surface. Five genuine loopback `dgram` responders (F/E/B/C/D) prove the
// default order (favourites pinned, then occupancy descending, gamemode only breaking ties), a
// column click's asc/desc cycle, that the choice survives navigating away and a full page reload,
// that it is actually persisted in `state.json`'s `servers.listSort`, and that a third click on the
// same column clears it back to the default order and removes the persisted key.
//
// Mirrors `servers-row-markers.mjs`'s `bindResponder`/fixture-seeding/`waitForFinishedAtChange`
// pattern (copied, not imported - `scripts/*.mjs` never imports another flow file) and
// `servers-scan-settings.mjs`'s approach for reading `state.json` off disk.
import { createSocket } from 'node:dgram'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'

export const variant = 'servers-sort-order'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
/** How long to keep retrying a `state.json` read after a sort click - the click updates the DOM
 * optimistically (`ServersView.tsx`'s `handleSort`) before the `list.setSort` IPC round trip that
 * actually writes the file resolves, so a single immediate read can race the write. */
const STATE_WRITE_POLL_TIMEOUT_MS = 4_000
const STATE_WRITE_POLL_INTERVAL_MS = 100

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

/** Binds one loopback responder. `extraInfoFlags` is appended verbatim to the `info`/`status`
 * serverinfo line (e.g. `\deathmatch\1`) - feeds `deriveGamemode` on the real row. `mapName`
 * feeds the row's `map` field, the column this flow sorts by. */
async function bindResponder(hostname, playerLines, { extraInfoFlags = '', mapName = 'q2dm1' } = {}) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`
  const infoLine =
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\${mapName}\\clients\\${playerLines.length}` +
    `\\maxclients\\8\\version\\3.20${extraInfoFlags}`
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

function playerLinesFor(count) {
  return Array.from({ length: count }, (_, index) => `${index + 1} ${index * 5} "Player${index + 1}"`)
}

let serverF = null
let serverE = null
let serverB = null
let serverC = null
let serverD = null
let responders = []

export async function setup() {
  // F: favourite, 0 players, map q2dm8 - no gamemode flags, pinned first regardless of the others.
  serverF = await bindResponder('Fixture Server F (Favourite)', playerLinesFor(0), {
    mapName: 'q2dm8',
  })
  // E: ctf 1, 6 players, map q2dm3.
  serverE = await bindResponder('Fixture Server E', playerLinesFor(6), {
    extraInfoFlags: '\\ctf\\1',
    mapName: 'q2dm3',
  })
  // B: deathmatch 1, 3 players, map q2dm1.
  serverB = await bindResponder('Fixture Server B', playerLinesFor(3), {
    extraInfoFlags: '\\deathmatch\\1',
    mapName: 'q2dm1',
  })
  // C: ctf 1, 3 players, map q2dm5.
  serverC = await bindResponder('Fixture Server C', playerLinesFor(3), {
    extraInfoFlags: '\\ctf\\1',
    mapName: 'q2dm5',
  })
  // D: deathmatch 1, 1 player, map q2dm2.
  serverD = await bindResponder('Fixture Server D', playerLinesFor(1), {
    extraInfoFlags: '\\deathmatch\\1',
    mapName: 'q2dm2',
  })
  responders = [serverF, serverE, serverB, serverC, serverD]

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        // GB-A5: every shipped master source present but disabled - never touch a real master.
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [{ address: serverF.address, addedAt: FIXED_ADDED_AT }],
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

function statePath() {
  return join(variantUserDataDir(variant), 'state.json')
}

function readStateJson() {
  return JSON.parse(readFileSync(statePath(), 'utf8'))
}

/** Polls `state.json` until `predicate` is satisfied or the timeout elapses - see the module-level
 * comment on `STATE_WRITE_POLL_TIMEOUT_MS` for why a single immediate read can race the write. */
async function waitForStateJson(predicate, label) {
  const deadline = Date.now() + STATE_WRITE_POLL_TIMEOUT_MS
  let last
  for (;;) {
    last = readStateJson()
    if (predicate(last)) return last
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${label}, last state.json servers: ${JSON.stringify(last.servers)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, STATE_WRITE_POLL_INTERVAL_MS))
  }
}

/** Reads the DOM order of every `servers-row-<address>` row button, in the order they appear. */
async function rowOrder(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="servers-row-"]'))
      .filter((el) => el.tagName === 'BUTTON')
      .map((el) => el.getAttribute('data-testid')),
  )
}

/** Waits until at least `count` row buttons are attached - re-mounting the view re-runs its
 * `readScan()`/`getListSort()` mount effects, both async, so the rows are not there the instant
 * navigation lands. */
async function waitForRowCount(page, count) {
  await page.waitForFunction(
    (expected) =>
      Array.from(document.querySelectorAll('[data-testid^="servers-row-"]')).filter(
        (el) => el.tagName === 'BUTTON',
      ).length >= expected,
    count,
    { timeout: TIMEOUT_MS },
  )
}

function assertOrder(actual, expectedAddresses, label) {
  const expected = expectedAddresses.map((address) => `servers-row-${address}`)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${label} order ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

export default async function serversSortOrder({ page, step, shot }) {
  step('navigate to the Servers view and run a full refresh')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)

  step('the default order is favourite-pinned, then occupancy descending (gamemode only breaks ties)')
  const defaultOrder = await rowOrder(page)
  assertOrder(
    defaultOrder,
    [serverF.address, serverE.address, serverB.address, serverC.address, serverD.address],
    'the default',
  )
  const currentDefault = await page.getByTestId('servers-sort-current').textContent()
  if (currentDefault !== 'Favourites first, then busiest') {
    throw new Error(`expected the default sort-current text, got "${currentDefault}"`)
  }
  await shot('default-order')

  step('clicking the map column sorts ascending (favourite still pinned first)')
  await page.getByTestId('servers-sort-map').click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () => document.querySelector('[data-testid="servers-sort-map"]')?.getAttribute('aria-pressed') === 'true',
    null,
    { timeout: TIMEOUT_MS },
  )
  const ascOrder = await rowOrder(page)
  assertOrder(
    ascOrder,
    [serverF.address, serverB.address, serverD.address, serverE.address, serverC.address],
    'map ascending',
  )
  await shot('map-ascending')

  step('clicking the map column again reverses to descending')
  await page.getByTestId('servers-sort-map').click({ timeout: TIMEOUT_MS })
  await waitForStateJson(
    (state) =>
      state.servers?.listSort?.column === 'map' && state.servers?.listSort?.direction === 'desc',
    'state.json to persist map/desc',
  )
  const descOrder = await rowOrder(page)
  assertOrder(
    descOrder,
    [serverF.address, serverC.address, serverE.address, serverD.address, serverB.address],
    'map descending',
  )
  await shot('map-descending')

  step('navigating away and back keeps the map/descending order')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForRowCount(page, responders.length)
  const afterNavOrder = await rowOrder(page)
  assertOrder(
    afterNavOrder,
    [serverF.address, serverC.address, serverE.address, serverD.address, serverB.address],
    'map descending after navigating away and back',
  )

  step('reloading the page keeps the map/descending order')
  await page.reload()
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForRowCount(page, responders.length)
  const afterReloadOrder = await rowOrder(page)
  assertOrder(
    afterReloadOrder,
    [serverF.address, serverC.address, serverE.address, serverD.address, serverB.address],
    'map descending after a page reload',
  )
  const persisted = readStateJson()
  const persistedSort = persisted.servers?.listSort
  if (persistedSort?.column !== 'map' || persistedSort?.direction !== 'desc') {
    throw new Error(`expected state.json's servers.listSort to be map/desc, got ${JSON.stringify(persistedSort)}`)
  }
  await shot('after-reload')

  step('a third click on the map column clears the sort back to the default order')
  await page.getByTestId('servers-sort-map').click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () => document.querySelector('[data-testid="servers-sort-map"]')?.getAttribute('aria-pressed') === 'false',
    null,
    { timeout: TIMEOUT_MS },
  )
  const clearedOrder = await rowOrder(page)
  assertOrder(
    clearedOrder,
    [serverF.address, serverE.address, serverB.address, serverC.address, serverD.address],
    'the default (after clearing the sort)',
  )
  await waitForStateJson(
    (state) => !('listSort' in (state.servers ?? {})),
    'state.json to drop servers.listSort',
  )
  await shot('cleared-back-to-default')

  console.log(
    'servers-sort-order: the default order pins favourites then sorts by occupancy with ' +
      'gamemode only breaking ties, a column click cycles asc -> desc -> default, the choice ' +
      'survives navigating away and a full reload, is persisted in state.json, and clearing it ' +
      'removes the persisted key',
  )
}
