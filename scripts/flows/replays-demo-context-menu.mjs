// Story 244 acceptance flow: one demo is deleted from the detail panel and another moved from the
// row's context menu (each with the confirmation and the outcome, the files landing in the harness
// trash or the target), and a folder is deleted from its row's menu - the confirmation names the
// folder and its demo count, the folder goes to the harness trash with everything inside. A demo
// source's own folder and a zip folder show "Delete folder..." disabled with the reason as text.
//
// Selectors - read `DemoRowMenu.tsx`, `DemoFileActions.tsx`, `DemoFolderRow.tsx` before changing:
//   replays-demo-row / replays-folder-row   one list row; right-click or Shift+F10 opens its menu
//   [role=menu] / [role=menuitem]           Menu.tsx - the row menu and its items (hint text under each)
//   demo-delete                             DemoFileActions.tsx - the detail panel's Delete button
//   replays-bulk-delete-confirm             the demo delete confirmation's confirm button
//   replays-folder-delete-confirm           the folder delete confirmation's confirm button
//   replays-bulk-summary                    BulkActionBar.tsx - the outcome line
//   replays-bulk-move-folder                MoveDemosDialog.tsx - a folder (data-path)

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  INSTALL_ONE_ID,
  installationConfigFilePath,
  removeReplaysZipPackArchive,
  vendoredExtractorExists,
  writeReplaysZipPackArchive,
} from '../lib/fixture.mjs'
import { variantUserDataDir } from '../lib/harness.mjs'
import { TIMEOUT_MS, openAllDemos, openFolder, poll, rowFor } from '../lib/replays-copy-in.mjs'

const PLACEHOLDER_DEMO_BYTES = 'q2l-fixture-demo-placeholder\n'
const DELETED = 'test-q2lcm-del.dm2'
const MOVED = 'test-q2lcm-mov.dm2'
const BIN = 'q2lcm-bin'
const TARGET = 'q2lcm-target'
const demosPath = (rel) => installationConfigFilePath(INSTALL_ONE_ID, `demos/${rel}`)
const BIN_DEMOS = [demosPath(`${BIN}/a.dm2`), demosPath(`${BIN}/deeper/b.dm2`)]

export async function setup() {
  writeReplaysZipPackArchive()
  mkdirSync(dirname(BIN_DEMOS[1]), { recursive: true })
  mkdirSync(demosPath(TARGET), { recursive: true })
  for (const path of [demosPath(DELETED), demosPath(MOVED), ...BIN_DEMOS]) {
    writeFileSync(path, PLACEHOLDER_DEMO_BYTES)
  }
  return {}
}

export async function teardown() {
  removeReplaysZipPackArchive()
  for (const name of [DELETED, MOVED]) rmSync(demosPath(name), { force: true })
  for (const dir of [BIN, TARGET]) rmSync(demosPath(dir), { recursive: true, force: true })
}

export default async function replaysDemoContextMenu({ page, shot, step, variant }) {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'replays-demo-context-menu: resources/bin/7za.exe is missing - run `npm run fetch:7za`',
    )
  }
  const fail = (message) => {
    throw new Error(`replays-demo-context-menu: ${message}`)
  }
  const expectText = async (locator, what, needle) => {
    const got = (await locator.textContent()) ?? ''
    if (!got.includes(needle)) fail(`${what} should say "${needle}", got "${got}"`)
  }
  const trashDir = join(variantUserDataDir(variant), 'harness-trash')
  const trashed = () => (existsSync(trashDir) ? readdirSync(trashDir) : [])
  const menu = page.getByRole('menu')
  const item = (name) => menu.getByRole('menuitem', { name })
  const folderRow = (name) =>
    page.getByTestId('replays-folder-row').filter({
      has: page.getByTestId('replays-folder-name').filter({ hasText: name }),
    })
  const closeMenu = async () => {
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  }

  await openAllDemos(page)

  step('a demo source root and a zip folder show Delete folder disabled with the reason as text')
  const root = folderRow('Fixture Favorite Install').first()
  await root.click({ button: 'right', timeout: TIMEOUT_MS })
  await menu.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await item(/Delete folder/).isDisabled())) fail('the root folder must not be deletable')
  await expectText(menu, 'the root reason', "own folder can't be deleted")
  await closeMenu()
  await openFolder(page, 'Fixture Favorite Install')
  await poll(
    'the zip folder row',
    async () => (await folderRow('pack.zip').count()) === 1,
    TIMEOUT_MS,
  )
  await folderRow('pack.zip').click({ button: 'right', timeout: TIMEOUT_MS })
  await menu.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await item(/Delete folder/).isDisabled())) fail('a zip folder must not be deletable')
  await expectText(menu, 'the zip reason', 'read-only')
  await shot('replays-folder-menu-zip')
  await closeMenu()

  step('a folder is deleted from its row menu: the confirmation names it and its demo count')
  await folderRow(BIN).click({ button: 'right', timeout: TIMEOUT_MS })
  await menu.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await item(/Delete folder/).click({ timeout: TIMEOUT_MS })
  await page.getByText(`Delete folder ${BIN}?`).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .getByText('the 2 demos in it move to the trash')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('replays-folder-delete-confirm')
  await page.getByTestId('replays-folder-delete-confirm').click({ timeout: TIMEOUT_MS })
  await poll('the folder row to go', async () => (await folderRow(BIN).count()) === 0, TIMEOUT_MS)
  if (existsSync(demosPath(BIN))) fail('the folder is still on disk')
  if (!trashed().some((entry) => entry.endsWith(`-${BIN}`))) {
    fail(`${BIN} is not in ${trashDir} (${trashed().join(', ')})`)
  }

  await page.getByTestId('replays-filter-search').fill('test-q2lcm')
  await poll(
    'the flow demos to be listed',
    async () =>
      (await rowFor(page, DELETED).count()) === 1 && (await rowFor(page, MOVED).count()) === 1,
    TIMEOUT_MS,
  )

  step('a demo is deleted from the detail panel')
  await rowFor(page, DELETED).click({ timeout: TIMEOUT_MS })
  const actions = page.getByTestId('replays-detail').getByTestId('replays-detail-file-actions')
  await actions.getByTestId('demo-delete').click({ timeout: TIMEOUT_MS })
  await page.getByText('Delete 1 demo?').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-bulk-delete-confirm').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-bulk-summary').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectText(page.getByTestId('replays-bulk-summary'), 'the delete outcome', '1 deleted')
  if (existsSync(demosPath(DELETED))) fail(`${DELETED} was not removed`)
  if (!trashed().some((entry) => entry.endsWith(`-${DELETED}`))) {
    fail(`${DELETED} is not in the trash`)
  }
  await shot('replays-demo-delete-outcome')

  step('a demo is moved from its row menu, which also opens from the keyboard')
  await rowFor(page, MOVED).locator('[role="button"]').first().focus()
  await page.keyboard.press('Shift+F10')
  await menu.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await closeMenu()
  await rowFor(page, MOVED).click({ button: 'right', timeout: TIMEOUT_MS })
  await menu.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  for (const name of [/Reveal/, /Copy path/, /Rename/, /Move/, /Delete/]) {
    await item(name).waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  }
  await shot('replays-demo-row-menu')
  await item(/Move/).click({ timeout: TIMEOUT_MS })
  await page
    .locator(`[data-testid="replays-bulk-move-folder"][data-path="${TARGET}"]`)
    .click({ timeout: TIMEOUT_MS })
  await poll(
    'the move outcome',
    async () =>
      ((await page.getByTestId('replays-bulk-summary').textContent()) ?? '').includes('1 moved'),
    TIMEOUT_MS,
  )
  if (existsSync(demosPath(MOVED))) fail(`${MOVED} stayed in the demos folder`)
  if (!existsSync(demosPath(`${TARGET}/${MOVED}`))) fail(`${MOVED} did not arrive in ${TARGET}`)

  // The filter is persisted after a debounce: leave it empty for the flows that follow.
  await page.getByTestId('replays-filter-search').fill('')
  await page.waitForTimeout(600)
}
