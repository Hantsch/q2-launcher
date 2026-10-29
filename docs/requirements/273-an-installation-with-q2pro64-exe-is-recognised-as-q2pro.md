---
id: 273
title: An installation with q2pro64.exe is recognised as Q2PRO
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

As a player whose Quake II folder carries the 64-bit Q2PRO build (`q2pro64.exe`), I want the launcher
to recognise that installation as Q2PRO and launch it, so I do not have to rename the executable.

Today (user feedback 2026-10-29): detection matches the `ENGINE_DEFINITIONS` executables
(`src/shared/types/engine.ts:99`, `['q2pro.exe', 'q2pro']`, markers at :103), so a folder with only
`q2pro64.exe` is not detected as Q2PRO. The bootstrap already accepts `q2pro64.exe` as a download
source and renames it (`src/main/modules/downloads/bootstrap/assemble.ts:228`) — detection does not.

## Acceptance Criteria

- [ ] **AC1** — A folder whose only engine binary is `q2pro64.exe` is detected as engine kind
      `q2pro` (adding the installation and rescanning both).
- [ ] **AC2** — Launching that installation starts `q2pro64.exe` (the spawned path names that file).
- [ ] **AC3** — A folder with both `q2pro.exe` and `q2pro64.exe` is one Q2PRO installation, and
      launching it starts the binary the decided preference names.
- [ ] **AC4** — Everything keyed on Q2PRO (demo play eligibility, Q2PRO config limits, bleeding-edge
      update) treats a `q2pro64.exe` installation the same as a `q2pro.exe` one.

## Open Questions

- ~~Both binaries present: which wins — `q2pro64.exe` (64-bit) or `q2pro.exe` (what the launcher's own
  bootstrap writes)?~~ answered → Decisions (Sprint)
- ~~Bleeding-edge update / repair of a `q2pro64.exe` installation: overwrite `q2pro64.exe` in place, or
  write `q2pro.exe` beside it?~~ answered → Decisions (Sprint)
- ~~Other 64-bit names (`q2proded64.exe`, 64-bit r1q2 builds)? Out of scope unless refine finds them
  in the wild.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Both binaries present: q2pro64.exe is the default; when an installation holds more than one executable the user can always choose which one launches. Update/repair overwrites the chosen/default binary in place. Other 64-bit names stay out of scope unless refine finds them in the wild.
- Bootstrap keeps writing `q2pro.exe` for a fresh install (`assemble.ts` pins its default target now
  that the q2pro table lists `q2pro64.exe` first) — a fresh install holds one binary, so its name does
  not matter there and the existing bootstrap/engine-update flows stay unchanged.
- "The user can always choose" covers the engine clients main detected in the folder, now including
  several builds of one engine; any other file stays with the existing `select-executable` picker,
  because the renderer must never name a path — only an engine kind plus a detected file name.
- No other 64-bit client names were found in the repo or the shipped packages (`assemble.ts:228`
  knows only `q2pro64.exe`), so `q2proded64.exe` and 64-bit r1q2 names stay out of scope.
- Rollback is unchanged: it restores the backup's own file list, which already holds whichever
  binary name the update replaced.
- AC1–AC3's user paths become steps of the existing `installation-engine-choice` flow (same
  library-card chips) instead of a new flow; the rescan path is startup revalidation of a record
  written without `detectedEngines`, and adding goes through the same `inspectInstallation` verdict,
  proven in unit.

## Plan

1. **Engine table + detection (D1).** `src/shared/types/engine.ts` q2pro: `executables`
   `['q2pro64.exe', 'q2pro.exe', 'q2pro']`, `markers` gains `q2pro64.exe`. `DetectedEngine` gains
   `executablePaths: string[]` (every client of that engine found, preference order;
   `executablePath` stays its first). `detectEngines` (`inspector.ts:114`) collects all instead of
   `break`ing. `rankExecutables` already follows table order, so a new record defaults to
   `q2pro64.exe`. `engineOwning` (`installations.ts:738`) matches any of an engine's paths, so a
   chosen `q2pro.exe` still owns the Q2PRO badge. Persisted schema (`main/lib/schemas.ts:77`) takes
   the field optionally (legacy records). `assemble.ts:224` pins its default to `'q2pro.exe'`.
2. **Choosing the build (D2, main + contract).** `UpdateInstallationInput` gains
   `engineExecutable?: string` (a file name, never a path) next to `engine`; main resolves it among
   the chosen engine's detected paths by basename and refuses an undetected name.
3. **The chips (D3, renderer + flow).** `EngineSection` lists one chip per detected client; an
   engine with several builds gets one chip per build, labelled `Q2PRO · q2pro64.exe`. The section
   shows whenever the folder holds two or more clients. Fixture + flow extended, CHANGELOG line.
4. **Update/repair in place (D4).** `buildAssemblePlan` takes an optional `engineExecutable`
   (validated against the engine's `executables`) that replaces the engine entry's `to`;
   `engineAllowlistFor` and the repair step pass the installation's executable basename.
5. Docs: ARCHITECTURE "The installation domain" (D2), `docs/systems/install-module.md` (D4).

Order D1 → D2 → D3 → D4. AC4's demo-play eligibility and config limits key only on `engineKind`
(`src/shared/replays/demo-play.ts:140`, `src/shared/config/syntax/engine-limits.ts`), so D1 delivers
them; the bleeding-edge update is D4.

## Deliverables

- [ ] **D1 — `q2pro64.exe` is a Q2PRO client, and the default when both builds are present.**
      Files: `src/shared/types/engine.ts` (q2pro `executables: ['q2pro64.exe', 'q2pro.exe', 'q2pro']`,
      `markers` add `'q2pro64.exe'`; `DetectedEngine.executablePaths: string[]` — every client of the
      engine found in the root, table order, `executablePath === executablePaths[0]`);
      `src/main/services/inspector.ts` (`detectEngines` :114 — collect every matching name of a
      definition into `executablePaths` instead of `break`ing after the first; the shared-name
      crediting logic stays per name); `src/main/lib/schemas.ts:77` (`executablePaths` optional in
      the persisted `detectedEngines` item — records written before this story lack it; every reader
      falls back to `[executablePath]`); `src/main/services/installations.ts` (`engineOwning` :738
      compares `pathKey` against every entry of `executablePaths ?? [executablePath]`);
      `src/main/modules/downloads/bootstrap/assemble.ts:224` (`engineTarget` becomes the literal
      `'q2pro.exe'` with a one-line why: bootstrap output is unchanged, the table order is now the
      detection preference). Tests: `src/main/services/inspector.test.ts` › "a folder whose only
      client is q2pro64.exe is detected as Q2PRO" and › "a folder with q2pro.exe and q2pro64.exe is
      one Q2PRO engine that prefers q2pro64.exe"; `src/main/services/installations.test.ts` ›
      "adding and revalidating a q2pro64.exe-only folder records engine q2pro and executable
      q2pro64.exe" and › "a stored q2pro.exe beside q2pro64.exe keeps the Q2PRO badge after
      revalidation". The existing `assemble.test.ts` stays green unchanged (bootstrap still writes
      `q2pro.exe`).
- [ ] **D2 — main resolves a chosen build of an engine.** Files:
      `src/shared/types/installation.ts` (`UpdateInstallationInput.engineExecutable?: string` — doc:
      a file name among the chosen engine's detected clients, only meaningful with `engine`);
      `src/shared/ipc-schemas.ts` (`updateInstallationInputSchema`: `engineExecutable` a single file
      name, same `/^[A-Za-z0-9_.-]+$/` shape and `max(64)` as `activeGameDir`);
      `src/main/services/installations.ts` `update()` (:290 — with `engineExecutable`, pick the entry
      of `chosenEngine.executablePaths ?? [chosenEngine.executablePath]` whose basename equals it
      case-insensitively; none → `fail('installations.error.executableNotDetected', { executable })`;
      without it, keep today's `chosenEngine.executablePath`);
      `src/renderer/src/i18n/locales/en.shell.json` (`installations.error.executableNotDetected`:
      "{{executable}} was not found in this installation's folder." — beside `engineNotDetected`);
      `docs/ARCHITECTURE.md` § "The installation domain" (one sentence: the renderer may add a
      detected file name to pick one build of an engine; main resolves it from its own detection).
      Tests: `src/main/services/installations.test.ts` › "choosing q2pro.exe of a two-build Q2PRO
      folder makes it the launched executable" and › "a build name that was not detected is
      refused".
- [ ] **D3 — the library card lets the user pick the build.** Files:
      `src/renderer/src/components/installations/EngineSection.tsx` (choices = one per detected
      client: for each `detectedEngines` entry, one chip per `executablePaths ?? [executablePath]`;
      label `engineLabel(kind)` alone when the engine has one client, `Q2PRO · q2pro64.exe` (label +
      basename) when it has several; selected = same kind **and** same basename as
      `installation.executablePath` (kind alone for single-build engines); a click sends
      `{ id, engine, engineExecutable: basename }` for a multi-build engine, `{ id, engine }`
      otherwise; testid `installation-engine-option-<kind>` for single-build engines (unchanged),
      `installation-engine-option-<kind>-<basename>` per build; render when the total client count is
      ≥ 2 or in the existing missing-choice case); `scripts/lib/fixture/engine-choice.mjs` (two more
      records written without `detectedEngines` and without `executablePath`:
      `fixture-engine-choice-q2pro64` "Fixture Q2PRO 64" holding only `q2pro64.exe`, and
      `fixture-engine-choice-two-builds` "Fixture Two Builds" holding `q2pro.exe` + `q2pro64.exe`;
      the literal `q2pro64.exe` name on every platform, written like the file's other engines);
      `scripts/flows/installation-engine-choice.mjs` (three steps below; update its header comment);
      `CHANGELOG.md` (one `### Added` line under Unreleased, e.g. "Q2PRO's 64-bit `q2pro64.exe` is
      recognised — pick which build Play starts."). Flow steps, reusing the file's own
      `rowOf`/`waitForText`/`waitForChecked`: "a q2pro64.exe-only folder is Q2PRO and its command
      names q2pro64.exe" (`engine-badge` matches /q2pro/i, `installation-runner-preview` contains
      `q2pro64.exe`); "both Q2PRO builds are listed with q2pro64.exe checked" (both
      `installation-engine-option-q2pro-<basename>` chips visible, the `q2pro64.exe` one
      `aria-checked="true"`); "choosing q2pro.exe moves the command to it" (click the `q2pro.exe`
      chip; it becomes checked; the preview contains `q2pro.exe` and not `q2pro64.exe`).
- [ ] **D4 — engine update and repair replace the build the installation launches.** Files:
      `src/main/modules/downloads/bootstrap/assemble.ts` (`BuildAssemblePlanInput.engineExecutable?:
      string`; `buildQ2proEngineEntries`/`buildR1q2EngineEntries` use it as the engine entry's `to`
      only when it equals, case-insensitively, one of that definition's `executables`, else the
      default — never a path, never an unknown name; `assembleInstallation` forwards it);
      `src/main/modules/downloads/engine/update-job.ts` (`engineAllowlistFor(engine,
      engineExecutable?)`; the call at :368 passes `basename(installation.executablePath)` when set);
      `src/main/modules/downloads/repair/job.ts` (the `assembleInstallation` call at :392 for an
      engine step passes the same basename); `docs/systems/install-module.md` (one line: update and
      repair overwrite the executable the installation launches, in place). Tests:
      `src/main/modules/downloads/engine/update-job.test.ts` › "updating a q2pro64.exe installation
      replaces q2pro64.exe in place"; `src/main/modules/downloads/repair/job.test.ts` › "reinstalling
      the engine of a q2pro64.exe installation writes q2pro64.exe";
      `src/main/modules/downloads/bootstrap/assemble.test.ts` › "an engine executable that is not a
      client of the engine falls back to the default target".

## Model Hints

- D1 → deliverable-hard: reordering the q2pro table moves `executables[0]`, which bootstrap,
  `rankExecutables` and `detectEngines` all read, and a multi-path `DetectedEngine` changes how
  `engineOwning`/`inspectedEngineKind` derive the badge for legacy records — a miss silently flips an
  existing installation's engine or the bootstrap's output name.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/services/inspector.test.ts` › "a folder whose only client is q2pro64.exe is
  detected as Q2PRO"; unit `src/main/services/installations.test.ts` › "adding and revalidating a
  q2pro64.exe-only folder records engine q2pro and executable q2pro64.exe"; e2e
  `scripts/flows/installation-engine-choice.mjs` › "a q2pro64.exe-only folder is Q2PRO and its
  command names q2pro64.exe" (rescan = startup revalidation of a record without `detectedEngines`).
- AC2 → e2e `scripts/flows/installation-engine-choice.mjs` › "a q2pro64.exe-only folder is Q2PRO and
  its command names q2pro64.exe" (the preview is main's launch plan for the spawn).
- AC3 → unit `src/main/services/inspector.test.ts` › "a folder with q2pro.exe and q2pro64.exe is one
  Q2PRO engine that prefers q2pro64.exe"; unit `src/main/services/installations.test.ts` › "choosing
  q2pro.exe of a two-build Q2PRO folder makes it the launched executable" and › "a build name that
  was not detected is refused"; e2e `scripts/flows/installation-engine-choice.mjs` › "both Q2PRO
  builds are listed with q2pro64.exe checked" and › "choosing q2pro.exe moves the command to it".
- AC4 → unit `src/main/services/installations.test.ts` › "a stored q2pro.exe beside q2pro64.exe keeps
  the Q2PRO badge after revalidation" (demo play and config limits key only on `engineKind`, which
  D1's AC1 tests pin to `q2pro`); unit `src/main/modules/downloads/engine/update-job.test.ts` ›
  "updating a q2pro64.exe installation replaces q2pro64.exe in place"; unit
  `src/main/modules/downloads/repair/job.test.ts` › "reinstalling the engine of a q2pro64.exe
  installation writes q2pro64.exe".

## Done

<Leave empty. Filled by `/build 273` after implementation:

- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
