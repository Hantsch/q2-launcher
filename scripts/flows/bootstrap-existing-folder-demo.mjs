// Story 089 (docs/requirements/089-wizard-gains-an-existing-folder-data-source.md) D5: the two
// "this is a reason, not a failure" halves of the existing-folder data source that
// `bootstrap-existing-folder.mjs` (D4) deliberately leaves out - a demo-only folder (AC4) and an
// unusable one (AC5). Same offline harness shape as that flow: a `127.0.0.1` fixture server, no
// outbound network access, `Q2L_UI_PICK_FOLDER` stubbing the native folder dialog.
//
// Covers, in one app session:
//   AC4 - a folder with a demo-sized pak0.pak (no valid retail pair) reports a `kind: 'demo'`
//         verdict, Next stays enabled, and the finished installation carries the same Demo marker
//         the free-download path gets (`isDemoData()`, read off `validation.pak0NotRetail`).
//   AC5 - a folder with no `baseq2` at all reports a `kind: 'unusable'` verdict naming the reason,
//         and Next/Browse never lets the user past the game-data step - no installation or job is
//         ever created for it.
//
// ## How this run is offline
//
// Same two harness-only overrides `bootstrap-existing-folder.mjs` uses, both gated on
// `Q2L_UI_HARNESS === '1' && isDev` (`src/main/lib/ui-harness.ts`):
//   Q2L_UI_CONTENT_REPO_BASE  the manifest/package base URL, refused unless it names a `127.0.0.1`
//                             origin.
//   Q2L_UI_PICK_FOLDER        the folders `installations:pickFolder` answers with instead of
//                             opening a native OS dialog, in call order. Three browses happen in
//                             this flow: pass 1's game-data browse (the demo fixture folder), pass
//                             1's target browse (the fixture target), and pass 2's game-data browse
//                             (the SAME fixture folder path, rewritten to `kind: 'unusable'`
//                             in-place right before that pass) - so the stub list is
//                             `[sourceRoot, targetPath, sourceRoot]`.
// Also forces `Q2L_UI_HARNESS_STORE_SOURCES` to `'[]'`, same as `bootstrap-existing-folder.mjs`,
// so a dev/CI box's real Steam/GOG detection can never change what either pass proves.
//
// ## Selectors, not guesses
//
// Everything `bootstrap-existing-folder.mjs`'s own selector table already lists, plus:
//   demo-badge / installation-tile-demo-tag        components/ui/DemoBadge.tsx, InstallationTile.tsx
//   bootstrap-gamedata-folder-verdict-unusable      modules/downloads/bootstrap/GameDataStep.tsx
import { delimiter } from 'node:path'
import {
  bootstrapExistingFolderSourceDir,
  bootstrapExistingFolderTargetDir,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeBootstrapExistingFolderSource,
  writeBootstrapExistingFolderTargetDir,
  writeBootstrapExistingFolderUnusableSource,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000
/** Pass 1 runs a real engine download + extraction + folder copy, same budget
 * `bootstrap-existing-folder.mjs` gives its own (single) job. */
const JOB_TIMEOUT_MS = 90_000

/** Story 089 D3: an `'existing-folder'` run is never named `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` -
 * it falls back to the engine's own product label (`engineLabel`) regardless of whether the
 * folder's verdict is retail or demo, because the name comes from the wizard's data source, not
 * from what the copy turns out to contain. Same convention `bootstrap-existing-folder.mjs` uses. */
const INSTALLATION_NAME = 'Q2PRO'

const UNUSABLE_REASON_TEXT =
  'This folder has no baseq2 directory, so no game data could be found in it.'

/** Module-scoped, because `setup()` starts/writes them and the flow body needs them back. */
let server = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - pass 1 of this flow runs the REAL extractor against a ' +
        'real archive and will not pretend otherwise. Run `npm run fetch:7za` first.',
    )
  }

  writePopulatedFixture()
  const targetPath = writeBootstrapExistingFolderTargetDir()
  const sourceRoot = writeBootstrapExistingFolderSource({ retail: false })
  server = await startBootstrapFixtureServer()

  console.log(`  fixture server: ${server.baseUrl}`)
  console.log(`  fixture target: ${targetPath}`)
  console.log(`  fixture existing-folder source (demo-shaped): ${sourceRoot}`)

  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      // In call order: pass 1's game-data browse (demo source), pass 1's target browse, pass 2's
      // game-data browse (the same source path, rewritten to unusable just before that pass runs).
      Q2L_UI_PICK_FOLDER: [sourceRoot, targetPath, sourceRoot].join(delimiter),
      Q2L_UI_HARNESS_STORE_SOURCES: '[]',
    },
  }
}

export async function teardown() {
  if (server) {
    await server.close()
    server = null
  }
}

export default async function bootstrapExistingFolderDemo({ page, shot, step }) {
  const targetPath = bootstrapExistingFolderTargetDir()
  const sourcePath = bootstrapExistingFolderSourceDir()

  // ================================================================================================
  // Pass 1 (AC4): a demo-shaped folder installs fine and carries the Demo marker
  // ================================================================================================
  step('open the wizard and choose "point at an existing folder" (pass 1)')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-engine-q2pro')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })

  const existingFolderChoice = page.getByTestId('bootstrap-gamedata-choice-existing-folder')
  await existingFolderChoice.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await existingFolderChoice.click({ timeout: TIMEOUT_MS })

  step('browse for the demo-shaped fixture source and assert the demo verdict (AC4)')
  await page
    .getByTestId('bootstrap-gamedata-folder-path')
    .getByRole('button', { name: 'Browse…' })
    .click({ timeout: TIMEOUT_MS })

  const demoVerdict = page.getByTestId('bootstrap-gamedata-folder-verdict-demo')
  await demoVerdict.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const demoVerdictText = await demoVerdict.innerText()
  if (!demoVerdictText.toLowerCase().includes('demo')) {
    throw new Error(
      `expected the demo verdict to say this is demo-equivalent data, got: ${JSON.stringify(demoVerdictText)} (AC4)`,
    )
  }
  const next = page.getByRole('button', { name: 'Next' })
  if (!(await next.isEnabled())) {
    throw new Error('Next stayed disabled after a demo verdict resolved - AC4 says this proceeds')
  }
  await shot('gamedata-step-existing-folder-demo-verdict')
  await next.click({ timeout: TIMEOUT_MS })

  step('target step: pick the fresh fixture target (pass 1)')
  await page
    .getByTestId('bootstrap-target-path-input')
    .getByRole('button', { name: 'Browse…' })
    .click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (expected) => {
      const input = document.querySelector('[data-testid="bootstrap-target-path-input"] input')
      return input && input.value === expected
    },
    targetPath,
    { timeout: TIMEOUT_MS },
  )
  for (const testId of [
    'bootstrap-target-programfiles-acknowledge',
    'bootstrap-target-notwritable-acknowledge',
    'bootstrap-target-nonempty-acknowledge',
  ]) {
    const acknowledge = page.getByTestId(testId)
    if (await acknowledge.count()) {
      await acknowledge.locator('label').click({ timeout: TIMEOUT_MS })
    }
  }
  if (await page.getByTestId('bootstrap-target-blocked').count()) {
    throw new Error('the existing-folder-demo fixture target was reported as blocked, not a clean pick')
  }
  await next.click({ timeout: TIMEOUT_MS })

  step('confirm step: assert the folder source line and engine-only download (AC4/AC6)')
  const totalSize = page.getByTestId('bootstrap-confirm-total-size')
  await totalSize.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const enginePackage = server.packages.find((pkg) => pkg.role === 'engine')
  const copySourceLine = page.getByTestId('bootstrap-confirm-copy-source')
  await copySourceLine.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const copySourceText = await copySourceLine.innerText()
  if (!copySourceText.includes(sourcePath)) {
    throw new Error(
      `expected the confirm step's copy-source line to name ${JSON.stringify(sourcePath)}, got: ` +
        JSON.stringify(copySourceText),
    )
  }
  const confirmBody = await page.getByRole('dialog').innerText()
  if (!confirmBody.includes(enginePackage.id)) {
    throw new Error(`expected the confirm step to name the engine package ${enginePackage.id}`)
  }
  if (await page.getByTestId('bootstrap-confirm-include-extras-disabled').count()) {
    throw new Error(
      'the video/players toggle rendered a disabled reason for an existing-folder run - it must ' +
        'be hidden outright (Decisions: "no video/players toggle for this source")',
    )
  }
  await shot('confirm-step-demo-source')

  step('start the job and wait for it to succeed (pass 1)')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-running-step')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await shot('running-step-succeeded-demo')

  step('dismiss the wizard and activate the new installation')
  await page.getByTestId('bootstrap-running-dismiss').click({ timeout: TIMEOUT_MS })
  const activated = await page.evaluate(async (name) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const installations = await window.q2.invoke('installations:list')
      const created = installations.find((installation) => installation.name === name)
      if (created) {
        await window.q2.invoke('installations:setActive', created.id)
        return { id: created.id, status: created.status }
      }
      await new Promise((done) => setTimeout(done, 20))
    }
    return null
  }, INSTALLATION_NAME)
  if (!activated) {
    throw new Error(`no installation named "${INSTALLATION_NAME}" was registered (AC4)`)
  }
  console.log(`AC4: installation "${INSTALLATION_NAME}" registered with status ${activated.status}`)

  step('assert the Demo marker on tile, card and action bar (AC4)')
  await page.getByTestId('actionbar-play').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const actionBarBadge = page.locator('footer [data-testid="demo-badge"]')
  await actionBarBadge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const cardBadgePresent = await page.evaluate((name) => {
    const heading = [...document.querySelectorAll('h2')].find(
      (element) => element.textContent?.trim() === name,
    )
    if (!heading?.parentElement) return false
    return heading.parentElement.querySelector('[data-testid="demo-badge"]') !== null
  }, INSTALLATION_NAME)
  if (!cardBadgePresent) {
    throw new Error(`no Demo badge next to the "${INSTALLATION_NAME}" library card heading (AC4)`)
  }
  const tileTagCount = await page.getByTestId('installation-tile-demo-tag').count()
  if (tileTagCount === 0) {
    throw new Error('no DEMO microtag rendered on any installation tile (AC4)')
  }
  await shot('existing-folder-demo-installation')

  const installationsAfterPass1 = await page.evaluate(() => window.q2.invoke('installations:list'))
  const jobsAfterPass1 = await page.evaluate(() => window.q2.invoke('jobs:list'))

  console.log(
    'AC4: a demo-shaped existing folder installed successfully and carries the same Demo marker ' +
      'the free-download path gets',
  )

  // ================================================================================================
  // Pass 2 (AC5): an unusable folder names the reason and blocks Next, creating nothing
  // ================================================================================================
  step('rewrite the same fixture folder as unusable, in place')
  writeBootstrapExistingFolderUnusableSource()

  step('open the wizard again and choose "point at an existing folder" (pass 2)')
  await page.getByTestId('library-download-install').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-engine-q2pro')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'Next' }).click({ timeout: TIMEOUT_MS })

  const existingFolderChoice2 = page.getByTestId('bootstrap-gamedata-choice-existing-folder')
  await existingFolderChoice2.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await existingFolderChoice2.click({ timeout: TIMEOUT_MS })

  step('browse for the now-unusable fixture folder and assert the reason (AC5)')
  await page
    .getByTestId('bootstrap-gamedata-folder-path')
    .getByRole('button', { name: 'Browse…' })
    .click({ timeout: TIMEOUT_MS })

  const unusableVerdict = page.getByTestId('bootstrap-gamedata-folder-verdict-unusable')
  await unusableVerdict.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const unusableVerdictText = await unusableVerdict.innerText()
  if (!unusableVerdictText.includes(UNUSABLE_REASON_TEXT)) {
    throw new Error(
      `expected the unusable verdict to name the reason ${JSON.stringify(UNUSABLE_REASON_TEXT)}, ` +
        `got: ${JSON.stringify(unusableVerdictText)} (AC5)`,
    )
  }
  await shot('gamedata-step-existing-folder-unusable-verdict')

  const nextAfterUnusable = page.getByRole('button', { name: 'Next' })
  if (await nextAfterUnusable.isEnabled()) {
    throw new Error('Next was enabled for an unusable folder verdict - AC5 says it must stay blocked')
  }

  step('close the wizard without proceeding, and assert nothing was created (AC5)')
  await page.keyboard.press('Escape')
  await page.getByTestId('nav-library').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const installationsAfterPass2 = await page.evaluate(() => window.q2.invoke('installations:list'))
  const jobsAfterPass2 = await page.evaluate(() => window.q2.invoke('jobs:list'))
  if (installationsAfterPass2.length !== installationsAfterPass1.length) {
    throw new Error(
      `expected no new installation from the unusable pass; had ${installationsAfterPass1.length}, ` +
        `now ${installationsAfterPass2.length} (AC5)`,
    )
  }
  if (jobsAfterPass2.length !== jobsAfterPass1.length) {
    throw new Error(
      `expected no new job from the unusable pass; had ${jobsAfterPass1.length}, now ` +
        `${jobsAfterPass2.length} (AC5)`,
    )
  }

  console.log(
    'AC5: an unusable existing folder named its rejection reason, kept Next disabled, and left no ' +
      'installation or job behind',
  )

  console.log(
    'bootstrap existing-folder-demo: a demo-shaped folder installed with the Demo marker intact, ' +
      'and an unusable folder was rejected with a reason before anything was created',
  )
}
