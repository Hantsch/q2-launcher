// Story 241: the demo detail lists the demo's time-anchored comments, sorted by time, and lets the
// user edit or delete one in place; every change lands in the demo's own `.json` sidecar. Assertions
// read the sidecar file from disk. No demo is played.
//
// Selectors - read `DemoCommentsList.tsx` before changing any of these:
//   replays-detail-comments / replays-detail-comment[data-at-ms] / replays-comment-{time,text,input,edit,delete}
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_TIMELINE_VARIANT,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { makeFail, sleep } from '../lib/flow-common.mjs'
import { openDemos, openFolder, selectDemo, makeSidecarWaiter } from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
// The row shows the sidecar's name, not the file name.
const DEMO_NAME = 'Comment night'

let sidecarPath = ''

export async function setup() {
  const fixture = writeReplaysTimelineFixture()
  sidecarPath = join(fixture.installRoot, 'ctf', 'demos', `${REPLAYS_PLAY_CTF_DEMO}.json`)
  writeFileSync(
    sidecarPath,
    JSON.stringify({
      schemaVersion: 1,
      name: DEMO_NAME,
      tags: ['ctf'],
      rating: 6,
      comments: [
        { atMs: 125_000, text: 'last flag' },
        { atMs: 8_000, text: 'opening rush' },
        { atMs: 41_000, text: 'flag grab' },
      ],
    }),
  )
  return { env: {} }
}

const readSidecar = () => JSON.parse(readFileSync(sidecarPath, 'utf8'))

const waitForSidecar = makeSidecarWaiter(readSidecar, makeFail('replays-demo-comments-detail'))

async function listed(page) {
  return page
    .getByTestId('replays-detail-comment')
    .evaluateAll((items) =>
      items.map((item) => [
        item.querySelector('[data-testid="replays-comment-time"]')?.textContent?.trim(),
        item.querySelector('[data-testid="replays-comment-text"]')?.textContent?.trim(),
      ]),
    )
}

async function expectListed(page, expected, what) {
  const deadline = Date.now() + TIMEOUT_MS
  let seen = []
  while (Date.now() < deadline) {
    seen = await listed(page)
    if (JSON.stringify(seen) === JSON.stringify(expected)) return
    await sleep(100)
  }
  throw new Error(
    `replays-demo-comments-detail: ${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(seen)}`,
  )
}

export default async function replaysDemoCommentsDetail({ page, shot, step }) {
  step('the detail lists comments sorted by time with their times, no demo playing')
  await openDemos(page, { all: true })
  await openFolder(page, 'ctf')
  await selectDemo(page, DEMO_NAME)
  await page
    .getByTestId('replays-detail-comments')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await expectListed(
    page,
    [
      ['0:08', 'opening rush'],
      ['0:41', 'flag grab'],
      ['2:05', 'last flag'],
    ],
    'the comment list',
  )
  await shot('replays-demo-comments-detail')

  step('a comment is edited and deleted from the detail list')
  await page.getByTestId('replays-comment-edit').nth(1).click({ timeout: TIMEOUT_MS })
  const input = page.getByTestId('replays-comment-input')
  await input.fill('flag taken', { timeout: TIMEOUT_MS })
  await input.press('Enter')
  await waitForSidecar(
    (s) => s.comments?.some((c) => c.atMs === 41_000 && c.text === 'flag taken'),
    'the edited comment',
  )
  await expectListed(
    page,
    [
      ['0:08', 'opening rush'],
      ['0:41', 'flag taken'],
      ['2:05', 'last flag'],
    ],
    'the list after the edit',
  )

  await page.getByTestId('replays-comment-delete').first().click({ timeout: TIMEOUT_MS })
  const after = await waitForSidecar((s) => s.comments?.length === 2, 'the deleted comment')
  if (after.comments.some((c) => c.text === 'opening rush')) {
    throw new Error('replays-demo-comments-detail: the deleted comment is still in the sidecar')
  }
  if (after.name !== DEMO_NAME || after.rating !== 6) {
    throw new Error('replays-demo-comments-detail: a comment edit must keep the other fields')
  }
  await expectListed(
    page,
    [
      ['0:41', 'flag taken'],
      ['2:05', 'last flag'],
    ],
    'the list after the delete',
  )
  await shot('replays-demo-comments-detail-edited')
}
