// Story 188 D3 acceptance flow: clicking a mod tile opens the docked detail panel with the
// directory name, its full folder path and a working "Reveal folder"; a manually installed
// directory shows the note and offers neither Update nor Remove.
//
// Selectors - read `src/renderer/src/modules/mods/components/ModDetailPanel.tsx`:
//   mods-tile-<dir>, mods-detail-panel, mods-detail-name, mods-detail-path, mods-detail-reveal,
//   mods-detail-manual-note, mods-detail-update, mods-detail-remove

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from '../lib/harness.mjs'

export const variant = 'populated'

const TIMEOUT_MS = 8_000
const WRITEDIR_NAME = 'Fixture WriteDir Install'

function readRevealedPaths() {
  const filePath = join(variantUserDataDir('populated'), 'ui-harness-revealed.json')
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default async function modsDetail({ page, shot, step }) {
  step('select the WriteDir installation, open Mods and click the ctf tile')
  await page
    .getByRole('button', { name: WRITEDIR_NAME, exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-mods').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('mods-tile-ctf').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('mods-detail-panel').waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('the panel names the directory and shows its full folder path')
  const name = (await page.getByTestId('mods-detail-name').innerText()).trim()
  if (name !== 'ctf') throw new Error(`mods-detail: expected name "ctf", got "${name}"`)
  const path = (await page.getByTestId('mods-detail-path').innerText()).trim()
  if (!/fixture-install-writedir[\\/]ctf$/.test(path)) {
    throw new Error(`mods-detail: path should end in fixture-install-writedir/ctf, got "${path}"`)
  }
  await shot('mods-detail')

  step('Reveal folder records exactly one revealed path ending in ctf')
  const before = readRevealedPaths().length
  await page.getByTestId('mods-detail-reveal').click({ timeout: TIMEOUT_MS })
  let after = readRevealedPaths()
  const deadline = Date.now() + 5_000
  while (after.length <= before && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    after = readRevealedPaths()
  }
  if (after.length !== before + 1) {
    throw new Error(`mods-detail: expected one new revealed path, got ${after.length - before}`)
  }
  const last = after[after.length - 1]
  if (!last.endsWith('ctf'))
    throw new Error(`mods-detail: revealed path should end in ctf, got "${last}"`)

  step('a manual directory shows the note and no Update/Remove control')
  await page
    .getByTestId('mods-detail-manual-note')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  for (const id of ['mods-detail-update', 'mods-detail-remove']) {
    if ((await page.getByTestId(id).count()) !== 0)
      throw new Error(`mods-detail: ${id} must not exist`)
  }
}
