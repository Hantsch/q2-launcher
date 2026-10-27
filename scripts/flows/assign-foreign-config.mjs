// Assigning a profile to an installation that already holds a config
// file of the profile's name which the launcher did not write asks first. Cancel leaves the file
// and the assignment alone; Write backs the file up, then assigns; a file the launcher wrote itself
// is updated without asking; each conflicting installation asks once. (story 255)
//
// Selectors: config-profile-row (ConfigView list), the "N of M assigned" trigger
// (AssignmentsMenu.tsx), its rows (ProfileAssignmentsPanel.tsx: an `li` with a checkbox),
// foreign-config-write / foreign-config-cancel (ForeignConfigDialog.tsx).
//
// Run through `npm run ui:flows`, which reseeds before each flow: assignments persist, so a second
// bare `ui:flow` run would start with the installations already ticked.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { poll } from '../lib/replays-copy-in.mjs'
import {
  INSTALL_REMOVE_DISK_ID,
  INSTALL_REMOVE_DISK_NAME,
  INSTALL_REMOVE_STORE_ID,
  INSTALL_REMOVE_STORE_NAME,
  installationConfigFilePath,
  installationRootPath,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
const PROFILE_NAME = 'Imported Profile'
/** Mirrors `sanitizeProfileFileBase` (src/shared/config/profile/profile-files.ts). */
const PROFILE_FILE_NAME = 'Imported-Profile.cfg'
const INSTALL_B_NAME = 'Fixture Favorite Install'

// latin-1 bytes above 0x7f and a CRLF: a rewrite that re-encodes or normalises would not survive.
const FOREIGN_BYTES = Buffer.from('// my own binds\r\nbind x "say Zo\xe9"\r\n', 'latin1')
const AUTOEXEC_BYTES = Buffer.from('// my autoexec\r\nset name "Zo\xe9"\r\n', 'latin1')

const foreignPath = installationConfigFilePath(INSTALL_REMOVE_DISK_ID, PROFILE_FILE_NAME)
const autoexecPath = installationConfigFilePath(INSTALL_REMOVE_DISK_ID, 'autoexec.cfg')
const backupPath = join(
  installationRootPath(INSTALL_REMOVE_DISK_ID),
  'q2launcher-original-configs',
  'baseq2',
  PROFILE_FILE_NAME,
)
const copyForStoreInstall = installationConfigFilePath(INSTALL_REMOVE_STORE_ID, PROFILE_FILE_NAME)

const holds = (path, bytes) => () => existsSync(path) && readFileSync(path).equals(bytes)
const isStamped = (path) => () =>
  existsSync(path) &&
  readFileSync(path, 'latin1')
    .split(/\r?\n/)
    .slice(0, 8)
    .some((line) => line.includes('[q2l '))

function bail(message) {
  throw new Error(message)
}

export default async function assignForeignConfig({ page, shot, step }) {
  const dialog = page.getByRole('dialog')
  const row = (name) =>
    page
      .locator('li')
      .filter({ has: page.getByRole('checkbox') })
      .filter({ hasText: name })
  const tick = (name) => row(name).locator('label').click({ timeout: TIMEOUT_MS })
  const isTicked = (name) => row(name).getByRole('checkbox').isChecked()
  const expectTicked = (name) => poll(`${name} to be ticked`, () => isTicked(name), TIMEOUT_MS)

  step('a foreign config asks before anything is written')
  mkdirSync(join(installationRootPath(INSTALL_REMOVE_DISK_ID), 'baseq2'), { recursive: true })
  writeFileSync(foreignPath, FOREIGN_BYTES)
  writeFileSync(autoexecPath, AUTOEXEC_BYTES)

  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: PROFILE_NAME })
    .first()
    .click({ timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: /\d+ of \d+ assigned/ }).click({ timeout: TIMEOUT_MS })

  await tick(INSTALL_REMOVE_DISK_NAME)
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = (await dialog.textContent()) ?? ''
  if (!text.includes(PROFILE_FILE_NAME)) bail(`expected the dialog to name ${PROFILE_FILE_NAME}`)
  if (!text.includes(INSTALL_REMOVE_DISK_NAME)) {
    bail(`expected the dialog to name ${INSTALL_REMOVE_DISK_NAME}`)
  }
  await shot('foreign-config-dialog')
  if (!holds(foreignPath, FOREIGN_BYTES)())
    bail('the foreign file changed while the dialog is open')
  if (!holds(autoexecPath, AUTOEXEC_BYTES)()) bail('autoexec.cfg changed while the dialog is open')

  await page.getByTestId('foreign-config-cancel').click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  if (await isTicked(INSTALL_REMOVE_DISK_NAME)) bail('Cancel left the installation ticked')
  if (!holds(foreignPath, FOREIGN_BYTES)()) bail('Cancel changed the foreign file')
  if (existsSync(backupPath)) bail('Cancel left a backup of the foreign file')

  step('write backs the foreign config up and assigns')
  await tick(INSTALL_B_NAME)
  await expectTicked(INSTALL_B_NAME)
  if ((await dialog.count()) !== 0) bail('an installation without such a file asked anyway')

  await tick(INSTALL_REMOVE_DISK_NAME)
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await dialog.count()) !== 1) bail('expected exactly one dialog for the conflicting install')
  await page.getByTestId('foreign-config-write').click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  await expectTicked(INSTALL_REMOVE_DISK_NAME)
  await poll('the backup to hold the original bytes', holds(backupPath, FOREIGN_BYTES), TIMEOUT_MS)
  await poll('the config file to carry the launcher stamp', isStamped(foreignPath), TIMEOUT_MS)
  await shot('foreign-config-written')

  step('a launcher-written config is updated without asking')
  copyFileSync(foreignPath, copyForStoreInstall)
  await tick(INSTALL_REMOVE_STORE_NAME)
  await expectTicked(INSTALL_REMOVE_STORE_NAME)
  if ((await dialog.count()) !== 0) bail('a launcher-written file asked before being updated')
}
