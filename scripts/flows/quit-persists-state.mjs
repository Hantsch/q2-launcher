// The real quit path: a change made inside the state.json write debounce must be on disk once the
// Close button has quit the app. The process is gone when the assertion runs, so it reads the file
// plainly - polling would hide a shutdown that did not wait for the write.
import { variantUserDataDir } from '../lib/harness.mjs'
import { readStateJson } from '../lib/state-json.mjs'

// The flow quits the app itself; the harness must not treat that as the app dying.
export const expectExit = true

const TIMEOUT_MS = 8_000
const EXIT_TIMEOUT_MS = 15_000

export default async function quitPersistsState({ page, app, step }) {
  const userDataDir = variantUserDataDir('populated')

  step('open Settings')
  await page.getByTestId('nav-settings').click({ timeout: TIMEOUT_MS })
  const whilePlayingSwitch = page
    .getByTestId('downloads-settings-while-playing')
    .getByRole('switch')
  await whilePlayingSwitch.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  const before = readStateJson(userDataDir).downloads?.downloadWhilePlayingAllowed
  if (typeof before !== 'boolean') {
    throw new Error(`expected a boolean downloadWhilePlayingAllowed on disk, got ${before}`)
  }

  step('flip the switch and press Close without waiting')
  const exited = app.waitForEvent('close', { timeout: EXIT_TIMEOUT_MS })
  await whilePlayingSwitch.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('titlebar-close').click({ timeout: TIMEOUT_MS })

  step('the app exits')
  await exited

  step('state.json holds the flipped value')
  const after = readStateJson(userDataDir).downloads?.downloadWhilePlayingAllowed
  if (after !== !before) {
    throw new Error(`expected downloadWhilePlayingAllowed ${!before} after quit, got ${after}`)
  }

  // ui:flow never reseeds: put the seeded value back so the next run starts from the same state.
  // The app is gone, so this edits the file directly.
  step('restore the seeded value')
  const { readFileSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const file = join(userDataDir, 'state.json')
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  doc.downloads.downloadWhilePlayingAllowed = before
  writeFileSync(file, JSON.stringify(doc, null, 2))
}
