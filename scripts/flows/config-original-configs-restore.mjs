// Story 254 acceptance flow: the first assignment to an installation backs up the config files
// the user already had there, and "Restore original configs" puts them back byte for byte,
// unassigns every profile and removes the action - until the next assignment backs up afresh.
//
// Selectors: config-profile-row (ConfigView list), config-unassigned-assign (UnassignedProfileBanner),
// the assignments popover is the `panel-raised` ancestor of an installation row (AssignmentsMenu.tsx),
// config-restore-originals / config-restore-originals-confirm (InstallationProfilesPanel.tsx).
//
// The installation is the fixture's store-managed one: plain, playable, assigned to no profile.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { poll } from '../lib/replays-copy-in.mjs'
import {
  INSTALL_REMOVE_STORE_ID,
  INSTALL_REMOVE_STORE_NAME,
  installationRootPath,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
const PROFILE_NAME = 'Imported Profile'
const PROFILE_FILE_NAME = 'Imported-Profile.cfg'
// latin-1 bytes above 0x7f and a CRLF: a copy that re-encodes or normalises would not survive.
const ORIGINAL_AUTOEXEC = Buffer.from('// my own setup\r\nset name "Zo\xe9"\r\n', 'latin1')

const root = installationRootPath(INSTALL_REMOVE_STORE_ID)
const autoexecPath = join(root, 'baseq2', 'autoexec.cfg')
const backupPath = join(root, 'q2launcher-original-configs', 'baseq2', 'autoexec.cfg')
const profileCopyPath = join(root, 'baseq2', PROFILE_FILE_NAME)

const holdsOriginal = (path) => () =>
  existsSync(path) && readFileSync(path).equals(ORIGINAL_AUTOEXEC)

async function assignInstallation(page) {
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: PROFILE_NAME })
    .first()
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-unassigned-assign').click({ timeout: TIMEOUT_MS })
  const row = page
    .locator('li')
    .filter({ has: page.getByRole('checkbox') })
    .filter({ hasText: INSTALL_REMOVE_STORE_NAME })
  await row.locator('label').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('config-unassigned-banner')
    .waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /back/i }).first().click({ timeout: TIMEOUT_MS })
}

export default async function configOriginalConfigsRestore({ page, shot, step }) {
  const installationRow = page.locator('li').filter({ hasText: INSTALL_REMOVE_STORE_NAME })
  const restoreAction = installationRow.getByTestId('config-restore-originals')

  step('the installation holds a config file of its own')
  mkdirSync(join(root, 'baseq2'), { recursive: true })
  writeFileSync(autoexecPath, ORIGINAL_AUTOEXEC)

  step('assign a profile to the installation')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await assignInstallation(page)

  step('the original file is backed up and the restore action is offered')
  await poll('the backup of autoexec.cfg', holdsOriginal(backupPath), TIMEOUT_MS)
  await restoreAction.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await restoreAction.scrollIntoViewIfNeeded()
  await shot('restore-offered')

  step('restore asks for confirmation, then puts the original back')
  await restoreAction.click({ timeout: TIMEOUT_MS })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await dialog.textContent())?.includes(INSTALL_REMOVE_STORE_NAME)) {
    throw new Error('expected the confirmation to name the installation')
  }
  await shot('restore-confirm')
  await page.getByTestId('config-restore-originals-confirm').click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('autoexec.cfg is byte-identical, the profile file is gone, nothing is assigned')
  await poll('autoexec.cfg to hold the original bytes', holdsOriginal(autoexecPath), TIMEOUT_MS)
  await poll('the profile file to be removed', () => !existsSync(profileCopyPath))
  await restoreAction.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await installationRow.getByText('No profiles assigned.').waitFor({
    state: 'visible',
    timeout: TIMEOUT_MS,
  })
  await shot('restored')

  step('assigning again backs up afresh')
  await assignInstallation(page)
  await poll('a fresh backup of autoexec.cfg', holdsOriginal(backupPath), TIMEOUT_MS)
  await restoreAction.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}
