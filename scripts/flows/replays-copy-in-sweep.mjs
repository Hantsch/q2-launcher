// Story 160 D3: at launcher start every file directly inside `<gamedir>/demos/_launcher/` is swept,
// and nothing else in that installation's demos folder is touched.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPLAYS_COPY_IN_KEEP_DEMO, replaysCopyInDemosDir, writeReplaysCopyInFixture } from '../lib/fixture.mjs'
import { poll } from '../lib/replays-copy-in.mjs'

export const variant = 'replays-copy-in-sweep'

export async function setup() {
  writeReplaysCopyInFixture(variant, 'leftover')
  return {}
}

export default async function replaysCopyInSweep({ page, step }) {
  const demosDir = replaysCopyInDemosDir()
  const leftover = join(demosDir, '_launcher', 'leftover.dm2')
  step('the seeded leftover is removed by the start-up sweep')
  await page.getByTestId('nav-replays').waitFor({ state: 'visible', timeout: 8_000 })
  await poll('the leftover to be swept', () => !existsSync(leftover), 10_000)
  step('demos of the installation are untouched')
  for (const name of [REPLAYS_COPY_IN_KEEP_DEMO, 'play-base.dm2', 'play-tdm.dm2']) {
    if (!existsSync(join(demosDir, name))) throw new Error(`replays-copy-in-sweep: ${name} was removed`)
  }
}
