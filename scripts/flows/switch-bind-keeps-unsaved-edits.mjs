// Story 320 acceptance flow: a switch bind is written through the normal save path, so it never
// carries unsaved edits of the open profile onto disk, and an external edit of the default
// profile's canonical file refuses the bind with visible text instead of being overwritten.
//
// Fixture: `INSTALL_TWO_ID` has two assigned profiles (Plain and Layered) and no default, so the
// switch-bind control shows there. Plain is made its default through the assignments popover first
// (a clean profile, so that sync is a plain no-op write). The unsaved edit is the Raw tab's
// `unbindall` checkbox, the same real content setter `external-edit-cascades.mjs` uses.
//
// Selectors: nav-config/nav-library (TitleBar), config-profile-row, config-tab-raw,
// config-tab-unsaved (ConfigView), switch-bind-capture / switch-bind-error (SwitchBindControl).
//
// Like every `ui:flow`, this does not reseed: it appends a per-run marker to the canonical file, so
// run `npm run ui:seed` before a re-run (a leftover hand edit would refuse the first bind).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import { INSTALL_TWO_ID, installationConfigFilePath } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
const PLAIN_PROFILE_FILE_NAME = 'Plain-Profile.cfg'
const INSTALL_TWO_NAME = 'Fixture WriteDir Install'
const LOADER_FILE_NAME = 'autoexec.cfg'

async function openPlainProfile(page) {
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })
}

async function waitForFileContaining(path, needle) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      if (readFileSync(path, 'latin1').includes(needle)) return
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${path} to contain ${needle}`)
}

export default async function switchBindKeepsUnsavedEdits({ page, shot, step }) {
  const canonicalPath = join(variantUserDataDir('populated'), PLAIN_PROFILE_FILE_NAME)
  const copyPath = installationConfigFilePath(INSTALL_TWO_ID, PLAIN_PROFILE_FILE_NAME)
  const loaderPath = installationConfigFilePath(INSTALL_TWO_ID, LOADER_FILE_NAME)

  step('make Plain Profile the default of the writedir installation')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await openPlainProfile(page)
  await page.getByRole('button', { name: /assigned/i }).click({ timeout: TIMEOUT_MS })
  const assignmentRow = page.locator('li').filter({ hasText: INSTALL_TWO_NAME }).last()
  const setDefault = assignmentRow.getByRole('button', { name: 'Set default' })
  if (await setDefault.count()) await setDefault.click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('Escape')

  step("dirty Plain Profile through the real UI (Raw tab's unbindall checkbox)")
  await page.getByTestId('config-tab-raw').click({ timeout: TIMEOUT_MS })
  await page
    .getByText('Start the file with `unbindall`', { exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const canonicalBefore = readFileSync(canonicalPath, 'latin1')
  const copyBefore = readFileSync(copyPath, 'latin1')

  step('set a switch bind from the installation profiles panel')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  const installationRow = page.locator('li').filter({ hasText: INSTALL_TWO_NAME }).last()
  await installationRow.getByTestId('switch-bind-capture').click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('F9')
  await installationRow
    .getByText('F9', { exact: true })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForFileContaining(loaderPath, 'F9')

  step('assert the bind left the unsaved edit off disk and the Unsaved tab is still shown')
  if (readFileSync(canonicalPath, 'latin1') !== canonicalBefore) {
    throw new Error('the switch bind changed the canonical file - unsaved edits reached disk')
  }
  if (readFileSync(copyPath, 'latin1') !== copyBefore) {
    throw new Error("the switch bind changed the installation's profile copy")
  }
  await openPlainProfile(page)
  await page.getByTestId('config-tab-unsaved').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('unsaved-kept-after-switch-bind')

  step('edit the canonical file on disk, then set another bind')
  const handEdited = `${canonicalBefore}// q2l_flow_switch_bind_${Date.now().toString(36)}\n`
  writeFileSync(canonicalPath, handEdited, 'latin1')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await installationRow.getByTestId('switch-bind-capture').click({ timeout: TIMEOUT_MS })
  await page.keyboard.press('F10')

  step('assert the refusal is visible and the hand-edited bytes are kept')
  const error = installationRow.getByTestId('switch-bind-error')
  await error.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('switch-bind-refused')
  if (readFileSync(canonicalPath, 'latin1') !== handEdited) {
    throw new Error('the refused switch bind still changed the hand-edited canonical file')
  }
  if (readFileSync(copyPath, 'latin1').includes('q2l_flow_switch_bind_')) {
    throw new Error('the refused switch bind carried the hand edit into the installation copy')
  }
}
