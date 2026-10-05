---
id: 246
title: an installation with several engines lets me choose one
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player whose Quake II folder holds more than one engine (e.g. `r1q2.exe` and `q2pro.exe`), the
launcher shows every engine it found and lets me choose which one the installation starts.

User feedback 2026-10-04: a Quake installation can contain several engines; if several are detected
the user should be able to change the engine. One user's `q2pro.exe` was not recognised although it
was in the Quake folder.

Today (`src/main/services/inspector.ts`, `src/shared/types/engine.ts`):

- detection checks the root against an ordered table and **the first match wins** — `r1q2` comes
  before `q2pro`, so a folder with both is r1q2;
- an installation has exactly one `engineKind` and one `executablePath`; the path is only set when
  empty, so a `q2pro.exe` added later never replaces a stored `r1q2.exe`;
- there is no UI to choose the engine; only a "select executable" fix appears when a check fails.

That explains the report: q2pro.exe was present but shadowed by r1q2.

## Acceptance Criteria

- [ ] **AC1** — Detection reports every known engine whose executable is in the installation root,
      not only the first match.
- [ ] **AC2** — A folder with both `r1q2.exe` and `q2pro.exe` lists both engines on the installation.
- [ ] **AC3** — With more than one engine detected, the installation offers an engine choice (library
      card/installation settings); choosing one changes what Play starts, and the choice persists.
- [ ] **AC4** — The installation's engine badge, the config module's engine-specific settings and the
      launch arguments follow the chosen engine.
- [ ] **AC5** — An engine added to the folder later appears after the next revalidation; the user's
      choice is not changed by it.
- [ ] **AC6** — If the chosen engine's executable disappears, the installation reports it and offers
      the other detected engines, instead of silently switching.
- [ ] **AC7** — Unsupported engines (yquake2, kmquake2 …) are listed as detected but cannot be
      chosen; the reason shows as visible text.
- [ ] **AC8** — Existing installations keep their current engine after the update.

## Open Questions

- ~~**Q1** — Demo playback needs Q2PRO: when an installation has q2pro.exe but r1q2 is chosen, should
  demos still play with its Q2PRO? Recommendation: yes — playback uses the installation's Q2PRO if
  one is detected, and says so.~~ answered → Decisions (Sprint)
- ~~**Q2** — Config profiles are engine-specific (cvar defaults differ). Does switching the engine keep
  the active profile? To be decided in refine with the config module.~~ decided → Decisions (Sprint)
- ~~**Q3** — Default for a new installation with two engines: q2pro or r1q2? Recommendation: q2pro
  (needed for demos, the current recommendation in the bootstrap manifest).~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Playback with r1q2 chosen: uses the installation's Q2PRO if detected, and says so.
- **(User)** Default engine for a new installation with two engines: q2pro.
- Q2: switching the engine keeps the active profile and its assignments. Assignments are keyed by installation id, and the Settings tab re-derives its engine scope from `installation.engineKind` (`modules/config/lib/engine-scope.ts`), so the cvar facts follow the new engine without a config change.
- The chosen engine is stored as `executablePath`. Every inspection derives `engineKind` from the detected engine that owns that path, so there is one source of truth and an old "Choose executable…" pick of `q2pro.exe` also corrects the badge.
- The renderer chooses by engine **kind** (`installations:update` field `engine`). Main looks up the path in its own `detectedEngines`, because renderer paths are never trusted.
- An engine counts as detected when one of its client `executables` is in the root. Dedicated-server binaries are never listed, since they can never be what Play starts.
- An executable name that several definitions share (`quake2.exe`/`quake2`: yquake2, vanilla) is credited to one engine only: the first of those definitions whose markers match. A folder can't hold two engines in one file.
- Default pick (new installation, adoption of an empty `executablePath`): q2pro, then the first other supported engine in table order, then the first detected, then today's marker classification. This applies the user decision without reordering the detection table.
- The engine choice appears only when the card has something to choose: two or more detected engines, or a missing chosen engine with another engine detected. With one engine, the existing badge already says everything.
- A missing chosen engine with **no** other engine detected keeps today's behaviour (`engineKind` → `unknown`, `recordedEngineKind` untouched). Stories 077/093 rely on that, and there is nothing to switch to silently.
- An unsupported engine is a disabled chip with the visible reason "Not supported by the launcher yet". Main also refuses it (`installations.error.engineUnsupported`), so the rule does not live in the UI alone.
- The engine chips sit on the library card above the runner section and mirror `RunnerSection`'s radiogroup chips with reasons below the row. That makes a second copy, which is allowed; a third must extract the chip.
- Playback with Q2PRO from a non-q2pro installation uses a main-internal `LaunchInput.engine` override. It is not added to the `launch:start` payload schema, so the renderer cannot pick an executable for a normal Play.
- "Says so": the replays view's Play contribution carries the visible note "Plays with this installation's Q2PRO" through its existing `reason` slot, the action bar's note line.
- On Linux, a detected Q2PRO also makes `~/.q2pro` a demo/write dir (`effectiveWriteDirs`). Playback through that Q2PRO writes there, exactly as a q2pro installation does.
- There is no migration step. `detectedEngines` is additive and optional (`migrations.ts`' rule) and is filled by the startup revalidation. An existing record's `executablePath` is not touched, which is what keeps its engine (AC8).

## Plan

Model: `Installation.engineKind` + `executablePath` stay "the engine Play starts"; a new
`Installation.detectedEngines: DetectedEngine[]` (`{ kind, executablePath, supported }`) lists
everything the root holds. Choosing an engine writes `executablePath`; inspection derives
`engineKind` from it.

1. **Inspector** reports `ValidationResult.engines` (all detected engines) and picks the default
   engine (q2pro first); a missing chosen executable with other engines present gets fix
   `choose-engine` instead of `select-executable`.
2. **InstallationsService** persists `detectedEngines`, derives `engineKind` from the stored
   `executablePath` on every verdict, never switches a missing chosen engine, and accepts
   `update({ engine })` (resolved against its own `detectedEngines`, refusing unsupported /
   undetected). Contract-first: `UpdateInstallationInput.engine` + `updateInstallationInputSchema`.
3. **Library card** gets an Engine section (chips, unsupported reason as visible text, missing
   chosen engine marked); `ChecksList` handles `choose-engine` by focusing it. Badge, command
   preview and config scope follow automatically because they read `engineKind`/`launch:plan`.
4. **Launch** accepts a main-internal `engine` override: plan resolves that engine's detected
   executable and its `defaultArgs`.
5. **Replays**: eligibility accepts an installation whose detected engines include Q2PRO and
   returns `engine: 'q2pro'`; main demo-play passes it to launch; Linux write dirs follow.
6. **Replays view** says so in the action bar note.

Order D1 → D2 → D3, then D4 → D5 → D6. Files: `src/shared/types/{engine,installation,launch}.ts`,
`src/shared/ipc-schemas.ts`, `src/main/services/{inspector,installations,launch,launch-plan}.ts`,
`src/main/lib/schemas.ts`, `src/shared/replays/demo-play.ts`, `src/main/modules/replays/{demo-play,discovery}.ts`,
`src/renderer/src/components/installations/{EngineSection,ChecksList}.tsx`, `views/LibraryView.tsx`,
`modules/replays/ReplaysView.tsx`, fixture `scripts/lib/fixture/engine-choice.mjs`, two flows.

## Deliverables

- [ ] **D1 — the inspector reports every engine in the root.**
  `src/shared/types/engine.ts`: add `export interface DetectedEngine { kind: EngineKind; executablePath: string; supported: boolean }`
  and `export function defaultEngineKind(engines: readonly DetectedEngine[], classified: EngineKind): EngineKind`
  — `q2pro` if detected, else the first other `supported` engine in `ENGINE_DEFINITIONS` order, else
  `engines[0].kind`, else `classified`. `src/shared/types/installation.ts`: `ValidationResult.engines: DetectedEngine[]`
  (table order), `ValidationFix` gains `'choose-engine'`, `Installation.detectedEngines?: DetectedEngine[]`
  (doc: written by every inspection verdict, absent on records predating story 246).
  `src/main/services/inspector.ts`: new `detectEngines(rootPath, rootListing)` — for each definition,
  a client `executables` name present in the root (case-insensitive, real on-disk casing in the joined
  path, `looksExecutable` must pass) yields one entry; `dedicatedExecutables` never count; a name
  listed by several definitions (`quake2.exe`, `quake2`) is credited only to the first of them whose
  `markers` match (`classifyEngine`'s marker logic, reused not copied). `inspectInstallation` sets
  `engineKind = defaultEngineKind(engines, classified)` and ranks executables with that engine's
  definition (so `executables[0]` is `q2pro.exe` in a folder with both). The `executable` check for a
  missing `options.executablePath` keeps key `validation.executableMissing` but its fix becomes
  `'choose-engine'` when `engines` is non-empty (`'select-executable'` otherwise). The missing-root
  early return carries `engines: []`. Tests in `src/main/services/inspector.test.ts` (temp dirs, mirror
  the file's existing setup): "reports every known engine in the root" (r1q2 + q2pro + kmquake2),
  "a folder with r1q2 and q2pro defaults to q2pro", "a dedicated server binary is not an engine",
  "quake2.exe counts once", "a missing chosen executable with another engine offers choose-engine".
  Fix any existing inspector test that asserted r1q2 wins over q2pro, and say so in the D's report.

- [ ] **D2 — the installation stores detected engines, keeps the chosen one and lets the user change it.**
  `src/main/services/installations.ts` `applyInspectionResult`: always write
  `next.detectedEngines = result.engines`. Then decide `engineKind` in this order: (a) the stored
  `executablePath` equals (`pathKey` compare) a detected engine's path → `engineKind` = that kind;
  (b) the stored `executablePath` is set, not detected, and `result.engines` is non-empty → keep
  `installation.engineKind` (chosen engine missing: no silent switch); (c) otherwise today's logic
  unchanged (`custom` guard, story 077 `preserveKnownEngine`). Adoption of an empty `executablePath`
  prefers the detected engine whose kind equals `installation.engineKind`, else the entry for
  `result.engineKind`, else `result.executables[0]`. `addExisting()` also stores `detectedEngines`.
  `update()`: new `input.engine` (an `EngineKind`) — look it up in the live record's
  `detectedEngines`; absent → `fail('installations.error.engineNotDetected', { engine: engineLabel(kind) })`,
  `supported: false` → `fail('installations.error.engineUnsupported', { engine })`; otherwise it sets
  `userPatch.executablePath` to that entry's path and goes through the existing revalidate path.
  Contract: `UpdateInstallationInput.engine?: EngineKind` (`src/shared/types/installation.ts`),
  `engine: engineKindSchema.optional()` in `updateInstallationInputSchema` (`src/shared/ipc-schemas.ts`).
  Persisted: `src/main/lib/schemas.ts` `installationSchema.detectedEngines` = optional array of
  `{ kind: engineKindSchema, executablePath: string, supported: boolean }` with `.optional().catch(undefined)`
  (same additive convention as `executableKind`); add `'choose-engine'` to `checkSchema.fix`'s enum.
  i18n: the two error keys in `src/renderer/src/i18n/locales/en.shell.json` ("{{engine}} was not found in this installation's folder.",
  "{{engine}} is not supported by the launcher yet."). Docs: one paragraph in
  `docs/ARCHITECTURE.md` § The installation domain (detected engines vs. chosen engine, story 246).
  Tests in `src/main/services/installations.test.ts` (mirror its temp-root helpers):
  "a folder with r1q2 and q2pro lists both engines", "choosing q2pro changes executable and engine and survives a reload",
  "an engine added later appears and the choice stays", "a missing chosen engine is reported, not switched",
  "an unsupported engine cannot be chosen", "an engine not in the folder cannot be chosen",
  "an existing r1q2 installation keeps r1q2 when q2pro is present"; in `src/main/lib/schemas.persisted-state.test.ts`:
  "a record without detectedEngines still loads".

- [ ] **D3 — the library card offers the engine choice.**
  New `src/renderer/src/components/installations/EngineSection.tsx`, rendered in
  `src/renderer/src/views/LibraryView.tsx` directly above `<RunnerSection>`. Mirror `RunnerSection.tsx`'s
  structure: root `id={`installation-engine-${installation.id}`}`, `tabIndex={-1}`, `data-testid="installation-engine"`,
  `SectionLabel` "Engine", a `role="radiogroup"` row of chips (`role="radio"`, `aria-checked`,
  `data-testid={`installation-engine-option-${kind}`}`, label `engineLabel(kind)`), reasons as visible
  text below the row linked via `aria-describedby` (`data-testid={`installation-engine-reason-${kind}`}`).
  Chips = `installation.detectedEngines`, plus the chosen `engineKind` when it is not among them
  (selected, disabled, reason "{{executable}} is missing from the folder" with the basename of `executablePath`).
  Unsupported engines are disabled with reason "Not supported by the launcher yet". Selecting calls
  `updateInstallation({ id, engine: kind })` from `useLauncher`. Render nothing unless there are ≥ 2 detected
  engines or the chosen one is missing while another is detected. `ChecksList.tsx` `useFixAction`: case
  `'choose-engine'` scrolls to and focuses `installation-engine-${id}` (copy the `choose-runner` case),
  plus the fix label `"choose-engine": "Choose engine…"`. i18n in `en.shell.json` under `installation.engine.*`;
  refresh the bundle snapshot. CHANGELOG `## Unreleased`: "A folder with several engines lists them all; choose which one Play starts."
  Fixture: new `scripts/lib/fixture/engine-choice.mjs` (mirror `replays-play.mjs`'s writer shape), registered as
  variant `engine-choice` in `scripts/lib/fixture.mjs`. Two installations, executables written per platform
  (`.exe` on win32, bare name + `#!/bin/sh\nexit 0\n` + chmod 755 elsewhere), `baseq2/pak0.pak` present, records
  written **without** `detectedEngines`: `fixture-engine-choice-two` "Fixture Two Engines" (active; root holds
  r1q2, q2pro, kmquake2; stored `engineKind: 'r1q2'`, `executablePath` = its r1q2 executable) and
  `fixture-engine-choice-missing` "Fixture Missing Engine" (root holds q2pro only; stored `r1q2` + a path to an
  absent r1q2 executable). Flow `scripts/flows/installation-engine-choice.mjs` (`export const variant = 'engine-choice'`)
  — see Acceptance Tests for its steps. Unit test `src/renderer/src/modules/config/lib/engine-scope.test.ts`:
  "a profile follows its installation's chosen engine".

- [ ] **D4 — launch can start a detected engine other than the chosen one.**
  `src/shared/types/launch.ts`: `LaunchInput.engine?: EngineKind` (doc: main-internal, set by demo playback
  only; `launch:start`'s payload schema in `src/shared/ipc-schemas.ts` stays unchanged). `src/main/services/launch.ts`
  `plan()`: with `input.engine` set and different from `installation.engineKind`, use the `executablePath` of
  `installation.detectedEngines` entry of that kind (absent → `fail('launch.error.engineNotDetected', { engine: engineLabel(kind) })`,
  key added to `en.shell.json`) for the existence check, the runner wrap and the plan. `src/main/services/launch-plan.ts`
  `buildLaunchArgs`: take the engine for `defaultArgs` from `input.engine ?? installation.engineKind`. Tests:
  `src/main/services/launch-plan.test.ts` › "an engine override uses that engine's default args";
  `src/main/services/launch.test.ts` › "an engine override starts the detected executable" and
  "an override for an engine that is not detected is refused".

- [ ] **D5 — demos play with the installation's Q2PRO when another engine is chosen.**
  `src/shared/replays/demo-play.ts`: an installation is Q2PRO-capable when `engineKind === 'q2pro'` or its
  `detectedEngines` holds a supported `q2pro`. Use it for the Linux check and the active check (widen the `Pick` by
  `'detectedEngines'`). On success, add `engine: 'q2pro'` to the result exactly when the active installation's `engineKind`
  is not `q2pro`. `src/main/modules/replays/demo-play.ts`: pass `eligibility.engine` into the launch input as
  `engine` (both the in-place and the staged path). `src/main/modules/replays/discovery.ts` `effectiveWriteDirs`: a detected
  supported q2pro counts like `engineKind === 'q2pro'` (add `'detectedEngines'` to `DiscoverableInstallation`).
  Update `docs/systems/replays-module.md` (playback engine paragraph). Tests: `src/shared/replays/demo-play.test.ts` ›
  "an r1q2 installation with a detected Q2PRO plays with Q2PRO" and "an r1q2 installation without Q2PRO is refused";
  `src/main/modules/replays/demo-play.test.ts` › "playback passes the q2pro engine override to launch".

- [ ] **D6 — the replays view says the demo plays with Q2PRO.**
  `src/renderer/src/modules/replays/ReplaysView.tsx` `viewAction`: when `eligibility.ok && eligibility.engine === 'q2pro'`,
  set `reason: { key: 'replays.play.withInstallationQ2pro' }` (shown by the action bar's note line as
  `data-testid="actionbar-action-reason"`); add the key ("Plays with this installation's Q2PRO.") next to
  `replays.play.unavailable.*` in the replays locale. Extend `scripts/lib/fixture/engine-choice.mjs`: copy
  `docs/fixtures/demos/test.dm2` to `baseq2/demos/engine-choice.dm2` of "Fixture Two Engines". Flow
  `scripts/flows/replays-play-detected-q2pro.mjs` (`variant = 'engine-choice'`).

## Model Hints

- D2 → deliverable-hard: `applyInspectionResult` runs over every installation at every startup. Its new "engine follows `executablePath`, a missing chosen engine is kept" branches sit on top of story 077's `preserveKnownEngine`, story 093's `recordedEngineKind` and the `custom` guard, so one wrong branch silently rebadges or re-routes existing installations (AC6/AC8).
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/services/inspector.test.ts` › "reports every known engine in the root"
  (+ "a dedicated server binary is not an engine", "quake2.exe counts once")
- AC2 → unit `src/main/services/installations.test.ts` › "a folder with r1q2 and q2pro lists both engines";
  e2e `scripts/flows/installation-engine-choice.mjs` › `installation-engine-choice` — "Fixture Two Engines" shows
  chips R1Q2 and Q2PRO.
- AC3 → e2e `scripts/flows/installation-engine-choice.mjs` › `installation-engine-choice` — R1Q2 chip checked first;
  clicking Q2PRO checks it and `installation-runner-preview` now names the q2pro executable; persistence → unit
  `src/main/services/installations.test.ts` › "choosing q2pro changes executable and engine and survives a reload".
- AC4 → e2e `installation-engine-choice` — after the switch the card's `engine-badge` reads Q2PRO and the preview no
  longer contains `-nopathcheck`; unit `src/main/services/launch-plan.test.ts` › "an engine override uses that engine's
  default args"; config → unit `src/renderer/src/modules/config/lib/engine-scope.test.ts` › "a profile follows its
  installation's chosen engine".
- AC5 → unit `src/main/services/installations.test.ts` › "an engine added later appears and the choice stays".
- AC6 → unit `src/main/services/installations.test.ts` › "a missing chosen engine is reported, not switched" and
  `src/main/services/inspector.test.ts` › "a missing chosen executable with another engine offers choose-engine";
  e2e `installation-engine-choice` — "Fixture Missing Engine" still badges R1Q2, its checks show the missing-executable
  message with "Choose engine…", pressing it focuses `installation-engine`, choosing Q2PRO clears the check.
- AC7 → e2e `installation-engine-choice` — `installation-engine-option-kmquake2` is disabled and
  `installation-engine-reason-kmquake2` is visible text; unit `src/main/services/installations.test.ts` › "an unsupported
  engine cannot be chosen".
- AC8 → unit `src/main/services/installations.test.ts` › "an existing r1q2 installation keeps r1q2 when q2pro is present",
  `src/main/lib/schemas.persisted-state.test.ts` › "a record without detectedEngines still loads"; e2e
  `installation-engine-choice` — the legacy-shaped "Fixture Two Engines" record shows R1Q2 checked after startup.
- Decision (User) playback → unit `src/shared/replays/demo-play.test.ts` › "an r1q2 installation with a detected Q2PRO
  plays with Q2PRO", `src/main/modules/replays/demo-play.test.ts` › "playback passes the q2pro engine override to launch",
  `src/main/services/launch.test.ts` › "an engine override starts the detected executable"; e2e
  `scripts/flows/replays-play-detected-q2pro.mjs` › `replays-play-detected-q2pro` — selecting `engine-choice.dm2` on the
  Demos tab shows `actionbar-action-reason` "Plays with this installation's Q2PRO." with View enabled.

## Done
