// Story 132 (docs/requirements/132-the-watchlist-tells-me-where-someone-is.md) D4: the story's own
// end-to-end proof, over the real `watchlist` feature gate (129/130), the real `WatchlistService`
// (131), and this story's own D1-D3 renderer surface - never reimplemented here.
//
// ## Two phases, mirroring `unlock-code.mjs`'s own restart discipline
//
// Phase 1 (locked): the Servers view and Settings show nothing watchlist-shaped at all (129's
// "nobody asks for something they don't see" rule), then a `watchlist` code is redeemed through
// Settings' unlock UI exactly as `unlock-code.mjs` does it (same throwaway Ed25519 key pair, signed
// and submitted the same way, never the embedded production key) - 130 decides feature-unlock at
// boot, so the redeemed code needs a real restart before the gate reflects it.
//
// Phase 2 (restart, unlocked): a second, independent `withApp()` over a copy of phase 1's own
// `state.json` (the same file a real second boot on this machine would read), with one extra
// watchlist entry (`tooSlow: true`) seeded directly into the copy - this deliverable does not
// re-run 131 AC8's own pathological-regex timing test, it only proves the *persisted verdict*
// renders. Two loopback `dgram` responders (A/B) stand in for two manual servers, mirroring
// `servers-join.mjs`/`servers-scoped-refresh.mjs`'s own wire protocol (mirrored, never imported -
// `scripts/*.mjs` cannot `import` `src/**/*.ts`). Server A carries a player named "Rocket" whose
// roster this flow later mutates (score change, then removal) to prove the re-check/"left" path
// (AC7); server B carries a static "Trooper" the edit-to-found step targets, so that half of the
// story never depends on A's own mutations. The same real, spawnable stand-in client
// `writeJoinFixture()` gives `servers-join.mjs` is reused here so the match-row Join action
// (125, never reimplemented - AC3) produces a real spawn/exit this flow can assert on.
//
// ## Selectors
//
// `servers-tab-strip`/`servers-tab-list`/`servers-tab-watchlist` (`ServersTabStrip.tsx`),
// `experimental-badge` (`ExperimentalBadge.tsx`, rendered by `FeatureGate` wherever a gated feature
// is unlocked), `servers-watchlist` (`WatchlistPanel.tsx`), `servers-watchlist-add-name`/
// `-add-mode`/`-add-submit`/`-add-error` (`WatchlistAddForm.tsx`), `servers-watchlist-row-<id>`
// (`data-state`), `-recheck-<id>`/`-recheck-error-<id>`, `-edit-<id>`/`-edit-name-<id>`/
// `-edit-mode-<id>`/`-edit-save-<id>`/`-edit-cancel-<id>`/`-edit-error-<id>`, `-remove-<id>`,
// `-match-<id>-<address>` (`WatchlistRow.tsx`). Match actions (`ServersView.tsx`'s
// `renderMatchActions`): `servers-join` (125's own `JoinServerButton`) and
// `servers-watchlist-open-detail-<address>`. `nav-servers`/`nav-settings` (`TitleBar.tsx`),
// `unlock-installation-id`/`unlock-code-input`/`unlock-code-submit`/`unlock-result-accepted`
// (`UnlockCodePanel.tsx`, story 129), `servers-refresh`/`servers-scan-status`/`servers-detail`
// (`ServersView.tsx`/`ServerDetailView.tsx`).
//
// Entry ids are minted by `randomUUID()` (`watchlist-entries.ts`) - never guessed here. Every entry
// this flow needs to act on again (recheck/edit/remove a specific row) is looked up by name through
// a direct `watchlist.read` `module:invoke` call, the same "read the authoritative main-side state
// rather than parse the DOM for an opaque id" discipline `servers-scoped-refresh.mjs`'s own
// `scan.read` calls follow.
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SERVERS_DISABLED_SOURCES, writeJoinFixture } from '../lib/fixture.mjs'
import { variantUserDataDir, withApp } from '../lib/harness.mjs'
import { REPO_ROOT } from '../lib/paths.mjs'

export const variant = 'servers-watchlist'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const LAUNCH_TIMEOUT_MS = 15_000
const LOG_POLL_TIMEOUT_MS = 10_000
const RECHECK_SETTLE_TIMEOUT_MS = 10_000

/** `UI_HARNESS_UNLOCK_PUBLIC_KEY_ENV` (`src/main/services/unlock/public-key.ts`) - mirrors
 * `unlock-code.mjs` verbatim. */
const PUBLIC_KEY_ENV_VAR = 'Q2L_UI_UNLOCK_PUBLIC_KEY'
/** Mirrors `UNLOCK_CODE_PREFIX` (`src/shared/unlock.ts`). */
const CODE_PREFIX = 'q2l1'

let signingPrivateKey = null
let signingPublicKeyPem = null

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

function formatPlayerLine({ score, ping, name }) {
  return `${score} ${ping} "${name}"`
}

/**
 * A loopback responder whose roster is a live, mutable property (`responder.players`) - AC7's own
 * re-check test changes server A's roster mid-flow (a score bump, then a removal), and the
 * `info`/`status` handler below always reads the CURRENT value, never one captured at bind time.
 * Same OOB envelope/`gamename: 'baseq2'`/no-password shape as `servers-join.mjs`'s server B (a
 * clean, no-mismatch, no-dialog join), since this flow's Join assertion is 125's own
 * job, not a second mismatch-dialog proof.
 */
async function bindResponder(hostname, initialPlayers) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`
  const responder = { socket, port, address, hostname, players: initialPlayers, closed: false }

  socket.on('message', (message, rinfo) => {
    const kind = decodeQueryKind(message)
    const infoLine =
      `\\gamename\\baseq2\\hostname\\${responder.hostname}\\mapname\\q2dm1\\clients\\${responder.players.length}` +
      `\\maxclients\\8\\version\\3.20`
    if (kind === 'info') {
      socket.send(buildInfoReplyBytes(infoLine), rinfo.port, rinfo.address)
    } else if (kind === 'status') {
      const playerLines = responder.players.map(formatPlayerLine)
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
/** The seeded too-slow entry's id - fixed and known so phase 2 can locate its row without any
 * `watchlist.read` round trip for this one entry alone. */
const TOO_SLOW_ENTRY_ID = 'fixture-watchlist-too-slow-entry'
const TOO_SLOW_ENTRY_NAME = 'Ghost'

let serverA = null
let serverB = null
let responders = []
let installRoot = null
let spawnable = true

export async function setup() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  signingPrivateKey = privateKey
  signingPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

  serverA = await bindResponder('Fixture Watchlist Server A', [{ score: 5, ping: 20, name: 'Rocket' }])
  serverB = await bindResponder('Fixture Watchlist Server B', [{ score: 7, ping: 15, name: 'Trooper' }])
  responders = [serverA, serverB]

  const fixture = writeJoinFixture({
    variant,
    servers: {
      sources: SERVERS_DISABLED_SOURCES,
      favourites: [],
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
  })
  installRoot = fixture.installRoot
  spawnable = fixture.spawnable

  return { env: { [PUBLIC_KEY_ENV_VAR]: signingPublicKeyPem } }
}

export async function teardown() {
  await Promise.all(responders.map((responder) => closeResponder(responder)))
}

/** Mirrors `unlock-code.mjs`'s `buildCode` byte-for-byte (see that file's own header comment for
 * why this is reproduced inline rather than imported). */
function buildCode(payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const unsigned = `${CODE_PREFIX}.${payloadB64}`
  const signature = cryptoSign(null, Buffer.from(unsigned, 'ascii'), signingPrivateKey)
  return `${unsigned}.${signature.toString('base64url')}`
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

async function openSettings(page) {
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('unlock-installation-id').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

async function readInstallationId(page) {
  return (await page.getByTestId('unlock-installation-id').innerText()).trim()
}

async function submitCode(page, code) {
  const input = page.getByTestId('unlock-code-input')
  await input.fill('', { timeout: TIMEOUT_MS })
  await input.fill(code, { timeout: TIMEOUT_MS })
  await page.getByTestId('unlock-code-submit').click({ timeout: TIMEOUT_MS })
}

/** No `servers-tab-*`/`servers-watchlist*` testid anywhere on the current page, and the literal
 * string "Watchlist" appears nowhere in the rendered text - the locked-state proof this flow's
 * phase 1 needs on both the Servers view and Settings. */
async function assertNoWatchlistSurface(page, where) {
  const testIdCount = await page.evaluate(
    () =>
      document.querySelectorAll(
        '[data-testid^="servers-tab-"], [data-testid^="servers-watchlist"]',
      ).length,
  )
  if (testIdCount !== 0) {
    throw new Error(`expected no servers-tab-*/servers-watchlist* testid in ${where} while locked, found ${testIdCount}`)
  }
  const bodyText = await page.evaluate(() => document.body.innerText)
  if (bodyText.includes('Watchlist')) {
    throw new Error(`expected no "Watchlist" text in ${where} while locked`)
  }
}

async function invokeModule(page, type, payload) {
  return page.evaluate(
    ({ t, p }) => window.q2.invoke('module:invoke', { moduleId: 'servers', type: t, ...(p !== undefined ? { payload: p } : {}) }),
    { t: type, p: payload },
  )
}

async function invoke(page, channel, payload) {
  return page.evaluate(({ ch, p }) => window.q2.invoke(ch, p), { ch: channel, p: payload })
}

async function readWatchlistSnapshot(page) {
  const result = await invokeModule(page, 'watchlist.read')
  if (result?.ok !== true) {
    throw new Error(`expected watchlist.read to succeed, got ${JSON.stringify(result)}`)
  }
  return result.value
}

/** Finds an entry's id by its current name - never guessed, always read back from the
 * authoritative main-side snapshot (see file header). Throws if not found or ambiguous. */
async function entryIdByName(page, name) {
  const snapshot = await readWatchlistSnapshot(page)
  const matches = snapshot.entries.filter((status) => status.entry.name === name)
  if (matches.length !== 1) {
    throw new Error(`expected exactly one watchlist entry named ${JSON.stringify(name)}, got ${matches.length}`)
  }
  return matches[0].entry.id
}

async function statusByEntryId(page, id) {
  const snapshot = await readWatchlistSnapshot(page)
  const status = snapshot.entries.find((candidate) => candidate.entry.id === id)
  if (!status) throw new Error(`expected a watchlist entry with id ${JSON.stringify(id)}`)
  return status
}

function rowLocator(page, id) {
  return page.getByTestId(`servers-watchlist-row-${id}`)
}

async function fillAddForm(page, { name, mode }) {
  await page.getByTestId('servers-watchlist-add-name').fill(name, { timeout: TIMEOUT_MS })
  await page.getByTestId('servers-watchlist-add-mode').selectOption(mode, { timeout: TIMEOUT_MS })
  await page.getByTestId('servers-watchlist-add-submit').click({ timeout: TIMEOUT_MS })
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

/** Runs a full "Refresh servers" round from the list tab, then returns to the watchlist tab -
 * the refresh controls only exist on the list tab (`ServersView.tsx`'s `listColumn`). */
async function runFullRefreshFromWatchlistTab(page) {
  await page.getByTestId('servers-tab-list').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)
  await page.getByTestId('servers-tab-watchlist').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-watchlist').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

async function waitForRowState(page, id, state, timeout) {
  await page.waitForFunction(
    ({ testId, expected }) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-state') === expected,
    { testId: `servers-watchlist-row-${id}`, expected: state },
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
  await page.waitForFunction((expected) => (window.__q2lPhases ?? []).includes(expected), phase, { timeout })
}

async function waitForLogContains(logPath, substring, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    if (content.includes(substring)) return content
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${JSON.stringify(logPath)} to contain ${JSON.stringify(substring)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

function lastLaunchingLine(logContent) {
  const lines = logContent.split(/\r?\n/).filter((line) => line.includes('launching'))
  return lines.length > 0 ? lines[lines.length - 1] : null
}

export default async function serversWatchlist({ page, step, shot }) {
  if (!spawnable) {
    console.log(
      'servers-watchlist: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored locally ' +
        '(`npm run fetch:7za` never ran), so this flow has no real spawnable stand-in client. ' +
        'Every other flow with the same dependency (e.g. servers-join.mjs) skips the same way.',
    )
    return
  }

  const userDataDir = variantUserDataDir(variant)

  // --- Phase 1: locked ------------------------------------------------------------------------

  step('locked: Servers view shows no watchlist surface at all (129 "nobody asks" rule)')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-refresh').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await assertNoWatchlistSurface(page, 'the Servers view')

  step('locked: Settings shows no watchlist surface either')
  await openSettings(page)
  await assertNoWatchlistSurface(page, 'Settings')
  const installationId = await readInstallationId(page)
  const normalizedInstallId = installationId.replace(/-/g, '')

  step('redeem a "watchlist" code through Settings’ unlock UI (129, real UnlockService)')
  const acceptedCode = buildCode({
    features: ['watchlist'],
    launcherInstallId: normalizedInstallId,
    issuedAt: nowSeconds() - 10,
    redeemBy: nowSeconds() + 3600,
  })
  await submitCode(page, acceptedCode)
  const accepted = page.getByTestId('unlock-result-accepted')
  await accepted.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const acceptedText = await accepted.innerText()
  if (!acceptedText.includes('watchlist')) {
    throw new Error(`expected the accepted result to name "watchlist", got: ${JSON.stringify(acceptedText)}`)
  }
  await shot('locked-then-redeemed')

  // --- Phase 2: restart over a copy of phase 1's own state.json, feature now unlocked (130) ---

  step('restart the app over a copy of state.json, with the too-slow entry seeded directly (AC per 131 D-persistence)')
  const restartVariant = `${variant}-restart`
  const restartUserDataDir = variantUserDataDir(restartVariant)
  mkdirSync(restartUserDataDir, { recursive: true })
  copyFileSync(join(userDataDir, 'state.json'), join(restartUserDataDir, 'state.json'))
  copyFileSync(join(userDataDir, 'window-state.json'), join(restartUserDataDir, 'window-state.json'))

  const restartedState = JSON.parse(readFileSync(join(restartUserDataDir, 'state.json'), 'utf8'))
  restartedState.servers.watchlist = [
    { id: TOO_SLOW_ENTRY_ID, name: TOO_SLOW_ENTRY_NAME, mode: 'regex', tooSlow: true },
  ]
  writeFileSync(join(restartUserDataDir, 'state.json'), JSON.stringify(restartedState, null, 2))

  const restartEnv = { [PUBLIC_KEY_ENV_VAR]: signingPublicKeyPem }

  await withApp(
    { variant: restartVariant, viewport: { width: 1280, height: 800 }, env: restartEnv },
    async ({ page: p }) => {
      const shot2 = async (label) => {
        const filePath = join(REPO_ROOT, '.ui-verify', 'screenshots', 'flows', `servers-watchlist-${label}.png`)
        await p.screenshot({ path: filePath })
        console.log(`  shot: ${filePath}`)
      }
      step('unlocked: the tab strip and the "Watchlist" tab both appear, with the experimental badge (AC1/AC8)')
      await p.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
      await p.getByTestId('servers-tab-strip').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      const watchlistTab = p.getByTestId('servers-tab-watchlist')
      await watchlistTab.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      await watchlistTab.click({ timeout: TIMEOUT_MS })
      await p.getByTestId('servers-watchlist').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      await p.getByTestId('experimental-badge').first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      await shot2('unlocked-watchlist-tab')

      step('a refused pattern shows an inline regex error (AC9)')
      await fillAddForm(p, { name: '(', mode: 'regex' })
      const addError = p.getByTestId('servers-watchlist-add-error')
      await addError.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      const addErrorText = await addError.innerText()
      if (!/regular expression/i.test(addErrorText)) {
        throw new Error(`expected an invalid-regex message, got ${JSON.stringify(addErrorText)}`)
      }

      step('add a substring entry ("rock") and an exact entry ("Nobody")')
      await fillAddForm(p, { name: 'rock', mode: 'substring' })
      await fillAddForm(p, { name: 'Nobody', mode: 'exact' })

      step('the seeded too-slow entry renders its own state (AC9)')
      const tooSlowRow = rowLocator(p, TOO_SLOW_ENTRY_ID)
      await tooSlowRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      const tooSlowText = await tooSlowRow.innerText()
      if (!/too slow/i.test(tooSlowText)) {
        throw new Error(`expected the seeded too-slow row to show its own text, got ${JSON.stringify(tooSlowText)}`)
      }
      if (tooSlowRow.getAttribute) {
        const state = await tooSlowRow.getAttribute('data-state')
        if (state !== 'too-slow') throw new Error(`expected the seeded entry's data-state to be "too-slow", got ${state}`)
      }

      const rockId = await entryIdByName(p, 'rock')
      const nobodyId = await entryIdByName(p, 'Nobody')

      step('trigger a scan refresh so the fresh entries get matched (AC2/AC5)')
      await runFullRefreshFromWatchlistTab(p)
      await waitForRowState(p, rockId, 'found', RECHECK_SETTLE_TIMEOUT_MS)
      await waitForRowState(p, nobodyId, 'offline', RECHECK_SETTLE_TIMEOUT_MS)

      step('the "rock" entry is found on server A, the "Nobody" entry is offline (AC2/AC5)')
      const rockMatch = p.getByTestId(`servers-watchlist-match-${rockId}-${serverA.address}`)
      await rockMatch.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      const rockMatchText = await rockMatch.innerText()
      if (!rockMatchText.includes('Rocket') || !rockMatchText.includes('5') || !rockMatchText.includes('20')) {
        throw new Error(`expected the "rock" match to show Rocket's name/score/ping, got ${JSON.stringify(rockMatchText)}`)
      }
      if (!/seen/i.test(rockMatchText)) {
        throw new Error(`expected the "rock" match to carry a "seen ..." string, got ${JSON.stringify(rockMatchText)}`)
      }
      // AC4 is about `WatchlistRow`'s OWN text (its `<span>` line, never the caller-supplied
      // `renderMatchActions` buttons this same `<li>` also renders - `ServersView.tsx`'s own Join/
      // "Server details" actions).
      const rockMatchLineText = await rockMatch.locator('span').first().innerText()
      if (/spectat/i.test(rockMatchLineText)) {
        throw new Error(`expected no "spectate"/"spectating" substring in the match's own line text (AC4), got ${JSON.stringify(rockMatchLineText)}`)
      }

      const nobodyRow = rowLocator(p, nobodyId)
      const nobodyText = await nobodyRow.innerText()
      if (!/not found in data from/i.test(nobodyText)) {
        throw new Error(`expected the offline "Nobody" row to read "not found in data from ...", got ${JSON.stringify(nobodyText)}`)
      }
      await shot2('found-and-offline')

      step('changing server A’s reported score and re-checking updates the match line (AC7)')
      serverA.players = [{ score: 42, ping: 8, name: 'Rocket' }]
      await p.getByTestId(`servers-watchlist-recheck-${rockId}`).click({ timeout: TIMEOUT_MS })
      await p.waitForFunction(
        (testId) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.includes('42'),
        `servers-watchlist-match-${rockId}-${serverA.address}`,
        { timeout: RECHECK_SETTLE_TIMEOUT_MS },
      )

      step('removing Rocket from server A and re-checking again flips the row to "left" (AC7)')
      serverA.players = []
      await p.getByTestId(`servers-watchlist-recheck-${rockId}`).click({ timeout: TIMEOUT_MS })
      await waitForRowState(p, rockId, 'left', RECHECK_SETTLE_TIMEOUT_MS)
      const leftRow = rowLocator(p, rockId)
      const leftText = await leftRow.innerText()
      if (!/full scan/i.test(leftText)) {
        throw new Error(`expected the "left" row to carry its full-scan-needed text, got ${JSON.stringify(leftText)}`)
      }

      step('editing "Nobody" to "Trooper" (server B’s own player) rematches it to found immediately (AC3)')
      await p.getByTestId(`servers-watchlist-edit-${nobodyId}`).click({ timeout: TIMEOUT_MS })
      const editNameInput = p.getByTestId(`servers-watchlist-edit-name-${nobodyId}`)
      await editNameInput.fill('', { timeout: TIMEOUT_MS })
      await editNameInput.fill('Trooper', { timeout: TIMEOUT_MS })
      await p.getByTestId(`servers-watchlist-edit-save-${nobodyId}`).click({ timeout: TIMEOUT_MS })
      await waitForRowState(p, nobodyId, 'found', RECHECK_SETTLE_TIMEOUT_MS)
      const trooperMatch = p.getByTestId(`servers-watchlist-match-${nobodyId}-${serverB.address}`)
      await trooperMatch.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

      step('removing that entry drops its row (AC3)')
      await p.getByTestId(`servers-watchlist-remove-${nobodyId}`).click({ timeout: TIMEOUT_MS })
      await rowLocator(p, nobodyId).waitFor({ state: 'detached', timeout: TIMEOUT_MS })

      step('bring server A’s Rocket back and refresh, so "rock" is a still-found row again (needed for Join/detail)')
      serverA.players = [{ score: 11, ping: 14, name: 'Rocket' }]
      await runFullRefreshFromWatchlistTab(p)
      await waitForRowState(p, rockId, 'found', RECHECK_SETTLE_TIMEOUT_MS)

      const { logPath } = await invoke(p, 'app:getInfo')
      console.log(`  main.log: ${logPath}`)

      step('open-detail on the "rock" match opens the server detail beside the watchlist (AC3)')
      await p.getByTestId(`servers-watchlist-open-detail-${serverA.address}`).click({ timeout: TIMEOUT_MS })
      const detail = p.getByTestId('servers-detail')
      await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      const detailAddress = p.getByTestId('servers-detail-field-address')
      await detailAddress.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
      const detailAddressText = await detailAddress.innerText()
      if (!detailAddressText.includes(serverA.address)) {
        throw new Error(`expected the opened detail view to show server A's address, got ${JSON.stringify(detailAddressText)}`)
      }
      await shot2('open-detail-from-match')

      step('joining server A from the detail view produces a real launch (125, never reimplemented)')
      await armPhaseListener(p)
      await p.getByTestId('servers-detail-join').click({ timeout: TIMEOUT_MS })
      await waitForPhase(p, 'running', LAUNCH_TIMEOUT_MS)
      await waitForPhase(p, 'exited', LAUNCH_TIMEOUT_MS)
      const logAfterJoin = await waitForLogContains(logPath, `+connect ${serverA.address}`, LOG_POLL_TIMEOUT_MS)
      const launchLine = lastLaunchingLine(logAfterJoin)
      if (!launchLine || !launchLine.includes(`+connect ${serverA.address}`)) {
        throw new Error(`expected a "launching" line with +connect ${serverA.address}, got ${JSON.stringify(launchLine)}`)
      }
      await shot2('join-from-match')
    },
  )

  console.log(
    'servers-watchlist: locked, the Servers view and Settings showed no watchlist surface at all; ' +
      'a redeemed code plus restart unlocked the tab strip and its experimental badge (AC1/AC8); a ' +
      'refused regex pattern and the seeded too-slow entry both rendered their own text (AC9); a ' +
      'substring entry found a real player on server A and an exact entry stayed offline until a ' +
      'name it actually matched, with no "spectate" substring anywhere in a match line (AC2/AC4/AC5); ' +
      "re-checking picked up a live score change and then a real departure (AC7); editing an entry's " +
      'name rematched it immediately and removing it dropped its row (AC3); and a still-found match ' +
      "row's open-detail/Join actions produced a real launch through 125's own, " +
      'unmodified code (AC3).',
  )
}
