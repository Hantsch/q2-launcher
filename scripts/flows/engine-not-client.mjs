// Story 068 D5 acceptance flow: the app says "engine", never "client" (AC1 on the real surface),
// and an installation whose engine is outside the supported set is marked as unsupported in text
// wherever its engine is shown (AC4) while a supported one is not (AC4's negative half).
//
// The `unknown`-engine install is the fixture's third populated installation
// (`INSTALL_UNKNOWN_ENGINE_NAME`, `scripts/lib/fixture.mjs`), imported rather than copied so the
// selectors cannot drift from what the fixture actually wrote. No fourth install is needed - see
// the story's "No fourth fixture installation" decision.
//
// Selectors, not guesses:
//   nav-home, nav-library      TitleBar.tsx
//   library-add                LibraryView.tsx (the header's single add menu)
//   engine-badge               EngineBadge.tsx via `Badge`'s `testId` prop (primitives.tsx)
//   installation-tile          InstallationRail.tsx's `RailTile`, `aria-label` is the install name
//   [role="tooltip"]           HoverCard.tsx's portalled card - the rail's engine surface
//
// Badge text is read with `textContent()`, never `innerText()`: `Badge` is `uppercase` through CSS,
// so `innerText` reports what the glyphs look like and not what the app actually says - same as
// `engine-badge-surfaces`.
import { INSTALL_DEMO_UPGRADE_NAME, INSTALL_UNKNOWN_ENGINE_NAME } from '../lib/fixture.mjs'
import { railTile } from '../lib/flow-common.mjs'

const TIMEOUT_MS = 8_000

/**
 * A populated install whose root really holds an `r1q2.exe`, i.e. a supported engine. The app's
 * startup `validateAll()` re-derives `engineKind` from disk, so a seeded `engineKind: 'r1q2'` alone
 * (the first populated installs, whose roots hold no executable) reads back as `unknown`.
 */
const SUPPORTED_INSTALL_NAME = INSTALL_DEMO_UPGRADE_NAME

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

/** The name row of one installation's library card - the badge is the heading's own sibling. */
function libraryCardNameRow(page, name) {
  return page.locator('h2').filter({ hasText: name }).first().locator('xpath=..')
}

/**
 * A string this flow knows is on the library screen, asserted before the real check so an empty
 * or failed `innerText` read cannot pass AC1 vacuously. `R1Q2` is the supported install's badge,
 * which the library card shows.
 */
const SCRAPE_SENTINEL = /r1q2/i

/**
 * Story 081 deleted the old hero, so home shows no installation text - and the placeholder
 * title/lead that replaced it has since been dropped too (User feedback). What still always
 * mentions "Quake II" on this screen is the news hero's built-in welcome slide (`home.hero.welcome`
 * step 1, en.json), which is what the fixture's empty feed renders. Each surface therefore gets its
 * own vacuity sentinel instead of sharing one that assumed an engine badge was present everywhere.
 */
const HOME_SCRAPE_SENTINEL = /quake\s*ii/i

/** AC1: everything the user can actually read on the current screen, paths stripped. */
async function assertNoClientWord(page, surface, sentinel = SCRAPE_SENTINEL) {
  const rendered = await page.evaluate(() => document.body.innerText)
  const authored = rendered.replace(ABSOLUTE_PATH_RUN, ' ')
  if (!sentinel.test(authored)) {
    throw new Error(
      `${surface}: the visible-text read returned nothing recognizable (no ${sentinel} in ` +
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
  await shot('home')

  step('open the library')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })

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
    railTile(page, INSTALL_UNKNOWN_ENGINE_NAME, 'testid'),
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
  await openRailCard(
    page,
    railTile(page, SUPPORTED_INSTALL_NAME, 'testid'),
    railCard,
    SUPPORTED_INSTALL_NAME,
  )
  await assertBadgeReads(
    railCard,
    `rail card for "${SUPPORTED_INSTALL_NAME}"`,
    SUPPORTED_ENGINE_LABEL,
  )

  // The hero panel this section used to assert against was deleted by story 081 (AC3) - the home
  // route no longer has anything that badges the active installation, so there is nothing left
  // here to check.

  // --- AC1 on the real surface -------------------------------------------------------------------
  step('open home again and assert no visible text on it says client')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await assertNoClientWord(page, 'home', HOME_SCRAPE_SENTINEL)

  step('assert no visible text on the library says client')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  await page.getByTestId('library-add').waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await assertNoClientWord(page, 'library')
}
