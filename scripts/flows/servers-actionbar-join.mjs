// Story 181 D2 e2e: the Servers tab contributes "Join" to the action bar's big button
// (`actionbar-play`). Same fixture shape as `servers-join.mjs` - two loopback responders, B
// (baseq2, no password) and A (ctf, needs a password) - but every join here is pressed from the
// action bar, never from the list toolbar's or the detail header's own Join button.
import { createSocket } from 'node:dgram'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SERVERS_DISABLED_SOURCES, writeJoinFixture } from '../lib/fixture.mjs'

export const variant = 'servers-actionbar-join'

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

/** Binds one loopback responder with an explicit `gamename` (this flow's mismatch/no-mismatch
 * split is judged on that field, not a gametype flag - see file header). */
async function bindResponder(
  hostname,
  playerLines,
  { gamename = 'baseq2', needpass = false } = {},
) {
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
    variant,
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

async function invoke(page, channel, payload) {
  return page.evaluate(({ ch, p }) => window.q2.invoke(ch, p), { ch: channel, p: payload })
}

export default async function serversActionbarJoin({ page, step, shot }) {
  if (!spawnable) {
    console.log(
      'servers-actionbar-join: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored locally ' +
        '(`npm run fetch:7za` never ran), so there is no spawnable stand-in client.',
    )
    return
  }

  const bar = page.getByTestId('actionbar-play')
  const expectBar = async (label, disabled) => {
    await page
      .waitForFunction(
        ([want, off]) => {
          const el = document.querySelector('[data-testid="actionbar-play"]')
          return (
            !!el && (el.textContent ?? '').includes(want) && el.hasAttribute('disabled') === off
          )
        },
        [label, disabled],
        { timeout: TIMEOUT_MS },
      )
      .catch(async () => {
        throw new Error(
          `expected the action bar button to read "${label}" (disabled=${disabled}), got ` +
            JSON.stringify({
              text: await bar.textContent(),
              disabled: await bar.isDisabled(),
            }),
        )
      })
  }

  step('no server selected: Join is disabled')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await page
    .getByTestId(`servers-row-${serverB.address}`)
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectBar('Join', true)
  await shot('actionbar-join-disabled')

  const { logPath } = await invoke(page, 'app:getInfo')

  step('Join from the action bar connects to the selected server')
  await page.getByTestId(`servers-row-${serverB.address}`).click({ timeout: TIMEOUT_MS })
  await expectBar('Join', false)
  await shot('actionbar-join-enabled')
  await bar.click({ timeout: TIMEOUT_MS })
  const logAfterB = await waitForLogContains(
    logPath,
    `+connect ${serverB.address}`,
    LOG_POLL_TIMEOUT_MS,
  )
  const launchLineB = lastLaunchingLine(logAfterB)
  if (!launchLineB || !launchLineB.includes(`+connect ${serverB.address}`)) {
    throw new Error(
      `expected the newest "launching" line to contain "+connect ${serverB.address}", got ${JSON.stringify(launchLineB)}`,
    )
  }
  // The stand-in client exits within milliseconds; wait until the button is pressable again.
  await expectBar('Join', false)

  step('mismatch then password then join, password never logged')
  await page.getByTestId(`servers-row-${serverA.address}`).click({ timeout: TIMEOUT_MS })
  await expectBar('Join', false)
  await bar.click({ timeout: TIMEOUT_MS })
  const mismatchDialog = page.getByTestId('servers-join-mismatch')
  await mismatchDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('servers-join-mismatch-confirm').click({ timeout: TIMEOUT_MS })
  const passwordDialog = page.getByTestId('servers-join-password')
  await passwordDialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await passwordDialog.locator('input[type="password"]').fill('hunter2 x')
  await page.getByTestId('servers-join-password-submit').click({ timeout: TIMEOUT_MS })

  const expectedTail = `+exec ${CONNECT_CFG_NAME} +connect ${serverA.address}`
  const logAfterA = await waitForLogContains(logPath, expectedTail, LOG_POLL_TIMEOUT_MS)
  const launchLineA = lastLaunchingLine(logAfterA)
  if (!launchLineA || !launchLineA.trimEnd().endsWith(expectedTail)) {
    throw new Error(
      `expected the newest "launching" line to end with ${JSON.stringify(expectedTail)}, got ${JSON.stringify(launchLineA)}`,
    )
  }
  if (readLog(logPath).includes('hunter2')) {
    throw new Error('main.log contains the literal join password "hunter2"')
  }
  await shot('actionbar-join-password')

  step('leaving Servers turns the button back into Play')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await expectBar('Play', false)
  await shot('actionbar-play-again')
}
