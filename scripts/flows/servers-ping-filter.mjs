// The Max ping filter on the real Servers surface - three loopback responders whose
// answer delay (and therefore measured ping) the flow controls, one of which goes silent so it is
// stale (offline, old low rttMs) and must never pass a ping limit. (story 247)
import { variantUserDataDir } from '../lib/harness.mjs'
import { waitForStateJson } from '../lib/state-json.mjs'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'
import {
  bindResponder,
  buildInfoReplyBytes,
  buildStatusReplyBytes,
  closeResponder,
} from '../lib/servers-stub.mjs'
import { readFinishedAt, waitForFinishedAtChange, makeVisibleLabels } from '../lib/servers-flow.mjs'

export const variant = 'servers-ping-filter'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

// A legacy entry saved before the ping limit existed: no maxPingMs key at all.
const SEEDED_QUICK_FILTERS = [
  {
    id: 'seed-legacy',
    name: 'Legacy waiting',
    criteria: {
      mod: null,
      gamemode: null,
      map: null,
      empty: false,
      hideBotsOnly: false,
      waitingForOpponent: true,
    },
  },
]

/** Answers info and status after its own `delayMs`, which the flow may change between refreshes. */
async function bindDelayed(hostname) {
  const infoLine =
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\1\\maxclients\\8` +
    '\\version\\3.20\\deathmatch\\1'
  const replies = {
    info: buildInfoReplyBytes(infoLine),
    status: buildStatusReplyBytes(infoLine, ['5 20 "Player"']),
  }
  const responder = await bindResponder(0, (kind, _message, rinfo) => {
    setTimeout(() => {
      if (!responder.closed) responder.socket.send(replies[kind], rinfo.port, rinfo.address)
    }, responder.delayMs)
  })
  responder.delayMs = 0
  return responder
}

let serverA = null
let serverB = null
let serverC = null

export async function setup() {
  serverA = await bindDelayed('Fast A')
  serverB = await bindDelayed('Slow B')
  serverB.delayMs = 100
  serverC = await bindDelayed('Stale C')

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
        manualServers: [serverA, serverB, serverC].map((entry) => ({
          address: entry.address,
          origin: 'manual',
          addedAt: FIXED_ADDED_AT,
        })),
        history: [],
        quickFilters: SEEDED_QUICK_FILTERS,
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
  await Promise.all([serverA, serverB, serverC].map((r) => r && closeResponder(r)))
}

async function refresh(page) {
  const before = await readFinishedAt(page)
  await page.getByTestId('servers-refresh').click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, before, SCAN_SETTLE_TIMEOUT_MS)
}

const visibleLabels = makeVisibleLabels(() => [
  ['A', serverA],
  ['B', serverB],
  ['C', serverC],
])

async function assertVisible(page, expected, label) {
  const actual = await visibleLabels(page)
  if (actual.join(',') !== expected.join(',')) {
    throw new Error(`${label}: expected {${expected}}, got {${actual}}`)
  }
}

const maxPing = (page) => page.getByTestId('servers-filter-max-ping')
const chipNamed = (page, name) =>
  page.getByTestId('servers-quickfilter-chip').filter({ hasText: name })

export default async function serversPingFilter({ page, step, shot }) {
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-refresh').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await refresh(page)
  await page.getByTestId(`servers-row-${serverC.address}`).waitFor({ timeout: TIMEOUT_MS })

  // C has now answered once; silencing it makes its next probe time out while the row keeps its
  // earlier, low rttMs.
  await closeResponder(serverC)
  await refresh(page)

  step('AC1: the Max ping select offers Any, < 50, < 100, < 150, < 200 ms and starts on Any')
  const labels = await maxPing(page).locator('option').allTextContents()
  const want = ['Any', '< 50 ms', '< 100 ms', '< 150 ms', '< 200 ms']
  if (labels.map((l) => l.trim()).join('|') !== want.join('|')) {
    throw new Error(`max ping options: expected ${want.join('|')}, got ${labels.join('|')}`)
  }
  if ((await maxPing(page).inputValue()) !== '') throw new Error('max ping should start on Any')

  step(
    'AC2: a limit shows only servers whose ping is below it, and a server that slows down vanishes on the next refresh',
  )
  await maxPing(page).selectOption('50')
  await assertVisible(page, ['A'], 'under < 50')
  await maxPing(page).selectOption('150')
  await assertVisible(page, ['A', 'B'], 'under < 150')
  await shot('limit-150')
  await maxPing(page).selectOption('50')
  serverA.delayMs = 100
  await refresh(page)
  await assertVisible(page, [], 'under < 50 after A slowed down')

  step('AC3: a stale server is hidden while a limit is set')
  await maxPing(page).selectOption('')
  await assertVisible(page, ['A', 'B', 'C'], 'no limit lists the stale server')
  await maxPing(page).selectOption('200')
  await assertVisible(page, ['A', 'B'], 'under < 200 hides the stale server')

  step('AC4: the count and Clear include the ping limit')
  const count = page.getByTestId('servers-filter-count')
  await count.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const countText = ((await count.textContent()) ?? '').trim()
  if (countText !== 'Showing 2 of 3') throw new Error(`count: got "${countText}"`)
  await page.getByTestId('servers-filter-clear').click({ timeout: TIMEOUT_MS })
  if ((await maxPing(page).inputValue()) !== '') throw new Error('Clear should reset max ping')
  if ((await count.count()) !== 0) throw new Error('count should be hidden after Clear')

  step(
    'AC5: the ping limit is saved in a quick filter, and a quick filter saved before it loads as Any',
  )
  await maxPing(page).selectOption('100')
  await page.getByTestId('servers-quickfilter-save').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-quickfilter-name').fill('Fast only')
  await page.getByTestId('servers-quickfilter-dialog-save').click({ timeout: TIMEOUT_MS })
  await chipNamed(page, 'Fast only').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForStateJson(
    variantUserDataDir(variant),
    (doc) =>
      doc.servers?.quickFilters?.find((q) => q.name === 'Fast only')?.criteria?.maxPingMs === 100,
    'Fast only with criteria.maxPingMs 100',
  )
  await page.getByTestId('servers-filter-clear').click({ timeout: TIMEOUT_MS })
  await chipNamed(page, 'Fast only').click({ timeout: TIMEOUT_MS })
  if ((await maxPing(page).inputValue()) !== '100') throw new Error('chip should restore < 100')
  await page.getByTestId('servers-filter-clear').click({ timeout: TIMEOUT_MS })
  await chipNamed(page, 'Legacy waiting').click({ timeout: TIMEOUT_MS })
  if ((await chipNamed(page, 'Legacy waiting').getAttribute('aria-pressed')) !== 'true') {
    throw new Error('legacy chip should apply')
  }
  if ((await page.getByTestId('servers-filter-waiting').getAttribute('aria-pressed')) !== 'true') {
    throw new Error('legacy chip should switch waiting on')
  }
  if ((await maxPing(page).inputValue()) !== '') throw new Error('legacy chip should leave Any')
  await shot('legacy-chip')

  console.log(
    'servers-ping-filter: the Max ping limit filters, hides stale rows, counts, clears and persists.',
  )
}
