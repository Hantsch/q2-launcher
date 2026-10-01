// Story 190 D8: installing over a manual gamedir with a clashing pak0.pak asks first. Cancel leaves the folder
// untouched and writes no record; Keep writes the missing library, keeps pak0.pak, and the record does not
// claim the kept file.
import { existsSync, readFileSync } from 'node:fs'
import {
  installationRootFilePath,
  MODS_INSTALL_R1Q2_ID,
  MODS_INSTALL_R1Q2_NAME,
  modsFixtureFiles,
  writeManualGamedirFile,
} from '../lib/fixture.mjs'
import { installRecords, JOB_TIMEOUT_MS, modsInstallLifecycle, openMods, TIMEOUT_MS } from '../lib/mods-install-flow.mjs'

export const variant = 'populated'
const lifecycle = modsInstallLifecycle()
export const teardown = lifecycle.teardown

const MANUAL_BYTES = Buffer.from('manual pak0 - not the catalog bytes')

export async function setup() {
  const result = await lifecycle.setup()
  // After the seed (which recreates the roots): a hand-made fixturemod folder with its own pak0.pak.
  writeManualGamedirFile(MODS_INSTALL_R1Q2_ID, 'fixturemod', 'pak0.pak', MANUAL_BYTES)
  return result
}

export default async function modsInstallOverManual({ page, shot, step }) {
  const pakPath = installationRootFilePath(MODS_INSTALL_R1Q2_ID, 'fixturemod/pak0.pak')

  step('select the r1q2 installation; install over the manual folder')
  await openMods(page, MODS_INSTALL_R1Q2_NAME)
  await page.getByTestId('mods-install-fixturemod').click({ timeout: TIMEOUT_MS })

  step('the decision dialog names the folder and lists pak0.pak')
  const dialog = page.getByTestId('mods-install-decision')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const folder = await page.getByTestId('mods-install-decision-folder').innerText()
  if (!folder.includes('fixturemod')) throw new Error(`dialog folder is ${JSON.stringify(folder)}`)
  const conflicts = await page.getByTestId('mods-install-decision-conflict').allInnerTexts()
  if (conflicts.length !== 1 || !conflicts[0].includes('pak0.pak')) {
    throw new Error(`conflicts: ${JSON.stringify(conflicts)}`)
  }
  await shot('decision')

  step('Cancel: folder unchanged, no record')
  await page.getByTestId('mods-install-decision-cancel').click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await new Promise((r) => setTimeout(r, 1_000))
  if (!readFileSync(pakPath).equals(MANUAL_BYTES)) throw new Error('pak0.pak changed after Cancel')
  if (existsSync(installationRootFilePath(MODS_INSTALL_R1Q2_ID, 'fixturemod/gamex86.dll'))) {
    throw new Error('gamex86.dll written after Cancel')
  }
  if (installRecords(MODS_INSTALL_R1Q2_ID).length !== 0) throw new Error('a record exists after Cancel')

  step('install again, Keep')
  await page.getByTestId('mods-install-fixturemod').click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('mods-install-decision-keep').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('mods-tile-status-fixturemod')
    .filter({ hasText: /^installed$/i })
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('installed-keep')

  step('pak0.pak kept, library written, record leaves pak0.pak out')
  if (!readFileSync(pakPath).equals(MANUAL_BYTES)) throw new Error('pak0.pak was overwritten by Keep')
  const dll = readFileSync(installationRootFilePath(MODS_INSTALL_R1Q2_ID, 'fixturemod/gamex86.dll'))
  if (!dll.equals(modsFixtureFiles['gamex86.dll'])) throw new Error('gamex86.dll bytes wrong')
  const recs = installRecords(MODS_INSTALL_R1Q2_ID)
  if (recs.length !== 1) throw new Error(`records: ${JSON.stringify(recs)}`)
  const paths = recs[0].files.map((f) => f.path)
  if (paths.some((p) => p.endsWith('pak0.pak')) || !paths.some((p) => p.endsWith('gamex86.dll'))) {
    throw new Error(`record files: ${JSON.stringify(paths)}`)
  }
}
