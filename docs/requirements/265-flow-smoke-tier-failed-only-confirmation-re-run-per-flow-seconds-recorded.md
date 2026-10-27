---
id: 265
title: Flow smoke tier, failed-only confirmation re-run, per-flow seconds recorded
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

As a maintainer closing a sprint, I want a small named smoke tier of flows, a confirmation run that
repeats only the flows that failed, and per-flow seconds recorded in the report, so the gate costs
about 25-30 minutes instead of about 130 and I can see which flows to cut next.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F04, F17, F13): a full `ui:flows`
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

- [ ] **AC1** — `scripts/flows/areas.json` carries a `tier` of `smoke` or `full` per flow; 10 to 15
      flows are `smoke`, and a test in `scripts/flow-select.test.mjs` fails when a smoke flow names a
      file that does not exist in `scripts/flows/`.
- [ ] **AC2** — `node scripts/flows-all.mjs --tier=smoke` runs exactly the smoke flows; a unit test
      asserts the selected list equals the `smoke` entries of `areas.json`.
- [ ] **AC3** — After a full run, the confirmation pass runs only the flows that failed in the first
      pass; a unit test over a stubbed runner with 1 failed of 5 flows asserts the second pass
      receives exactly that one name, and with 0 failed it runs none.
- [ ] **AC4** — A flow that fails in the first pass and passes in the confirmation pass is reported as
      flaky, not green, and a flow failing in both passes gives a non-zero exit status; a unit test
      over the same stub asserts the summary line and the status.
- [ ] **AC5** — `flows-report.json` contains `flows: [{ name, seconds, ok }]` with one entry per flow
      run, in `--parallel` mode too (time per flow, not per batch); `total` and `seconds` stay as
      today. A unit test in `scripts/flow-parallel.test.mjs` asserts the entry count equals the flows
      run.
- [ ] **AC6** — The summary printed by `flows-all.mjs` lists the 10 slowest flows from the report; a
      unit test asserts order and count.
- [ ] **AC7** — A sprint gate on the current suite completes in at most 30 minutes at 4 workers,
      measured once and recorded in the Done section.

## Open Questions

- Smoke tier membership and where it runs: every PR on both OSes (finding) or Windows only
  (story 264)? The judge warns a too-thin smoke tier lets regressions through if full runs only at
  release prep; decide how often full runs besides the sprint gate.
- Sequence: confirmation-only-failed is Cut 1 (S) and halves gate cost with no coverage change; the
  tier is Cut 2 (S/M). Split into two stories, or keep as one?
- Variant folding (servers/replays, 97 flows) is left out per the judge. The first step would be
  deleting `servers-no-scan-while-playing` and `servers-lan-no-scan-while-playing` after confirming
  `scan-guard.test.ts` covers the behaviour; separate story or opportunistic?
- Helper copies per flow are by design (`flow-helper-duplication.test.mjs`); not touched.
- The vitest JSON reporter artefact (F17 second half) is dropped by the judge: `npm test` is 24-360 s
  and not the bottleneck. Confirm. Shard re-balancing (F13) folds into this story only if the new
  per-flow data shows a shard above 15 min; never lower `testTimeout` or add retries.

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 265` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 265`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 265`: small pieces, each with its own acceptance
(scrum-like) and the files it touches. `/build` implements them in order, in one go.
Every acceptance criterion above must be covered by at least one deliverable **and** by the
test named for it in `## Acceptance Tests` — the test is part of the deliverable that
implements the behaviour, never a clean-up afterwards. Refine checks both before
`status: ready`, build refuses to start without them.>

- [ ] D1 — <smallest useful, individually acceptable result; names the files it touches>
- [ ] D2 — ...

## Model Hints

<Agent tier per deliverable. Default is the cheap tier with `/build`'s effort — leave
unmarked. If a step needs more brainpower: "D3 (balancing formula) → deliverable-hard" (Opus +
high effort, agent in `.claude/agents/`) plus a one-sentence risk justification.
Plus one line for the code review, default: "Review: → default".>

## Acceptance Tests

<Leave empty. Filled by `/refine 265`: one line per acceptance criterion above, naming the
automated test that proves it — level, file, and the test name it will carry. The tests are
written by the deliverables, not afterwards; `/build` re-checks this mapping and that the
tests pass before `status: done`. This section replaces the manual test plan: acceptance is
the suite, not a click list.

Example paths below; your real test layout and the commands that run it are in
`.claude/ai-scrum.md` (`e2e-story`, `test-story`).

- AC1 → e2e `tests/e2e/<flow>.spec.ts` › "<test name>" (real surface, per
  `ui-acceptance-required`)
- AC2 → unit `tests/core/<module>.test.ts` › "<test name>"
- AC3 → **manual residue:** <the real reason it cannot be automated — an OS dialog, a
  specific machine, a paid external service>. Goes into the sprint review; blocks nothing.>

## Done

<Leave empty. Filled by `/build 265` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
