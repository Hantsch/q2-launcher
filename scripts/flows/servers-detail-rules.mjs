// Story 123 (docs/requirements/123-the-rules-a-server-plays-by-in-full.md) D3: proves the detail
// pane's new rules section against a real loopback responder - every reported key shows as a row,
// unknown keys (`matchmode`, `actionversion`) land in the raw section rather than known, a malformed
// `timelimit` degrades on its own row without breaking its siblings, and dmflags decodes with its
// caveat visible.
//
// ## Wire protocol - mirrored, not imported
//
// Same discipline as `scripts/flows/servers-scoped-refresh.mjs`'s own header comment:
// `scripts/*.mjs` never imports `src/` TypeScript, so `encodeLatin1`/`buildInfoReplyBytes`/
// `buildStatusReplyBytes`/`decodeQueryKind` below are copied verbatim from that file.
//
// ## Fixture: one manual server, every master source disabled, scan autos off
//
// `sources: SERVERS_DISABLED_SOURCES` (GB-A5: never touch a real master/internet host). The
// responder's `info` reply reports `clients\1` (non-zero) so stage 1 marks it non-empty and stage 2
// (`status`) actually queries it (`scan-runner.ts`: stage 2 only covers targets stage 1 reported
// non-empty, plus the selected address) - this fixture never selects a row before its first scan, so
// without a non-zero `clients` the `status` reply, and thus `detail.serverinfo`, would never arrive.
// The info reply also deliberately omits `matchmode`/`actionversion` (info replies are traditionally
// leaner than status replies) so this flow also proves the rules section reads from the detail's
// `status`-sourced `serverinfo`, not the scan list's `info`-sourced fields. Its `status`
// reply carries the 11 keys the story's own text specifies: `hostname`, `mapname`, `gamename`,
// `maxclients`, `protocol`, `deathmatch`, `dmflags` (65800 = 8 + 256 + 65536 -> no-falling,
// no-friendly-fire, unknown bit 16), `timelimit` (deliberately non-numeric: `abc`), `fraglimit`,
// plus the two unknown-to-the-launcher keys `matchmode`/`actionversion`.
//
// ## Selectors
//
// `nav-servers` (TitleBar.tsx), `servers-refresh` (ServersView.tsx), `servers-row-<address>` (click
// to open detail), `servers-detail-rules` (ServerRulesPanel.tsx), `rule-row`/`data-key`,
// `rules-known`, `rules-raw`, `rules-dmflags`.
import { createSocket } from 'node:dgram'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'

export const variant = 'servers-detail-rules'

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
    '\\gamename\\baseq2\\hostname\\Fixture Rules Server\\mapname\\q2dm1\\clients\\1\\maxclients\\16' +
      '\\protocol\\34\\deathmatch\\1',
    '\\hostname\\Fixture Rules Server\\mapname\\q2dm1\\gamename\\baseq2\\maxclients\\16' +
      '\\protocol\\34\\deathmatch\\1\\dmflags\\65800\\timelimit\\abc\\fraglimit\\20' +
      '\\matchmode\\1\\actionversion\\2.1',
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

async function ruleRowText(page, key) {
  return page.locator(`[data-testid="rule-row"][data-key="${key}"]`).innerText()
}

export default async function serversDetailRules({ page, step, shot }) {
  step('navigate to the Servers view and run a full scan')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)

  step('opening the server detail pane shows the rules section')
  await page.getByTestId(`servers-row-${server.address}`).click({ timeout: TIMEOUT_MS })
  const rulesSection = page.getByTestId('servers-detail-rules')
  await rulesSection.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const expectedKeys = [
    'hostname',
    'mapname',
    'gamename',
    'maxclients',
    'protocol',
    'deathmatch',
    'dmflags',
    'timelimit',
    'fraglimit',
    'matchmode',
    'actionversion',
  ]
  for (const key of expectedKeys) {
    const count = await page.locator(`[data-testid="rule-row"][data-key="${key}"]`).count()
    if (count !== 1) {
      throw new Error(`expected exactly one rule-row for key "${key}", found ${count}`)
    }
  }

  step('matchmode/actionversion land in the raw section, not known')
  const rawSection = page.getByTestId('rules-raw')
  await rawSection.waitFor({ timeout: TIMEOUT_MS })
  const rawKeys = await rawSection
    .locator('[data-testid="rule-row"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-key')))
  if (!rawKeys.includes('matchmode') || !rawKeys.includes('actionversion')) {
    throw new Error(
      `expected matchmode/actionversion in the raw section, got ${JSON.stringify(rawKeys)}`,
    )
  }
  const knownSection = page.getByTestId('rules-known')
  const knownKeys = await knownSection
    .locator('[data-testid="rule-row"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-key')))
  if (knownKeys.includes('matchmode') || knownKeys.includes('actionversion')) {
    throw new Error(
      `expected matchmode/actionversion NOT in the known section, got ${JSON.stringify(knownKeys)}`,
    )
  }

  step('fraglimit shows its value; timelimit degrades on its own row')
  const fraglimitText = await ruleRowText(page, 'fraglimit')
  if (!fraglimitText.includes('20')) {
    throw new Error(`expected fraglimit row to include "20", got ${JSON.stringify(fraglimitText)}`)
  }
  const timelimitText = await ruleRowText(page, 'timelimit')
  if (!timelimitText.includes('abc') || !/not understood/i.test(timelimitText)) {
    throw new Error(
      `expected timelimit row to show "abc" and "not understood", got ${JSON.stringify(timelimitText)}`,
    )
  }
  const hostnameText = await ruleRowText(page, 'hostname')
  if (!hostnameText.includes('Fixture Rules Server')) {
    throw new Error(
      `expected hostname row to still render normally, got ${JSON.stringify(hostnameText)}`,
    )
  }

  step('dmflags section shows the caveat and decoded rules')
  const dmflagsSection = page.getByTestId('rules-dmflags')
  await dmflagsSection.waitFor({ timeout: TIMEOUT_MS })
  const dmflagsText = await dmflagsSection.innerText()
  if (!dmflagsText.includes('Vanilla Quake II meaning')) {
    throw new Error(`expected dmflags caveat text, got ${JSON.stringify(dmflagsText)}`)
  }
  if (!dmflagsText.includes('No falling damage') || !dmflagsText.includes('No friendly fire')) {
    throw new Error(`expected decoded dmflags rule names, got ${JSON.stringify(dmflagsText)}`)
  }
  if (!dmflagsText.includes('Unknown bit 16')) {
    throw new Error(`expected "Unknown bit 16", got ${JSON.stringify(dmflagsText)}`)
  }

  await shot('detail-rules')

  console.log(
    'servers-detail-rules: the detail pane\'s rules section lists every reported key (known and ' +
      'raw), degrades a malformed timelimit on its own row without breaking siblings, and decodes ' +
      'dmflags with its caveat visible.',
  )
}
