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
// instead of visiting it inside the batched session. None of the 18 entries
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
//
// Story 041 D7 adds one more, same mirroring convention — read
// ImportProfileDialog.tsx before changing it:
//   config-import-review        (ImportProfileDialog.tsx, the review step's container,
//                                 rendered only when `ambiguousRebindAliases` is non-empty)
//
// Story 042 D6 adds two more, same mirroring convention — read
// ImportProfileDialog.tsx before changing them:
//   config-import-gamedir       (ImportProfileDialog.tsx, the gamedir <select> - needed to pick
//                                 a candidate other than the auto-selected first one)
//   config-import-restore-banner (ImportProfileDialog.tsx, the "restoring a launcher profile"
//                                 banner, rendered only when `ownWrittenFile` is true)
//
// Story 047 D3 adds four more, same mirroring convention — read MessageEditor.tsx,
// ControlsTab.tsx and LibraryView.tsx before changing these:
//   action-edit-<actionId>          (ControlsTab.tsx, a plain action row's edit trigger,
//                                     opens MessageEditor with showKeyCapture on)
//   drop-message-edit-<catalogId>   (ControlsTab.tsx:701, a drops row's "Edit message"
//                                     trigger, opens MessageEditor with showKeyCapture off)
//   message-editor-content          (MessageEditor.tsx, the dialog's content container)
//   library-auto-detect             (LibraryView.tsx, header "Auto Detect" button)
//   installation-remove-<installationId> (LibraryView.tsx, installation-rail remove button)
//
// Story 043 D8 adds one more, same mirroring convention — read ProfileSaveBar.tsx and
// ConfigConflictDialog.tsx before changing these:
//   config-save               (ProfileSaveBar.tsx, the explicit Save button)
//   config-conflict-dialog    (ConfigConflictDialog.tsx, the two-pane content container)
//
// Story 049 D9 adds one more testid (the other two screens below reuse existing D5/D6/D8
// testids and the `install-remove-dialog` testid-less-dialog pattern) — read ProfileSaveBar.tsx:
//   config-save-changes-panel (ProfileSaveBar.tsx, the disclosure's expanded panel - added
//                               alongside its pre-existing `id` since no screen here waits on a
//                               CSS id, only testids)
//
// Story 044 D7 adds `config-aliases` — no new testid, it reuses `config-tab-aliases` (already wired
// into ConfigView.tsx by an earlier deliverable in this story) and clicks the Aliases tab's own
// "Show generated and layer aliases" switch by its translated accessible name; see the entry itself
// for why (Plain Profile has zero user-authored aliases, only generated ones).
//
// `config-save-expanded`/`config-discard-confirm` (D9) dirty the fixture profile via
// RawFileTab.tsx's "Section header style" `<Select>`, not the "Start the file with `unbindall`"
// checkbox `config-conflict-dialog` (D8) uses: all `populated`-variant screens share one Electron
// session (session.mjs's `runVariantSession`/`resetToBaseState` only routes home between visits, it
// never reloads the fixture or resets in-memory profile state), so a *toggle* is order-dependent —
// whichever screen runs second would flip it back to the first screen's starting value and could
// land back on a no-op. Selecting an explicit value (`'brackets'`, the fixture's baseline is the
// default `'dashes'` — `fixture.mjs`'s `populatedConfigProfiles()` never sets `sectionHeaderStyle`)
// is idempotent: it produces the same real diff-from-disk-baseline regardless of what either screen
// left the select at, and regardless of registry order.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantUserDataDir } from './harness.mjs'

/** Mirrors src/shared/constants.ts:17-18 (`WINDOW_DEFAULT_WIDTH/HEIGHT`). */
const VIEWPORT_DEFAULT = { width: 1280, height: 800 }
/** Mirrors src/shared/constants.ts:19-20 (`WINDOW_MIN_WIDTH/HEIGHT`). */
const VIEWPORT_MIN = { width: 940, height: 620 }
const BOTH_VIEWPORTS = [VIEWPORT_DEFAULT, VIEWPORT_MIN]

/** Long enough for a fresh profile switch/re-render, short enough that a
 * genuinely missing testid fails the screen instead of the whole run. */
const CLICK_TIMEOUT_MS = 8_000

/**
 * Story 043 D8: `Plain Profile`'s canonical file name, as `resolveProfileFileNames`
 * (`@shared/config/profile-files.ts`) actually resolves it - the sanitizer maps the space to `-`,
 * so this is NOT `Plain Profile.cfg`. Used only by the `config-conflict-dialog` screen below to
 * hand-edit the file from the Node side.
 */
const PLAIN_PROFILE_FILE_NAME = 'Plain-Profile.cfg'

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
    id: 'config-aliases',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 044 D7: Plain Profile has no `kind: 'alias'` (user-authored) actions, so the tab's
    // default view (`origin: 'user'` rows only, AliasesTab.tsx) would render nothing but the empty
    // state. All five of its actions still produce a `generated` row each (`buildAliasIndex`, none
    // are `kind: 'alias'`), so toggling the tab's own "Show generated and layer aliases" switch -
    // the smallest change that makes the screen non-trivial, not a new fixture - reveals a real,
    // populated table instead. No testid on the switch (`Switch`, `components/ui/controls.tsx`
    // links its `<label for>` to the `role="switch"` button, giving it a real accessible name), so
    // this selects it by that translated name like the category-chip clicks elsewhere in this file.
    // Waits for the "Generated" origin badge text rather than just clicking-and-hoping, since the
    // toggle only flips local component state and nothing else here would fail fast if it hadn't
    // taken effect yet.
    navigate: async (page) => {
      await configDetail('aliases')(page)
      await page
        .getByRole('switch', { name: 'Show generated and layer aliases' })
        .click({ timeout: CLICK_TIMEOUT_MS })
      await page.getByText('Generated', { exact: true }).first().waitFor({
        state: 'visible',
        timeout: CLICK_TIMEOUT_MS,
      })
    },
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
    id: 'config-save-expanded',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 049 D5/D9: real-dirty setup, not a mocked one - `configDetail('raw')` lands on Plain
    // Profile's Raw File tab, whose "Section header style" `<Select>` (RawFileTab.tsx) is a real
    // content setter that marks the profile dirty server-side the instant it changes, so
    // `ProfileSaveBar` shows "Unsaved changes" - see the module-level comment above for why this
    // uses that select (an explicit, idempotent value) rather than the checkbox
    // `config-conflict-dialog` (D8) toggles. Instead of hand-editing the file and saving to trigger
    // a conflict, this clicks the bar's own disclosure (`config-save-toggle`) to expand
    // `ProfileChangeList` (D5) and waits for the panel (`config-save-changes-panel`, ProfileSaveBar.tsx)
    // to actually be visible, rather than just clicking-and-hoping, since the panel is conditionally
    // rendered (`dirty && expanded`) and a race against that render would otherwise screenshot the
    // pre-expansion state.
    navigate: async (page) => {
      await configDetail('raw')(page)
      await page.getByLabel('Section header style').selectOption('brackets')
      await page
        .getByText('Unsaved changes', { exact: true })
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })

      await click(page, 'config-save-toggle')
      await page
        .getByTestId('config-save-changes-panel')
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'config-discard-confirm',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 049 D6/D9: same real-dirty setup as `config-save-expanded` above (the "Section header
    // style" select, not the checkbox - see the module-level comment above), but instead clicks the
    // bar's Discard button (`config-discard`) to open `DiscardChangesDialog` - which, like
    // `RemoveInstallationDialog` (`install-remove-dialog` above), renders via `Modal` (role="dialog")
    // and carries no `data-testid` of its own, so this mirrors that screen's wait exactly rather
    // than inventing a new pattern.
    navigate: async (page) => {
      await configDetail('raw')(page)
      await page.getByLabel('Section header style').selectOption('brackets')
      await page
        .getByText('Unsaved changes', { exact: true })
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })

      await click(page, 'config-discard')
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
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
    id: 'config-import-review',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 041 D7: same path as `config-import-preview` above (config list ->
    // "New profile" -> source "import" -> continue -> pick "Fixture WriteDir
    // Install"), but waits on `config-import-review` instead of
    // `.cfg-code-single` - that's the review step's own container
    // (ImportProfileDialog.tsx), which only renders once the fixture's
    // `alias q2l_fixture_layer "bind e +use"` line (scripts/lib/fixture.mjs)
    // comes back in `ambiguousRebindAliases`, so waiting on it rules out both
    // the spinner and a preview with nothing ambiguous.
    navigate: async (page) => {
      await openConfigList(page)
      await click(page, 'config-create-profile')
      await page.getByTestId('config-create-source').selectOption('import')
      await click(page, 'config-create-submit')
      await page
        .getByTestId('config-import-installation')
        .selectOption({ label: 'Fixture WriteDir Install' })
      await page
        .getByTestId('config-import-review')
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'config-import-restore',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 042 D6: same installation as `config-import-preview`/`config-import-review`
    // ("Fixture WriteDir Install"), but picks its second gamedir - `RESTORE_GAME_DIR`
    // (scripts/lib/fixture.mjs) - which holds a launcher-written fixture config carrying the
    // `OWNERSHIP_MARKER` sentinel for the "Plain Profile" fixture's own id. Waiting on
    // `config-import-restore-banner` (ImportProfileDialog.tsx) rules out both the spinner and a
    // preview that resolved to the foreign-config `baseq2` candidate instead.
    navigate: async (page) => {
      await openConfigList(page)
      await click(page, 'config-create-profile')
      await page.getByTestId('config-create-source').selectOption('import')
      await click(page, 'config-create-submit')
      await page
        .getByTestId('config-import-installation')
        .selectOption({ label: 'Fixture WriteDir Install' })
      await page
        .getByTestId('config-import-gamedir')
        .selectOption({ label: 'q2l-restore-fixture' })
      await page
        .getByTestId('config-import-restore-banner')
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
  {
    id: 'config-controls-message',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 047 D3: Plain Profile's Controls tab, "Team Update" action
    // (scripts/lib/fixture.mjs's `fixture-action-team-message`, a free-form
    // `kind: 'message'` action) -> its edit trigger opens MessageEditor with
    // `showKeyCapture` on (ControlsTab.tsx:901). Waiting on
    // `message-editor-content` (MessageEditor.tsx) rules out the spinner-less
    // but not-yet-mounted dialog. The fixture's `r` colour cvar (D2) makes the
    // preview's `$r` badge render with a real colour, not a placeholder. The
    // action's `categoryId` is `weapons`, not the rail's default `movement`
    // (BUILT_IN_ACTION_CATEGORIES[0], src/shared/modules/config.ts), so the
    // "Weapons" category chip has to be selected first (no testid on the
    // rail's category buttons — selecting by its translated accessible name).
    navigate: async (page) => {
      await configDetail('controls')(page)
      await page.getByRole('button', { name: 'Weapons' }).click({ timeout: CLICK_TIMEOUT_MS })
      await click(page, 'action-edit-fixture-action-team-message')
      await page
        .getByTestId('message-editor-content')
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'config-controls-drop-message',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 047 D3: same Controls tab, but the drops row's "Edit message"
    // trigger (ControlsTab.tsx:701) for the `dropWeapon:railgun` catalogue row
    // (scripts/lib/fixture.mjs's `fixture-action-drop-message`) — that row's
    // message sub-row is already revealed because the fixture action carries
    // a non-empty message (ControlsTab.tsx:670/738), so no checkbox click is
    // needed first. Opens MessageEditor with `showKeyCapture` off; same
    // `message-editor-content` wait, same `$r` colour-cvar badge. The row's
    // `categoryId` is `drops`, not the rail's default `movement`, so the
    // "Weapon dropping" category chip has to be selected first (same rail,
    // no testid, selecting by translated accessible name).
    navigate: async (page) => {
      await configDetail('controls')(page)
      await page
        .getByRole('button', { name: 'Weapon dropping' })
        .click({ timeout: CLICK_TIMEOUT_MS })
      await click(page, 'drop-message-edit-dropWeapon:railgun')
      await page
        .getByTestId('message-editor-content')
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'install-remove-dialog',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 047 D3: Library's installation rail -> remove button for the
    // default fixture installation (scripts/lib/fixture.mjs's
    // `INSTALL_ONE_ID` = 'fixture-install-favorite') -> RemoveInstallationDialog
    // (Dialogs.tsx), which like every other modal here renders via `Modal`
    // (role="dialog").
    navigate: async (page) => {
      await click(page, 'nav-library')
      await click(page, 'installation-remove-fixture-install-favorite')
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'config-conflict-dialog',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 043 D8: a real save-time conflict, not a mocked one. `configDetail('raw')` lands on
    // Plain Profile's Raw File tab, whose "Start the file with `unbindall`" checkbox
    // (RawFileTab.tsx) is a real content setter (`setWriteUnbindall`) that marks the profile
    // dirty server-side the instant it is toggled - `ProfileSaveBar` (mounted at the detail
    // level, reachable regardless of which tab is open) then shows "Unsaved changes".
    //
    // With the profile dirty, this hand-edits the profile's canonical file directly from the
    // Node side - never through `page`, since the point is a change the launcher has not read -
    // the same "hand-edit in Notepad" idiom `index.test.ts`'s own D4/D8 tests use: read the
    // current bytes and append one well-formed comment line, which changes the hash without
    // risking `unparseable`. Clicking Save (`config-save`, ProfileSaveBar.tsx) then hits `save`'s
    // `changedOnDisk` refusal and opens this dialog - waiting on `config-conflict-dialog`
    // (ConfigConflictDialog.tsx) rules out both "still saving" and a save that unexpectedly
    // succeeded.
    navigate: async (page) => {
      await configDetail('raw')(page)
      // The checkbox's own `<input>` is visually `sr-only` (Checkbox, `components/ui/controls.tsx`)
      // - its real hit target for a pointer is the label's visible text, exactly what a sighted
      // user actually clicks, so this targets that text rather than the role=checkbox element
      // itself (whose collapsed hit box the visual indicator span sits on top of and intercepts).
      await page
        .getByText('Start the file with `unbindall`', { exact: true })
        .click({ timeout: CLICK_TIMEOUT_MS })
      await page
        .getByText('Unsaved changes', { exact: true })
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })

      const canonicalPath = join(variantUserDataDir('populated'), PLAIN_PROFILE_FILE_NAME)
      const onDisk = readFileSync(canonicalPath, 'latin1')
      writeFileSync(canonicalPath, `${onDisk}// external edit\n`, 'latin1')

      await click(page, 'config-save')
      await page
        .getByTestId('config-conflict-dialog')
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'install-detect-dialog',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 047 D3: Library header's "Auto Detect" button -> DetectDialog
    // opened with no `autoStart` (LibraryView.tsx passes none), so it renders
    // its pre-scan state: `candidates === null` and not `scanning`, i.e. the
    // deep-scan checkbox plus a "Start" button, no results list. Per story
    // Decision 2 this screen must NEVER trigger `detection:scan` — do not add
    // a click on the start button here, only wait for the dialog itself.
    navigate: async (page) => {
      await click(page, 'nav-library')
      await click(page, 'library-auto-detect')
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
]
