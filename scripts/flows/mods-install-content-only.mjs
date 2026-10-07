// Story 190 D8: on the q2pro 64-bit installation `fixturemod` has no x86_64 library, so the install is
// content-only: pak0.pak lands, no library does, and tile and detail both say why it is not playable.
import { existsSync, readFileSync } from 'node:fs'
import {
  installationRootFilePath,
  MODS_INSTALL_Q2PRO_ID,
  MODS_INSTALL_Q2PRO_NAME,
  modsFixtureContentOnlyFiles,
} from '../lib/fixture.mjs'
import {
  installRecords,
  JOB_TIMEOUT_MS,
  modsInstallLifecycle,
  openMods,
  TIMEOUT_MS,
} from '../lib/mods-install-flow.mjs'

export const variant = 'populated'
const lifecycle = modsInstallLifecycle()
export const setup = lifecycle.setup
export const teardown = lifecycle.teardown

const REASON = 'Not playable locally with Q2PRO 64-bit: no matching build'

export default async function modsInstallContentOnly({ page, shot, step }) {
  step('select the q2pro installation, open Mods and the fixturemod detail')
  await openMods(page, MODS_INSTALL_Q2PRO_NAME)
  await page.getByTestId('mods-tile-fixturemod').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('mods-detail-install-fixturemod').click({ timeout: TIMEOUT_MS })

  step('wait for installed')
  await page
    .getByTestId('mods-tile-status-fixturemod')
    .filter({ hasText: /installed/i })
    .first()
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('installed-content-only')

  step('files on disk: pak0.pak only, byte for byte; no library')
  const pak = readFileSync(installationRootFilePath(MODS_INSTALL_Q2PRO_ID, 'fixturemod/pak0.pak'))
  if (!pak.equals(modsFixtureContentOnlyFiles['pak0.pak']))
    throw new Error('pak0.pak is not the content-only bytes')
  if (existsSync(installationRootFilePath(MODS_INSTALL_Q2PRO_ID, 'fixturemod/gamex86.dll'))) {
    throw new Error('gamex86.dll was written for a q2pro 64-bit install')
  }

  step('tile and detail both show the reason')
  // The tile's install state is a sibling of the tile button, so "tile" = every match outside the detail panel.
  const all = page.getByTestId('mods-content-only-reason')
  const inDetail = page.getByTestId('mods-detail-panel').getByTestId('mods-content-only-reason')
  await inDetail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const texts = (await all.allInnerTexts()).map((t) => t.trim())
  if (texts.length !== 2 || !texts.every((t) => t === REASON)) {
    throw new Error(`expected the reason on tile and detail, got ${JSON.stringify(texts)}`)
  }
  if ((await inDetail.count()) !== 1)
    throw new Error('the detail panel does not show the reason exactly once')

  step('the record lists only pak0.pak')
  const recs = installRecords(MODS_INSTALL_Q2PRO_ID)
  if (recs.length !== 1 || recs[0].files.length !== 1)
    throw new Error(`records: ${JSON.stringify(recs)}`)
}
