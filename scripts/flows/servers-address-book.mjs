// Story 127 (docs/requirements/127-a-server-goes-into-my-address-book.md) D2: the story's own e2e
// proof that "Add to address book" is really wired into both the servers list toolbar and the
// detail pane, writes a real `adr<n>` cvar onto a real config profile, and that write shows up
// through the config module's own unsaved-diff machinery - not just that the dialog renders.
//
// ## Wire protocol - mirrored, not imported
//
// `scripts/*.mjs` never imports `src/` TypeScript (`scripts/lib/fixture.mjs`'s own header comment)
// - `encodeLatin1`/`buildInfoReplyBytes`/`buildStatusReplyBytes`/`decodeQueryKind` and
// `bindResponder`/`closeResponder` below are copied verbatim from `scripts/flows/
// servers-scoped-refresh.mjs`, which itself mirrors `src/main/modules/servers/
// scan-integration.test.ts`.
//
// ## Fixture: the populated fixture's real config profiles, one manual server
//
// Unlike most `servers-*` flows (which use `writeJoinFixture`, a minimal single-installation
// fixture), this flow needs `writePopulatedFixture` because D1's dialog preselects a config
// profile assigned to the active installation and lists every profile by name - this flow depends
// on the populated fixture's real "Plain Profile" (assigned to `INSTALL_ONE_ID`, so it is the
// dialog's preselection) and "Layered Profile" (a second, distinct profile never touched by this
// flow's write, used to prove a fresh profile's `adr0` slot stays empty). `INSTALL_ONE_ID` is
// already `populatedStateDocument`'s default `settings.activeInstallationId` - no override needed.
//
// `stateOverrides.servers` mirrors `writeServersListEmptyFixture`/`writeServersListErrorFixture`'s
// shape exactly: every shipped master source disabled (`SERVERS_DISABLED_SOURCES`, GB-A5 - never
// touch a real master/internet host), no favourites, one manual server (this flow's own loopback
// responder), empty history, both scan auto-behaviours off so every packet is attributable to this
// flow's own "Refresh servers" click.
//
// ## Selectors
//
// `nav-servers`/`nav-config` (TitleBar.tsx), `servers-refresh` (ServersView.tsx, `data-finished-at`/
// `data-running` on `servers-scan-status`), `servers-row-<address>` (click to select AND open the
// detail pane - `ServersView.tsx` renders `ServerDetailView` whenever a row is selected, confirmed
// by reading `servers-detail.mjs`'s own flow, so no separate "open detail" action exists),
// `servers-address-book-open` (the list toolbar's trigger, story 127 D2),
// `servers-detail-address-book-open` (the detail pane's trigger, same D), `servers-address-book-
// profile`/`servers-address-book-slot-<n>`/`servers-address-book-confirm` (`AddToAddressBookDialog.
// tsx`, D1), `config-profile-row` (ConfigView.tsx, filtered by profile name, mirrors `unsaved-
// diff.mjs`'s `openConfig()`), `config-unsaved-indicator` (`UnsavedIndicator.tsx`), `config-tab-
// unsaved`/`config-save-changes` (ConfigView.tsx/`ProfileChangeList.tsx`).
import { createSocket } from 'node:dgram'
import { SERVERS_DISABLED_SOURCES, writePopulatedFixture } from '../lib/fixture.mjs'

export const variant = 'servers-address-book'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000

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

/** One loopback responder answering both `info` and `status` queries - mirrors
 * `servers-scoped-refresh.mjs`'s `bindResponder`, minus the per-kind packet log this flow never
 * needs (it never asserts on who got queried, only on what the address-book dialog does). */
async function bindResponder(hostname, playerLines) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  const address = `127.0.0.1:${port}`
  const infoLine =
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
    `\\maxclients\\8\\version\\3.20`
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

export async function setup() {
  server = await bindResponder('Fixture Address Book Server', ['5 20 "Alpha1"'])

  writePopulatedFixture({
    variant,
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
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
    },
  })

  return {}
}

export async function teardown() {
  if (server) await closeResponder(server)
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

/** Opens the config module and clicks the profile row whose name matches `name` - mirrors
 * `unsaved-diff.mjs`'s own `openConfig()`, parameterised on the profile name since this flow visits
 * two different profiles. */
async function openConfig(page, name) {
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-profile-row').filter({ hasText: name }).first().click({
    timeout: TIMEOUT_MS,
  })
}

export default async function serversAddressBook({ page, step, shot }) {
  step('navigate to Servers, run a refresh, select the fixture row and open the address-book dialog')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)

  await page.getByTestId(`servers-row-${server.address}`).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-address-book-open').click({ timeout: TIMEOUT_MS })

  const profileField = page.getByTestId('servers-address-book-profile')
  await profileField.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const profileSelect = profileField.locator('select')
  const preselectedLabel = await profileSelect
    .locator('option', { hasText: 'Plain Profile' })
    .evaluate((option) => option.selected)
  if (!preselectedLabel) {
    throw new Error('expected "Plain Profile" to be preselected - it is the active installation\'s own profile')
  }

  for (let index = 0; index < 9; index++) {
    const slotRow = page.getByTestId(`servers-address-book-slot-${index}`)
    await slotRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const text = (await slotRow.innerText()).trim()
    if (!text.includes('Empty')) {
      throw new Error(`expected slot ${index} to show the empty placeholder before any write, got ${JSON.stringify(text)}`)
    }
  }
  await shot('address-book-dialog-plain-profile-empty')

  step('write the server\'s address into slot 0 on "Plain Profile"')
  await page.getByTestId('servers-address-book-slot-0').locator('input[type="radio"]').check({
    timeout: TIMEOUT_MS,
  })
  await page.getByTestId('servers-address-book-confirm').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-address-book-profile').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('reopening from the detail pane shows slot 0 now holding the address')
  await page.getByTestId('servers-detail-address-book-open').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-address-book-profile').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const slot0AfterWrite = (await page.getByTestId('servers-address-book-slot-0').innerText()).trim()
  if (!slot0AfterWrite.includes(server.address)) {
    throw new Error(`expected slot 0 to show the written address ${server.address}, got ${JSON.stringify(slot0AfterWrite)}`)
  }
  await shot('address-book-dialog-plain-profile-written')

  step('switching the dialog to "Layered Profile" shows a fresh, untouched slot 0')
  const profileSelectAgain = page.getByTestId('servers-address-book-profile').locator('select')
  await profileSelectAgain.selectOption({ label: 'Layered Profile' })
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="servers-address-book-slot-0"]')
      return el !== null && !(el.textContent ?? '').includes('Loading')
    },
    null,
    { timeout: TIMEOUT_MS },
  )
  const slot0Layered = (await page.getByTestId('servers-address-book-slot-0').innerText()).trim()
  if (!slot0Layered.includes('Empty')) {
    throw new Error(
      `expected "Layered Profile"'s slot 0 to be untouched by the write to "Plain Profile", got ${JSON.stringify(slot0Layered)}`,
    )
  }
  await shot('address-book-dialog-layered-profile-untouched')

  step('the write shows up in "Plain Profile"\'s own unsaved-diff surface')
  await page.getByRole('button', { name: 'Cancel' }).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-address-book-profile').waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  await openConfig(page, 'Plain Profile')
  await page.getByTestId('config-unsaved-indicator').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('config-tab-unsaved').click({ timeout: TIMEOUT_MS })
  const changeList = page.getByTestId('config-save-changes')
  await changeList.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const changeListText = await changeList.innerText()
  if (!changeListText.includes('adr0')) {
    throw new Error(`expected config-save-changes to list "adr0" among the changed cvars, got ${JSON.stringify(changeListText)}`)
  }
  await shot('plain-profile-unsaved-diff-adr0')

  console.log(
    'servers-address-book: "Add to address book" opened from both the list toolbar and the ' +
      'detail pane, preselected "Plain Profile" with all nine slots empty, writing to slot 0 was ' +
      'visible immediately from the detail pane\'s own trigger, "Layered Profile" stayed untouched, ' +
      'and the write shows up as an "adr0" row in "Plain Profile"\'s own Unsaved tab.',
  )
}
