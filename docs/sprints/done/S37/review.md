# Sprint S37 review

**Goal:** after a sprint, `npm run verify:release` passing means the PR and the release pass: Linux checks no longer run in PR or release workflows and are never red, a release starts only on dispatch and checks its own commit, doc-shape tests no longer block, and no test turns red on a schedule. Every overdue TECH-DEBT row (since S33 or earlier) is fixed or deleted.

Run on `sprint/S37`, 13/13 stories done, regression gate green after five fix commits. Nothing is pushed; merging `sprint/S37` into `dev` is the user's decision.

## Overview

| Story                                                        | Status | Commit                                                                           |
| ------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------- |
| 276 Linux checks leave the PR and release path               | done   | 7a9aa1fa dispatch-only `linux.yml`, `verify:linux`, `verify:release` without act |
| 279 Doc-shape tests leave the blocking unit lane             | done   | cc803b79 `npm run check:docs`, unit-lane doc-read guard                          |
| 280 The packaged smoke's blocking switch is a decision       | done   | 3629169e smoke blocks the release, count tripwire removed                        |
| 278 A release runs only when the user starts it              | done   | 0e76269e dispatch-only `release.yml` with its own `ci` job                       |
| 277 verify:release checks what a PR and a release check      | done   | 6e13a1fa `npm run check`, plan and drift test, run record, `--status`            |
| 325 Tests and comments state what they check                 | done   | 620b2776 id-free titles, typed mocks, bare-catch guard and sweep                 |
| 322 Boot does not wait on file I/O                           | done   | a66a5d4c IPC ready gate, failed module refuses invokes                           |
| 323 The update service is split into testable parts          | done   | 9b140a78 four parts, update-job tests, LAN recheck, joined fetches               |
| 320 Config edits reach disk only through save                | done   | aed718a8 baseline defaults, switch bind through save, `keepEmptyAlias`           |
| 321 Demo play, stop and stage restore end in a defined state | done   | 1acd4a72 six edge cases, pid-guarded stage restore                               |
| 326 Platform decisions in playback stay behind the seam      | done   | 3b933d2d `plan.ts` + architecture guard, X11 keeper honesty                      |
| 327 OpenTDM installs on a 64-bit Q2PRO                       | done   | fcbbdc46 content-only package, flow covers remove and refusal                    |
| 324 Styles use tokens only                                   | done   | 7925f3e9 colour and font-size tokens with scanning tests, Radio floor            |
| gate fixes                                                   | done   | 1ce4139d, d6213a64, 19c57151, 90811196, ec513dc4 (format)                        |

## Implemented stories

- **276/279/280/278/277** The pipeline. Linux checks run only on dispatch (`linux.yml`, `linux-verify.yml`, `linux-update.yml`) and a failure is a `::warning::`, never a red job; `npm run verify:linux` runs them under act on a working-tree snapshot. Doc-prose tests live in a second vitest config (`npm run check:docs`, local only) and a unit-lane guard throws on any doc read. The packaged smoke blocks the release (structural test, count tripwire gone). `release.yml` is dispatch-only with its own `ci` job and no polling guard; `ci.yml` has no push trigger. `npm run check` runs format, typecheck, lint and tests; `verify:release` follows an ordered plan, a drift test fails on a blocking workflow run no local step covers, and a run record plus `--status` tell whether a commit was verified.
- **325** Describe titles carry no ids, client mocks are typed, `src/main` has zero bare catches (guarded), edge-case tests and the config contract's invariant notes exist.
- **322** The window opens before the app context is built: every channel is bound at boot and invokes wait on a ready gate. A module whose setup throws answers `modules.error.unavailable` and none of its handlers go live.
- **323** `createUpdateService` is split into state / checks / downloads / simulate with a lint and structure pin; the mod update job has keep and cancel tests; the LAN watchlist recheck queries the online list; concurrent catalog fetches join.
- **320** Unsaved config edits no longer reach disk from an address-book add or a switch bind (visible refusal), alias flags survive restarts, `saveNow` reverts after a cancelled burst, one `withLiveAssignments`.
- **321** Play refuses a missing mod game dir and is single-flight, a failed trust keeps its dialog open, a stop without exit settles after 5 s, quitting mid-stage restores the stage values (pid-guarded), single-sign `vid_geometry`, Alt+Enter keeps a queued switch, replace dialog and Join respect the filter.
- **326** Playback platform decisions live in `plan.ts`, guarded by an architecture rule; the X11 keeper logs stray X errors by name, refuses an unsupported Xauthority family, knows parked vs placed, and re-raises the cinema overlay after each ABOVE add.
- **327** OpenTDM r388 has a content-only package so a 64-bit Q2PRO installs it with the visible "not playable locally" reason; the flow also covers remove and the `noVariant` refusal.
- **324** Colours are tokens, font sizes come from an 11/12/13/14px scale (plus display tokens and one 8px keycap token), both guarded by scanning tests; `Radio` has a 24px floor, DeleteCategoryDialog honours `canSubmit`, Controls rows are memoised.

## Findings & decisions

- **User decisions taken in this run:** 324 sizes below the scale — option C (stencil and hex labels to 11px, one 8px keycap token for the keyboard panel only) and typography steps 11/12/13/14px; 327 has no 64-bit OpenTDM upstream, so content-only and no follow-up; the packaged smoke blocks (280); the tech debt was cut as 13 stories, above the 3–6 guideline, like S36. Refine ran 08:46–08:53 (13 in parallel) with a follow-up for 324/327 at 08:54–08:57 after two new user questions.
- **The maintainer must push the edited OpenTDM manifest** to `Hantsch/q2_community_content` for 327 to reach users.
- **Process:** 276's `story · done` trail line has no seconds (probably typed, not shell-produced); 321 and 326 have duplicate `story · done` lines (harmless re-runs); a non-sprint commit `08b4af4b updated ai scrum md` by the maintainer sits on the branch; 326 left `docs/TECH-DEBT.md` unformatted (fixed by the orchestrator in the 326 commit); seven story files failed `format:check` at the gate (fixed in `ec513dc4`); 324's `--affected` selection exceeded the 10-minute ceiling (a CSS/class sweep selects most of the suite — the same cause as TD-043), so named flows ran instead; 321 used 2 of 3 review cycles.
- **`ui:flow -- <name>` does not reseed** (324): two flows in one session can fail the second without a product defect.
- **Module-doc check (`docs/systems/`):** 323 (mods, servers), 320 (config), 321 (replays, servers), 326 (replays) and 324 (config, servers) touched their module docs. Misses: **322** changed module setup and handler behaviour in `config`, `downloads` and `replays` and touched no module doc — the one real finding; **324** touched downloads/home/replays styles only (class swaps, anticipated in refine, accepted); **279, 325, 327** touched module files for test moves, comments or catalog data only (accepted).
- **Unfixed review findings → TECH-DEBT**, one row per story: [TD-060](../../../TECH-DEBT.md) (280 smoke test denylist), TD-061 (278 release wiring asserts), TD-062 (277 composite actions), TD-063 (322 failed context leaves the window open, late `handle()`), TD-064 (323 part imports, story prefixes, join tests), TD-065 (320 dirty default profile without canonical file), TD-066 (325 guard gaps), TD-067 (326 ARCHITECTURE keeper section), TD-068 (327 flow without state-write wait), TD-069 (279 read guard misses `createReadStream`/`openSync`). TD-059 (321, even pending pause toggles) was filed by the story itself.
- **Accepted limits recorded in Done:** 321 on Windows the pid wait is the only restore guarantee (no file channel at quit) and a reused stale pid defers the restore; 324's 11px tile tags and TitleBar `leading-normal` were not eyeballed in screenshots (size is the user's decision); 320's `cancel()` has no production caller; 325's locale-comment matcher is narrower than planned.

## Blocked / open

Nothing blocked. Merging `sprint/S37` into `dev` (and pushing) is the user's decision, as is pushing the OpenTDM manifest (327). Manual residue is in [testplan.md](testplan.md); the first dispatched release is the live proof of 278.

## Regression gate

Ran on `sprint/S37`: short suites and `e2e-all` on `7925f3e9` (plus `777569e0`, progress only); fixes verified on their own narrow re-run, no second full run.

| Command                                      | Result                                                                                                                                     | Min |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| `npm run build`                              | green                                                                                                                                      | 0.3 |
| `npm test`                                   | red: 5 tests in 4 files, all attributed to sprint stories (below), fixed                                                                   | 0.9 |
| `npm run check:docs`                         | green                                                                                                                                      | 0.1 |
| `npm run format:check`                       | red: 7 story files (277, 278, 279, 280, 320, 322, 326) fixed in `ec513dc4`; `docs/ROADMAP.md` pre-existing, formatted in the review commit | 0.5 |
| `npm run lint` / `npm run typecheck`         | green                                                                                                                                      | 0.1 |
| `npm run ui:verify` (on `build:dev`)         | green: 116 shots, 0 critical / 0 serious / 1 moderate                                                                                      | 2.2 |
| `npm run ui:flows -- --parallel=4` (e2e-all) | green: 181/181, one launch                                                                                                                 | 22  |

| Failing test                                                          | Story and cause                               | Outcome                                                               |
| --------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `flow-select`: every area row selects at most 12                      | 320, `aed718a8` (new flow in two config rows) | fixed in `1ce4139d` (own `config-switch-bind` row)                    |
| `flow-select`: every non-test src file is reached                     | 322, `a66a5d4c` (`src/main/boot.ts` unmapped) | fixed in `1ce4139d`                                                   |
| `test-kit`: no test file exceeds 1,500 lines                          | 321, `1acd4a72` (`demo-play.test.ts` 1503)    | fixed in `d6213a64` (split into `demo-play.volume.test.ts` + helpers) |
| `architecture`: per-file purity checks and tsconfig excludes are gone | 324, `7925f3e9` (two style tests excluded)    | fixed in `19c57151` (moved to `src/test-support/`)                    |
| `error-keys`: every `fail()` literal resolves in en.json              | 326, `3b933d2d` (`x11.authFamilyUnsupported`) | fixed in `90811196`                                                   |

Fix re-run: the five tests by name, `npm test` (7754 passed), lint, typecheck, `check:docs`, `build:dev`, `ui:flows --affected` both shards (6/6 + 6/6). No flaky or pre-existing failures, no quarantine entries written, no unexpected pass. Each affected story's Done carries a line naming the regression and its fix commit. `verify:release` runs as sprint-end phase 4, after this review.

## Acceptance

Every criterion is mapped to a named test in its story's Done section; per story:

- **276** AC1–AC8 by the tests named in its Acceptance Tests (workflow placement, `release.mjs` complete-set staging, `verify:linux`, no act in `verify:release`); green after the review fixes.
- **279** AC1 `doc-read-guard.test.ts`; AC2 repo-hygiene docs-lane tests; AC3/AC5 `project-docs.docs.test.mjs`; AC4 the include-glob test.
- **280** AC1–AC3 `workflows.test.mjs` "the packaged smoke step fails the release when the app does not launch" (AC3 vacuous under the structural decision).
- **278** AC1 "a release starts only by dispatch"; AC2/AC3/AC5 "the release runs the ci checks on its own commit before plan"; AC4 the input-list and `skip_ci_guard` wiring tests; AC6 the `check:docs` lane-trigger rule.
- **277** AC1–AC4 `scripts/verify-release.test.mjs`; AC5 the lane-map rule in `project-docs.docs.test.mjs`. `verify:release` itself runs in phase 4, not in the build.
- **325** AC1 `comments.test.ts`; AC2 `handler-coverage.test.ts`; AC3 steam/diagnostics/inspector tests; AC4 four swapped-order tests (each proven red with swapped arguments); AC5 `catch-policy.test.ts`; AC6 `tech-debt.test.mjs`.
- **322** AC1 `boot.test.ts` + `ipc/index.test.ts`; AC2 `registry.test.ts`; AC3/AC5 typecheck + lint; AC4 `unlock.test.ts`; AC6 `tech-debt.test.mjs` + `check:docs` (the pinned-rows invariant test was moot after 279). `ui:verify` green.
- **323** AC1 lint + `service.structure.test.ts`; AC2 two `update-job.test.ts` tests; AC3 `watchlist-service.test.ts`, `scan-service.lan-mode.test.ts`, flow `servers-watchlist`; AC4 `catalog-service.test.ts`; AC5 unedited `service.test.ts` + `service.actions.test.ts`, flows `app-update`, `mod-update`; AC6 grep.
- **320** AC1 commit-cvars test + flow `servers-address-book`; AC2 `profile-writes.switch-bind.test.ts` + flow `switch-bind-keeps-unsaved-edits`; AC3 `persisted.test.ts`, `profile-schema.test.ts`; AC4 `useProfileSave.test.ts`, `ConfigView.routeFocus.test.tsx`, `config-profiles-store.test.ts`; AC5 `assignments.test.ts`; AC6 `check:docs`.
- **321** AC1–AC6 by the named unit tests plus flows `replays-mod-warning`, `replays-stage`, `replays-edit-unreadable-sidecar`, `servers-actionbar-join`, `servers-filter-search`, `replays-stop`. The `replays-stage` flow proves the wait and restore with a flow-owned live pid because the stub dies with its parent — one level below the real engine (real-engine survival is story 163's coverage).
- **326** AC1 `architecture.test.ts` + `plan.test.ts`; AC2/AC4 `connection.test.ts`; AC3 `stage-follow.test.ts` + `stage-window.test.ts`; AC5 grep; AC6 `stage-window.test.ts` ABOVE order. Unit level only: no real X server in the harness.
- **327** AC1 shipped-manifest unit test + flow `mods-install-content-only`; AC2/AC3 the flow (AC3 also `engine-target.test.ts`); AC4 grep.
- **324** AC1 `colour-literals.test.ts`; AC2 `typography-tokens.test.ts`; AC3 the `mods-remove` step; AC4 DeleteCategoryDialog and ServersView tests plus `ui:verify` axe; AC5 four `ControlsEntryRow` tests; AC6 `check:docs`. E2E ran as six named flows (6/6), not `--affected`.

**Manual residue** (listed in [testplan.md](testplan.md)): 278 AC2 runtime half (first dispatched release on GitHub); 321 real Alt+Enter racing a queued switch, and a real Q2PRO at a single-sign negative origin (the stub has no window or keys); 326 X error log line, window manager clamping the parked window, overlay above the ABOVE game (real X11, story 198 Q5). 276's real `verify:linux` (Docker, about 40 min) was not run in its build; act semantics were probed once with a scratch workflow.

## Tier record

| Story     | Ds     | Hard  | Review stages | Cycles | Agents  | Build min |
| --------- | ------ | ----- | ------------- | ------ | ------- | --------- |
| 276       | 5      | 1     | default       | 1      | 9       | 26        |
| 279       | 4      | 1     | default       | 1      | 7       | 13        |
| 280       | 1      | 0     | default       | 1      | 3       | 7         |
| 278       | 2      | 0     | default       | 1      | 5       | 13        |
| 277       | 4      | 1     | default       | 1      | 8       | 16        |
| 325       | 9      | 1     | default       | 1      | 11      | 31        |
| 322       | 7      | 1     | default       | 1      | 11      | 20        |
| 323       | 5      | 1     | default       | 0      | 7       | 12        |
| 320       | 7      | 1     | default       | 1      | 11      | 24        |
| 321       | 10     | 1     | default+hard  | 2      | 23      | 119       |
| 326       | 4      | 0     | default       | 1      | 6       | 8         |
| 327       | 2      | 0     | default       | 1      | 4       | 23        |
| 324       | 9      | 1     | default       | 0      | 11      | 34        |
| **Total** | **69** | **9** | 1 hard        | 12     | **116** | **346**   |

Only 321 used the second-stage (hard) review. Both stages failed it, and its Done does not attribute findings to a stage, so the hard review is not shown to have found anything the default review had missed; the trail suggests the first fix round was the larger one (6 min against 2).

Minutes: refine 11 (13 in parallel, plus the 324/327 follow-up); builds 346 (321 alone 119: four verify runs of about 15 min after six red flows and a docs line limit); gate 45 (14:47–15:32), of which `e2e-all` 22. 276's build minutes are taken from its `story · done` line without seconds.
