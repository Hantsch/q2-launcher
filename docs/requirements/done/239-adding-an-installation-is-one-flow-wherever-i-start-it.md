---
id: 239
title: adding an installation is one flow wherever I start it
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a new user, "add a new installation" does the same thing whether I start it from the rail's "+"
or from the Library, and it ends with a game I can play.

User feedback 2026-10-04: installing from the sidebar does something completely different from
"Download & install" in the Library; the two processes belong together.

Today:

- The rail "+" offers Add existing, Search this PC and **Create new installation**. Create new
  (`CreateInstallationDialog.tsx`) only makes `<folder>/baseq2` and registers an empty entry with an
  engine label — nothing is downloaded, and the installation then reports "game files missing". Its
  text still says downloading is "not built yet".
- The Library additionally offers **Download & install**, the bootstrap wizard
  (`BootstrapWizard.tsx`: engine → game data → target → confirm → running), which ends with a
  playable installation but has no name field.

Users pick "Create new" from the rail, expect an install, and get an empty folder.

## Acceptance Criteria

- [x] **AC1** — The rail "+" and the Library offer the same set of entries, with the same labels, in
      the same order.
- [x] **AC2** — "New installation" from either place opens the same wizard, which downloads or copies
      engine and game data and ends with a playable installation.
- [x] **AC3** — The wizard lets the user name the installation; the default is the current
      automatic name.
- [x] **AC4** — No entry point can produce an empty installation without game files unless the user
      explicitly chose that (see Q1), and the UI text describes what each entry does.
- [x] **AC5** — No user-visible text claims downloading is not built.

## Open Questions

- ~~**Q1** — Does "Create empty installation" survive at all? It is the only way to start from an
  empty folder the user fills by hand. Recommendation: remove it as a separate entry; the wizard's
  "existing folder" game-data option covers the expert case.~~ answered → Decisions (Sprint)
- ~~**Q2** — Is the merged entry called "New installation…" or "Download & install…"? Recommendation:
  "New installation…", with the wizard's first step explaining download vs. own copy.~~ answered → Decisions (Sprint)
- ~~**Q3** — Related: [[240]] (the target folder is created and shown) changes the wizard's target
  step; build them in one sprint, 239 first.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** "Create empty installation": removed as a separate entry; the wizard's existing-folder option covers it.
- **(User)** Merged entry name: "New installation…".
- **(User)** Relation to 240: informational (build 239 before 240), acknowledged.
- One entry list, `useAddInstallationEntries()` in `src/renderer/src/components/installations/`,
  feeds the rail "+", the Library header and the Library empty state, so AC1 holds by construction
  and is not something three copies have to keep in sync.
- Entries and order: "Add existing installation…", "Search this PC…", "New installation…". This is
  the rail's current order with the merged entry last, so rail users find nothing moved.
- The Library header's separate add buttons become one "Add an installation" menu (`Menu`,
  `side="below"`) with the rail's items. It is the only way the header shows the same labels and the
  same hints as the rail without a second rendering of them.
- The Library empty state shows the same list as buttons, with "New installation…" as the primary
  one, because a first-run user with no installation is exactly the new user this story is about.
- Each entry carries a visible one-line hint (`MenuItem.hint`, already rendered by `Menu.tsx`). That
  hint is the AC4 text that "describes what each entry does".
- The wizard title changes from "Download & install" to "New installation", so the dialog is named
  the way the entry that opened it is named.
- `CreateInstallationDialog` (+ test), the `'create'` dialog kind, the store's `createInstallation`
  and the `installations:create` IPC channel are removed. Without a caller they are orphans, and a
  channel that registers a bare folder would stay an entry point for empty installations (AC4).
  `InstallationsService.create()` stays, because the bootstrap job uses it.
- The name field sits on the wizard's target step, above the folder. [[240]] derives the proposed
  subfolder from the name, so the name has to be set by the time the folder is chosen.
- The default name comes from one pure helper, `defaultBootstrapInstallationName(engine, dataSource)` in `src/shared/modules/downloads.ts`, which `bootstrap/job.ts` uses as well. The
  prefilled value then cannot differ from what main would have picked ("the current automatic name").
- The name state is `nameDraft: string | null`. `null` follows the default, so it updates if the
  user goes back and switches the data source; once the user types, their value is kept.
- A blank name keeps Next disabled on the target step, and the input has `maxLength={120}`. The
  wizard always sends the trimmed name, so the user never gets a different name silently.
- The `library-download-install` and `library-auto-detect` testids are retired. Flows open these
  entries through one helper in `scripts/lib/flow-common.mjs`, so the nine bootstrap flows do not
  each hard-code the new menu clicks.
- `scripts/flows/engine-not-client.mjs` drops its create-dialog section: story 068's AC2 surface no
  longer exists, and the wizard's engine options are covered by the bootstrap flows.
- The confirm step does not repeat the name. No AC asks for it, and [[240]] reworks the confirm
  step's path line anyway.

## Plan

1. **One entry list (renderer, shell).** A new hook `useAddInstallationEntries()` returns the three
   entries (`id`, label, hint, icon, `onSelect`). "New installation…" opens
   `openDialog({ kind: 'module', moduleId: 'downloads', view: 'bootstrap-wizard' })`. The shell
   never imports downloads internals, the same seam `LibraryView` uses today. The rail menu, the
   Library header menu (testid `library-add`) and the empty-state buttons all map this list.
2. **Remove the empty-installation path.** Delete `CreateInstallationDialog`, the `'create'` dialog
   kind, `createInstallation`, the `dialog.create.*` keys and every key D1 orphans. In a separate D,
   remove the `installations:create` channel from `shared/ipc.ts`, `ipc-schemas.ts` and
   `main/ipc/installations.ts`.
3. **Name in the wizard.** Extract `defaultBootstrapInstallationName` into shared and use it in
   `job.ts`. Then add the name `Input` to `TargetStep` and the `nameDraft` state, gate and payload
   to `BootstrapWizard`. Rename the wizard title.
4. **Flows.** Add a `openLibraryAddEntry(page, label)` helper and migrate the existing flows to it.
   Trim `engine-not-client.mjs` and update `screens.mjs` and `docs/UI-VERIFICATION.md`.
5. **Acceptance flow + docs.** A new flow, `add-installation-one-flow`, walks rail and Library,
   finishes a fixture install under a typed name and asserts it is playable. Update
   `docs/systems/install-module.md` (§8 entry and name; close open points 16/17) and add a
   CHANGELOG line.

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7. D2/D3 depend on D1 no longer referencing `'create'`; D6
depends on D1's `library-add` menu.

## Deliverables

- [x] **D1 — One add-installation entry list for rail and Library.**
      New `src/renderer/src/components/installations/useAddInstallationEntries.tsx`, which exports
      `useAddInstallationEntries(): MenuItem[]` (`MenuItem` from `components/ui/Menu.tsx`). The
      entries come in this order: - `add-existing`: label `common.action.addExistingInstallation`, opens `{ kind: 'add-existing' }`. - `detect`: label `rail.autoDetect`, opens `{ kind: 'detect' }`. - `new`: new key `addInstallation.new` = "New installation…", opens
      `{ kind: 'module', moduleId: 'downloads', view: 'bootstrap-wizard' }`.

      Each entry gets a `hint` from new keys in `src/renderer/src/i18n/locales/en.shell.json`:
      - `addInstallation.hint.existing`: "Register a Quake II folder you already have."
      - `addInstallation.hint.detect`: "Find Steam, GOG, Epic and other installations on this PC."
      - `addInstallation.hint.new`: "Download or copy the engine and game data into a new, playable
        installation."

      Icons stay as they are: FolderOpen, Search and HardDriveDownload.

      Change `src/renderer/src/components/shell/InstallationRail.tsx` so its inline `addItems` is
      replaced by the hook. Change `src/renderer/src/views/LibraryView.tsx`:
      - the header's add-existing / auto-detect / create / download-install buttons become one
        `Menu` (`side="below"`, `label={t('rail.add')}`). Its trigger is a `Button` (neutral, sm,
        Plus icon) with `data-testid="library-add"` and the text `rail.add`.
      - "Revalidate all" stays as it is.
      - the empty state's four buttons become the hook's three entries as `Button`s, in the same
        order with the same labels; `new` is `variant="primary"`, the others `neutral`.

      Update `src/renderer/src/i18n/__snapshots__/en.bundle.json` (regenerate it with the
      snapshot update). Do not delete the old keys here; D2 does that.

      Test: new `src/renderer/src/components/installations/useAddInstallationEntries.test.tsx`
      › "the entries are add-existing, detect, new — in that order, each with a hint" and
      › "new installation opens the downloads bootstrap wizard". The second test spies
      `useLauncher.getState().openDialog` and mirrors the store setup in
      `components/installations/RemoveInstallationDialog.test.tsx`.

- [x] **D2 — Remove the empty-installation dialog and its orphaned text (renderer).**
      Delete `src/renderer/src/components/installations/CreateInstallationDialog.tsx` and
      `CreateInstallationDialog.test.ts`. Remove the `'create'` case from
      `components/installations/Dialogs.tsx`. In `src/renderer/src/store/useLauncher.ts`, remove
      `{ kind: 'create' }` from the dialog state union and the `createInstallation` action (its type
      line and its implementation).

      In `en.shell.json`, delete `dialog.create.*` and every key nothing references any more:
      `rail.createNew`, `rail.downloadAndInstall`, `library.create`, `library.downloadAndInstall`,
      `library.autoDetect`. Keep `common.action.addExisting`, which `PlaytimeTile.tsx` still uses.
      Grep each key before deleting it. Remove the `'Download & install'` entry from
      `DUPLICATE_EXCEPTIONS` in `src/renderer/src/i18n/keys.test.ts` once the value no longer
      appears twice; D4 changes the wizard title, so if the value is still duplicated after this D,
      D4 removes the entry. Regenerate the bundle snapshot.

      Test: add a case to `src/renderer/src/i18n/vocabulary.test.ts`
      › "no user-visible string claims downloading is not built". It walks the same `en` bundle
      that file already reads and fails on `/not built/i` or `/until the downloads module/i`.
      `npm test` stays green (the keys and duplicates tests).

- [x] **D3 — Remove the `installations:create` IPC channel (shared + main).**
      Remove `'installations:create'` from `src/shared/ipc.ts` (map entry and channel list),
      `createInstallationInputSchema` from `src/shared/ipc-schemas.ts`, and its handler from
      `src/main/ipc/installations.ts`. Keep the `CreateInstallationInput` type (`InstallationsService`
      and `bootstrap/job.ts` use it) and `InstallationsService.create()`.

      Test: add to `src/main/ipc/installations.test.ts`
      › "no installations channel registers a bare folder without game data". It asserts that
      `'installations:create'` is not an invoke channel and that the registrar registers no
      handler for it; mirror that file's existing registration assertions. `npm run typecheck`
      proves no caller is left.

- [x] **D4 — The wizard lets the user name the installation.**
      In `src/shared/modules/downloads.ts`, add the pure
      `defaultBootstrapInstallationName(engine: EngineKind, dataSource: BootstrapDataSource): string`. It returns `DEFAULT_BOOTSTRAP_INSTALLATION_NAME` for `'free-download'` and
      `engineLabel(engine)` (from `@shared/types`) otherwise, exactly today's inline logic at
      `src/main/modules/downloads/bootstrap/job.ts:843-845`. Replace that inline logic with a call
      (`input.name?.trim() || defaultBootstrapInstallationName(input.engine, dataSource)`).

      In `src/renderer/src/modules/downloads/bootstrap/BootstrapWizard.tsx`:
      - add `const [nameDraft, setNameDraft] = useState<string | null>(null)` and
        `const name = nameDraft ?? (engine ? defaultBootstrapInstallationName(engine, dataSource) : '')`.
      - `canProceed.target` additionally requires `name.trim().length > 0`.
      - `start()` sends `name: name.trim()`.

      In `TargetStep.tsx`, add the props `name`/`onNameChange` and render
      `Field label={t('common.label.name')}` with `Input` (`maxLength={120}`,
      `data-testid="bootstrap-name-input"`) above the folder picker. In
      `src/renderer/src/modules/downloads/locale/en.json`, change `bootstrapWizard.title` to
      "New installation" and `bootstrapWizard.step.target` to "Name the installation and choose
      its folder.". Regenerate the bundle snapshot. Fix `DUPLICATE_EXCEPTIONS` if D2 left it.

      Tests:
      - `src/shared/modules/downloads.test.ts` › "defaultBootstrapInstallationName is the demo name
        for the free download and the engine label otherwise".
      - `BootstrapWizard.test.tsx` › "the name field defaults to the automatic name and the typed
        name is sent". Walk to the target step, read the default "Q2PRO Demo", type, start, and
        assert the `startBootstrapInstall` payload. Mirror the existing "game-data step (story 088
        D5)" describe for the walk.
      - `BootstrapWizard.test.tsx` › "a blank name keeps Next disabled on the target step".
      - The existing `src/main/modules/downloads/bootstrap/job.source-copy.test.ts` name cases stay
        green.

- [x] **D5 — Existing flows open the wizard through the Library add menu.**
      In `scripts/lib/flow-common.mjs`, add
      `export async function openLibraryAddEntry(page, label, timeout = 8_000)`. It clicks
      `nav-library`, then `library-add`, then `page.getByRole('menuitem', { name: label })`, matching
      by prefix because the accessible name includes the hint. Use a `RegExp` anchored at the start
      of the escaped label.

      Replace every `getByTestId('library-download-install').click(...)` (and the `nav-library`
      click right before it) with `openLibraryAddEntry(page, 'New installation…')`, and update the
      step strings and selector comments that say "Download & install". The files are
      `scripts/flows/bootstrap-wizard.mjs`, `bootstrap-r1q2.mjs`, `bootstrap-failure.mjs`,
      `bootstrap-failure-retry.mjs` (two sites), `bootstrap-incomplete-package.mjs`,
      `bootstrap-no-engine-for-platform.mjs`, `bootstrap-existing-folder.mjs`,
      `bootstrap-existing-folder-demo.mjs` (two sites) and `bootstrap-retail-import.mjs`.

      This is the same one-line substitution in every file, so it stays one D despite the file
      count. Acceptance: `npm run ui:flow -- bootstrap-wizard` and
      `npm run ui:flow -- bootstrap-r1q2` pass; grep finds no `library-download-install` under
      `scripts/`.

- [x] **D6 — Retire the create-dialog surface from the harness.**
      In `scripts/flows/engine-not-client.mjs`, delete the create-dialog section (the
      `library-create` steps, the `create-dialog` shot, the engine-select assertion and its
      header-comment lines and constants). Keep the AC1/AC4 engine-badge parts. In
      `scripts/lib/screens.mjs`, replace the `library-auto-detect` click (around line 1145) with
      `openLibraryAddEntry(page, 'Search this PC…')` from `flow-common.mjs`, or an inline
      `library-add` + menuitem click if `screens.mjs` does not import `flow-common.mjs`, and update
      its selector comment (line 71). In `docs/UI-VERIFICATION.md`, update the `engine-not-client`
      description (around line 756) and any `library-download-install` mention.

      Acceptance: `npm run ui:flow -- engine-not-client` passes, and `npm run ui:verify` reaches the
      detect screen.

- [x] **D7 — Acceptance flow, systems doc and changelog.**
      Add `scripts/flows/add-installation-one-flow.mjs`. For `setup`/`teardown`, mirror
      `scripts/flows/bootstrap-wizard.mjs:105-140`: `writePopulatedFixture()`,
      `writeBootstrapTargetDir()`, `startBootstrapFixtureServer()`, and `Q2L_UI_PICK_FOLDER` set to
      the target dir alone. Steps: - (a) Open the rail's "Add an installation" button (`aside` + `getByRole('button', { name: 'Add an installation' })`) and read the `menuitem`s' first-line labels and hints. Press
      Escape, then open `library-add` and read the same. - Assert that both lists equal `['Add existing installation…', 'Search this PC…', 'New installation…']`, that each hint is non-empty, and that no item matches `/create|empty/i`. - (b) From the rail, choose "New installation…" and assert the dialog named "New
      installation" with `bootstrap-engine-*` visible. Close it, then do the same from the
      Library's menu. - (c) Walk engine → free download → target: assert `bootstrap-name-input` reads "Q2PRO Demo",
      fill "One Flow Quake", browse, Next, confirm-start. Wait for `bootstrap-running-step`
      `data-status="succeeded"` (`JOB_TIMEOUT_MS` as in `bootstrap-wizard.mjs`) and dismiss. - Assert that the Library card "One Flow Quake" exists (`libraryCard` from `flow-common.mjs`)
      and that its Play button is enabled.

      Update `docs/systems/install-module.md`:
      - §8: "Launched from 'New installation…' in the rail '+' and the Library's add menu"; the
        target step also takes the name, with the default from `defaultBootstrapInstallationName`.
      - §15 open points 16 and 17: mark them resolved by story 239 (one line each).

      Add one line to `CHANGELOG.md` under `## Unreleased`: "New installation… in the rail and
      Library is one wizard that ends with a playable, named installation."

      Acceptance: `npm run ui:flow -- add-installation-one-flow` passes.

## Model Hints

No `deliverable-hard`. D4's shared extraction is behaviour-preserving and already pinned by the
`job.source-copy.test.ts` name cases. The other Ds are a renderer list, deletions and mechanical
flow edits.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/add-installation-one-flow.mjs` › "add-installation-one-flow" (step a:
  rail and Library menus list the same labels in the same order). Also unit
  `src/renderer/src/components/installations/useAddInstallationEntries.test.tsx` › "the entries
  are add-existing, detect, new — in that order, each with a hint". (D1, D7)
- AC2 → e2e `scripts/flows/add-installation-one-flow.mjs` › "add-installation-one-flow" (step b:
  both entry points open the "New installation" wizard; step c: the fixture install finishes and
  Play is enabled). Also unit `useAddInstallationEntries.test.tsx` › "new installation opens the
  downloads bootstrap wizard". (D1, D7)
- AC3 → e2e `scripts/flows/add-installation-one-flow.mjs` › "add-installation-one-flow" (step c:
  the name field reads "Q2PRO Demo", and the typed "One Flow Quake" is the Library card's name).
  Also unit `src/renderer/src/modules/downloads/bootstrap/BootstrapWizard.test.tsx` › "the name
  field defaults to the automatic name and the typed name is sent" and › "a blank name keeps Next
  disabled on the target step", and unit `src/shared/modules/downloads.test.ts`
  › "defaultBootstrapInstallationName is the demo name for the free download and the engine label
  otherwise". (D4, D7)
- AC4 → e2e `scripts/flows/add-installation-one-flow.mjs` › "add-installation-one-flow" (step a:
  every entry carries a hint, and none matches `/create|empty/i`). Also unit
  `src/main/ipc/installations.test.ts` › "no installations channel registers a bare folder without
  game data". (D1, D2, D3, D7)
- AC5 → unit `src/renderer/src/i18n/vocabulary.test.ts` › "no user-visible string claims
  downloading is not built". (D2)

## Done

Rail "+" and Library header/empty state share one `useAddInstallationEntries()` list (Add existing, Search this PC,
New installation… — each with a hint). "New installation…" opens the bootstrap wizard, which now has a name field
(default from shared `defaultBootstrapInstallationName`). The create dialog, `'create'` dialog kind, store action and
`installations:create` channel are gone. Nine bootstrap flows use `openLibraryAddEntry`; new flow
`add-installation-one-flow`.

Commit message: `239: one add-installation flow — shared entry list, wizard names the installation, empty-create removed`

Verification (narrow gate): build, typecheck, lint, `npx vitest run --changed HEAD` (186 files) green;
comments + architecture tests green. `ui:flows --affected add-installation-one-flow.mjs` exceeded the 10-minute
call (stopped, INCONCLUSIVE), so named flows ran in batches, all green: add-installation-one-flow, bootstrap-* (9),
engine-not-client, engine-badge-surfaces, installation-icon-pick/-tile, installation-remove-from-disk, and after
the review fixes add-installation-one-flow, bootstrap-wizard, import-from-files. `ui:verify`: 0 errors, detect screen
reached; only `replays-*` screens unreachable (known replays reds). Not ours, still red: `scripts/flow-select.test.mjs`
("selects at most 12", replays-playback row at 13; areas.json untouched).
AC → test, all passed: AC1/AC2/AC3/AC4 e2e add-installation-one-flow + the named unit tests; AC5 vocabulary.test.ts.
No manual residue. Review 1 (default tier) FAIL on stale text only; fixed (empty.body, UI-VERIFICATION.md, stale comments); not re-reviewed.

Decisions: (1) D1 also deleted the old rail/library keys and the 'Download & install' DUPLICATE_EXCEPTIONS entry,
because the every-key-referenced test required it. (2) New flow not added to `scripts/flows/areas.json`: the
downloads-bootstrap row would exceed 12 flows and break flow-select.test.mjs, so `--affected` does not pick it by area.
(3) Wizard name tests live in their own describe in BootstrapWizard.test.tsx. (4) `empty.body` reworded to match the entries.
(5) The `StatTile` reflow in LibraryView stays (prettier requires it).

tiers: D 7 / hard 0 · review default · cycles 1 · agents 10
