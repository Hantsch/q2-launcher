---
id: 275
title: Demos play in an R1Q2 installation, with the controls it cannot offer disabled
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

As a player whose active installation runs R1Q2 only, I want to play a demo from the Demos view,
even if seeking, pausing or the position readout are not available, so I can watch a demo without
setting up Q2PRO.

Today (user feedback 2026-10-29): `demoPlayEligibility` (`src/shared/replays/demo-play.ts:93-140`)
refuses with `replays.play.unavailable.notQ2pro` unless the active installation is Q2PRO-capable,
and an R1Q2 installation with a detected Q2PRO is played with the Q2PRO binary. The playback
channel (position / fullscreen / pause poll, `src/main/modules/replays/playback-channel/`) is built
on Q2PRO commands.

Per the platform-parity rule in `CLAUDE.md`, a control R1Q2 cannot drive stays visible, disabled,
with its reason as visible text (an i18n key), not only a tooltip.

## Acceptance Criteria

- [ ] **AC1** — With an R1Q2-only active installation, Play on a demo launches R1Q2 with the demo
      (in place or via the temporary copy) and the game opens playing it.
- [ ] **AC2** — An installation that has Q2PRO keeps playing through Q2PRO, unchanged.
- [ ] **AC3** — During an R1Q2 playback, every playback control R1Q2 cannot support is visible,
      disabled, and shows its reason as visible text.
- [ ] **AC4** — The mod-missing warning, the game-running refusal and the Steam-runner refusal apply
      to R1Q2 playback as they do to Q2PRO.
- [ ] **AC5** — A demo R1Q2 cannot play (protocol it does not read) is refused before launch with
      its own reason.
- [ ] **AC6** — R1Q2 playback leaves the user's `config.cfg` settings as they were before the demo.

## Open Questions

- Which controls survive on R1Q2: stop (close the game) only, or also pause / speed via console
  commands? Refine probes r1q2's console (see the Q2PRO probing pitfalls note — logfile buffering,
  no synthetic keys).
- Which demo protocols does R1Q2 read (34/35 yes; Q2PRO's 36)? Decides AC5.
- Linux: keep today's "no Q2PRO → refuse" rule, or does R1Q2 demo play apply there too?

## Decisions (Sprint)

- **(User)** Refine probes r1q2's console to decide which controls survive; unavailable ones stay visible, disabled, with reason text. Linux follows the Windows rule. Protocols 34/35 only.

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 275` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 275`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 275`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 275`: one line per acceptance criterion above, naming the
automated test that proves it — level, file, and the test name it will carry. The tests are
written by the deliverables, not afterwards; `/build` re-checks this mapping and that the
tests pass before `status: done`.>

## Done

<Leave empty. Filled by `/build 275` after implementation:

- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
