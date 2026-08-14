---
id: 001
title: Config module scaffold and central profile store
status: in-progress
created: 2026-08-14
---

## Requirement

As a user, I want a real "Config" section in the launcher where I can create, rename and
delete config profiles, so I can start managing my Quake 2 configs from inside the launcher
instead of the separate, discontinued q2-config-manager app.

This is the foundation story for
[docs/concepts/config-module.md](../concepts/config-module.md): it wires the `config` module
in (currently a `PlannedModuleView` placeholder) and introduces the central profile store.
Profiles created here have no cvar/keybinding content yet — that lands in later stories. No
installation assignment yet either (story 002) and nothing is written to disk yet (story 004).

## Acceptance Criteria

- [ ] The Config nav item opens a real module view, not the "planned" placeholder.
- [ ] I can create a new profile, either empty or from the standard template, and give it a
      name.
- [ ] I can rename and delete an existing profile.
- [ ] The profile list persists across app restarts.
- [ ] The UI is built entirely from the launcher's existing design-system primitives (`Panel`,
      `SectionLabel`, `Button`, `Field`/`Input`, etc.) — nothing ported from
      q2-config-manager's CSS or components.

## Open Questions

None — all detail questions were decided during refine, see `## Decisions (Sprint)`.

## Decisions (Sprint)

- **Profile record shape** — `ConfigProfile { id, name, createdAt, updatedAt, cvars: Record<string,string>, binds: Record<string,string> }`; the two content maps are introduced empty now so stories 003/005 fill containers instead of reshaping the persisted record.
- **Standard template** — a small, deliberately minimal seed of vanilla Quake II cvar/bind defaults in `src/shared/modules/config.ts`, because AC "empty or from the standard template" needs a visible difference, while the full source-cited cvar catalogue belongs to story 003.
- **"Copy of another profile" is out of 001** — the concept's CFG-1 lists it, but this story's ACs only require empty/template, so duplication is left to a later story rather than widening scope.
- **Persistence location** — new top-level `configProfiles` array in `state.json` via `StateStore`, exactly as prescribed by the concept (§6), not `Installation.moduleData`, since a profile is not owned by one installation.
- **No `STATE_SCHEMA_VERSION` bump / migration step** — a v1 file simply lacks the key and the forgiving parser degrades it to `[]`, so there is no existing data to reshape; the orphan-assignment rule (concept open point 4) arrives with story 002.
- **Profile logic lives in the module** — `src/main/modules/config/profiles.ts` owns CRUD and calls `app.state`; only the persistence container (state.ts/schemas.ts) is touched outside the module, keeping "a feature is a module" intact.
- **Payload validation inside the module** — `src/main/modules/config/schemas.ts` (zod), because the shell only validates the `module:invoke` envelope and renderer input must never be trusted unvalidated.
- **Handlers return plain values, mutations return the full updated list** — the registry already wraps results in `Outcome`, so returning `fail()` would double-wrap; an unknown id is a renderer bug and throws, surfacing as `modules.error.handlerFailed`.
- **No module event in 001** — the view reloads from the mutation's return value; a `profiles:changed` broadcast has no second consumer yet.
- **Profile names need not be unique** — identity is the generated `id` (same rule as `Installation`), so a duplicate name is allowed rather than a rejected create.
- **Renderer half lives in `src/renderer/src/modules/config/`** (view + client), per the concept §6, not in `views/` like `LibraryView` — this module will grow several components and keeping them together avoids a later move.
- **Module-local dialogs** — create/rename/delete use `Modal` inside the config module, not the shell's `Dialogs.tsx`, so the shell stays untouched.
- **Master/detail layout** — profile list left, detail pane right, so stories 002 (assignment) and 003 (cvars) hang new sections into the detail pane without re-laying out the view.
- **Manifest flip** — `config` moves to `status: 'available'` and `requiresInstallation: false`, because central profiles are usable with zero installations registered (concept §3).
- **Shell Zustand store untouched** — the view holds profiles in local state and fetches over `module:invoke`, mirroring `LibraryView`'s stats row.

## Plan

Wire the `config` module along the 5-step checklist in
[ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module) and add the central
profile store the whole sprint builds on. No new IPC channel — everything rides the existing
`module:invoke` envelope.

1. **Contract + persistence** (`src/shared/modules/config.ts`, `src/main/services/state.ts`,
   `src/main/lib/schemas.ts`): `ConfigProfile`, `CONFIG_HANDLERS`, `STANDARD_TEMPLATE`;
   `configProfiles` becomes a top-level array in `state.json`, parsed row-by-row like
   `installations` so one broken profile never costs the user the file.
2. **Main half** (`src/main/modules/config/{index,profiles,schemas}.ts`, registered in
   `src/main/modules/index.ts`): a `MainModule` mirroring `src/main/modules/library/index.ts`,
   with `list` / `create` / `rename` / `remove` handlers over a `ProfilesStore` that reads and
   writes through `app.state`. Payloads validated with zod inside the module. Unit test for
   the store.
3. **Renderer half** (`src/renderer/src/modules/config/{client,ConfigView}.tsx`, registered in
   `src/renderer/src/modules/index.ts`, manifest flipped in `src/shared/types/module.ts`,
   strings in `src/renderer/src/i18n/locales/en.json`): typed client mirroring
   `modules/library/client.ts`, master/detail view built only from `Panel`, `SectionLabel`,
   `Button`/`IconButton`, `EmptyState`, `Field`/`Input`, `Modal`.
4. **Create flow**: dialog offering "empty" or "standard template" plus a name.
5. **Rename + delete flows**: rename dialog mirroring
   `components/installations/RenameInstallationDialog.tsx`; delete behind a confirm dialog
   because it is irreversible.

Order matters: 1 → 2 → 3 → 4 → 5. Nothing here writes to a game directory (story 004) and
nothing references installations (story 002).

## Deliverables

- [x] **D1 — Contract + persisted profile store.** `src/shared/modules/config.ts` (new:
      `ConfigProfile`, `CONFIG_HANDLERS`, `STANDARD_TEMPLATE`), `src/main/services/state.ts`,
      `src/main/lib/schemas.ts` (`configProfileSchema`, `parseConfigProfiles`).
      Mirror: `src/shared/modules/library.ts` for the contract, the `installations` handling in
      `schemas.ts`/`state.ts` for the persistence shape.
      *Acceptance:* `state.json` round-trips a `configProfiles` array; a file without the key
      loads as `[]`; a malformed row is dropped on its own without affecting the others or the
      installation list. No `STATE_SCHEMA_VERSION` bump.
- [x] **D2 — Config main module with CRUD handlers.**
      `src/main/modules/config/index.ts`, `profiles.ts`, `schemas.ts`,
      `src/main/modules/config/profiles.test.ts`, registration line in
      `src/main/modules/index.ts`. Mirror: `src/main/modules/library/index.ts`.
      *Acceptance:* `list`, `create` (`{ name, from: 'empty' | 'template' }`), `rename`,
      `remove` are callable over `module:invoke`; mutations return the updated profile list;
      invalid payloads are rejected by the module's own zod schemas; unit tests cover create
      (both variants), rename and remove.
- [x] **D3 — Renderer half: Config view replaces the placeholder.**
      `src/renderer/src/modules/config/client.ts`, `.../config/ConfigView.tsx`,
      `src/renderer/src/modules/index.ts`, `src/shared/types/module.ts` (config manifest →
      `status: 'available'`, `requiresInstallation: false`),
      `src/renderer/src/i18n/locales/en.json` (`config.*` keys).
      Mirror: `src/renderer/src/modules/library/client.ts`, `views/LibraryView.tsx`.
      *Acceptance:* the Config nav item opens the real view (never `PlannedModuleView`); it
      lists persisted profiles in a master/detail layout and shows an `EmptyState` when there
      are none; built only from existing design-system primitives; no prose in the component,
      all strings via i18n keys.
- [x] **D4 — Create a profile (empty or standard template).**
      `src/renderer/src/modules/config/CreateProfileDialog.tsx`, `.../ConfigView.tsx`,
      `src/renderer/src/i18n/locales/en.json`. Mirror:
      `src/renderer/src/components/installations/CreateInstallationDialog.tsx`.
      *Acceptance:* a "New profile" action opens a `Modal` with a name field and a choice of
      empty vs. standard template; on confirm the profile appears in the list and is selected;
      an empty name cannot be submitted.
- [x] **D5 — Rename and delete a profile.**
      `src/renderer/src/modules/config/RenameProfileDialog.tsx`,
      `.../DeleteProfileDialog.tsx`, `.../ConfigView.tsx`,
      `src/renderer/src/i18n/locales/en.json`. Mirror:
      `src/renderer/src/components/installations/{RenameInstallationDialog,RemoveInstallationDialog}.tsx`.
      *Acceptance:* renaming updates the list entry and the detail pane; deleting asks for
      confirmation first, then removes the profile and clears/moves the selection; both survive
      an app restart.

**Coverage check (AC → D):**
AC1 "real module view" → D2 + D3 · AC2 "create empty/template with a name" → D1 (template) +
D2 (handler) + D4 (UI) · AC3 "rename and delete" → D2 + D5 · AC4 "persists across restarts" →
D1 + D2 (verified in the test plan) · AC5 "design-system primitives only" → D3, D4, D5
(explicit in each acceptance, re-checked in review).

## Model Hints

- D1 → **deliverable-hard** — it edits the shared `state.json` parse path that already owns the
  user's installation list, where a careless schema change silently drops persisted data.
- D2, D3, D4, D5 → default.
- Review: → default — the one data-loss-capable deliverable is already on the hard tier, the
  rest is scaffolding against existing, well-established patterns.

## Test Plan (manual acceptance)

Run `npm run dev` and drive everything through the real UI:

1. Click **Config** in the nav → the real Config view opens (no "Planned" badge, no capability
   list).
2. With no profiles yet, the empty state offers creating one. Create a profile named
   `Test Empty`, choosing **empty** → it appears in the list and is selected.
3. Create a second profile `Test Template` from the **standard template** → both are listed.
4. Rename `Test Empty` to `Renamed` → the list entry and the detail pane both show the new name.
5. Close the app completely, run `npm run dev` again, open **Config** → `Renamed` and
   `Test Template` are still there with their names intact.
6. Delete `Renamed` → a confirmation dialog appears; confirm → it disappears from the list and
   the selection moves to `Test Template`. Cancel on the second delete → nothing is removed.
7. Restart once more → only `Test Template` remains.
8. Check the library: installations, active selection and settings are unchanged by all of the
   above (the new `configProfiles` key must not disturb the rest of `state.json`).

## Done

**Summary.** All 5 deliverables implemented and code-reviewed. The `config` module is wired
in along the ARCHITECTURE.md 5-step checklist: shared contract + persisted `configProfiles`
store (D1, hard tier), main-process CRUD module over `module:invoke` (D2, with unit tests),
and a renderer master/detail view with create/rename/delete dialogs, all built from existing
design-system primitives (D3–D5). No new IPC channel; no `STATE_SCHEMA_VERSION` bump.

**Commit message:**
```
001: config module scaffold and central profile store
```

**Verification:**
- `npm run build` — clean (main/preload/renderer all build).
- `npm test` — 18/18 passing (9 new tests in `src/main/modules/config/profiles.test.ts`
  covering create-empty, create-template incl. anti-aliasing, rename incl. unknown-id,
  remove incl. unknown-id, duplicate names, persistence through `StateStore`).
- `npm run typecheck` (`tsconfig.node.json` + `tsconfig.web.json`) — clean.
- Code review (fresh agent, default tier per Model Hints): **PASS**, all 5 acceptance
  criteria individually confirmed with file:line evidence, no scope creep, no weakened
  tests, no unvalidated payloads, no `Outcome` double-wrapping, no aliasing bug (verified
  `STANDARD_TEMPLATE.cvars`/`.binds` are spread-copied, not referenced). One cosmetic,
  non-blocking observation: the `config` manifest's `capabilities` array still lists
  `mutates-installation` even though `requiresInstallation` flipped to `false` — left
  unfixed since `capabilities` isn't consumed by any reviewed code path and the story's
  decisions only called for flipping `status`/`requiresInstallation`, not the capability
  list (that list will need a real look once story 004's write pipeline actually mutates
  installation files).
- **Live smoke: not performed.** `live-smoke-required: true` for this project, but this
  session runs in a headless WSL sandbox with no usable display server for Electron —
  `npm run dev` builds and starts the dev server correctly, but `electron.exe` under
  `node_modules/electron` is the Windows-native binary and cannot exec under WSL's bash
  (`Syntax error: Unterminated quoted string`), so the app itself never opens and there is
  no way to click through the UI or take a screenshot to confirm it. Per the sprint
  deviations for this story, `status` stays `in-progress` rather than `done`: the module is
  built and code-review-accepted, but the manual `## Test Plan` below still needs a human
  (or an agent with real display/GUI access) to run it once, including confirming the
  profile list survives an actual app restart. Acceptance criteria below are left unchecked
  for the same reason — they describe user-observable behavior that a code review can
  support but not substitute for.

**Decisions** (implementation details the plan didn't spell out, made by this session and
checked against the story's Plan/Acceptance Criteria):
- **`STANDARD_TEMPLATE` contents** — the plan only said "a small, deliberately minimal seed
  of vanilla Quake II cvar/bind defaults." Picked six of each: cvars `sensitivity`, `cl_run`,
  `crosshair`, `cl_gun`, `m_pitch`, `volume`; binds `UPARROW`/`DOWNARROW`/`SPACE`/`c`/`SHIFT`/
  `MOUSE1` mapped to the classic movement/attack actions. Small and genuinely vanilla, per
  AC2's "give it a name" + "empty or from the standard template" needing a visibly different
  result — the full source-cited catalogue is explicitly story 003's job.
- **Shared contract additions beyond the deliverable's literal name list** — D1's text names
  `ConfigProfile`, `CONFIG_HANDLERS`, `STANDARD_TEMPLATE`; the module seam also needs payload
  types (`CreateConfigProfileInput`, `RenameConfigProfileInput`, `RemoveConfigProfileInput`,
  `ConfigProfileSeed`) so both the main and renderer halves share one definition instead of
  each inventing their own. Consistent with "a module contract is the handler names and the
  data shapes" from ARCHITECTURE.md.
- **D3's detail pane ships with no actions** — deliberately passive (name + created/updated)
  until D4/D5 add the rename/delete `IconButton`s and D4 adds the "New profile" trigger, so
  each deliverable's diff maps cleanly to what it actually adds, and the master/detail frame
  doesn't need reshaping later (matches the Plan's stated reason for the layout).
- **New-profile selection after create** — `create`/`rename`/`remove` all return the *full*
  updated list (not just the affected row), so the newly-created profile is found by diffing
  the id sets before/after rather than by name (names aren't unique, per the story's own
  decision) or by array position.
- **Dialog sizing and i18n namespacing** — config's three dialogs use `Modal size="sm"`
  (simpler forms than the installation dialogs they mirror) and their own `config.
  createDialog.*` / `config.renameDialog.*` / `config.deleteDialog.*` i18n keys, kept
  separate from the existing `dialog.create.*` / `dialog.rename.*` / `dialog.remove.*` keys
  used by installations, to avoid key collisions between the two features.
- **Sandbox environment repair (not a code change)** — this session's shell initially had no
  usable Node.js (`npm`/`npx` resolved only to a Windows shim that refuses to run under
  WSL1-style bash) and, once a Linux Node was installed via apt, a Node 18 runtime plus a
  `node_modules` tree built with Windows-native optional dependencies (`@rollup/rollup-
  linux-x64-gnu` missing). Installed Node 22 from the official Linux x64 tarball into
  `/usr/local/node22`, symlinked it over `/usr/bin/node`/`npm`/`npx`, and ran `npm install`
  to pull in the correct Linux native bindings. This did not touch `package.json` or
  `package-lock.json` (confirmed via `git status`/`git diff --stat`) — purely an environment
  fix so `build`/`test`/`typecheck` could run at all in this sandbox.
