---
id: 210
title: the config module's main side is handlers, not business logic
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the config module's most delicate invariants — never overwrite unread
bytes, only `save` writes a dirty canonical file, raw-save bytes are never re-rendered — to live
in a service with an explicit dependency interface that a unit test can drive directly, so that
they are no longer testable only by booting the whole module with a full `AppContext`, and so
that the next config story does not add another hundred lines to one closure.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F07, confirmed by an
independent re-count): `src/main/modules/config/index.ts` is 2,035 lines; `setup()` spans lines
593–2035 and registers 35 handlers of 41–58 lines each (replays' are one-liners); `save` is ~152
lines, `saveRawText` ~166, `refreshFromFiles` ~176 with a 143-line loop body; ~480 lines of
orchestration (`syncAndPersist`, `authoriseContentWrite`, `canonicalFileNameFor`,
`readSyncFileStatus`) sit above `setup()` unexported; the file imports `node:fs/promises` and
`electron.shell` directly; `userDataDir()` 12x, `fail('config.error.profileNotFound')` 12x,
`withLiveAssignments(` 16x inside the closure. `index.test.ts` (3,231 lines, 103 tests) boots the
module 13 times and shares three `vi.mock`s of sibling modules across all tests. 26 of 430
commits since August touched this file — ten different stories in the last ten commits.
`downloads/index.ts` (933 lines, 21 handlers) repeats the shape at a smaller scale. replays and
servers already follow the thinner "setup registers one-line delegations" pattern.

## Acceptance Criteria

- [ ] **AC1** — The write-path orchestration (`syncAndPersist`, `authoriseContentWrite`,
      `canonicalFileNameFor`, `readSyncFileStatus`, and the bodies of `save`, `saveRawText`,
      `refreshFromFiles`) lives in `src/main/modules/config/profile-writes.ts` (name at refine)
      behind an explicit deps interface in the style of `sync.ts#SyncProfileDeps`
      (`readFileState`, `writeTargetFile`, state access, logger).
- [ ] **AC2** — The save / raw-save / refresh `describe` blocks are ported to
      `profile-writes.test.ts` driving the service with injected deps and no `configModule.setup()`
      boot; the three invariants above each have a named test there.
- [ ] **AC3** — `index.ts` registers each handler as one `handle(X, schema, (input) => service.x(input))`
      line or a short adapter; it has no `node:fs` or `electron` import; its length is ≤ 600 lines
      (a soft cap recorded in story 208's architecture test once both have landed).
- [ ] **AC4** — `index.test.ts` keeps registration completeness, schema rejection and one happy
      path per handler; the story-numbered `describe` names are renamed to behaviours.
- [ ] **AC5** — The startup sequence (`runFileSourceStartup` + the sync retry loop) lives in
      `startup.ts`; whether it must still block boot is recorded as a decision (see F49 in the
      review).
- [ ] **AC6** — `round-trip.test.ts`, `file-source-pipeline.test.ts` and every config flow pass
      unchanged.

## Decisions (Sprint)

- **(User)** Q1: One `profile-writes.ts` for the write path, incremental, no rewrite.
- **(User)** Q2: downloads/index.ts is NOT cut here; separate story later.
- **D-a — Facts re-counted at refine (2026-10-03).** `index.ts` is now 2,051 lines with no
  `electron` import (story 209 removed it; `node:fs/promises` `readFile` remains, used only by
  `readSyncFileStatus`); `index.test.ts` was already split into seven `index.*.test.ts` files
  (114 tests) plus `index.test-helpers.ts`; `round-trip.test.ts` is now the folder
  `src/main/modules/config/round-trip/`. Reason: the plan must target the code as it is, and AC6
  reads "round-trip.test.ts" as that folder.
- **D-b — "Write path" = every handler body that ends in a disk write or judges a file against
  the write rule.** Besides `save`/`saveRawText`/`refreshFromFiles`, the service also takes the
  bodies of `create`'s and `importCommit`'s sync tail, `remove` (canonical file removal),
  `commitCvars`, `assign`, `unassign`, `setDefault`, `write`, `setSwitchBind`, `tidyUpApply`,
  `syncState` and `rawFiles` (`collectRawFiles`). Reason: all of them call `syncAndPersist`,
  `authoriseContentWrite`, `readSyncFileStatus` or the writer directly, AC3's ≤600-line cap is not
  reachable otherwise, and the user's Q1 ("one profile-writes.ts for the write path") excludes
  handler-group files.
- **D-c — Service shape:** `createProfileWrites(deps: ProfileWritesDeps): ProfileWrites`, a plain
  factory returning an object of functions (no class), mirroring `sync.ts#SyncProfileDeps`'s
  plain-object deps. Reason: matches the existing deps style and needs no `this` binding in
  one-line `handle(...)` delegations.
- **D-d — Deps interface** (`ProfileWritesDeps`): `profiles: ProfilesStore`, `installations:
  { list(); find(id) }`, `launchState: () => LaunchState`, `config: ReturnType<typeof
  configState>` (state access: writeFailures, playedMods, switchBinds), `canonicalBaseDir: () =>
  string`, `readFileState`, `readText(path) → latin-1 string` (replaces the `node:fs` import),
  `writeTargetFile`, `log`. Production defaults for the three I/O functions are exported from
  `profile-writes.ts`; `profile-writes.ts` imports no `AppContext`, `electron` or `lib/paths`.
  Reason: AC1 names exactly these seams, and a temp-dir `canonicalBaseDir` replaces the
  `electron` mock (`userDataBox`) the current tests need.
- **D-e — Tests run against a temp directory through injected deps, with a real `StateStore`.**
  A spy `writeTargetFile` is injected only where a test asserts a non-write. Reason: the
  invariants are about real bytes on disk; faking `readFileState` would let the hash check be
  asserted against a fake that never sees bytes.
- **D-f — Ported tests are split by topic** (`profile-writes.save.test.ts`,
  `profile-writes.raw-save.test.ts`, `profile-writes.refresh.test.ts`,
  `profile-writes.sync.test.ts`, `profile-writes.reads.test.ts`), with the three named invariant
  tests in `profile-writes.test.ts`. Reason: one ~2,500-line test file is the shape F07
  criticises, and the repo already splits `index.*.test.ts` by topic; AC2's "there" is read as
  the `profile-writes*` test family, with the invariants in the file AC2 names.
- **D-g — A port is count-preserving.** Every moved `it(...)` keeps its assertions; the number
  of `it(` calls across `src/main/modules/config/*.test.ts` does not drop, except for tests
  deliberately reduced to the per-handler happy path in D6 whose behaviour case already exists in a
  `profile-writes*` test. Reason: a mostly-move diff hides a dropped test; a count is checkable.
- **D-h — F49: the startup sequence keeps blocking boot.** `runConfigStartup` stays awaited at the
  end of `setup()`. Reason: the first `list` call must already see profiles rebuilt from disk, a
  non-blocking start would need a new "config ready" event and renderer handling — a behaviour
  change this refactor story (AC6: flows pass unchanged) must not make; F49's second half (a
  throwing setup keeps handlers live) is untouched because startup already catches its own
  failures.
- **D-i — Pure helpers leave `index.ts` for their topical sibling:** `previewProfileFiles` and
  `validatePlayedMods` → `write-plan.ts`; `applyCleanupIfNotRunning` /
  `restoreCleanupIfNotRunning` → `cleanup.ts`; their tests move along. Reason: they are already
  exported, stateless and independently tested, so moving them is not a handler-group split (Q1),
  and `write-plan.ts` is where "what a write would put on disk" already lives.
- **D-j — The ≤600 cap is a hard assertion in `src/architecture.test.ts`** as a small
  `LINE_CAPS` map (`src/main/modules/config/index.ts: 600`), plus a check that `index.ts` imports
  no `node:fs*` or `electron`. Reason: story 208 has landed without a line cap, and AC3 asks for
  it to be recorded there.
- **D-k — "Every config flow" (AC6)** = the flows that drive the save / raw-save / refresh / sync
  handlers: `raw-inline-edit`, `raw-save-cascades`, `unsaved-diff`, `external-edit-cascades`,
  `import-from-files`, `config-header-geometry`; the sprint's `e2e-all` gate covers the rest.
  Reason: these exercise the moved code through the real surface; the sprint gate already runs
  every flow.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — One `profile-writes.ts` or several handler groups (`handlers/profiles.ts`,
      `handlers/editing.ts`, `handlers/raw-files.ts`, `handlers/import.ts`, `handlers/cleanup.ts`)?
      The value judge recommends one incremental story around the write path only, not a
      rewrite.
- [x] answered → Decisions (Sprint) — **Q2** — Apply the same cut to `downloads/index.ts` here or as its own small story?

## Plan

Pure refactor of `src/main/modules/config/` — no behaviour, IPC or renderer change, no changelog
entry. Incremental: each D leaves the module working and the full config test suite green.

1. **D1 (hard)** — create `profile-writes.ts` with `ProfileWritesDeps` (D-d) and
   `createProfileWrites`; move `syncAndPersist`, `authoriseContentWrite`, `canonicalFileNameFor`,
   `readSyncFileStatus`, `droppedAliasNames` and the `save` body in. `setup()` builds the deps once
   from `app`/`log`/`profiles` and every existing call site uses `writes.syncAndPersist(...)`.
   Port the "explicit save" describe; write the two save-side invariant tests.
2. **D2** — move `saveRawText` and `refreshFromFiles` bodies; port their describes; write the
   raw-save invariant test.
3. **D3** — move the remaining write-path handler bodies (D-b); port `index.sync`,
   `index.write-failures` and the `commitCvars` describe.
4. **D4** — `startup.ts` (`runConfigStartup`) with file-source startup + retry sweep; still
   awaited (D-h).
5. **D5** — pure helpers out of `index.ts` (D-i); `index.ts` reaches ≤600 lines.
6. **D6** — `index.test.ts`: completeness, schema rejection, one happy path per handler; leftover
   handler describes reduced/ported and renamed to behaviours; architecture line cap (D-j);
   `docs/systems/config-module.md` updated.

Order matters: D1 → D2 → D3 → D4 → D5 → D6 (each builds on the service shape D1 fixes).
Story 211 (built before this) may already have changed `schemas.ts`/`render.ts` imports —
work against what is on the branch.

## Deliverables

- **D1 — `profile-writes.ts` service with the sync core and `save`** (hard).
  Create `src/main/modules/config/profile-writes.ts` exporting `ProfileWritesDeps`,
  `ProfileWrites`, `createProfileWrites(deps)` and production defaults for `readFileState`,
  `readText` (latin-1 `node:fs/promises` read) and `writeTargetFile`. Deps (plain object, style of
  `sync.ts#SyncProfileDeps`): `profiles: ProfilesStore`, `installations: { list(): Installation[];
  find(id: string): Installation | undefined }`, `launchState: () => LaunchState`, `config:
  ReturnType<typeof configState>` (from `./persisted`), `canonicalBaseDir: () => string`,
  `readFileState`, `readText`, `writeTargetFile`, `log: Logger`. `profile-writes.ts` must not
  import `../../context` (`AppContext`), `electron` or `../../lib/paths`.
  Move from `src/main/modules/config/index.ts` into the service, unchanged in logic:
  `syncAndPersist` (signature loses `app, log, profiles`; keeps `profile, allProfiles, options`),
  `authoriseContentWrite`, `canonicalFileNameFor`, `readSyncFileStatus` (now via `deps.readText`;
  ENOENT handling unchanged), `droppedAliasNames`, and the whole body of the
  `CONFIG_HANDLERS.save` handler as `writes.save(input)`. Every `userDataDir()` in moved code
  becomes `deps.canonicalBaseDir()`; every `app.*` read becomes the matching dep. Keep the long
  invariant doc comments with the code they describe. In `setup()`, build the deps once and
  `const writes = createProfileWrites(deps)`; all remaining call sites in `index.ts` call
  `writes.syncAndPersist(...)` / `writes.authoriseContentWrite(...)` etc.; `save` becomes
  `handle(CONFIG_HANDLERS.save, saveProfileInputSchema, (input) => writes.save(input))`. The
  `canonicalWriteAllowed` predicate must read the same profile state it reads today (it closes
  over the live store, not a snapshot) — do not reorder the dirty / `refuseCanonicalWriteFor` /
  hash / `canonicalMoveAllowed` checks.
  Tests: port the `describe('story 043 D4: explicit save', …)` block from
  `src/main/modules/config/index.save.test.ts` to new
  `src/main/modules/config/profile-writes.save.test.ts` (describe renamed "save"), driving
  `createProfileWrites` with a temp dir (`installTempDir` from `src/test-support/temp-dir.ts`), a
  real `StateStore` (`src/main/services/state`) and `seedConfigProfiles`
  (`src/test-support/config-state.ts`) — no `configModule.setup()`, no `vi.mock` of `electron`,
  `./writer` or `./file-source`. Put a small `writesHarness(dir)` builder (deps + store + writes)
  in new `src/main/modules/config/profile-writes.test-helpers.ts` for D2/D3 to reuse. Every
  ported `it` keeps its assertions (same count). Leave the `commitCvars` describe in
  `index.save.test.ts` for D3. New `src/main/modules/config/profile-writes.test.ts` with:
  "never overwrites canonical bytes it has not read" (file bytes changed under a non-dirty
  profile with a `fileHash` → an `assign`-style `syncAndPersist` leaves the bytes untouched and
  records no write failure), "only save writes a dirty profile's canonical file" (dirty profile:
  `syncAndPersist` leaves the canonical file as it was; `save` writes it), and "the service runs a
  save on injected deps alone" (fake `log`, temp dir, no module boot).
  Files: `profile-writes.ts` (new), `profile-writes.test.ts` (new),
  `profile-writes.save.test.ts` (new), `profile-writes.test-helpers.ts` (new), `index.ts`,
  `index.save.test.ts`.

- **D2 — `saveRawText` and `refreshFromFiles` move into the service.**
  Builds on `src/main/modules/config/profile-writes.ts` (`createProfileWrites`,
  `ProfileWritesDeps`, `syncAndPersist`, `droppedAliasNames` are already there). Move the whole
  bodies of the `CONFIG_HANDLERS.saveRawText` and `CONFIG_HANDLERS.refreshFromFiles` handlers out
  of `src/main/modules/config/index.ts` into `writes.saveRawText(input)` and
  `writes.refreshFromFiles(input)`, logic unchanged (`userDataDir()` → `deps.canonicalBaseDir()`,
  `writeTargetFile` / `readFileState` via deps); the two handlers become one-line delegations.
  Tests: port `describe('CONFIG_HANDLERS.saveRawText handler (story 057 D4)')` from
  `index.raw-files.test.ts` to new `profile-writes.raw-save.test.ts` (describe "raw save") and the
  whole of `index.refresh.test.ts` to new `profile-writes.refresh.test.ts` (describe "refresh from
  files"; delete `index.refresh.test.ts`), using `writesHarness` from
  `profile-writes.test-helpers.ts`, no module boot and no `vi.mock`. The schema-rejection case
  ("rejects a payload the schema refuses…") is not ported — it stays as a handler-level case for
  D6. Same `it` count otherwise, assertions unchanged. Add to `profile-writes.test.ts`: "never
  re-renders the bytes a raw save wrote" (hand-formatted text via `saveRawText` → canonical file
  bytes equal the typed text after the cascade, and every assigned installation copy carries
  those bytes).
  Files: `profile-writes.ts`, `profile-writes.test.ts`, `profile-writes.raw-save.test.ts` (new),
  `profile-writes.refresh.test.ts` (new), `index.ts`, `index.raw-files.test.ts`,
  `index.refresh.test.ts` (deleted).

- **D3 — the remaining write-path handler bodies move into the service.**
  Builds on `src/main/modules/config/profile-writes.ts`. Move out of
  `src/main/modules/config/index.ts` into service methods, logic unchanged: `create`'s and
  `importCommit`'s sync tails (the handler keeps the store call, then `writes.syncAndPersist`),
  `remove` (canonical file removal), `commitCvars`, `assign`, `unassign`, `setDefault`, `write`,
  `setSwitchBind` (its `writeInstallationFiles` call), `tidyUpApply`, `syncState` and `rawFiles`
  (move `collectRawFiles` in as `writes.rawFiles`). A handler that keeps a line of store logic is
  a "short adapter" (≤ ~8 lines); everything else is one `handle(X, schema, (input) =>
  writes.x(input))` line. Afterwards `index.ts` has no `readFile`/`node:fs` import.
  Tests: port `index.sync.test.ts` → new `profile-writes.sync.test.ts` (describe "sync after a
  profile mutation"), `index.write-failures.test.ts` → into the same file (describe "write
  failures under overlapping sync runs"), and the `describe('story 175: commitCvars')` block of
  `index.save.test.ts` → new `profile-writes.commit-cvars.test.ts` (describe "commit cvars");
  delete the three emptied `index.*` files. Use `writesHarness` from
  `profile-writes.test-helpers.ts`, no module boot, no `vi.mock`; same `it` count, assertions
  unchanged.
  Files: `profile-writes.ts`, `index.ts`, `profile-writes.sync.test.ts` (new),
  `profile-writes.commit-cvars.test.ts` (new), `index.sync.test.ts`,
  `index.write-failures.test.ts`, `index.save.test.ts` (all three deleted).

- **D4 — startup sequence in `startup.ts`.**
  New `src/main/modules/config/startup.ts` exporting `runConfigStartup(deps)` with deps
  `{ profiles, config, canonicalBaseDir, syncAndPersist, log }`: the guarded
  `runFileSourceStartup` call and its info log, then the retry sweep over
  `config.writeFailures` keys (`<profileId>|…`), sequentially awaited, unknown ids skipped — moved
  verbatim from the end of `setup()` in `src/main/modules/config/index.ts`, which ends with
  `await runConfigStartup({...})` and `log.debug('config module ready')`. It stays awaited
  (decision D-h: boot keeps blocking, so the first `list` sees rebuilt profiles); put a two-line
  comment saying so next to the call.
  Tests in new `src/main/modules/config/startup.test.ts` (temp dir, real `StateStore`, a spy
  `syncAndPersist`): "retries every profile with a persisted write failure, one at a time",
  "skips a write failure whose profile no longer exists", "a failing file-source startup leaves
  the module on cached state", "rebuilds a profile from an owned file before resolving" (an owned
  `.cfg` with no record → the profile is in `profiles.list()` when the promise resolves).
  Files: `startup.ts` (new), `startup.test.ts` (new), `index.ts`.

- **D5 — pure helpers leave `index.ts`; it reaches ≤600 lines.**
  Move `previewProfileFiles` and `validatePlayedMods` from `src/main/modules/config/index.ts` to
  `src/main/modules/config/write-plan.ts`; move `applyCleanupIfNotRunning` and
  `restoreCleanupIfNotRunning` to `src/main/modules/config/cleanup.ts`; update importers (`grep`
  for each name). Move their unit tests along: the `previewProfileFiles` and
  `validatePlayedMods` describes of `index.preview.test.ts` → `write-plan.test.ts`; the
  `applyCleanupIfNotRunning / restoreCleanupIfNotRunning` describe of `index.cleanup.test.ts` →
  `cleanup.test.ts`; same `it` count. Then measure `index.ts` (`wc -l`); if it is still over 600,
  move the next-largest disk-reading handler body (`openFile`'s path resolution/read, then
  `preview`'s on-disk read) into `profile-writes.ts` as a service method until it fits. Drop
  imports the moves orphan.
  Files: `index.ts`, `write-plan.ts`, `write-plan.test.ts`, `cleanup.ts`, `cleanup.test.ts`,
  `index.preview.test.ts`, `index.cleanup.test.ts` (+ `profile-writes.ts` only if the fallback
  is needed).

- **D6 — handler-level tests, line cap, system doc.**
  New `src/main/modules/config/index.test.ts` booting `configModule.setup()` once per describe
  with `collectHandlers` from `index.test-helpers.ts`: "registers every CONFIG_HANDLERS channel"
  (registered set equals `Object.values(CONFIG_HANDLERS)`), "rejects an invalid payload on every
  channel before the handler runs" (table: one invalid payload per channel →
  `ipc.error.invalidPayload`, no side effect), "every channel answers its happy path" (table: one
  valid payload per channel → `ok`), and "no config main-side describe names a story number"
  (scans `src/main/modules/config/**/*.test.ts` for `describe(` titles matching `/story \d/i`).
  Reduce the remaining handler describes in `index.raw-files.test.ts` (`rawFiles`, `openFile`),
  `index.preview.test.ts` (`preview`, `setActions / list round trip`) and `index.cleanup.test.ts`
  (`tidyUpApply`): keep `openFile`'s privileged-path rejections (they guard the shell call) and
  one happy path per handler; port every other behaviour case to new
  `profile-writes.reads.test.ts` (`rawFiles`) or `profile-writes.sync.test.ts` (`tidyUpApply`)
  via `writesHarness`; rename every remaining story-numbered describe to a behaviour. In
  `src/architecture.test.ts` add a `LINE_CAPS` map (`'src/main/modules/config/index.ts': 600`)
  with test "a thinned module entry stays within its line cap" and test "config's index.ts imports
  no node:fs or electron", plus "config's profile-writes reaches the app only through its deps"
  (`profile-writes.ts` imports none of `../../context`, `electron`, `../../lib/paths`). Update
  `docs/systems/config-module.md` §6: the startup steps run from `startup.ts` (still awaited by
  `setup()`, F49 decision D-h), the central write rule lives in `profile-writes.ts#syncAndPersist`
  behind `ProfileWritesDeps`, and `index.ts` only registers handlers.
  Files: `index.test.ts` (new), `index.raw-files.test.ts`, `index.preview.test.ts`,
  `index.cleanup.test.ts`, `profile-writes.reads.test.ts` (new), `src/architecture.test.ts`,
  `docs/systems/config-module.md`, `index.test-helpers.ts` (only if a helper is needed).

## Model Hints

- D1 → deliverable-hard — moving `syncAndPersist` out of the `setup()` closure replaces `app`,
  `userDataDir()` and the live `profiles` store with deps, and the `canonicalWriteAllowed`
  predicate's dirty / `refuseCanonicalWriteFor` / `fileHash` / `canonicalMoveAllowed` checks must
  keep reading the same live state in the same order, or "never overwrite unread bytes" silently
  regresses for every sync trigger (assign, rename cascade, startup sweep) at once.
- Review: → default — a pure move with count-preserving ports (D-g) and named invariant tests;
  the default review can check the `it` counts and the unchanged AC6 suites.

## Acceptance Tests

- AC1 → unit `src/main/modules/config/profile-writes.test.ts` › "the service runs a save on
  injected deps alone" (D1); unit `src/architecture.test.ts` › "config's profile-writes reaches
  the app only through its deps" (D6).
- AC2 → unit `src/main/modules/config/profile-writes.test.ts` › "never overwrites canonical bytes
  it has not read" (D1), › "only save writes a dirty profile's canonical file" (D1), › "never
  re-renders the bytes a raw save wrote" (D2); ported describes in
  `profile-writes.save.test.ts` › "save" (D1), `profile-writes.raw-save.test.ts` › "raw save"
  (D2), `profile-writes.refresh.test.ts` › "refresh from files" (D2).
- AC3 → unit `src/architecture.test.ts` › "a thinned module entry stays within its line cap" and
  › "config's index.ts imports no node:fs or electron" (D6; one-line delegations by D1–D5).
- AC4 → unit `src/main/modules/config/index.test.ts` › "registers every CONFIG_HANDLERS
  channel", › "rejects an invalid payload on every channel before the handler runs", › "every
  channel answers its happy path", › "no config main-side describe names a story number" (D6).
- AC5 → unit `src/main/modules/config/startup.test.ts` › "retries every profile with a persisted
  write failure, one at a time", › "skips a write failure whose profile no longer exists", › "a
  failing file-source startup leaves the module on cached state", › "rebuilds a profile from an
  owned file before resolving" (D4); the blocking decision is D-h.
- AC6 → unit `src/main/modules/config/round-trip/` (all files) and
  `src/main/modules/config/file-source-pipeline.test.ts`, run with no diff to those files (every
  D); e2e `scripts/flows/raw-inline-edit.mjs` › "raw-inline-edit",
  `scripts/flows/raw-save-cascades.mjs` › "raw-save-cascades", `scripts/flows/unsaved-diff.mjs` ›
  "unsaved-diff", `scripts/flows/external-edit-cascades.mjs` › "external-edit-cascades",
  `scripts/flows/import-from-files.mjs` › "import-from-files",
  `scripts/flows/config-header-geometry.mjs` › "config-header-geometry" (run after D3 and D6).

## Done

<!-- Filled by /build 210. -->
