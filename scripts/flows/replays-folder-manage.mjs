// Acceptance flow: a folder is created in a source root and a folder holding a demo with
// a sidecar is renamed - both files move on disk, the row keeps its sidecar data and the open
// folder follows the new name. The top level and a zip show the controls disabled with a reason.
//
// Selectors (`DemoBreadcrumb.tsx`, `DemoFolderRow.tsx`, `FolderNameDialog.tsx`): `replays-folder-new`,
// `replays-folder-new-reason`, `replays-folder-rename`, `folder-name-input`, `folder-name-save`,
// `folder-name-error`, `replays-demo-rating`.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPLAYS_FOLDERS_A_DEMO,
  REPLAYS_FOLDERS_VARIANT,
  REPLAYS_FOLDERS_ZIP,
  removeReplaysFoldersFixture,
  replaysFoldersFixturePath,
  vendoredExtractorExists,
  writeReplaysFoldersFixture,
} from '../lib/fixture.mjs'
import {
  openAllDemos,
  openFolder,
  poll,
  rowFor,
  TIMEOUT_MS,
  makeExpect,
} from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_FOLDERS_VARIANT

export async function setup() {
  writeReplaysFoldersFixture()
  return {}
}

export async function teardown() {
  removeReplaysFoldersFixture()
}

const ROOT_LABEL = 'folders-demos'

const expect = makeExpect('replays-folder-manage')

function folderRowFor(page, name) {
  return page
    .getByTestId('replays-folder-row')
    .filter({ has: page.getByTestId('replays-folder-name').getByText(name, { exact: true }) })
}

async function submitName(page, name) {
  await page.getByTestId('folder-name-input').fill(name)
  await page.getByTestId('folder-name-save').click()
}

export default async function replaysFolderManage({ page, shot, step }) {
  if (!vendoredExtractorExists()) {
    throw new Error(
      'replays-folder-manage: resources/bin/7za.exe is missing - run `npm run fetch:7za`.',
    )
  }
  const root = replaysFoldersFixturePath()

  step('at the top level New folder is visible but disabled, with its reason as text')
  await openAllDemos(page)
  await page.getByTestId('replays-folder-row').first().waitFor({ timeout: TIMEOUT_MS })
  const newButton = page.getByTestId('replays-folder-new')
  expect(await newButton.isDisabled(), 'New folder should be disabled at the top level')
  const topReason = (await page.getByTestId('replays-folder-new-reason').textContent()) ?? ''
  expect(topReason.trim() === 'Open a folder first', `top-level reason was "${topReason}"`)
  expect(
    (await page.getByTestId('replays-folder-rename').count()) === 0,
    'a root folder row must not offer rename',
  )

  step('a folder is created in the root')
  await openFolder(page, ROOT_LABEL)
  await page.getByTestId('replays-folder-row').first().waitFor({ timeout: TIMEOUT_MS })
  await newButton.click()
  await page.getByTestId('folder-name-input').fill('a/b')
  await page.getByTestId('folder-name-error').waitFor({ timeout: TIMEOUT_MS })
  expect(
    await page.getByTestId('folder-name-save').isDisabled(),
    'an invalid name must block saving',
  )
  await submitName(page, 'new')
  await folderRowFor(page, 'new').waitFor({ timeout: TIMEOUT_MS })
  expect(existsSync(join(root, 'new')), 'the folder "new" was not created on disk')
  await shot('replays-folder-manage-created')

  step('renaming a folder moves its demo and sidecar and the row keeps its sidecar data')
  await openFolder(page, 'a')
  await rowFor(page, REPLAYS_FOLDERS_A_DEMO).first().waitFor({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-crumb').filter({ hasText: ROOT_LABEL }).click()
  await folderRowFor(page, 'a').getByTestId('replays-folder-rename').click()
  await submitName(page, 'alpha')
  await folderRowFor(page, 'alpha').waitFor({ timeout: TIMEOUT_MS })
  expect(!existsSync(join(root, 'a')), 'the old folder is still on disk')
  expect(existsSync(join(root, 'alpha', REPLAYS_FOLDERS_A_DEMO)), 'the demo did not move')
  expect(
    existsSync(join(root, 'alpha', `${REPLAYS_FOLDERS_A_DEMO}.json`)),
    'the sidecar did not move',
  )
  await openFolder(page, 'alpha')
  const moved = rowFor(page, REPLAYS_FOLDERS_A_DEMO).first()
  await moved.waitFor({ timeout: TIMEOUT_MS })
  const rating = (await moved.getByTestId('replays-demo-rating').textContent()) ?? ''
  expect(rating.includes('7'), `the moved row lost its sidecar rating, got "${rating}"`)
  await shot('replays-folder-manage-renamed')

  step('inside a zip both controls are disabled with the read-only reason visible')
  await page.getByTestId('replays-crumb').filter({ hasText: ROOT_LABEL }).click()
  const zipRename = folderRowFor(page, REPLAYS_FOLDERS_ZIP).getByTestId('replays-folder-rename')
  expect(await zipRename.isDisabled(), 'rename should be disabled on a zip folder row')
  await openFolder(page, REPLAYS_FOLDERS_ZIP)
  await poll('New folder to be disabled in the zip', async () => await newButton.isDisabled())
  const zipReason = (await page.getByTestId('replays-folder-new-reason').textContent()) ?? ''
  expect(zipReason.trim() === 'Archive — read-only', `zip reason was "${zipReason}"`)
}
