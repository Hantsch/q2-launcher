// Story 065 D5 acceptance flow: every surface that names an installation shows that
// installation's engine as a badge next to the name (AC1), an `unknown` engine reads as
// "Unknown engine (unsupported)" rather than blank (AC3 here, plus story 068's AC4 marker - see
// `UNKNOWN_ENGINE_LABEL` below), and a long name truncates instead of pushing the badge out of
// its panel (AC4).
//
// Runs the whole walk at the app's own minimum window size (`940x620`, mirrors
// `scripts/lib/screens.mjs`'s `VIEWPORT_MIN`), because AC4 is only a real measurement in a panel
// narrow enough to actually clip the name - at the 1280px default the 320px assignments popover
// would still clip, but the config list's rows would not.
//
// The `unknown`-engine install with the 156-character name is the fixture's third populated
// installation (`INSTALL_UNKNOWN_ENGINE_NAME`, `scripts/lib/fixture.mjs`) - imported here rather
// than copied, so the selectors below cannot drift from what the fixture actually wrote.
//
// Selectors, not guesses:
//   engine-badge          EngineBadge.tsx via `Badge`'s `testId` prop (primitives.tsx) - the one
//                         component every one of these six surfaces renders (AC2)
//   installation-tile     InstallationRail.tsx's `RailTile`, `aria-label` is the install's name
//   [role="tooltip"]      HoverCard.tsx's portalled card - the rail's hover surface
//   .hero-fallback        HeroPanel.tsx's `<section>` (class from styles/, not a test hook)
//   footer (contentinfo)  ActionBar.tsx's root element
//   nav-home/-library/-config, config-profile-row   TitleBar.tsx / ConfigView.tsx
//   "N of M assigned"     AssignmentsMenu.tsx's trigger, which portals `ProfileAssignmentsPanel`
//
// Badge text is read with `textContent()`, never `innerText()`: `Badge` renders through a CSS
// `uppercase`, so `innerText` would report "UNKNOWN ENGINE" and an exact-match assertion on the
// real label would be impossible to write honestly.
import { resize } from '../lib/harness.mjs'
import { INSTALL_UNKNOWN_ENGINE_NAME } from '../lib/fixture.mjs'

const TIMEOUT_MS = 8_000

/** Mirrors src/shared/constants.ts (`WINDOW_MIN_WIDTH/HEIGHT`) and `screens.mjs`'s VIEWPORT_MIN. */
const NARROW_VIEWPORT = { width: 940, height: 620 }

/**
 * Mirrors `engineDisplayLabel('unknown', t)` (src/renderer/src/lib/engine-display.ts): story 068
 * D4 composes `engine.unsupportedLabel` onto `engineLabel('unknown')`, because `unknown` is not a
 * supported engine - so this flow's AC3 assertions read the marked form. The engine name half is
 * still `engineLabel`'s deliberately untranslated literal.
 */
const UNKNOWN_ENGINE_LABEL = 'Unknown engine (unsupported)'

/** The two short-named, `r1q2` fixture installs, so AC1 is asserted for ordinary rows too. */
const SHORT_NAMED_INSTALLS = ['Fixture Favorite Install', 'Fixture WriteDir Install']

/** `populatedInstallations()` (scripts/lib/fixture.mjs) - a per-installation list must show all. */
const EXPECTED_INSTALL_COUNT = 3

function boxOf(box, name) {
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error(`${name} has no usable bounding box - got ${JSON.stringify(box)}`)
  }
  return box
}

/**
 * AC1's actual claim, per surface: an engine badge exists inside `scope`, is visible, and has a
 * real, non-zero box. Returns the badge locator so callers can go on to read its text.
 */
async function assertBadgeVisible(scope, surface) {
  const badge = scope.getByTestId('engine-badge').first()
  await badge.scrollIntoViewIfNeeded({ timeout: TIMEOUT_MS })
  await badge.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  boxOf(await badge.boundingBox(), `${surface}'s engine badge`)
  return badge
}

/** AC3: the badge on the `unknown`-engine install reads the real label, not a blank or an id. */
async function assertUnknownEngineLabel(badge, surface) {
  const text = (await badge.textContent())?.trim() ?? ''
  if (text !== UNKNOWN_ENGINE_LABEL) {
    throw new Error(
      `${surface}: expected the unknown-engine badge to read ${JSON.stringify(
        UNKNOWN_ENGINE_LABEL,
      )}, got ${JSON.stringify(text)}`,
    )
  }
}

/** AC4, half one: the name element is visually clipped, i.e. it really did truncate. */
async function assertNameClipped(nameLocator, surface) {
  const overflow = await nameLocator.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    text: (el.textContent || '').length,
  }))
  if (!(overflow.scrollWidth > overflow.clientWidth)) {
    throw new Error(
      `${surface}: the long installation name is not clipped - scrollWidth=` +
        `${overflow.scrollWidth} is not greater than clientWidth=${overflow.clientWidth} ` +
        `(name length ${overflow.text}); either the name did not truncate or the panel is not ` +
        `narrow enough for AC4 to mean anything here`,
    )
  }
  return overflow
}

/** AC4, half two: the badge is still inside the panel - not pushed out by the name. */
async function assertBadgeInsidePanel(badge, panel, surface) {
  const badgeBox = boxOf(await badge.boundingBox(), `${surface}'s engine badge`)
  const panelBox = boxOf(await panel.boundingBox(), `${surface}'s panel`)
  const tolerance = 0.5 // sub-pixel layout rounding, not a slack allowance
  const outside =
    badgeBox.x < panelBox.x - tolerance ||
    badgeBox.y < panelBox.y - tolerance ||
    badgeBox.x + badgeBox.width > panelBox.x + panelBox.width + tolerance ||
    badgeBox.y + badgeBox.height > panelBox.y + panelBox.height + tolerance
  if (outside) {
    throw new Error(
      `${surface}: the engine badge is not fully inside its panel - badge=` +
        `${JSON.stringify(badgeBox)} panel=${JSON.stringify(panelBox)} (AC4: a long name must ` +
        `truncate rather than push the badge out)`,
    )
  }
}

/**
 * Opens one rail tile's hover card.
 *
 * `HoverCard.tsx` opens on `pointerenter` after a 140ms delay - and Chromium only fires
 * `pointerenter` on a mouse *transition* into the element, so a `mouse.move()` that lands on a
 * point the pointer already occupies (which is what Playwright's `hover()` does when the tile
 * happens to be under the last cursor position, e.g. after the previous iteration's own
 * hover/scroll) dispatches nothing at all and the card silently never opens. Observed as a
 * roughly-1-in-3 timeout on this step before the explicit `mouse.move()` away below.
 *
 * So: park the pointer somewhere that is definitely not a rail tile, wait for any card left over
 * from the previous iteration to go away, and only then hover. The assertion is unchanged - if
 * the card genuinely does not open, `waitFor` still fails the flow.
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

/** The `<li>` for one installation inside either config assignment list. */
function assignmentRow(scope, installName) {
  return scope.locator('li').filter({ hasText: installName }).first()
}

export default async function engineBadgeSurfaces({ page, app, shot, step }) {
  step('narrow the window to the app minimum so AC4 has something to clip')
  await resize(app, NARROW_VIEWPORT)

  // --- AC1: home - rail hover card, hero panel, action bar ---------------------------------------
  step('open home')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })

  step('assert the hero panel badges the active installation engine')
  await assertBadgeVisible(page.locator('section.hero-fallback'), 'hero panel')

  step('assert the action bar badges the active installation engine')
  await assertBadgeVisible(page.getByRole('contentinfo'), 'action bar')

  step('count the rail tiles')
  const railTiles = page.getByTestId('installation-tile')
  const railCount = await railTiles.count()
  if (railCount !== EXPECTED_INSTALL_COUNT) {
    throw new Error(
      `expected ${EXPECTED_INSTALL_COUNT} installation tiles in the rail (the populated ` +
        `fixture's installations), got ${railCount}`,
    )
  }
  for (const name of [...SHORT_NAMED_INSTALLS, INSTALL_UNKNOWN_ENGINE_NAME]) {
    step(`assert the rail hover card for "${name}" badges its engine`)
    const tile = page.locator(`[data-testid="installation-tile"][aria-label="${name}"]`)
    const card = page.locator('[role="tooltip"]')
    await openRailCard(page, tile, card, name)
    const badge = await assertBadgeVisible(card, `rail hover card for "${name}"`)
    if (name === INSTALL_UNKNOWN_ENGINE_NAME) {
      await assertUnknownEngineLabel(badge, 'rail hover card')
      await shot('rail-card-unknown-engine')
    }
  }

  // --- AC1/AC3: library cards --------------------------------------------------------------------
  step('open library and assert every card badges its engine next to the name')
  await page.getByTestId('nav-library').click({ timeout: TIMEOUT_MS })
  for (const name of [...SHORT_NAMED_INSTALLS, INSTALL_UNKNOWN_ENGINE_NAME]) {
    // The badge is the heading's own sibling in the name row (`LibraryView.tsx`), so the
    // heading's parent is exactly "next to the name" - not merely "somewhere in the card".
    const nameRow = page.locator('h2').filter({ hasText: name }).first().locator('xpath=..')
    const badge = await assertBadgeVisible(nameRow, `library card for "${name}"`)
    if (name === INSTALL_UNKNOWN_ENGINE_NAME) {
      await assertUnknownEngineLabel(badge, 'library card')
      await shot('library-unknown-engine')
    }
  }

  // --- AC1/AC3/AC4: config module, InstallationProfilesPanel -------------------------------------
  step('open the config list and assert its by-installation rows badge their engine')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })

  const byInstallRows = page
    .locator('li')
    .filter({ hasText: INSTALL_UNKNOWN_ENGINE_NAME })
    .first()
    .locator('xpath=ancestor::ul[1]')
    .locator('> li')
  await byInstallRows.first().waitFor({ state: 'attached', timeout: TIMEOUT_MS })
  const byInstallCount = await byInstallRows.count()
  if (byInstallCount !== EXPECTED_INSTALL_COUNT) {
    throw new Error(
      `InstallationProfilesPanel: expected one row per installation ` +
        `(${EXPECTED_INSTALL_COUNT}), got ${byInstallCount}`,
    )
  }
  for (let index = 0; index < byInstallCount; index += 1) {
    await assertBadgeVisible(byInstallRows.nth(index), `InstallationProfilesPanel row ${index}`)
  }

  step('assert AC3/AC4 on the long unknown-engine row in InstallationProfilesPanel')
  const byInstallLongRow = assignmentRow(page, INSTALL_UNKNOWN_ENGINE_NAME)
  const byInstallList = byInstallLongRow.locator('xpath=ancestor::ul[1]')
  const byInstallBadge = await assertBadgeVisible(byInstallLongRow, 'InstallationProfilesPanel')
  await assertUnknownEngineLabel(byInstallBadge, 'InstallationProfilesPanel')
  const byInstallOverflow = await assertNameClipped(
    byInstallLongRow.locator('span.truncate').first(),
    'InstallationProfilesPanel',
  )
  await assertBadgeInsidePanel(byInstallBadge, byInstallList, 'InstallationProfilesPanel')
  console.log(
    `InstallationProfilesPanel: name clipped ${byInstallOverflow.scrollWidth}px into ` +
      `${byInstallOverflow.clientWidth}px, badge still inside the list box`,
  )
  await shot('config-list-by-installation')

  // --- AC1/AC3/AC4: config module, ProfileAssignmentsPanel ---------------------------------------
  step('open Plain Profile and its assignments popover')
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: 'Plain Profile' })
    .first()
    .click({ timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: /assigned/i }).click({ timeout: TIMEOUT_MS })

  const popover = page
    .locator('li')
    .filter({ hasText: INSTALL_UNKNOWN_ENGINE_NAME })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"panel-raised")][1]')
  await popover.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('assert every assignment row badges its engine')
  const assignmentRows = popover.locator('ul > li')
  const assignmentCount = await assignmentRows.count()
  if (assignmentCount !== EXPECTED_INSTALL_COUNT) {
    throw new Error(
      `ProfileAssignmentsPanel: expected one row per installation ` +
        `(${EXPECTED_INSTALL_COUNT}), got ${assignmentCount}`,
    )
  }
  for (let index = 0; index < assignmentCount; index += 1) {
    await assertBadgeVisible(assignmentRows.nth(index), `ProfileAssignmentsPanel row ${index}`)
  }

  step('assert AC3/AC4 on the long unknown-engine row in ProfileAssignmentsPanel')
  const assignLongRow = assignmentRow(popover, INSTALL_UNKNOWN_ENGINE_NAME)
  const assignBadge = await assertBadgeVisible(assignLongRow, 'ProfileAssignmentsPanel')
  await assertUnknownEngineLabel(assignBadge, 'ProfileAssignmentsPanel')
  const assignOverflow = await assertNameClipped(
    assignLongRow.locator('span.truncate').first(),
    'ProfileAssignmentsPanel',
  )
  await assertBadgeInsidePanel(assignBadge, popover, 'ProfileAssignmentsPanel')
  console.log(
    `ProfileAssignmentsPanel: name clipped ${assignOverflow.scrollWidth}px into ` +
      `${assignOverflow.clientWidth}px, badge still inside the 320px popover`,
  )
  await shot('config-assignments-popover')

  // Leave the app as this flow found it: the popover is transient UI, but a flow that ends with
  // an open portal makes any later screenshot of this same session read as "assignments open".
  step('close the assignments popover')
  await page.keyboard.press('Escape')
  await popover.waitFor({ state: 'detached', timeout: TIMEOUT_MS })
}
