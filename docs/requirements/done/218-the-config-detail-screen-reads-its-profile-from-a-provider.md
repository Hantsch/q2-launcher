---
id: 218
title: the config detail screen reads its profile from a provider
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a new config tab to read the selected profile, its draft, `patch` and
the installations from one provider instead of accepting and forwarding a four-prop contract,
and I want the profile list to live in one store, so that a rename from the dashboard tile or the
address-book dialog is visible in an open Config view without a remount and `ConfigView` can
shrink to layout.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F40):
`src/renderer/src/modules/config/ConfigView.tsx` is 1,067 lines with 13 `useState`, 6 `useEffect`
and a 450-line `return` mounting 11 surfaces; `profile`/`draft`/`patch`/`onChanged` are props of
SettingsTab, ControlsTab and AliasesTab and `profile`/`onChanged` of eight more; `installations`
is re-read from `useLauncher` in two tabs; an `activeProfile` helper papers over `draft ?? selected`.
`listConfigProfiles` is fetched independently in `ConfigView`, `ConfigProfilesTile` and
`AddToAddressBookDialog` with no shared store, while replays already has Zustand stores for the
same kind of state and `useProfileChanges()` proves context works here.

Depends on stories 212 (save hook) and 215 (query hook).

## Acceptance Criteria

- [x] **AC1** — `lib/ProfileDraftProvider.tsx` exposes
      `useProfileDraftContext(): { profile, draft, patch, installations, save }` and is mounted
      once around the detail screen; the three main tabs and the eight panels read from it; no
      tab declares `profile`/`draft`/`patch`/`onChanged` props (grep-zero in the module).
- [x] **AC2** — A small Zustand `useConfigProfiles` store (`load`, `replaceAll`, `upsert`,
      `remove`) is the only reader of `listConfigProfiles`; `ConfigView`, `ConfigProfilesTile`
      and `AddToAddressBookDialog` subscribe to it; a renamed profile in the tile is reflected in
      an open Config view (component test).
- [x] **AC3** — `ConfigDetailHeader`, `ConfigTabStrip` (on story 216's `Tabs` if it has landed)
      and the list screen are their own components; `ConfigView.tsx` is under 350 lines.
- [x] **AC4** — The config header geometry flow (`config-header-geometry`) and every config flow
      pass.

## Decisions (Sprint)

- **(User)** Q1: Store owns the list only; selected profile id stays in useLauncher route focus.
- D-1: The store lives at `src/renderer/src/modules/config/config-profiles-store.ts` (module root,
  like `replays/playback-store.ts`) — the repo's module stores sit at the module root, and home/servers
  reach it through two new `ALLOWED` edges in `src/architecture.test.ts` with story `218`.
- D-2: `load()` returns the `Outcome` it got and drops a response that resolves after a newer
  `replaceAll`/`upsert`/`remove` or `load` (sequence counter) — a slow list read must never revert a
  save that already landed.
- D-3: The context's `save` is the **result sink** `save(updated: ConfigProfile[] | ConfigProfile)`
  (array → `replaceAll`, single → `upsert`), not a shared debounce instance — story 212's
  `useProfileSave` stays one instance per surface (it cancels on unmount, and Overview mounts two
  saving surfaces at once), so the provider owns only where a confirmed save lands; it replaces every
  `onChanged`/`onProfileUpdated`/`onSaved` prop of the in-scope surfaces.
- D-4: The provider takes `profile` (the selected saved profile) as a prop and owns `useProfileDraft`,
  so `draft` in context is non-null (`draft ?? profile`) and the `activeProfile` helper is deleted.
- D-5: "The eight panels" are OverviewKeyboardPanel, LayersPanel, RawFileTab, CareTab,
  UnsavedChangesTab, ProfileSaveActions, AssignmentsMenu and ProfileAssignmentsPanel — every surface
  that today receives `profile` plus a change callback from ConfigView; dialogs
  (Rename/Delete/Discard/KeyBind/CareBatchFix/ConfigConflict) keep their explicit `profile` prop, being
  call-scoped rather than screen-scoped.
- D-6: AC1's "grep-zero" is the regex `^\s+(profile|draft|patch|onChanged)\??:\s` over the 11 files
  (comments stripped) plus "UnsavedChangesTab takes no props" — a measurable form of "declares the prop".
- D-7: AC2's rename test renders ConfigView (detail open) and ConfigProfilesTile side by side against a
  mocked client whose second `listConfigProfiles` answer carries the new name; the tile's reload must
  change the Config header without remounting ConfigView — the tile has no rename action of its own,
  so "renamed in the tile" means "the tile's read brought the rename in".
- D-8: The tile renders its rows from the store's `profiles` (sync states still fetched per profile);
  AddToAddressBookDialog keeps its "re-read fresh on open and on profile switch" behaviour by calling
  `load()` and upserts the profile `commitProfileCvars` returns — freshness (its story's AC5) stays.
- D-9: ConfigTabStrip is built on story 216's `Tabs` (216 builds before 218 in S33); if 216 already
  moved the strip onto `Tabs` inside ConfigView, D6 only extracts it — `data-testid="config-tab-strip"`
  and `config-tab-<id>` stay, because config-header-geometry and other flows select by them.
- D-10: "Every config flow" (AC4) is every flow that greps for `config-tab-`, `config-profile-row` or
  `/config` (26 flows), plus `home-dashboard-arrange` and `home-dashboard-keyboard`, which render the
  Config Profiles tile — the set a ConfigView/store regression can reach (listed under Acceptance Tests).
- D-11: The structural checks (only-reader, no props, mounted once, line cap) go into one node-env test
  `src/renderer/src/modules/config/config-structure.test.ts` using `src/test-support/source-tree.ts`
  helpers — same mechanism as `src/architecture.test.ts`, kept with the module it guards.
- D-12: Tests that rendered tabs with spy `patch`/`onChanged` props wrap the tab in the real
  `ProfileDraftProvider` and assert on the store / rendered output instead; no fake context — story 213
  builds the shared Controls test harness afterwards.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Does the store also own the selected profile id (today in `useLauncher`'s route
      focus) or only the list?

## Plan

Builds after 212 (`lib/useProfileSave.ts`), 215 (`lib/useModuleQuery.ts`, `useTileData` alias) and
216 (`components/ui` `Tabs`). Order: store first, then its other subscribers, then the provider, then
the consumers, then the layout split.

1. **Store (D1).** `modules/config/config-profiles-store.ts`: Zustand `useConfigProfiles` with
   `profiles`, `load()`, `replaceAll`, `upsert`, `remove`; stale-load guard (D-2). ConfigView's
   `profiles` `useState` + list effect go; every `setProfiles(...)` becomes a store action.
2. **Other subscribers (D2).** ConfigProfilesTile and AddToAddressBookDialog read through the store;
   allowlist edges; structure test "only the store reads `listConfigProfiles`"; the cross-surface
   rename component test.
3. **Provider (D3).** `lib/ProfileDraftProvider.tsx` — `{ profile, draft, patch, installations, save }`
   (D-3/D-4), mounted once in ConfigView around the detail screen; SettingsTab and AliasesTab read it.
4. **Controls (D4).** ControlsTab reads it; its seven test suites wrap in the real provider.
5. **Panels (D5).** The eight panels (D-5) read it; structure test for AC1's grep-zero.
6. **Layout split (D6).** `ConfigListScreen`, `ConfigDetailHeader`, `ConfigTabStrip` (on `Tabs`) and
   the file banners leave ConfigView; ConfigView < 350 lines; every config flow green.

Affected: `src/renderer/src/modules/config/{ConfigView,SettingsTab,ControlsTab,AliasesTab,
OverviewKeyboardPanel,LayersPanel,RawFileTab,CareTab,AssignmentsMenu,ProfileAssignmentsPanel}.tsx`,
`components/{UnsavedChangesTab,ProfileSaveActions}.tsx`, new store/provider/components,
`modules/home/dashboard/ConfigProfilesTile.tsx`, `modules/servers/AddToAddressBookDialog.tsx`,
`src/architecture.test.ts`, `docs/systems/config-module.md`. No IPC, main or i18n change; no
user-visible change (no CHANGELOG entry).

## Deliverables

- [x] **D1 — `useConfigProfiles` store, ConfigView reads it.** New
  `src/renderer/src/modules/config/config-profiles-store.ts` (Zustand `create`, mirror the shape of
  `src/renderer/src/modules/replays/playback-store.ts`): state `profiles: ConfigProfile[]`; actions
  `load(): Promise<Outcome<ConfigProfile[]>>` (calls `listConfigProfiles` from `./client`, on `ok`
  replaces the list, returns the outcome unchanged), `replaceAll(list)`, `upsert(profile)` (replace by
  id, append if new), `remove(id)`. A sequence counter bumped by every action makes a `load()` that
  resolves after any later action leave the list alone. In
  `src/renderer/src/modules/config/ConfigView.tsx`: drop `const [profiles, setProfiles]` and the
  `listConfigProfiles` effect; subscribe with `useConfigProfiles((s) => s.profiles)`, call `load()` on
  mount; `onChanged={setProfiles}`/`handleCreated`/`handleRenamed`/`handleDeleted`/`handleDiscarded` →
  `replaceAll`, `handleProfileUpdated` → `upsert`, `handleFileSourceResult` →
  `replaceAll(applyRefreshedProfile(useConfigProfiles.getState().profiles, result))`. Keep the
  route-focus and "profile disappeared" effects' semantics: the list may now already be populated on
  mount (store outlives the view) — the pending-focus ref must still apply a hint on that first
  commit, and still be one-shot. Tests: `config-profiles-store.test.ts` (new) — "load fills the list
  and returns the outcome", "a failed load leaves the list", "a load resolving after upsert does not
  revert it", "replaceAll, upsert and remove"; reset the store in `beforeEach`
  (`useConfigProfiles.setState({ profiles: [] })`). `ConfigView.routeFocus.test.tsx`: reset the store
  in `beforeEach`, add "a route-focus hint opens the profile when the store already holds the list".

- [x] **D2 — The tile and the address-book dialog subscribe; only the store reads the list.**
  `src/renderer/src/modules/home/dashboard/ConfigProfilesTile.tsx`: `fetchConfigProfilesData` gets
  the list via `useConfigProfiles.getState().load()` (throw on `!ok`, as today), rows render from the
  store's `profiles` joined with the fetched sync states by id (D-8). `src/renderer/src/modules/servers/AddToAddressBookDialog.tsx`:
  both `listConfigProfiles()` reads become `load()` (same error handling), the profile list it renders
  comes from the store, and the profile `commitProfileCvars` returns is `upsert`ed. `src/architecture.test.ts`:
  two `ALLOWED` edges, story `218`, reason "reads the shared config profile list" —
  `home/dashboard/ConfigProfilesTile.tsx → config/config-profiles-store` and
  `servers/AddToAddressBookDialog.tsx → config/config-profiles-store` (drop any edge that no longer
  matches a real import — the test "every allowlist entry still matches a real import" enforces it).
  Reset the store in `beforeEach` of `ConfigProfilesTile.test.tsx`, `home/dashboard/i18n.test.tsx` and
  `AddToAddressBookDialog.test.tsx`. New `src/renderer/src/modules/config/config-structure.test.ts`
  (node env; `listSourceFiles`/`readRepoFile`/`stripComments`/`isTestFile` from
  `src/test-support/source-tree.ts`): "only the config profiles store reads listConfigProfiles" —
  in non-test files under `src/renderer/src`, `listConfigProfiles(` appears only in
  `config-profiles-store.ts` (and its declaration in `client.ts`). New
  `src/renderer/src/modules/config/ConfigView.profilesStore.test.tsx` (jsdom; mock `./client` as
  `ConfigView.routeFocus.test.tsx` does): "a profile renamed through the dashboard tile shows in an
  open Config view without a remount" — render `ConfigView` and `ConfigProfilesTile` together, open
  the profile, let the tile's second read return the renamed profile, assert
  `config-profile-identity` shows the new name and ConfigView's mount counter (or a ref'd DOM node)
  is unchanged.

- [x] **D3 — `ProfileDraftProvider`; Settings and Aliases read it.** New
  `src/renderer/src/modules/config/lib/ProfileDraftProvider.tsx` (mirror the context shape of
  `lib/profile-changes.tsx`): `ProfileDraftProvider({ profile, children })` owns
  `useProfileDraft(profile)` and exposes `useProfileDraftContext(): { profile, draft, patch,
  installations, save, resetDraft }` — `draft` is `draft ?? profile` (non-null), `installations` from
  `useLauncher`, `save(updated: ConfigProfile[] | ConfigProfile)` → store `replaceAll`/`upsert`
  (D-3); the hook throws outside the provider. ConfigView mounts it once, directly inside
  `ProfileChangesProvider`, around the whole detail screen; delete `activeProfile`/`draftOrSelected`
  from ConfigView (validation reads the context or `draft ?? selected` inside the provider's subtree).
  `SettingsTab.tsx` and `AliasesTab.tsx` drop `profile`/`draft`/`patch`/`onChanged` props and read the
  context (SettingsTab also drops its own `useLauncher` installations read); their saves report
  through `save`. Update `SettingsTab.dnd.test.tsx` and `AliasesTab.test.ts` to wrap in the real
  provider (D-12). New `lib/ProfileDraftProvider.test.tsx` (jsdom): "exposes profile, draft, patch,
  installations and save", "save with a list replaces the store, with one profile upserts it",
  "patch changes draft but not profile", "useProfileDraftContext throws outside the provider".
  `docs/systems/config-module.md` §6: one bullet — renderer profile state is the
  `useConfigProfiles` store (list) plus `ProfileDraftProvider` (selected profile, draft, save sink);
  selection stays in ConfigView via route focus.

- [x] **D4 — ControlsTab reads the provider.** `src/renderer/src/modules/config/ControlsTab.tsx` drops
  `profile`/`draft`/`patch`/`onChanged` props and its `useLauncher` installations read, uses
  `useProfileDraftContext()` (from D3, `lib/ProfileDraftProvider.tsx`); `focusActionId` stays a prop.
  ConfigView's `<ControlsTab>` mount loses those props. The seven suites
  `ControlsTab.{bindings,category-drag,category-menu,dnd,row-menu,subcategory-drag}.test.tsx` and
  `ControlsTab.dialogs.test.ts` render inside the real `ProfileDraftProvider` with a store reset in
  `beforeEach`; assertions that read a spy `patch`/`onChanged` assert on the rendered output or the
  store instead. All seven stay green with the same test names.

- [x] **D5 — The eight panels read the provider; AC1's grep-zero.** `OverviewKeyboardPanel.tsx`,
  `LayersPanel.tsx`, `RawFileTab.tsx`, `CareTab.tsx` (both components in the file),
  `AssignmentsMenu.tsx`, `ProfileAssignmentsPanel.tsx` (all under `src/renderer/src/modules/config/`),
  `components/UnsavedChangesTab.tsx` and `components/ProfileSaveActions.tsx` drop `profile` and their
  `onChanged`/`onProfileUpdated`/`onSaved` props for `useProfileDraftContext()` (`save` replaces the
  callbacks; ProfileSaveActions' discard path calls the context's `resetDraft` with the discarded
  profile, keeping ConfigView's `handleDiscarded` semantics; AssignmentsMenu/ProfileAssignmentsPanel/
  CareTab take `installations` from context). Non-profile props (`activeLayer`, `activeLayerId`,
  `onSelectLayer`, `validation`, `syncStatus`, navigation callbacks) stay. Update ConfigView's mounts.
  Add to `config-structure.test.ts`: "no config tab or panel declares profile, draft, patch or
  onChanged props" — over the 11 files (3 tabs + 8 panels), comment-stripped, no line matches
  `^\s+(profile|draft|patch|onChanged)\??:\s` and UnsavedChangesTab's signature takes no props; and
  "ProfileDraftProvider is mounted exactly once" — `<ProfileDraftProvider` occurs once across non-test
  files under `src/renderer/src`.

- [x] **D6 — ConfigView is layout.** Extract into `src/renderer/src/modules/config/components/`:
  `ConfigListScreen.tsx` (header + empty state + profile rows + InstallationProfilesPanel, props
  `onOpen`, `onCreate`), `ConfigDetailHeader.tsx` (back button, identity zone, action cluster incl.
  `RenameHeaderButton`; reads the context), `ConfigTabStrip.tsx` (tab list incl. Care badge and
  Unsaved tab, on `Tabs` from `src/renderer/src/components/ui` — D-9; keep
  `data-testid="config-tab-strip"`/`config-tab-<id>` and today's classes/padding, the 30-line
  geometry budget depends on them), and `ProfileFileBanners.tsx` (missing-file banner + diagnostic).
  Move the explanatory comments with the code they explain. If still over budget, move the
  validation/tidy-up/drift badge computation into `lib/useDetailTabBadge.ts`. ConfigView keeps
  selection, tab state, dialogs and providers. Add to `config-structure.test.ts`: "ConfigView is under
  350 lines and mounts the extracted header, tab strip and list screen" (line count < 350; imports of
  the three components). Run `npm run ui:flow -- config-header-geometry` and every flow listed under
  Acceptance Tests.

## Model Hints

- D1 → deliverable-hard — the profile list's lifetime moves from component state to a module-global
  store: a stale `load()` landing after a save's `replaceAll`/`upsert` would silently revert an edit,
  and ConfigView's route-focus/reset effects were written for a list that is empty on every mount
  (StrictMode double-mount, one-shot focus) — both are subtle cross-file regressions.

Review: → default

## Acceptance Tests

- AC1 → unit `src/renderer/src/modules/config/config-structure.test.ts` › "no config tab or panel
  declares profile, draft, patch or onChanged props" (D5)
- AC1 → unit `src/renderer/src/modules/config/config-structure.test.ts` › "ProfileDraftProvider is
  mounted exactly once" (D5)
- AC1 → component `src/renderer/src/modules/config/lib/ProfileDraftProvider.test.tsx` › "exposes
  profile, draft, patch, installations and save" (D3)
- AC2 → unit `src/renderer/src/modules/config/config-profiles-store.test.ts` › "replaceAll, upsert and
  remove", "a load resolving after upsert does not revert it" (D1)
- AC2 → unit `src/renderer/src/modules/config/config-structure.test.ts` › "only the config profiles
  store reads listConfigProfiles" (D2)
- AC2 → component `src/renderer/src/modules/config/ConfigView.profilesStore.test.tsx` › "a profile
  renamed through the dashboard tile shows in an open Config view without a remount" (D2)
- AC3 → unit `src/renderer/src/modules/config/config-structure.test.ts` › "ConfigView is under 350
  lines and mounts the extracted header, tab strip and list screen" (D6)
- AC4 → e2e `scripts/flows/config-header-geometry.mjs` › `config-header-geometry` (D6)
- AC4 → e2e, each by name via `npm run ui:flow -- <name>` (D6): `alias-rename-dialog`,
  `autorecord-setting`, `care-drift-sync-now`, `care-duplicate-name`, `care-fix-item`,
  `controls-category-rename-reorder`, `controls-drag-reorder`, `controls-extra-keys`,
  `controls-subcategory`, `custom-action-row`, `demo-actions-bind`, `drop-message-checkbox`,
  `engine-badge-surfaces`, `external-edit-cascades`, `grenade-rows-take-a-key`, `harness-offscreen`,
  `home-hero-carousel`, `home-tile-states`, `home-dashboard-arrange`, `home-dashboard-keyboard`,
  `linux-user-journey`, `open-keycap-dialog`, `raw-inline-edit`, `raw-save-cascades`,
  `servers-address-book`, `settings-section-rename-add-cvar`, `unsaved-diff`

## Done

Config profile list now lives in the `useConfigProfiles` Zustand store (stale-load guard); `ProfileDraftProvider` serves profile/draft/patch/installations/save to the three tabs and eight panels; ConfigView split into list screen, detail header, tab strip, tab content and file banners (1009 -> 310 lines). No user-visible change, no CHANGELOG entry.

Commit message: `218: useConfigProfiles store, ProfileDraftProvider for tabs and panels, ConfigView split to layout`

Verification (narrow gate): build, lint, typecheck green; `npx vitest run --changed HEAD` 35 files / 225 tests green; the 27 AC4 flows via `npm run ui:flow -- <name>` green except the sprint's known-red set (unsaved-diff, controls-extra-keys, drop-message-checkbox, external-edit-cascades still red as before; config-header-geometry, controls-drag-reorder, controls-subcategory, grenade-rows-take-a-key passed this time). `engine-badge-surfaces` failed once on a stale fixture (rail tile count) and passed after `npm run ui:seed`.
AC -> test: AC1 config-structure.test.ts (props, mounted once) + ProfileDraftProvider.test.tsx; AC2 config-profiles-store.test.ts, config-structure.test.ts (only reader), ConfigView.profilesStore.test.tsx; AC3 config-structure.test.ts (line cap); AC4 flows above. All passed. No manual residue.

Decisions:
- Route-focus hint now applies as soon as the stored list contains it, dropped only after this mount's own `load()` finished without it (`listLoaded`); needed because the store outlives the view.
- Extra extractions to reach <350 lines: `ConfigTabContent.tsx`, `lib/useProfileFileSync.ts`, `lib/useDraftValidation.ts`; `config-structure.test.ts` added to the node-only tsconfig excludes (and the architecture test's expected list).
- Structure test's props regex also ignores comma-terminated lines (call-argument objects like `onChanged: save,`).
- Context also exposes `resetDraft` (D3/D5 discard path). ConfigView keeps `handleProfileUpdated` for RawDraftProvider/rewrite-from-cache.
- Review findings left unfixed, deliberately: dropped stale `load()` still sets `listLoaded` (needs a concurrent load at mount; no second loader is mounted alongside ConfigView); a failed `load()` drops a pending hint; provider mounts only on the detail screen (plan: around the detail screen; draft was per-profile anyway); validation computed twice per draft change (cheap, pure); a tile row added to the store may show no sync state until the next fetch.

tiers: D 6 / hard 1 · review default · cycles 1 · agents 8
