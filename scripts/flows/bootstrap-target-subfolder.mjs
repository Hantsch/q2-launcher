// Story 240: the target step proposes a subfolder of the picked location and shows the final path.
// Runs the real job offline (loopback fixture server, existing-folder data source, no downloads of
// game data) like `bootstrap-existing-folder.mjs`.
//
// Picker queue (Q2L_UI_PICK_FOLDER, call order): the game-data source, an EMPTY directory, then a
// parent that already holds a non-empty `<name>` subfolder.
import { existsSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import {
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeBootstrapExistingFolderSource,
  writeBootstrapSubfolderDirs,
  writePopulatedFixture,
} from '../lib/fixture.mjs'
import { openLibraryAddEntry } from '../lib/flow-common.mjs'

const TIMEOUT_MS = 8_000
const JOB_TIMEOUT_MS = 90_000

/** An existing-folder run's default installation name is the engine label, and the default
 * subfolder follows it. */
const INSTALLATION_NAME = 'Q2PRO'

let server = null
let dirs = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error('resources/bin/7za.exe is missing - run `npm run fetch:7za` first.')
  }
  writePopulatedFixture()
  const sourceRoot = writeBootstrapExistingFolderSource({ retail: true })
  dirs = writeBootstrapSubfolderDirs(INSTALLATION_NAME)
  server = await startBootstrapFixtureServer()
  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      Q2L_UI_PICK_FOLDER: [sourceRoot, dirs.empty, dirs.parent].join(delimiter),
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

export default async function bootstrapTargetSubfolder({ page, shot, step }) {
  const next = page.getByRole('button', { name: 'Next' })
  const finalPath = page.getByTestId('bootstrap-target-final-path')
  const expectFinalPath = async (expected, what) => {
    try {
      await page.waitForFunction(
        (expectedPath) =>
          document
            .querySelector('[data-testid="bootstrap-target-final-path"]')
            ?.textContent?.trim() === expectedPath,
        expected,
        { timeout: TIMEOUT_MS },
      )
    } catch {
      throw new Error(
        `${what}: expected the final path ${JSON.stringify(expected)}, got ${JSON.stringify(
          await finalPath.innerText(),
        )}`,
      )
    }
  }
  const browseTarget = () =>
    page
      .getByTestId('bootstrap-target-path-input')
      .getByRole('button', { name: 'Browse…' })
      .click({ timeout: TIMEOUT_MS })

  step('walk to the game-data step and pick the existing-folder source')
  await openLibraryAddEntry(page, 'New installation…')
  await page
    .getByTestId('bootstrap-engine-q2pro')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await next.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('bootstrap-gamedata-choice-existing-folder').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-gamedata-folder-path')
    .getByRole('button', { name: 'Browse…' })
    .click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-gamedata-folder-verdict-retail')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await next.click({ timeout: TIMEOUT_MS })

  step('an empty folder is installed into directly')
  await browseTarget()
  await expectFinalPath(dirs.empty, 'empty folder')
  await page
    .getByTestId('bootstrap-target-install-here')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (await page.getByTestId('bootstrap-target-folder-name').count()) {
    throw new Error('the folder-name field is shown although the empty folder is used as is')
  }
  await shot('target-install-here')

  step('a parent holding a non-empty same-named folder gets a numbered subfolder')
  await browseTarget()
  const subfolder = join(dirs.parent, `${INSTALLATION_NAME} (2)`)
  await expectFinalPath(subfolder, 'parent with occupied name')
  if (await page.getByTestId('bootstrap-target-install-here').count()) {
    throw new Error('the install-here sentence is shown for a parent that needs a subfolder')
  }
  await shot('target-subfolder-proposed')

  step('editing the folder name moves the final path')
  const nameInput = page.getByTestId('bootstrap-target-folder-name')
  await nameInput.fill('My Quake', { timeout: TIMEOUT_MS })
  await expectFinalPath(join(dirs.parent, 'My Quake'), 'edited folder name')
  await nameInput.fill(`${INSTALLATION_NAME} (2)`)
  await expectFinalPath(subfolder, 'restored folder name')
  if (existsSync(subfolder)) {
    throw new Error(`${subfolder} exists before Start - the proposal must not create it`)
  }
  await next.click({ timeout: TIMEOUT_MS })

  step('the confirm step states the same final path')
  const confirmTarget = page.getByTestId('bootstrap-confirm-target-path')
  await confirmTarget.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const confirmText = (await confirmTarget.innerText()).trim()
  if (confirmText !== subfolder) {
    throw new Error(
      `expected the confirm step to state ${JSON.stringify(subfolder)}, got ${JSON.stringify(confirmText)}`,
    )
  }
  await shot('confirm-step')

  step('start the job; the subfolder appears and holds baseq2')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  if (!existsSync(join(subfolder, 'baseq2'))) {
    throw new Error(
      `expected ${join(subfolder, 'baseq2')} after the job, found ${JSON.stringify(
        existsSync(subfolder) ? readdirSync(subfolder) : null,
      )}`,
    )
  }
  await shot('running-step-succeeded')
}
