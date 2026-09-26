// Story 124 (docs/requirements/124-how-this-server-has-answered.md) D2: proves the detail pane's
// "how this server has answered" section against a real loopback responder - two answered rounds
// leave "Answered the last scan" plus at least two recognizable ms samples, navigating away from
// the Servers view and back still shows the same samples (the regression the story plan calls out:
// history lives in main/the scan service, not renderer state), and stopping the responder then
// triggering another round flips the section to the no-answer statement with a "No answer" sample
// on top.
//
// ## Wire protocol - mirrored, not imported
//
// `scripts/*.mjs` never imports `src/` TypeScript (see `scripts/lib/fixture.mjs`'s own header
// comment) - `encodeLatin1`/`buildInfoReplyBytes`/`buildStatusReplyBytes`/`decodeQueryKind` below are
// copied verbatim from `scripts/flows/servers-scoped-refresh.mjs`, which itself mirrors
// `src/main/modules/servers/scan-integration.test.ts`'s `bindResponder`/`decodeQueryKind`.
//
// ## Fixture: one manual server, every master source disabled, scan autos off
//
// `sources: SERVERS_DISABLED_SOURCES` (GB-A5: never touch a real master/internet host). Mirrors
// `servers-detail-rules.mjs`'s single-responder fixture exactly, including a non-zero `clients`
// count so stage 2's `status` query (and thus a real rtt sample) fires on every round that reaches
// this address.
//
// ## Selectors
//
// `nav-servers`/`nav-home` (TitleBar.tsx), `servers-refresh` (ServersView.tsx),
// `servers-row-<address>` (click to open detail), `server-reachability`/
// `server-reachability-last-round`/`server-reachability-sample` (ServerReachabilitySection.tsx).
import { createSocket } from 'node:dgram'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'

export const variant = 'servers-detail-reachability'

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

async function bindResponder(infoLine, statusLine, playerLines) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`

  socket.on('message', (message, rinfo) => {
    const kind = decodeQueryKind(message)
    if (kind === 'info') {
      socket.send(buildInfoReplyBytes(infoLine), rinfo.port, rinfo.address)
    } else if (kind === 'status') {
      socket.send(buildStatusReplyBytes(statusLine, playerLines), rinfo.port, rinfo.address)
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

let server = null

export async function setup() {
  server = await bindResponder(
    '\\gamename\\baseq2\\hostname\\Fixture Reachability Server\\mapname\\q2dm1\\clients\\1' +
      '\\maxclients\\16\\protocol\\34\\deathmatch\\1',
    '\\hostname\\Fixture Reachability Server\\mapname\\q2dm1\\gamename\\baseq2\\maxclients\\16' +
      '\\protocol\\34\\deathmatch\\1',
    [],
  )

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        // GB-A5: every shipped master source present but disabled - never touch a real master.
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
        manualServers: [
          {
            address: server.address,
            origin: 'manual',
            addedAt: FIXED_ADDED_AT,
          },
        ],
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
  await closeResponder(server)
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

async function runRefresh(page) {
  const refreshAll = page.getByTestId('servers-refresh')
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
}

async function readSampleTexts(page) {
  return page.getByTestId('server-reachability-sample').allInnerTexts()
}

export default async function serversDetailReachability({ page, step, shot }) {
  step('navigate to the Servers view and run two answered refreshes')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-refresh').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  await runRefresh(page)
  await runRefresh(page)

  step('opening the server detail pane shows two answered samples')
  await page.getByTestId(`servers-row-${server.address}`).click({ timeout: TIMEOUT_MS })
  const reachability = page.getByTestId('server-reachability')
  await reachability.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const lastRoundText = await page.getByTestId('server-reachability-last-round').innerText()
  if (!/answered the last scan/i.test(lastRoundText)) {
    throw new Error(`expected "answered the last scan", got ${JSON.stringify(lastRoundText)}`)
  }

  const samples = await readSampleTexts(page)
  if (samples.length < 2) {
    throw new Error(`expected at least 2 reachability samples, got ${JSON.stringify(samples)}`)
  }
  for (const sample of samples) {
    if (!/\d+\s*ms/i.test(sample)) {
      throw new Error(`expected a recognizable "N ms" sample, got ${JSON.stringify(sample)}`)
    }
  }
  await shot('reachability-answered')

  step('history survives navigating away from Servers and back')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await page.getByTestId(`servers-row-${server.address}`).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('server-reachability').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const samplesAfterNav = await readSampleTexts(page)
  if (samplesAfterNav.length !== samples.length) {
    throw new Error(
      `expected the same ${samples.length} samples after navigating away and back, got ` +
        `${JSON.stringify(samplesAfterNav)}`,
    )
  }
  for (const sample of samplesAfterNav) {
    if (!/\d+\s*ms/i.test(sample)) {
      throw new Error(
        `expected a recognizable "N ms" sample after navigating back, got ${JSON.stringify(sample)}`,
      )
    }
  }

  step('stopping the responder and refreshing flips to the no-answer statement')
  await closeResponder(server)
  await runRefresh(page)

  const lastRoundAfterStop = await page.getByTestId('server-reachability-last-round').innerText()
  if (!/did not answer the last scan/i.test(lastRoundAfterStop)) {
    throw new Error(
      `expected the no-answer statement, got ${JSON.stringify(lastRoundAfterStop)}`,
    )
  }

  const samplesAfterStop = await readSampleTexts(page)
  if (samplesAfterStop.length === 0 || !/no answer/i.test(samplesAfterStop[0] ?? '')) {
    throw new Error(
      `expected the newest sample to read "No answer", got ${JSON.stringify(samplesAfterStop)}`,
    )
  }
  await shot('reachability-no-answer')

  console.log(
    'servers-detail-reachability: two answered rounds show "Answered the last scan" plus their ' +
      'rtt samples, the samples survive navigating away and back (history lives in main, not ' +
      'renderer state), and stopping the responder flips the section to the no-answer statement ' +
      'with a "No answer" sample on top.',
  )
}
