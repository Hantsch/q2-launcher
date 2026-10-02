// Story 188 D2 acceptance flow: the Mods view lists the active installation's game directories
// (minus baseq2) as tiles, each marked as installed manually; an installation without any shows
// the empty state; the planned placeholder is gone.
//
// Selectors - read `src/renderer/src/modules/mods/ModsView.tsx` and `components/ModTile.tsx`:
//   nav-mods, mods-empty, mods-installation-name, mods-tile-<dir>, mods-tile-origin-manual

import { startModsCatalogFixtureServer } from '../lib/fixture.mjs'

export const variant = 'populated'

// Story 189 D4: the catalog would add tiles (and the real one needs the network); a failing
// catalog keeps this flow about the installation's own game directories.
let server

export async function setup() {
  server = await startModsCatalogFixtureServer({ mode: 'down' })
  return { env: { Q2L_UI_CONTENT_REPO_BASE: server.baseUrl } }
}

export async function teardown() {
  await server?.close()
}

const TIMEOUT_MS = 8_000
const WRITEDIR_NAME = 'Fixture WriteDir Install'

export default async function modsView({ page, shot, step }) {
  step('opening the Mods view shows the real view, not the planned placeholder')
  await page.getByTestId('nav-mods').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('mods-installation-name')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const body = await page.locator('body').innerText()
  if (/Mods will let you bring in extra content/.test(body)) {
    throw new Error('mods-view: the planned placeholder is still shown')
  }

  step('the favorite installation has no extra game directories: empty state, no tiles')
  await page.getByTestId('mods-empty').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await page.locator('[data-testid^="mods-tile-"]').count()) !== 0) {
    throw new Error('mods-view: expected no mods-tile-* in the empty state')
  }
  await shot('mods-view-empty')

  step('selecting the WriteDir installation lists its game directories')
  await page
    .getByRole('button', { name: WRITEDIR_NAME, exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('mods-tile-ctf').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const name = await page.getByTestId('mods-installation-name').innerText()
  if (!name.includes(WRITEDIR_NAME)) {
    throw new Error(`mods-view: expected the header to name "${WRITEDIR_NAME}", got "${name}"`)
  }
  if ((await page.getByTestId('mods-tile-baseq2').count()) !== 0) {
    throw new Error('mods-view: baseq2 must not be a tile')
  }

  const result = await page.evaluate(() => window.q2.invoke('installations:list'))
  const list = Array.isArray(result) ? result : (result?.value ?? result)
  const install = list.find((i) => i.name === WRITEDIR_NAME)
  const expected = install.gameDirs.filter((d) => d.toLowerCase() !== 'baseq2').sort()
  const actual = (
    await page
      .locator('[data-testid^="mods-tile-"]:not([data-testid^="mods-tile-origin"])')
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-testid').slice('mods-tile-'.length)),
      )
  ).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `mods-view: tiles ${JSON.stringify(actual)} != gameDirs ${JSON.stringify(expected)}`,
    )
  }

  step('every tile is marked "installed manually"')
  const badges = page.getByTestId('mods-tile-origin-manual')
  if ((await badges.count()) !== expected.length) {
    throw new Error('mods-view: every tile must carry the manual origin badge')
  }
  for (const text of await badges.allInnerTexts()) {
    if (text.trim().toLowerCase() !== 'installed manually') {
      throw new Error(`mods-view: unexpected badge text "${text}"`)
    }
  }
  await shot('mods-view-tiles')
}
