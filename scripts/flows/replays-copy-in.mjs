// Story 160 D3: playing a demo that is not inside the active installation's `demos/` stages a
// temporary copy at `<gamedir>/demos/_launcher/<id><ext>`, launches with `+demo _launcher/<name>`
// and removes the copy when the (stand-in, ~3s-lingering) client exits; the original is never
// touched. Covers an extra-folder demo, a zip entry, and an in-place demo (no copy, still there).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPLAYS_COPY_IN_EXTRA_DEMO,
  REPLAYS_COPY_IN_INPLACE_DEMO,
  REPLAYS_COPY_IN_ZIP,
  REPLAYS_COPY_IN_ZIP_ENTRY,
  replaysCopyInDemosDir,
  replaysCopyInExtraFolder,
  vendoredExtractorExists,
  writeReplaysCopyInFixture,
} from '../lib/fixture.mjs'
import {
  assertUnchanged,
  copiesIn,
  launchLines,
  openDemos,
  poll,
  selectDemo,
  snapshot,
  TIMEOUT_MS,
} from '../lib/replays-copy-in.mjs'

export const variant = 'replays-copy-in'

export async function setup() {
  writeReplaysCopyInFixture(variant)
  return {}
}

export default async function replaysCopyIn({ page, step, shot }) {
  if (!vendoredExtractorExists()) {
    throw new Error('replays-copy-in: resources/bin/7za.exe was not vendored (npm run fetch:7za)')
  }
  const demosDir = replaysCopyInDemosDir()
  const folder = replaysCopyInExtraFolder(variant)
  await page.getByTestId('nav-replays').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const { logPath } = await page.evaluate(() => window.q2.invoke('app:getInfo'))
  await openDemos(page)

  async function playAndObserve(label, fileName, originalPath) {
    const before = snapshot(originalPath)
    const linesBefore = launchLines(logPath).length
    await selectDemo(page, fileName)
    const play = page.locator('[data-testid="actionbar-play"][data-action="view"]')
    if (await play.isDisabled()) throw new Error(`replays-copy-in: Play disabled for ${fileName}`)
    await play.click({ timeout: TIMEOUT_MS })
    const names = await poll(`${label}: a copy in _launcher`, () => {
      const found = copiesIn(demosDir).filter((n) => !n.endsWith('.tmp'))
      return found.length ? found : null
    })
    const copyName = names[0]
    if (!/\.dm2$/.test(copyName)) throw new Error(`replays-copy-in: ${label}: unexpected copy name ${copyName}`)
    const line = await poll(`${label}: the launching line`, () => launchLines(logPath).slice(linesBefore).pop())
    if (!line.includes(`+demo _launcher/${copyName}`)) {
      throw new Error(`replays-copy-in: ${label}: launching line lacks +demo _launcher/${copyName}: ${line}`)
    }
    if (!existsSync(join(demosDir, '_launcher', copyName))) {
      throw new Error(`replays-copy-in: ${label}: copy vanished before the stub ran`)
    }
    await shot(`copy-in-${label}-running`)
    await poll(`${label}: the copy to be removed after exit`, () => !existsSync(join(demosDir, '_launcher', copyName)))
    if (copiesIn(demosDir).length !== 0) throw new Error(`replays-copy-in: ${label}: _launcher not empty after exit`)
    assertUnchanged(`${label} original`, originalPath, before)
  }

  step('extra-folder demo: copy exists while the stub runs, gone after exit, original untouched')
  await playAndObserve('extra-folder', REPLAYS_COPY_IN_EXTRA_DEMO, join(folder, REPLAYS_COPY_IN_EXTRA_DEMO))

  step('pack.zip entry: same, archive untouched')
  await playAndObserve('zip-entry', REPLAYS_COPY_IN_ZIP_ENTRY, join(folder, REPLAYS_COPY_IN_ZIP))

  step('in-place demo: no copy is made and the file still exists after the play ends')
  const inPlace = join(demosDir, REPLAYS_COPY_IN_INPLACE_DEMO)
  const before = snapshot(inPlace)
  const lines = launchLines(logPath).length
  await selectDemo(page, REPLAYS_COPY_IN_INPLACE_DEMO)
  await page.locator('[data-testid="actionbar-play"][data-action="view"]').click({ timeout: TIMEOUT_MS })
  const line = await poll('in-place launching line', () => launchLines(logPath).slice(lines).pop())
  if (!line.includes(`+demo ${REPLAYS_COPY_IN_INPLACE_DEMO}`) || line.includes('_launcher')) {
    throw new Error(`replays-copy-in: in-place demo must launch directly, got ${line}`)
  }
  if (copiesIn(demosDir).length !== 0) throw new Error('replays-copy-in: in-place demo must not be staged')
  await new Promise((resolve) => setTimeout(resolve, 4_500)) // the stub lingers ~3s
  assertUnchanged('in-place demo', inPlace, before)
}
