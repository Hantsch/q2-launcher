// Story 190 D8: with the game running on the installation, an install waits - the reason shows on the tile
// and in the Downloads tab, no gamedir exists yet - and finishes by itself once the game exits.
import { existsSync, readFileSync } from 'node:fs'
import {
  installationRootFilePath,
  MODS_INSTALL_R1Q2_ID,
  MODS_INSTALL_R1Q2_NAME,
  modsFixtureFiles,
} from '../lib/fixture.mjs'
import {
  installRecords,
  JOB_TIMEOUT_MS,
  modsInstallLifecycle,
  openMods,
  simulateLaunch,
  TIMEOUT_MS,
} from '../lib/mods-install-flow.mjs'

export const variant = 'populated'
const lifecycle = modsInstallLifecycle()
export const setup = lifecycle.setup
export const teardown = lifecycle.teardown

const WAITING = /waiting for the game to close/i

export default async function modsInstallWaits({ page, shot, step }) {
  step('select the r1q2 installation, simulate the game running, install')
  await openMods(page, MODS_INSTALL_R1Q2_NAME)
  await simulateLaunch(page, MODS_INSTALL_R1Q2_ID, 'running')
  await page.getByTestId('mods-install-fixturemod').click({ timeout: TIMEOUT_MS })

  step('the tile names the waiting reason')
  await page
    .getByTestId('mods-tile-status-fixturemod')
    .filter({ hasText: WAITING })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('waiting-tile')

  step('the Downloads tab names the same reason')
  await page.getByTestId('nav-downloads').click({ timeout: TIMEOUT_MS })
  const row = page.locator('[data-testid^="downloads-job-waiting-"]').first()
  await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const rowText = await row.innerText()
  if (!WAITING.test(rowText))
    throw new Error(`downloads row is not the waiting reason: ${JSON.stringify(rowText)}`)

  step('nothing is on disk yet')
  await new Promise((r) => setTimeout(r, 1_500))
  if (existsSync(installationRootFilePath(MODS_INSTALL_R1Q2_ID, 'fixturemod'))) {
    throw new Error('fixturemod/ exists while the game is running')
  }
  if (installRecords(MODS_INSTALL_R1Q2_ID).length !== 0)
    throw new Error('a record exists while waiting')

  step('idle: the install finishes by itself')
  await simulateLaunch(page, MODS_INSTALL_R1Q2_ID, 'idle')
  await page.getByTestId('nav-mods').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('mods-tile-status-fixturemod')
    .filter({ hasText: /^installed$/i })
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('installed-after-wait')
  for (const [name, expected] of Object.entries(modsFixtureFiles)) {
    const actual = readFileSync(
      installationRootFilePath(MODS_INSTALL_R1Q2_ID, `fixturemod/${name}`),
    )
    if (!actual.equals(expected))
      throw new Error(`fixturemod/${name} differs from the expected bytes`)
  }
}
