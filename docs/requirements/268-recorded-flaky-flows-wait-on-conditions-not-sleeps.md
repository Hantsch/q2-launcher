---
id: 268
title: Recorded-flaky flows wait on conditions, not sleeps
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

As a maintainer, I want the flows that have flaked to wait on a condition instead of a fixed sleep, so
a red result means a regression and not a slow machine, and nobody re-runs a 50-minute suite to find
out.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F07): 35 `waitForTimeout` calls sit
in 18 flow files, plus one in `scripts/lib/servers-lan-flow.mjs:98`. Sprint reviews name the flaky
ones: controls-drag-reorder (S14 `review.md:73`), replays-extra-folders and servers-master-sources
(S26 `review.md:121`), replays-detail-quick-edit failing 40-50% of runs (S33 `review.md:167`). In
the tree at `ed0151a` the sleeps that remain in those four are
`scripts/flows/controls-drag-reorder.mjs:87,94,98,101` and
`scripts/flows/servers-master-sources.mjs:162,165,168`; `replays-detail-quick-edit.mjs` and
`replays-extra-folders.mjs` have none. The no-new-`waitForTimeout` rule exists
(`docs/UI-VERIFICATION.md:626`, stories 223 and 233) but is a convention with no automated check;
story 223 decided to leave existing sleeps alone, so this story reverses that only for the flows with
recorded flakes. The drag flow cites a dnd-kit timing reason for its sleeps. About 22 non-zero
unit-test sleeps are mostly negative assertions ("nothing happened after N ms") with no condition to
wait on; they are out of scope.

## Acceptance Criteria

- [ ] **AC1** — `grep -n "waitForTimeout"` over `scripts/flows/controls-drag-reorder.mjs`,
      `scripts/flows/servers-master-sources.mjs`, `scripts/flows/replays-detail-quick-edit.mjs` and
      `scripts/flows/replays-extra-folders.mjs` returns nothing.
- [ ] **AC2** — Each of the four flows passes 10 consecutive runs under 4 parallel shards, recorded
      in the Done section (command and result), not one green run.
- [ ] **AC3** — Each replaced wait names the state it waits for (a test id, a `waitForFunction`
      predicate or an `expect` on a locator); a seeded defect that never reaches that state makes
      the flow fail at its timeout instead of passing, shown once per flow.
- [ ] **AC4** — The drag-reorder flow still asserts the final order after the drag; deleting the
      drop step makes it fail (guards against a vacuous condition).
- [ ] **AC5** — A test in `scripts/repo-hygiene.test.mjs` fails when a flow file not on an explicit
      allowlist contains `waitForTimeout`: it fails against a fixture flow with one sleep and passes
      against the repo; the allowlist holds the remaining legacy files and may only shrink.
- [ ] **AC6** — `git diff --stat` for this story shows neither `src/main/services/launch.test.ts` nor
      `src/renderer/src/modules/replays/components/DemoDragZone.test.tsx` (negative-assertion sleeps
      stay).

## Open Questions

- Scope of the unit tests: the finding also lists `upgrade-job.test.ts:167,623` and other positive
  waits; the judge would take `launch.test.ts` and `upgrade-job.test.ts` after the flows, the refuter
  says several are negative assertions. Include `upgrade-job.test.ts` here or a follow-up?
- Check mechanism for AC5: a hygiene test with an allowlist (above) or an ESLint rule over
  `scripts/flows/`; the lint rule holds a shrinking allowlist less easily.
- Remaining 14 flows with sleeps: fix opportunistically when touched (judge: P3), with the allowlist
  as the ratchet?
- Not bundled with story 265: this story reduces the cause of re-runs, 265 their cost.

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 268` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 268`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 268`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 268`: one line per acceptance criterion above, naming the
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

<Leave empty. Filled by `/build 268` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
