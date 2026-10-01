// Story 193 D2: the missing-mod dialog offers installing the mod from the catalog. Install starts the
// catalog install into the active installation, closes the dialog, plays nothing and never trusts the
// mod; once the job is done the demo plays without asking.
//
// The "engine" is the fixture's stand-in client (see `replays-play-q2pro.mjs`); the catalog and its one
// package are served by the offline fixture server (`modsReplays`), so nothing leaves the machine.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import {
  REPLAYS_MOD_INSTALL_VARIANT,
  REPLAYS_PLAY_MISSING_MOD,
  REPLAYS_PLAY_MISSING_MOD_DEMO,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeReplaysModInstallFixture,
} from '../lib/fixture.mjs'

export const variant = REPLAYS_MOD_INSTALL_VARIANT

const TIMEOUT_MS = 8_000
const LAUNCH_TIMEOUT_MS = 15_000
const JOB_TIMEOUT_MS = 60_000

let server = null

export async function setup() {
  if (process.platform === 'win32' && !vendoredExtractorExists()) return {}
  writeReplaysModInstallFixture()
  server = await startBootstrapFixtureServer({ modsReplays: { withOpentdm: true } })
  console.log(`  fixture server: ${server.baseUrl}`)
  return { env: { Q2L_UI_CONTENT_REPO_BASE: server.baseUrl } }
}

export async function teardown() {
  await server?.close()
  server = null
}

async function waitForScan(page) {
  const refresh = page.getByTestId('replays-refresh')
  await refresh.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await refresh.isDisabled())) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('replays-mod-install: timed out waiting for the demo scan to finish')
}

function readLog(logPath) {
  return existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
}

async function waitFor(predicate, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error(`replays-mod-install: timed out waiting for ${typeof what === 'function' ? what() : what}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

function trustedMods() {
  const statePath = join(variantUserDataDir(REPLAYS_MOD_INSTALL_VARIANT), 'state.json')
  if (!existsSync(statePath)) return []
  return JSON.parse(readFileSync(statePath, 'utf8')).replays?.modWarning?.trustedMods ?? []
}

export default async function replaysModInstall({ page, step, shot }) {
  if (process.platform === 'win32' && !vendoredExtractorExists()) {
    console.log('replays-mod-install: SKIPPING LOUDLY - resources/bin/7za.exe was not vendored (npm run fetch:7za)')
    return
  }

  await page.getByTestId('nav-replays').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-demo-list').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitForScan(page)
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  const dialog = page.getByTestId('replays-mod-missing-dialog')
  const install = page.getByTestId('replays-mod-missing-install')
  const demoCommand = `+demo ${REPLAYS_PLAY_MISSING_MOD_DEMO}`
  const listJobs = async () => (await page.evaluate(() => window.q2.invoke('jobs:list'))).filter((job) => job.moduleId === 'mods')

  step('the dialog offers installing the catalog mod')
  await page
    .getByTestId('replays-demo-row')
    .filter({ hasText: REPLAYS_PLAY_MISSING_MOD_DEMO })
    .first()
    .click({ timeout: TIMEOUT_MS })
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.evaluate(() => {
    window.__q2lPhases = []
    if (!window.__q2lArmed) {
      window.__q2lArmed = true
      window.q2.on('launch:state', (state) => window.__q2lPhases.push(state.phase))
    }
  })
  await play.click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByTestId('replays-mod-missing-confirm').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await install.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await install.textContent()) ?? '').includes('OpenTDM')) {
    throw new Error(`replays-mod-install: the install button must name OpenTDM, got ${JSON.stringify(await install.textContent())}`)
  }
  await shot('install-offered')

  step('install starts the job and plays nothing')
  const jobsBefore = (await listJobs()).length
  await page.getByTestId('replays-mod-warning-dont-ask').click({ timeout: TIMEOUT_MS })
  await install.click({ timeout: TIMEOUT_MS })
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await waitFor(async () => (await listJobs()).length > jobsBefore, 'a mods job in jobs:list')
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  if (readLog(logPath).includes(demoCommand)) {
    throw new Error(`replays-mod-install: Install must not play the demo (${demoCommand} found in main.log)`)
  }

  step('install does not trust the mod')
  if (trustedMods().includes(REPLAYS_PLAY_MISSING_MOD)) {
    throw new Error(`replays-mod-install: Install must not trust the mod, got ${JSON.stringify(trustedMods())}`)
  }

  step('after the install the demo plays without asking')
  let lastJobs = []
  await waitFor(
    async () => {
      const jobs = (lastJobs = await listJobs())
      const failed = jobs.find((job) => job.status === 'failed')
      if (failed) throw new Error(`replays-mod-install: the install job failed: ${JSON.stringify(failed)}`)
      return jobs.length > jobsBefore && jobs.every((job) => job.status === 'succeeded')
    },
    () => `the mods job to succeed (jobs: ${JSON.stringify(lastJobs)})`,
    JOB_TIMEOUT_MS,
  )
  await page.evaluate(() => {
    window.__q2lPhases = []
  })
  await play.click({ timeout: TIMEOUT_MS })
  await waitFor(() => readLog(logPath).includes(demoCommand), `main.log ${demoCommand}`, LAUNCH_TIMEOUT_MS)
  if ((await dialog.count()) !== 0) throw new Error('replays-mod-install: the installed mod must play without the dialog')
  await page.waitForFunction(
    () => {
      const phases = window.__q2lPhases ?? []
      return phases.lastIndexOf('running') !== -1 && phases.length > phases.lastIndexOf('running') + 1
    },
    undefined,
    { timeout: LAUNCH_TIMEOUT_MS },
  )
}
