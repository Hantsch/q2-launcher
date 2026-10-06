---
id: 213
title: the Controls tab is a component tree with a shared test harness
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the Controls tab to be a tree of components and hooks instead of one
function, so that a binds story edits a row component, a drag story edits a drag hook, a slot fix
is applied once, and a Controls test costs a few lines on a shared harness instead of 150–280
copied lines. As a user I want the Controls grid to stay smooth while dragging.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F16, F41, F42, F66):
`src/renderer/src/modules/config/ControlsTab.tsx` is 2,524 lines — 34 `useState`, 6 `useRef`,
6 `useEffect`, 27 handlers, 11 `render*` JSX helpers, a 507-line `return` mounting 11 dialogs,
and five more dialog components appended at the bottom; 20 commits since August, the most
recent from a demo-browser story. `renderCatalogSlot` (90 lines) and `renderPlainSlot` (72)
build the identical `<BindSlot>` wiring; the row pipeline (`buildControlsRowEntries`, filter,
`groupControlsRowEntries`, `buildMoveTargets`, `boundCount`) runs at render time with
`deriveRowState` 3–5x per row, and dnd-kit re-renders on every pointer move (a timer bug already
needed a `useCallback` + ref workaround). Three components reset 5–7 atoms in a
`useEffect(..., [profile.id])`; 30 `setState` calls inside effects across 8 files. Seven
`ControlsTab.*.test.tsx` suites each re-declare `profileFixture()`, `renderTab()`, the `window.q2`
stub and `IS_REACT_ACT_ENVIRONMENT`, in two mounting idioms; 16 config components over 150 lines
(`ConfigCodeView` 692, `CvarRow` 642, `OverviewKeyboardPanel` 642, `BindSlot` 570, …) have no
direct test.

Depends on story 212 (save hook). The review's judge recommends three ordered, independently
committable slices rather than one line-count target.

## Acceptance Criteria

- [x] **AC1** — `lib/useControlsRows.ts` computes entries, groups, move targets, bound count and a
      per-entry `rowState` map in one `useMemo` (so `deriveRowState` runs once per entry), with a
      `renderHook` test; the tab reads rows from it.
- [x] **AC2** — One `components/ControlsEntryRow.tsx` (taking a `ControlsRowEntry` and a small
      context) replaces the six `render*` row/slot helpers; assign, clear and replace are tested
      for both catalog and plain rows; the "only difference is withCatalogBody" comment is gone
      because there is one path.
- [x] **AC3** — Drag state lives in `lib/useControlsDrag.ts`; the category rail and its dialogs
      live in `components/ControlsCategoryRail.tsx`; the five dialog components appended to
      `ControlsTab.tsx` live under `components/` (or `dialogs/`, per the placement rule story 227
      writes) and `ControlsTab.dialogs.test.ts` imports them directly without loading the tab.
- [x] **AC4** — The detail tabs are mounted with `key={selected.id}` and the three
      `[profile.id]` reset effects are deleted; `setFilterText('')` moves into a
      `selectCategory(id)` handler; the ConfigView "one-tick staleness" comment is gone.
- [x] **AC5** — `src/renderer/src/modules/config/test/` provides `profileFixture(overrides)`,
      `stubBridge()` and `renderWithProviders(ui)`; the seven ControlsTab suites plus the
      SettingsTab and AliasesTab tests use them on `@testing-library/react` only; no test file in
      the module declares its own `profileFixture`.
- [x] **AC6** — `ControlsTab.tsx` is under 800 lines and under 12 `useState` (soft caps for
      story 208's architecture test); the four `controls-*` flows and every config flow pass.
- [x] **AC7** — Focused tests exist for `BindSlot`, `CvarRow`, `KeyBindDialog` and `LayersPanel`
      (one behaviour each is enough to anchor coverage).

## Decisions (Sprint)

- **(User)** Q1: Per-component tests only; no coverage threshold.
- **D-a** Build against the tree as 212/216/218 leave it (save hook, `NameDialog`, profile
  provider) — they precede 213 in the sprint, so every D says "as of build time" instead of
  pinning today's line numbers.
- **D-b** The harness comes first (D1–D2), before any refactor — the moved code is then guarded by
  suites that no longer carry their own copies of the fixture and bridge.
- **D-c** `profileFixture(overrides)` wraps the existing `makeConfigProfile` from
  `src/test-support/fixtures.ts` and adds the Controls defaults (categories + actions) — one
  builder, not a third.
- **D-d** `test/bridge.ts` installs the `window.q2` stub at module scope on import and
  `stubBridge()` resets and returns it — `lib/bridge.ts` reads `window.q2` at module scope, so the
  stub must exist before the tab is imported; test files import the harness first.
- **D-e** Hooks go to `lib/` exactly as AC1/AC3 name them and dialogs to `components/` (the folder
  that exists today); story 227 runs later and moves them if its placement rule says otherwise.
- **D-f** The four non-slot per-row helpers (`renderDropToggles`, both options cells,
  `renderMessageSubRow`, `renderRowMenu`) move with the six row/slot helpers into
  `ControlsEntryRow` — they are only ever called from a row, and leaving them would keep the tab
  over 800 lines.
- **D-g** AC1's "runs once per entry" and AC2's "one path" are structural claims, so they get
  source assertions in `src/architecture.test.ts` (no `deriveRowState` in the tab/row, exactly one
  `<BindSlot` in `ControlsEntryRow.tsx`) — a test, not a hard review.
- **D-h** AC6's soft caps become an assertion in `src/architecture.test.ts` for `ControlsTab.tsx`
  only — story 208's user decision left size to 210/213, so this is the owner adding it.
- **D-i** `key={selected.id}` goes on the element that owns the draft (218's
  `ProfileDraftProvider`, or the detail-tab container if the draft still lives in `ConfigView`), so
  the draft and every tab mount fresh together — that is what removes the one-tick lag the comment
  describes.
- **D-j** "Smooth while dragging" is delivered by the memoised row pipeline (AC1), a `memo`-wrapped
  `ControlsEntryRow` with a memoised context, and drag state isolated in its hook — no frame-time
  test, the AC list does not ask for one.
- **D-k** `ControlsGrid.dnd.test.tsx` keeps its own idiom — AC5 names nine suites and that one
  mounts no profile.
- **D-l** No CHANGELOG entry — the story is a refactor with no user-visible change.
- **D-m** "Every config flow" = the flows that open the Config detail tabs (listed under
  Acceptance Tests); the sprint's `e2e-all` gate covers the rest.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Is a vitest coverage threshold for `modules/config/components/**` wanted, or is
      the per-component test list enough?

## Plan

Built after 212 (save hook), 216 (`NameDialog`, `Tabs`) and 218 (profile provider); read
`ControlsTab.tsx` as those stories leave it. Three slices, each independently committable and
green:

1. **Harness (D1–D2).** `modules/config/test/` gets `profileFixture`, `stubBridge`,
   `renderWithProviders`; the seven ControlsTab suites, `SettingsTab.dnd.test.tsx` and
   `AliasesTab.test.ts` move onto it on `@testing-library/react`; `src/architecture.test.ts` pins
   "no local `profileFixture` in the module".
2. **Rows (D3–D4).** `lib/useControlsRows.ts` memoises the row pipeline incl. a per-entry
   `rowState` map; `components/ControlsEntryRow.tsx` (memo) replaces the six row/slot helpers plus
   the four per-row helpers, reading `rowState` from the hook. Structural assertions in
   `src/architecture.test.ts`.
3. **Drag, rail, dialogs, reset (D5–D8).** `lib/useControlsDrag.ts`; the five appended dialogs to
   `components/`; `components/ControlsCategoryRail.tsx` takes the rail + category dialogs + their
   handlers; `key={selected.id}` replaces three `[profile.id]` reset effects (ControlsTab,
   SettingsTab, OverviewKeyboardPanel) and `selectCategory(id)` replaces the filter-reset effect;
   size cap assertion; config system doc.
4. **Anchor tests (D9).** One behaviour each for `BindSlot`, `CvarRow`, `KeyBindDialog`,
   `LayersPanel` on the harness.

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8; D9 any time after D1. After each D the seven
ControlsTab suites and the four `controls-*` flows stay green.

## Deliverables

- [x] **D1 — Shared config test harness + first four suites.** Create
      `src/renderer/src/modules/config/test/fixtures.ts` (`profileFixture(overrides)` wrapping
      `makeConfigProfile` from `src/test-support/fixtures.ts`, defaulting two categories `movement`/
      `weapons` and a catalogue + a plain action), `test/bridge.ts` (on import installs a
      `globalThis.q2 = { invoke: vi.fn(), on: () => () => {} }` stub at module scope, because
      `lib/bridge.ts` reads `window.q2` at module scope; exports `stubBridge()` which resets and returns
      it, default `invoke` resolving `{ ok: true, value: [] }`), `test/render.tsx`
      (`renderWithProviders(ui, { profile? })` = `@testing-library/react` `render` wrapped in
      `ProfileChangesProvider` and, if story 218 landed, its `ProfileDraftProvider`; calls `initI18n`
      once). Test files import the harness **before** the component. Migrate
      `ControlsTab.bindings.test.tsx`, `ControlsTab.category-drag.test.tsx`,
      `ControlsTab.category-menu.test.tsx`, `ControlsTab.dnd.test.tsx` off `createRoot`/`act`/
      `IS_REACT_ACT_ENVIRONMENT`/`vi.hoisted` bridge/local `profileFixture` onto the harness; keep
      every assertion. Test: `test/harness.test.tsx` › "renderWithProviders mounts with a stubbed
      bridge".
- [x] **D2 — Remaining suites on the harness + guard.** Migrate `ControlsTab.row-menu.test.tsx`,
      `ControlsTab.subcategory-drag.test.tsx`, `ControlsTab.dialogs.test.ts`,
      `SettingsTab.dnd.test.tsx`, `AliasesTab.test.ts` (all under
      `src/renderer/src/modules/config/`) onto `test/` from D1, `@testing-library/react` only (no
      `react-dom/client`). Add to `src/architecture.test.ts` (reuse its `source-tree` helpers) a test
      › "config module tests use the shared harness": no `*.test.ts(x)` under
      `src/renderer/src/modules/config/` declares `function profileFixture`/`const profileFixture`,
      and none of the nine named suites imports `react-dom/client`.
- [x] **D3 — `useControlsRows`.** New `src/renderer/src/modules/config/lib/useControlsRows.ts`: one
      `useMemo` over (category id, actions, filter text, …) that runs `buildControlsRowEntries`, the
      filter, `groupControlsRowEntries` (`lib/controls-row-groups.ts`), `buildMoveTargets`, the bound
      count, and a `rowState: Map<entryId, RowState>` with `deriveRowState` called once per catalogue
      entry. `ControlsTab.tsx` reads entries/groups/moveTargets/boundCount/rowState from it and stops
      computing them inline (today around lines 883–1046). Test `lib/useControlsRows.test.ts` with
      `renderHook`: › "computes groups, move targets and bound count in one pass" and › "derives row
      state once per entry" (spy on `deriveRowState`, calls === catalogue entry count; a rerender with
      equal inputs adds no calls).
- [x] **D4 — `ControlsEntryRow`, one path.** New
      `src/renderer/src/modules/config/components/ControlsEntryRow.tsx`, `memo`-wrapped, props
      `{ entry: ControlsRowEntry; odd; grip; ctx }` where `ctx` is a `useMemo`'d object from the tab
      (draft actions, `rowState` map from D3, conflict index, handlers for assign/clear/replace/
      message/menu/move, reveal/expand sets). It replaces `renderCatalogSlot`, `renderPlainSlot`,
      `renderKeyCell`, `renderExtraKeyRows`, `renderCatalogRow`, `renderPlainActionRow` **and** the
      per-row `renderDropToggles`, `renderCatalogOptionsCell`, `renderPlainOptionsCell`,
      `renderMessageSubRow`, `renderRowMenu` in `ControlsTab.tsx`. Catalogue vs plain differs only in
      data (keys from `rowState` vs plain key slots, `withCatalogBody` applied in the assign handler
      for catalogue rows, options cell content): exactly **one** `<BindSlot` JSX site; the "only
      difference is withCatalogBody" comment is deleted. Reuse `ControlsRow`, `BindSlot`,
      `ControlsOptionsCell`, `ControlsRowMenu`, `DropToggles` as-is. Test
      `components/ControlsEntryRow.test.tsx` on D1's harness: assign, clear, replace × catalogue row and
      plain row (six cases, asserting the patched action keys). Add to `src/architecture.test.ts` ›
      "Controls rows have one slot path": `ControlsEntryRow.tsx` contains exactly one `<BindSlot`, and
      neither it nor `ControlsTab.tsx` references `deriveRowState`.
- [x] **D5 — `useControlsDrag`.** New `src/renderer/src/modules/config/lib/useControlsDrag.ts` owning
      `draggingRowId`, `springCategoryId`, the spring-load timer (the `handleSpringLoad`
      `useCallback` + ref workaround moves inside) and the drag start/end/cancel handlers handed to
      `ControlsDragZone`; returns stable callbacks so a pointer move does not change `ControlsEntryRow`
      props. `ControlsTab.tsx` consumes it. Test `lib/useControlsDrag.test.ts` (`renderHook`, fake
      timers) › "spring-loads a category after the hover delay and cancels on drag end". The existing
      `ControlsTab.dnd`/`category-drag`/`subcategory-drag` suites must stay green.
- [x] **D6 — Appended dialogs into `components/`.** Move `CreateCategoryDialog`,
      `RenameCategoryDialog`, `CreateSubcategoryDialog`, `RenameSubcategoryDialog`, `CreateActionDialog`
      (+ `ENTRY_KIND_OPTIONS`) out of the bottom of `ControlsTab.tsx` into one file each under
      `src/renderer/src/modules/config/components/` (in whatever shape story 216 left them — thin
      `NameDialog` callers if it landed). `ControlsTab.dialogs.test.ts` imports them from
      `./components/…` and no longer imports `./ControlsTab`. Test: that suite, plus
      `src/architecture.test.ts` › "ControlsTab.dialogs.test does not load the tab" (source check: no
      `ControlsTab'` import).
- [x] **D7 — `ControlsCategoryRail`.** New
      `src/renderer/src/modules/config/components/ControlsCategoryRail.tsx` owning the category chip
      rail (sortable chips, `ControlsCategoryMenu`), the create/rename/delete category and
      create/rename subcategory dialog state and their persist handlers (via story 212's save hook),
      and chip scroll-into-view. `ControlsTab.tsx` passes `selectedCategoryId` + a
      `selectCategory(id)` handler that sets the id **and** `setFilterText('')`; the
      `useEffect(() => setFilterText(''), [selectedCategoryId])` is deleted. The rail stays inside the
      tab's single `DndContext` (story 054 D5). Test: `ControlsTab.category-menu.test.tsx` /
      `category-drag` stay green, plus new case in `ControlsTab.bindings.test.tsx` › "selecting a
      category clears the filter".
- [x] **D8 — Remount on profile switch, caps, doc.** In `ConfigView.tsx` (or 218's detail
      component) put `key={selected.id}` on the element that owns the draft (218's
      `ProfileDraftProvider`, else the detail-tab container) so tabs and draft mount fresh per profile;
      delete the `[profile.id]` reset effects in `ControlsTab.tsx`, `SettingsTab.tsx`,
      `OverviewKeyboardPanel.tsx` (move any initial value into the `useState` initialiser) and the
      "one-tick staleness" comment in `ConfigView.tsx`. Test
      `ConfigView.profile-switch.test.tsx` › "switching profile remounts the detail tabs with fresh
      state" (Controls filter text and selected category reset; Overview test mode off). Add to
      `src/architecture.test.ts` › "ControlsTab stays under its soft caps": `ControlsTab.tsx` < 800
      lines and < 12 `useState(` occurrences; if still over, move the remaining action-mutation
      handlers into `lib/useControlsEntryActions.ts`. Update `docs/systems/config-module.md` §5
      "Controls" with the component tree (tab → rail / rows hook / drag hook / `ControlsEntryRow`) and
      the shared test harness path.
- [x] **D9 — Anchor tests.** On D1's harness, one behaviour each:
      `components/BindSlot.test.tsx` › "an empty slot starts key capture",
      `components/CvarRow.test.tsx` › "editing the value reports the new cvar value",
      `components/KeyBindDialog.test.tsx` › "a captured key is confirmed to the caller",
      `LayersPanel.test.tsx` › "adding a layer saves it through the bridge" (all under
      `src/renderer/src/modules/config/`). Read each component's props to pick the exact event; no
      product changes.

## Model Hints

- D4 → deliverable-hard — merging the catalogue and plain slot paths into one is where a binds
  regression hides: `withCatalogBody` on the first assign, `compactAdd`, extra key rows, inert
  slots and the drop toggles each differ subtly between the two helpers today, and the six-case
  test only covers assign/clear/replace.
- Review: → default — the structural claims (one `<BindSlot`, no `deriveRowState` in tab/row, no
  local fixtures, size caps, dialogs test not loading the tab) are source assertions in
  `src/architecture.test.ts`, so a default review plus the tests catch the plausible wrong builds.

## Acceptance Tests

- AC1 → unit `src/renderer/src/modules/config/lib/useControlsRows.test.ts` › "computes groups,
  move targets and bound count in one pass", › "derives row state once per entry";
  unit `src/architecture.test.ts` › "Controls rows have one slot path" (tab reads rows from the
  hook: no `deriveRowState` in `ControlsTab.tsx`).
- AC2 → component `src/renderer/src/modules/config/components/ControlsEntryRow.test.tsx` ›
  assign/clear/replace for catalogue and plain rows; unit `src/architecture.test.ts` › "Controls
  rows have one slot path".
- AC3 → unit `src/renderer/src/modules/config/lib/useControlsDrag.test.ts` › "spring-loads a
  category after the hover delay and cancels on drag end"; component
  `src/renderer/src/modules/config/ControlsTab.dialogs.test.ts` (imports from `components/`);
  unit `src/architecture.test.ts` › "ControlsTab.dialogs.test does not load the tab"; e2e
  `npm run ui:flow -- controls-category-rename-reorder` (rail through the real surface).
- AC4 → component `src/renderer/src/modules/config/ConfigView.profile-switch.test.tsx` ›
  "switching profile remounts the detail tabs with fresh state"; component
  `src/renderer/src/modules/config/ControlsTab.bindings.test.tsx` › "selecting a category clears
  the filter".
- AC5 → unit `src/architecture.test.ts` › "config module tests use the shared harness";
  component `src/renderer/src/modules/config/test/harness.test.tsx` › "renderWithProviders mounts
  with a stubbed bridge".
- AC6 → unit `src/architecture.test.ts` › "ControlsTab stays under its soft caps"; e2e
  `npm run ui:flow -- controls-category-rename-reorder`, `controls-drag-reorder`,
  `controls-extra-keys`, `controls-subcategory`, `config-header-geometry`, `custom-action-row`,
  `drop-message-checkbox`, `grenade-rows-take-a-key`, `open-keycap-dialog`,
  `settings-section-rename-add-cvar`, `alias-rename-dialog`, `unsaved-diff`,
  `demo-actions-bind`; the sprint's `npm run ui:flows` covers the rest.
- AC7 → component `src/renderer/src/modules/config/components/BindSlot.test.tsx` › "an empty slot
  starts key capture"; `components/CvarRow.test.tsx` › "editing the value reports the new cvar
  value"; `components/KeyBindDialog.test.tsx` › "a captured key is confirmed to the caller";
  `src/renderer/src/modules/config/LayersPanel.test.tsx` › "adding a layer saves it through the
  bridge".

Coverage gate: AC1 → D3 (+D4 assertion) · AC2 → D4 · AC3 → D5, D6, D7 · AC4 → D7, D8 · AC5 → D1,
D2 · AC6 → D8 (cap) + every D (flows) · AC7 → D9. No criterion is user-facing behaviour change;
the e2e lines prove the refactor kept the real surface working.

## Done

Controls tab is now a component tree: `lib/useControlsRows`, `lib/useControlsDrag`, `lib/useControlsEntryActions`, `components/ControlsEntryRow` (one `<BindSlot`), `components/ControlsCategoryRail`, five dialogs moved to `components/`; ControlsTab.tsx 2,313 -> ~620 lines, 10 `useState`. Detail tabs remount via `key={selected.id}` on `ProfileChangesProvider`; the `[profile.id]` reset effects and the filter-reset effect are gone. Shared harness in `modules/config/test/` used by the nine suites; four anchor tests added.

Commit message: `213: Controls tab component tree (rows/drag/rail/actions hooks, ControlsEntryRow), shared config test harness, anchor tests`

Verification (narrow gate): build, lint, typecheck green; `npx vitest run --changed HEAD` green (36 files); config + architecture + test-support vitest green (71 files / 700 tests). Flows green: controls-category-rename-reorder, custom-action-row, open-keycap-dialog, settings-section-rename-add-cvar, alias-rename-dialog, demo-actions-bind, controls-drag-reorder, grenade-rows-take-a-key, config-header-geometry. Not re-run on the fix pass: controls-extra-keys, unsaved-diff, drop-message-checkbox (known pre-existing red in the sprint). Full gate pending (sprint's).
AC -> test, all passed: AC1 useControlsRows.test + architecture "Controls rows have one slot path"; AC2 ControlsEntryRow.test (6 cases) + same; AC3 useControlsDrag.test, ControlsTab.dialogs.test, architecture dialogs check, flow controls-category-rename-reorder; AC4 ConfigView.profile-switch.test (verified to fail without the key), ControlsTab.bindings "selecting a category clears the filter"; AC5 architecture "config module tests use the shared harness", harness.test; AC6 architecture "ControlsTab stays under its soft caps" + flows; AC7 BindSlot/CvarRow/KeyBindDialog/LayersPanel tests. No manual residue.

Decisions: no CHANGELOG entry (refactor). `isTestFile` in src/test-support/source-tree.ts now matches any `/test/` dir (harness files must not count as production mounts). save-refusal.test.tsx moved onto the shared fixture too (had a local profileFixture). `useControlsDrag` test covers hook state only: the 600 ms hover delay lives in `CategoryDropTarget`. KeyBindDialog has no key-capture UI, so its test asserts the setBinds payload. Review fixes: stronger profile-switch/useControlsRows/KeyBindDialog tests, stable `viewActions`, shared `rawCommandText`.
Open: `ControlsGrid` builds a new `grip` element per render, so `memo` on `ControlsEntryRow` cannot skip rows yet (ControlsGrid was outside this story). ControlsTab.tsx still carries older "Story NNN" history comments (pre-existing). ControlsEntryRow tests cover assign/clear/replace only (as planned), not compactAdd/extra-key rows/drop toggles.

tiers: D 9 / hard 1 · review default · cycles 1 · agents 13
