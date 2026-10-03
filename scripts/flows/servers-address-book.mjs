// Story 127 (docs/requirements/127-a-server-goes-into-my-address-book.md) D2: the story's own e2e
// proof that "Add to address book" is really wired into both the servers list toolbar and the
// detail pane, writes a real `adr<n>` cvar onto a real config profile, and that write lands
// on disk right away (story 175) without dirtying the profile - not just that the dialog renders.
//
// ## Wire protocol - mirrored, not imported
//
// `scripts/*.mjs` never imports `src/` TypeScript (`scripts/lib/fixture.mjs`'s own header comment)
// - the reply builders and responder helpers come from `scripts/lib/servers-stub.mjs`, which
// mirrors `src/main/modules/servers/scan-integration.test.ts`.
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
// (the list toolbar's `servers-address-book-open` trigger is gone - the detail pane is the one entry point),
// `servers-detail-address-book-open` (the detail pane's trigger, same D), `servers-address-book-
// profile`/`servers-address-book-slot-<n>`/`servers-address-book-confirm` (`AddToAddressBookDialog.
// tsx`, D1), `config-profile-row` (ConfigView.tsx, filtered by profile name, mirrors `unsaved-
// diff.mjs`'s `openConfig()`), `config-unsaved-indicator` (`UnsavedIndicator.tsx`), `config-tab-
// unsaved`/`config-save-changes` (ConfigView.tsx/`ProfileChangeList.tsx`).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import {
  INSTALL_ONE_ID,
  SERVERS_DISABLED_SOURCES,
  installationConfigFilePath,
  writePopulatedFixture,
} from '../lib/fixture.mjs'
import { makeResponderBinder, closeResponder } from '../lib/servers-stub.mjs'
import { readFinishedAt, waitForFinishedAtChange } from '../lib/servers-flow.mjs'

export const variant = 'servers-address-book'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const RAW_TAB_LOAD_TIMEOUT_MS = 20_000
const EDITED_SENSITIVITY = '7.25'

/** One loopback responder answering both `info` and `status` queries - mirrors
 * `servers-scoped-refresh.mjs`'s `bindResponder`, minus the per-kind packet log this flow never
 * needs (it never asserts on who got queried, only on what the address-book dialog does). */
const bindResponder = makeResponderBinder((hostname, playerLines) => ({
  infoLine:
    `\\gamename\\baseq2\\hostname\\${hostname}\\mapname\\q2dm1\\clients\\${playerLines.length}` +
    `\\maxclients\\8\\version\\3.20`,
  playerLines,
}))

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

/** Opens the config module and clicks the profile row whose name matches `name` - mirrors
 * `unsaved-diff.mjs`'s own `openConfig()`, parameterised on the profile name since this flow visits
 * two different profiles. */
async function openConfig(page, name) {
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  // The config view keeps whichever profile was last open - return to the list first.
  const backToProfiles = page.getByRole('button', { name: 'Back to profiles' })
  if (await backToProfiles.isVisible()) await backToProfiles.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-profile-row').filter({ hasText: name }).first().click({
    timeout: TIMEOUT_MS,
  })
}

export default async function serversAddressBook({ page, step, shot }) {
  step(
    'navigate to Servers, run a refresh, select the fixture row and open the address-book dialog',
  )
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const finishedAtBefore = await readFinishedAt(page)
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await waitForFinishedAtChange(page, finishedAtBefore, SCAN_SETTLE_TIMEOUT_MS)

  await page.getByTestId(`servers-row-${server.address}`).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-detail-address-book-open').click({ timeout: TIMEOUT_MS })

  const profileField = page.getByTestId('servers-address-book-profile')
  await profileField.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const profileSelect = profileField.locator('select')
  const preselectedLabel = await profileSelect
    .locator('option', { hasText: 'Plain Profile' })
    .evaluate((option) => option.selected)
  if (!preselectedLabel) {
    throw new Error(
      'expected "Plain Profile" to be preselected - it is the active installation\'s own profile',
    )
  }

  for (let index = 0; index < 9; index++) {
    const slotRow = page.getByTestId(`servers-address-book-slot-${index}`)
    await slotRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const text = (await slotRow.innerText()).trim()
    if (!text.includes('Empty')) {
      throw new Error(
        `expected slot ${index} to show the empty placeholder before any write, got ${JSON.stringify(text)}`,
      )
    }
  }
  await shot('address-book-dialog-plain-profile-empty')

  step('write the server\'s address into slot 0 on "Plain Profile"')
  await page.getByTestId('servers-address-book-slot-0').locator('input[type="radio"]').check({
    timeout: TIMEOUT_MS,
  })
  await page.getByTestId('servers-address-book-confirm').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-address-book-profile')
    .waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step('reopening from the detail pane shows slot 0 now holding the address')
  await page.getByTestId('servers-detail-address-book-open').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-address-book-profile')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const slot0AfterWrite = (await page.getByTestId('servers-address-book-slot-0').innerText()).trim()
  if (!slot0AfterWrite.includes(server.address)) {
    throw new Error(
      `expected slot 0 to show the written address ${server.address}, got ${JSON.stringify(slot0AfterWrite)}`,
    )
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

  step('Cancel the dialog; "Plain Profile" is clean and the address is already on disk (story 175)')
  await page.getByRole('button', { name: 'Cancel' }).click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-address-book-profile')
    .waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  await openConfig(page, 'Plain Profile')
  await page.getByTestId('config-tab-raw').click({ timeout: TIMEOUT_MS })
  await page
    .locator('.cfg-code-textarea, .cfg-code')
    .first()
    .waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })
  await page
    .getByText('On disk', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })
  if ((await page.getByTestId('config-unsaved-indicator').count()) !== 0) {
    throw new Error(
      'expected "Plain Profile" to show no unsaved indicator after the address-book write',
    )
  }
  if ((await page.getByText(/unsaved changes? (is|are) not in this file yet/).count()) !== 0) {
    throw new Error(
      'expected the Raw file tab to show no unsaved notice after the address-book write',
    )
  }
  await shot('plain-profile-clean-on-disk')

  const canonicalPath = join(variantUserDataDir(variant), 'Plain-Profile.cfg')
  const adrLine = new RegExp(`set adr0 "?${server.address.replace(/[.:]/g, '\\$&')}`)
  const canonical = readFileSync(canonicalPath, 'latin1')
  if (!adrLine.test(canonical)) {
    throw new Error(
      `expected ${canonicalPath} to contain "set adr0 ${server.address}", got ${JSON.stringify(canonical.slice(-300))}`,
    )
  }
  const copyPath = installationConfigFilePath(INSTALL_ONE_ID, 'Plain-Profile.cfg')
  const copy = readFileSync(copyPath, 'latin1')
  if (!adrLine.test(copy)) {
    throw new Error(
      `expected the installation copy ${copyPath} to contain "set adr0 ${server.address}", got ${JSON.stringify(copy.slice(-300))}`,
    )
  }

  step('leave an unsaved Settings edit on "Layered Profile"')
  await openConfig(page, 'Layered Profile')
  await page.getByTestId('config-tab-settings').click({ timeout: TIMEOUT_MS })
  const sensitivityRow = page
    .locator('div.border-l-2', { hasText: 'sensitivity' })
    .filter({ has: page.locator('input:not([type="range"])') })
    .first()
  await sensitivityRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await sensitivityRow.locator('input:not([type="range"])').first().fill(EDITED_SENSITIVITY)
  await sensitivityRow.getByRole('img', { name: 'Unsaved change' }).waitFor({ timeout: TIMEOUT_MS })

  step('add the server to "Layered Profile"\'s adr0 from the servers list')
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  await page.getByTestId(`servers-row-${server.address}`).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-detail-address-book-open').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-address-book-profile')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-address-book-profile')
    .locator('select')
    .selectOption({ label: 'Layered Profile' })
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="servers-address-book-slot-0"]')
      return el !== null && !(el.textContent ?? '').includes('Loading')
    },
    null,
    { timeout: TIMEOUT_MS },
  )
  await page
    .getByTestId('servers-address-book-slot-0')
    .locator('input[type="radio"]')
    .check({ timeout: TIMEOUT_MS })
  await page.getByTestId('servers-address-book-confirm').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('servers-address-book-profile')
    .waitFor({ state: 'hidden', timeout: TIMEOUT_MS })

  step(
    '"Layered Profile" stays unsaved for the Settings edit only; adr0 is on disk, the edit is not',
  )
  await openConfig(page, 'Layered Profile')
  await page
    .getByTestId('config-unsaved-indicator')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('config-tab-unsaved').click({ timeout: TIMEOUT_MS })
  const changeList = page.getByTestId('config-save-changes')
  await changeList.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const changeListText = await changeList.innerText()
  if (!changeListText.includes('sensitivity')) {
    throw new Error(
      `expected the Unsaved tab to list the sensitivity edit, got ${JSON.stringify(changeListText)}`,
    )
  }
  if (changeListText.includes('adr0')) {
    throw new Error(
      `expected the Unsaved tab not to list adr0, got ${JSON.stringify(changeListText)}`,
    )
  }
  await shot('layered-profile-unsaved-excludes-adr0')

  const layeredPath = join(variantUserDataDir(variant), 'Layered-Profile.cfg')
  const layered = readFileSync(layeredPath, 'latin1')
  if (!adrLine.test(layered)) {
    throw new Error(
      `expected ${layeredPath} to contain "set adr0 ${server.address}", got ${JSON.stringify(layered.slice(-300))}`,
    )
  }
  if (
    new RegExp(
      String.raw`sensitivity\s+"?${EDITED_SENSITIVITY.replace(/\./g, '\\.')}"?\s*$`,
      'm',
    ).test(layered)
  ) {
    throw new Error(
      `expected ${layeredPath} not to hold the unsaved sensitivity edit ${EDITED_SENSITIVITY}`,
    )
  }

  console.log(
    'servers-address-book: "Add to address book" preselects "Plain Profile" with nine empty slots and ' +
      'the write is visible on reopen; "Layered Profile" stayed untouched; the address is on disk right away ' +
      '(canonical file + installation copy) and leaves "Plain Profile" clean; a pending Settings edit on ' +
      '"Layered Profile" stays unsaved and off disk while adr0 lands on disk and never enters its Unsaved tab.',
  )
}
