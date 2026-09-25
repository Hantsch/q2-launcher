// Story 116 (docs/requirements/116-no-scan-runs-while-the-game-does.md) D6: the story's own
// offline e2e proof, covering AC1-AC4 in one app session. D1-D5 already landed the shared
// contract, the pure guard (`scan-guard.ts`), the scheduler wiring that skips/refuses/resumes
// (`scan-scheduler.ts`... actually `scan-cadence.ts` + `scan-service.ts`, see below), the
// stale-merge extraction (`scan-merge.ts`) and the renderer's blocked banner/stale row
// (`ServersView.tsx`). This flow drives all of it for real, offline (loopback only).
//
// ## Adaptation: the known-server entry is ESTABLISHED, not pre-seeded
//
// The story's own Decisions text (D-M) was written before story 114 landed and assumes a
// "pre-seeded known-server entry with players" can go straight into `state.json`. It cannot:
// `ScanService`'s known-server map (`entries`, `src/main/modules/servers/scan-service.ts`) is a
// plain in-memory `Map`, rebuilt from nothing every process start - `state.json` never touches
// it, by that file's own doc comment. So this flow, instead of seeding a `ServerListEntry`
// directly, binds a real throwaway `node:dgram` responder on loopback and runs one genuine first
// scan against it (step 2) to make main create that entry for real, then silences the responder
// (step 3, closes the socket for good) before the blocked/resume sequence - the same "answers,
// then goes quiet" shape a real server going down mid-session would produce, fully offline and
// GB-A5-safe (loopback only, no internet reachability needed).
//
// ## Wire protocol - mirrored, not imported
//
// `scripts/*.mjs` never imports `src/` TypeScript (see `fixture.mjs`'s own header) - the OOB
// envelope helpers and the message handler below are a plain-JS port of
// `src/shared/servers/reply-fixtures.ts` / `protocol.ts`, mirroring
// `src/main/modules/servers/scan-integration.test.ts`'s `bindResponder`/`decodeQueryKind`/
// per-kind message-handler shape verbatim.
//
// ## Player-count caveat (verified against the real `ServersView.tsx`, not guessed)
//
// The responder answers both `info` and `status` queries (like the integration test's own
// "populated" responder), so the established entry's `players` field ends up as the full
// `ServerPlayer[]` roster from stage 2's `status` reply, not the bare numeric `info` count
// (`scan-service.ts`'s `mergeSuccessfulReply`: `players` is only a number until a `status` reply
// lands, then it's the roster, same field). `ServersView.tsx`'s row only renders a player-count
// *span* when `typeof entry.players === 'number'` - so for this address, post-scan, no numeric
// span renders on screen (a real, pre-existing gap in D5's deliberately minimal row - the "full
// marker set" is story 118's job per D-K, not 116's). AC3's "never shown with zero players or as
// absent" is therefore proven two ways here, not one: the visible `servers-scan-blocked`-style
// stale label (`servers-row-stale-<address>`, real DOM text, D5's own acceptance surface) proves
// the *visible* stale flag, and a direct `scan.read` invoke (the same authoritative main-side data
// `scan-merge.test.ts` unit-tests) proves the *data* itself - the full 2-player roster - survived
// the round untouched, neither zeroed nor dropped.
//
// ## Passes, and why they run in this order in ONE app session
//
// 1. Navigate to Servers, establish the real known-server entry with a manual scan against the
//    live responder - this MUST happen before the responder is silenced or the game is simulated
//    running, since it needs a real reply to exist at all.
// 2. Silence the responder - from here on that address can never answer again, which is what
//    makes the later "stale, but keeps its data" round provable for real.
// 3. AC1 - simulate the game running, let the seeded 15s auto-refresh interval come due with no
//    interaction, and prove nothing ran (banner visible, `data-finished-at` unchanged).
// 4. AC2 - manual refresh while still running: disabled control + the real refused IPC value.
// 5. AC4 (then AC3) - simulate idle with no further interaction: the banner clears and a real scan
//    resumes on its own; only once that resumed round has actually run does AC3's stale-row proof
//    make sense (a round had to run and find the address silent for `stale` to mean anything).
//
// ## Selectors
//
// `nav-servers` (TitleBar.tsx), `servers-refresh` (ServersView.tsx, renamed from
// `servers-manual-refresh` by 116 D5), `servers-scan-status` (`data-running`/`data-finished-at`
// test-observability attributes), `servers-scan-blocked` (116 D5's blocked-reason line),
// `servers-row-stale-<address>` (116 D5's stale label). `module:invoke` is the renderer's single
// generic module bridge channel (`src/renderer/src/modules/moduleClient.ts`'s `callModule`) -
// used directly here (not through a click) for the two places a real IPC *value* is the actual
// proof: `scan.start`'s refusal (AC2b - a disabled `<button>` never dispatches a click, so the
// click alone cannot show the returned value) and `scan.read`'s entries (AC3's data-survival
// half). `'scan.start'`/`'servers.scan.blocked.gameRunning'` below are hand-mirrored literals of
// `SERVERS_HANDLERS.scanStart`/`SCAN_BLOCKED_GAME_RUNNING_REASON_KEY`
// (`src/shared/modules/servers.ts`) - same mirror-not-import discipline as the wire protocol.
import { createSocket } from 'node:dgram'
import {
  INSTALL_ONE_ID,
  SERVERS_DISABLED_SOURCES,
  SERVERS_MANUAL_SERVER_ADDRESS,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

export const variant = 'servers-no-scan-while-playing'

const TIMEOUT_MS = 8_000
/** The seeded scan settings' own budget: `timeoutMs: 500`/`retries: 0` (dead target settles in
 * well under a second) - this is generous headroom around that, mirroring
 * `servers-scan-settings.mjs`'s `SCAN_SETTLE_TIMEOUT_MS`. */
const SCAN_SETTLE_TIMEOUT_MS = 15_000
/** Comfortably longer than the seeded 15s `autoRefreshIntervalMs`, plus margin against CI timing
 * jitter - mirrors `job-waits-for-running-game.mjs`'s own generous fixed budget
 * (`JOB_TIMEOUT_MS = 60_000`) for "prove nothing happened over a real interval". */
const AUTO_REFRESH_DUE_WAIT_MS = 20_000
/** Budget for the blocked banner to detach and for the resumed scan to finish once the game goes
 * idle - the resumed round is a single dead (silenced) target on the same 500ms/0-retry budget. */
const RESUME_TIMEOUT_MS = 15_000

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

async function bindResponder() {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  return { socket, port: socket.address().port }
}

const RESPONDER_HOSTNAME = 'Fixture Live Server'
const RESPONDER_INFO_LINE =
  `\\gamename\\baseq2\\hostname\\${RESPONDER_HOSTNAME}\\mapname\\q2dm1\\clients\\2\\maxclients\\8\\version\\3.20`
const RESPONDER_PLAYER_LINES = ['5 20 "Alpha"', '3 10 "Bravo"']

/** Mirrors `SERVERS_HANDLERS.scanStart`/`scanRead` (`src/shared/modules/servers.ts`) by hand. */
const SCAN_START_TYPE = 'scan.start'
const SCAN_READ_TYPE = 'scan.read'
/** Mirrors `SCAN_BLOCKED_GAME_RUNNING_REASON_KEY` (`src/shared/modules/servers.ts`) by hand. */
const SCAN_BLOCKED_GAME_RUNNING_REASON_KEY = 'servers.scan.blocked.gameRunning'

let responder = null
let responderClosed = true
let populatedAddress = null

async function closeResponderOnce() {
  if (responder === null || responderClosed) return
  responderClosed = true
  await new Promise((resolve) => responder.socket.close(() => resolve()))
}

export async function setup() {
  responder = await bindResponder()
  responderClosed = false

  responder.socket.on('message', (message, rinfo) => {
    const kind = decodeQueryKind(message)
    if (kind === 'info') {
      responder.socket.send(buildInfoReplyBytes(RESPONDER_INFO_LINE), rinfo.port, rinfo.address)
    } else if (kind === 'status') {
      responder.socket.send(
        buildStatusReplyBytes(RESPONDER_INFO_LINE, RESPONDER_PLAYER_LINES),
        rinfo.port,
        rinfo.address,
      )
    }
  })

  populatedAddress = `127.0.0.1:${responder.port}`

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
        manualServers: [
          {
            address: SERVERS_MANUAL_SERVER_ADDRESS,
            origin: 'manual',
            addedAt: '2026-01-01T00:00:00.000Z',
          },
          { address: populatedAddress, origin: 'manual', addedAt: '2026-01-01T00:00:00.000Z' },
        ],
        history: [],
        scan: {
          concurrency: 4,
          timeoutMs: 500,
          retries: 0,
          minSpacingMs: 0,
          autoScanOnOpen: false,
          autoRefreshEnabled: true,
          autoRefreshIntervalMs: 15_000,
        },
      },
    },
  })

  return {}
}

export async function teardown() {
  // Constraint: never leak a bound socket across runs, whichever step the flow stopped at -
  // step 3 below already closes it deliberately mid-flow (`responderClosed` is then already
  // `true` and this is a no-op); this is the safety net for a throw anywhere before that.
  await closeResponderOnce()
}

/** Mirrors `job-waits-for-running-game.mjs`'s own helper verbatim. */
async function simulateLaunch(page, installationId, phase) {
  const outcome = await page.evaluate(
    ({ id, ph }) => window.q2.invoke('dev:simulateLaunch', { installationId: id, phase: ph }),
    { id: installationId, ph: phase },
  )
  if (!outcome?.ok) {
    throw new Error(`dev:simulateLaunch(${phase}) failed: ${JSON.stringify(outcome)}`)
  }
}

async function invokeScanStart(page) {
  return page.evaluate(() =>
    window.q2.invoke('module:invoke', { moduleId: 'servers', type: 'scan.start' }),
  )
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

async function waitForRunning(page, running) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="servers-scan-status"]')?.getAttribute('data-running') ===
      expected,
    String(running),
    { timeout: TIMEOUT_MS },
  )
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

/** Derives a comparable count from `ServerListEntry.players`, which can be either the bare `info`
 * count (a `number`) or the full `status` roster (a `ServerPlayer[]`) - see the file header's
 * player-count caveat. Returns `null` for neither shape (i.e. truly absent). */
function playerCountOf(entry) {
  if (typeof entry?.players === 'number') return entry.players
  if (Array.isArray(entry?.players)) return entry.players.length
  return null
}

export default async function serversNoScanWhilePlaying({ page, step, shot }) {
  step('navigate to the Servers view')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const manualRefresh = page.getByTestId('servers-refresh')
  await manualRefresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('establish the real known-server entry via a genuine first scan against the live responder')
  const finishedAtBeforeFirstScan = await readFinishedAt(page)
  await manualRefresh.click({ timeout: TIMEOUT_MS })
  await waitForRunning(page, true)
  await waitForFinishedAtChange(page, finishedAtBeforeFirstScan, SCAN_SETTLE_TIMEOUT_MS)
  await shot('first-scan-established-entry')

  step('silence the responder - from here on that address can never answer again')
  await closeResponderOnce()

  step('simulate the game running')
  await simulateLaunch(page, INSTALL_ONE_ID, 'running')

  const finishedAtBeforeBlockedWait = await readFinishedAt(page)

  step('AC1: wait past the seeded 15s auto-refresh interval with no interaction - nothing runs')
  await page.waitForTimeout(AUTO_REFRESH_DUE_WAIT_MS)
  const blockedBanner = page.getByTestId('servers-scan-blocked')
  await blockedBanner.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const blockedText = (await blockedBanner.textContent())?.trim() ?? ''
  if (blockedText.length === 0) {
    throw new Error('expected servers-scan-blocked to carry real, non-empty text (AC1)')
  }
  const finishedAtAfterWait = await readFinishedAt(page)
  if (finishedAtAfterWait !== finishedAtBeforeBlockedWait) {
    throw new Error(
      `expected data-finished-at to stay ${JSON.stringify(finishedAtBeforeBlockedWait)} while blocked, ` +
        `got ${JSON.stringify(finishedAtAfterWait)} (AC1: the due auto-refresh must be skipped, not queued)`,
    )
  }
  await shot('blocked-auto-refresh-skipped')

  step('AC2: a manual scan attempted while running is refused, not silently ignored or queued')
  if (!(await manualRefresh.isDisabled())) {
    throw new Error('expected servers-refresh to be disabled while a game session is active (AC2)')
  }
  const refusal = await invokeScanStart(page)
  if (refusal?.ok !== true) {
    throw new Error(`expected the module:invoke transport to succeed, got ${JSON.stringify(refusal)}`)
  }
  if (refusal.value?.ok !== false || refusal.value.reasonKey !== SCAN_BLOCKED_GAME_RUNNING_REASON_KEY) {
    throw new Error(
      `expected scan.start to refuse with ${JSON.stringify(SCAN_BLOCKED_GAME_RUNNING_REASON_KEY)}, ` +
        `got ${JSON.stringify(refusal.value)} (AC2)`,
    )
  }
  await blockedBanner.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtAfterRefusal = await readFinishedAt(page)
  if (finishedAtAfterRefusal !== finishedAtBeforeBlockedWait) {
    throw new Error(
      `expected data-finished-at to still be ${JSON.stringify(finishedAtBeforeBlockedWait)} after the ` +
        `refused manual scan, got ${JSON.stringify(finishedAtAfterRefusal)} (AC2)`,
    )
  }
  await shot('blocked-manual-refused')

  step('AC4: the moment the game session ends, scanning resumes with no user action')
  await simulateLaunch(page, INSTALL_ONE_ID, 'idle')
  await blockedBanner.waitFor({ state: 'detached', timeout: RESUME_TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBeforeBlockedWait, RESUME_TIMEOUT_MS)
  await shot('resumed-after-game-ended')

  step('AC3: the silenced server keeps its last known data, visibly flagged as stale')
  const staleRow = page.getByTestId(`servers-row-stale-${populatedAddress}`)
  await staleRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const staleText = (await staleRow.textContent())?.trim() ?? ''
  if (staleText.length === 0) {
    throw new Error('expected the stale row label to carry real, non-empty text (AC3)')
  }

  const snapshot = await invokeScanRead(page)
  if (snapshot?.ok !== true) {
    throw new Error(`expected scan.read to succeed, got ${JSON.stringify(snapshot)}`)
  }
  const entry = snapshot.value.entries.find((candidate) => candidate.address === populatedAddress)
  if (!entry) {
    throw new Error(`expected an entry for ${populatedAddress} to survive the resumed round (AC3)`)
  }
  if (entry.status !== 'stale') {
    throw new Error(`expected ${populatedAddress}'s entry to be marked stale, got status ${JSON.stringify(entry.status)} (AC3)`)
  }
  const playerCount = playerCountOf(entry)
  if (playerCount !== RESPONDER_PLAYER_LINES.length) {
    throw new Error(
      `expected ${populatedAddress}'s player count to still be ${RESPONDER_PLAYER_LINES.length} ` +
        `(never zeroed, never dropped), got ${JSON.stringify(entry.players)} (AC3)`,
    )
  }
  await shot('stale-row-keeps-player-count')

  console.log(
    'servers-no-scan-while-playing: a due auto-refresh was skipped (not queued) while the game ran ' +
      '(AC1), a manual refresh was refused with the same visible reason and the real IPC refusal ' +
      '(AC2), scanning resumed on its own the moment the session ended (AC4), and the silenced ' +
      "server's row stayed flagged stale while keeping its full player data instead of reading as " +
      'empty or absent (AC3)',
  )
}
