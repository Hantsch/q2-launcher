// Story 238: an installation without demos says so and names the folders it looks in - as a
// neutral line, not a warning. Runs on the populated fixture, where the "unknown engine"
// installation has a `baseq2` folder and no demos.
// Selectors: `replays-list-empty-installation`, `replays-list-empty-folder`,
// `replays-list-source-error` (ReplaysListStatus.tsx), `replays-scope-label` (ReplaysView.tsx).
import { INSTALL_UNKNOWN_ENGINE_NAME } from '../lib/fixture.mjs'
import { TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

export default async function replaysScopeEmpty({ page, shot, step }) {
  step('selecting an installation without demos names it and the folders it looks in')
  await page
    .getByRole('button', { name: INSTALL_UNKNOWN_ENGINE_NAME, exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })

  const block = page.getByTestId('replays-list-empty-installation')
  await block.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = await block.innerText()
  if (!text.includes(`No demos in ${INSTALL_UNKNOWN_ENGINE_NAME} yet.`)) {
    throw new Error(`replays-scope-empty: the line did not name the installation: "${text}"`)
  }
  const folder = page.getByTestId('replays-list-empty-folder').first()
  await folder.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const folders = await page.getByTestId('replays-list-empty-folder').allInnerTexts()
  if (!folders.some((f) => /baseq2[/\\]demos$/.test(f.trim()))) {
    throw new Error(
      `replays-scope-empty: no baseq2/demos folder line in ${JSON.stringify(folders)}`,
    )
  }

  step('the empty installation shows no warning')
  if ((await page.getByTestId('replays-list-source-error').count()) > 0) {
    throw new Error('replays-scope-empty: an empty installation showed a source error')
  }
  await shot('replays-scope-empty')
}
