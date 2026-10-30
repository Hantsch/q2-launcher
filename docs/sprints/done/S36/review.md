# Sprint S36 review

**Goal:** the Windows PR lane blocks on core journeys, a release publishes only a commit with a green `ci` run and launches the packaged app first, the sprint gate costs less, the tests review's timing/sleep/quarantine weaknesses are closed, and `CLAUDE.md` has one lane map. Plus three user-feedback fixes: `q2pro64.exe`, whole-ms ping, demos in R1Q2.

Run directly on `dev` (no sprint branch, by the user's call), 12/12 stories done, regression gate green after five fix commits. Nothing is pushed.

## Overview

| Story                                                  | Status | Commit                                                                     |
| ------------------------------------------------------ | ------ | -------------------------------------------------------------------------- |
| 271 CI pins Node and the audit gate blocks             | done   | 0cb7245, 8eda5b0, 23be207 Node 22.22.2 via `.node-version`, blocking audit |
| 267 Timing-ratio tests leave the blocking unit lane    | done   | 4ad809e manual `test:perf` lane, flow logs navigation time                 |
| 272 Test hygiene                                       | done   | 934aa0b CI-throw without 7za, loose pin, discovery guard, two echoes gone  |
| 266 Release waits for a green CI run on its SHA        | done   | 03aeab2 plan-step guard, `skip_ci_guard` override                          |
| 273 `q2pro64.exe` is recognised as Q2PRO               | done   | 8b3654c 64-bit build preferred, per-build engine chips, update in place    |
| 274 Server ping is the best sample in whole ms         | done   | acbea1c best of 3, rounded at the source                                   |
| 275 Demos play in an R1Q2 installation                 | done   | f523fcf `+demomap`, Stop only, other controls disabled with reason         |
| 268 Recorded-flaky flows wait on conditions            | done   | f435087 dnd-kit state waits, sleep ratchet                                 |
| 269 Quarantine needs a real owner; shard races fixed   | done   | 7e1bdfe owner rule, Linux entries exempt from ageing, two races fixed      |
| 265 Flow smoke tier, failed-only confirmation, seconds | done   | 867d130 `--tier=smoke`, confirm only failures, per-flow seconds            |
| 264 Windows PR lane blocks on core journeys            | done   | 22e6d9f 8 blocking flows, staged packaged smoke in release                 |
| 270 Test lane map in CLAUDE.md                         | done   | 1e1d50e `## Test lanes`, one e2e definition, drift guard                   |
| gate fixes                                             | done   | 6f932d9, a808298, ea2fa3a, 41659a4, 8eda5b0                                |

## Implemented stories

- **271/267/272** CI runs the Node in `.node-version` (22.22.2 after the gate) and the audit blocks; four high advisories fixed by bumps plus one override (TD-054). Timing tests moved to a manual `test:perf` lane (`perf.yml`, dispatch only). Hygiene: the 7za skip throws under CI, a test-discovery guard imports vitest's globs, two constant echoes deleted.
- **266/264** Release's `plan` job fails unless `ci.yml` is green on the SHA (a release commit is judged by its parent); `skip_ci_guard` overrides with a warning. `windows-verify` blocks on 8 smoke flows; release smoke-launches the unpacked app, non-blocking until two releases past 0.8.0 (tripwire test).
- **265/268/269** Flows get a 15-flow smoke tier, a confirmation pass that re-runs only failures, and per-flow seconds. Drag/keyboard-reorder flows wait on dnd-kit state; a repo-hygiene ratchet forbids new flow sleeps. Quarantine entries need a real story; the two Windows shard races (unlock-code, news-feed) are fixed and their entries removed.
- **270** `CLAUDE.md` has one `## Test lanes` table and the only definition of "e2e".
- **273** `q2pro64.exe` is a Q2PRO client and the default when both exist; the library card lets the user pick the build Play starts; update/repair overwrites that build in place.
- **274** Ping is the best of three samples, rounded where it is measured — rows, history, filter and sort all see whole ms.
- **275** R1Q2-only installations play `.dm2` demos (protocol 34/35) via `+demomap`; Stop works, every other playback control stays visible, disabled, with the reason. `q2config.cfg` is restored byte for byte afterwards.

## Findings & decisions

- **User decisions taken in this run:** sprint on `dev`, no branch; `q2pro64.exe` wins and the user picks the build; Linux is an additional, manually-qualified target, never in a pipeline; no nightly runs (perf lane manual); after the gate, the Node pin moved from 22.12.0 to **22.22.2** with `engines >=22.22.2` — on 22.12.0 vitest workers fail to start (jsdom 30 / undici 8 need ≥22.19).
- **Linux still triggers on GitHub.** 270's review found `linux-verify`, `linux-update`, `linux-journey` and the `ui-flows` Linux job still run on push/PR as advisory, against the Linux decision; the lane map describes them as advisory. Story draft [276](../../../requirements/done/276-linux-checks-leave-the-github-pipeline.md).
- **R1Q2 pause/speed** would need a second control protocol (r1q2 has `pause`/`timescale` but no channel); left out to stay inside one hard deliverable — roadmap follow-up.
- **Story 268's scope line** ("flows and launch.test.ts only") was the orchestrator's wording of the user's answer; the refiner read it as "audit, don't edit" `launch.test.ts` (its sleeps are negative assertions) and kept AC6.
- **Story 269** was cut by the Linux decision: no Linux engine package (TD-047 deleted); Linux-scoped quarantine entries no longer age out.
- **Unfixed review findings → TECH-DEBT:** TD-055 (273 demo-play override uses the preferred build), TD-056 (266 guard wiring only shape-tested), TD-057 (265 confirmation wiring has no unit test), TD-058 (275 R1Q2 flow skips without `csc.exe`; 268 broad `.catch`). TD-050 (format:check red) is resolved and removed.
- **Process:** 271 was blocked during build (verify:release exceeds the 10-minute call) and closed after the gate; its review ran then (PASS, two minor fixes). Several builders wrote CRLF working copies that the LF hygiene test catches; normalised by the orchestrator. Progress timestamps are monotonic and shell-produced.
- **Systems docs:** every story touching a module touched its doc (273 `install-module.md`, 274/267 `servers-module.md`, 275 `replays-module.md`).

## Blocked / open

Nothing blocked. Merging `dev` work (and pushing) is the user's decision.

## Regression gate

| Command                  | Result                                                                                                                                                          | Min          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `npm run build`          | green                                                                                                                                                           | 0.1          |
| `npm test`               | red: `comments.test.ts` → story 273 (trailing pointer, fixed 6f932d9); `check-docs.test.mjs` → 264, 270 (links after move, fixed a808298)                       | 0.6          |
| `npm run ui:verify`      | red only after a production `build` (dev-only screens); green on `build:dev`, 116/116, 0 serious                                                                | 2.5          |
| `ui:flows --parallel=4`  | first launch lost (build older than sources); relaunch 180/180 green                                                                                            | 20.9         |
| `npm run verify:release` | run 1: format check (sprint files, ea2fa3a) + build-linux `needs.plan.outputs.sha` → 266 (41659a4); run 2: Node 22.12.0 → 271 (user repin 8eda5b0); run 3 green | 14 / 17 / 17 |

No flaky or pre-existing failures, no quarantine entries written. `verify:release` ran three times, outside the flow-suite budget, as the proof 271 was blocked on.

## Acceptance

Every criterion is mapped to a named test in its story's Done section; highlights:

- **271** AC1 `npm audit --audit-level=high` exit 0; AC2/AC3 repo-hygiene "the ci audit step blocks a PR" (seeded); pin proven by `verify:release` (ci.yml under act on v22.22.2).
- **267** `npx vitest list` excludes `*.perf.test.*`; `test:perf` red on a seeded 3× RTT; workflows test pins perf.yml to dispatch only.
- **272** `flow-ci-skip.test.mjs`, workflows shard/fetch:7za tests, discovery-guard seeded list; AC3/AC6 by diff/grep.
- **266** `ci-guard.test.mjs`, workflows placement tests, wiring test for the CLAUDE.md rule.
- **273** inspector/installations/update-job/repair unit tests; `installation-engine-choice` flow (3 new steps).
- **274** ping-samples/scan-runner/server-query/lan-discovery tests; `servers-scoped-refresh` flow whole-ms step.
- **275** demo-play/session-restore/channel unit tests; `replays-play-r1q2` flow (AC1, AC3, AC5, AC6).
- **268** repo-hygiene sleep ratchet; four flows `--repeat=10 --parallel=4` 40/40; seeded breakages fail at the named waits.
- **269** flow-gate tests; AC7 `--repeat=10 --parallel=4` 40/40.
- **265** flow-select/flow-gate/flow-parallel tests; AC7 measured by the gate: 20.9 min, longest shard 18.8 min.
- **264** workflows tests (exact flow list, smoke membership, smoke step before `release.mjs`, tripwire); local packaged smoke exit 0, and exit 1 with `app.asar` deleted.
- **270** workflows "lane map" shape + existence tests (seeded rename); AC3–AC5 greps.

**Manual residue** (needs a push and GitHub runners): 264 AC2 (three green `windows-verify` runs), AC3 (job ≤ 15 min), AC5 (a red release-step run link); 266 AC5 (a live `dry_run: false` dispatch on a throwaway branch). Listed in [testplan.md](testplan.md).

## Tier record

| Story     | Ds     | Hard  | Review stages | Cycles | Agents | Build min |
| --------- | ------ | ----- | ------------- | ------ | ------ | --------- |
| 271       | 3      | 0     | default       | 1      | 3      | 21        |
| 267       | 3      | 0     | default       | 1      | 5      | 15        |
| 272       | 4      | 0     | default       | 1      | 6      | 6         |
| 266       | 2      | 0     | default       | 1      | 4      | 8         |
| 273       | 4      | 1     | default       | 1      | 9      | 51        |
| 274       | 3      | 0     | default       | 1      | 5      | 13        |
| 275       | 6      | 1     | default       | 1      | 9      | 57        |
| 268       | 4      | 1     | default       | 1      | 8      | 20        |
| 269       | 3      | 0     | default       | 1      | 6      | 24        |
| 265       | 4      | 0     | default       | 1      | 7      | 9         |
| 264       | 3      | 0     | default       | 1      | 6      | 13        |
| 270       | 1      | 0     | default       | 1      | 3      | 5         |
| **Total** | **40** | **3** | 0 hard        | 12     | 71     | 242       |

No story used the second-stage (hard) review, so there is nothing to compare; the default reviews found one real bug (265's stale confirmation report) and two wrong lane-map cells (270).

Minutes: refine 11 (12 in parallel); builds 242; gate 93 (12:20–13:53), of which `verify:release` 48.
