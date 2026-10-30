---
id: 325
title: Tests and comments state what they check
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-013, TD-014, TD-028, TD-031 and TD-033 are test and comment hygiene: story numbers
in `describe` titles, `as never` casts, a regex that matches comments, missing edge-case tests,
comments that point at a removed locale mirror, bare catches outside the error policy, invariant
notes lost in a comment sweep.

## Acceptance Criteria

- [x] **AC1** — No `describe` title contains a story number; client mocks have no `as never` cast;
      the handler-reference check ignores comments (TD-013).
- [x] **AC2** — Tests exist for darwin at the steam and diagnostics call sites, for `looksLikeQuake2`
      positive and negative cases, and for `isInside` with swapped arguments at its four call sites
      (TD-014).
- [x] **AC3** — No comment says `mirrors locales/en.json` or names an i18n key that does not exist
      (TD-028).
- [x] **AC4** — Every bare `catch` in `src/main` names the failure class it swallows or calls
      `log.caught`; a check fails on a new bare catch (TD-031).
- [x] **AC5** — The invariant notes on `ImportPreviewResult` and `RefreshedProfileResult` in
      `shared/modules/config.ts` are back (TD-033).
- [x] **AC6** — Rows TD-013, TD-014, TD-028, TD-031 and TD-033 are removed from `docs/TECH-DEBT.md`.

## Open Questions

## Decisions (Sprint)

- **DS-1** AC1 covers `describe` titles only (215 titles in 111 files); the 245 `it` titles with ids
  stay out, because the AC names `describe` and the `it` sweep would double an already mechanical
  diff.
- **DS-2** A story number in a title is `stor(y|ies)[ -]?\d+`, a zero-padded `\b0\d{2}\b`
  (`pre-042`, `every 042 fixture`) or a deliverable/criterion id (`D3`, `AC8`), because those are
  the three shapes the titles carry today.
- **DS-3** "Client mocks" are the override object of every `mockClient(…)` call in renderer tests
  plus the two `client.test.ts` files that call the client with a cast payload, because those are
  the casts the S32 review named (story 225 `mockClient`).
- **DS-4** "The handler-reference check" is `src/renderer/src/modules/handler-coverage.test.ts`
  › "every handler constant is referenced by its module's client"; it matches against
  `stripComments(source)`, because a handler named only in a comment is not live.
- **DS-5** The four `isInside` call sites are the ones story 199 migrated without a per-site
  swapped-order test: `downloads/bootstrap/target.ts`, `mods/install-job.ts`, `mods/remove.ts`,
  `mods/update-job.ts`; `ipc/app.ts` already has its parent-refusal test.
- **DS-6** A swapped-argument test is a case only the `(root, target)` order passes: a path that is
  the root's _parent_ (or a sibling holding the root) is refused while a real child is accepted,
  because a swapped call passes every child-only test.
- **DS-7** The darwin tests stub `process.platform` with `stubPlatform('darwin')` and assert the
  call site folds case (`readSteamAppId`, `redactHome`), because darwin folds since story 222 and
  only `platform.test.ts` proves it.
- **DS-8** `looksLikeQuake2` is tested on built `ValidationResult`s, one case per branch (missing,
  base-dir error + unknown engine, base-dir error + known engine, no base-dir error), because the
  existing test reaches only two branches through the filesystem.
- **DS-9** AC3's check: no file under `src/` or `scripts/` contains `i18n/locales/en.json` (the file
  no longer exists), and a backticked dotted token in a comment whose first segment is a top-level
  key of `en` (`src/renderer/src/i18n/bundle.ts`) must resolve in `en` (`x.*` = subtree exists);
  tokens ending in a file extension are not keys. False positives are fixed in the matcher, never
  allowlisted, because an allowlist would carry exactly the stale keys the check exists for.
- **DS-10** A bare `catch` is a `catch` clause (not a promise `.catch(…)`) in a non-test `.ts` file
  under `src/main` that has no binding or never reads it, carries no comment on the `catch` line or
  the block's first line, and does not call `.caught(`; promise `.catch` handlers stay out, because
  TD-031's ~114 and the ARCHITECTURE.md rule are about the clause.
- **DS-11** A comment that only says `ignore`, `ignored`, `swallow`, `best effort`, `noop` or
  `nothing to do` does not name a failure class and fails the check, because otherwise the sweep
  can satisfy the guard without naming anything.
- **DS-12** The bare-catch check ships first with a per-file count baseline that may only shrink;
  the three sweep deliverables empty it and the last one deletes it, so each sweep proves itself
  with the same check.
- **DS-13** The check is a text scanner over `commentRanges` from `src/test-support/source-tree.ts`
  with its own fixture tests, because the repo's TypeScript 7 (native) ships no JS compiler API.
- **DS-14** AC5 is proven by a test pinning one phrase per restored note, because TD-033 records
  that the comment guard cannot see invariant loss and a phrase pin is the cheapest observable
  proof.
- **DS-15** Each deliverable removes its own TD row (AC6); the removal is proven by the existing
  register shape test staying green and by the diff review, not by an absence test (padding).
- **DS-16** D1 (≈111 test files) and D4 (≈18 files) exceed the ~8-file cap: both are one scripted,
  comment/title-only concern, and splitting by folder adds agents without cutting turns.

## Plan

Pure test/comment hygiene; no production behaviour changes. Order:

1. **D1** strips story/deliverable ids from every `describe` title (scripted, then hand-fix titles
   that become empty or collide) and adds the title guard to `src/comments.test.ts`.
2. **D2** types the `as never` client-mock overrides and makes the handler-reference check strip
   comments; adds the `as never` guard; removes TD-013.
3. **D3** adds the missing tests (darwin at steam/diagnostics, `looksLikeQuake2` branches, swapped
   `isInside` order at four call sites); removes TD-014.
4. **D4** rewrites the 14 stale `i18n/locales/en.json` comments and the three
   `downloads.error.manifestUnavailable` mentions; adds the locale-comment guard; removes TD-028.
5. **D5** adds the bare-catch check with a shrinking per-file baseline and updates the
   ARCHITECTURE.md errors rule. **D6–D8** sweep `src/main` by area until the baseline is empty;
   D8 deletes the baseline and removes TD-031.
6. **D9** restores the `ImportPreviewResult` / `RefreshedProfileResult` invariant notes with a
   phrase pin; removes TD-033.

Flow files (`scripts/flows/*.mjs`) change in comments only; `--affected` will still run them as a
regression check. No systems doc under `docs/systems/` describes these rules; the error rule lives
in `docs/ARCHITECTURE.md#errors-and-logging` (D5).

## Deliverables

- **D1 — `describe` titles carry no ids.** In every `*.test.ts`, `*.test.tsx`, `*.test.mjs` under
  `src/` and `scripts/` (~215 titles in ~111 files; find them with
  `grep -rnE "describe(\.each\([^)]*\))?\(['\"\`][^'\"\`]*([Ss]tor(y|ies)[ -]?[0-9]+|\b0[0-9]{2}\b|\bD[0-9]{1,2}\b|\bAC ?[0-9]{1,2}\b)"`)
remove the id: drop a trailing `(story 077 D1)`/`- story 142 D3` suffix by script, then hand-edit
any title that is left empty, starts with an id (`'AC8 migration of a pre-042 profile'`) or now
duplicates a sibling `describe`title in the same file — give it a behaviour title. Change titles
only, never test bodies. Add to`src/comments.test.ts`(reuse its`STORY_POINTER`/`ID_PATTERN`,
add `\b0\d{2}\b`) the test "no describe title carries a story, deliverable or criterion id",
scanning the first string argument of every `describe(`/`describe.each(…)(` in those test files
(`listSourceFiles`/`isTestFile`from`src/test-support/source-tree.ts`; add the `scripts/`walk).`it`titles are out of scope. Accept: the new test is green and fails when a title`'x (story 123)'` is added.
- **D2 — client mocks are typed; the handler check ignores comments.** (a) Remove every `as never`
  inside a `mockClient(…)` override object in renderer tests (known: `replays/ReplaysListStatus.test.tsx`
  (`importOriginal as never`), `replays/components/DemoDetailPanel.test.tsx`,
  `replays/components/DemoStage.test.tsx`, `replays/ReplaysView.test.tsx`; grep
  `src/renderer` for `as never` near `mockClient`) and in `config/client.test.ts` /
  `downloads/client.test.ts` (cast payloads); type the value instead (`as const`, a typed builder
  from `src/renderer/src/test-support/`, or the real input type). (b) In
  `src/renderer/src/modules/handler-coverage.test.ts` › "every handler constant is referenced by
  its module's client", match against `stripComments(source)` (`src/test-support/source-tree.ts`).
  (c) Add to that file "no client mock override is cast with as never": for every renderer test
  file, the bracket-balanced argument span of each `mockClient(` call, and the whole of every
  `*/client.test.ts`, contains no `as never`. (d) Delete row TD-013 from `docs/TECH-DEBT.md`.
  Accept: typecheck green; both new/changed tests green; a handler named only in a comment of a
  `client.ts` now fails the coverage test.
- **D3 — the missing edge-case tests.** Tests only, no production change. (a)
  `src/main/services/steam.test.ts`: "readSteamAppId matches a differently cased installdir on
  darwin" with `stubPlatform('darwin')` (`src/test-support/platform.ts`, restore in `afterEach`).
  (b) `src/main/modules/downloads/diagnostics.test.ts` › `describe('redactHome')`: "is
  case-insensitive on darwin" (same stub; mirror the existing win32 case). (c)
  `src/main/services/inspector.test.ts`: "looksLikeQuake2 decides each validation shape" — a table
  over built `ValidationResult`s: `status: 'missing'` → false; `base-game-dir` check at `error` with
  `engineKind: 'unknown'` → false; same with a known engine → true; no `base-game-dir` error → true.
  (d) One swapped-order test per call site, each named "refuses a path that contains the root"
  (or the local wording), where only `isInside(root, target)` passes: a target that is the root's
  parent/ancestor is refused and a real child accepted — in
  `src/main/modules/downloads/bootstrap/target.test.ts` (`computeTargetVerdict`, line ~40/104),
  `src/main/modules/mods/install-job.test.ts` (line ~182 strict-inside),
  `src/main/modules/mods/remove.test.ts` (line ~137), `src/main/modules/mods/update-job.test.ts`
  (lines ~495/549). Verify each test fails when the call's arguments are swapped locally, then
  restore. (e) Delete row TD-014 from `docs/TECH-DEBT.md`. Accept: all new tests green; each
  swapped-order test red against swapped arguments.
- **D4 — no comment points at the old locale file or a deleted key.** (a) Rewrite the comments that
  name `src/renderer/src/i18n/locales/en.json` (the file is gone; keys now live in
  `src/renderer/src/i18n/locales/en.shell.json` and `src/renderer/src/modules/<id>/locale/en.json`)
  in `scripts/flows/`: `app-update`, `bootstrap-failure-retry`, `bootstrap-no-engine-for-platform`,
  `engine-update`, `home-dashboard-keyboard`, `job-waits-for-running-game`,
  `jobs-installation-busy`, `repair`, `retail-upgrade` (2), `runner-choice-compact`,
  `servers-master-sources`, `steam-handoff`, and `scripts/lib/fixture/installations.mjs:169` — name
  the owning locale file and the key, drop "mirrors". (b) Fix the comments naming the deleted
  `downloads.error.manifestUnavailable` in `src/main/modules/downloads/bootstrap/errors.ts:15`,
  `bootstrap/job.ts:223`, `src/main/services/content/manifest-service.ts:32` to name the key that
  exists today (look it up in `downloads/locale/en.json`) or drop the reference. (c) Add to
  `src/comments.test.ts` "no comment names a missing locale file or i18n key": no file under `src/`
  or `scripts/` contains `i18n/locales/en.json`; every backticked dotted token in a comment
  (`commentRanges`) of `src/**` and `scripts/**` whose first segment is a top-level key of `en`
  (import from `src/renderer/src/i18n/bundle.ts`) resolves in `en` (`a.b.*` = subtree `a.b`
  exists); tokens ending in a file extension (`.ts`, `.json`, …) are not keys. False positives are
  fixed in the matcher, never allowlisted. Comment edits only — no flow logic changes. (d) Delete
  row TD-028 from `docs/TECH-DEBT.md`. Accept: the new test is green and fails on a comment naming
  `` `downloads.error.noSuchKey` ``.
- **D5 — the bare-catch check.** New `src/main/catch-policy.test.ts`. A bare catch is a `catch`
  clause (not a promise `.catch(…)`) in a non-test `.ts` file under `src/main` that (1) has no
  binding or never reads its binding inside the block, (2) has no comment on the `catch` line or on
  the block's first line, and (3) does not call `.caught(` in the block. A comment consisting only
  of `ignore`, `ignored`, `swallow`, `best effort`, `noop` or `nothing to do` does not count. TS 7 in
  this repo has no JS compiler API: scan text, using `commentRanges`/`stripComments` from
  `src/test-support/source-tree.ts`, masking string/template/regex literals before brace matching.
  Tests: "the bare-catch scanner flags a binding-less catch and an unused binding, and accepts a
  commented, logged or rethrowing one" (inline fixture snippets incl. a template literal with `{`
  and a nested `try`), and "no bare catch in src/main beyond the baseline": a `BARE_CATCH_BASELINE`
  `Record<file, count>` generated from today's tree; fails when a file's count exceeds its entry
  **or** falls below it (stale entry must be lowered) or a file not listed has one. Update
  `docs/ARCHITECTURE.md` › `## Errors and logging` › "A bare `catch` says what it swallows": drop
  "Bare catches that predate the rule are not migrated; a file you edit gets its catches brought in
  line." and say `src/main/catch-policy.test.ts` fails on a bare catch. Accept: both tests green on
  the current tree; the scanner's count is within ±15 of TD-031's ~114 (explain a bigger gap in the
  test's doc comment).
- **D6 — sweep `src/main/lib`, `src/main/services`, `src/main/ipc` and top-level `src/main/*.ts`.**
  For each bare catch the check in `src/main/catch-policy.test.ts` reports in these folders (a
  `catch` clause with no or unread binding, no comment on its line or the block's first line, no
  `.caught(` call): add a comment naming the failure class it tolerates
  (`// ENOENT: the cache file may not exist yet`, `// a malformed header is not a demo`), or, where
  the failure is unexpected and should reach the log, `log.caught(message, error)` via
  `scopedLogger` (`src/main/lib/logger.ts`) — bind the error for that. `ignore`/`best effort`/`noop`
  alone is rejected by the check. Never change what the block does. Remove the swept files from
  `BARE_CATCH_BASELINE`. Accept: no baseline entry left under these folders; `npm test` green.
- **D7 — sweep `src/main/modules/downloads`, `src/main/modules/home`, `src/main/modules/mods`.**
  Same rule and edit as D6 (a `catch` clause with no or unread binding, no comment on its line or
  the block's first line, no `.caught(` call gets a comment naming the failure class it tolerates,
  or `log.caught(message, error)` from `scopedLogger` in `src/main/lib/logger.ts`; vacuous words
  are rejected by `src/main/catch-policy.test.ts`; behaviour unchanged). Remove these files from
  `BARE_CATCH_BASELINE`. Accept: no baseline entry left under these folders; `npm test` green.
- **D8 — sweep `src/main/modules/config`, `src/main/modules/replays`, `src/main/modules/servers`,
  then close the baseline.** Same rule and edit as D6 (a `catch` clause with no or unread binding,
  no comment on its line or the block's first line, no `.caught(` call gets a comment naming the
  failure class it tolerates, or `log.caught(message, error)` from `scopedLogger` in
  `src/main/lib/logger.ts`; behaviour unchanged). Sweep any file still listed in
  `BARE_CATCH_BASELINE`, then delete the baseline so "no bare catch in src/main beyond the
  baseline" becomes "no bare catch in src/main" (zero allowed). Delete row TD-031 from
  `docs/TECH-DEBT.md`. Accept: the renamed test green with no baseline in the file.
- **D9 — the config contract's invariant notes are back.** In `src/shared/modules/config.ts`
  restore the why-notes story 230's sweep cut (source: `git show 8186078a --
src/shared/modules/config.ts`), without story/deliverable ids (the comment guard rejects them):
  `RefreshedProfileResult` `adopted.droppedAliases` — `[]` is the normal case, and it is on the wire
  because main's alias fold discards the earlier body before the profile is rebuilt, so the loss is
  invisible anywhere else; `ImportPreviewResult` — `messageCount` is computed by
  `buildImportedActions` with an empty `layerAliases`; `ambiguousRebindAliases` is the same list
  whatever `layerAliases` answer `preview` used; `ownWrittenFile` — complete the truncated "True
  when the OWNERSHIP_MARKER sentinel." with where it is found (any file the import read, including
  one reached only through an `exec` chain). Keep `commentShare` of the file under 0.35
  (`src/comments.test.ts`). Add to `src/comments.test.ts` "the config contract keeps its invariant
  notes": the doc comments of those four fields each contain one pinned phrase (e.g. `[]`,
  `empty \`layerAliases\``, `regardless`/`whatever`, `exec`). Delete row TD-033 from
`docs/TECH-DEBT.md`. Accept: the new test green; `npm run typecheck` green.

## Model Hints

- D5 → deliverable-hard: a text scanner without a parser can silently miss catch blocks (braces
  inside template or regex literals, nested `try`), which turns the guard vacuous while every test
  stays green, and D6–D8 trust its report.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/comments.test.ts` › "no describe title carries a story, deliverable or criterion
  id" (D1); unit `src/renderer/src/modules/handler-coverage.test.ts` › "no client mock override is
  cast with as never" (D2) and › "every handler constant is referenced by its module's client"
  (D2, now over comment-stripped source).
- AC2 → unit `src/main/services/steam.test.ts` › "readSteamAppId matches a differently cased
  installdir on darwin"; `src/main/modules/downloads/diagnostics.test.ts` › "is case-insensitive on
  darwin"; `src/main/services/inspector.test.ts` › "looksLikeQuake2 decides each validation shape";
  the four swapped-order tests in `target.test.ts`, `install-job.test.ts`, `remove.test.ts`,
  `update-job.test.ts` (D3).
- AC3 → unit `src/comments.test.ts` › "no comment names a missing locale file or i18n key" (D4).
- AC4 → unit `src/main/catch-policy.test.ts` › "the bare-catch scanner flags a binding-less catch
  and an unused binding, and accepts a commented, logged or rethrowing one" (D5) and › "no bare
  catch in src/main" (D5 baseline, emptied by D6–D8).
- AC5 → unit `src/comments.test.ts` › "the config contract keeps its invariant notes" (D9).
- AC6 → unit `scripts/tech-debt.test.mjs` › `describe('tech-debt register')` stays green after the
  row removals (D2, D3, D4, D8, D9); the absence itself is checked in the diff review (DS-15).

Coverage: AC1 D1+D2 · AC2 D3 · AC3 D4 · AC4 D5–D8 · AC5 D9 · AC6 D2/D3/D4/D8/D9. No e2e line: no
criterion describes a user action. No manual residue.

## Done

Describe titles carry no ids, client mocks are typed, the handler check ignores comments, the missing
edge-case tests exist, locale comments are accurate, `src/main` has zero bare catches (guarded by
`src/main/catch-policy.test.ts`), and the config contract's invariant notes are restored. Rows TD-013,
TD-014, TD-028, TD-031, TD-033 are removed.

- Commit message: `325: describe titles id-free, typed client mocks, edge-case tests, locale-comment guard, bare-catch guard + sweep, config invariant notes`
- Verification (narrow gate): build, typecheck, lint, `npx vitest run --changed HEAD` (321 files, 4939 passed), `npm run check:docs`, prettier --check on changed files: green. Review 1 (default): PASS, minor findings below. AC1-AC6 verified by the named tests in Acceptance Tests (comments.test.ts x3, handler-coverage.test.ts x2, steam/diagnostics/inspector, four swapped-order tests - each proven red with swapped arguments - catch-policy.test.ts x2, tech-debt.test.mjs). No manual residue.
- Decisions:
  - `handler-coverage.test.ts` moved to the node tsconfig project (it now uses `source-tree.ts` with `node:fs`); `src/architecture.test.ts` exclude list updated to match.
  - Locale-key matcher checks backticked tokens of 3+ segments whose first two segments name a real namespace in `en` (plural `_one/_other` resolve from the base); 2-segment tokens such as `app.isPackaged` are property paths and gave dozens of false positives. Narrower than DS-9, accepted and unfixed.
  - Scanner counts 90 bare catches of 311 clauses vs TD-031's ~114: TD-031 counted commented binding-less catches too (explained in the test's doc comment). `*.test-helpers.ts` count as test code.
  - Swept catches all got a failure-class comment; no `log.caught` was needed; no behaviour changed.
  - Update-job swapped-order tests use a post-planning junction swap (planRemoval refuses linked paths earlier); a link-dependent case in `remove.test.ts` is `skipIf(!canLinkDirs)`.
  - Unfixed review nits: `mockClient` guard inspects the call span only; describe guard skips `describe.skip/concurrent` and concatenated titles; two scripts-walk helpers in `comments.test.ts` duplicate an expression.
  - TECH-DEBT.md: only the five rows deleted by hand (prettier re-padding reverted).

tiers: D 9 / hard 1 · review default · cycles 1 · agents 11
