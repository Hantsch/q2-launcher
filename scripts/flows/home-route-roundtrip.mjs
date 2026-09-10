// Story 081 D4 acceptance flow: "the move is verified on the real surface". D1-D3 pulled `home` out
// of the shell (no shell component imports anything from the home module anymore) and reduced
// `HomeView.tsx` to a title+lead placeholder (`home.title`/`home.lead`, en.json). This flow is the
// e2e proof that the route still works after that move: `nav-home` (TitleBar.tsx's own hardcoded
// button, untouched by this story) still reaches a real, rendering `HomeView`, a full round trip
// away and back re-renders it with no console errors, and none of the three fixed shell zones
// (titlebar/rail/action-bar) so much as twitch across the trip — they are chrome the shell owns,
// not something a module swap should ever be able to perturb.
//
// Selectors, not guesses:
//   nav-home, nav-config     TitleBar.tsx (hardcoded nav buttons, story 081 does not touch them)
//   config-create-profile    ConfigView.tsx ("New profile" button, present on the list screen
//                             regardless of fixture variant — used only as "the config screen's own
//                             content has mounted", not as anything this flow clicks)
//   home.title / home.lead   src/renderer/src/i18n/locales/en.json — HomeView.tsx's own two strings
//
// The three shell zones carry no bespoke testid (TitleBar.tsx/InstallationRail.tsx/ActionBar.tsx are
// a plain `<header>`/`<aside>`/`<footer>`, per this story's own read of the shell) — their implicit
// ARIA roles (`banner`/`complementary`/`contentinfo`) are what `page.getByRole()` resolves them by,
// the same role `engine-badge-surfaces.mjs` already uses for the action bar.
//
// Console errors: `scripts/lib/harness.mjs`'s `withApp()` installs the `page.on('console', ...)`
// listener that fills `log.messages` for the whole run, and `scripts/flow.mjs` hands that same `log`
// to every flow's default export — `ui:flow` itself never reads it (unlike `ui:shot`/`ui:a11y`/
// `ui:verify`'s own pass/fail via `computeExitCode()`), so this flow asserts `log.errors` is empty
// itself, using the harness's own collector rather than adding a second one.
const TIMEOUT_MS = 8_000

/** The three zones this flow proves are geometrically unchanged by a full route round trip — fixed
 * chrome per CLAUDE.md's shell description, so an exact match (no tolerance) is expected. */
const ZONE_ROLES = {
  titlebar: 'banner',
  rail: 'complementary',
  actionBar: 'contentinfo',
}

async function captureZoneRects(page) {
  const rects = {}
  for (const [name, role] of Object.entries(ZONE_ROLES)) {
    rects[name] = await page.getByRole(role).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
  }
  return rects
}

function assertZonesIdentical(before, after) {
  for (const name of Object.keys(ZONE_ROLES)) {
    for (const key of ['x', 'y', 'width', 'height']) {
      if (before[name][key] !== after[name][key]) {
        throw new Error(
          `${name}.${key} changed across the home round trip: before=${before[name][key]} ` +
            `after=${after[name][key]} (full before=${JSON.stringify(before[name])} ` +
            `after=${JSON.stringify(after[name])}) - the shell's fixed chrome must not move when a ` +
            `module screen is swapped out and back in`,
        )
      }
    }
  }
}

async function waitForHome(page) {
  // `getByText('Home')` alone would match two things at once - the titlebar's own `nav-home` button
  // (`nav.home` is also translated "Home") and `HomeView`'s `<h1>` - so this waits on the heading
  // role specifically, the one element `home.title` actually renders as (`HomeView.tsx`'s `<h1>`).
  await page
    .getByRole('heading', { name: 'Home', level: 1 })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  await page
    .getByText("This is where your Quake II news and activity will live.", { exact: true })
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })
}

export default async function homeRouteRoundtrip({ page, app: _app, shot, step, log }) {
  step('open home')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await waitForHome(page)

  const before = await captureZoneRects(page)

  await shot('home')

  step('navigate away')
  await page.getByTestId('nav-config').click({ timeout: TIMEOUT_MS })
  await page
    .getByTestId('config-create-profile')
    .waitFor({ state: 'visible', timeout: TIMEOUT_MS })

  step('navigate back to home')
  await page.getByTestId('nav-home').click({ timeout: TIMEOUT_MS })
  await waitForHome(page)

  const after = await captureZoneRects(page)

  step('assert the titlebar/rail/action-bar are pixel-identical before and after the round trip')
  assertZonesIdentical(before, after)
  console.log(
    'titlebar/rail/action-bar bounding boxes are identical before and after the home round trip',
  )

  step('assert zero console errors across the whole round trip')
  if (log.errors.length > 0) {
    throw new Error(
      `expected zero console errors during the home round trip, got ${log.errors.length}: ` +
        log.errors.map((message) => message.text).join('; '),
    )
  }
  console.log('zero console errors observed during the home round trip')

  await shot('home-after-roundtrip')
}
