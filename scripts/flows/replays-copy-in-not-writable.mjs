// Story 160 D3: when `demos/_launcher` is a plain file the copy cannot be made - Play shows
// `replays.play.error.copyDirNotWritable` as visible text and no engine is started.
import { join } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { REPLAYS_COPY_IN_EXTRA_DEMO, replaysCopyInDemosDir, writeReplaysCopyInFixture } from '../lib/fixture.mjs'
import { launchLines, openDemos, selectDemo, TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

export const variant = 'replays-copy-in-not-writable'

export async function setup() {
  writeReplaysCopyInFixture(variant, 'blocked')
  return {}
}

export default async function replaysCopyInNotWritable({ page, step, shot }) {
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  const blocker = join(replaysCopyInDemosDir(), '_launcher')
  if (!statSync(blocker).isFile()) throw new Error('replays-copy-in-not-writable: _launcher is not a plain file')
  await openDemos(page)
  const linesBefore = launchLines(logPath).length
  await page.evaluate(() => {
    window.__q2lPhases = []
    window.q2.on('launch:state', (state) => window.__q2lPhases.push(state.phase))
  })

  step('Play on an extra-folder demo shows the copyDirNotWritable text and starts nothing')
  await selectDemo(page, REPLAYS_COPY_IN_EXTRA_DEMO)
  await page.getByTestId('replays-demo-play').click({ timeout: TIMEOUT_MS })
  const error = page.getByTestId('replays-demo-play-error')
  await error.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = (await error.textContent()) ?? ''
  if (!text.includes("Can't write a temporary copy to") || !text.includes('Nothing was started.')) {
    throw new Error(`replays-copy-in-not-writable: unexpected error text ${JSON.stringify(text)}`)
  }
  await shot('copy-in-not-writable')
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  if (launchLines(logPath).length !== linesBefore) throw new Error('replays-copy-in-not-writable: an engine was launched')
  const phases = await page.evaluate(() => window.__q2lPhases)
  if (phases.length !== 0) throw new Error(`replays-copy-in-not-writable: launch phases seen: ${phases}`)
  if (!statSync(blocker).isFile() || !readFileSync(blocker, 'utf8').includes('plain file')) {
    throw new Error('replays-copy-in-not-writable: the blocking file was altered')
  }
}
