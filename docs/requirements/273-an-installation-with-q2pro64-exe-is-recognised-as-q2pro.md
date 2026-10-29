---
id: 273
title: An installation with q2pro64.exe is recognised as Q2PRO
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

As a player whose Quake II folder carries the 64-bit Q2PRO build (`q2pro64.exe`), I want the launcher
to recognise that installation as Q2PRO and launch it, so I do not have to rename the executable.

Today (user feedback 2026-10-29): detection matches the `ENGINE_DEFINITIONS` executables
(`src/shared/types/engine.ts:99`, `['q2pro.exe', 'q2pro']`, markers at :103), so a folder with only
`q2pro64.exe` is not detected as Q2PRO. The bootstrap already accepts `q2pro64.exe` as a download
source and renames it (`src/main/modules/downloads/bootstrap/assemble.ts:228`) — detection does not.

## Acceptance Criteria

- [ ] **AC1** — A folder whose only engine binary is `q2pro64.exe` is detected as engine kind
      `q2pro` (adding the installation and rescanning both).
- [ ] **AC2** — Launching that installation starts `q2pro64.exe` (the spawned path names that file).
- [ ] **AC3** — A folder with both `q2pro.exe` and `q2pro64.exe` is one Q2PRO installation, and
      launching it starts the binary the decided preference names.
- [ ] **AC4** — Everything keyed on Q2PRO (demo play eligibility, Q2PRO config limits, bleeding-edge
      update) treats a `q2pro64.exe` installation the same as a `q2pro.exe` one.

## Open Questions

- Both binaries present: which wins — `q2pro64.exe` (64-bit) or `q2pro.exe` (what the launcher's own
  bootstrap writes)?
- Bleeding-edge update / repair of a `q2pro64.exe` installation: overwrite `q2pro64.exe` in place, or
  write `q2pro.exe` beside it?
- Other 64-bit names (`q2proded64.exe`, 64-bit r1q2 builds)? Out of scope unless refine finds them
  in the wild.

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 273` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 273`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 273`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 273`: one line per acceptance criterion above, naming the
automated test that proves it — level, file, and the test name it will carry. The tests are
written by the deliverables, not afterwards; `/build` re-checks this mapping and that the
tests pass before `status: done`.>

## Done

<Leave empty. Filled by `/build 273` after implementation:

- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
