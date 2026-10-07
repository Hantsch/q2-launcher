// Story 238: installations are registered but none is selected - the Demos list asks for a
// selection instead of looking empty. Runs on `replays-scope-none-selected` (no active installation).
// Selectors: `replays-list-none-selected` (ReplaysListStatus.tsx), `replays-scope-all` (ReplaysView.tsx).
import { TIMEOUT_MS } from '../lib/replays-copy-in.mjs'

export const variant = 'replays-scope-none-selected'

export default async function replaysScopeNoneSelected({ page, shot, step }) {
  step('with no installation selected the list asks for one')
  await page.getByTestId('nav-replays').click({ timeout: TIMEOUT_MS })
  const line = page.getByTestId('replays-list-none-selected')
  await line.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if (!(await line.innerText()).includes('Select an installation')) {
    throw new Error('replays-scope-none-selected: the line did not ask for a selection')
  }
  await shot('replays-scope-none-selected')

  step('turning the All installations toggle on lists the demos again')
  await page.getByTestId('replays-scope-all').click({ timeout: TIMEOUT_MS })
  await line.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await page
    .getByTestId('replays-folder-row')
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}
