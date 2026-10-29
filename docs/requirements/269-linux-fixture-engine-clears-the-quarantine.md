---
id: 269
title: Linux fixture engine clears the quarantine; unattributed entries get an owner
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

A maintainer wants the Linux flow lane to verify the onboarding journey (add installation, bootstrap
wizard) instead of quarantining it, and wants every quarantine entry to name a story that owns it —
so that a quarantined flow is a visible, temporary debt and not silent coverage loss on the platform
CLAUDE.md says must reach parity.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F05, priority P2, TD-047 and
TD-052): `scripts/flows/quarantine.json` holds 22 entries, about 12% of 179 flow files. 20 of them
(`"platform": "linux"`, story 234, since S34) share one cause, stated in the entries themselves: the
fixture's engine package is a Windows Q2PRO (`q2pro64.exe`), so the Linux wizard shows no engine
option; they include `add-installation-one-flow` and `bootstrap-existing-folder`. 2 entries
(`news-feed` at quarantine.json:143, `unlock-code` at :149; since S35) carry `"story": "unattributed"`
and flake only under four parallel shards (a background manifest refresh lands in the second launch
window; the Settings installation id is read before it renders). Quarantined flows do not break the
run (`flows-all.mjs:6`, loaded at `:203`), so nothing is red — the harm is unverified Linux onboarding.

Out of scope, by the judge's scoping: a generic age-check framework. One already exists —
`scripts/lib/flow-gate.mjs`, pinned by `scripts/flow-gate.test.mjs:58-61` ("quarantined since SNN,
older than three sprints" is a config error). The S34 review sets the fix deadline at S38.

## Acceptance Criteria

- [ ] **AC1** — The flow fixture offers a Linux engine package selected by platform; the Windows
  package and the Windows flows that use it are unchanged (the Windows re-run of the flows that
  touch the fixture exits 0).
- [ ] **AC2** — On Linux, `npm run ui:flows -- add-installation-one-flow bootstrap-existing-folder`
  exits 0 with both flows removed from quarantine and `--repeat` showing no flake.
- [ ] **AC3** — `grep -c "Windows Q2PRO" scripts/flows/quarantine.json` returns 0: none of the 20
  story-234 entries remain (any remaining Linux entry names a different story and a different reason).
- [ ] **AC4** — `grep -n unattributed scripts/flows/quarantine.json` returns nothing; the `news-feed`
  and `unlock-code` entries carry a real story or TD id (TD-052) in `story`.
- [ ] **AC5** — A test fails when a quarantine entry has an empty or `unattributed` `story` (seeded
  defect: set `"story": "unattributed"` and the named test goes red).

## Open Questions

- The 2 shard races: fix them here (wait for explicit element readiness in both flows, the judge's
  preference over serialising shards) or only give them an owner and leave the repair to TD-052?
- Expiry: entries carry only `since`, and `flow-gate` already enforces three sprints. Is an extra
  `expires` field worth the ~10 lines the judge allowed, or is the existing rule enough once the
  story field is real?
- The Linux engine package: build it from story 102's Linux Q2PRO, or a minimal stub engine that
  only satisfies the wizard's package shape?
- Remove entries only after `--repeat` (story 233) shows green, so un-quarantined flows do not turn
  the Linux rehearsal red; is that the exit rule?

## Decisions (Sprint)

- **(User)** Linux is not supported; it is qualified as an additional target and its tests run manually only, never in the pipeline. Refine must cut the story to that: no CI/quarantine machinery for Linux beyond what the manual run needs; fix the two shard races only if they also hit Windows, otherwise give them an owner.

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine <id>` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine <id>`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine <id>`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine <id>`: one line per acceptance criterion above, naming the
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

<Leave empty. Filled by `/build <id>` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
