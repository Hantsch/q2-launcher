// D4 — the screen registry every UI-verification consumer (shot.mjs today,
// a11y.mjs later) walks. Each entry is `{ id, variant, viewports, navigate }`:
// `navigate(page)` performs whatever clicks are needed to reach that screen
// starting from a fresh app load (harness's `withApp` always starts at the
// default route — there is no URL to navigate to, `route` is plain Zustand
// state, see src/renderer/src/store/useLauncher.ts).
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
    id: 'config-advanced',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: configDetail('advanced'),
  },
  {
    id: 'config-writeTargets',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: configDetail('writeTargets'),
  },
  {
    id: 'config-raw',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Plain Profile has an assignment (INSTALL_ONE_ID, default), which the Raw
    // tab needs to show a picked installation rather than the "no assignment"
    // empty state (ConfigView.tsx: `selected.assignments.length === 0`).
    navigate: configDetail('raw'),
  },
  {
    id: 'config-validation',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    navigate: configDetail('validation'),
  },
  {
    id: 'config-preserved',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Only the seeded profile with `unrecognized` lines renders the
    // conditional Preserved tab (ConfigView.tsx: `selected?.unrecognized?.length`).
    navigate: configDetail('preserved', PROFILE_UNRECOGNIZED),
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
