// Shared plumbing of the story 190 D8 mods-install flows (content-only, refused, waits, over-manual):
// the offline fixture server with the mods-install manifest, the seeded installations, and the
// state.json record reader. `mods-install.mjs` (D7) keeps its own copy and stays untouched.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from './harness.mjs'
import { startBootstrapFixtureServer, vendoredExtractorExists, writeModsInstallFixture } from './fixture.mjs'

export const TIMEOUT_MS = 8_000
export const JOB_TIMEOUT_MS = 60_000

/** Creates the `setup`/`teardown` pair a flow exports. */
/** `onServer` receives the running fixture server (its `requested` log) once `setup` has started it. */
export function modsInstallLifecycle(onServer) {
  let server = null
  return {
    async setup() {
      if (!vendoredExtractorExists()) {
        throw new Error('resources/bin/7za.exe is missing - run `npm run fetch:7za` first.')
      }
      writeModsInstallFixture()
      server = await startBootstrapFixtureServer({ includeR1q2: true, modsInstall: true })
      onServer?.(server)
      console.log(`  fixture server: ${server.baseUrl}`)
      return { env: { Q2L_UI_CONTENT_REPO_BASE: server.baseUrl } }
    },
    async teardown() {
      await server?.close()
      server = null
    },
  }
}

/** The install records of installation `id`, read from the app's `state.json`. */
export function installRecords(id) {
  const state = JSON.parse(readFileSync(join(variantUserDataDir('populated'), 'state.json'), 'utf8'))
  return state.installations.find((i) => i.id === id)?.moduleData?.mods?.records ?? []
}

export async function openMods(page, installationName) {
  await page.getByRole('button', { name: installationName, exact: true }).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-mods').click({ timeout: TIMEOUT_MS })
}

export async function simulateLaunch(page, installationId, phase) {
  const outcome = await page.evaluate(
    ({ id, ph }) => window.q2.invoke('dev:simulateLaunch', { installationId: id, phase: ph }),
    { id: installationId, ph: phase },
  )
  if (!outcome?.ok) throw new Error(`dev:simulateLaunch(${phase}) failed: ${JSON.stringify(outcome)}`)
}
