// Story 191 D3 acceptance flow: removing a mod the launcher installed, from the Mods detail panel.
//
// One installation with two catalog-installed mods (`ctf`, the active game dir, and `opentdm`, whose
// opentdm.cfg was edited after install and which also holds a demo the launcher never wrote). Order:
// the game "runs" -> remove ctf (waits, files stay) -> idle (ctf folder gone, base-game note, picker
// without ctf) -> remove opentdm choosing to delete changed files too.
//
// Selectors - `ModDetailPanel.tsx`, `RemoveModDialog.tsx`: mods-tile-<dir>, mods-detail-remove,
// mods-detail-job-status, mods-remove-changed-list, mods-remove-changed-{keep,delete},
// mods-remove-confirm.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import {
  INSTALL_MODS_REMOVE_ID,
  INSTALL_MODS_REMOVE_NAME,
  installationRootFilePath,
  MODS_REMOVE_DEMO_PATH,
  modsCatalogFixtureEntries,
  modsRemoveFiles,
  startModsCatalogFixtureServer,
  writeModsRemoveFixture,
} from '../lib/fixture.mjs'
import { JOB_TIMEOUT_MS, openMods, simulateLaunch, TIMEOUT_MS } from '../lib/mods-install-flow.mjs'

export const variant = 'populated'

let server
export async function setup() {
  writeModsRemoveFixture()
  server = await startModsCatalogFixtureServer({ mode: 'ok' })
  return { env: { Q2L_UI_CONTENT_REPO_BASE: server.baseUrl } }
}
export async function teardown() {
  await server?.close()
}

const NAMES = Object.fromEntries(modsCatalogFixtureEntries().map((e) => [e.id, e.name]))
const path = (rel) => installationRootFilePath(INSTALL_MODS_REMOVE_ID, rel)
const failures = []
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` - ${detail}`}`)
  if (!ok) failures.push(label)
}

function records() {
  const state = JSON.parse(
    readFileSync(join(variantUserDataDir('populated'), 'state.json'), 'utf8'),
  )
  return (
    state.installations.find((i) => i.id === INSTALL_MODS_REMOVE_ID)?.moduleData?.mods?.records ??
    []
  )
}

async function openRemoveDialog(page, dir) {
  await page.getByTestId(`mods-tile-${dir}`).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('mods-detail-remove').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () => {
      const button = document.querySelector('[data-testid="mods-remove-confirm"]')
      return button && !button.disabled
    },
    null,
    { timeout: TIMEOUT_MS },
  )
}

async function waitUntil(fn, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

const appears = (locator) =>
  locator.waitFor({ state: 'visible', timeout: TIMEOUT_MS }).then(
    () => true,
    () => false,
  )

export default async function modsRemove({ page, shot, step }) {
  step('open Mods of the fixture installation')
  await openMods(page, INSTALL_MODS_REMOVE_NAME)
  await page.getByTestId('mods-tile-ctf').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('the game runs: remove ctf')
  await simulateLaunch(page, INSTALL_MODS_REMOVE_ID, 'running')
  await openRemoveDialog(page, 'ctf')
  await shot('remove-dialog-ctf')
  await page.getByTestId('mods-remove-confirm').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  const status = page.getByTestId('mods-detail-job-status')
  const waitingShown = await appears(status.filter({ hasText: /waiting for the game to close/i }))
  await new Promise((r) => setTimeout(r, 1_500))
  const stillThere = Object.keys(modsRemoveFiles.ctf).every((n) => existsSync(path(`ctf/${n}`)))
  check(
    'removal waits while the game runs and says so',
    waitingShown && stillThere,
    `waitingShown=${waitingShown} filesStillThere=${stillThere}`,
  )
  await shot('remove-waits')

  step('the game exits: ctf is removed')
  await simulateLaunch(page, INSTALL_MODS_REMOVE_ID, 'idle')
  const ctfGone = await waitUntil(() => !existsSync(path('ctf')), JOB_TIMEOUT_MS)
  check(
    'removing the active ctf shows the base-game note',
    await appears(page.getByText(/now starts the base game/i).first()),
  )
  await shot('after-ctf-removed')
  const ctfOffered = (
    await page
      .getByLabel('Launch with')
      .locator('option')
      .allInnerTexts()
      .catch(() => [])
  ).includes('ctf')

  step('remove opentdm, deleting changed files too')
  await openRemoveDialog(page, 'opentdm')
  const dialogText = await page.getByRole('dialog').innerText()
  const listText = await page.getByTestId('mods-remove-changed-list').innerText()
  check(
    'the remove confirmation names the installation and the mod and lists the changed file',
    dialogText.toLowerCase().includes(INSTALL_MODS_REMOVE_NAME.toLowerCase()) &&
      dialogText.toLowerCase().includes(NAMES.opentdm.toLowerCase()) &&
      listText.includes('opentdm.cfg'),
    dialogText,
  )
  if (!(await page.getByTestId('mods-remove-changed-keep').isChecked()))
    failures.push('keep is not the default')
  await shot('remove-dialog-opentdm')
  await page.getByTestId('mods-remove-changed-delete').check({ timeout: TIMEOUT_MS })
  await page.getByTestId('mods-remove-confirm').click({ timeout: TIMEOUT_MS })
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  const recordedGone = await waitUntil(
    () => Object.keys(modsRemoveFiles.opentdm).every((n) => !existsSync(path(`opentdm/${n}`))),
    JOB_TIMEOUT_MS,
  )
  check('after removal every recorded file is gone', recordedGone)
  check(
    'a demo under demos/ survives removal',
    existsSync(path(`opentdm/${MODS_REMOVE_DEMO_PATH}`)),
  )
  check(
    'the empty ctf folder is deleted and the opentdm folder with a demo is kept',
    ctfGone && existsSync(path('opentdm')) && !existsSync(path('opentdm/maps')),
  )

  step('the tile says not installed, the record is gone, the picker no longer offers ctf')
  const installShown = await appears(page.getByTestId('mods-install-opentdm'))
  const installedStatus = await page.getByTestId('mods-tile-status-opentdm').count()
  const manualOrigin = await page.getByTestId('mods-tile-origin-manual').count()
  const pickerNow = await page
    .getByLabel('Launch with')
    .locator('option')
    .allInnerTexts()
    .catch(() => [])
  await shot('after-opentdm-removed')
  check(
    'after removal the record is gone, the tile says not installed and the picker no longer offers ctf',
    records().length === 0 &&
      installShown &&
      installedStatus === 0 &&
      manualOrigin === 0 &&
      !ctfOffered &&
      !pickerNow.includes('ctf'),
    `records=${records().length} install=${installShown} status=${installedStatus} manual=${manualOrigin} picker=${JSON.stringify(pickerNow)}`,
  )
  if (failures.length > 0) throw new Error(`mods-remove: failed: ${failures.join('; ')}`)
}
