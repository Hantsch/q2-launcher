// The screen registry UI verification walks: `scripts/verify.mjs` resolves which
// entries a run covers and `scripts/lib/session.mjs` visits them (story 027
// replaced story 026's separate shot.mjs/a11y.mjs with those two). Each entry is
// `{ id, variant, viewports, navigate }`: `navigate(page)` performs whatever
// clicks are needed to reach that screen starting from the default route — there
// is no URL to navigate to, `route` is plain Zustand state, see
// src/renderer/src/store/useLauncher.ts. Since story 027 the app is no longer
// relaunched per screen; `session.mjs` restores that starting point itself
// (`resetToBaseState()`) before every `navigate()`.
//
// Optional `coldStart?: boolean` on an entry marks a screen whose subject *is*
// the app's boot state: `session.mjs` gives it its own launch per viewport
// instead of visiting it inside the batched session. None of the 17 entries
// below need it today.
//
// Selectors mirror story 026 D3's `data-testid` additions exactly — read
// TitleBar.tsx, ConfigView.tsx and OverviewKeyboardPanel.tsx before changing
// any of the strings below, they are not guesses:
//   nav-<moduleId> / nav-settings   (TitleBar.tsx)
//   config-tab-<tabId>              (ConfigView.tsx, tabId is the DetailTab union)
//   config-profile-row              (ConfigView.tsx, one per profile in the list)
//   keycap-<keyName>                (OverviewKeyboardPanel.tsx)
// Story 017 retired the edit-mode toggle: outside test mode a keycap click
// opens KeyBindDialog directly, so the former "Start editing" click below is
// gone — the repo ships only `en` today (story 026 Decisions).
//
// Story 037 D3 adds two more, mirroring D1's own testid additions exactly —
// read RawFileTab.tsx, CreateProfileDialog.tsx and ImportProfileDialog.tsx
// before changing these:
//   config-raw-expand           (RawFileTab.tsx, per-installation expand toggle)
//   config-create-profile       (ConfigView.tsx, "New profile" button)
//   config-create-source        (CreateProfileDialog.tsx, source <select>)
//   config-create-submit        (CreateProfileDialog.tsx, footer submit button)
//   config-import-installation  (ImportProfileDialog.tsx, installation <select>)

/** Mirrors src/shared/constants.ts:17-18 (`WINDOW_DEFAULT_WIDTH/HEIGHT`). */
const VIEWPORT_DEFAULT = { width: 1280, height: 800 }
/** Mirrors src/shared/constants.ts:19-20 (`WINDOW_MIN_WIDTH/HEIGHT`). */
const VIEWPORT_MIN = { width: 940, height: 620 }
const BOTH_VIEWPORTS = [VIEWPORT_DEFAULT, VIEWPORT_MIN]

/** Long enough for a fresh profile switch/re-render, short enough that a
 * genuinely missing testid fails the screen instead of the whole run. */
const CLICK_TIMEOUT_MS = 8_000

/** Fixture profile names, mirrors scripts/lib/fixture.mjs's `populatedConfigProfiles()`. */
const PROFILE_PLAIN = 'Plain Profile'
const PROFILE_UNRECOGNIZED = 'Imported Profile'

async function click(page, testId) {
  await page.getByTestId(testId).click({ timeout: CLICK_TIMEOUT_MS })
}

async function openConfigList(page) {
  await click(page, 'nav-config')
}

async function selectProfile(page, name) {
  await page
    .getByTestId('config-profile-row')
    .filter({ hasText: name })
    .first()
    .click({ timeout: CLICK_TIMEOUT_MS })
}

async function openConfigTab(page, tabId) {
  await click(page, `config-tab-${tabId}`)
}

/** Opens the populated `Plain Profile`'s detail on the given tab (default: Overview, which is where selecting a profile already lands — see `ConfigView.openProfile`). */
function configDetail(tabId, profileName = PROFILE_PLAIN) {
  return async (page) => {
    await openConfigList(page)
    await selectProfile(page, profileName)
    await openConfigTab(page, tabId)
  }
}

export const SCREENS = [
  {
    id: 'home',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: async (page) => {
      await click(page, 'nav-home')
    },
  },
  {
    id: 'library',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: async (page) => {
      await click(page, 'nav-library')
    },
  },
  {
    id: 'library-empty',
    variant: 'empty',
    viewports: BOTH_VIEWPORTS,
    navigate: async (page) => {
      await click(page, 'nav-library')
    },
  },
  {
    id: 'config-list',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: async (page) => {
      await openConfigList(page)
    },
  },
  {
    id: 'config-empty',
    variant: 'empty',
    viewports: BOTH_VIEWPORTS,
    navigate: async (page) => {
      await openConfigList(page)
    },
  },
  {
    id: 'config-overview',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: configDetail('overview'),
  },
  {
    id: 'config-settings',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: configDetail('settings'),
  },
  {
    id: 'config-controls',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: configDetail('controls'),
  },
  {
    id: 'config-raw',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Plain Profile has an assignment (INSTALL_ONE_ID, default), so the Raw
    // tab's per-installation section renders that assignment's row alongside
    // the profile's own canonical file (RawFileTab.tsx).
    navigate: configDetail('raw'),
  },
  {
    id: 'config-care',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 025 D1: Care replaces the old separate Validation tab and the
    // conditional Preserved tab (dropped) - `PROFILE_UNRECOGNIZED` so this
    // one shot also covers the preserved-lines section having content.
    navigate: configDetail('care', PROFILE_UNRECOGNIZED),
  },
  {
    id: 'settings',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: async (page) => {
      await click(page, 'nav-settings')
    },
  },
  {
    id: 'mods',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: async (page) => {
      await click(page, 'nav-mods')
    },
  },
  {
    id: 'assets',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: async (page) => {
      await click(page, 'nav-assets')
    },
  },
  {
    id: 'downloads',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 031 moved Downloads into the titlebar's right utility cluster
    // (icon-only button next to Settings), but TitleBar.tsx's UtilityButton
    // keeps the same `nav-<moduleId>` testid convention as the primary nav.
    navigate: async (page) => {
      await click(page, 'nav-downloads')
    },
  },
  {
    id: 'config-write-preview',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 037 D3: the Raw tab's per-installation expand toggle mounts
    // `RawConfigPanel` (RawFileTab.tsx), which fetches its own preview and
    // shows a spinner first — waiting for a *second* `.cfg-code-content`
    // block (the first is the profile's own canonical file, always rendered
    // already) is what tells apart "still loading" from "preview rendered".
    // Plain Profile is assigned to `fixture-install-favorite` by default
    // (scripts/lib/fixture.mjs), which is the row this renders. The rendered
    // panel sits below the profile's own (always-empty-here, not-on-disk)
    // canonical file, so it scrolls itself into view once ready — otherwise
    // it would render correctly but sit below the screenshot's fold.
    navigate: async (page) => {
      await configDetail('raw')(page)
      await click(page, 'config-raw-expand')
      const rendered = page.locator('.cfg-code-content').nth(1)
      await rendered.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
      await rendered.scrollIntoViewIfNeeded()
    },
  },
  {
    id: 'config-import-preview',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 037 D3: config list -> "New profile" -> source "import" ->
    // continue -> pick the one installation with a real config.cfg fixture
    // (D2's `fixture-install-writedir`, display name "Fixture WriteDir
    // Install" - scripts/lib/fixture.mjs). Picking it triggers a scan, which
    // auto-selects the first gamedir candidate and triggers a preview -
    // ImportProfileDialog.tsx's two effects - with no further click needed.
    // `.cfg-code-single` is only ever rendered by this dialog's
    // duplicate-bind/preserved-line lists, and the fixture config.cfg has
    // both (a `bind w` repeated with no `unbind` between, and one
    // unrecognized `alias` line), so waiting for it rules out both the
    // spinner and the "no config files" empty state.
    navigate: async (page) => {
      await openConfigList(page)
      await click(page, 'config-create-profile')
      await page.getByTestId('config-create-source').selectOption('import')
      await click(page, 'config-create-submit')
      await page
        .getByTestId('config-import-installation')
        .selectOption({ label: 'Fixture WriteDir Install' })
      await page
        .locator('.cfg-code-single')
        .first()
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'keybind-dialog',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: async (page) => {
      await openConfigList(page)
      await selectProfile(page, PROFILE_PLAIN)
      // Plain Profile's overview tab is the default landing tab already
      // (ConfigView.openProfile always sets activeTab to 'overview').
      // Outside test mode a keycap click opens KeyBindDialog directly
      // (OverviewKeyboardPanel.tsx `capture()`, story 017) — no edit-mode
      // toggle to arm first.
      // MOUSE1 is bound in the Plain Profile fixture (scripts/lib/fixture.mjs).
      await click(page, 'keycap-MOUSE1')
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
]
