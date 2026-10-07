// The real quit path: a change made inside the state.json write debounce must be on disk once the
// Close button has quit the app. The process is gone when the assertion runs, so it reads the file
// plainly - polling would hide a shutdown that did not wait for the write.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
  // The replays "missing-mod warning" switch: an enabled, state.json-persisted boolean
  // (`replays.modWarning.enabled`, absent from a fresh file = on) that lives in Settings.
  const modWarningSwitch = page.getByTestId('replays-mod-warning-enabled')
  await modWarningSwitch.scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  await modWarningSwitch.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (id) => document.querySelector(`[data-testid="${id}"]`)?.hasAttribute('disabled') === false,
    'replays-mod-warning-enabled',
    { timeout: TIMEOUT_MS },
  )

  const file = join(userDataDir, 'state.json')
  const seededText = readFileSync(file, 'utf8')
  const readEnabled = () => {
    const enabled = readStateJson(userDataDir).replays?.modWarning?.enabled ?? true
    if (typeof enabled !== 'boolean') {
      throw new Error(`expected a boolean replays.modWarning.enabled on disk, got ${enabled}`)
    }
    return enabled
  }
  const before = readEnabled()

  step('flip the switch and press Close without waiting')
  const exited = app.waitForEvent('close', { timeout: EXIT_TIMEOUT_MS })
  await modWarningSwitch.click({ timeout: TIMEOUT_MS })
  await page.getByTestId('titlebar-close').click({ timeout: TIMEOUT_MS })

  step('the app exits')
  await exited

  step('state.json holds the flipped value')
  const after = readStateJson(userDataDir).replays?.modWarning?.enabled
  if (after !== !before) {
    throw new Error(`expected replays.modWarning.enabled ${!before} after quit, got ${after}`)
  }

  // ui:flow never reseeds: put the seeded file back so the next run starts from the same state.
  // The app is gone, so this writes the file directly.
  step('restore the seeded value')
  writeFileSync(file, seededText)
}
