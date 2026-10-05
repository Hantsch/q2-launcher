// Acceptance flow: a search lists matches from every folder below the open one, flat and
// each with its folder path; clearing it returns to the folder view.
//
// Selectors (`DemoRow.tsx`, `ReplaysView.tsx`): `replays-filter-search`, `replays-demo-row`,
// `replays-demo-source`, `replays-folder-row`, `replays-crumb`.
import {
  REPLAYS_FOLDERS_A_DEMO,
  REPLAYS_FOLDERS_C_DEMO,
  REPLAYS_FOLDERS_ROOT_DEMO,
  REPLAYS_FOLDERS_VARIANT,
  removeReplaysFoldersFixture,
  writeReplaysFoldersFixture,
} from '../lib/fixture.mjs'
import { openDemos, openFolder, poll, rowFor, TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

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
  if (!cond) throw new Error(`replays-folders-search: ${message}`)
}

async function search(page, term) {
  await page.getByTestId('replays-filter-search').fill(term)
}

async function listedNames(page) {
  return page
    .getByTestId('replays-demo-row')
    .evaluateAll((rows) => rows.map((row) => row.textContent ?? ''))
}

async function waitForListed(page, present, absent) {
  await poll(
    `the list to hold ${JSON.stringify(present)} and not ${JSON.stringify(absent)}`,
    async () => {
      const texts = await listedNames(page)
      return (
        present.every((name) => texts.some((t) => t.includes(name))) &&
        absent.every((name) => !texts.some((t) => t.includes(name)))
      )
    },
    TIMEOUT_MS,
  )
}

export default async function replaysFoldersSearch({ page, shot, step }) {
  step('at the top level a search lists matches from nested folders with their folder')
  await openDemos(page)
  await page.getByTestId('replays-folder-row').first().waitFor({ timeout: TIMEOUT_MS })
  await search(page, 'folders-')
  await waitForListed(
    page,
    [REPLAYS_FOLDERS_ROOT_DEMO, REPLAYS_FOLDERS_A_DEMO, REPLAYS_FOLDERS_C_DEMO],
    [],
  )
  expect((await page.getByTestId('replays-folder-row').count()) === 0, 'search shows folder rows')
  const cRow = rowFor(page, REPLAYS_FOLDERS_C_DEMO).first()
  const cSource = ((await cRow.getByTestId('replays-demo-source').textContent()) ?? '').trim()
  expect(
    cSource.includes(ROOT_LABEL) && cSource.endsWith(' / a / b / c'),
    `the nested demo should show its folder path, got "${cSource}"`,
  )
  await shot('replays-folders-search-top')

  step('inside a folder a search lists only matches below it')
  await search(page, '')
  await page.getByTestId('replays-folder-row').first().waitFor({ timeout: TIMEOUT_MS })
  await openFolder(page, ROOT_LABEL, 'a')
  await search(page, 'folders-')
  await waitForListed(
    page,
    [REPLAYS_FOLDERS_A_DEMO, REPLAYS_FOLDERS_C_DEMO],
    [REPLAYS_FOLDERS_ROOT_DEMO],
  )
  expect(
    (await page.getByTestId('replays-crumb').last().textContent())?.trim() === 'a',
    'the breadcrumb should stay on a',
  )

  step('clearing the search returns to the folder view of the same folder')
  await search(page, '')
  await page.getByTestId('replays-folder-row').first().waitFor({ timeout: TIMEOUT_MS })
  await waitForListed(page, [REPLAYS_FOLDERS_A_DEMO], [REPLAYS_FOLDERS_C_DEMO])
  expect(
    (await page.getByTestId('replays-crumb').last().textContent())?.trim() === 'a',
    'the open folder changed',
  )
  await shot('replays-folders-search-cleared')
}
