// Story 190 D8: `fixturebad` has a wrong SHA256. The install ends as a failed job whose visible reason is
// the verification error; nothing is left on disk and no record is written.
import { existsSync } from 'node:fs'
import { STATE_WRITE_GRACE_MS } from '../lib/state-json.mjs'
import {
  installationRootFilePath,
  MODS_INSTALL_R1Q2_ID,
  MODS_INSTALL_R1Q2_NAME,
} from '../lib/fixture.mjs'
import {
  installRecords,
  JOB_TIMEOUT_MS,
  modsInstallLifecycle,
  openMods,
  TIMEOUT_MS,
} from '../lib/mods-install-flow.mjs'

export const variant = 'populated'
let server = null
const lifecycle = modsInstallLifecycle((s) => (server = s))
export const setup = lifecycle.setup
export const teardown = lifecycle.teardown

// The downloader never surfaces a bare verification error: a source that served wrong bytes is skipped like
// any failed source, and with none left the job fails with downloads.error.allMirrorsFailed. The request
// log below proves it was the wrong bytes (served, then refused), not a missing file, that got us here.
const VERIFICATION = /every download source failed/i

export default async function modsInstallRefused({ page, shot, step }) {
  step('select the r1q2 installation and install fixturebad')
  await openMods(page, MODS_INSTALL_R1Q2_NAME)
  await page.getByTestId('mods-install-fixturebad').click({ timeout: TIMEOUT_MS })

  step('the tile shows the verification error')
  await page
    .getByTestId('mods-tile-status-fixturebad')
    .filter({ hasText: VERIFICATION })
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('refused-tile')

  step('the job is failed with the downloader error key')
  const jobs = await page.evaluate(() => window.q2.invoke('jobs:list'))
  const failed = jobs.filter(
    (j) => j.installationId === MODS_INSTALL_R1Q2_ID && j.status === 'failed',
  )
  if (failed.length !== 1 || failed[0].error?.key !== 'downloads.error.allMirrorsFailed') {
    throw new Error(`expected one failed job with allMirrorsFailed, got ${JSON.stringify(jobs)}`)
  }

  step('the wrong bytes were served by the mirror (so it was verification that refused them)')
  if (!server.requested.includes('/mirror/fixturebad-content.zip')) {
    throw new Error(`mirror never requested: ${server.requested.join(', ')}`)
  }

  step('nothing on disk, no record in state.json')
  if (existsSync(installationRootFilePath(MODS_INSTALL_R1Q2_ID, 'fixturebad'))) {
    throw new Error('fixturebad/ exists after a refused install')
  }
  // Absence assertion: let a debounced persist land first, or an erroneous record could be missed.
  await new Promise((resolve) => setTimeout(resolve, STATE_WRITE_GRACE_MS))
  const recs = installRecords(MODS_INSTALL_R1Q2_ID)
  if (recs.length !== 0) throw new Error(`records exist: ${JSON.stringify(recs)}`)
}
