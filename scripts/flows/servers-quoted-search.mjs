// Quoted server search e2e: three loopback `dgram` responders prove that a double-quoted term in
// the real Servers search box matches exactly (whole hostname / whole player name) while an
// unquoted term stays a substring match. Helpers are copied from `servers-filter-search.mjs`
// (flows never import each other).
import { createSocket } from 'node:dgram'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'

export const variant = 'servers-quoted-search'

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

/** Binds one loopback responder with full control over its `gamename`/`mapname`/`maxclients`/
 * gamemode flags/`needpass`, so each of A-D can exercise a different filter field. */
async function bindResponder(hostname, playerLines, { mod = 'baseq2', map = 'q2dm1', maxclients = 8, extraInfoFlags = '\\deathmatch\\1', needpass = false } = {}) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`
  const infoLine =
    `\\gamename\\${mod}\\hostname\\${hostname}\\mapname\\${map}\\clients\\${playerLines.length}` +
    `\\maxclients\\${maxclients}\\version\\3.20\\needpass\\${needpass ? 1 : 0}${extraInfoFlags}`
  const responder = { socket, port, address, hostname, closed: false }

  socket.on('message', (message, rinfo) => {
    const kind = decodeQueryKind(message)
    if (kind === 'info') {
      socket.send(buildInfoReplyBytes(infoLine), rinfo.port, rinfo.address)
    } else if (kind === 'status') {
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
let responders = []

export async function setup() {
  serverA = await bindResponder('FFA', ['5 20 "Zulu"'])
  serverB = await bindResponder('FFA Classic', ['3 9 "Zulu2"'])
  serverC = await bindResponder('Cellar', [])
  responders = [serverA, serverB, serverC]

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
        manualServers: responders.map((entry) => ({
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

async function visibleLabels(page) {
  const visible = []
  for (const [label, responder] of [['A', serverA], ['B', serverB], ['C', serverC]]) {
    if ((await page.getByTestId(`servers-row-${responder.address}`).count()) > 0) visible.push(label)
  }
  return visible.sort()
}

function assertSet(actual, expected, label) {
  const a = [...actual].sort()
  const e = [...expected].sort()
  if (a.join(',') !== e.join(',')) {
    throw new Error(`${label}: expected {${e.join(',')}}, got {${a.join(',')}}`)
  }
}

export default async function serversQuotedSearch({ page, step, shot }) {
  step('navigate to the Servers view')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('click "Refresh servers" and wait for the round to finish')
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await page.getByTestId(`servers-row-${serverA.address}`).waitFor({ state: 'attached', timeout: TIMEOUT_MS })
  assertSet(await visibleLabels(page), ['A', 'B', 'C'], 'no filter')

  const search = page.getByTestId('servers-filter-search')
  const cases = [
    ['ffa', ['A', 'B'], 'unquoted term stays a substring match'],
    ['"ffa"', ['A'], 'quoted term matches the whole hostname'],
    [' "ffa" ', ['A'], 'surrounding whitespace is ignored'],
    ['"zulu"', ['A'], 'quoted term matches a whole player name'],
    ['zulu', ['A', 'B'], 'unquoted player term is a substring match'],
    ['"ffa', [], 'an unclosed quote is a literal substring (no name contains the quote)'],
  ]
  for (const [text, expected, what] of cases) {
    step(`search ${JSON.stringify(text)}: ${what}`)
    await search.fill(text)
    assertSet(await visibleLabels(page), expected, `search=${text}`)
    if (text === '"ffa"') await shot('quoted')
    await search.fill('')
  }

  step('search "" (empty quotes) matches nothing and shows the no-match line')
  await search.fill('""')
  await page.getByTestId('servers-filter-no-match').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  assertSet(await visibleLabels(page), [], 'search=""')
  await search.fill('')

  step('placeholder mentions quotes')
  const placeholder = (await search.getAttribute('placeholder')) ?? ''
  if (!placeholder.includes('"quotes"')) {
    throw new Error(`expected the search placeholder to mention "quotes", got ${JSON.stringify(placeholder)}`)
  }

  console.log('servers-quoted-search: quoted terms match exactly, unquoted stay substring, the placeholder says so.')
}
