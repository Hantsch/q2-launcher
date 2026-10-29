# Tests review 2026-10-27

Test-only architecture review at commit `ed0151a` (branch `dev`, tree dirty only with the ai-scrum 4.6.0 update). 3 reviewers produced 27 raw findings; merged to 17; all 17 verified by a refuter and a value judge (34 agents). Stories 264–272 (`status: draft`). Read the story map to act; the findings table is the evidence.

## Verdict

**What is good.** The suite is serious: 632 test files, 6563 unit tests in ~24 s (S32), layering and contract tests, a typed quarantine with an owner per entry and an age check, a flow runner with per-flow timeouts, `--affected`, sharding and `fail-fast: false`, no retries masking failures, one composite setup action across 9 jobs, and `scripts/workflows.test.mjs` pinning the gate shape. The vitest include covers every test file — no orphans.

**Structural causes.**

1. **No written lane map** (F08, F02, F14) — no `test-gates` skill, no `## Test lanes` table, "e2e" means two things. Every other lane question is decided ad hoc per story.
2. **Flow volume grows with features, not promises** (F04, F17, F13) — 179–181 flows, 50–65 min per full run, paid twice per sprint gate; no smoke tier, no per-flow timing to cut by.
3. **Windows blocks on too little** (F03, F01) — the blocking Windows UI lane is ui:verify + 3 flows on a dev build; no gate launches a packaged app; release does not wait for CI.
4. **Wall clock in assertions** (F06, F07) — timing ratios on real sockets in `npm test`, 35 fixed `waitForTimeout` in 18 flow files.

**Do first:** none is a correctness or security defect in the product; F03 (packaged Windows smoke + core flows blocking) and F04 (smoke tier, failed-only confirmation) are the P1s.

## Story map

| #   | Story                                                                                                | Findings           | Prio | Effort | After    |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------ | ---- | ------ | -------- |
| 264 | Windows PR lane blocks on core-journey flows and the release launches the packaged app               | F03                | P1   | M      | —        |
| 265 | Flow smoke tier, failed-only confirmation re-run, per-flow seconds recorded                          | F04, F17, F13      | P1   | M      | —        |
| 266 | Release waits for a green CI run on its SHA                                                          | F01                | P2   | S      | 264      |
| 267 | Timing-ratio tests leave the blocking unit lane                                                      | F06                | P2   | S      | —        |
| 268 | Recorded-flaky flows wait on conditions, not sleeps                                                  | F07                | P2   | S      | —        |
| 269 | Linux fixture engine clears the quarantine; unattributed entries get an owner                        | F05                | P2   | M      | —        |
| 270 | Test lane map in CLAUDE.md, Linux advisory exit condition, one meaning of "e2e"                      | F08, F02, F14      | P2   | S      | 264, 265 |
| 271 | CI pins Node via a version file and the audit gate blocks                                            | F09, F10           | P2   | S      | —        |
| 272 | Test hygiene: skipped launch flow fails in CI, loose workflow pins, discovery guard, constant echoes | F12, F11, F15, F16 | P3   | S      | —        |

Suggested sprints: **A** 264 + 266 + 271 (release trustworthy on Windows); **B** 265 + 267 + 268 (gate time and flakiness); **C** 269 + 270 + 272 (Linux quarantine, lane map, hygiene).

## Test lanes

| Lane                        | Runs                                                                  | Blocks       | Budget                |
| --------------------------- | --------------------------------------------------------------------- | ------------ | --------------------- |
| PR, Windows                 | lint, typecheck, unit without timing tests, ui:verify, ~8 smoke flows | merge        | ≤ 15 min              |
| PR, Linux                   | unit; UI + packaging advisory until exit condition                    | unit only    | ≤ 15 min              |
| Release                     | CI-green guard on SHA, packaged launch smoke                          | publish      | ≤ 10 min beyond build |
| Sprint gate (local e2e-all) | all flows ×4 shards, failed-only confirmation                         | sprint close | ≤ 25 min              |
| Perf                        | timing-ratio tests, per-flow duration report                          | nothing      | —                     |

| Tests                                               | From           | To                   | Seconds saved | Finding | Story |
| --------------------------------------------------- | -------------- | -------------------- | ------------- | ------- | ----- |
| scan-ping-accuracy, scan-measurement timing asserts | PR             | perf                 | not measured  | F06     | 267   |
| 1 s UI-budget flow assert                           | sprint gate    | perf                 | not measured  | F06     | 267   |
| full confirmation re-run (169 flows)                | sprint gate    | failed-only          | ~3700 / gate  | F04     | 265   |
| ~8 core-journey flows                               | Linux advisory | PR Windows, blocking | adds ~180     | F03     | 264   |
| packaged launch smoke                               | none           | release              | adds ~60      | F03     | 264   |
| release re-run of unit + typecheck                  | release        | CI-green guard       | ~300          | F01     | 266   |

Minutes: sprint gate before ~130 (2 × 65 at serial rates; S34: 3900 + 3930 s), after ~25–30 at 4 workers with failed-only confirmation. PR Windows lane: +~4 min. Release: −~5 min. PR-lane CI minutes on GitHub not measured (`gh` not installed) — run `/test-review` first.

## Findings

| Id  | Sev               | Finding                                                                                  | Check   | Story |
| --- | ----------------- | ---------------------------------------------------------------------------------------- | ------- | ----- |
| F01 | medium (was high) | Release lane does not wait for the PR lane and repeats a thin slice                      | refuter | 266   |
| F02 | medium (was high) | Every Linux UI lane advisory; documented, exit condition missing                         | refuter | 270   |
| F03 | medium (was high) | Blocking Windows UI = ui:verify + 3 flows on a dev build; no packaged app launched       | refuter | 264   |
| F04 | high              | No flow tiers: 50–65 min per full run, paid twice per sprint (179 flows)                 | refuter | 265   |
| F05 | low-medium        | Quarantine at 22: 20 from one Linux fixture defect, 2 unattributed (TD-047/TD-052)       | refuter | 269   |
| F06 | low-medium        | Wall-clock assertions on real sockets in blocking lane; 1 s UI budget in a flow (TD-049) | refuter | 267   |
| F07 | low-medium        | 35 fixed sleeps in 18 flow files; no-new rule already exists (UI-VERIFICATION.md:626)    | refuter | 268   |
| F08 | low (was medium)  | No test-lane map; "e2e" has two definitions                                              | refuter | 270   |
| F09 | low (was medium)  | CI Node floats on 22.x; no version file                                                  | refuter | 271   |
| F10 | medium            | Audit gate 18 days past its "non-blocking until 2026-10-09" date                         | refuter | 271   |
| F11 | medium            | workflows.test.mjs restates workflow YAML literals (+ workflows.test.mjs:68-75)          | refuter | 272   |
| F12 | low (was medium)  | Skipped launch flow exits green when the 7za stand-in is missing (1 of 2 sites)          | refuter | 272   |
| F13 | low (was medium)  | Global 20 s unit timeout, thin shard margin — documented; margin 380–536 s               | refuter | 265   |
| F14 | info (was low)    | verify:release omits ui-flows.yml — covered by `rehearse`                                | refuter | 270   |
| F15 | low               | Nothing guards test discovery against unmatched extensions (vitest.config.ts:30)         | refuter | 272   |
| F16 | low               | ~15–20 constant-echo tests; CSP pins deliberate (stories 067/084)                        | refuter | 272   |
| F17 | low               | No per-flow timing persisted (console only, flows-all.mjs:217-221)                       | refuter | 265   |

Legend: _refuter_ = survived the refuter (severity shown corrected); _judged_ = value judge only; _refuted_; _reviewer-only_ = unverified.

Left out on purpose: the CSP triple pin (F16) — deliberate per stories 067/084; the windows-build-on-linux skip (F12) — a deliberate platform skip; folding variant flows (F04) — P3, after 265 measures per-flow seconds.

## Method and limits

- Dimensions (all `sonnet`): lanes and gates; suite value; runtime and flakiness. Merge `opus`. Verify 34 `sonnet` (17 refuters, 17 judges), run as two concurrent batches.
- Minutes: review 3 (21:11–21:14), merge 2, verify 3, report + stories ~5.
- Unverified ids: none.
- Commit `ed0151a`, branch `dev`, dirty (ai-scrum 4.6.0 workflow update only).
- Not covered: GitHub CI run history (`gh` not installed), per-test and per-flow durations, the 20 slowest flows; no suite was run. No `test-gates` skill in the project — lanes judged from workflows, scripts and sprint reviews.
