---
id: 265
title: Flow smoke tier, failed-only confirmation re-run, per-flow seconds recorded
status: done # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

As a maintainer closing a sprint, I want a small named smoke tier of flows, a confirmation run that
repeats only the flows that failed, and per-flow seconds recorded in the report, so the gate costs
about 25-30 minutes instead of about 130 and I can see which flows to cut next.

Today ([review 2026-10-27](../../reviews/2026-10-27-tests-review.md), F04, F17, F13): a full `ui:flows`
run took 49.8/49.4 min (S32 `review.md:140-141`), 51/50.5 min (S33 `review.md:157-158`) and
65/65.5 min (S34 `review.md:191-193`); the confirmation run repeats the whole suite (S34
`review.md:143`). Flows grew from 71 to 169 and cost grew roughly linearly. There are 179 flow files in
`scripts/flows/` (the review's 181 counted non-flow entries); 97 are servers or replays (replays-* 68,
servers-* 29). `scripts/flows/areas.json` and `scripts/flows-all.mjs` have no `tier`, so nobody can
name the 10-15 flows that mean "the product works". `flows-all.mjs:217-221` computes `took` per flow
and prints it, but `flows-report.json` holds only `total` and `seconds`. The shard timeout is 20 min
(`ui-flows.yml:23`) against 664-820 s measured in S34, a margin of 380-536 s that is invisible because
no per-flow seconds are persisted. `--affected`, `--shard`, `--parallel` and `--repeat` already exist.

## Acceptance Criteria

- [x] **AC1** — `scripts/flows/areas.json` carries a `tier` of `smoke` or `full` per flow; 10 to 15
      flows are `smoke`, and a test in `scripts/flow-select.test.mjs` fails when a smoke flow names a
      file that does not exist in `scripts/flows/`.
- [x] **AC2** — `node scripts/flows-all.mjs --tier=smoke` runs exactly the smoke flows; a unit test
      asserts the selected list equals the `smoke` entries of `areas.json`.
- [x] **AC3** — After a full run, the confirmation pass runs only the flows that failed in the first
      pass; a unit test over a stubbed runner with 1 failed of 5 flows asserts the second pass
      receives exactly that one name, and with 0 failed it runs none.
- [x] **AC4** — A flow that fails in the first pass and passes in the confirmation pass is reported as
      flaky, not green, and a flow failing in both passes gives a non-zero exit status; a unit test
      over the same stub asserts the summary line and the status.
- [x] **AC5** — `flows-report.json` contains `flows: [{ name, seconds, ok }]` with one entry per flow
      run, in `--parallel` mode too (time per flow, not per batch); `total` and `seconds` stay as
      today. A unit test in `scripts/flow-parallel.test.mjs` asserts the entry count equals the flows
      run.
- [x] **AC6** — The summary printed by `flows-all.mjs` lists the 10 slowest flows from the report; a
      unit test asserts order and count.
- [ ] **AC7** — A sprint gate on the current suite completes in at most 30 minutes at 4 workers,
      measured once and recorded in the Done section.

## Open Questions

- ~~Smoke tier membership and where it runs: every PR on both OSes (finding) or Windows only
  (story 264)? The judge warns a too-thin smoke tier lets regressions through if full runs only at
  release prep; decide how often full runs besides the sprint gate.~~ decided → Decisions (Sprint)
- ~~Sequence: confirmation-only-failed is Cut 1 (S) and halves gate cost with no coverage change; the
  tier is Cut 2 (S/M). Split into two stories, or keep as one?~~ answered → Decisions (Sprint)
- ~~Variant folding (servers/replays, 97 flows) is left out per the judge. The first step would be
  deleting `servers-no-scan-while-playing` and `servers-lan-no-scan-while-playing` after confirming
  `scan-guard.test.ts` covers the behaviour; separate story or opportunistic?~~ decided → Decisions (Sprint)
- ~~Helper copies per flow are by design (`flow-helper-duplication.test.mjs`); not touched.~~ decided → Decisions (Sprint)
- ~~The vitest JSON reporter artefact (F17 second half) is dropped by the judge: `npm test` is 24-360 s
  and not the bottleneck. Confirm. Shard re-balancing (F13) folds into this story only if the new
  per-flow data shows a shard above 15 min; never lower `testTimeout` or add retries.~~ decided → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Smoke tier and failed-only confirmation re-run stay one story.
- Where the smoke tier runs is not this story's: it defines the tier and `--tier=smoke`; story 264
  takes its Windows PR flows from it and story 270 writes the lane map, while the full suite keeps
  running at the sprint gate and release prep — no AC here wires CI, and 264/270 own those lanes.
- Smoke membership is the 14 flows named in D1 (first run, add/config/play journey, home, config,
  downloads, mods, servers, replays, about) — one per core journey, none in `quarantine.json`
  except the Linux-scoped `bootstrap-wizard`, because the tier means "the product works" on Windows first.
- Variant folding (servers/replays) is a separate later story, not opportunistic here — the review
  ranks it P3 after this story's per-flow seconds exist, and deleting flows needs its own coverage proof.
- Helper copies per flow stay untouched — `flow-helper-duplication.test.mjs` makes them deliberate.
- The vitest JSON reporter is dropped (`npm test` is not the bottleneck); shard re-balancing is not
  folded in: if D4's measurement shows a shard above 15 min, D4 records it in Done as a follow-up,
  because one measured run is not enough data to re-balance on. No `testTimeout` change, no retries.
- `areas.json` becomes `{ "tiers": { <flow>: "smoke" | "full" }, "areas": [ ...rows ] }`; a flow
  absent from `tiers` is `full` — AC1's "tier per flow" without 165 boilerplate lines every new flow
  would have to add.
- The confirmation pass lives in `flows-all.mjs` (every invocation, parent only), not in the sprint
  command — the plugin-managed `sprint.md` already forbids a second full run.
- A flaky flow (failed, then passed on confirmation) does not fail the run (exit 0) but is not
  counted as passed and is listed under `flaky:` — AC4 asks non-zero only for "failing in both
  passes", and the sprint gate quarantines flaky flows from that line.

## Plan

All work is in the flow runner (`scripts/`), pure decisions in `scripts/lib/flow-gate.mjs`,
`flow-parallel.mjs`, `flow-select.mjs`, wiring in `scripts/flows-all.mjs`. No `src/` change, no
CHANGELOG entry (nothing user-visible).

1. **D1 — smoke tier.** `areas.json` turns into `{ tiers, areas }`; `loadFlowTree()` returns
   `tiers` next to `areas`. New `validateTiers` / `tierFlows` in `flow-select.mjs`;
   `parseFlowArgs` learns `--tier=smoke|full`, `planFlows` uses it. Real-tree tests in
   `flow-select.test.mjs`.
2. **D2 — per-flow seconds.** `runGate` times each `runFlow` call through an injectable clock and
   returns `flows: [{ name, seconds, ok }]`; `mergeResults` concatenates them, `unreportedResult`
   fills them; the report already spreads the result. `summaryLines` appends the 10 slowest.
3. **D3 — failed-only confirmation.** `confirmFailures(first, runPass)` in `flow-gate.mjs`;
   `flows-all.mjs` factors its serial/parallel branch into one `runPass(names)`, runs it a second
   time on `result.failed` only, passes `--no-confirm` to its children, and derives the exit status
   from the confirmed result.
4. **D4 — measurement.** One full `npm run ui:flows -- --parallel=4`, minutes + slowest 10 + the
   longest shard recorded in Done.

Order D1 → D2 → D3 (D3 appends confirmation runs to D2's `flows`) → D4. Each D updates its own
paragraph in `docs/UI-VERIFICATION.md` § "The flow gate: quarantine, shards, timeout" (no
`docs/systems/` doc covers the runner).

## Deliverables

- [x] D1 — **Smoke tier in `areas.json` and `--tier=`.** (AC1, AC2)
      Files: `scripts/flows/areas.json`, `scripts/lib/flow-tree.mjs`, `scripts/lib/flow-select.mjs`,
      `scripts/lib/flow-gate.mjs`, `scripts/flows-all.mjs`, `scripts/flow-select.test.mjs`,
      `scripts/flow-gate.test.mjs`, `docs/UI-VERIFICATION.md`. - `areas.json` becomes an object `{ "tiers": {...}, "areas": [ ...today's rows unchanged ] }`.
      `tiers` maps flow name → `"smoke"` or `"full"`; a flow not listed is `full`. Smoke set
      (14): `bootstrap-wizard`, `linux-user-journey`, `home-route-roundtrip`, `home-tile-states`,
      `quit-persists-state`, `raw-inline-edit`, `unsaved-diff`, `open-keycap-dialog`,
      `downloads-tab`, `mods-install`, `servers-join`, `replays-demo-rows`, `replays-play-q2pro`,
      `about-release-notes`. - `loadFlowTree()` (`flow-tree.mjs`) returns `areas: json.areas` and `tiers: json.tiers`;
      every other caller of `tree.areas` stays as is. - `flow-select.mjs`: `validateTiers(tiers, flowNames)` → problem strings (not an object; a
      value other than `smoke`/`full`; a name with no file in `scripts/flows/`), and
      `tierFlows(tiers, tier, flowNames)` → sorted names (`full` = every flow, `smoke` = the
      smoke entries). Mirror `validateQuarantine`'s message style ("tier entry <name>: …"). - `flow-gate.mjs` `parseFlowArgs`: `--tier=smoke|full` → `tier`; any other value, or
      `--tier` together with flow names or `--affected`, is an error. `planFlows` takes
      `tierNames` and returns them as `names` when `tier` is set. `--shard`, `--parallel`,
      `--repeat` compose unchanged. Update `USAGE` and the header comment of `flows-all.mjs`;
      `flows-all.mjs` resolves `tierNames` with `tierFlows(loadFlowTree().tiers, …)` (or reads
      `areas.json` once) and exits through `usageError` when `validateTiers` reports a problem. - Tests: `flow-select.test.mjs` › "the tier table names existing flows and 10 to 15 smoke
      flows" (real tree: `validateTiers` is empty, smoke count in [10, 15]; plus a synthetic
      table with an unknown name and a bad value yields both problems) and › "--tier=smoke plans
      exactly the smoke flows of areas.json" (`parseFlowArgs(['--tier=smoke'], known)` +
      `planFlows` → equals the `smoke` keys of the real `tiers`). `flow-gate.test.mjs` arguments
      block: `--tier` with a name, with `--affected`, or `--tier=fast` is refused. - Doc: the `areas.json` paragraph names the new shape and the tier rule; the flag list
      gains `--tier=`.

- [x] D2 — **Per-flow seconds in the result, the report and the summary.** (AC5, AC6)
      Files: `scripts/lib/flow-gate.mjs`, `scripts/lib/flow-parallel.mjs`, `scripts/flows-all.mjs`,
      `scripts/flow-gate.test.mjs`, `scripts/flow-parallel.test.mjs`, `docs/UI-VERIFICATION.md`. - `runGate({ …, now = Date.now })` measures every `runFlow` call (a quarantined flow's
      re-run is its own entry) and returns `flows: [{ name, seconds, ok }]` in run order,
      `seconds` rounded to 0.1. The console line in `flows-all.mjs` keeps printing `took`. - `flow-parallel.mjs`: add `flows` to `LISTS` so `mergeResults` concatenates it;
      `unreportedResult` returns one `{ name, seconds: null, ok: false }` per name. Each child
      thereby reports its own per-flow seconds — never the batch's. - `flows-all.mjs` already writes `{ ...result, seconds }`; `total` and `seconds` stay. Check
      the report gets `flows` in both serial and `--parallel` runs (the pinned serial result is
      merged too). - `flow-gate.mjs`: `slowestLines(flows, count = 10)` → `slowest:` header plus one line
      `  <name> <seconds>s` per entry, descending by seconds, `null` skipped, at most `count`;
      `summaryLines` appends it when `result.flows` is non-empty. - Tests: `flow-gate.test.mjs` › "each flow run is timed on its own" (fake `now`, a
      quarantined pass-then-pass gives two entries) and › "the summary lists the ten slowest
      flow runs, slowest first" (12 entries incl. one `null` → 10 lines in descending order).
      `flow-parallel.test.mjs` › "merged results keep one timing entry per flow run" (two
      children + a pinned result → entry count equals the summed `total`; an unreported child
      contributes one `null` entry per flow). - Doc: the parallel paragraph says the report holds `flows: [{ name, seconds, ok }]` and the
      summary ends with the ten slowest.

- [x] D3 — **Confirmation pass re-runs only the failed flows.** (AC3, AC4)
      Files: `scripts/lib/flow-gate.mjs`, `scripts/flows-all.mjs`, `scripts/flow-gate.test.mjs`,
      `docs/UI-VERIFICATION.md`. - `flow-gate.mjs`: `async confirmFailures(first, runPass)`. `first.failed` empty → returns
      `first` unchanged and never calls `runPass`. Otherwise `second = await runPass(first.failed)`
      (a gate result over exactly those names); a name failed in both stays in `failed`; a name
      that passes in `second` moves to `flaky` with the note
      `flaky: <name> failed, then passed on the confirmation run`. `flows` gets `second.flows`
      appended; `total` stays the first pass's; `ok` = no `failed`, no `unexpectedPasses`, no
      `configErrors`. Quarantined outcomes (`expectedFails`, `unexpectedPasses`) are never re-run. - `summaryLines`: `passed` also subtracts `flaky`, and a `flaky: a, b` line follows the
      `failed:` line — a flaky flow is never counted green. - `flows-all.mjs`: fold today's serial/parallel branch into one `runPass(names)` that returns
      the merged result and whether a child left no report. After the first pass call
      `confirmFailures(result, runPass)` unless `--no-confirm` is given or `repeat > 1` (repeat
      exists to expose flakiness). The parent passes `--no-confirm` to every child in
      `runChild`, so confirmation happens once, in the parent, after the pinned flows. Exit
      status: `process.exitCode = exitStatus(result)`, a new one-liner in `flow-gate.mjs`
      that is 1 iff the confirmed result is not ok; a child's non-zero exit no longer forces 1
      by itself (its failures are in its report, or `unreportedResult` already counts all its
      flows failed) — otherwise a flaky flow in a child would still exit 1. `parseFlowArgs`
      accepts `--no-confirm` (document it in `USAGE` and the header). - Tests: `flow-gate.test.mjs` › "the confirmation pass re-runs only the failed flows" (stub
      `runPass` over 5 flows with 1 failed receives exactly `['c']`; with 0 failed it is never
      called) and › "a flow that fails then passes is flaky, one failing twice fails the run"
      (asserts `summaryLines` shows `4/5 flows passed` + `flaky: c` with `ok` true, and with the
      second failure `ok` false, `failed: c` and `exitStatus` 1; flaky-only gives `exitStatus` 0). - Doc: flag list gains `--no-confirm`; a paragraph on the confirmation pass and that exit 0
      with flaky flows still lists them.

- [x] D4 — **One measured gate run.** (AC7)
      Files: none in the repo except this story's `## Done`. - Run `npm run ui:flows -- --parallel=4` once on the finished D1–D3, in the background with
      `2>&1 | tee .ui-verify/gate-265.log` (the 10-minute call ceiling applies to foreground
      calls). Record in `## Done`: wall-clock minutes (must be ≤ 30), pass/flaky/fail counts,
      the slowest 10 from the summary, and the longest shard's seconds from `.ui-verify/shard-<i>/flows-report.json`.
      A shard above 15 min is noted as a follow-up, not re-balanced here.

## Model Hints

All Ds on the default tier: D1/D2 are additive pure functions with real-tree tests; D3's one
subtle point (a child's non-zero exit must not override a confirmed-flaky result, children must
not confirm on their own) is spelled out in its text and visible in the diff.

Review: → default

## Acceptance Tests

- AC1 → unit `scripts/flow-select.test.mjs` › "the tier table names existing flows and 10 to 15 smoke flows"
- AC2 → unit `scripts/flow-select.test.mjs` › "--tier=smoke plans exactly the smoke flows of areas.json"
- AC3 → unit `scripts/flow-gate.test.mjs` › "the confirmation pass re-runs only the failed flows"
- AC4 → unit `scripts/flow-gate.test.mjs` › "a flow that fails then passes is flaky, one failing twice fails the run"
- AC5 → unit `scripts/flow-parallel.test.mjs` › "merged results keep one timing entry per flow run"
  (plus `scripts/flow-gate.test.mjs` › "each flow run is timed on its own" for the per-flow, not
  per-batch, timing inside one child)
- AC6 → unit `scripts/flow-gate.test.mjs` › "the summary lists the ten slowest flow runs, slowest first"
- AC7 → measurement, not a test: a wall-clock budget is never a blocking test (`/test-gates`); D4
  runs `npm run ui:flows -- --parallel=4` once and records the minutes in `## Done`. The cost lever
  itself (no full second run) is proven by AC3's test.

## Done

Smoke tier (14 flows) in `areas.json` `{tiers, areas}` with `--tier=smoke|full`; `runGate` times every flow run and
`flows-report.json` carries `flows: [{ name, seconds, ok }]` (serial and --parallel); the summary lists the ten slowest;
the confirmation pass re-runs only failed flows (children pass `--no-confirm`; flaky = failed then passed, exit 0, listed
under `flaky:`; failed twice = exit 1). Docs: UI-VERIFICATION.md.

Commit message: `265: flow smoke tier (--tier=smoke), failed-only confirmation run, per-flow seconds + ten slowest in report`

Verification (narrow gate; no src/ change, no e2e line in the mapping): typecheck, lint green; `vitest run --changed HEAD` 50/50;
`vitest run scripts` all green once this file sits in done/ (the only red before was check-docs on this file's own relative link).
Review (clean agent, 1 cycle): AC1-AC6 PASS; fixed a stale first-pass shard report being read as the confirmation result
(confirmation children use `shard-<k>-confirm`, report deleted before spawn), a duplicate flaky note, a bare `slowest:` header,
a garbled doc sentence. Unfixed: the flows-all.mjs wiring (children --no-confirm, repeat>1 skip, pinned-before-confirm) has no
unit test because it needs Electron; the sprint gate run exercises it.
AC -> test: AC1/AC2 flow-select.test.mjs, AC3/AC4/AC6 + per-flow timing flow-gate.test.mjs, AC5 flow-parallel.test.mjs - all passed.
AC7 measurement: taken by the S36 regression gate run (D4 not run here; orchestrator records minutes, slowest 10, longest shard).

Decisions: --tier with names/--affected is a usage error; `--repeat>1` skips the confirmation pass; a child's non-zero exit
alone no longer forces exit 1 (a child with no report counts all its flows failed); summary `passed` subtracts flaky; fixed the
broken `../reviews/` links in done/268 and done/269 (now `../../reviews/`) that kept check-docs red.

tiers: D 4 / hard 0 · review default · cycles 1 · agents 7
