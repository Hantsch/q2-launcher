// Story 067 D6 acceptance flow: the icon picker dialog itself, opened from the library card's new
// trigger (`installation.action.setIcon`, `LibraryView.tsx`).
//
// Fixture wiring (`scripts/lib/fixture.mjs`, `populated` variant, same as `installation-icon-
// tile.mjs`, D5's sibling flow). Ids below mirror that flow's own hardcoded literals:
//   - ICONLESS_ID / ICONLESS_NAME (the long-name unknown-engine installation) -> no `icon` field,
//     used here so "pick a shipped icon, then clear" (AC5) starts from a known clean state.
//   - SHIPPED_ICON_ID = 'gate' (`INSTALL_ONE_ICON_ID`, scripts/lib/fixture.mjs) - the one shipped
//     icon id this repo's fixture already relies on existing on disk.
//
// AC2 is a "present and enabled" check only, deliberately never clicked: `installations:
// pickIconFile` (D4) opens a real native OS file-open dialog, which Playwright cannot drive - this
// is the story's own documented manual-residue gap, not something to work around with a stub.
//
// The dialog is designed to stay open across a successful pick/clear (see `SetInstallationIcon
// Dialog.tsx`'s own doc comment) precisely so this flow can drive AC1/AC2/AC5 in one open dialog
// instead of reopening it between steps.
//
// AC1's expected id set is read straight off disk (`src/renderer/src/assets/installations/*.avif`)
// with plain Node `fs`, mirroring `installation-icons.ts`'s own `idFromPath` - not reached into the
// live page via `page.evaluate(import(...))`, since this flow may run against a built app where
// `/src/...ts` is not a servable module path the way it is under Vite dev.

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CLICK_TIMEOUT_MS = 8_000

const ASSETS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'renderer',
  'src',
  'assets',
  'installations',
)

function shippedIconIdsFromDisk() {
  return readdirSync(ASSETS_DIR)
    .filter((file) => file.endsWith('.avif'))
    .map((file) => file.replace(/\.avif$/, ''))
}

const ICONLESS_ID = 'fixture-install-unknown-long-name'
const ICONLESS_NAME =
  'Fixture Unknown Engine Install With A Deliberately Very Long Display Name That Must Truncate Instead Of Pushing The Engine Badge Out Of Any Narrow Panel Row'
const SHIPPED_ICON_ID = 'gate'

/** The library card - no dedicated testid, mirrors `installation-icon-tile.mjs`'s own helper. */
function libraryCard(page, name) {
  return page.locator('div.items-start').filter({ has: page.getByRole('heading', { name, exact: true }) })
}

export default async function installationIconPick({ page, shot, step }) {
  step('open Library and locate the iconless fixture install')
  await page.getByTestId('nav-library').click({ timeout: CLICK_TIMEOUT_MS })
  const card = libraryCard(page, ICONLESS_NAME)
  await card.getByRole('heading', { name: ICONLESS_NAME, exact: true }).waitFor({
    state: 'visible',
    timeout: CLICK_TIMEOUT_MS,
  })
  // Sanity: starts with no icon, i.e. its code tile, not an <img>.
  if ((await card.locator('img').count()) !== 0) {
    throw new Error(`expected "${ICONLESS_NAME}" (${ICONLESS_ID}) to start with no icon`)
  }

  step('open the icon picker from the card\'s "Set icon…" trigger')
  await card.getByRole('button', { name: 'Set icon…' }).click({ timeout: CLICK_TIMEOUT_MS })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await shot('dialog-opened')

  step('AC1: every shipped icon (SHIPPED_ICONS, D1) has a visible option in the grid')
  const shippedIds = shippedIconIdsFromDisk()
  if (shippedIds.length === 0) {
    throw new Error('SHIPPED_ICONS (D1 manifest) resolved to zero icons - nothing to prove AC1 against')
  }
  for (const id of shippedIds) {
    const option = dialog.getByRole('button', { name: `“${id}” icon` })
    await option.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  }
  if (!shippedIds.includes(SHIPPED_ICON_ID)) {
    throw new Error(
      `expected the fixture's shipped icon id "${SHIPPED_ICON_ID}" to be part of SHIPPED_ICONS, got: ${shippedIds.join(', ')}`,
    )
  }

  step('AC2: the "choose a file" trigger is present, labelled and enabled - never clicked')
  const chooseFileButton = dialog.getByRole('button', { name: 'Choose image file…' })
  await chooseFileButton.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  if (!(await chooseFileButton.isEnabled())) {
    throw new Error('expected the "choose a file" trigger to be enabled')
  }

  step('AC5: pick the shipped "gate" icon and confirm the card now shows it')
  // Captured before the click, from the swatch's own <img>, rather than asserted as a substring of
  // the resulting src: Vite inlines small assets (this repo's `gate.avif` is one) as a `data:` URL
  // instead of emitting a file whose name carries the id, so the id is not reliably present in
  // either form's src. Comparing the two srcs for equality is the one check that holds regardless
  // of which shape the build happened to choose for this icon.
  const swatchSrc = await dialog
    .getByRole('button', { name: `“${SHIPPED_ICON_ID}” icon` })
    .locator('img')
    .getAttribute('src')
  await dialog.getByRole('button', { name: `“${SHIPPED_ICON_ID}” icon` }).click({
    timeout: CLICK_TIMEOUT_MS,
  })
  await page.waitForFunction(
    (name) => {
      const heading = [...document.querySelectorAll('h3, h2, h4')].find((el) => el.textContent === name)
      const root = heading?.closest('div.items-start')
      return Boolean(root?.querySelector('img'))
    },
    ICONLESS_NAME,
    { timeout: CLICK_TIMEOUT_MS },
  )
  const pickedSrc = await card.locator('img').getAttribute('src')
  if (!pickedSrc || pickedSrc !== swatchSrc) {
    throw new Error(
      `expected the card's <img src> to match the "${SHIPPED_ICON_ID}" swatch's own src ` +
        `("${swatchSrc}"), got "${pickedSrc}"`,
    )
  }
  await shot('shipped-icon-picked')

  step('AC5: clearing the icon brings the code tile back')
  await dialog.getByRole('button', { name: 'Clear icon' }).click({ timeout: CLICK_TIMEOUT_MS })
  await page.waitForFunction(
    (name) => {
      const heading = [...document.querySelectorAll('h3, h2, h4')].find((el) => el.textContent === name)
      const root = heading?.closest('div.items-start')
      return Boolean(root) && !root.querySelector('img')
    },
    ICONLESS_NAME,
    { timeout: CLICK_TIMEOUT_MS },
  )
  if ((await card.locator('img').count()) !== 0) {
    throw new Error(`expected "${ICONLESS_NAME}" to revert to its code tile after clearing the icon`)
  }
  const codeTileText = await card.locator('span').filter({ hasText: 'FU' }).count()
  if (codeTileText === 0) {
    throw new Error(`expected "${ICONLESS_NAME}" to show its "FU" code tile after clearing the icon`)
  }
  await shot('icon-cleared')
}
