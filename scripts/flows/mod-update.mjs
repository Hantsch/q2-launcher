// Story 194 D4 acceptance flow: a newer catalog mod version is offered, and updating it replaces the
// recorded files only.
//
// One installation: `opentdm` (old v1.0.0 record; old-only.txt, a shared gamex86.dll with other old bytes,
// and demos/mine.dm2 in no record), `action` (old record whose NEW package carries a wrong SHA256) and a
// manual `ctf` folder (no record). The fixture server logs every request, so "nothing downloaded until
// Update is clicked" is checked against its `requested` list.
//
// Selectors - ModInstallState.tsx, ModDetailPanel.tsx, ModTile.tsx: mods-tile-<dir>, mods-tile-status-<id>,
// mods-update-<id>, mods-detail-update-<id>, mods-detail-update-versions, mods-tile-update-error-<id>.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'
import {
  INSTALL_MODS_UPDATE_ID,
  INSTALL_MODS_UPDATE_NAME,
  installationRootFilePath,
  MODS_UPDATE_USER_BYTES,
  MODS_UPDATE_USER_FILE,
  modsUpdateManualFiles,
  modsUpdateNewOpentdmFiles,
  modsUpdateOldFiles,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeModsUpdateFixture,
} from '../lib/fixture.mjs'
import { JOB_TIMEOUT_MS, openMods, TIMEOUT_MS } from '../lib/mods-install-flow.mjs'

export const variant = 'populated'

let server
export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error('resources/bin/7za.exe is missing - run `npm run fetch:7za` first.')
  }
  writeModsUpdateFixture()
  server = await startBootstrapFixtureServer({ includeR1q2: true, modsUpdate: true })
  return { env: { Q2L_UI_CONTENT_REPO_BASE: server.baseUrl } }
}
export async function teardown() {
  await server?.close()
  server = null
}

const path = (rel) => installationRootFilePath(INSTALL_MODS_UPDATE_ID, rel)
const failures = []
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` - ${detail}`}`)
  if (!ok) failures.push(label)
}
const packageRequests = () => server.requested.filter((p) => p.startsWith('/mirror/') || p.startsWith('/modpkg/'))
const bytesAt = (rel) => (existsSync(path(rel)) ? readFileSync(path(rel)) : null)
const same = (a, b) => a !== null && Buffer.compare(a, b) === 0
function snapshot(dir, names) {
  return Object.fromEntries(names.map((n) => [n, bytesAt(`${dir}/${n}`)?.toString('hex') ?? null]))
}
const records = () => {
  const state = JSON.parse(readFileSync(join(variantUserDataDir('populated'), 'state.json'), 'utf8'))
  return state.installations.find((i) => i.id === INSTALL_MODS_UPDATE_ID)?.moduleData?.mods?.records ?? []
}
const recordOf = (dir) => records().find((r) => r.gameDir === dir)
async function waitUntil(fn, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

export default async function modUpdate({ page, shot, step }) {
  step('open Mods of the fixture installation')
  await openMods(page, INSTALL_MODS_UPDATE_NAME)
  const status = (id) => page.getByTestId(`mods-tile-status-${id}`).first()
  await status('opentdm').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('AC1/AC2/AC6: update offered for opentdm, nothing downloaded, manual ctf untouched')
  const oldOpentdm = snapshot('opentdm', Object.keys(modsUpdateOldFiles.opentdm))
  const oldAction = snapshot('action', Object.keys(modsUpdateOldFiles.action))
  const oldActionRecord = JSON.stringify(recordOf('action'))
  check('opentdm tile shows Update available', /update available/i.test(await status('opentdm').innerText()))
  check('opentdm tile has an Update action', (await page.getByTestId('mods-update-opentdm').count()) === 1)
  await page.getByTestId('mods-tile-opentdm').click({ timeout: TIMEOUT_MS })
  const versions = page.getByTestId('mods-detail-update-versions')
  await versions.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const versionsText = await versions.innerText()
  check(
    'detail shows installed v1.0.0 and catalog v1.1.0',
    versionsText.includes('v1.0.0') && versionsText.includes('v1.1.0'),
    versionsText,
  )
  check('detail has an Update action', (await page.getByTestId('mods-detail-update-opentdm').count()) === 1)
  await shot('opentdm-update-available')
  const ctfStatus = await page.getByTestId('mods-tile-status-ctf').allInnerTexts()
  check(
    'manual ctf tile shows no Update available and no Update action',
    !ctfStatus.some((t) => /update/i.test(t)) &&
      (await page.getByTestId('mods-update-ctf').count()) === 0 &&
      (await page.getByTestId('mods-detail-update-ctf').count()) === 0,
    JSON.stringify(ctfStatus),
  )
  check(
    'opentdm bytes unchanged and no package requested before Update is clicked',
    JSON.stringify(snapshot('opentdm', Object.keys(modsUpdateOldFiles.opentdm))) === JSON.stringify(oldOpentdm) &&
      packageRequests().length === 0,
    JSON.stringify(server.requested),
  )

  step('AC3/AC4: Update opentdm (no changed files, no dialog)')
  await page.getByTestId('mods-detail-update-opentdm').click({ timeout: TIMEOUT_MS })
  const done = await waitUntil(() => existsSync(path('opentdm/new-only.txt')), JOB_TIMEOUT_MS)
  await waitUntil(() => recordOf('opentdm')?.version === 'v1.1.0', 10_000)
  check('no dialog was asked for', (await page.getByRole('dialog').count()) === 0)
  check(
    'gamedir holds the new version bytes',
    done && Object.entries(modsUpdateNewOpentdmFiles).every(([n, b]) => same(bytesAt(`opentdm/${n}`), b)),
  )
  check('old-only.txt is gone', !existsSync(path('opentdm/old-only.txt')))
  check('demos/mine.dm2 keeps its bytes', same(bytesAt(`opentdm/${MODS_UPDATE_USER_FILE}`), MODS_UPDATE_USER_BYTES))
  const rec = recordOf('opentdm')
  const recPaths = (rec?.files ?? []).map((f) => f.path).sort()
  check(
    'the record names v1.1.0 and the new files',
    rec?.version === 'v1.1.0' &&
      JSON.stringify(recPaths) === JSON.stringify(Object.keys(modsUpdateNewOpentdmFiles).sort()),
    JSON.stringify(rec),
  )
  await status('opentdm').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await waitUntil(async () => /^installed/i.test((await status('opentdm').innerText().catch(() => '')).trim()), 10_000)
  const installedText = await status('opentdm').innerText()
  check('the tile shows installed again', /^installed/i.test(installedText.trim()), installedText)
  check(
    'manual ctf folder is untouched',
    Object.entries(modsUpdateManualFiles).every(([n, b]) => same(bytesAt(`ctf/${n}`), b)),
  )
  await shot('opentdm-updated')

  step('AC5: Update action fails on the wrong SHA256')
  await page.getByTestId('mods-tile-action').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('mods-detail-update-action').click({ timeout: TIMEOUT_MS })
  // The same testid is rendered by the tile and the detail panel: scope to the panel's own root.
  const errors = page.getByTestId('mods-detail-panel').getByTestId('mods-tile-update-error-action')
  const shown = await errors
    .first()
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
    .then(
      () => true,
      () => false,
    )
  const errorText = shown ? (await errors.allInnerTexts()).join(' | ') : ''
  check('the failure reason is visible text in the detail panel', shown && errorText.trim().length > 0, errorText)
  await shot('action-update-failed')
  check(
    'action files and record are byte-identical to before',
    JSON.stringify(snapshot('action', Object.keys(modsUpdateOldFiles.action))) === JSON.stringify(oldAction) &&
      JSON.stringify(recordOf('action')) === oldActionRecord,
  )
  check('action still offers the update', (await page.getByTestId('mods-detail-update-action').count()) === 1)

  if (failures.length > 0) throw new Error(`mod-update: failed: ${failures.join('; ')}`)
}
