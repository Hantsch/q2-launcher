---
id: 267
title: Timing-ratio tests leave the blocking unit lane
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

As a maintainer, I want wall-clock budget assertions out of the blocking unit lane and out of flow
pass/fail, so a scheduler hiccup on a CI runner cannot turn the gate red while the timing checks stay
available.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F06; TD-049): both OS legs run
`src/main/modules/servers/scan-ping-accuracy.test.ts` (median within `TOLERANCE_MS = 5` on loopback
sockets with a busy-spinning worker, constants at :30-36; commit 6b7318e already widened it after a
flake) and `scan-measurement.test.ts` (`RECORDED_FULL_PASS_BUDGET_MS = 7527`, documented with about
2.5x headroom, :30-36). `scripts/flows/replays-folders-scale.mjs:15` fails the flow on
`MAX_NAVIGATION_MS = 1_000`. `scripts/rehearsal.test.mjs:110` asserts `launched.ms < 3000`, a
structural bound with no flake on record. `package.json` has only `test` and `test:watch`; there is
no perf lane. Windows has a 15.6 ms timer tick.

## Acceptance Criteria

- [ ] **AC1** — `package.json` has a `test:perf` script that runs `scan-ping-accuracy.test.ts` and
      `scan-measurement.test.ts`, and `npm test` does not run them (`npx vitest list` under the
      `npm test` config shows neither file).
- [ ] **AC2** — The functional assertions of both files (sample count, median ordering, result
      shape) remain in files that `npm test` runs, and those tests pass.
- [ ] **AC3** — `replays-folders-scale.mjs` logs the navigation time and no longer fails on it: a
      search for `MAX_NAVIGATION_MS` in the flow returns nothing, while its row-count assertion
      (`MAX_MOUNTED_ROWS`) still fails when the mounted count exceeds 100.
- [ ] **AC4** — `npm run test:perf` exits 0 on the maintainer's machine, and a seeded 3x slowdown in
      the ping path makes it exit non-zero (recorded in the Done section).
- [ ] **AC5** — The perf lane has a named trigger (manual dispatch or schedule) in a workflow or in
      the release gate documentation, and `scripts/workflows.test.mjs` asserts it is not among the
      merge-blocking jobs.
- [ ] **AC6** — `grep -n "267" docs/TECH-DEBT.md` matches within the TD-049 entry, which is closed or
      points at this story.

## Open Questions

- Perf lane trigger: nightly workflow, manual only, or advisory in CI? The judge says a lane nobody
  runs lets the budgets rot; pick one.
- `scan-measurement.test.ts` has a documented 2.5x headroom, guards a parallelism regression and has
  no flake on record (refuter). Move it too (finding) or leave it blocking and move only
  `scan-ping-accuracy`? AC1 assumes both.
- `rehearsal.test.mjs:110` is structural and unflaky; the judge says leave it for last and convert
  only if it flakes. Out of scope here unless refine decides otherwise.
- Never widen tolerances further (judge).

## Decisions (Sprint)

- **(User)** No nightly runs: the perf lane is manual-only (no scheduled workflow). Move both scan-ping-accuracy and scan-measurement out of the blocking lane.

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 267` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 267`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 267`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 267`: one line per acceptance criterion above, naming the
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

<Leave empty. Filled by `/build 267` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
