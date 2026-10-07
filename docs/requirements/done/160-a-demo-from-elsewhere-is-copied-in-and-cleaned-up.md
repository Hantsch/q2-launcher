---
id: 160
title: a demo from elsewhere is copied in and cleaned up
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Q2PRO's `demo` command only loads from the Quake file system (concept
`docs/concepts/demo-browser.md` §9.1). A demo in an extra folder, in another installation, inside a
zip — or a `.gz` for an engine that cannot read it — has to be put where the playing installation
can see it. The launcher does that with a **temporary copy** in `<gamedir>/demos/_launcher/` of the
playing installation and removes it after the game exits; **the original is never touched** (§11.2,
DEMO-23).

[[141]] already keeps `_launcher/` out of the list. How leftovers from a crashed session are cleaned
up is concept open point §17.8.

## Acceptance Criteria

- [x] **AC1** — Playing a demo that is not inside the chosen installation's `<gamedir>/demos/`
      copies it to `<gamedir>/demos/_launcher/` and plays the copy.
- [x] **AC2** — Playing a zip entry extracts just that entry to the same place and plays it.
- [x] **AC3** — ~~A `.gz` is decompressed into the copy only when the chosen engine cannot play it
      (r1q2, [[161]]);~~ Q2PRO gets the `.gz` as-is — the copy is byte-identical and keeps its `.gz`
      extension. (Decompression cut with the r1q2 fallback — see Decisions (Sprint).)
- [x] **AC4** — The copy is removed after the game exits.
- [x] **AC5** — The original file (and archive) is unchanged afterwards — content and modification
      time, asserted by a test.
- [x] **AC6** — Leftovers from a session that did not end cleanly are removed at the next launcher
      start by the rule decided in Q1.
- [x] **AC7** — If `_launcher/` cannot be created or written, Play fails with a visible, specific
      reason and nothing is launched.
- [x] **AC8** — Two copies with the same file name from different sources never overwrite each other
      while one is playing.

## Open Questions

- [x] ~~**Q1 — Crash cleanup** (§17.8): sweep all of `_launcher/` at startup, or only files the
      launcher recorded as its own?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Not writable** — is there any fallback when the installation folder is read-only, or
      is failing with the reason (AC7) the whole answer?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User, sprint-level)** Playback goes through Q2PRO only for now; no r1q2 playback. → AC3's
  "decompress for r1q2" half is cut: every `.gz` is copied as-is, nothing is ever decompressed.
- **Q1 — Sweep all of `_launcher/`.** At launcher start the replays module deletes every _file_
  directly inside each known `…/<gamedir>/demos/_launcher/` (not recursive, never outside that
  folder); per-file failures (e.g. EBUSY on Windows) are logged and skipped. Reason: `_launcher/` is
  a launcher-reserved folder that [[141]] already hides from the list, so nothing in it is a user's
  original, and a "recorded as mine" ledger would be lost in exactly the crash it is meant to cover.
- **Q2 — One fallback only: Q2PRO's own Linux write dir.** Target candidates are, in order,
  `<root>/<gamedir>/demos/_launcher/` and — only where `effectiveWriteDirs()` yields one (Linux
  Q2PRO, `~/.q2pro`) — `<writeDir>/<gamedir>/demos/_launcher/`; if no candidate can be created and
  written, Play fails with the reason (AC7). Reason: `demo` only reads the Quake file system (§9.1),
  and that write dir is the one other place of it the launcher already models (§13); anything else
  would be invisible to the engine.
- **Copy name = `<demoId><original extension>`** (e.g. `_launcher/3fa9…c1.dm2.gz`). Reason: the id is
  unique per source path/zip entry, so equal file names from different sources can never collide
  (AC8), and the name stays short enough for the engine's path limit regardless of how long the
  original name is.
- **Cleanup trigger** = the launch state of the playing installation reaching `exited` or `failed`,
  or `launch:start` itself failing; a `handed-off` launch never reports an exit, so its copy is left
  to the next startup sweep. Reason: that is the only exit signal `LaunchService` has
  (`onStateChange`), and the sweep is the stated fallback for anything that did not end cleanly.

## Plan

Builds on [[159]]'s play handler: 159 plays a demo in place when it is already inside the chosen
installation's demos folder and refuses otherwise; 160 replaces that refusal with "stage a copy,
play the copy, remove it on exit".

1. **Staging core** (`src/main/modules/replays/demo-staging.ts`, new): target-dir choice, copy of a
   loose file (`fs.copyFile`, `.gz` untouched), extraction of one zip entry (existing
   `readZipEntry`, bytes written tmp+rename), copy naming, removal, startup sweep. Pure fs, all
   dependencies injected, unit-tested against a real temp dir.
2. **Wiring** (replays module main half): 159's play path calls staging for a not-in-place demo,
   launches `+demo _launcher/<name>`, subscribes to `app.launch.onStateChange` to remove the copy;
   `setup` fires the startup sweep over all installations × game dirs. New i18n error key.
3. **E2E flows** against 159's stubbed engine: copy-in (loose + zip), sweep on start, not-writable.

Affected: `src/main/modules/replays/{demo-staging.ts,demo-staging.test.ts,index.ts}`, 159's
play/playback file(s) in the same folder, `src/renderer/src/i18n/locales/en.json`, `CHANGELOG.md`,
`scripts/lib/fixture.mjs`, three new `scripts/flows/replays-copy-in*.mjs`.

## Deliverables

- [x] **D1 — Staging core + unit tests.** New `src/main/modules/replays/demo-staging.ts` and
      `demo-staging.test.ts` (mirror the temp-dir style of `src/main/modules/replays/discovery.test.ts`;
      outcomes use `Outcome`/`fail` from `src/shared/types/common.ts`). Exports:
  - `LAUNCHER_DIR_NAME = '_launcher'`.
  - `stagedFileName(demo)` → `<demo.id>` + the original's extension, lower-cased
    (`.dm2`/`.mvd2`/`.dm2.gz`/`.mvd2.gz`; for a zip entry, the entry name's extension).
  - `stageDemo({ demo, absolutePath, targetDemosDirs, zipDeps })` →
    `Outcome<{ copyPath, relativePath }>`, where `demo` is a `DiscoveredDemo`
    (`src/shared/modules/replays.ts`), `absolutePath` its main-only path (for a zip entry the
    archive path, `demo.archiveEntry.entryPath` the entry), `targetDemosDirs` the candidate
    `…/<gamedir>/demos` dirs in priority order. For the first candidate where
    `mkdir -p <dir>/_launcher` and the write succeed: loose file → `fs.copyFile` (never opens the
    source for writing; `.gz` copied byte-for-byte, never decompressed); zip entry → look up the
    entry's size with `listZipEntries` and read it with `readZipEntry` (`src/main/lib/zip-entries.ts`,
    as `zip-demos.ts:144` does), write to `<name>.tmp` then rename. `relativePath` is
    `_launcher/<stagedFileName>` (relative to `demos/`, forward slash). A zip read failure returns a
    fail with key `replays.play.error.archiveEntry` + `{ code }`; no writable candidate returns
    `replays.play.error.copyDirNotWritable` + `{ path: <first candidate's _launcher path> }`.
    Existing file with the same staged name is overwritten (it can only be this same source's stale
    copy).
  - `removeStagedCopy(copyPath)` — deletes that file only if its parent folder is named
    `_launcher`; never throws.
  - `sweepLauncherDirs(demosDirs, log)` — deletes every regular file directly inside
    `<dir>/_launcher/` for each dir; missing folders are fine; per-file errors logged and skipped;
    never recursive, never touches anything outside `_launcher/`.
    Tests (names below): original file and archive unchanged in bytes and mtime after staging; `.gz`
    copy is byte-identical with `.gz` name; same file name from two sources stages to two files and
    staging B leaves A's copy intact; first candidate blocked (a _file_ named `_launcher` in it) falls
    through to the second; all candidates blocked → `copyDirNotWritable`, nothing written; sweep
    removes `_launcher/` files and leaves `demos/*.dm2` and subfolders alone.
- [x] **D2 — Wire staging into play + cleanup + startup sweep.** Files: 159's play handler module in
      `src/main/modules/replays/` (the one that builds `+demo <relative path>` and today refuses a demo
      outside the chosen installation's demos folder), `src/main/modules/replays/index.ts` (module
      `setup`), `src/main/modules/replays/playback-sessions.ts` only if the copy path is tracked there,
      `src/renderer/src/i18n/locales/en.json` (keys `replays.play.error.copyDirNotWritable` — e.g.
      "Can't write a temporary copy to {{path}}. Nothing was started." — and
      `replays.play.error.archiveEntry`), `CHANGELOG.md` (one `### Added` line), plus a test next to the
      play handler (mirror 159's play-handler test; fake `LaunchService` as in
      `src/main/ipc/dev.test.ts`). Behaviour:
  - Not in place → build candidates (`<root>/<gamedir>/demos`, then
    `effectiveWriteDirs(installation, ctx)` from `discovery.ts` joined with `<gamedir>/demos`) and
    call `stageDemo`. On fail → return that fail, **no** `launch:start`. On success → launch with
    `+demo <relativePath>`.
  - `launch:start` fails → `removeStagedCopy` immediately. Otherwise subscribe to
    `app.launch.onStateChange`; when the playing installation's state reaches `exited` or `failed`
    → `removeStagedCopy` and unsubscribe. `handed-off` → nothing (startup sweep covers it).
  - In-place plays (159) never get a copy and never trigger any delete.
  - `setup`: fire-and-forget `sweepLauncherDirs` over every installation × `gameDirs` demos dir
    (plus the effective write dirs), logged, never blocks module start or throws.
    Tests: not-writable → fail key and launch never called; copy removed on `exited` and on `failed`
    and on start failure; in-place play → no file deleted; setup runs the sweep over all
    installations' dirs.
- [x] **D3 — E2E flows.** New `scripts/flows/replays-copy-in.mjs`, `replays-copy-in-sweep.mjs`,
      `replays-copy-in-not-writable.mjs`; fixture additions in `scripts/lib/fixture.mjs` only if a
      needed source is missing (existing: extra folder `replaysExtraFolderFixturePath()`, zip
      `writeReplaysZipPackArchive()`, decoy `_launcher/leftover.dm2` in `REPLAYS_FIXTURE_DECOYS`). Mirror
      159's play flow (`scripts/flows/replays-play*.mjs`) for opening a demo, clicking Play and the
      stubbed engine process — no real engine; the flow must be able to observe the stub's exit.
  - `replays-copy-in`: an extra-folder demo → while the stub runs, `<gamedir>/demos/_launcher/<id>.dm2`
    exists and the stub's args contain `+demo _launcher/<id>.dm2`; after exit the copy is gone; the
    original's bytes + mtime equal their pre-play values. Same for a `pack.zip` entry (archive
    bytes + mtime unchanged). An in-place demo still exists after its play ends.
  - `replays-copy-in-sweep`: at launcher start the seeded `_launcher/leftover.dm2` is removed while
    `demos/*.dm2` of that installation is untouched (wait for the file to disappear, bounded).
  - `replays-copy-in-not-writable`: the flow replaces the target installation's `demos/_launcher`
    with a plain _file_ of that name, clicks Play on an extra-folder demo → the
    `copyDirNotWritable` text is visible and no stub process started.
    Before finishing, grep `scripts/flows/` for `leftover.dm2` / `_launcher` and make sure no existing
    flow depends on the decoy surviving start-up.

## Model Hints

- D2 → deliverable-hard — cross-file lifecycle: the copy must be deleted on every end path
  (`exited`, `failed`, `launch:start` failure) of exactly the installation that plays it, never on
  an in-place play (which would delete the user's original), and the startup sweep must not block
  or break module `setup` that 159's play path shares.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-copy-in.mjs` › "replays-copy-in" (extra-folder demo copied to
  `_launcher/`, stub launched with the copy) · unit `src/main/modules/replays/demo-staging.test.ts` ›
  "a loose demo is copied into _launcher under its id"
- AC2 → e2e `scripts/flows/replays-copy-in.mjs` › "replays-copy-in" (pack.zip entry) · unit
  `demo-staging.test.ts` › "a zip entry is extracted alone into _launcher"
- AC3 → unit `src/main/modules/replays/demo-staging.test.ts` › "a .gz is copied byte-identical and
  keeps its .gz name"
- AC4 → e2e `scripts/flows/replays-copy-in.mjs` › "replays-copy-in" (copy gone after stub exit) ·
  unit (D2, next to the play handler) › "the copy is removed when the game exits, fails or never
  starts"
- AC5 → unit `demo-staging.test.ts` › "staging leaves the original file and archive unchanged in
  bytes and mtime" · e2e `scripts/flows/replays-copy-in.mjs` › "replays-copy-in" (original + archive
  bytes/mtime, in-place demo survives its play) · unit (D2) › "an in-place play never deletes a file"
- AC6 → e2e `scripts/flows/replays-copy-in-sweep.mjs` › "replays-copy-in-sweep" · unit
  `demo-staging.test.ts` › "the sweep empties _launcher and nothing else"
- AC7 → e2e `scripts/flows/replays-copy-in-not-writable.mjs` › "replays-copy-in-not-writable" · unit
  `demo-staging.test.ts` › "no writable target fails with copyDirNotWritable and writes nothing" ·
  unit (D2) › "a staging failure never calls launch"
- AC8 → unit `src/main/modules/replays/demo-staging.test.ts` › "same file name from two sources
  stages to two copies without overwriting"

## Done

Playing a demo from another installation, an extra folder or a zip entry now stages a temporary copy in
`<gamedir>/demos/_launcher/<id><ext>` (`.gz` copied as-is), launches `+demo _launcher/<name>` and removes
the copy on exit/fail/start failure; leftovers are swept at launcher start. Originals are never touched.

Commit message: `160: copy-in play for demos from elsewhere — _launcher staging, cleanup on exit, startup sweep`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (103 files / 801 tests) and `npm run ui:flow -- replays-copy-in|replays-copy-in-sweep|replays-copy-in-not-writable` all green; full regression gate is the sprint's. Review: default stage, PASS.
AC → test (all ran and passed): AC1/2/5 unit `demo-staging.test.ts` + flow `replays-copy-in`; AC3 unit "a .gz is copied byte-identical…"; AC4 flow `replays-copy-in` + unit `demo-play.test.ts` "the copy is removed when the game exits, fails or never starts"; AC5 also "an in-place play never deletes a file"; AC6 flow `replays-copy-in-sweep` + unit sweep test; AC7 flow `replays-copy-in-not-writable` + unit + "a staging failure never calls launch"; AC8 unit "same file name from two sources…". No manual residue.

Decisions:

- Plan gap: the shared eligibility rule (`src/shared/replays/demo-play.ts`) still refused demos from elsewhere (`notInInstallation`), keeping Play disabled. Added D2b: rule now returns ok with `inPlace` flag; reason key removed; 159's refusal tests rewritten to assert the copy launch.
- Additions in `demo-play.ts`: second play while one is in flight is refused as `gameRunning`; play awaits the startup sweep before staging; file-exists and console-safe staged-name checks.
- D3 flows use a ~3 s lingering stub (`cmd.exe` copy on Windows, sleep script on Linux — Linux path unrun) via new `scripts/lib/replays-copy-in.mjs` and `writeReplaysCopyInFixture`.
  Unfixed review notes (accepted): zip unit tests use `it.skipIf` when the vendored 7za is missing (present here, flow throws instead of skipping); an extra folder that is itself an installation's `_launcher` dir is swept at start (Decision Q1); not-writable flow is Windows-shaped; `unsafeName` branch has no direct main test.

tiers: D 4 / hard 1 · review default · cycles 1 · agents 6
