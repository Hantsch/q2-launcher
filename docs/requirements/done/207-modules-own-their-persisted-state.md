---
id: 207
title: modules own their persisted state
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a module's persisted state — its schema, its forgiving parse, its
defaults, its migrations and its tests — to live in the module, registered with the shell at
setup, so that adding a module no longer means editing three shell files and two shell tests,
the shell can be typechecked and tested without every module, and the dependency direction the
architecture doc promises is true again.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F02, F33, F08):
`src/main/lib/schemas.ts` (1,655 lines, 55 commits since August — ~13 % of all commits touch
this one file) holds persisted schemas for installations and config (~905 lines), downloads,
home layout, servers, unlock and replays, importing five module contracts plus
`../modules/servers/history-log`. `LauncherStateDocument` has 13 sections with hand-written
getter/setter pairs. Five shell files import from `src/main/modules/` (`index.ts`,
`renderer-source.ts`, `lib/schemas.ts`, `services/state.ts`, `services/installations.ts`), each
with a comment arguing the target "is pure and cannot cycle"; `setEngineState` on the shell
library service wraps downloads' `installation-state` although generic `setModuleData` exists.
Migrations come in two mechanisms: four versioned `MIGRATIONS` steps that all rewrite
`configProfiles` (a 354-line config file in the shell) and ~200 lines of parse-time
`migrateLegacy*` rewrites that run on every load; the other nine sections follow a third rule
("new top-level key, no bump"). docs/ARCHITECTURE.md still says a module "never touches the state
file" and "`MIGRATIONS` is empty at v1" (it is at v5).

Depends on stories 202 (mutators) and 203 (forgiving helper).

## Acceptance Criteria

- [x] **AC1** — Step one (small, safe): the pure helpers the shell imports from modules
      (`isSafeNewsImageFileName`, `getNewsImagesCacheDir`, `capServerHistory`, `pruneFailures`,
      engine `installation-state`) move to `src/main/lib/` or `src/shared/`; `setEngineState`
      becomes a downloads-module function over `setModuleData` (with the `detectedVersion`
      mirror kept in one write); `git grep -n "from '.*modules/" src/main/index.ts src/main/lib src/main/services`
      returns nothing.
- [x] **AC2** — `AppContext.state` offers `section<T>({ key, parse, defaults })` returning a
      typed `{ get(), update(fn) }` that a module registers in `setup()`; an unknown key in
      `state.json` is kept verbatim across load/save so a disabled module loses nothing.
- [x] **AC3** — downloads, home, servers, unlock and replays each have
      `src/main/modules/<id>/persisted.ts` (schema + parse + defaults) and `persisted.test.ts`;
      the matching code and tests are removed from `lib/schemas.ts`/`schemas.test.ts`, which
      afterwards hold only installations, settings and window state (target ≤ 400 lines).
- [x] **AC4** — Config's four `MIGRATIONS` steps and the parse-time legacy normalisers move to
      `src/main/modules/config/persisted-migrations.ts`, composed by the shell's migration runner;
      the shell's `migrations.ts` carries no config imports.
- [x] **AC5** — docs/ARCHITECTURE.md's state section states the two-tier migration rule
      (additive optional key → forgiving parse; shape change → `MIGRATIONS` step + version bump;
      no new parse-time rewrites) and "Adding a module" lists the `persisted.ts` step; the
      "`MIGRATIONS` is empty" and "never touches the state file" sentences are corrected.
- [x] **AC6** — Existing `state.json` files from every schema version the fixture covers load
      with identical results before and after (the migration tests and the e2e fixture variants
      are the gate).

## Open Questions

- [x] **Q1** — Should pure UI preferences (`servers.listSort`, `replays.listSort`/`listFilter`,
      `homeLayout`) move to a separate `ui-state.json` store in the same move, as
      docs/ARCHITECTURE.md already argues for window state? The review's value judge says drop it
      from this story; decide at refine. → No, see Decisions (Sprint) S1.
- [x] **Q2** — Does the section API return the mutators from story 202, or does 202 land them on
      `StateStore` first and 207 re-home them? → 202 lands `updateSlice`, 207 re-homes it, see S2.

## Decisions (Sprint)

- **S1 (Q1)** — No `ui-state.json` split: no AC asks for it, it would change the on-disk layout AC6
  pins as identical, and F08's write churn is handled by story 201's `debounceMs`.
- **S2 (Q2)** — 202 lands one generic `StateStore.updateSlice(key, fn)` (its S1); 207 re-homes it:
  `section().update(fn)` has exactly 202's semantics (synchronous, live value, identical reference
  returned → no write), and `updateSlice` afterwards accepts only the shell key `'installations'`.
- **S3** — Config's five top-level keys (`configProfiles`, `configPlayedMods`, `configSwitchBinds`,
  `configWriteFailures`, `configFileSourceMigratedAt`) also move to `modules/config/persisted.ts`:
  AC3's end state ("only installations, settings and window state", ≤ 400 lines) is unreachable
  while ~735 lines of config schema stay in `lib/schemas.ts`.
- **S4** — Unlock is a shell service, not a module, so its section lives in
  `src/main/services/unlock/persisted.ts` and is registered by `createUnlockService`; the
  `modules/<id>/` path in AC3 is read as "next to its owner".
- **S5** — One section per existing top-level key, file layout flat and unchanged (no nesting under
  a module id), because AC6 requires every existing `state.json` to load identically.
- **S6** — `section(spec)` called again with the _same spec object_ returns the same handle; a
  different spec for a registered key, or a shell key (`schemaVersion`, `settings`,
  `installations`), throws. Each owner exports `<id>State(state)` over a module-level const spec, so
  `setup()` and tests reach the identical handle without a test-only peek API.
- **S7** — Owner invariants move with their section: downloads' failure log prunes on `get()` and
  on `update()` (today `StateStore.getDownloadFailures`/`setDownloadFailures`), config's
  `fileSourceMigratedAt` stays write-once — both as small wrappers in the owner's `persisted.ts`.
- **S8** — `capServerHistory` and `pruneFailures` stay in their modules: once their sections move,
  the only caller is the owning module's own `persisted.ts`, so moving them to `lib/` would make a
  module depend on the shell for its own retention rule.
- **S9** — `downloads/engine/installation-state.ts` stays in downloads: its only shell consumer is
  `setEngineState`, which moves out, and moving it to `lib/` would itself import
  `@shared/modules/downloads` and fail the AC1 grep.
- **S10** — The downloads `setEngineState(installations, id, patch)` writes via 202's
  `InstallationsService.patch(id, { moduleData, detectedVersion })` (S7 there: `undefined` deletes),
  computed synchronously from `find(id)` — one write, no await, so no stale-snapshot race.
- **S11** — The news-image path helpers (`modules/home/images/paths.ts`) move whole to
  `src/main/lib/news-image-paths.ts`: the shell's protocol handler and CSP code are their main
  consumers and the file is pure node.
- **S12** — `lib/zip-entries.test.ts`'s "real zip" block (needs the downloads 7za resolver) moves to
  `src/main/modules/downloads/zip-entries-7za.test.ts`; AC1's grep covers test files in `lib/` too.
- **S13** — AC1's grep pattern also matches `@shared/modules/…`; that is read literally — the shell
  files named by the grep end with no `@shared/modules` imports either, which is exactly what AC3/AC4
  achieve. The grep is therefore the story's end gate (D12), not "after step one".
- **S14** — Module migration steps are composed statically, not in `setup()`: migration runs at
  `load()`, before any module exists. `src/main/modules/index.ts` exports `MODULE_MIGRATIONS`,
  `context.ts` passes it to `new StateStore(path, { migrations })`; the runner asserts strictly
  ascending `to` values ending at `STATE_SCHEMA_VERSION` and throws at boot otherwise.
- **S15** — AC6 is proven by a golden characterization test written _first_ (D1) against today's
  code; every later D changes only the accessor in its helper, never the golden JSON.
- **S16** — No CHANGELOG entry: nothing user-visible changes.
- **S17** — AC1's grep and AC3's line target become a unit test (mirroring
  `modules/downloads/layering.test.ts`'s tree walk) so they cannot regress before story 208 lands
  its general layer test, which may absorb it.

## Plan

Order: golden first, then the two small AC1 moves, then the shell API, then one module at a time,
config last (biggest), docs + layering gate at the end. Every move D keeps the golden green.

1. **D1** golden test of today's parse/save over v1–v5 documents (AC6 baseline).
2. **D2** news-image paths → `lib/`; 7za-dependent zip test → downloads.
3. **D3** `setEngineState` → downloads function over `installations.patch`.
4. **D4** `StateStore.section()` + unknown-key preservation (AC2) — the one hard D.
5. **D5–D9** downloads, home, unlock, servers, replays each get `persisted.ts` + test, register
   their section(s), and their code leaves `lib/schemas.ts`, `services/state.ts` and their tests.
6. **D10a/b** config: schema code moves to `modules/config/persisted.ts`, then its five sections
   register and `StateStore` loses every config accessor.
7. **D11** config's four `MIGRATIONS` + parse-time legacy normalisers →
   `modules/config/persisted-migrations.ts`; runner takes injected steps.
8. **D12** ARCHITECTURE.md + systems docs; layering test (AC1 grep, AC3 ≤ 400 lines, AC5 text).

End state: `LauncherStateDocument` = `schemaVersion`, `settings`, `installations` + preserved extras;
`lib/schemas.ts` = installations, settings, window state; `migrations.ts` = runner only.

## Deliverables

- **D1 — golden characterization test (AC6 baseline).** New
  `src/main/modules/persisted-state.golden.test.ts` and inputs under
  `src/main/modules/__fixtures__/state/`: `v1.json`–`v4.json` (reuse the raw documents
  `src/main/services/migrations.test.ts` already builds per version) and `v5-full.json` (current
  version, every top-level key filled, including a few garbage rows each parser drops). For each
  input: write it to a temp dir, `new StateStore(file).load()`, then `readEverySection(state)` — one
  local helper returning `{ settings, installations, configProfiles, configPlayedMods,
configSwitchBinds, configWriteFailures, configFileSourceMigratedAt, downloads, downloadFailures,
homeLayout, servers, unlock, replays }` via today's `StateStore` getters — and compare to a
  committed `__fixtures__/state/<name>.expected.json` (generate once from the current code, then
  commit; use `toEqual` against the file, not vitest snapshots). Also `settle()` and compare the
  written file's known keys to the same expectation after re-load. Determinism: `vi.setSystemTime`
  to a fixed instant (failure-log pruning uses `Date.now()`), and give every input row an id so
  `randomUUID` fallbacks do not fire (or normalise generated ids before comparing). Code is not
  changed in this D. Test: › "every fixture state.json loads to the golden document".

- **D2 — news-image paths and the 7za zip test leave the shell (AC1 part).** Move
  `src/main/modules/home/images/paths.ts` whole to `src/main/lib/news-image-paths.ts` (delete the
  old file); update its importers: `src/main/index.ts`, `src/main/lib/renderer-source.ts`,
  `src/main/lib/renderer-source.test.ts`, and in `src/main/modules/home/images/`
  `fetch-image.ts`, `image-cache.ts`, `resolve-feed-images.ts` and their tests (grep
  `images/paths`/`'./paths'`). Move the `describe('real zip (only when the vendored binary is
present)', …)` block from `src/main/lib/zip-entries.test.ts` into new
  `src/main/modules/downloads/zip-entries-7za.test.ts` (importing `../../lib/zip-entries` and
  `./7za-path`), removing the `7za-path` import from the lib test. No behaviour change; existing
  tests are the acceptance.

- **D3 — `setEngineState` is a downloads function (AC1 part).** New
  `src/main/modules/downloads/engine/record-engine-state.ts` exporting
  `setEngineState(installations: Pick<InstallationsService, 'find' | 'patch'>, id, patch:
Partial<InstallationEngineState>): Outcome<Installation>`: `find(id)` (else
  `fail('installations.error.notFound')`), `moduleData = writeEngineState(current.moduleData,
patch)`, `merged = readEngineState(moduleData)`, then one `installations.patch(id, { moduleData,
detectedVersion: merged.version || undefined })` (story 202's `patch`; `undefined` deletes the
  field). Delete `InstallationsService.setEngineState` and its `installation-state` import from
  `src/main/services/installations.ts`; move its tests from `src/main/services/installations.test.ts`
  to new `record-engine-state.test.ts`. The jobs' structural deps keep their
  `setEngineState(id, patch)` member (`bootstrap/job.ts`, `engine/update-job.ts`,
  `engine/rollback-job.ts`); `src/main/modules/downloads/index.ts` supplies it as
  `(id, p) => setEngineState(app.installations, id, p)` (also at the `bleedingEdge` handler, ~line
  408). Adapt `engine/update-job.test.ts` and `engine/rollback-job.test.ts` the same way. Tests:
  › "records the engine state and mirrors detectedVersion in one write", › "a patch without a
  version removes detectedVersion".

- **D4 — `StateStore.section()` (AC2).** Files: `src/main/services/state.ts`,
  `src/main/services/state.test.ts`, and `src/main/lib/json-store.ts` only if a serialize hook is
  needed. Add `section<T>(spec: { key: string; parse: (raw: unknown) => T; defaults: () => T }):
StateSection<T>` with `StateSection<T> = { get(): T; update(fn: (live: T) => T): T }`. Semantics:
  at `load()` the shell keys (`schemaVersion`, `settings`, `installations`) are parsed as today and
  every other top-level key of the migrated document is kept raw; `section()` parses its raw value
  (absent → `defaults()`), caches it, and from then on writes the typed value under the same flat
  key. `update` is synchronous, gets the live value, and an identical returned reference schedules
  no write (same rule as story 202's `updateSlice`, which `update` wraps). Unregistered keys are
  written back verbatim on every save, so a disabled module loses nothing. Re-registering the same
  spec object returns the same handle; a different spec for a registered key, or a shell key, throws.
  The existing module accessors stay for now (D5–D10b remove them); during the transition a key
  still owned by an accessor must not also be registrable — keep one source of truth per key.
  Tests: › "a registered section parses its key and update writes it",
  › "an unknown top-level key survives load and save verbatim",
  › "update returning the same reference schedules no write",
  › "registering a second spec for a key throws".

- **D5 — downloads owns `downloads` + `downloadFailures` (AC3).** New
  `src/main/modules/downloads/persisted.ts` (+ `persisted.test.ts`): moves
  `downloadsSettingsSchema`/`parseDownloadsSettings`/`parseDownloadFailures` and their helpers from
  `src/main/lib/schemas.ts`, defaults, and `downloadsState(state)` returning `{ settings, failures }`
  section handles; `failures` prunes with `pruneFailures(…, Date.now())` on `get()` and on `update()`
  (today's `StateStore.getDownloadFailures`/`setDownloadFailures` invariant). Switch
  `src/main/modules/downloads/index.ts` and `queue.ts` and `index.test.ts` to it. Move tail: delete
  the code from `lib/schemas.ts` and its tests from `lib/schemas.test.ts` (into `persisted.test.ts`),
  delete the keys' fields/defaults/parse lines/accessors from `services/state.ts` and cases from
  `state.test.ts`, switch the two lines in `readEverySection` in
  `src/main/modules/persisted-state.golden.test.ts`; the golden JSON must not change.

- **D6 — home owns `homeLayout` (AC3).** New `src/main/modules/home/persisted.ts`
  (+ `persisted.test.ts`) with `parseHomeLayout` (moved from `src/main/lib/schemas.ts`), the
  deep-cloned default and `homeState(state)`; `src/main/modules/home/index.ts` (drop its
  `lib/schemas` import) and its tests use it. Move tail: delete the code from `lib/schemas.ts` and
  tests from `lib/schemas.test.ts`, the key's field/default/parse line/accessors from
  `services/state.ts` and cases from `state.test.ts`, switch its line in `readEverySection` in
  `src/main/modules/persisted-state.golden.test.ts`; the golden JSON must not change.

- **D7 — unlock owns `unlock` (AC3).** New `src/main/services/unlock/persisted.ts`
  (+ `persisted.test.ts`) with `parseUnlockState`, `MAX_UNLOCK_CODES`, `UnlockState`/
  `UnlockCodeEntry` (moved from `src/main/lib/schemas.ts`) and `unlockState(state)`;
  `src/main/services/unlock/service.ts`, `service.test.ts` and `src/main/ipc/unlock.test.ts` import
  from it. Move tail: delete code/tests from `lib/schemas.ts`/`lib/schemas.test.ts`, the key's
  field/default/parse line/accessors from `services/state.ts` and cases from `state.test.ts`, switch
  its line in `readEverySection` in `src/main/modules/persisted-state.golden.test.ts`; the golden
  JSON must not change.

- **D8 — servers owns `servers` (AC3).** New `src/main/modules/servers/persisted.ts`
  (+ `persisted.test.ts`) with `parseServersState` and helpers (moved from `src/main/lib/schemas.ts`,
  now importing `capServerHistory` from `./history-log`), the cloned default and
  `serversState(state)`. Replace every `app.state.serversState()` / `updateSlice('servers', …)` in
  `src/main/modules/servers/index.ts` with the handle's `get()`/`update()`; same in
  `index.test.ts`, `scan-integration.test.ts`, `master-sources.test.ts`. Move tail as in D5–D7
  (`lib/schemas.ts`, `lib/schemas.test.ts`, `services/state.ts`, `state.test.ts`, the golden
  helper's line); the golden JSON must not change.

- **D9 — replays owns `replays` (AC3).** New `src/main/modules/replays/persisted.ts`
  (+ `persisted.test.ts`) with `parseReplaysState`, `ReplaysState` and helpers (moved from
  `src/main/lib/schemas.ts`), the cloned default and `replaysState(state)`. Switch
  `src/main/modules/replays/index.ts`, `name-templates.ts`, `index.test.ts`,
  `name-templates.test.ts`. Move tail as in D5–D8; the golden JSON must not change.

- **D10a — config's persisted schema moves (AC3).** New `src/main/modules/config/persisted.ts`
  (+ `persisted.test.ts`): everything config in `src/main/lib/schemas.ts` (~lines 219–953:
  persisted action/category/cvar/baseline/profile schemas, `normalizeConfigProfile` and the legacy
  normalisers for now, `parseConfigProfiles`/`parseConfigProfile`, played-mods, switch-binds,
  write-failures, file-source-migrated-at), with their tests from `src/main/lib/schemas.test.ts`;
  `src/main/modules/config/schemas.test.ts` and `src/main/services/migrations.test.ts` import from
  the new file. `services/state.ts` temporarily imports the parsers from there (removed in D10b).
  Golden and all tests stay green unchanged.

- **D10b — config registers its five sections (AC3).** `persisted.ts` gains `configState(state)`
  returning `{ profiles, playedMods, switchBinds, writeFailures, fileSourceMigratedAt }` handles;
  `fileSourceMigratedAt` exposes a write-once `markDone(at)` (today's
  `StateStore.setConfigFileSourceMigratedAt` semantics). Switch `src/main/modules/config/index.ts`
  and `profiles.ts`, and the tests `index.test.ts`, `file-source-pipeline.test.ts`,
  `import.test.ts`, `profiles.test.ts`, `rebuild.test.ts` (mechanical: `app.state.configX()` →
  `configState(app.state).x.get()`). Delete every config field/default/parse line/accessor from
  `src/main/services/state.ts` and cases from `state.test.ts`; `updateSlice` keeps only
  `'installations'`. Switch the config lines in `readEverySection`; golden unchanged.

- **D11 — config migrations leave the shell (AC4).** New
  `src/main/modules/config/persisted-migrations.ts` (+ `persisted-migrations.test.ts`): the four
  `MIGRATIONS` steps (`to` 2–5) and their helpers from `src/main/services/migrations.ts`, plus the
  parse-time legacy normalisers (`normalizeLegacyActionKeys`, `legacyAliasValueMap`,
  `migrateLegacyReferences`, `migrateLegacyAliasReferences`) moved out of
  `modules/config/persisted.ts`, which imports them. `migrations.ts` keeps `MigrationStep` and
  `migrateStateDocument(raw, steps)`, asserting strictly ascending `to` ending at
  `STATE_SCHEMA_VERSION` (throws otherwise) and carrying no config import. `src/main/modules/index.ts`
  exports `MODULE_MIGRATIONS`; `src/main/context.ts` passes it to `new StateStore(path,
{ migrations })`. Move the config step tests from `src/main/services/migrations.test.ts` to the new
  test; the shell test keeps runner tests with fake steps. Tests: › "runs only steps above the file's
  version, in order", › "a step list not ending at STATE_SCHEMA_VERSION throws"; golden unchanged.

- **D12 — docs and the layering gate (AC1, AC3, AC5).** `docs/ARCHITECTURE.md` "State and
  persistence": two-tier rule (additive optional key → forgiving parse in the owner's `persisted.ts`;
  shape change → `MIGRATIONS` step in the owner's `persisted-migrations.ts` + `STATE_SCHEMA_VERSION`
  bump; no new parse-time rewrites), `section()` and unknown-key preservation; drop "`MIGRATIONS` is
  empty at v1"; "Adding a module" step 3 says the module owns its state via `persisted.ts` +
  `app.state.section()` instead of "never touches the state file" (same fix in the `MainModule` doc
  comment in `src/main/modules/types.ts`). Update `docs/systems/config-module.md` (~lines 180–193, 248) and `docs/systems/install-module.md` (~190, 391) paths. New `src/main/shell-layering.test.ts`
  (mirror the tree walk in `src/main/modules/downloads/layering.test.ts`): › "no shell file imports
  from modules" (every `.ts` under `src/main/lib`, `src/main/services` plus `src/main/index.ts` has no
  import specifier matching `modules/`), › "lib/schemas.ts holds at most 400 lines",
  › "ARCHITECTURE.md states the two-tier migration rule" (the stale sentences are absent,
  `persisted.ts` appears under "Adding a module").

## Model Hints

- D4 → deliverable-hard: the new load/save split must keep the on-disk document flat and identical
  while unregistered keys round-trip raw and registered ones write typed values, across the
  backup/corrupt recovery path and writes that happen before any module has registered — a subtle
  data-loss path the golden alone does not cover.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/shell-layering.test.ts` › "no shell file imports from modules"; plus unit
  `src/main/modules/downloads/engine/record-engine-state.test.ts` › "records the engine state and
  mirrors detectedVersion in one write" and › "a patch without a version removes detectedVersion".
- AC2 → unit `src/main/services/state.test.ts` › "a registered section parses its key and update
  writes it" and › "an unknown top-level key survives load and save verbatim".
- AC3 → unit `persisted.test.ts` in `src/main/modules/{downloads,home,servers,replays,config}/` and
  `src/main/services/unlock/` (moved parse tests), plus `src/main/shell-layering.test.ts` ›
  "lib/schemas.ts holds at most 400 lines".
- AC4 → unit `src/main/modules/config/persisted-migrations.test.ts` (moved step tests) and
  `src/main/services/migrations.test.ts` › "a step list not ending at STATE_SCHEMA_VERSION throws";
  "carries no config import" is covered by › "no shell file imports from modules".
- AC5 → unit `src/main/shell-layering.test.ts` › "ARCHITECTURE.md states the two-tier migration
  rule".
- AC6 → unit `src/main/modules/persisted-state.golden.test.ts` › "every fixture state.json loads to
  the golden document"; the e2e fixture variants are exercised by the sprint's `npm run ui:flows`
  gate (no user action in this story, so no story-own flow).

## Done

Persisted state is now owned by its modules: `StateStore.section()` (typed `{get, update}` handles, unknown top-level keys kept verbatim) replaces the per-key accessors; downloads, home, servers, replays, config (five keys) and the unlock service each have a `persisted.ts` + test; config's `MIGRATIONS` and legacy normalisers live in `config/persisted-migrations.ts`, composed via `MODULE_MIGRATIONS`; `lib/schemas.ts` is 165 lines. No shell file imports from `modules/` (enforced by `src/main/shell-layering.test.ts`). ARCHITECTURE.md carries the two-tier migration rule.

Commit message: `207: modules own persisted state (StateStore.section, per-module persisted.ts, config migrations out of shell), shell-layering test, golden state test`

Verification (narrow gate): `npm run typecheck`, `npm run build` green; `npx vitest run --changed HEAD` green (89 files/1559 tests), `npx vitest run src/main src/shared` green after review fixes (327 files/4893). Flows run via `npm run ui:flow`: quit-persists-state, replays-extra-folders, replays-filter-search, mods-install, bootstrap-failure-retry, config-header-geometry, servers-module-shell, home-dashboard-arrange green (red once, green on re-run: flaky narrow-stack step, renderer untouched); `downloads-tab` red ("4 archives" vs expected 2) is the same pre-existing fixture issue recorded in story 204 (renderer/shared untouched). Full gate pending (sprint).
AC to test: AC1 shell-layering "no shell file imports from modules" + record-engine-state.test.ts (2 tests); AC2 state.test.ts (4 named tests + recovery/register-after-save); AC3 six persisted.test.ts + "lib/schemas.ts holds at most 400 lines"; AC4 persisted-migrations.test.ts + migrations.test.ts "a step list not ending at STATE_SCHEMA_VERSION throws"; AC5 shell-layering "ARCHITECTURE.md states the two-tier migration rule"; AC6 persisted-state.golden.test.ts (fixtures v1-v5, expected JSON generated from pre-move code, unchanged by every later move) plus the flows above. No manual residue.
Review: default stage, 1 fix cycle (failures handle no-op update no longer writes; stale pointers/doc comments repointed; second reviewer over the fix PASS).
Decisions: (1) `setEngineState` jobs wiring uses `withEngineState(installations)` (prototype view adding `setEngineState(id,p)`) in record-engine-state.ts because the bootstrap host takes the whole service; known fragility: breaks if InstallationsService gains `#private` fields. (2) `new StateStore(path)` without `migrations` option runs no migration (production `context.ts` always passes `MODULE_MIGRATIONS`, validated on load); chosen to avoid editing ~25 tests, golden test passes real steps; a required option would remove the footgun. (3) Retired top-level keys (e.g. `configPendingWrites`) are now kept on disk verbatim instead of dropped on load; loaded values unchanged. (4) `replays` key is written only once something updates it (no longer a default key). (5) Stale `main/lib/schemas.ts` mentions remain in a few `src/shared` comments; story-id comments moved verbatim with code were not rewritten. (6) Test helpers added: `src/test-support/state-sections.ts` (`fakeSectionState`), `config-state.ts`.
tiers: D 13 / hard 1 · review default · cycles 1 · agents 17
