// Story 241: comment a moment of a demo on its timeline. A demo plays in the fixture's stub engine
// (`scripts/lib/stub-engine.cjs`), which records every command it actually ran in
// `Q2L_UI_ENGINE_COMMAND_LOG`; assertions read that log and the demo's `.json` sidecar on disk, not
// only the UI's own state. The demo starts with a legacy sidecar (schemaVersion 1, no comments).
//
// Selectors - read `DemoTimeline.tsx`, `TimelineComments.tsx` and `DemoCommentsList.tsx` before changing:
//   replays-timeline / replays-timeline-{seek,add-comment,comment-form,comment-field,comment-mark,comment-bubble}
//   replays-detail-comment-play
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPLAYS_PLAY_CTF_DEMO,
  REPLAYS_PLAY_DEMO_MS,
  REPLAYS_TIMELINE_VARIANT,
  replaysTimelineEngineFiles,
  writeReplaysTimelineFixture,
} from '../lib/fixture.mjs'
import { sleep } from '../lib/flow-common.mjs'
import {
  commands,
  makeEngineCommandsExpecter,
  openDemos,
  openFolder,
  positionS,
  rowFor,
  waitForScan,
} from '../lib/replays-copy-in.mjs'

export const variant = REPLAYS_TIMELINE_VARIANT

const TIMEOUT_MS = 8_000
/** Control cfg poll + ACK + logfile tail + position push, with headroom. */
const ENGINE_TIMEOUT_MS = 5_000
// The row shows the sidecar's name, not the file name.
const DEMO_NAME = 'Comment night'
const LEGACY_SIDECAR = { schemaVersion: 1, name: DEMO_NAME, tags: ['ctf'], rating: 6 }

const files = replaysTimelineEngineFiles()
let sidecarPath = ''

export async function setup() {
  const fixture = writeReplaysTimelineFixture()
  sidecarPath = join(fixture.installRoot, 'ctf', 'demos', `${REPLAYS_PLAY_CTF_DEMO}.json`)
  writeFileSync(sidecarPath, JSON.stringify(LEGACY_SIDECAR))
  return {
    env: { Q2L_UI_ENGINE_COMMAND_LOG: files.commandLog, Q2L_UI_ENGINE_QUIT_FILE: files.quitFile },
  }
}

const fail = (message) => {
  throw new Error(`replays-demo-comments: ${message}`)
}

const readSidecar = () => JSON.parse(readFileSync(sidecarPath, 'utf8'))

async function waitFor(what, read, predicate) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  let value = read()
  while (!predicate(value)) {
    if (Date.now() >= deadline)
      fail(`timed out waiting for ${what}; last saw ${JSON.stringify(value)}`)
    await sleep(100)
    value = read()
  }
  return value
}

const expectCommands = makeEngineCommandsExpecter(files.commandLog, fail)

/** Waits until the engine ran exactly `count` commands in all, and returns the last one. */
const lastCommand = async (count, label) => (await expectCommands(count, label)).at(-1)

async function waitForPosition(page, predicate, label) {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS
  let seen = await positionS(page)
  while (!predicate(seen)) {
    if (Date.now() >= deadline) fail(`${label}: position stuck at ${seen} s`)
    await sleep(100)
    seen = await positionS(page)
  }
  return seen
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

async function playFromActionBar(page) {
  await rowFor(page, DEMO_NAME).first().click({ timeout: TIMEOUT_MS })
  const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
  await play.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await play.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })
}

async function quitGame(page) {
  writeFileSync(files.quitFile, '')
  await page.getByTestId('replays-timeline').waitFor({ state: 'detached', timeout: 10_000 })
  // The next stub would see the file at once and quit before its first frame.
  if (existsSync(files.quitFile)) rmSync(files.quitFile)
}

export default async function replaysDemoComments({ page, step, shot }) {
  const seekBar = page.getByTestId('replays-timeline-seek')
  const field = page.getByTestId('replays-timeline-comment-field')
  const marks = page.getByTestId('replays-timeline-comment-mark')
  const bubble = page.getByTestId('replays-timeline-comment-bubble')
  const durationS = Math.floor(REPLAYS_PLAY_DEMO_MS / 1000)
  let n = 0

  await openDemos(page)
  await openFolder(page, 'ctf')
  await waitForScan(page, { label: 'replays-demo-comments' })
  await playFromActionBar(page)
  await waitForPosition(page, (s) => s >= 3, 'the engine clock reaching 3 s')

  step('Add comment pauses the demo and opens a field at the current position')
  const clickedS = await positionS(page)
  await page.getByTestId('replays-timeline-add-comment').click({ timeout: TIMEOUT_MS })
  if ((await lastCommand(++n, 'Add comment')) !== 'pause')
    fail('Add comment did not pause the engine')
  await field.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const formText = (await page.getByTestId('replays-timeline-comment-form').textContent()) ?? ''
  const shownTime = /Comment at (\d+):(\d\d)/.exec(formText)
  if (!shownTime) fail(`the field shows no time: ${JSON.stringify(formText)}`)
  const shownS = Number(shownTime[1]) * 60 + Number(shownTime[2])
  if (Math.abs(shownS - clickedS) > 1)
    fail(`the field says ${mmss(shownS)}, the strip showed ${mmss(clickedS)} at the click`)
  const frozen = await positionS(page)
  await sleep(1_200)
  if ((await positionS(page)) !== frozen) fail('the demo kept playing after Add comment')
  await shot('comment-field-open')

  step('a saved comment is in the sidecar on disk with its time and text')
  await field.fill('flag grab', { timeout: TIMEOUT_MS })
  await field.press('Enter')
  const saved = await waitFor(
    'the comment in the sidecar',
    readSidecar,
    (sidecar) => Array.isArray(sidecar.comments) && sidecar.comments.length === 1,
  )
  const [comment] = saved.comments
  if (comment.text !== 'flag grab') fail(`saved text ${JSON.stringify(comment.text)}`)
  if (Math.floor(comment.atMs / 1000) !== shownS)
    fail(`saved at ${comment.atMs} ms, the field said ${mmss(shownS)}`)
  await field.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  step('adding the first comment keeps every existing sidecar field')
  for (const [key, value] of Object.entries(LEGACY_SIDECAR)) {
    if (key === 'schemaVersion') continue
    if (JSON.stringify(saved[key]) !== JSON.stringify(value))
      fail(`${key} became ${JSON.stringify(saved[key])}, was ${JSON.stringify(value)}`)
  }
  if (typeof saved.schemaVersion !== 'number') fail('the sidecar lost its schemaVersion')

  step('each comment is a mark on the seek bar and shows its text on hover and focus')
  await marks.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await marks.count()) !== 1) fail(`${await marks.count()} marks for one comment`)
  const mark = marks.first()
  if (Number(await mark.getAttribute('data-at-ms')) !== comment.atMs)
    fail('the mark is not at the saved comment')
  const bar = await seekBar.boundingBox()
  const markBox = await mark.boundingBox()
  if (!bar || !markBox) fail('the seek bar or the mark has no box')
  const expectedX = bar.x + (bar.width * comment.atMs) / REPLAYS_PLAY_DEMO_MS
  if (Math.abs(markBox.x + markBox.width / 2 - expectedX) > 4)
    fail(`the mark sits at x=${markBox.x + markBox.width / 2}, its time is at x=${expectedX}`)
  if (await bubble.isVisible()) fail('a bubble shows before any hover')
  await mark.hover({ timeout: TIMEOUT_MS })
  await bubble.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await bubble.textContent()) ?? '').includes('flag grab'))
    fail('hover bubble lacks the text')
  const strip = await page.getByTestId('replays-timeline').boundingBox()
  const bubbleBox = await bubble.boundingBox()
  if (
    !strip ||
    !bubbleBox ||
    bubbleBox.y < strip.y ||
    bubbleBox.y + bubbleBox.height > strip.y + strip.height
  )
    fail('the bubble leaves the strip')
  await shot('comment-mark-hover')
  await page.mouse.move(bar.x + bar.width / 2, bar.y - 60)
  await bubble.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await mark.focus()
  await bubble.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!((await bubble.textContent()) ?? '').includes('flag grab'))
    fail('focus bubble lacks the text')

  step('activating a mark seeks the demo to its time')
  const markS = Math.floor(comment.atMs / 1000)
  // Move away from the comment first, so the seek is visible in the position too.
  await page.mouse.click(bar.x + bar.width * 0.9, bar.y + bar.height / 2)
  const away = await lastCommand(++n, 'bar click away from the comment')
  if (!/^seek \d+$/.test(away)) fail(`the bar click ran ${away}`)
  await waitForPosition(page, (s) => s >= durationS * 0.8, 'seeking away from the comment')
  await mark.focus()
  await page.keyboard.press('Enter')
  if ((await lastCommand(++n, 'mark by Enter')) !== `seek ${markS}`)
    fail(`Enter on the mark did not run seek ${markS}`)
  await waitForPosition(page, (s) => Math.abs(s - markS) <= 1, 'the mark seeking by Enter')
  await mark.click({ timeout: TIMEOUT_MS })
  // Exactly one more command: the mark's seek, and not also the bar's own click seek.
  if ((await lastCommand(++n, 'mark by click')) !== `seek ${markS}`)
    fail(`clicking the mark did not run seek ${markS}`)

  step('Play from here starts the demo and seeks to the comment')
  await quitGame(page)
  const before = commands(files.commandLog).length
  const playHere = page.getByTestId('replays-detail-comment-play').first()
  await playHere.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const enabledDeadline = Date.now() + TIMEOUT_MS
  while (await playHere.isDisabled()) {
    if (Date.now() >= enabledDeadline) fail('Play from here stayed disabled after the game exited')
    await sleep(100)
  }
  await playHere.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-timeline').waitFor({ state: 'visible', timeout: 15_000 })
  if ((await lastCommand(before + 1, 'Play from here')) !== `seek ${markS}`)
    fail(`Play from here did not seek to ${markS} s`)
  await waitForPosition(page, (s) => s >= markS && s <= markS + 3, 'starting at the comment')
  await shot('play-from-here')
  await quitGame(page)
}
