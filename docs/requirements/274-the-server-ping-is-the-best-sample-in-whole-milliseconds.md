---
id: 274
title: The server ping is the best sample in whole milliseconds
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

As a player, I want the ping shown for a server — in the list and after refreshing a server — to be
a whole number of milliseconds and the best (lowest) round trip measured, so the number is easy to
read and matches what a good connect gets.

Today (user feedback 2026-10-29): after a ping refresh the user sees decimal places. The scan
reports the median of 3–6 samples (`src/main/modules/servers/ping-samples.ts`, story 258), rounded by
`medianPing`, but raw clock differences reach the UI through paths that skip it (candidates:
`server-query.ts:272`, `lan-discovery.ts:193`, the single-sample return in `scan-runner.ts:246-251`).
`formatPing` (`src/renderer/src/modules/servers/server-format.ts:32`) and the reachability history
(`ServerReachabilitySection.tsx:27`) print the value as-is.

## Acceptance Criteria

- [ ] **AC1** — The ping a scan stores for a server is the minimum of its successful samples, not
      the median.
- [ ] **AC2** — Every ping value that reaches the renderer (list row, detail header, reachability
      history, LAN rows, single-server refresh) is a whole number of ms.
- [ ] **AC3** — After refreshing a server, the server list shows its ping without a decimal point.
- [ ] **AC4** — Max-ping filter and ping sort use the same best-sample value the row shows.

## Open Questions

- Keep the extra samples taken when the first ones are far apart, or drop to a fixed 3 samples? The
  spread rule existed to stabilise a median.
- Rounding: `Math.round` or `Math.floor` for the best sample?
- `rttHistory` persisted by earlier sessions may hold fractional values: round on read or leave?

## Decisions (Sprint)

- **(User)** Ping: `Math.round` of the best sample, fixed 3 samples (spread rule dropped), persisted fractional `rttHistory` rounded on read.

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 274` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 274`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 274`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 274`: one line per acceptance criterion above, naming the
automated test that proves it — level, file, and the test name it will carry. The tests are
written by the deliverables, not afterwards; `/build` re-checks this mapping and that the
tests pass before `status: done`.>

## Done

<Leave empty. Filled by `/build 274` after implementation:

- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
