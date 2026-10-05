// Acceptance flow: the Demos list opens as a folder view. The top level lists only root
// folders, opening one lists its subfolders (with recursive demo counts) before its demos, a
// breadcrumb walks back up, and a zip opens as a read-only folder holding its entries.
//
// Selectors (`DemoFolderRow.tsx`, `DemoBreadcrumb.tsx`, `ReplaysView.tsx`): `replays-folder-row`,
// `replays-folder-name`, `replays-folder-count`, `replays-folder-archive`, `replays-breadcrumb`,
// `replays-crumb`, `replays-demo-row`.
import {
  REPLAYS_FOLDERS_A_DEMO,
  REPLAYS_FOLDERS_C_DEMO,
  REPLAYS_FOLDERS_ROOT_DEMO,
  REPLAYS_FOLDERS_VARIANT,
  REPLAYS_FOLDERS_ZIP,
  REPLAYS_FOLDERS_ZIP_ENTRIES,
  removeReplaysFoldersFixture,
  vendoredExtractorExists,
  writeReplaysFoldersFixture,
} from '../lib/fixture.mjs'
import { openAllDemos, openFolder, poll, rowFor, TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_FOLDERS_VARIANT

export async function setup() {
  writeReplaysFoldersFixture()
  return {}
}

export async function teardown() {
  removeReplaysFoldersFixture()
}

const ROOT_LABEL = 'folders-demos'

function expect(cond, message) {
  if (!cond) throw new Error(`replays-folders: ${message}`)
}

async function folderNames(page) {
  return page.getByTestId('replays-folder-name').allTextContents()
}

async function crumbTexts(page) {
  return (await page.getByTestId('replays-crumb').allTextContents()).map((t) => t.trim())
}

async function waitForDemoRow(page, text) {
  await rowFor(page, text).first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

async function folderRowFor(page, name) {
  return page
    .getByTestId('replays-folder-row')
    .filter({ has: page.getByTestId('replays-folder-name').getByText(name, { exact: true }) })
}

export default async function replaysFolders({ page, shot, step }) {
  if (!vendoredExtractorExists()) {
    throw new Error('replays-folders: resources/bin/7za.exe is missing - run `npm run fetch:7za`.')
  }

  step('the top level lists only root folders, never a demo row')
  await openAllDemos(page)
  await page.getByTestId('replays-folder-row').first().waitFor({ timeout: TIMEOUT_MS })
  const roots = await folderNames(page)
  expect(
    roots.length === 1 && roots[0].includes(ROOT_LABEL),
    `top level should show exactly the one root "${ROOT_LABEL}", got ${JSON.stringify(roots)}`,
  )
  expect((await page.getByTestId('replays-demo-row').count()) === 0, 'top level shows demo rows')
  expect((await page.getByTestId('replays-breadcrumb').count()) === 0, 'top level has a breadcrumb')

  step('opening the root lists its subfolders with counts before its demos')
  await openFolder(page, ROOT_LABEL)
  await waitForDemoRow(page, REPLAYS_FOLDERS_ROOT_DEMO)
  const aRow = await folderRowFor(page, 'a')
  expect((await aRow.count()) === 1, 'folder "a" is missing in the root')
  const aCount = await aRow.getByTestId('replays-folder-count').textContent()
  expect(/\b2\b/.test(aCount ?? ''), `folder "a" should count its 2 nested demos, got "${aCount}"`)
  const zipRow = await folderRowFor(page, REPLAYS_FOLDERS_ZIP)
  expect((await zipRow.count()) === 1, 'the zip does not show as a folder row')
  const folderBeforeDemo = await page.evaluate(() => {
    const folder = document.querySelector('[data-testid="replays-folder-row"]')
    const demo = document.querySelector('[data-testid="replays-demo-row"]')
    return Boolean(
      folder && demo && folder.compareDocumentPosition(demo) & Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
  expect(folderBeforeDemo, 'folders must be listed before demos')
  expect(
    (await rowFor(page, REPLAYS_FOLDERS_A_DEMO).count()) === 0,
    'a nested demo leaked into the root listing',
  )
  await shot('replays-folders-root')

  step('opening a, b, c reaches the deep demo')
  await openFolder(page, 'a')
  await waitForDemoRow(page, REPLAYS_FOLDERS_A_DEMO)
  await openFolder(page, 'b')
  await openFolder(page, 'c')
  await waitForDemoRow(page, REPLAYS_FOLDERS_C_DEMO)
  const deepCrumbs = await crumbTexts(page)
  expect(
    deepCrumbs.length === 5 && deepCrumbs.slice(-3).join('/') === 'a/b/c',
    `breadcrumb should end a/b/c, got ${JSON.stringify(deepCrumbs)}`,
  )
  const lastCurrent = await page.getByTestId('replays-crumb').last().getAttribute('aria-current')
  expect(lastCurrent === 'page', 'the last crumb must be aria-current="page"')
  await shot('replays-folders-deep')

  step('each crumb returns to its level')
  await page.getByTestId('replays-crumb').filter({ hasText: /^b$/ }).click()
  await poll('the breadcrumb to end at b', async () => (await crumbTexts(page)).at(-1) === 'b')
  expect((await folderNames(page)).includes('c'), 'level b should list folder c')
  expect((await rowFor(page, REPLAYS_FOLDERS_C_DEMO).count()) === 0, 'b shows the demo from c')
  await page.getByTestId('replays-crumb').filter({ hasText: /^a$/ }).click()
  await waitForDemoRow(page, REPLAYS_FOLDERS_A_DEMO)
  await page.getByTestId('replays-crumb').filter({ hasText: ROOT_LABEL }).click()
  await waitForDemoRow(page, REPLAYS_FOLDERS_ROOT_DEMO)
  await page.getByTestId('replays-crumb').first().click()
  await poll(
    'the top level to show only roots',
    async () =>
      (await page.getByTestId('replays-breadcrumb').count()) === 0 &&
      (await page.getByTestId('replays-demo-row').count()) === 0,
  )

  step('a zip is a read-only folder row and opens onto its entries')
  await openFolder(page, ROOT_LABEL)
  const zip = await folderRowFor(page, REPLAYS_FOLDERS_ZIP)
  const marker = (await zip.getByTestId('replays-folder-archive').textContent()) ?? ''
  expect(marker.trim() === 'Archive — read-only', `zip row marker was "${marker}"`)
  expect(
    (await aRow.getByTestId('replays-folder-archive').count()) === 0,
    'a plain folder must not carry the archive marker',
  )
  await openFolder(page, REPLAYS_FOLDERS_ZIP)
  for (const entry of REPLAYS_FOLDERS_ZIP_ENTRIES) await waitForDemoRow(page, entry)
  await shot('replays-folders-zip')
}
