// Story 068 D5 acceptance flow: the app says "engine", never "client" (AC1 on the real surface),
// the create-installation dialog offers exactly the two supported engines under a field labelled
// "Engine" (AC2), and an installation whose engine is outside the supported set is marked as
// unsupported in text wherever its engine is shown (AC4) while a supported one is not (AC4's
// negative half).
//
// The create dialog is the first surface any flow in this repo opens, and it sits one click away
// from a native folder picker (`installations:pickFolder` -> `dialog.showOpenDialog`) that
// Playwright cannot drive at all (docs/UI-VERIFICATION.md, "Known blind spots"). That picker only
// gates *submit*: the engine `Select` renders as soon as the Modal mounts. So this flow reads the
// select and closes the dialog with Escape - it never touches "Browse" and never submits. Nothing
// here may grow a submit step later without also solving the picker.
//
// The `unknown`-engine install is the fixture's third populated installation
// (`INSTALL_UNKNOWN_ENGINE_NAME`, `scripts/lib/fixture.mjs`), imported rather than copied so the
// selectors cannot drift from what the fixture actually wrote. No fourth install is needed - see
// the story's "No fourth fixture installation" decision.
//
// Selectors, not guesses:
//   nav-home, nav-library      TitleBar.tsx
//   library-create             LibraryView.tsx (story 068 D3, mirrors library-auto-detect)
//   [role="dialog"]            Modal.tsx's portalled panel, named by `aria-label`
//   engine-badge               EngineBadge.tsx via `Badge`'s `testId` prop (primitives.tsx)
//   installation-tile          InstallationRail.tsx's `RailTile`, `aria-label` is the install name
//   [role="tooltip"]           HoverCard.tsx's portalled card - the rail's engine surface
//   section.hero-fallback      HeroPanel.tsx's `<section>` (class from styles/, not a test hook)
//
// Two text-reading rules this file sticks to, both for the same reason - the design system
// uppercases through CSS, so `innerText` reports what the glyphs look like and not what the app
// actually says:
//   * badge text is read with `textContent()`, never `innerText()` (`Badge` is `uppercase`), so an
//     exact-match assertion on the real label is writable at all - same as `engine-badge-surfaces`;
//   * the engine field's accessible name is matched case-insensitively, because `Field`'s `<label>`
//     carries `.stencil` (`text-transform: uppercase`, styles/surfaces.css) and whether Chromium
//     folds that into the computed accessible name is a browser detail, not this story's claim. The
//     claim - the label reads "Engine" - is asserted exactly, on the associated `<label>`'s own
//     `textContent` via `HTMLSelectElement.labels`.
import { INSTALL_UNKNOWN_ENGINE_NAME } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

/** The fixture's first populated install: `engineKind: 'r1q2'`, i.e. a supported engine. */
const SUPPORTED_INSTALL_NAME = 'Fixture Favorite Install'

/** Mirrors `SUPPORTED_ENGINE_DEFINITIONS`' labels (src/shared/types/engine.ts) - AC2's whole list. */
const SUPPORTED_ENGINE_OPTIONS = ['R1Q2', 'Q2PRO']

/** `dialog.create.engineLabel` (en.json), as the DOM holds it - the CSS uppercases it. */
const ENGINE_FIELD_LABEL = 'Engine'

/** `engine.unsupportedLabel` applied to `engineLabel('unknown')` (lib/engine-display.ts). */
const UNSUPPORTED_UNKNOWN_LABEL = 'Unknown engine (unsupported)'

/** `engineLabel('r1q2')`, bare: a supported engine carries no marker at all. */
const SUPPORTED_ENGINE_LABEL = 'R1Q2'

/** AC1 on the real surface: the whole word, in any casing, anywhere the user can read it. */
const CLIENT_WORD = /\bclient\b/i

/**
 * Absolute filesystem paths are shown verbatim by the library card and the rail card
 * (`shortenPath`), and they are the one visible text the app does not author: on a checkout under
 * e.g. `C:\work\some-client\q2-launcher` they would fail AC1 for a reason that has nothing to do
 * with the launcher's vocabulary. Path runs are therefore removed before matching - the assertion
 * is about the app's wording, not about the directory the repo happens to sit in.
 */
const ABSOLUTE_PATH_RUN = /[A-Za-z]:[\\/][^\s]*/g

/** AC4: the badge on `scope` reads exactly `expected` - marker included, or provably absent. */
async function assertBadgeReads(scope, surface, expected) {
  const badge = scope.getByTestId('engine-badge').first()
  await badge.scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  await badge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const text = (await badge.textContent())?.trim() ?? ''
  if (text !== expected) {
    throw new Error(
      `${surface}: expected the engine badge to read ${JSON.stringify(expected)}, got ` +
        `${JSON.stringify(text)}`,
    )
  }
  console.log(`${surface}: badge reads ${JSON.stringify(text)}`)
}

/**
 * Opens one rail tile's hover card.
 *
 * Verbatim from `engine-badge-surfaces.mjs`, for the reason documented there: `HoverCard` opens on
 * `pointerenter`, and Chromium only fires that on a real transition into the element, so a
 * `hover()` that lands where the pointer already is dispatches nothing and the card never opens.
 * Park the pointer off the rail first, let any previous card go away, then hover.
 */
async function openRailCard(page, tile, card, name) {
  await page.mouse.move(0, 0)
  await card.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await tile.hover({ timeout: TIMEOUT_MS })
  try {
    await card.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  } catch (error) {
    throw new Error(`the rail hover card for "${name}" never opened: ${error.message}`)
  }
}

/** The rail tile for one installation, addressed by the `aria-label` the rail puts on it. */
function railTile(page, name) {
  return page.locator(`[data-testid="installation-tile"][aria-label="${name}"]`)
}

/**
 * Makes `name` the active installation by clicking its rail tile (`setActiveInstallation`, a real
 * IPC round trip) and waits for the tile to report itself active. The pointer is parked off the
 * rail first: a hover card left open from a previous step is portalled over the tiles and would
 * swallow the click.
 */
async function activate(page, name) {
  await page.mouse.move(0, 0)
  await page.locator('[role="tooltip"]').waitFor({ state: 'detached', timeout: TIMEOUT_MS })
  await railTile(page, name).click({ timeout: TIMEOUT_MS })
  await page
    .locator(`[data-testid="installation-tile"][aria-label="${name}"][aria-current="true"]`)
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

/** The name row of one installation's library card - the badge is the heading's own sibling. */
function libraryCardNameRow(page, name) {
  return page.locator('h2').filter({ hasText: name }).first().locator('xpath=..')
}

/**
 * A string this flow knows is on both screens it scrapes, asserted before the real check so an
 * empty or failed `innerText` read cannot pass AC1 vacuously. `R1Q2` is the supported install's
 * badge, which the hero shows on home and the library card shows on the library.
 */
const SCRAPE_SENTINEL = /r1q2/i

/** AC1: everything the user can actually read on the current screen, paths stripped. */
async function assertNoClientWord(page, surface) {
  const rendered = await page.evaluate(() => document.body.innerText)
  const authored = rendered.replace(ABSOLUTE_PATH_RUN, ' ')
  if (!SCRAPE_SENTINEL.test(authored)) {
    throw new Error(
      `${surface}: the visible-text read returned nothing recognizable (no ${SCRAPE_SENTINEL} in ` +
        `${authored.length} chars) - the "no client" assertion below would be vacuous`,
    )
  }
  const offending = authored
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => CLIENT_WORD.test(line))
  if (offending.length > 0) {
    throw new Error(
      `${surface}: ${offending.length} visible line(s) still call something a client: ` +
        `${JSON.stringify(offending)}`,
    )
  }
  console.log(`${surface}: no visible line matches /\\bclient\\b/i (${authored.length} chars read)`)
}

export default async function engineNotClient({ page, shot, step }) {
  step('open home')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await page.locator('section.hero-fallback').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('home')

  // --- AC2: the create dialog, opened from the library, never submitted -------------------------
  step('open the library')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })

  step('open the create-installation dialog')
  await page.getByTestId('library-create').click({ timeout: TIMEOUT_MS })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await shot('create-dialog')

  step('assert the engine select offers exactly the supported engines')
  // `Field` + `Select` (components/ui/controls.tsx) put exactly one `<select>` in this dialog; the
  // location and name fields are `<input>`s. Asserting the count makes that a checked assumption
  // rather than an "expected one, took the first" guess.
  const selects = dialog.locator('select')
  await selects.first().waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const selectCount = await selects.count()
  if (selectCount !== 1) {
    throw new Error(
      `expected the create dialog to hold exactly one <select> (the engine field), got ` +
        `${selectCount}`,
    )
  }
  const engineSelect = selects.first()
  const optionLabels = (await engineSelect.locator('option').allTextContents()).map((label) =>
    label.trim(),
  )
  const expected = JSON.stringify(SUPPORTED_ENGINE_OPTIONS)
  if (JSON.stringify(optionLabels) !== expected) {
    throw new Error(
      `expected the engine select to offer exactly ${expected}, got ${JSON.stringify(optionLabels)}`,
    )
  }
  console.log(`create dialog: engine options ${JSON.stringify(optionLabels)}`)

  step('assert the engine field is labelled "Engine"')
  // `HTMLSelectElement.labels` instead of a `label[for="..."]` query: the id comes from React's
  // `useId()`, whose delimiters are not CSS-identifier-safe, and `.labels` is the same association
  // the accessibility tree reads.
  const labelText = await engineSelect.evaluate((element) => {
    const label = element.labels?.[0]
    return label ? (label.textContent ?? '').trim() : null
  })
  if (labelText !== ENGINE_FIELD_LABEL) {
    throw new Error(
      `expected the engine select's associated <label> to read ` +
        `${JSON.stringify(ENGINE_FIELD_LABEL)}, got ${JSON.stringify(labelText)}`,
    )
  }
  // And the same thing through the accessibility tree, so the label is not merely a visual one.
  // Case-insensitive on purpose - see this file's header comment on `.stencil`.
  const namedCombobox = dialog.getByRole('combobox', { name: /^engine$/i })
  const namedCount = await namedCombobox.count()
  if (namedCount !== 1) {
    throw new Error(
      `expected exactly one combobox named "Engine" in the create dialog, got ${namedCount}`,
    )
  }

  step('close the dialog without submitting it')
  // Escape, the harness's own way to close a `Modal` - and the only safe one here: "Create
  // installation" is one step from the native folder picker this flow must never reach.
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached', timeout: TIMEOUT_MS })

  // --- AC4: library cards ------------------------------------------------------------------------
  step('assert the library card of the unsupported-engine install is marked')
  await assertBadgeReads(
    libraryCardNameRow(page, INSTALL_UNKNOWN_ENGINE_NAME),
    `library card for the unknown-engine install`,
    UNSUPPORTED_UNKNOWN_LABEL,
  )

  step('assert the library card of a supported-engine install carries no marker')
  await assertBadgeReads(
    libraryCardNameRow(page, SUPPORTED_INSTALL_NAME),
    `library card for "${SUPPORTED_INSTALL_NAME}"`,
    SUPPORTED_ENGINE_LABEL,
  )
  await shot('library-badges')

  // --- AC4: the rail's hover cards ---------------------------------------------------------------
  const railCard = page.locator('[role="tooltip"]')

  step('assert the rail card of the unsupported-engine install is marked')
  await openRailCard(
    page,
    railTile(page, INSTALL_UNKNOWN_ENGINE_NAME),
    railCard,
    INSTALL_UNKNOWN_ENGINE_NAME,
  )
  await assertBadgeReads(
    railCard,
    'rail card for the unknown-engine install',
    UNSUPPORTED_UNKNOWN_LABEL,
  )
  await shot('rail-card-unsupported')

  step('assert the rail card of a supported-engine install carries no marker')
  await openRailCard(page, railTile(page, SUPPORTED_INSTALL_NAME), railCard, SUPPORTED_INSTALL_NAME)
  await assertBadgeReads(
    railCard,
    `rail card for "${SUPPORTED_INSTALL_NAME}"`,
    SUPPORTED_ENGINE_LABEL,
  )

  // --- AC4: the hero panel -----------------------------------------------------------------------
  // The hero badges the *active* installation, so each half of AC4 needs that install active first.
  // Clicking the tile is the user's own way to do that (`setActiveInstallation`); the fixture's
  // active install is restored at the end of the flow.
  const hero = page.locator('section.hero-fallback')

  step('make the unsupported-engine install active and open home')
  await activate(page, INSTALL_UNKNOWN_ENGINE_NAME)
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await hero.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert the hero panel marks the unsupported engine')
  await assertBadgeReads(
    hero,
    'hero panel (unknown-engine install active)',
    UNSUPPORTED_UNKNOWN_LABEL,
  )
  await shot('hero-unsupported')

  step("restore the fixture's active install and assert the hero carries no marker")
  await activate(page, SUPPORTED_INSTALL_NAME)
  await assertBadgeReads(
    hero,
    `hero panel ("${SUPPORTED_INSTALL_NAME}" active)`,
    SUPPORTED_ENGINE_LABEL,
  )
  await shot('hero-supported')

  // --- AC1 on the real surface -------------------------------------------------------------------
  step('assert no visible text on home says client')
  await assertNoClientWord(page, 'home')

  step('assert no visible text on the library says client')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-create').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await assertNoClientWord(page, 'library')
}
