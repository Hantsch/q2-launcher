---
id: 234
title: release verification and CI rehearsals run before a merge to main
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

Several checks that guard a release were never observed in S32. `npm run verify:release` was not run
(the Docker daemon was down and the run exceeds the 10-minute call ceiling), and nothing in the
sprint ran it, although story [[226]] changed the dependencies it exercises (Electron 43.7.7).
Story [[223]] added the `ui-flows` and `windows-verify` workflows, but the `act` rehearsals
`npm run ci:local` and `npm run ci:local:flows` were not observed either (over the ceiling), so the
Linux-only red flows were never determined and the real GitHub-runner shard timings and the
`windows-latest` run are unmeasured.

The maintainer wants one named, repeatable way to run these long checks outside an agent's call
ceiling, with their result recorded, before a sprint branch goes towards `main`.

## Acceptance Criteria

- [x] **AC1** — A documented command or script runs `verify:release`, `ci:local` and `ci:local:flows`
      detached from the agent call ceiling and writes a pass/fail record with timings.
- [x] **AC2** — The Linux-only red flows `ci:local:flows` finds are in `scripts/flows/quarantine.json`
      with a reason, or fixed.
- [x] **AC3** — The recorded per-shard wall time stays under the `timeout-minutes: 20` of the
      `ui-flows` workflow with margin, and the `windows-verify` job has run green once on GitHub.
- [x] **AC4** — The sprint workflow notes (`docs/sprints/README.md`) say when this run is expected
      (before a merge to `main`, not per sprint).

## Open Questions

None open — the refine-deferred questions are decided below.

## Decisions (Sprint)

- The rehearsal runs on this machine (Docker Desktop + winget `act`), and a missing act/Docker fails the record in seconds with the reason — `verify:release` is already built and preflighted for exactly this host, so no second host is introduced.
- The GitHub half of AC3 (real-runner shard timings, `windows-verify` green on `windows-latest`) is manual residue — it needs a PR into `main` or a workflow dispatch, which agents may not trigger (org policy: push/PR are the user's).
- One entry point `npm run rehearse` launches a detached runner and returns at once; `npm run rehearse -- --status` prints the latest record — the agent call ceiling is beaten by detaching, not by splitting the checks.
- The three commands run sequentially in the AC1 order (`verify:release`, `ci:local`, `ci:local:flows`), with stale `act-*` containers removed before each — they share one Docker daemon and an aborted act run poisons the next.
- `ci:local` stays in the run although `verify:release`'s Linux phase also runs `ci.yml` — AC1 names it, and it runs from the working tree, which `verify:release` deliberately does not.
- A failing command does not stop the rest — one record with all three verdicts is worth more than an early exit on a 45-minute run.
- The record lives in a gitignored `.rehearsal/<UTC timestamp>/` (`record.json` + one log per command), written after every command so a poll sees progress — it is a machine-local result, and the merge to `main` it guards is the user's step.
- Per-shard wall time is parsed from act's job-prefixed output (first to last line of each `shard i/4` job) and the margin is 15 minutes, i.e. 25% under the workflow's `timeout-minutes: 20` — local act on this machine is the only measurable proxy for the runner.
- `act` is resolved once (extracted from `verify-release.mjs` into `scripts/lib/act.mjs`) and its folder prepended to `PATH` for the `ci:local*` npm scripts — those call bare `act`, which old shells do not find.
- A Linux-only red flow is fixed when the cause is a flow asserting something per `docs/UI-VERIFICATION.md#what-a-flow-may-assert` or a one-file product fix; otherwise it gets a `"platform": "linux"` quarantine entry with reason, story `234`, since `S34` — the `platform` field already exists in `scripts/lib/flow-gate.mjs` and keeps story 233's Windows gate empty.
- The rehearsal is documented as a pre-merge-to-`main` step in `docs/sprints/README.md` step 3 and pinned by a `scripts/docs-facts.test.mjs` assertion — that README is what AC4 names, and docs-facts is the existing home of doc pins.

## Plan

1. Extract `resolveAct` + stale-container removal + the Docker check from `scripts/verify-release.mjs`
   into `scripts/lib/act.mjs`; `verify-release.mjs` imports them unchanged in behaviour.
2. `scripts/lib/rehearsal.mjs` (pure): the command list, record shape, act-log → per-shard wall
   time parser, the 15-minute margin check, summary lines.
3. `scripts/rehearse.mjs`: default = launch itself detached with `--run <dir>` and print the record
   path + `--status` hint; `--run` = preflight, run the three commands sequentially with logs,
   update `record.json` after each; `--status` = print the latest record. `npm run rehearse`,
   `.rehearsal/` gitignored.
4. Run it on the sprint branch (poll `--status`), triage every Linux-only red flow of
   `ci:local:flows` (fix or `platform: "linux"` quarantine), rerun until the record is green and
   each shard is under 15 min.
5. `docs/sprints/README.md`: when the rehearsal runs (before a merge to `main`, not per sprint),
   plus the GitHub-only residue; pinned by docs-facts.

Order: D1 → D2 → D3. D2 needs Docker up; if it is not, D2 reports BLOCKED with the record.

## Deliverables

- [x] **D1 — detached rehearsal runner with a timed pass/fail record.**
      Files: new `scripts/lib/act.mjs` (move `resolveAct`, `removeStaleActContainers` and a
      `dockerRunning()` check out of `scripts/verify-release.mjs`, which then imports them — no
      behaviour change there), new `scripts/lib/rehearsal.mjs`, new `scripts/rehearse.mjs`, new
      `scripts/rehearsal.test.mjs`, `package.json` (`"rehearse": "node scripts/rehearse.mjs"`),
      `.gitignore` (`/.rehearsal/`). Mirror `scripts/flows-all.mjs` for spawning and timing, and
      `scripts/lib/flow-gate.mjs` for the pure-lib-plus-thin-CLI split.
      Behaviour: `npm run rehearse` creates `.rehearsal/<UTC yyyymmdd-hhmmss>/`, writes
      `record.json` `{ startedAt, status: "running", pid, commands: [...] }`, spawns
      `node scripts/rehearse.mjs --run <dir>` detached (`detached: true`, `stdio: 'ignore'`,
      `windowsHide: true`, `unref()`), prints the dir and `npm run rehearse -- --status`, and exits 0
      within seconds. `--run <dir>`: preflight via `lib/act.mjs` (act missing or Docker down →
      record `status: "failed"`, `reason`, no command run); then for each of `verify:release`,
      `ci:local`, `ci:local:flows` in that order: remove stale `act-*` containers, run
      `npm run <cmd>` (shell on win32) with the resolved act folder prepended to `PATH`,
      stdout+stderr to `<dir>/<cmd with : replaced by ->.log` (a colon is not a valid Windows filename character), then write `{ name, status: passed|failed, exitCode, seconds }` into the record. A failing command does not stop the rest. For `ci:local:flows`
      also store `shards: [{ shard: "1/4", seconds, status }]` parsed from act's job-prefixed log
      lines (`[ui-flows/UI flows (ubuntu-latest, xvfb, shard i/4)] …` — the parser takes first and
      last timestamped/line occurrence per shard; act's own job-duration line if present wins) and
      `marginOk` = every shard ≤ 900 s. Final `status` = passed only if all three passed and
      `marginOk`. `--status` prints the newest record as summary lines (one per command with
      seconds, one per shard, overall verdict) and exits 1 if it is failed, 0 if passed, 2 if still
      running (pid alive) or orphaned (pid gone, status still running → shown as "aborted").
      The detached child must survive the launching shell exiting — on Windows a child in the
      parent's job object dies with it; if `detached` alone does not survive, launch through
      `cmd /c start "" /b` (or equivalent breakaway) and prove survival in the test.
      Tests in `scripts/rehearsal.test.mjs` (the lib takes the command list as a parameter so the
      tests run `node -e` stand-ins, never act):
      "the launcher returns at once and the detached run completes the record" (stand-in commands
      sleeping ~3 s; launcher process exits first, record later shows all passed with seconds),
      "a failing command is recorded failed and the next one still runs",
      "missing Docker fails the record with its reason before any command runs",
      "per-shard wall time is parsed from act's job-prefixed output" (fixture log text inline),
      "a shard over the 15-minute margin fails the record",
      "status reports a running record whose pid is gone as aborted".
- [x] **D2 — the real rehearsal is green; Linux-only red flows are fixed or quarantined.**
      Files: `scripts/flows/quarantine.json`, and per red flow either the flow under
      `scripts/flows/<name>.mjs` or the one product file at fault (more than one product file
      → quarantine instead). Run `npm run rehearse` on the sprint branch and poll
      `npm run rehearse -- --status` (each poll is short; never wait inside one call). For every
      flow red in `<dir>/ci-local-flows.log` that is green on Windows (`npm run ui:flow -- <name>`):
      if the flow asserts something `docs/UI-VERIFICATION.md#what-a-flow-may-assert` forbids, or the
      cause is a one-file product fix, fix it; otherwise add
      `{ "flow", "reason": "<one-line Linux cause>", "story": "234", "since": "S34", "platform": "linux" }`.
      Never edit a flow just to hide a failure. A red in `verify:release` or `ci:local` that is not
      a flow is fixed if it is a test/CI defect of this branch; anything else (e.g. `origin/main`
      ahead of the branch) is reported, not worked around. Rerun until the record is passed with
      every shard ≤ 900 s, and write the final record's summary lines (per command seconds, per
      shard seconds, quarantined flows) into this story's `## Done

D1 (detached runner + record) and D3 (sprint notes + docs-facts pin) were done earlier (b547f37). D2: the real `npm run rehearse` ran six times on `sprint/S34`; each red was triaged. Branch defects fixed: `format:check` red on 99 files, `fetch:7za` rewriting the tracked licence as CRLF, `scan-service` test under a non-canonical TEMP, `quiet-test-run` and `map-list` tests failing on Linux, `replays-module.md` over its line cap. Rehearsal fidelity: `.actrc` no longer copies ignored files (a Windows `7za.exe` and a 4.5 GB tree). Linux causes fixed: extractor path off Windows (`7zz`), mods fixture host platform, stub engine orphan check, flows `replays-stop`, `replays-volume` (harness home), `replays-date-filter` (locale env), `mods-install` (variant id). 20 flows are quarantined for Linux; `ui-flows` runs 6 shards.

Final record `.rehearsal/20261006-073931` (PASSED, margin met): verify:release 1029 s, ci:local 270 s, ci:local:flows 1412 s with shards 1/6 685 s, 2/6 682 s, 3/6 820 s, 4/6 664 s, 5/6 747 s, 6/6 666 s (limit 900 s). With 4 shards the same tree took 973-1147 s, which is why the matrix grew to 6.

Quarantined, `platform: linux`, story 234, since S34 (reason in `scripts/flows/quarantine.json`): 12 Windows-engine fixture flows (`add-installation-one-flow`, `bootstrap-*` x9, `engine-update`, `repair`), `jobs-installation-busy`, `job-waits-for-running-game` and `retail-upgrade` (r1q2.exe marker rejected by the Linux inspector), `replays-copy-in-not-writable`, `replays-fullscreen`, `replays-stage-follow`, `replays-stage-x11-unreachable`, `replays-volume`.

Commit message: `234: rehearsal runner + green real rehearsal - Linux flow fixes, 20 linux quarantines, 6 ui-flows shards, format and Linux test defects fixed`

Verification: vitest comments, architecture, check-docs, tech-debt, flow-select, rehearsal, flow-gate, workflows, repo-hygiene, docs-facts, systems-docs all green; typecheck, lint, `prettier --check .` green; Windows re-run of the touched flows green. Review (clean agent, default tier): PASS; its findings (stale `.actrc` note in CONTRIBUTING.md, 7zz note in UI-VERIFICATION.md, date-filter header, weak negative check in `replays-stop`, vague quarantine reasons) were fixed and `replays-stop` and `replays-date-filter` re-run on Linux. Left as is: installed-record `variantId` names in `mods.mjs` still say win32 (cosmetic).

AC to test: AC1 `scripts/rehearsal.test.mjs` (launcher returns at once, failing command, missing Docker) plus the real record above; AC2 `scripts/flow-gate.test.mjs` (linux-scoped entry) plus `ci:local:flows` passed with the quarantine applied; AC3 local `scripts/rehearsal.test.mjs` (shard parser, margin) plus every shard at most 900 s; AC4 `scripts/docs-facts.test.mjs`.

Manual residue: AC3 GitHub half (real-runner shard times, `windows-verify` green on `windows-latest`) needs a PR into `main` or a workflow dispatch, which agents may not trigger.

tiers: D 3 / hard 1 · review default · cycles 1 · agents 1 (this resume only; D1/D3 agents are counted in the earlier run)
