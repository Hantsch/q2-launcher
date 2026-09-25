// Story 126 (docs/requirements/126-i-spectate-without-picking-a-side.md) D3: the story's own e2e
// acceptance proof for the Spectate action next to Join. Mirrors `servers-join.mjs`'s own
// structure and wire protocol almost exactly (same OOB envelope/`info`+`status` responder shape,
// same real spawnable installation via `writeJoinInstallRoot()`) - the one difference this flow
// exercises is the *spectator* password bit (`\needpass\2`, bit 1) rather than the join password
// bit (bit 0), which `JoinServerButton`'s `mode="spectate"` reads through `needsSpectatePassword`/
// `needsPassword` (`join-flow.ts`) while ignoring `needpass` entirely.
//
// ## Wire protocol - mirrored, not imported
//
// Same `encodeLatin1`/`buildInfoReplyBytes`/`buildStatusReplyBytes`/`decodeQueryKind` helpers as
// `servers-join.mjs`/`servers-scoped-refresh.mjs` (`scripts/*.mjs` never imports `src/`
// TypeScript, per `fixture.mjs`'s own header comment) - copied rather than shared, same as those
// two files already do with each other.
//
// ## Fixture: one real installation, one manual server needing only a spectator password
//
// The active installation's `activeGameDir` is `''` (plain `baseq2`); the one responder's
// `gamename` is also `baseq2`, so there is no mod mismatch to click through - this flow is about
// the password bit split, not the mismatch dialog (already covered by `servers-join.mjs`). Its
// info line carries `\needpass\2`: bit 0 (join password) clear, bit 1 (spectator password) set -
// `scan-service.ts`'s own decode (`(n & 1) === 1` / `(n & 2) !== 0`).
//
// `writeJoinFixture()` (`scripts/lib/fixture.mjs`) is reused verbatim rather than duplicated, with
// its own `variant: 'servers-spectate'` so this flow's userDataDir never collides with
// `servers-join.mjs`'s.
//
// ## The load-bearing assertions
//
// - The spectator password prompt appears (and nothing has launched yet) before any spawn -
//   proven by reading `main.log`'s "launching" line count, unchanged until submit.
// - The spawned stub's argv ends `+exec q2launcher-connect.cfg +connect <address>` (same tail
//   shape as a password join) and `main.log` never contains the literal password `s3cret`
//   anywhere (mirrors `servers-join.mjs`'s AC6 assertion).
// - The one-shot connect cfg, while the game is running, sets `spectator "s3cret"` - not
//   `password` - because `resolveEffectiveUserinfo()` (`launch-plan.ts`) folds a spectate-mode
//   password into the `spectator` cfg key, never `password` (see that function and
//   `renderConnectCfg`, `src/shared/launch/userinfo.ts`).
// - A history entry for the address exists afterward (`history.read`, same as `servers-join.mjs`).
//
// ## Selectors
//
// `nav-servers` (TitleBar.tsx), `servers-refresh`/`servers-row-<address>` (ServersView.tsx),
// `servers-spectate` (the list toolbar's `JoinServerButton` in `mode="spectate"`, story 126 D3),
// `servers-join-password`/`-password-submit`/`-password-cancel` (`JoinServerButton.tsx` - the
// password prompt's container/testids are shared between join and spectate mode; only its title/
// label copy differs, via `servers.spectate.passwordTitle`/`passwordLabel`).
import { createSocket } from 'node:dgram'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeJoinFixture } from '../lib/fixture.mjs'

export const variant = 'servers-spectate'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const LAUNCH_TIMEOUT_MS = 15_000
const LOG_POLL_TIMEOUT_MS = 10_000
const CONNECT_CFG_NAME = 'q2launcher-connect.cfg'
const BASE_GAME_DIR = 'baseq2'
const SPECTATE_PASSWORD = 's3cret'

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

/** One loopback responder whose info line carries `\needpass\2` - bit 1 (spectator password) set,
 * bit 0 (join password) clear. Mirrors `servers-join.mjs`'s `bindResponder`, minus the
 * `gamename`/`needpass` knobs this flow does not need. */
async function bindResponder(hostname, playerLines) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`
  const infoLine =
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
    `\\maxclients\\8\\version\\3.20\\needpass\\2`
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

let server = null
let installRoot = null
let spawnable = true

export async function setup() {
  server = await bindResponder('Fixture Spectate Server', ['4 12 "Charlie1"'])

  const fixture = writeJoinFixture({
    variant: 'servers-spectate',
    servers: {
      sources: [],
      favourites: [],
      manualServers: [{ address: server.address, origin: 'manual', addedAt: FIXED_ADDED_AT }],
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
  if (server) await closeResponder(server)
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

async function waitForPhase(page, phase, timeout) {
  await page.waitForFunction(
    (expected) => (window.__q2lPhases ?? []).includes(expected),
    phase,
    { timeout },
  )
}

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

function countLaunchingLines(logContent) {
  return logContent.split(/\r?\n/).filter((line) => line.includes('launching')).length
}

function lastLaunchingLine(logContent) {
  const lines = logContent.split(/\r?\n/).filter((line) => line.includes('launching'))
  return lines.length > 0 ? lines[lines.length - 1] : null
}

async function waitForCfgRemoved(cfgPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (existsSync(cfgPath)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${cfgPath} to be removed`)
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/** Watches the connect cfg from the moment it is armed until `stop()` - the stand-in client exits
 * within milliseconds, so a poll after the fact could miss it entirely (mirrors `servers-join.mjs`'s
 * own `watchCfg`). Records only whether it ever mentioned "spectator", never the value itself. */
function watchCfg(cfgPath) {
  const seen = { existed: false, mentionsSpectator: false }
  let stopped = false
  const tick = () => {
    if (stopped || seen.mentionsSpectator) return
    if (existsSync(cfgPath)) {
      seen.existed = true
      try {
        if (readFileSync(cfgPath, 'utf8').includes('spectator')) seen.mentionsSpectator = true
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

export default async function serversSpectate({ page, step, shot }) {
  if (!spawnable) {
    console.log(
      'servers-spectate: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored locally ' +
        '(`npm run fetch:7za` never ran), so this flow has no real spawnable stand-in client. ' +
        'Every other flow with the same dependency (e.g. servers-join.mjs) skips the same way.',
    )
    return
  }

  const cfgPath = join(installRoot, BASE_GAME_DIR, CONNECT_CFG_NAME)

  step('navigate to Servers and run a first refresh so the fixture row exists')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)

  const { logPath } = await invoke(page, 'app:getInfo')
  console.log(`  main.log: ${logPath}`)
  const launchingCountBefore = countLaunchingLines(readLog(logPath))

  step('select the server and press Spectate - a spectator password is required')
  await page.getByTestId(`servers-row-${server.address}`).click({ timeout: TIMEOUT_MS })
  await armPhaseListener(page)
  const spectateButton = page.getByTestId('servers-spectate').first()
  await spectateButton.click({ timeout: TIMEOUT_MS })

  if ((await page.getByTestId('servers-join-mismatch').count()) !== 0) {
    throw new Error('expected no mismatch dialog - the fixture server shares the install mod')
  }

  const passwordDialog = page.getByTestId('servers-join-password')
  await passwordDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('spectate-password-dialog')

  // Nothing has launched yet - the prompt appeared before any spawn (main.log's "launching" count
  // is unchanged since the refresh above, and no launch:state event has fired).
  const logAtPrompt = readLog(logPath)
  if (countLaunchingLines(logAtPrompt) !== launchingCountBefore) {
    throw new Error('expected no new "launching" line in main.log before the password was submitted')
  }
  const phasesAtPrompt = await page.evaluate(() => window.__q2lPhases ?? [])
  if (phasesAtPrompt.length !== 0) {
    throw new Error(
      `expected no launch:state change before the spectator password is submitted, got ${JSON.stringify(phasesAtPrompt)}`,
    )
  }

  step('enter the spectator password and submit')
  if (existsSync(cfgPath)) {
    throw new Error(`expected no ${CONNECT_CFG_NAME} before the spectate join was submitted`)
  }
  const cfgWatch = watchCfg(cfgPath)
  await passwordDialog.locator('input[type="password"]').fill(SPECTATE_PASSWORD)
  await page.getByTestId('servers-join-password-submit').click({ timeout: TIMEOUT_MS })

  await waitForPhase(page, 'running', LAUNCH_TIMEOUT_MS)
  await waitForPhase(page, 'exited', LAUNCH_TIMEOUT_MS)
  cfgWatch.stop()

  if (!cfgWatch.seen.existed) {
    throw new Error(`expected ${cfgPath} to exist while the spectate join was starting/running - it never appeared`)
  }
  if (!cfgWatch.seen.mentionsSpectator) {
    throw new Error(
      `expected ${CONNECT_CFG_NAME} to set the spectator password (a "spectator" cfg line), but its content never mentioned it`,
    )
  }

  const expectedTail = `+exec ${CONNECT_CFG_NAME} +connect ${server.address}`
  const logAfter = await waitForLogContains(logPath, expectedTail, LOG_POLL_TIMEOUT_MS)
  const launchLine = lastLaunchingLine(logAfter)
  if (!launchLine || !launchLine.trimEnd().endsWith(expectedTail)) {
    throw new Error(
      `expected the newest "launching" line to end with ${JSON.stringify(expectedTail)}, got ` +
        JSON.stringify(launchLine),
    )
  }
  if (logAfter.includes(SPECTATE_PASSWORD)) {
    throw new Error(`main.log contains the literal spectator password "${SPECTATE_PASSWORD}"`)
  }

  await waitForCfgRemoved(cfgPath, LOG_POLL_TIMEOUT_MS)

  const history = await readHistory(page)
  if (history[0]?.address !== server.address) {
    throw new Error(
      `expected ${server.address} to be first in history after spectating it, got ${JSON.stringify(history)}`,
    )
  }
  await shot('spectate-joined')

  console.log(
    'servers-spectate: the spectator password prompt appeared before any spawn, submitting it ' +
      'produced +exec q2launcher-connect.cfg +connect in argv with the spectator password never ' +
      'appearing in main.log, the one-shot cfg set "spectator" (not "password") while the game was ' +
      'running and was removed on exit, and a history entry for the address exists afterward.',
  )
}
