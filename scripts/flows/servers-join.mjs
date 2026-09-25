// Story 125 (docs/requirements/125-i-join-a-server-from-the-browser.md) D5: the story's own e2e
// acceptance proof (AC1, AC3, AC4, AC5, AC6) for the join flow D4 already built
// (`src/renderer/src/modules/servers/join/JoinServerButton.tsx`) and this deliverable's own
// placement of the same button into the server detail header (`servers-detail-join`).
//
// Two genuine loopback `dgram` responders stand in for two manual servers - B (same mod as the
// active installation, no password) and A (a different mod, `ctf`, AND password-protected) - so a
// single flow exercises both the no-friction join (AC1/AC5) and the full
// mismatch-then-password-then-join sequence (AC3/AC4/AC6) against one real, spawnable installation
// (`writeJoinInstallRoot()`, `scripts/lib/fixture.mjs`, mirroring `writeLinuxJourneyInstallRoot()`'s
// own stand-in-client trick).
//
// ## Wire protocol - mirrored, not imported
//
// Same OOB envelope / `info`+`status` responder shape as `servers-row-markers.mjs`/
// `servers-scoped-refresh.mjs` (`scripts/*.mjs` never imports `src/` TypeScript). Unlike those two
// files' own `bindResponder`, this one takes an explicit `gamename` (not just an extra gametype
// flag) - AC3's mismatch is judged on `serverinfo.gamename` (`scan-service.ts`'s `mod` derivation),
// not on a `\deathmatch\1\ctf\1`-style flag.
//
// ## Fixture: one real installation, two manual servers, no master sources
//
// The active installation's `activeGameDir` is `''` (i.e. plain `baseq2`, CLAUDE.md's own
// convention) - server B's `gamename` is also `baseq2`, so B is a clean, no-mismatch join; server
// A's `gamename` is `ctf`, so A always trips the mismatch dialog. `installations` is a full
// top-level `stateOverrides` replace (`populatedStateDocument`'s own merge discipline: a listed key
// replaces wholesale) seeded with exactly one installation, at `JOIN_INSTALL_ID` -
// `DEFAULT_SETTINGS`'s own `activeInstallationId: null` is not enough, so `settings` is replaced
// wholesale too, pointing at that same id (mirrors `src/shared/types/settings.ts`'s
// `DEFAULT_SETTINGS` literal by hand, the same non-import discipline `fixture.mjs`'s own local copy
// already follows).
//
// ## The load-bearing assertion (AC6)
//
// A join password must never reach `main.log` or `argv`. `LaunchService.start()` (`src/main/
// services/launch.ts`) logs only `args.join(' ')` (never a userinfo value) and writes the password
// into a one-shot `+exec`'d cfg instead - this flow's step 3 types a password containing a space
// (`hunter2 x`, itself only valid because `parseUserinfoValue` allows spaces) and then greps the
// ENTIRE log file for the literal string `hunter2`, not just the `launching` line.
//
// ## Selectors
//
// `nav-servers` (TitleBar.tsx), `servers-refresh`/`servers-row-<address>` (ServersView.tsx),
// `servers-join` (the list toolbar's `JoinServerButton`, story 125 D4),
// `servers-join-mismatch`/`-mismatch-confirm`/`-mismatch-cancel`,
// `servers-join-password`/`-password-submit`/`-password-cancel` (`JoinServerButton.tsx`),
// `servers-detail-join` (this deliverable's own placement in `ServerDetailHeader.tsx`).
// `module:invoke` reads `history.read` directly - the authoritative, main-side proof of AC5, since
// a screenshot alone cannot prove ordering across two joins.
import { createSocket } from 'node:dgram'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SERVERS_DISABLED_SOURCES, writeJoinFixture } from '../lib/fixture.mjs'

export const variant = 'servers-join'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
/** A real handoff spawn/exit, end to end - generous, but this is never a download job (mirrors
 * `steam-handoff.mjs`'s own `LAUNCH_TIMEOUT_MS`). */
const LAUNCH_TIMEOUT_MS = 15_000
const LOG_POLL_TIMEOUT_MS = 10_000
const CONNECT_CFG_NAME = 'q2launcher-connect.cfg'
const BASE_GAME_DIR = 'baseq2'

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

/** Binds one loopback responder with an explicit `gamename` (this flow's mismatch/no-mismatch
 * split is judged on that field, not a gametype flag - see file header). */
async function bindResponder(hostname, playerLines, { gamename = 'baseq2', needpass = false } = {}) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`
  const infoLine =
    `\\gamename\\${gamename}\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
    `\\maxclients\\8\\version\\3.20${needpass ? '\\needpass\\1' : ''}`
  const responder = { socket, port, address, closed: false }

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
let responders = []
let installRoot = null
let spawnable = true

export async function setup() {
  serverB = await bindResponder('Fixture Server B', ['5 20 "Bravo1"'], { gamename: 'baseq2' })
  serverA = await bindResponder('Fixture Server A', ['3 9 "Alpha1"'], {
    gamename: 'ctf',
    needpass: true,
  })
  responders = [serverA, serverB]

  const fixture = writeJoinFixture({
    servers: {
      sources: SERVERS_DISABLED_SOURCES,
      favourites: [],
      manualServers: [serverA, serverB].map((responder) => ({
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
  })
  installRoot = fixture.installRoot
  spawnable = fixture.spawnable

  return {}
}

export async function teardown() {
  await Promise.all(responders.map((responder) => closeResponder(responder)))
}

/** The list toolbar's own `JoinServerButton` (ServersView.tsx) - once a row is selected, the
 * detail pane (ServerDetailView.tsx) mounts a second one under `servers-detail-join`, sharing
 * the same inner `servers-join` testid, so a bare `getByTestId('servers-join')` is ambiguous.
 * The list column renders before the detail column in `ServersView.tsx`'s own JSX (confirmed by
 * reading the file), so `.first()` is always the toolbar's button, never the detail one. */
function listJoinButton(page) {
  return page.getByTestId('servers-join').first()
}

async function invokeModule(page, type) {
  return page.evaluate(
    (t) => window.q2.invoke('module:invoke', { moduleId: 'servers', type: t }),
    type,
  )
}

async function invoke(page, channel, payload) {
  return page.evaluate(({ ch, p }) => window.q2.invoke(ch, p), { ch: channel, p: payload })
}

async function readHistory(page) {
  const result = await invokeModule(page, 'history.read')
  if (result?.ok !== true) {
    throw new Error(`expected history.read to succeed, got ${JSON.stringify(result)}`)
  }
  return result.value
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

/** Arms a fresh `launch:state` phase collector, replacing whatever was armed before - each of the
 * flow's three joins calls this so a later join's phases can never be confused with an earlier
 * one's (mirrors `steam-handoff.mjs`'s own single-arm pattern, just re-armed per join here). */
async function armPhaseListener(page) {
  await page.evaluate(() => {
    window.__q2lPhases = []
    if (!window.__q2lListenerArmed) {
      window.__q2lListenerArmed = true
      window.q2.on('launch:state', (state) => {
        window.__q2lPhases.push(state.phase)
      })
    }
  })
}

async function readPhases(page) {
  return page.evaluate(() => window.__q2lPhases ?? [])
}

async function waitForPhase(page, phase, timeout) {
  await page.waitForFunction(
    (expected) => (window.__q2lPhases ?? []).includes(expected),
    phase,
    { timeout },
  )
}

/** Polls `logPath` until its contents contain `substring`, or throws once `timeoutMs` elapses -
 * `electron-log`'s file transport writes asynchronously, so a synchronous read right after a
 * `spawn()` can race it. */
async function waitForLogContains(logPath, substring, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    if (content.includes(substring)) return content
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${JSON.stringify(logPath)} to contain ` +
          `${JSON.stringify(substring)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

function readLog(logPath) {
  return existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
}

/** The most recent line containing "launching", or `null` if there is none yet. */
function lastLaunchingLine(logContent) {
  const lines = logContent.split(/\r?\n/).filter((line) => line.includes('launching'))
  return lines.length > 0 ? lines[lines.length - 1] : null
}

function countLaunchingLines(logContent) {
  return logContent.split(/\r?\n/).filter((line) => line.includes('launching')).length
}

/** Polls until the connect cfg is gone - `LaunchService`'s `removeOwnedCfg()` runs fire-and-forget
 * off the child's `'exit'` event, so it can lag slightly behind the `exited` phase broadcast. */
async function waitForCfgRemoved(cfgPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (existsSync(cfgPath)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${cfgPath} to be removed`)
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/**
 * Review fix (story 125): watches for the connect cfg from the moment it is armed until `stop()`,
 * so `waitForCfgRemoved` above can no longer pass vacuously on a file that was never written. The
 * stand-in client exits within milliseconds, so the file lives only from `LaunchService.start()`'s
 * write (before `spawn`) to `removeOwnedCfg()` (after `'exit'`) - far too briefly for a poll after
 * `waitForPhase`. This checks on every event-loop turn instead, reading the content the first time
 * the file is seen. Only a boolean "mentions password" is kept - never the value itself.
 */
function watchCfg(cfgPath) {
  const seen = { existed: false, mentionsPassword: false }
  let stopped = false
  const tick = () => {
    if (stopped || seen.mentionsPassword) return
    if (existsSync(cfgPath)) {
      seen.existed = true
      try {
        // Re-read on later turns too: the first sighting can be the instant `writeFile` has
        // created the file but not yet filled it.
        if (readFileSync(cfgPath, 'utf8').includes('password')) seen.mentionsPassword = true
      } catch {
        // Removed between the two calls - the flags already record what was seen.
      }
    }
    setImmediate(tick)
  }
  setImmediate(tick)
  return {
    seen,
    stop() {
      stopped = true
    },
  }
}

export default async function serversJoin({ page, step, shot }) {
  if (!spawnable) {
    console.log(
      'servers-join: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored locally ' +
        '(`npm run fetch:7za` never ran), so this flow has no real spawnable stand-in client. ' +
        'Every other flow with the same dependency (e.g. linux-user-journey.mjs) skips the same way.',
    )
    return
  }

  const cfgPath = join(installRoot, BASE_GAME_DIR, CONNECT_CFG_NAME)

  step('navigate to Servers and run a first refresh so both fixture rows exist')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)

  const { logPath } = await invoke(page, 'app:getInfo')
  console.log(`  main.log: ${logPath}`)

  // --- Step 1: join B - same mod, no password - no dialogs, a real launch (AC1/AC5) ---

  step('select server B and press Join - same mod as the active install, no password needed')
  await page.getByTestId(`servers-row-${serverB.address}`).click({ timeout: TIMEOUT_MS })
  await armPhaseListener(page)
  await listJoinButton(page).click({ timeout: TIMEOUT_MS })

  if ((await page.getByTestId('servers-join-mismatch').count()) !== 0) {
    throw new Error('expected no mismatch dialog for server B (same mod as the active install)')
  }
  if ((await page.getByTestId('servers-join-password').count()) !== 0) {
    throw new Error('expected no password dialog for server B (needpass is not set)')
  }

  await waitForPhase(page, 'running', LAUNCH_TIMEOUT_MS)
  await waitForPhase(page, 'exited', LAUNCH_TIMEOUT_MS)

  const logAfterB = await waitForLogContains(logPath, `+connect ${serverB.address}`, LOG_POLL_TIMEOUT_MS)
  const launchLineB = lastLaunchingLine(logAfterB)
  if (!launchLineB || !launchLineB.includes('launching') || !launchLineB.includes(`+connect ${serverB.address}`)) {
    throw new Error(
      `expected the newest "launching" line to contain "+connect ${serverB.address}", got ` +
        JSON.stringify(launchLineB),
    )
  }
  const launchingCountAfterB = countLaunchingLines(logAfterB)

  const historyAfterB = await readHistory(page)
  if (historyAfterB[0]?.address !== serverB.address) {
    throw new Error(
      `expected server B (${serverB.address}) to be first in history after joining it, got ` +
        JSON.stringify(historyAfterB),
    )
  }
  await shot('joined-b-no-friction')

  // --- Step 2: attempt A - mismatch, then cancel at the password step (AC3/AC4) ---

  step('select server A and press Join - different mod triggers the mismatch dialog')
  await page.getByTestId(`servers-row-${serverA.address}`).click({ timeout: TIMEOUT_MS })
  await armPhaseListener(page)
  await listJoinButton(page).click({ timeout: TIMEOUT_MS })

  const mismatchDialog = page.getByTestId('servers-join-mismatch')
  await mismatchDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const mismatchText = (await mismatchDialog.textContent()) ?? ''
  if (!mismatchText.includes('ctf') || !mismatchText.includes('baseq2')) {
    throw new Error(`expected the mismatch dialog to name both "ctf" and "baseq2", got ${JSON.stringify(mismatchText)}`)
  }
  await shot('join-mismatch-dialog')

  await page.getByTestId('servers-join-mismatch-confirm').click({ timeout: TIMEOUT_MS })
  const passwordDialog = page.getByTestId('servers-join-password')
  await passwordDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('join-password-dialog')

  const phasesAtPassword = await readPhases(page)
  if (phasesAtPassword.length !== 0) {
    throw new Error(
      `expected no launch:state change before the password is submitted, got ${JSON.stringify(phasesAtPassword)} (AC4)`,
    )
  }

  step('cancel at the password step - nothing launches, history stays untouched')
  await page.getByTestId('servers-join-password-cancel').click({ timeout: TIMEOUT_MS })
  await mismatchDialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await passwordDialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  const logAfterCancel = readLog(logPath)
  if (countLaunchingLines(logAfterCancel) !== launchingCountAfterB) {
    throw new Error('expected no new "launching" line in main.log after cancelling the password step (AC4)')
  }
  const historyAfterCancel = await readHistory(page)
  if (JSON.stringify(historyAfterCancel) !== JSON.stringify(historyAfterB)) {
    throw new Error('expected history.read to be unchanged after cancelling the password step (AC4/AC5)')
  }

  // --- Step 3: join A for real, with a password - never in argv or main.log (AC6) ---

  step('press Join on A again (still selected - clicking a selected row would deselect it), confirm the mismatch, and submit a password with a space in it')
  await armPhaseListener(page)
  await listJoinButton(page).click({ timeout: TIMEOUT_MS })
  await mismatchDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('servers-join-mismatch-confirm').click({ timeout: TIMEOUT_MS })
  await passwordDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const JOIN_PASSWORD = 'hunter2 x'
  await passwordDialog.locator('input[type="password"]').fill(JOIN_PASSWORD)

  // Nothing launched since step 1's own run (whose sweep and cleanup removed any cfg), so a file
  // seen from here on can only be the one this join writes.
  if (existsSync(cfgPath)) {
    throw new Error(`expected no ${CONNECT_CFG_NAME} before the password join was submitted`)
  }
  const cfgWatch = watchCfg(cfgPath)
  await page.getByTestId('servers-join-password-submit').click({ timeout: TIMEOUT_MS })

  await waitForPhase(page, 'running', LAUNCH_TIMEOUT_MS)
  await waitForPhase(page, 'exited', LAUNCH_TIMEOUT_MS)
  cfgWatch.stop()

  // AC6's other half: the password went through the cfg, which was really on disk for the launch.
  if (!cfgWatch.seen.existed) {
    throw new Error(`expected ${cfgPath} to exist while the password join was starting/running - it never appeared`)
  }
  if (!cfgWatch.seen.mentionsPassword) {
    throw new Error(`expected ${CONNECT_CFG_NAME} to set the join password, but its content never mentions "password"`)
  }

  const expectedTail = `+exec ${CONNECT_CFG_NAME} +connect ${serverA.address}`
  const logAfterA = await waitForLogContains(logPath, expectedTail, LOG_POLL_TIMEOUT_MS)
  const launchLineA = lastLaunchingLine(logAfterA)
  if (!launchLineA || !launchLineA.trimEnd().endsWith(expectedTail)) {
    throw new Error(
      `expected the newest "launching" line to end with ${JSON.stringify(expectedTail)}, got ` +
        JSON.stringify(launchLineA),
    )
  }
  if (logAfterA.includes('hunter2')) {
    throw new Error('main.log contains the literal join password "hunter2" - AC6 violated')
  }

  await waitForCfgRemoved(cfgPath, LOG_POLL_TIMEOUT_MS)

  const historyAfterA = await readHistory(page)
  if (historyAfterA[0]?.address !== serverA.address) {
    throw new Error(
      `expected server A (${serverA.address}) to be first in history after joining it, got ` +
        JSON.stringify(historyAfterA),
    )
  }
  await shot('joined-a-with-password')

  step("screenshot the detail view's own Join button (this deliverable's placement)")
  const detail = page.getByTestId('servers-detail')
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('servers-detail-join').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('detail-join-button')

  console.log(
    'servers-join: joined server B with no dialogs at all (same mod, no password - AC1/AC5), ' +
      'server A triggered the mismatch dialog naming both "ctf" and "baseq2" (AC3), cancelling at ' +
      'the password step left nothing launched and history untouched (AC4/AC5), and joining A for ' +
      'real with a password produced +exec q2launcher-connect.cfg +connect in argv, never the ' +
      'password itself anywhere in main.log (AC6), and the one-shot cfg was removed on exit.',
  )
}
