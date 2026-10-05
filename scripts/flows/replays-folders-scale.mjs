// Acceptance flow: a 5 000-demo, 200-folder tree (with a junction loop) scans to the end,
// shows recursive counts that add up, navigates fast and never mounts more than a window of rows.
import {
  REPLAYS_FOLDER_SCALE_DEMO_COUNT,
  REPLAYS_FOLDER_SCALE_OPEN_FOLDER,
  REPLAYS_FOLDER_SCALE_ROOT_CHILDREN,
  REPLAYS_FOLDER_SCALE_ROOT_LABEL,
  REPLAYS_FOLDER_SCALE_VARIANT,
} from '../lib/fixture.mjs'
import { openAllDemos, openFolder, poll, TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_FOLDER_SCALE_VARIANT

const MAX_MOUNTED_ROWS = 100
const MAX_NAVIGATION_MS = 1_000

function expect(cond, message) {
  if (!cond) throw new Error(`replays-folders-scale: ${message}`)
}

async function mountedRows(page) {
  return (
    (await page.getByTestId('replays-folder-row').count()) +
    (await page.getByTestId('replays-demo-row').count())
  )
}

/** The first number in a count label, tolerating thousands separators of any locale. */
function countOf(text) {
  const match = /\d[\d.,\s  ]*/.exec(text ?? '')
  const digits = match ? match[0].replace(/\D/g, '') : ''
  return digits ? Number(digits) : Number.NaN
}

async function assertFewRows(page, where) {
  const n = await mountedRows(page)
  expect(
    n < MAX_MOUNTED_ROWS,
    `${where}: ${n} rows mounted, expected fewer than ${MAX_MOUNTED_ROWS}`,
  )
}

export default async function replaysFoldersScale({ page, shot, step }) {
  step('the scan finishes despite the junction loop')
  await openAllDemos(page)
  const rows = page.getByTestId('replays-folder-row')
  await rows.first().waitFor({ timeout: TIMEOUT_MS })
  await assertFewRows(page, 'top level')

  step('the root folder row counts every demo')
  const rootCount = countOf(await rows.first().getByTestId('replays-folder-count').textContent())
  expect(rootCount === REPLAYS_FOLDER_SCALE_DEMO_COUNT, `root counts ${rootCount}`)

  step('the root children count sums to the seeded total')
  await openFolder(page, REPLAYS_FOLDER_SCALE_ROOT_LABEL)
  await poll(
    'the root children to list',
    async () => (await rows.count()) === REPLAYS_FOLDER_SCALE_ROOT_CHILDREN,
  )
  const counts = (await page.getByTestId('replays-folder-count').allTextContents()).map(countOf)
  const direct = await page.getByTestId('replays-demo-row').count()
  const sum = counts.reduce((a, b) => a + b, 0) + direct
  expect(
    sum === REPLAYS_FOLDER_SCALE_DEMO_COUNT,
    `counts ${JSON.stringify(counts)} + ${direct} direct sum to ${sum}`,
  )
  await assertFewRows(page, 'root')
  await shot('replays-folders-scale-root')

  step('opening a folder and returning via a crumb each render within a second')
  const opened = Date.now()
  await openFolder(page, REPLAYS_FOLDER_SCALE_OPEN_FOLDER)
  const openMs = Date.now() - opened
  expect(openMs <= MAX_NAVIGATION_MS, `opening a folder took ${openMs} ms`)
  await assertFewRows(page, 'opened folder')
  const back = Date.now()
  await page
    .getByTestId('replays-crumb')
    .filter({ hasText: REPLAYS_FOLDER_SCALE_ROOT_LABEL })
    .click()
  await poll(
    'the root children to list again',
    async () => (await rows.count()) === REPLAYS_FOLDER_SCALE_ROOT_CHILDREN,
    MAX_NAVIGATION_MS,
  )
  const backMs = Date.now() - back
  expect(backMs <= MAX_NAVIGATION_MS, `returning via a crumb took ${backMs} ms`)
  await assertFewRows(page, 'after returning')
  step(`measured: open ${openMs} ms, crumb ${backMs} ms`)
}
