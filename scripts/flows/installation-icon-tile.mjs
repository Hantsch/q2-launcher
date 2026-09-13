// Story 067 D5 acceptance flow: the rail, library card and action bar all show a real icon once
// one is set on an installation, an iconless installation keeps its two-letter code tile, the
// icon adds no accessible-name change (AC8), and no icon at all never touches IPC (AC9).
//
// Fixture wiring (`scripts/lib/fixture.mjs`, `populated` variant - the only variant `ui:flow`
// launches, see scripts/flow.mjs). Names below are hardcoded literals mirroring how other flows in
// this repo already address fixture rows/installs (e.g. `controls-drag-reorder.mjs`'s
// `fixture-action-multibind`) rather than importing them - `scripts/lib/fixture.mjs` never exports
// its internal installation ids, only `INSTALL_ONE_ICON_ID` and `INSTALL_UNKNOWN_ENGINE_NAME`:
//   - SHIPPED_NAME ('Fixture Favorite Install', id 'fixture-install-favorite')
//       -> `icon: { kind: 'shipped', id: 'gate' }`
//   - CUSTOM_NAME ('Fixture WriteDir Install', id 'fixture-install-writedir')
//       -> `icon: { kind: 'custom' }`, backed by a real PNG the fixture writes to
//          `userData/installation-icons/<id>.png`
//   - ICONLESS_NAME (the long-name unknown-engine installation) -> no `icon` field
//
// "Survives a restart" (AC3) needs no explicit restart step here: the fixture *is* on-disk state,
// so every fresh launch of the built app (which is exactly what `withApp()`/`flow.mjs` just did
// before calling this function) already reads it back from scratch - same as story 026's other
// flows never re-prove persistence with a second launch.
//
// "No extra request" (AC9) is NOT re-proven here. An earlier version of this flow tried to spy on
// `window.q2.invoke` by reassigning it from `page.evaluate`/`addInitScript`, on the assumption that
// the object `contextBridge.exposeInMainWorld` puts in the main world is a plain, writable object.
// It is not: Electron deep-freezes everything it exposes across the context-bridge boundary
// (`Object.isFrozen(window.q2) === true`, confirmed empirically against this app's own preload) so
// that a compromised renderer cannot tamper with its own privileged surface - precisely the
// property this app's whole contextIsolation design relies on. Reassigning `window.q2.invoke`
// therefore silently no-ops, which made the spy observe zero calls and the flow fail even on a
// correct build. Reaching around that boundary (e.g. a harness-only diagnostics bridge added to
// `src/preload/index.ts`) would mean shipping renderer-observability code for one test's sake -
// out of proportion for a criterion the unit suite already proves precisely:
// `src/renderer/src/components/installations/InstallationTile.test.tsx` › "never calls
// fetchIconDataUrl when the installation has no icon (AC9)" asserts, at the store boundary, that
// `useInstallationIcon` issues no `installations:iconDataUrl` fetch for a shipped or iconless
// installation - the exact guarantee AC9 describes, and the one this file cannot observe from
// outside a frozen bridge. This flow instead proves AC9's other half, the part a unit test cannot
// reach: an iconless installation's tile renders pixel-for-pixel as its code tile, no `<img>`, no
// layout placeholder, on the real built app.

const CLICK_TIMEOUT_MS = 8_000

const SHIPPED_NAME = 'Fixture Favorite Install'
const CUSTOM_NAME = 'Fixture WriteDir Install'
// Mirrors `INSTALL_UNKNOWN_ENGINE_NAME` (scripts/lib/fixture.mjs).
const ICONLESS_NAME =
  'Fixture Unknown Engine Install With A Deliberately Very Long Display Name That Must Truncate Instead Of Pushing The Engine Badge Out Of Any Narrow Panel Row'

/**
 * The rail tile button for one installation. `getByRole('button', { name, exact: true })` reads
 * the button's real accessible name (its `aria-label`, `InstallationRail.tsx`) - resolving to
 * exactly one element here *is* the AC8 proof that an icon changes nothing about it.
 */
// Page-wide, not scoped to the rail: safe only because every call site below runs before the flow
// navigates to Library. Review finding F6/N1 gave the library card's own select-button the same
// `aria-label={installation.name}` the rail already used, so once both are mounted at once this
// resolves two matches - scope it (e.g. `page.locator('#rail')`, if the rail ever gets a landmark)
// before reusing it after a Library navigation.
function railTile(page, name) {
  return page.getByRole('button', { name, exact: true })
}

/** The library card - no dedicated testid, so this locates the `items-start` row that contains
 * the installation's own name heading, mirroring the structural approach other flows in this repo
 * use where no testid exists (e.g. `controls-drag-reorder.mjs`'s category-chip selector). */
function libraryCard(page, name) {
  return page.locator('div.items-start').filter({ has: page.getByRole('heading', { name, exact: true }) })
}

async function assertImgTile(locator, description) {
  const img = locator.locator('img')
  const count = await img.count()
  if (count !== 1) {
    throw new Error(`expected exactly one <img> tile for ${description}, found ${count}`)
  }
  const alt = await img.getAttribute('alt')
  const ariaHidden = await img.getAttribute('aria-hidden')
  if (alt !== '') throw new Error(`${description}'s icon <img> must have alt="", got ${JSON.stringify(alt)}`)
  if (ariaHidden !== 'true') {
    throw new Error(`${description}'s icon <img> must have aria-hidden="true", got ${JSON.stringify(ariaHidden)}`)
  }
  const src = await img.getAttribute('src')
  if (!src) throw new Error(`${description}'s icon <img> has no src`)
  return src
}

async function assertCodeTile(locator, description, expectedCode) {
  const img = locator.locator('img')
  if ((await img.count()) !== 0) {
    throw new Error(`expected ${description} to show its code tile, but an <img> is present`)
  }
  const text = await locator.locator('span').filter({ hasText: expectedCode }).count()
  if (text === 0) throw new Error(`expected ${description} to show the "${expectedCode}" code tile`)
}

export default async function installationIconTile({ page, shot, step }) {
  step('wait for the rail to mount')
  // `assertImgTile`/`assertCodeTile` read `.count()`, which is a snapshot and does not auto-wait
  // the way a Playwright action (`.click()`, `.waitFor()`) does - without this, the very first
  // assertion below can run before the renderer has hydrated and see zero tiles regardless of
  // what is actually seeded.
  await page.waitForSelector('[data-testid="installation-tile"]', { timeout: CLICK_TIMEOUT_MS })

  step('rail: shipped icon renders as an <img>, iconless install keeps its code tile')
  // Not asserted to be (or not be) a `data:` URL: Vite inlines small bundled assets (this repo's
  // `gate.avif` is one, under the default 4 KB threshold) as a `data:` URL rather than emitting a
  // file, so either shape is a correct build output for a shipped icon - only a custom icon's
  // `data:` URL below is guaranteed by this app's own code (main always delivers it that way).
  const railSrc = await assertImgTile(railTile(page, SHIPPED_NAME), 'rail/shipped')
  // Unknown-engine installs fall back to `initialsFor(name)` (src/renderer/src/lib/format.ts),
  // not an engine-code pair - this name's cleaned initials are "FU" (Fixture Unknown...).
  await assertCodeTile(railTile(page, ICONLESS_NAME), 'rail/iconless', 'FU')
  await shot('rail-shipped-and-iconless')

  step('open Library and check the card surface')
  await page.getByTestId('nav-library').click({ timeout: CLICK_TIMEOUT_MS })
  await page.getByRole('heading', { name: SHIPPED_NAME, exact: true }).waitFor({
    state: 'visible',
    timeout: CLICK_TIMEOUT_MS,
  })

  // Not a substring match against the shipped icon's id: Vite inlines small assets (this repo's
  // `gate.avif` is one) as a `data:` URL rather than emitting a file whose name carries the id, so
  // the only build-shape-independent proof that both surfaces show *the same* shipped icon is that
  // their <img src> values are identical.
  const shippedSrc = await assertImgTile(libraryCard(page, SHIPPED_NAME), 'library card/shipped')
  if (shippedSrc !== railSrc) {
    throw new Error(
      `expected the rail and library-card <img src> for "${SHIPPED_NAME}" to be the same shipped ` +
        `icon, got rail="${railSrc}" vs card="${shippedSrc}"`,
    )
  }
  await assertCodeTile(libraryCard(page, ICONLESS_NAME), 'library card/iconless', 'FU')

  step('AC8: the library card select-button keeps a distinguishing accessible name with an icon present')
  // Before an icon exists, this button's accessible name came from its content text (the code
  // span) - an icon replaces that content with a decorative `<img alt="">`, which contributes no
  // accessible text of its own. Resolving by role+name here (rather than reading an attribute) is
  // the real proof: it is exactly how a screen reader/automation user would look the button up, and
  // it fails if the name silently collapsed to the button's generic, install-independent `title`.
  await libraryCard(page, SHIPPED_NAME)
    .getByRole('button', { name: SHIPPED_NAME, exact: true })
    .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  await libraryCard(page, CUSTOM_NAME)
    .getByRole('button', { name: CUSTOM_NAME, exact: true })
    .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })

  step('library card: custom icon renders as an <img> sourced from a data: URL')
  const customSrc = await assertImgTile(libraryCard(page, CUSTOM_NAME), 'library card/custom')
  if (!customSrc.startsWith('data:')) {
    throw new Error(`expected the custom icon's <img src> to be a data: URL, got "${customSrc}"`)
  }
  await shot('library-cards')

  step('action bar: switching the active installation shows the same icon there too')
  await libraryCard(page, CUSTOM_NAME).locator('button').first().click({ timeout: CLICK_TIMEOUT_MS })
  const actionBarTile = page.locator('footer').filter({ hasText: CUSTOM_NAME }).first()
  await actionBarTile.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
  const actionBarImg = page.locator('footer img')
  if ((await actionBarImg.count()) !== 1) {
    throw new Error('expected the action bar to show exactly one <img> for the active custom-icon installation')
  }
  const actionBarSrc = await actionBarImg.getAttribute('src')
  if (!actionBarSrc?.startsWith('data:')) {
    throw new Error(`expected the action bar's <img src> to be a data: URL, got "${actionBarSrc}"`)
  }
  await shot('action-bar-custom-icon')
}
