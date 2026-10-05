// Story 241: a demo inside a zip cannot carry comments. It plays in the fixture's stub engine; the
// timeline keeps Add comment visible and focusable but refused, and the detail's comments section
// says why - both as visible text.
//
// Selectors - read `DemoTimeline.tsx` and `DemoCommentsList.tsx` before changing:
//   replays-timeline / replays-timeline-{add-comment,comment-reason,comment-mark}
//   replays-detail-comments
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import {
  REPLAYS_COMMENTS_ZIP,
  REPLAYS_COMMENTS_ZIP_ENTRY,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  vendoredExtractorExists,
  writeReplaysCommentsArchiveFixture,
} from '../lib/fixture.mjs'
import { openDemos, openFolder, rowFor, waitForScan } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
const REASON = 'Demos inside a zip cannot carry comments'

const files = replaysTimelineEngineFiles()

export async function setup() {
  writeReplaysCommentsArchiveFixture()
  return {
    env: { Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog, Q2L_UI_ENGINE_QUIT_FILE: files.quitFile },
  }
}

const fail = (message) => {
  throw new Error(`replays-demo-comments-archive: ${message}`)
}

export default async function replaysDemoCommentsArchive({ page, step, shot }) {
  if (!vendoredExtractorExists()) {
    fail('resources/bin/7za.exe is missing - run `npm run fetch:7za` first')
  }

  step("a zip demo's Add comment is disabled and says why")
  await openDemos(page)
  await openFolder(page, 'baseq2', REPLAYS_COMMENTS_ZIP)
  await waitForScan(page, { label: 'replays-demo-comments-archive' })
  await rowFor(page, REPLAYS_COMMENTS_ZIP_ENTRY).first().click({ timeout: TIMEOUT_MS })

  const detail = page.getByTestId('replays-detail-comments')
  await detail.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await detail.textContent()) ?? '').includes(REASON))
    fail(
      `the detail comments section lacks "${REASON}": ${JSON.stringify(await detail.textContent())}`,
    )

  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })

  const add = page.getByTestId('replays-timeline-add-comment')
  await add.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await add.getAttribute('aria-disabled')) !== 'true') fail('Add comment is not aria-disabled')
  const reason = page.getByTestId('replays-timeline-comment-reason')
  await reason.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await reason.textContent()) ?? '').includes(REASON))
    fail(`the timeline reason is ${JSON.stringify(await reason.textContent())}`)
  await add.click({ force: true, timeout: TIMEOUT_MS })
  if ((await page.getByTestId('replays-timeline-comment-field').count()) !== 0)
    fail('clicking the refused Add comment opened a field')
  if ((await page.getByTestId('replays-timeline-comment-mark').count()) !== 0)
    fail('a zip demo shows comment marks')
  await shot('zip-add-comment-disabled')

  writeFileSync(files.quitFile, '')
  await page.getByTestId('replays-timeline').waitFor({ state: 'detached', timeout: 10_000 })
  if (existsSync(files.quitFile)) rmSync(files.quitFile)
}
