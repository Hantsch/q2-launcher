// Story 189 D4 acceptance flow: the Mods view shows the content repository's mod catalog as tiles
// (name + description as plain text), merged with the installation's game directories.
//
// One app launch per catalog mode: the fixture base URL is fixed per session and the app's
// 15-minute freshness window would mask a mid-session mode switch. The flow's own launch
// ('populated') is the `ok` mode; the other three launch their own freshly seeded variants.
//
// Selectors - read `src/renderer/src/modules/mods/ModsView.tsx` and `components/ModTile.tsx`:
//   nav-mods, mods-tile-<dir>, mods-tile-description, mods-tile-origin-manual,
//   mods-catalog-unavailable, mods-catalog-as-of

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir, withApp } from '../lib/harness.mjs'
import {
  modsCatalogFixtureEntries,
  startModsCatalogFixtureServer,
  writePopulatedFixture,
} from '../lib/fixture.mjs'

export const variant = 'populated'

const TIMEOUT_MS = 8_000
const WRITEDIR_NAME = 'Fixture WriteDir Install'
/** Mirrors `HARNESS_CONTENT_REPO_BASE_ENV` (`src/main/lib/ui-harness.ts`). */
const HARNESS_CONTENT_REPO_BASE_ENV = 'Q2L_UI_CONTENT_REPO_BASE'

const ENTRIES = modsCatalogFixtureEntries()

let server
let okTileCount = 0

export async function setup() {
  server = await startModsCatalogFixtureServer({ mode: 'ok' })
  console.log(`  fixture server: ${server.baseUrl}`)
  return { env: { [HARNESS_CONTENT_REPO_BASE_ENV]: server.baseUrl } }
}

export async function teardown() {
  await server?.close()
}

async function openMods(page) {
  await page
    .getByRole('button', { name: WRITEDIR_NAME, exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-mods').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('mods-tile-ctf').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

async function tileText(page, gameDir) {
  const tile = page.getByTestId(`mods-tile-${gameDir}`)
  await tile.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  return tile.innerText()
}

function expectText(text, needle, label) {
  // Names render uppercase via CSS, which innerText reflects: compare case-insensitively.
  if (!text.toLowerCase().includes(needle.toLowerCase()))
    throw new Error(`mods-catalog: ${label} should contain "${needle}", got "${text}"`)
}

/** Launches a fresh app on a freshly seeded variant against the server in `mode`. */
async function inMode(mode, name, { seedCache = false } = {}, fn) {
  server.setMode(mode)
  const modeVariant = `mods-catalog-${name}`
  writePopulatedFixture({ variant: modeVariant })
  if (seedCache) {
    const dir = join(variantUserDataDir(modeVariant), 'cache', 'mods')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'catalog-cache.json'),
      JSON.stringify({ cacheVersion: 1, fetchedAt: '2026-09-01T12:00:00.000Z', entries: ENTRIES }),
      'utf8',
    )
  }
  await withApp(
    {
      variant: modeVariant,
      viewport: { width: 1280, height: 800 },
      env: { [HARNESS_CONTENT_REPO_BASE_ENV]: server.baseUrl },
    },
    async ({ page }) => {
      await openMods(page)
      await fn(page)
    },
  )
}

export default async function modsCatalog({ shot, step }) {
  // The flow's own launch ('populated') is only the vehicle: it never opens Mods, so it never
  // fetches (or caches) a catalog that would leak into the flows sharing its userData.
  step('every catalog entry is a tile with its name and description')
  await inMode('ok', 'ok', {}, async (page) => {
    for (const entry of ENTRIES.filter((e) => e.gamedir !== 'ctf')) {
      const text = await tileText(page, entry.gamedir)
      expectText(text, entry.name, `${entry.gamedir} tile`)
      expectText(text, entry.description, `${entry.gamedir} tile`)
    }
    if ((await page.getByTestId('mods-catalog-unavailable').count()) !== 0) {
      throw new Error('mods-catalog: no unavailable note expected with a working catalog')
    }
    okTileCount = await page
      .locator(
        '[data-testid^="mods-tile-"]:not([data-testid^="mods-tile-description"]):not([data-testid^="mods-tile-origin"])',
      )
      .count()
    await shot('mods-catalog-ok')

    step('a catalog gamedir already on disk is one tile')
    if ((await page.getByTestId('mods-tile-ctf').count()) !== 1) {
      throw new Error('mods-catalog: ctf must be exactly one tile')
    }
    const ctf = ENTRIES.find((e) => e.gamedir === 'ctf')
    const ctfText = await tileText(page, 'ctf')
    expectText(ctfText, ctf.name, 'ctf tile')
    expectText(ctfText.toLowerCase(), 'installed manually', 'ctf tile')
  })

  step('bad row: the other entries still show')
  await inMode('bad-row', 'bad-row', {}, async (p) => {
    expectText(await tileText(p, 'action'), ENTRIES[0].name, 'action tile')
    expectText(await tileText(p, 'opentdm'), ENTRIES[1].name, 'opentdm tile')
    // Only real tiles: not the description/origin children that share the testid prefix.
    const tiles = p.locator(
      '[data-testid^="mods-tile-"]:not([data-testid^="mods-tile-description"]):not([data-testid^="mods-tile-origin"])',
    )
    const tileTexts = await tiles.allInnerTexts()
    if (tileTexts.some((t) => /broken row/i.test(t)) || (await p.getByText(/broken row/i).count()))
      throw new Error('mods-catalog: the invalid row must not become a tile')
    // The two good entries plus the local dirs (ctf included) - same set as with a working catalog.
    if (tileTexts.length !== okTileCount)
      throw new Error(
        `mods-catalog: expected ${okTileCount} tiles with a bad row, got ${tileTexts.length}`,
      )
    if ((await p.getByTestId('mods-catalog-unavailable').count()) !== 0) {
      throw new Error('mods-catalog: a bad row must not mark the catalog unavailable')
    }
  })

  step('bad envelope: catalog unavailable note, local mods still show')
  await inMode('bad-envelope', 'bad-envelope', {}, async (p) => {
    await p
      .getByTestId('mods-catalog-unavailable')
      .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const note = (await p.getByTestId('mods-catalog-unavailable').innerText()).trim()
    if (note.length === 0)
      throw new Error('mods-catalog: the unavailable note must have visible text')
    await p.getByTestId('mods-tile-ctf').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    if ((await p.getByTestId('mods-tile-action').count()) !== 0) {
      throw new Error('mods-catalog: no catalog tile expected when the catalog is unavailable')
    }
  })

  step('offline: cached catalog with an as-of note')
  await inMode('down', 'offline', { seedCache: true }, async (p) => {
    const asOf = p.getByTestId('mods-catalog-as-of')
    await asOf.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
    const text = (await asOf.innerText()).trim()
    if (!/2026/.test(text))
      throw new Error(`mods-catalog: as-of note should show the date, got "${text}"`)
    expectText(await tileText(p, 'action'), ENTRIES[0].name, 'cached action tile')
    if ((await p.getByTestId('mods-catalog-unavailable').count()) !== 0) {
      throw new Error('mods-catalog: a cached catalog must not read as unavailable')
    }
  })
}
