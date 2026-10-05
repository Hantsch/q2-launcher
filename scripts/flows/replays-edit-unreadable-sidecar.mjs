// Story 243 acceptance flow: the first edit of a demo whose sidecar cannot be parsed asks before it
// replaces that file; once confirmed, later edits write straight through. Runs against the
// `replays-rows` fixture variant with a `setup()` that writes a corrupt `.json` next to
// `REPLAYS_ROWS_MVD_DEMO`.
//
// Selectors - read `DemoDetailPanel.tsx` and `ReplaceSidecarDialog.tsx`:
//   replays-detail-input-<field>      DemoDetailPanel.tsx - one in-place input per text fact
//   replays-replace-sidecar-dialog    ReplaceSidecarDialog.tsx
//   replays-replace-confirm           ReplaceSidecarDialog.tsx

import { readFileSync, writeFileSync } from 'node:fs'
import { REPLAYS_ROWS_MVD_DEMO, replaysRowsSidecarPath } from '../lib/fixture.mjs'
import { rowFor, openDemosRoot } from '../lib/replays-copy-in.mjs'

const TIMEOUT_MS = 8_000

export const variant = 'replays-rows'

const NAME = 'Replaced for good'
const MOD = 'lithium'

export async function setup() {
  writeFileSync(replaysRowsSidecarPath(REPLAYS_ROWS_MVD_DEMO), '{ this is not json', 'utf8')
}

async function waitForSidecar(predicate, why) {
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    let parsed = null
    try {
      parsed = JSON.parse(readFileSync(replaysRowsSidecarPath(REPLAYS_ROWS_MVD_DEMO), 'utf8'))
    } catch {
      // still unreadable
    }
    if (parsed !== null && predicate(parsed)) return parsed
    if (Date.now() > deadline) {
      throw new Error(
        `replays-edit-unreadable-sidecar: ${why} - sidecar is ${JSON.stringify(parsed)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export default async function replaysEditUnreadableSidecar({ page, shot, step }) {
  await openDemosRoot(page)
  await rowFor(page, REPLAYS_ROWS_MVD_DEMO).click({ timeout: TIMEOUT_MS })
  await page.getByTestId('replays-detail-title').waitFor({ state: 'attached', timeout: TIMEOUT_MS })

  step('the first edit asks before replacing an unreadable sidecar')
  const name = page.getByTestId('replays-detail-input-name')
  await name.fill(NAME)
  await name.press('Enter')
  const dialog = page.getByTestId('replays-replace-sidecar-dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('replays-edit-unreadable-sidecar')
  await page.getByTestId('replays-replace-confirm').click({ timeout: TIMEOUT_MS })
  await waitForSidecar((sidecar) => sidecar.name === NAME, 'confirming must write the name')

  const mod = page.getByTestId('replays-detail-input-mod')
  await mod.fill(MOD)
  await mod.press('Enter')
  await waitForSidecar((sidecar) => sidecar.mod === MOD, 'a second edit must be written')
  if ((await dialog.count()) !== 0) {
    throw new Error('replays-edit-unreadable-sidecar: the second edit asked again')
  }
}
