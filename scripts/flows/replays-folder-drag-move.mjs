// Acceptance flow: a demo is dragged onto a folder row and onto a breadcrumb crumb and
// lands there on disk with its sidecar; dropping onto a folder that already holds a file of the
// same name reports the clash as a toast and leaves the target file as it was.
//
// Low-level `page.mouse` moves, not `dragTo()`: dnd-kit's pointer sensor needs a move past its 8px
// activation distance and intermediate moves for the drop target to register (as in
// `controls-drag-reorder.mjs`).
//
// Selectors (`DemoRow.tsx`, `DemoFolderRow.tsx`, `DemoBreadcrumb.tsx`): `replays-demo-row`,
// `replays-folder-row`, `replays-crumb`, `[role="status"]` for the toast.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPLAYS_FOLDERS_A_DEMO,
  REPLAYS_FOLDERS_ROOT_DEMO,
  REPLAYS_FOLDERS_VARIANT,
  removeReplaysFoldersFixture,
  replaysFoldersFixturePath,
  writeReplaysFoldersFixture,
} from '../lib/fixture.mjs'
import { openAllDemos, openFolder, poll, rowFor, TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_FOLDERS_VARIANT

const CLASH_BYTES = 'not a real demo - the clashing file in folder a\n'

export async function setup() {
  writeReplaysFoldersFixture()
  writeFileSync(
    join(replaysFoldersFixturePath(), 'a', REPLAYS_FOLDERS_ROOT_DEMO),
    CLASH_BYTES,
    'utf8',
  )
  return {}
}

export async function teardown() {
  removeReplaysFoldersFixture()
}

const ROOT_LABEL = 'folders-demos'

function expect(cond, message) {
  if (!cond) throw new Error(`replays-folder-drag-move: ${message}`)
}

function folderRowFor(page, name) {
  return page
    .getByTestId('replays-folder-row')
    .filter({ has: page.getByTestId('replays-folder-name').getByText(name, { exact: true }) })
}

async function realDrag(page, from, to) {
  const fromBox = await from.boundingBox()
  const toBox = await to.boundingBox()
  expect(fromBox !== null && toBox !== null, 'drag source or target is not rendered')
  const startX = fromBox.x + fromBox.width / 2
  const startY = fromBox.y + fromBox.height / 2
  const endX = toBox.x + toBox.width / 2
  const endY = toBox.y + toBox.height / 2
  const distance = Math.hypot(endX - startX, endY - startY) || 1
  const firstX = startX + ((endX - startX) / distance) * 16
  const firstY = startY + ((endY - startY) / distance) * 16

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(firstX, firstY, { steps: 5 })
  await page.waitForTimeout(50)
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(
      firstX + ((endX - firstX) * i) / 10,
      firstY + ((endY - firstY) * i) / 10,
      {
        steps: 3,
      },
    )
    await page.waitForTimeout(30)
  }
  await page.mouse.move(endX, endY, { steps: 5 })
  await page.waitForTimeout(200)
  return async () => {
    await page.mouse.up()
    await page.waitForTimeout(300)
  }
}

export default async function replaysFolderDragMove({ page, shot, step }) {
  const root = replaysFoldersFixturePath()
  const crumbRoot = () => page.getByTestId('replays-crumb').filter({ hasText: ROOT_LABEL })

  step('dragging a demo onto a breadcrumb crumb moves it and its sidecar there')
  await openAllDemos(page)
  await page.getByTestId('replays-folder-row').first().waitFor({ timeout: TIMEOUT_MS })
  await openFolder(page, ROOT_LABEL)
  await openFolder(page, 'a')
  const row = rowFor(page, REPLAYS_FOLDERS_A_DEMO).first()
  await row.waitFor({ timeout: TIMEOUT_MS })
  const release = await realDrag(page, row, crumbRoot())
  expect(
    (await crumbRoot().getAttribute('data-drop-over')) === 'true',
    'the crumb shows no drop highlight while hovered',
  )
  expect(
    (await crumbRoot().textContent())?.includes('Move here') === true,
    'the drop highlight is colour-only, no text',
  )
  await shot('replays-folder-drag-move-over-crumb')
  await release()
  await poll(
    'the demo to leave the folder',
    async () => (await rowFor(page, REPLAYS_FOLDERS_A_DEMO).count()) === 0,
  )
  expect(existsSync(join(root, REPLAYS_FOLDERS_A_DEMO)), 'the demo did not land in the root')
  expect(existsSync(join(root, `${REPLAYS_FOLDERS_A_DEMO}.json`)), 'the sidecar did not move')
  expect(!existsSync(join(root, 'a', REPLAYS_FOLDERS_A_DEMO)), 'the demo is still in folder a')

  step('dropping on a folder that holds a same-named file reports the clash and changes nothing')
  await crumbRoot().click()
  const rootDemo = rowFor(page, REPLAYS_FOLDERS_ROOT_DEMO).first()
  await rootDemo.waitFor({ timeout: TIMEOUT_MS })
  const finish = await realDrag(page, rootDemo, folderRowFor(page, 'a'))
  expect(
    (await page.getByTestId('replays-folder-drop-hint').count()) === 1,
    'the folder row shows no "Move here" text while hovered',
  )
  await finish()
  await page
    .locator('[role="status"]')
    .filter({ hasText: 'already exists' })
    .first()
    .waitFor({ timeout: TIMEOUT_MS })
  expect(
    readFileSync(join(root, 'a', REPLAYS_FOLDERS_ROOT_DEMO), 'utf8') === CLASH_BYTES,
    'the target file was changed',
  )
  expect(existsSync(join(root, REPLAYS_FOLDERS_ROOT_DEMO)), 'the source demo left the root')
  await shot('replays-folder-drag-move-clash')

  step('dragging a demo onto a folder row moves it and its sidecar into that folder')
  const moving = rowFor(page, REPLAYS_FOLDERS_A_DEMO).first()
  await moving.waitFor({ timeout: TIMEOUT_MS })
  const done = await realDrag(page, moving, folderRowFor(page, 'a'))
  await done()
  await poll(
    'the demo to leave the root',
    async () => (await rowFor(page, REPLAYS_FOLDERS_A_DEMO).count()) === 0,
  )
  expect(existsSync(join(root, 'a', REPLAYS_FOLDERS_A_DEMO)), 'the demo did not land in folder a')
  expect(existsSync(join(root, 'a', `${REPLAYS_FOLDERS_A_DEMO}.json`)), 'the sidecar did not move')
}
