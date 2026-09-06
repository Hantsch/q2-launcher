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
 * The Raw file tab's own `getRawFiles` fetch (real IPC, reads the profile's canonical file plus
 * every assigned installation's copy off disk) has been observed taking noticeably longer than
 * `CLICK_TIMEOUT_MS` to settle in a batched session - long enough that a plain click on its
 * `.cfg-code-textarea` can still be waiting on a spinner when the shorter timeout gives up. Used
 * only by `config-raw-editing` below, which needs the editor actually mounted before it can type
 * into it.
 */
const RAW_TAB_LOAD_TIMEOUT_MS = 20_000

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
    id: 'config-care-clear',
    variant: 'controls-seed',
    viewports: BOTH_VIEWPORTS,
    // Story 058 D7 (decision 11): AC 9 names both Care states, and one screenshot cannot show both
    // - `config-care` further below is the findings fixture (`PROFILE_UNRECOGNIZED`), this is the
    // healthy one.
    //
    // Deliberately NOT a `populated`-variant profile: every profile in that variant either goes
    // through story 052 D6's migration (which seeds the full movement/weapons/drops catalogue into
    // `actions`, several of whose rows - `+moveleft` etc. - raise a permanent `aliasShadowsCommand`
    // Config health warning; `validate-actions.ts`'s own doc comment confirms this fires for a
    // catalogue row too, not just a hand-typed one) or is `PROFILE_UNRECOGNIZED` itself (unassigned).
    // `controls-seed`'s "Imported Category Profile" (`fixture.mjs`'s `importedOnlyConfigProfile()`)
    // is the one fixture profile with neither problem: it carries only three free-form entries that
    // do not collide with anything reserved, and is seeded at the CURRENT schema version so the
    // catalogue migration never touches it. Story 058 D7 additionally assigns it to a new
    // `controls-seed`-only installation (`INSTALL_CONTROLS_SEED_ID`, `fixture.mjs`) so AC 1's
    // "assigned, in-sync installation" is real, not merely "nothing to validate against".
    //
    // The one thing the fixture itself cannot hand it "in sync": `state.json` is written directly
    // (`scripts/lib/fixture.mjs`), never through the app's own write pipeline, so the installation's
    // on-disk copy of this profile's `.cfg` has simply never existed on a fresh seed - and the app's
    // own startup retry sweep (`main/modules/config/index.ts`) only retries a profile already
    // recorded as failed/pending, never one it has no history for, so it never creates it either.
    // Left alone, the Files group would show that copy `missing` forever. Rather than
    // hand-duplicating `renderProfileFile`'s exact byte output here (a second copy of logic this
    // file's own doc comment already warns is easy to drift - see the alias-mirror note above), this
    // calls the real `config/write` handler once through the app's own bridge (`window.q2.invoke`,
    // the same call `writeConfigProfile`/Care's Retry action makes) before opening the tab - the same
    // "reach past `page` for a real setup step" precedent `config-conflict-dialog` already uses, just
    // through the app's supported IPC surface instead of `node:fs`. Idempotent: once the copy exists
    // and matches, writing it again changes nothing, so this is safe to run on every visit.
    navigate: async (page) => {
      const outcome = await page.evaluate(
        async (profileId) =>
          window.q2.invoke('module:invoke', { moduleId: 'config', type: 'write', payload: { profileId } }),
        'fixture-profile-imported-only',
      )
      if (!outcome?.ok) {
        throw new Error(
          `config-care-clear: priming the fixture profile's installation copy failed: ${JSON.stringify(outcome)}`,
        )
      }

      await configDetail('care', 'Imported Category Profile')(page)
      await page
        .getByText('All clear — nothing to do on this profile.', { exact: true })
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'config-settings',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 059 D10: waits for the fixture's own user-named cvar section (`fixture-section-custom`,
    // "Fixture Section" - scripts/lib/fixture.mjs) and its plain, non-catalogue cvar row
    // (`q2l_fixture_note`, rendered as a `PlainCvarRow` with no `data-testid`, so this waits on its
    // own text like every other testid-less wait in this file) before shooting - both render
    // synchronously off the draft with no async gap to race, but waiting on the real content this
    // screen exists to demonstrate (rather than trusting `configDetail`'s tab click alone) rules out
    // silently screenshotting a stale/empty tab if a future change makes either conditional.
    navigate: async (page) => {
      await configDetail('settings')(page)
      await page
        .getByText('Fixture Section', { exact: true })
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
      await page
        .getByText('q2l_fixture_note', { exact: true })
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'config-controls',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 054 D12: a row's drag grip (`.ctrl-grip-handle`, controls-grid.css) is opacity-0 until
    // its row is hovered/focus-within/dragging - correct for a dense 40px grid in normal use, but it
    // would mean this screen's static screenshot never shows the affordance it exists to
    // demonstrate. Hovering the first row is a real Playwright pointer hover, so it triggers the
    // same `:hover` CSS rule a real user's mouse would, rather than adding a screenshot-only style
    // override or bypass.
    navigate: async (page) => {
      await configDetail('controls')(page)
      await page.locator('.ctrl-row').first().hover()
    },
  },
  {
    id: 'config-controls-extra-keys-folded',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 056 D5: the fixture's own three-key "Multi Bind" action
    // (scripts/lib/fixture.mjs's `fixture-action-multibind`, keys G/H/J, `categoryId: 'movement'`
    // - the rail's default first category, so no chip click is needed) in its default fold state.
    // `expandedKeyRows` never contains this action's id on a fresh load, so nothing needs
    // clicking - just wait for the row and its "+2" chevron (`.ctrl-keymore`, `ControlsTab.tsx`'s
    // `renderKeyCell`) to actually be visible before shooting, ruling out a race against the
    // initial render rather than clicking-and-hoping.
    navigate: async (page) => {
      await configDetail('controls')(page)
      const row = page.locator('.ctrl-row[data-row-id="fixture-action-multibind"]')
      await row.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
      await row.locator('.ctrl-keymore').waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
      await row.scrollIntoViewIfNeeded()
    },
  },
  {
    id: 'config-controls-extra-keys-unfolded',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 056 D5: same row as `config-controls-extra-keys-folded` above, but with its chevron
    // clicked to expand the group - waits for both `.ctrl-keysub-row` sub-rows (keys H and J, plus
    // the trailing add-key sub-row) to be visible before shooting.
    navigate: async (page) => {
      await configDetail('controls')(page)
      const row = page.locator('.ctrl-row[data-row-id="fixture-action-multibind"]')
      await row.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
      await row.locator('.ctrl-keymore').click({ timeout: CLICK_TIMEOUT_MS })
      const subRows = page.locator('.ctrl-keysub-row[data-row-id="fixture-action-multibind"]')
      await subRows.nth(0).waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
      await subRows.nth(1).waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
      await row.scrollIntoViewIfNeeded()
    },
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
    id: 'config-raw-editing',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 057 D7: a dirty raw draft, mid-edit, not yet saved - the state D5's editable
    // `<textarea>` (`.cfg-code-textarea`, `ConfigCodeView.tsx`) can be in. Plain Profile's own
    // canonical file is on disk and the profile isn't dirty by default, so `rawEditingMode` reads
    // 'editable' (`lib/raw-draft.tsx`) and the tab already shows the real editor - no toggling
    // needed first, only typing into it. Waits for the save bar's own raw-specific summary
    // (`config-save-summary`, `ProfileSaveBar.tsx`, text `config.save.rawEdited`) rather than just
    // clicking-and-hoping, since that text is what actually distinguishes "a raw draft is active"
    // from "the structured diff is dirty" - the two save-bar states this registry's other raw-tab
    // screens (`config-save-expanded`/`config-discard-confirm`) exercise instead.
    navigate: async (page) => {
      await configDetail('raw')(page)
      const textarea = page.locator('.cfg-code-textarea')
      // The tab shows a spinner until `getRawFiles` resolves (see `RAW_TAB_LOAD_TIMEOUT_MS`
      // above) - waiting for the textarea itself, rather than clicking straight away, keeps this
      // screen from racing that fetch the way a bare `.click()` did (observed as an intermittent
      // `unreachable` at the narrower viewport during this screen's own verification).
      await textarea.waitFor({ state: 'visible', timeout: RAW_TAB_LOAD_TIMEOUT_MS })
      // A plain `.click()` targets the element's center, which at `VIEWPORT_MIN`'s shorter height
      // sits below the fold, under the always-on-top installation-status footer - Playwright's own
      // "element intercepts pointer events" retry loop confirmed this rather than a load race.
      // Clicking a point inside the textarea's own top-left corner, which sits right below the
      // toolbar row and is never covered, sidesteps that instead of fighting the footer's z-index.
      await textarea.click({ timeout: CLICK_TIMEOUT_MS, position: { x: 10, y: 10 } })
      // The click above lands the caret near whatever character sits at that pixel, not
      // necessarily the very start of the text - `Control+Home` normalizes that to a real "start
      // of file" position first, so the typed line always lands as its own clean first line
      // rather than splicing into the middle of the file's existing first line.
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('// q2l-ui-verify raw edit\n')
      await page
        .getByTestId('config-save-summary')
        .filter({ hasText: 'File text edited' })
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
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
    //
    // Story 057 D3 retarget: the select used to sit inside a `Field` (`components/ui/controls.tsx`),
    // which rendered a real `<label htmlFor>` - `getByLabel('Section header style')` worked against
    // that. D3 compacted the "unbindall" checkbox and this select into one toolbar row, each wrapped
    // in a `HoverCard` instead, with the visible text now a plain `<span className="stencil">` that
    // carries no `for`/`id` association at all - `getByLabel` no longer finds anything here. RawFileTab
    // renders exactly one native `<select>` (verified by reading the whole module), so this selects it
    // directly rather than by label; `HoverCard`'s children always render in the DOM regardless of
    // hover/focus state (`HoverCard.tsx`), so the select is present and interactable without opening
    // the tooltip first.
    navigate: async (page) => {
      await configDetail('raw')(page)
      await page.locator('select').selectOption('brackets')
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
    //
    // Story 057 D3 retarget: same reason as `config-save-expanded` above - `getByLabel` no longer
    // resolves against the compacted toolbar row, so this selects RawFileTab's one native `<select>`
    // directly instead.
    navigate: async (page) => {
      await configDetail('raw')(page)
      await page.locator('select').selectOption('brackets')
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
    //
    // Story 058 review finding: the Files group's `useCareSync` fetch is async, and since D3 its
    // loading state renders an explicit notice (`config.care.files.loading`, CareTab.tsx's
    // `FilesGroup`) instead of nothing - a fast run would screenshot the settled Files group, a slow
    // run the loading notice, so this has to wait for the fetch to settle the same way
    // `config-care-clear` above waits on its own settled text (`All clear — nothing to do on this
    // profile.`). There is no equivalent single settled string here (the profile is unassigned, so
    // Files can settle into rows or an error), so this waits for the loading notice to go away
    // instead - true whether it never showed at all or already resolved.
    navigate: async (page) => {
      await configDetail('care', PROFILE_UNRECOGNIZED)(page)
      await page
        .getByText('Checking whether your files are in sync…', { exact: true })
        .waitFor({ state: 'hidden', timeout: CLICK_TIMEOUT_MS })
    },
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
  // `config-write-preview` (story 037 D3) is RETIRED here: it drove the Raw tab's per-installation
  // expand toggle (`config-raw-expand`) into `RawConfigPanel`, but story 057 D3 compacted RawFileTab
  // down to one path/status line, one file-options toolbar row and the profile's own canonical file
  // - the per-installation cards and `RawConfigPanel`'s mount point were both gone from this tab
  // already. Story 058 D3 deleted `RawConfigPanel.tsx` outright (it is not merely unmounted) and
  // folds Files rows into the shared `CareItemRow` instead. There is no way to reach it, and none is
  // coming - the view it targeted no longer exists, so this retirement is permanent, not "until a
  // new trigger shows up".
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
    // a non-empty message (ControlsTab.tsx:670/738), so no toggle click is
    // needed first. Opens MessageEditor with `showKeyCapture` off; same
    // `message-editor-content` wait, same `$r` colour-cvar badge. The row's
    // `categoryId` is `drops`, not the rail's default `movement`, so the
    // "Weapon dropping" category chip has to be selected first (same rail,
    // no testid, selecting by translated accessible name).
    //
    // Story 055 D5: the row's two options are `DropToggles` icon buttons now,
    // not the two `Checkbox`es this comment used to describe ("no checkbox
    // click is needed first" above), but `drop-message-edit-<catalogId>` is
    // unchanged (still keyed off the row's `catalogId`, ControlsTab.tsx's
    // `renderMessageSubRow`) so this screen's `navigate()` needed no code
    // change - verified against a rebuilt app.
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
    id: 'config-controls-template-seeded',
    variant: 'controls-seed',
    viewports: BOTH_VIEWPORTS,
    // Story 052 D10: the `controls-seed` fixture's "Template Profile" (scripts/lib/fixture.mjs's
    // `templateSeededConfigProfile()`) - a profile shaped exactly like "create from template"
    // would produce, seeded at the fixture's own current schema version so no migration touches
    // it (see that file's D10 comment block). Demonstrates AC4: the three template categories
    // with every catalogue row, unbound except the template's own six binds (Forward/Back/
    // Jump/Crouch/Walk/Attack).
    navigate: configDetail('controls', 'Template Profile'),
  },
  {
    id: 'config-controls-template-subcategories',
    variant: 'controls-seed',
    viewports: BOTH_VIEWPORTS,
    // Story 053 D8: same `controls-seed`/"Template Profile" fixture as `config-controls-template-
    // seeded` above, but on the Weapons category tab rather than the default first category
    // (Movement, which has no sub-categories) - `configDetail()` never selects a category itself,
    // it always lands on the profile's first one. `templateSeededConfigProfile()`
    // (scripts/lib/fixture.mjs) now mirrors STANDARD_TEMPLATE.categories' own `subcategories`
    // (story 053 D5): Weapons carries "Use weapon"/"Cycling", so this screen is the one that
    // actually demonstrates the story's "a category with sub-categories" acceptance criterion with
    // real group headers on screen, alongside `ui:flow controls-subcategory`'s live create+move.
    navigate: async (page) => {
      await configDetail('controls', 'Template Profile')(page)
      // No testid/role on the rail's category chips (plain `<button>`s) - selecting by translated
      // accessible name, same convention `config-controls-message`/`config-controls-drop-message`
      // above already use.
      await page.getByRole('button', { name: 'Weapons' }).click({ timeout: CLICK_TIMEOUT_MS })
      await page.locator('.ctrl-group').first().waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
  {
    id: 'config-controls-imported-only',
    variant: 'controls-seed',
    viewports: BOTH_VIEWPORTS,
    // Story 052 D10: the `controls-seed` fixture's "Imported Category Profile" - a single,
    // non-template "Imported" category with its own free-form entries, no Movement/Weapons/
    // Weapon dropping at all (scripts/lib/fixture.mjs's `importedOnlyConfigProfile()`).
    // Demonstrates AC1/AC7: a profile with only an imported category shows only that.
    navigate: configDetail('controls', 'Imported Category Profile'),
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
  {
    id: 'config-cleanup-dialog',
    variant: 'populated',
    viewports: BOTH_VIEWPORTS,
    // Story 058 D7: `CleanupConfigCopiesDialog` (D6), the redundant-config-copies cleanup now
    // reached from an icon button on the installation row in Library rather than from Care - see
    // LibraryView.tsx's per-row action cluster (mirrors rename/remove's own "row action opens a
    // dialog" pattern) and CleanupConfigCopiesDialog.tsx. No testid on the trigger (an `IconButton`
    // with only a translated `label`, same as the row's favorite/reveal/revalidate/rename buttons
    // beside it), so this selects it by that accessible name, same convention the category-chip
    // clicks elsewhere in this file already use. Waits on the dialog's own title text
    // (`dialog.cleanup.title`, "Redundant config copies") rather than a bare `getByRole('dialog')`,
    // since `install-remove-dialog` above already proves the bare role wait for a testid-less
    // `Modal`, and this dialog's own content (the scan button) renders synchronously with no
    // spinner - naming it rules out a false-positive match against some other dialog transiently
    // present during the batched session's reset.
    navigate: async (page) => {
      await click(page, 'nav-library')
      await page
        .getByRole('button', { name: 'Clean up redundant config copies…' })
        .first()
        .click({ timeout: CLICK_TIMEOUT_MS })
      await page
        .getByRole('dialog', { name: 'Redundant config copies' })
        .waitFor({ state: 'visible', timeout: CLICK_TIMEOUT_MS })
    },
  },
]
