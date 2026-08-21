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
// instead of visiting it inside the batched session. None of the 14 entries
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
