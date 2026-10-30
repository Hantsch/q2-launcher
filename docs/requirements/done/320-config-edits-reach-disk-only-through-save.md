---
id: 320
title: Config edits reach disk only through save, and every flag survives a reload
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Four overdue tech-debt rows (TD-009, TD-017, TD-022, TD-025) are one defect class: a config edit
reaches disk by a side path, or a saved value is lost on reload. A user's unsaved edit must never
land on disk because they did something unrelated, and what was saved must come back as it was.
TD-024 (config main-side test gaps) is closed in passing because the same code is touched.

## Acceptance Criteria

- [x] **AC1** — With an unsaved `writeCatalogDefaults` toggle pending, adding an address-book entry
      writes the address book only; the profile file on disk keeps the toggle's old value (TD-009).
- [x] **AC2** — Changing a switch bind writes through the same save path as every other edit:
      unsaved edits in the open profile stay unsaved, and an external edit of the file since load is
      reported, not overwritten (TD-017).
- [x] **AC3** — A config action saved with `keepEmptyAlias` set still has it set after the profile
      is reloaded from disk (TD-022).
- [x] **AC4** — When `saveNow` fails after a cancelled edit burst, the editor shows the value on
      disk, not the optimistic one; a stale `load()` does not mark the list loaded; a failed
      `load()` keeps its hint visible (TD-025).
- [x] **AC5** — `withLiveAssignments` has one implementation with a unit test; the config main
      tests use no stale electron mock and no `vi.mock('./writer')` (TD-024).
- [x] **AC6** — Rows TD-009, TD-017, TD-022, TD-024 and TD-025 are removed from `docs/TECH-DEBT.md`.

## Open Questions

## Decisions (Sprint)

- TD-009 is fixed by adding `writeCatalogDefaults` to the profile baseline (`captureBaseline`), not by special-casing `commitCvars` — the baseline is what `commitCvars` renders from and what `discard()` restores, so one field fixes both.
- Old persisted baselines without the field parse as `writeCatalogDefaults: true` — that matches the profile field's own `.catch(true)` default, so no migration is needed.
- `setSwitchBind` checks `authoriseContentWrite` on the installation's default profile **before** it stores the bind, and refuses with the existing key `config.error.commitConflict` — its text ("file changed on disk … open the profile in Config") already fits, and a refused bind that was half-stored would contradict the UI.
- After the check, the loader is written through `syncAndPersist` (`targetInstallationId` = the installation) — sync copies the canonical bytes on disk, never the live record, so unsaved edits stay unsaved without a new code path.
- A refusal from `setSwitchBind` is shown as visible inline text under `SwitchBindControl` — today it is dropped silently, and CLAUDE.md requires a visible reason.
- AC1 and AC2 are user actions, so they get e2e proof: AC1 as a step in the existing `servers-address-book.mjs`, AC2 as one new flow — no flow walks the switch bind today.
- AC3 (a persisted-load round trip) and AC4 (failure and race edges that cannot be triggered through the real surface) are proven by unit and renderer tests — no user action produces a failing `saveNow` or a stale `load()` on demand.
- AC5's "stale electron mock" means the `shell: h.shellMock` part of the config tests' `vi.mock('electron')` — `index.ts` still reads `userDataDir()` through `app.getPath`, so the `getPath` part is live and stays.
- `vi.mock('./writer')` goes by passing `writeTargetFile` from `ProfileWritesDeps` into the sync/canonical write — the deps already carry it, and injection is the house pattern.
- The surviving `withLiveAssignments` moves to `assignments.ts` next to `reconcileAssignments`, which already has a test file there.
- One `### Fixed` line in `CHANGELOG.md` covers AC1–AC3 — they are one user-visible fix: unsaved edits and saved flags behave.
- D7 deletes only this story's five TECH-DEBT rows — other S37 stories edit the same table at the same time.

## Plan

Main first, then renderer, then hygiene. Every D comes with its own tests.

1. **TD-009 (D1):** add `writeCatalogDefaults` to `ProfileBaseline` and `captureBaseline` (`src/shared/config/profile/profile-baseline.ts`), the persisted baseline schema (`persisted.ts`) and `discard()` (`profiles.ts`). Drop the "Known limitation" comment above `commitCvars`. Add a step to the address-book flow.
2. **TD-022 (D2):** add `keepEmptyAlias: z.literal(true).optional()` to `configActionObjectSchema` (`src/shared/config/aliases/profile-schema.ts`). Both trees derive from it. Fix the test that pins the gap. Regenerate the schema-parity snapshot on purpose.
3. **TD-024a (D3):** move `withLiveAssignments` into `assignments.ts`, with one test. Inject `writeTargetFile` into sync/canonical so `vi.mock('./writer')` can go.
4. **TD-017 main (D4):** `setSwitchBind` = conflict check, then store the bind, then `syncAndPersist(…, { targetInstallationId })`. Drop the direct `writeInstallationFiles` call.
5. **TD-017 renderer + flow (D5):** `SwitchBindControl` shows refusals as text and gets testids. New flow, CHANGELOG line, systems doc.
6. **TD-025 (D6):** `useProfileSave` reverts on a failed `saveNow` after a cancelled burst. The store tells `ConfigView` whether a load was applied. `listLoaded` is set only on an applied ok load.
7. **TD-024b + AC6 (D7):** remove the dead `shell` part of the config tests' electron mocks. Delete the five TECH-DEBT rows.

## Deliverables

- [x] **D1 — A pending catalog-defaults toggle stays off disk (TD-009).**
  - **Change:**
    - Add `writeCatalogDefaults: boolean` to `ProfileBaseline`. `captureBaseline` sets it as `profile.writeCatalogDefaults !== false`. File: `src/shared/config/profile/profile-baseline.ts`.
    - In the persisted baseline zod schema (`src/main/modules/config/persisted.ts`), accept the field and default it to `true` for old baselines.
    - `discard()` in `src/main/modules/config/profiles.ts` restores it.
    - Remove the "Known limitation" paragraph above `commitCvars` in `src/main/modules/config/profile-writes.ts`. `commitCvars` already spreads the baseline over the profile, so it then renders the baseline's value.
    - Check that the unsaved-changes list (`ProfileChangeList.tsx`) does not break on the new member. Do not add a new row there.
  - **Tests:**
    - `src/main/modules/config/profile-writes.commit-cvars.test.ts` › "a pending catalog-defaults toggle is not written by a cvar commit": toggle via `setWriteCatalogDefaults` on a profile with a baseline, commit cvars, and assert the file bytes follow the baseline value.
    - `src/main/modules/config/persisted.test.ts` › "a baseline without writeCatalogDefaults loads as true".
    - Add a step to `scripts/flows/servers-address-book.mjs`: before the add, toggle catalog defaults in the Settings tab without saving; after the add, the canonical profile file on disk still has the old catalog-defaults output and the profile is still unsaved.
- [x] **D2 — keepEmptyAlias survives a reload (TD-022).**
  - **Change:**
    - Add `keepEmptyAlias: z.literal(true).optional()` to `configActionObjectSchema` in `src/shared/config/aliases/profile-schema.ts`, and delete the "deliberately absent" comment above it. The IPC tree (`src/shared/modules/config-schemas.ts`, `.omit`) and the persisted tree (`src/main/modules/config/persisted.ts`, `.extend`) derive from it, so they need no edit unless one of them omits the field.
    - In `src/shared/config/aliases/profile-schema.test.ts`, drop the `keepEmptyAlias` exclusions so the key-equality test covers the full `ConfigAction`.
    - Regenerate the snapshot in `src/main/modules/config/__snapshots__/` that `schema-parity.test.ts` produces, and check that the diff only flips the `keepEmptyAlias` fixture's verdict.
  - **Test:** `src/main/modules/config/persisted.test.ts` › "a saved action keeps keepEmptyAlias after a persisted load".
- [x] **D3 — One withLiveAssignments, and no writer mock (TD-024, part 1).**
  - **Change:**
    - Move `withLiveAssignments(deps, list)` from `src/main/modules/config/profile-writes.ts:~182` into `src/main/modules/config/assignments.ts`, next to `reconcileAssignments`. It takes the installations source as its argument.
    - Point `profile-writes.ts` and `src/main/modules/config/index.ts` at it, and delete the closure in `index.ts:~101`.
    - Thread `writeTargetFile` from `ProfileWritesDeps` through `syncProfile` (`sync.ts`) into the canonical write (`canonical.ts`). The production default is the real `writer.ts` export.
    - In `src/main/modules/config/profile-writes.sync.test.ts`, delete `vi.mock('./writer')` and override the write through the deps from `profile-writes.test-helpers.ts`.
  - **Tests:**
    - `src/main/modules/config/assignments.test.ts` › "withLiveAssignments drops assignments to unregistered installations".
    - The existing overlapping-runs tests in `profile-writes.sync.test.ts` stay green without the mock.
- [x] **D4 — A switch bind goes through the save path (TD-017, main).**
  - **Change:** in `src/main/modules/config/profile-writes.ts#setSwitchBind`:
    1. Resolve the installation's default profile.
    2. If there is one and `authoriseContentWrite(deps, defaultProfile)` is false, return `fail('config.error.commitConflict')`. Store nothing in that case.
    3. Otherwise store the bind in `config.switchBinds`.
    4. If there is a default profile, run `syncAndPersist(deps, defaultProfile, profiles.list(), { targetInstallationId: installation.id })` instead of the direct `writeInstallationFiles` call. Sync copies the canonical file bytes on disk and renders the loader with `switchBindFor`, so unsaved edits stay unsaved and the profile stays `dirty`.
    5. If the sync recorded a write failure for that installation, return `fail('config.error.writeFailed')`, as today.
  - **Tests:** new file `src/main/modules/config/profile-writes.switch-bind.test.ts`, modelled on `profile-writes.commit-cvars.test.ts`, using a real temp dir:
    - "a switch bind leaves unsaved edits off disk": the profile copy keeps the saved bytes, the loader carries the bind, and the profile stays dirty.
    - "a switch bind on an externally edited profile is refused and stores nothing".
    - "a switch bind with no default profile only stores the bind".
- [x] **D5 — The switch bind's refusal is visible and walked end to end (TD-017, renderer).**
  - **Change:**
    - In `src/renderer/src/modules/config/SwitchBindControl.tsx`, render `result.ok === false` as visible inline text, `t(error.key)` with `role="alert"`. Clear it on the next success or capture.
    - Add `data-testid`s `switch-bind-capture`, `switch-bind-clear` and `switch-bind-error`.
    - New flow `scripts/flows/switch-bind-keeps-unsaved-edits.mjs`:
      1. Make an unsaved edit (the Raw tab's "Start the file with `unbindall`" checkbox, as in `external-edit-cascades.mjs`).
      2. Set a switch bind in the installation profiles panel.
      3. Check that the installation's profile copy is unchanged and the Unsaved tab is still shown.
      4. Edit the canonical file on disk, set another bind, and check that the refusal text is visible and the file bytes are kept.
    - Register the flow in `scripts/flows/areas.json` the way its neighbours are.
    - Add one line under `## Unreleased` › `### Fixed` in `CHANGELOG.md`: "Unsaved config edits no longer reach disk from an address-book add or switch bind; alias flags survive restarts."
    - Update `docs/systems/config-module.md`: the switch bind writes through `syncAndPersist` and is refused on an external edit; the baseline includes `writeCatalogDefaults`.
  - **Test:** the flow above.
- [x] **D6 — Draft and list-load edges (TD-025).**
  - **Change:**
    - `src/renderer/src/modules/config/lib/useProfileSave.ts`: when `saveNow` takes over a pending burst, it keeps that burst's `revert` and runs it if the save fails or is refused. A plain `cancel` without a save keeps today's behaviour.
    - `src/renderer/src/modules/config/config-profiles-store.ts#load`: tell the caller whether the answer was applied. For example, return `{ applied: false }` when a newer load superseded it.
    - `src/renderer/src/modules/config/ConfigView.tsx:~55`: set `listLoaded` only on an ok and applied load. A failed load keeps `pendingFocusIdRef`, so the route hint survives.
  - **Tests:**
    - `lib/useProfileSave.test.ts` › "a failed saveNow after a cancelled burst shows the value on disk".
    - `config-profiles-store.test.ts` › "a superseded load reports it was not applied".
    - `ConfigView.routeFocus.test.tsx` › "a stale load does not mark the list loaded" and › "a failed load keeps the focus hint".
- [x] **D7 — No stale electron mock, and the debt rows go (TD-024 part 2, AC6).**
  - **Change:**
    - Remove `shell: h.shellMock` from `vi.mock('electron')` in these files under `src/main/modules/config/`: `index.test.ts`, `index.cleanup.test.ts`, `index.preview.test.ts`, `index.raw-files.test.ts`, `import.test.ts`, `file-source-pipeline.test.ts` and `write-plan.test.ts`. `shellMock` stays, injected as `app.os`.
    - Delete the `vi.mock('electron')` block entirely in any file that does not reach `userDataDir()`. Verify this by deleting the block and running the file.
    - Delete rows TD-009, TD-017, TD-022, TD-024 and TD-025 from `docs/TECH-DEBT.md`. Touch no other row.
  - **Tests:** those config test files pass unchanged in their assertions. `node scripts/check-docs.mjs` passes.

## Model Hints

- D4 → deliverable-hard: `syncAndPersist` swallows write errors into `writeFailures` and skips installations whose canonical file it may not publish. A naive swap can store the bind but write no loader, or report success after a failed write — and it must not regress the existing cascade rules (`refuseCanonicalWriteFor`, dirty siblings).

Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/config/profile-writes.commit-cvars.test.ts` › "a pending catalog-defaults toggle is not written by a cvar commit"; e2e step in `scripts/flows/servers-address-book.mjs` (D1)
- AC2 → unit `src/main/modules/config/profile-writes.switch-bind.test.ts` › "a switch bind leaves unsaved edits off disk" and › "a switch bind on an externally edited profile is refused and stores nothing" (D4); e2e `scripts/flows/switch-bind-keeps-unsaved-edits.mjs` (D5)
- AC3 → unit `src/main/modules/config/persisted.test.ts` › "a saved action keeps keepEmptyAlias after a persisted load"; `src/shared/config/aliases/profile-schema.test.ts` key-equality test without the exclusion (D2)
- AC4 → unit `src/renderer/src/modules/config/lib/useProfileSave.test.ts` › "a failed saveNow after a cancelled burst shows the value on disk"; `src/renderer/src/modules/config/ConfigView.routeFocus.test.tsx` › "a stale load does not mark the list loaded", › "a failed load keeps the focus hint" (D6)
- AC5 → unit `src/main/modules/config/assignments.test.ts` › "withLiveAssignments drops assignments to unregistered installations" (D3). The mock removal is proven by `profile-writes.sync.test.ts` and the config `index*.test.ts` files passing without `vi.mock('./writer')` or the `shell` mock (D3, D7).
- AC6 → `node scripts/check-docs.mjs` on the edited `docs/TECH-DEBT.md` (D7)

## Done

Config edits reach disk only through save: the baseline carries `writeCatalogDefaults` (TD-009), `setSwitchBind` refuses on an external edit and writes via `syncAndPersist` with a visible refusal (TD-017), `keepEmptyAlias` is in the shared action schema (TD-022), `saveNow` reverts after a cancelled burst and `load()` reports `applied` (TD-025), one `withLiveAssignments` plus injected `writeTargetFile`, stale `shell` electron mocks gone (TD-024).

Commit message: `320: config edits reach disk only via save - baseline writeCatalogDefaults, switch bind through syncAndPersist, keepEmptyAlias persisted, saveNow revert + applied load, TD-009/017/022/024/025 closed`

Verification (narrow gate): typecheck, lint, `npm run check:docs` green; `npx vitest run --changed HEAD` green (93 files, 1356 tests); `npm run build:dev` + `npm run ui:flows -- --affected <servers-address-book, switch-bind-keeps-unsaved-edits> --parallel=4 --shard=1/2` and `2/2` green, both named flows passed. Clean-agent review: 1 cycle, findings fixed and re-verified.
AC -> test as verified: AC1 commit-cvars test + `servers-address-book.mjs`; AC2 `profile-writes.switch-bind.test.ts` + `switch-bind-keeps-unsaved-edits.mjs`; AC3 `persisted.test.ts` + `profile-schema.test.ts`; AC4 `useProfileSave.test.ts`, `ConfigView.routeFocus.test.tsx`, `config-profiles-store.test.ts`; AC5 `assignments.test.ts` + config tests passing without the mocks; AC6 `check:docs`. No manual residue.

Decisions:

- Review finding not fixed: a dirty default profile with no canonical file and no other assigned profile gets the bind stored but no loader written (sync has nothing it may publish); the plan does not cover it, and before the change the unsaved render leaked instead.
- `cancel()` has no production caller today, so the parked-revert path is exercised by tests and by `saveNow` taking over a pending burst; not widened.
- The address-book flow compares the canonical file before the toggle and after the add, ignoring `set adrN`/blank/`// --- Other ---` lines; strict byte equality is impossible since the add legitimately writes those. The unit test proves the toggle's output effect.
- `import.test.ts` and `file-source-pipeline.test.ts` had no `shell` mock left and reach `userDataDir()`, so their electron blocks stay.
- The new flow sets Plain Profile as default on the two-profile fixture installation first (the switch-bind control needs a default profile); a re-run needs `npm run ui:seed` (flow header says so).

tiers: D 7 / hard 1 · review default · cycles 1 · agents 11
