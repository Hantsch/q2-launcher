// Story 239: every way to add an installation is the same menu - three entries, no "create" or
// "empty" wording - and "New installation…" is the one wizard, from the rail and from the Library,
// ending in a named, playable installation. Runs the REAL bootstrap job against the loopback
// fixture server, so it reseeds `populated` and recreates its target like `bootstrap-wizard.mjs`.
import { dirname } from 'node:path'
import {
  bootstrapTargetDir,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeBootstrapTargetDir,
  writePopulatedFixture,
} from '../lib/fixture.mjs'
import { libraryCard } from '../lib/flow-common.mjs'

const TIMEOUT_MS = 8_000
const JOB_TIMEOUT_MS = 90_000
const EXPECTED_LABELS = ['Add existing installation…', 'Search this PC…', 'New installation…']
const NAME = 'One Flow Quake'

let server = null

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'resources/bin/7za.exe is missing - this flow runs the REAL extractor. Run `npm run fetch:7za` first.',
    )
  }
  writePopulatedFixture()
  const targetPath = writeBootstrapTargetDir()
  server = await startBootstrapFixtureServer()
  return {
    env: {
      Q2L_UI_CONTENT_REPO_BASE: server.baseUrl,
      Q2L_UI_PICK_FOLDER: dirname(targetPath),
    },
  }
}

export async function teardown() {
  if (server) {
    await server.close()
    server = null
  }
}

/** First line of each menuitem is its label, the rest its hint. */
async function readMenu(page) {
  const items = page.getByRole('menuitem')
  await items.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const texts = await items.allInnerTexts()
  return texts.map((text) => {
    const [label, ...hint] = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return { label, hint: hint.join(' ') }
  })
}

function assertMenu(where, entries) {
  const labels = entries.map((entry) => entry.label)
  if (JSON.stringify(labels) !== JSON.stringify(EXPECTED_LABELS)) {
    throw new Error(`${where} menu labels were ${JSON.stringify(labels)}`)
  }
  for (const entry of entries) {
    if (!entry.hint) throw new Error(`${where} menu entry "${entry.label}" has no hint`)
    if (/create|empty/i.test(`${entry.label} ${entry.hint}`)) {
      throw new Error(`${where} menu entry "${entry.label}" mentions create/empty`)
    }
  }
}

export default async function addInstallationOneFlow({ page, shot, step }) {
  const railAdd = () => page.locator('aside').getByRole('button', { name: 'Add an installation' })
  const newEntry = () => page.getByRole('menuitem', { name: /^New installation…/ })
  const dialog = page.getByRole('dialog', { name: 'New installation' })

  step('read the rail menu and the Library menu and compare them')
  await railAdd().click({ timeout: TIMEOUT_MS })
  const railEntries = await readMenu(page)
  assertMenu('rail', railEntries)
  await shot('rail-menu')
  await page.keyboard.press('Escape')

  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-add').click({ timeout: TIMEOUT_MS })
  const libraryEntries = await readMenu(page)
  assertMenu('library', libraryEntries)
  if (JSON.stringify(railEntries) !== JSON.stringify(libraryEntries)) {
    throw new Error('the rail and Library menus differ')
  }
  await shot('library-menu')
  await page.keyboard.press('Escape')

  for (const origin of ['rail', 'library']) {
    step(`"New installation…" from the ${origin} opens the wizard`)
    if (origin === 'rail') {
      await railAdd().click({ timeout: TIMEOUT_MS })
    } else {
      await page.getByTestId('library-add').click({ timeout: TIMEOUT_MS })
    }
    await newEntry().click({ timeout: TIMEOUT_MS })
    await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    await page
      .locator('[data-testid^="bootstrap-engine-"]')
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    if (origin === 'rail') {
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT_MS })
    }
  }

  step('walk engine, free download and target; name the installation')
  const next = page.getByRole('button', { name: 'Next' })
  await next.click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('bootstrap-gamedata-choice-free-download')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await next.click({ timeout: TIMEOUT_MS })

  const nameInput = page.getByTestId('bootstrap-name-input')
  await nameInput.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const defaultName = await nameInput.inputValue()
  if (defaultName !== 'Q2PRO Demo') {
    throw new Error(`expected the default name "Q2PRO Demo", got ${JSON.stringify(defaultName)}`)
  }
  await nameInput.fill(NAME)
  await page
    .getByTestId('bootstrap-target-path-input')
    .getByRole('button', { name: 'Browse…' })
    .click({ timeout: TIMEOUT_MS })
  // The picked location is only the parent: the wizard proposes a new subfolder inside it and
  // shows the final path before anything is installed.
  const parentDir = dirname(bootstrapTargetDir())
  const finalPath = page.getByTestId('bootstrap-target-final-path')
  await finalPath.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (picked) => {
      const text = document
        .querySelector('[data-testid="bootstrap-target-final-path"]')
        ?.textContent?.trim()
      return Boolean(text) && text !== picked && text.startsWith(picked)
    },
    parentDir,
    { timeout: TIMEOUT_MS },
  )
  const shownPath = await page
    .getByTestId('bootstrap-target-path-input')
    .locator('input')
    .inputValue()
  if (shownPath !== parentDir) throw new Error(`target field shows ${shownPath}`)
  await shot('target-step')
  await next.click({ timeout: TIMEOUT_MS })

  step('start the job and wait for it to succeed')
  await page.getByTestId('bootstrap-confirm-start').click({ timeout: TIMEOUT_MS })
  await page
    .locator('[data-testid="bootstrap-running-step"][data-status="succeeded"]')
    .waitFor({ state: 'visible', timeout: JOB_TIMEOUT_MS })
  await page.getByTestId('bootstrap-running-dismiss').click({ timeout: TIMEOUT_MS })

  step('the Library holds the named installation with Play enabled')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  const card = libraryCard(page, NAME)
  await card.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const play = card.getByRole('button', { name: /^Play/ })
  if (!(await play.isEnabled())) throw new Error(`Play is disabled on the "${NAME}" card`)
  await shot('named-installation')

  console.log(`add installation: one menu, one wizard, "${NAME}" is playable`)
}
