// Story 190 D7: installing a catalog mod end to end, offline. On a seeded r1q2 installation (engine
// arch x86 comes from the fixture manifest via `moduleData.downloads.packageId`, the seeded
// executable being an empty file) it clicks Install on the `fixturemod` tile, sees the job on the
// tile and in the Downloads tab, waits for "Installed", then reads the result off the disk and
// `state.json`: the files, the 404-then-mirror request order, the gamedir picker, the install record.
//
// Selectors (renderer): nav-mods, nav-downloads, mods-install-<catalogId>, mods-tile-status-<id>,
//   mods-tile-progress-<id>, downloads-job-<jobId>; the action bar's gamedir <select> by its label.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import {
  installationRootFilePath,
  MODS_INSTALL_R1Q2_ID,
  MODS_INSTALL_R1Q2_NAME,
  modsFixtureFiles,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeModsInstallFixture,
} from '../lib/fixture.mjs'

export const variant = 'populated'

const TIMEOUT_MS = 8_000
const JOB_TIMEOUT_MS = 60_000
const LIBRARY_FILE = 'fixturemod-win32-x86.zip'

let server = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error('resources/bin/7za.exe is missing - run `npm run fetch:7za` first.')
  }
  writeModsInstallFixture()
  server = await startBootstrapFixtureServer({ includeR1q2: true, modsInstall: true })
  console.log(`  fixture server: ${server.baseUrl}`)
  return { env: { Q2L_UI_CONTENT_REPO_BASE: server.baseUrl } }
}

export async function teardown() {
  await server?.close()
  server = null
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export default async function modsInstall({ page, shot, step }) {
  step('select the r1q2 installation and open Mods')
  await page.getByRole('button', { name: MODS_INSTALL_R1Q2_NAME, exact: true }).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-mods').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('mods-install-fixturemod').click({ timeout: TIMEOUT_MS })

  step('the job shows on the tile')
  await page.getByTestId('mods-tile-progress-fixturemod').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('installing')

  step('the job shows in the Downloads tab')
  await page.getByTestId('nav-downloads').click({ timeout: TIMEOUT_MS })
  await page.locator('[data-testid^="downloads-job-"]').first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('wait for installed')
  await page.getByTestId('nav-mods').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('mods-tile-status-fixturemod')
    .filter({ hasText: /^installed$/i })
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('installed')

  step('files on disk: library variant, byte for byte')
  for (const [name, expected] of Object.entries(modsFixtureFiles)) {
    const actual = readFileSync(installationRootFilePath(MODS_INSTALL_R1Q2_ID, `fixturemod/${name}`))
    if (!actual.equals(expected)) throw new Error(`fixturemod/${name} differs from the x86 variant's bytes`)
  }

  step('request log: the 404 source came before the mirror')
  const primary = server.requested.indexOf(`/modpkg/${LIBRARY_FILE}`)
  const mirror = server.requested.indexOf(`/mirror/${LIBRARY_FILE}`)
  if (primary < 0 || mirror < 0 || primary > mirror) {
    throw new Error(`expected primary then mirror, got: ${server.requested.join(', ')}`)
  }

  step('the action bar gamedir picker lists fixturemod')
  const picker = page.locator('footer').getByLabel('Launch with')
  await picker.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const options = await picker.locator('option').allInnerTexts()
  if (!options.includes('fixturemod')) throw new Error(`picker lists ${JSON.stringify(options)}`)

  step('state.json records the install with every file, size and SHA256')
  const state = JSON.parse(readFileSync(join(variantUserDataDir('populated'), 'state.json'), 'utf8'))
  const installation = state.installations.find((i) => i.id === MODS_INSTALL_R1Q2_ID)
  const record = installation?.moduleData?.mods?.records?.[0]
  if (!record) throw new Error('no moduleData.mods.records[0]')
  if (record.catalogId !== 'fixturemod' || record.version !== 'v1.0.0' || record.variantId !== 'win32-x86') {
    throw new Error(`unexpected record identity: ${JSON.stringify({ ...record, files: undefined })}`)
  }
  const files = Object.fromEntries(record.files.map((f) => [f.path, f]))
  for (const [name, bytes] of Object.entries(modsFixtureFiles)) {
    const f = files[name] ?? files[`fixturemod/${name}`]
    if (!f || f.sizeBytes !== bytes.byteLength || f.sha256 !== sha256(bytes)) {
      throw new Error(`record file ${name} wrong: ${JSON.stringify(f)} in ${JSON.stringify(record.files)}`)
    }
  }
  if (record.files.length !== Object.keys(modsFixtureFiles).length) {
    throw new Error(`record lists ${record.files.length} files`)
  }
  console.log(`mods install: requested ${server.requested.join(', ')}`)
}
