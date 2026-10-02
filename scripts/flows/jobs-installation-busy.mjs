// Story 219: the shared job runner's busy refusal, on the real surfaces. A write job holds the
// installation (dev:simulateJob 'writing' - the real runner and write guard); while it does, a mod
// install and an engine update for the same installation are both refused with the one visible
// reason, and neither leaves a job behind.
//
// Selectors: nav-mods, mods-install-<catalogId>, mods-tile-status-<id>, engine-update-action,
//   engine-update-dialog, engine-update-confirm, engine-update-error.
import { MODS_INSTALL_R1Q2_ID, MODS_INSTALL_R1Q2_NAME } from '../lib/fixture.mjs'
import { modsInstallLifecycle, openMods, TIMEOUT_MS } from '../lib/mods-install-flow.mjs'

export const variant = 'populated'
let server = null
const lifecycle = modsInstallLifecycle((s) => (server = s))
export const setup = lifecycle.setup
export const teardown = lifecycle.teardown

/** Mirrors `jobs.error.installationBusy` (`src/renderer/src/i18n/locales/en.json`). */
const BUSY = /another job is changing this installation/i

const jobsFor = (page) =>
  page.evaluate(
    (id) => window.q2.invoke('jobs:list').then((jobs) => jobs.filter((j) => j.installationId === id)),
    MODS_INSTALL_R1Q2_ID,
  )

export default async function jobsInstallationBusy({ page, shot, step }) {
  step('select the r1q2 installation and open Mods')
  await openMods(page, MODS_INSTALL_R1Q2_NAME)
  await page.getByTestId('mods-install-fixturemod').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('hold the installation with a write job')
  const held = await page.evaluate(
    (installationId) =>
      window.q2.invoke('dev:simulateJob', { scenario: 'writing', installationId }),
    MODS_INSTALL_R1Q2_ID,
  )
  if (!held?.ok) throw new Error(`dev:simulateJob('writing') failed: ${JSON.stringify(held)}`)
  const before = await jobsFor(page)
  const holder = before.find((j) => j.status === 'running')
  if (!holder) throw new Error(`expected the held write job, got ${JSON.stringify(before)}`)

  try {
    step('installing a mod is refused with a visible reason and starts no job')
    await page.getByTestId('mods-install-fixturemod').click({ timeout: TIMEOUT_MS })
    await page
      .getByTestId('mods-tile-status-fixturemod')
      .filter({ hasText: BUSY })
      .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await shot('mod-install-refused')
    if ((await jobsFor(page)).length !== before.length) {
      throw new Error('the refused mod install created a job')
    }

    step('an engine update is refused with the same visible reason and starts no job')
    const actionBar = page.locator('footer')
    await actionBar
      .getByTestId('engine-update-action')
      .getByRole('button')
      .click({ timeout: TIMEOUT_MS })
    await page.getByTestId('engine-update-dialog').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await page.getByTestId('engine-update-confirm').click({ timeout: TIMEOUT_MS })
    await page
      .getByTestId('engine-update-error')
      .filter({ hasText: BUSY })
      .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await shot('engine-update-refused')
    if ((await jobsFor(page)).length !== before.length) {
      throw new Error('the refused engine update created a job')
    }
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  } finally {
    step('cancel the held write job')
    await page.evaluate((jobId) => window.q2.invoke('jobs:cancel', jobId), holder.id)
  }

  const after = await jobsFor(page)
  if (after.some((j) => j.status === 'running' || j.status === 'waiting')) {
    throw new Error(`a job is still active after cancel: ${JSON.stringify(after)}`)
  }
  console.log(`jobs-installation-busy: requested ${server?.requested.join(', ') || '(nothing)'}`)
}
