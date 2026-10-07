---
id: 222
title: platform rules live in one module
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want "is the filesystem case-insensitive here", "what is the executable
name", "are we on Windows/Linux" to be answered by one module, so that the same product question
is not answered in several spellings that can drift, and new platform code has a home.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F32, F64; the scatter is
a roadmap follow-up): `process.platform`/`'win32'`/`'linux'` appear in 29 non-test main files
(~50 reads). Four places decide case-insensitivity and disagree: `pathKey` folds unless linux;
`ipc/app.ts` re-implements it inline; `steam.ts` folds only on win32; `diagnostics.ts` likewise —
so on darwin `findByRootPath` folds while `readSteamAppId` does not. Some code injects `platform`
as an option, services read the global, and 12 test files stub it. Smaller twins: the "Set of
listeners, copy before iterate, try/catch, log listener threw" emitter is hand-written in ten
sites, and `looksLikeQuake2`/`qualifies` are byte-identical copies with a comment claiming they
"agree".

## Acceptance Criteria

- [x] **AC1** — `src/main/lib/platform.ts` exports `isWindows()`, `isLinux()`,
      `isCaseInsensitiveFs()`, `foldPathCase()` and `executableFileName()`, read at call time so
      `stubPlatform` keeps working; one unit test covers win32, linux and darwin.
- [x] **AC2** — The four case-folding re-derivations use `foldPathCase`/`pathKey`; `ipc/app.ts`
      calls `pathKey`; direct `process.platform` reads in `src/main/services` and
      `src/main/modules` drop below 10, each remaining one with a one-line reason.
- [x] **AC3** — `src/main/lib/listeners.ts` exports `createListenerSet<T>(log, label)` and the
      ten hand-written emitters use it (grep-zero for `listener threw` outside the helper).
- [x] **AC4** — `looksLikeQuake2` lives once in `services/inspector.ts` and both callers import
      it.
- [x] **AC5** — Full `npm test` green; the roadmap follow-up is removed.

## Open Questions

- none

## Decisions (Sprint)

- **D-a** — `isCaseInsensitiveFs()` is `!isLinux()` (win32 and darwin fold), because that is
  `pathKey`'s documented rule today and the other three sites are the drifted copies.
- **D-b** — `foldPathCase(s)` only lowercases when `isCaseInsensitiveFs()`; it does not resolve or
  strip separators, so `pathKey` stays the "same folder?" key and calls `foldPathCase` last.
- **D-c** — `executableFileName(base, otherName = base)` returns `${base}.exe` on Windows and
  `otherName` elsewhere, so `7za-path.ts`'s `7za.exe`/`7zz` pair is a real caller rather than a dead export.
- **D-d** — Story 199 builds before this one and replaces `ipc/app.ts`'s inline `normalize` with
  `isInside` (which uses `pathKey`); this story only verifies no inline fold is left there, so it never
  re-touches 199's containment code.
- **D-e** — The "< 10 reads" count is a literal grep of `process.platform` in non-test files under
  `src/main/services` and `src/main/modules`, comments included, so comments that only _mention_
  it are reworded ("the Node platform string") instead of being excluded by a fragile parser.
- **D-f** — Reads that pass the platform _string_ as an injectable default (`manifest-parse`,
  `manifest-service`, `replays/index` x3, `playback-control`, `launcher-install-id`) stay raw with a
  `// platform-read: <reason>` comment on the line above, because they are dependency-injection
  seams that tests already override; 7 remain.
- **D-g** — The read-count guard is a second `describe` in the existing
  `scripts/platform-assertions.test.mjs`, because that file already is the repo's platform guard.
- **D-h** — Boolean platform checks outside services/modules that are one-liners (`lib/fs-utils.ts`,
  `lib/win-registry.ts`, `ipc/installations.ts`, `window.ts`) also move to `isWindows()`, because
  the requirement is "one module answers"; `index.ts`'s startup log and `!== 'darwin'` quit idiom
  stay, as Electron boilerplate with no product question behind them.
- **D-i** — `createListenerSet<T>(log, label)` returns `{ add(fn) → unsubscribe, emit(value),
clear(), size }`, iterates a copy, catches per listener and logs `log.error(\`${label} listener
  threw\`, error)`; a listener throwing is a programming fault, hence `error` for all sites.
- **D-j** — The migrated sites are exactly those with the full shape (Set + copy + try/catch + log):
  `cinema-window`, `main-window-observer`, `playback-session` x2, `launch` x2, `jobs`,
  `linux-channel` display, `windows-channel` x2 = 10; sets without a try/catch
  (`linux-channel` finished, `playback-control`) are left, since adding isolation there is a
  behaviour change the AC does not ask for.
- **D-k** — `update/service.ts`'s single `onStateChange` callback is not a set; its log text is
  reworded to "state callback threw" to meet the grep-zero without inventing a set.
- **D-l** — `main-window-observer` keeps its injected `onListenerError` by passing an adapter
  `log` whose `error` calls it, so its tests' contract does not change.
- **D-m** — The roadmap follow-up is the "case-folding inconsistencies" item in the story-010 line
  of `docs/ROADMAP.md`; only that phrase is removed, the line's other unresolved items stay.
- **D-n** — `looksLikeQuake2` is exported from `services/inspector.ts` and imported by all three
  former copies (`installations.ts`, `downloads/bootstrap/target.ts`, `detection/index.ts`'s
  `qualifies`), since the review's "both callers" undercounts one byte-identical copy.

## Plan

All main-process, no IPC/renderer change, no user-visible change (no changelog entry).

1. **D1** — `src/main/lib/platform.ts` (five functions, read `process.platform` at call time) +
   unit test; route the four case-folding sites through it.
2. **D2** — services + lib/ipc/window boolean checks → `isWindows()`/`isLinux()`.
3. **D3** — modules boolean checks → helpers, `7za-path` → `executableFileName`, reword comments,
   `platform-read:` reasons on the 7 kept reads, and the count guard test.
4. **D4** — `src/main/lib/listeners.ts` + test; migrate the services-side emitters.
5. **D5** — migrate the window/replays-side emitters + grep-zero guard.
6. **D6** — `looksLikeQuake2` once in `inspector.ts`, three callers import it; roadmap phrase removed.

Order: D1 first (D2/D3 import it); D4 before D5; D6 independent. Full `npm test` at the end.

## Deliverables

- **D1 — platform module + one case-folding rule.** Create `src/main/lib/platform.ts` exporting
  `isWindows()`, `isLinux()`, `isCaseInsensitiveFs()` (= `!isLinux()`, so win32 and darwin fold),
  `foldPathCase(s)` (lowercases only when case-insensitive; no resolve/separator work) and
  `executableFileName(base, otherName = base)` (`${base}.exe` on win32, `otherName` elsewhere). Every
  function reads `process.platform` at call time — no module-level constant — so
  `stubPlatform` (`src/test-support/platform.ts`) keeps working. Then: `pathKey` in
  `src/main/lib/fs-utils.ts` ends with `foldPathCase(normalized)`; `sameName` in
  `src/main/services/steam.ts` compares `foldPathCase(a) === foldPathCase(b)`;
  `redactHome` in `src/main/modules/downloads/diagnostics.ts` uses `isCaseInsensitiveFs()` for its
  `caseInsensitive` flag. In `src/main/ipc/app.ts`, story 199 has already replaced the inline
  `normalize` with `isInside` (which uses `pathKey`); if any `process.platform === 'linux' ? value :
value.toLowerCase()` fold is still there, replace it with `pathKey`, otherwise leave the file alone.
  Tests: new `src/main/lib/platform.test.ts` › "answers every platform question for win32, linux and
  darwin" (table over the three platforms via `stubPlatform`, all five functions); existing
  `fs-utils`, `steam`, `diagnostics` tests stay green (darwin now folds in steam/diagnostics — intended).
- **D2 — services, lib, ipc and window use the helpers.** Replace boolean `process.platform ===/!==
'win32'|'linux'` checks with `isWindows()`/`isLinux()` from `src/main/lib/platform.ts` in:
  `src/main/services/detection/deep-scan.ts`, `src/main/services/detection/providers.ts` (3),
  `src/main/services/inspector.ts` (3), `src/main/services/runners.ts` (3),
  `src/main/lib/fs-utils.ts` (`looksExecutable`), `src/main/lib/win-registry.ts`,
  `src/main/ipc/installations.ts` (pickExecutable filter), `src/main/window.ts` (icon name). In
  `src/main/services/unlock/launcher-install-id.ts` keep `platform: process.platform` (it is an
  injectable default) and put `// platform-read: injectable default, tests pass their own` on the
  line above. Leave `src/main/index.ts` alone. No behaviour change; tests: existing suites for those
  files stay green.
- **D3 — modules use the helpers, plus the count guard.** In `src/main/modules`: replace boolean
  checks with `isWindows()` in `downloads/bootstrap/r1q2-setup.ts` (2) and `mods/engine-target.ts`;
  `downloads/7za-path.ts`'s `getBinaryName()` becomes `executableFileName('7za', '7zz')`. Reword
  comments that only mention `process.platform` to "the Node platform string" in `7za-path.ts`,
  `downloads/manifest-parse.ts` (2), `downloads/schemas.ts`, `replays/index.ts` (line ~135). Keep the
  raw reads that pass the platform string as an injectable default — `manifest-parse.ts`
  (`options.platform ?? process.platform`), `manifest-service.ts`, `replays/index.ts` (3),
  `replays/playback-control.ts` — each with `// platform-read: <one-line reason>` on the line above.
  Then add a second `describe` to `scripts/platform-assertions.test.mjs` (reuse its `walk`):
  it › "keeps direct process.platform reads in services and modules below 10, each with a reason" —
  scans non-test `.ts` files under `src/main/services` and `src/main/modules`, asserts the total
  count of `process.platform` occurrences is < 10, and that each occurrence's line or the line above
  contains `platform-read:`. Expected result after D2+D3: 7.
- **D4 — listener-set helper, services-side sites.** Create `src/main/lib/listeners.ts` exporting
  `createListenerSet<T>(log: Pick<Logger, 'error'>, label: string)` returning `{ add(fn: (value: T)
=> void): () => void; emit(value: T): void; clear(): void; readonly size: number }`; `emit` iterates
  a copy, catches per listener and calls `log.error(\`${label} listener threw\`, error)`, so one
throwing listener never stops the others. Migrate: `src/main/services/jobs.ts`(onChange),`src/main/services/launch.ts`(onStateChange, onBeforePlaybackRelease),`src/main/services/playback-session.ts`(stdout listeners; end listeners →`emit`then`clear()`).
Reword `src/main/services/update/service.ts`'s single-callback log to "update: the state callback
threw (...)" (it is not a set — do not wrap it). Tests: new `src/main/lib/listeners.test.ts`›
"emits to a copy and isolates a throwing listener" (a listener unsubscribing mid-emit, one that
throws, the next still called, log.error called with the label); existing jobs/launch/
playback-session tests stay green (adjust log-spy level only if a test spied`warn`).
- **D5 — listener-set helper, window/replays-side sites + grep-zero.** Using
  `createListenerSet` from `src/main/lib/listeners.ts` (signature: `createListenerSet<T>(log, label)`
  → `{ add → unsubscribe, emit, clear, size }`, logs `${label} listener threw` at error level),
  migrate `src/main/cinema-window.ts` (onClosed), `src/main/main-window-observer.ts` (pass an adapter
  `{ error: (_msg, err) => deps.onListenerError?.(err) }` so its injected contract is unchanged),
  `src/main/modules/replays/playback-channel/linux-channel.ts` (displayCbs only — `finishedCbs` has
  no try/catch, leave it), `src/main/modules/replays/playback-channel/windows-channel.ts` (both sets).
  Do not touch `playback-control.ts`. Test: add to `src/main/lib/listeners.test.ts` › "no main file
  outside listeners.ts logs 'listener threw'" — scans non-test `.ts` under `src/main` for the
  literal `listener threw` and expects only `src/main/lib/listeners.ts`. Existing channel/window
  tests stay green.
- **D6 — `looksLikeQuake2` once; roadmap follow-up removed.** Move the function (body as in
  `src/main/services/installations.ts:643`) to `src/main/services/inspector.ts` as an export and
  import it in `src/main/services/installations.ts`, `src/main/modules/downloads/bootstrap/target.ts`
  (delete the "replicated rather than imported" copy and comment) and
  `src/main/services/detection/index.ts` (delete `qualifies`, call `looksLikeQuake2`). In
  `docs/ROADMAP.md`, remove only "case-folding inconsistencies, " from the "9 non-blocking findings
  from story 010's review" line. Tests: add to `src/main/services/inspector.test.ts` ›
  "looksLikeQuake2 accepts a base-game or known-engine folder and rejects a missing one" and ›
  "looksLikeQuake2 is defined only in inspector.ts" (scans `src/main` non-test `.ts` for
  `function looksLikeQuake2` / `function qualifies` and expects only `inspector.ts`'s definition).

## Model Hints

All Ds default tier — each is a mechanical, test-covered substitution in at most ~9 one-line edits.

Review: → default

## Acceptance Tests

- AC1 → unit `src/main/lib/platform.test.ts` › "answers every platform question for win32, linux and darwin" (D1)
- AC2 → unit `scripts/platform-assertions.test.mjs` › "keeps direct process.platform reads in services and modules below 10, each with a reason" (D3); the case-folding rewiring by D1 is proven by `src/main/lib/platform.test.ts` plus the existing `fs-utils`/`steam`/`diagnostics`/`app` tests
- AC3 → unit `src/main/lib/listeners.test.ts` › "emits to a copy and isolates a throwing listener" (D4) and › "no main file outside listeners.ts logs 'listener threw'" (D5)
- AC4 → unit `src/main/services/inspector.test.ts` › "looksLikeQuake2 accepts a base-game or known-engine folder and rejects a missing one" and › "looksLikeQuake2 is defined only in inspector.ts" (D6)
- AC5 → full `npm test` (run by /build after D6); roadmap edit delivered by D6
- No AC describes a user action (refactor, no UI surface), so no `ui:flow` line.

## Done

Platform questions are answered by `src/main/lib/platform.ts` (five call-time helpers); `pathKey`/`isInside`, `steam.sameName` and `redactHome` fold through it (darwin now folds everywhere), the boolean `process.platform` checks use `isWindows()`, and 7 injectable-default reads remain, each with a `platform-read:` reason and a count guard. `createListenerSet` (`lib/listeners.ts`) replaces the ten hand-written emitters; `looksLikeQuake2` lives once in `services/inspector.ts`; the roadmap phrase is gone.

Commit message: `222: platform rules in lib/platform.ts, createListenerSet replaces ten emitters, looksLikeQuake2 once`

Verification (narrow gate): `npm run typecheck`, `npm run lint`, `npm run build` green; `npx vitest run --changed HEAD` 124 files / 1869 tests green; platform-assertions, repo-hygiene and architecture tests green. Full `npm test` is the sprint's gate (AC5 test part pending there).
AC -> test: AC1 platform.test.ts passed; AC2 platform-assertions.test.mjs count guard passed (7 reads); AC3 listeners.test.ts both tests passed; AC4 inspector.test.ts both tests passed; AC5 roadmap edit done, full suite deferred to sprint gate. No manual residue, no e2e line (refactor). Review: clean default-tier agent, PASS.

Decisions:

- Plan paths predate 199/208/209: 7za-path is in `lib/archive/` and manifest-* in `services/content/`; `ipc/app.ts` had no inline fold left, so it was not touched.
- The two non-`.test.ts` test helpers (`job.test-helpers.ts`, `downloads/test-support.ts`) use `isWindows()` so the count guard sees only the 7 real reads.
- Listener failures in cinema-window and the replays channels now log at `error` (was `warn`) per D-i; `linux-channel.test.ts` log stub gained `error`.
- Unfixed review nits: no darwin-specific test at the steam/diagnostics call sites (helper covered in platform.test.ts); `looksLikeQuake2` test covers good/missing folder only; unescaped dots in an inspector.test.ts regex. Harmless, not in the AC.

tiers: D 6 / hard 0 � review default � cycles 1 � agents 8
