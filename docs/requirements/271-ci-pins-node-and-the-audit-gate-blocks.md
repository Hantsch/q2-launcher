---
id: 271
title: CI pins Node via a version file and the audit gate blocks
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

A maintainer wants CI to run the Node version developers run, and wants a high-severity dependency
advisory to fail the PR — so that a pass on "22.latest" cannot hide a failure on the supported
floor, and a calendar promise made in a step name does not silently expire.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F09 and F10; P2):

- F09: the composite action defaults `node-version` to `'22'`
  (`.github/actions/setup-node-electron/action.yml:5-8`); 9 jobs in 5 workflows use it (ci 2,
  linux-update 1, linux-verify 1, release 3, ui-flows 2). There is no `.nvmrc`, `.node-version`,
  `.tool-versions` or volta entry; `package.json:11-13` has only the floor `>=22.12.0`. The
  refuter rates the risk low: floating 22.x is normal `setup-node` behaviour.
- F10: `ci.yml:30-33` is the step `Audit (non-blocking until 2026-10-09)` with
  `continue-on-error: true`, ubuntu leg only — 18 days past its date. `docs/ROADMAP.md:56` records
  the promise (story 226). `scripts/repo-hygiene.test.mjs:128-134` pins the opposite: line 132
  asserts `continue-on-error` is `true`, and the test also requires the roadmap to contain
  `2026-10-09`, so flipping the gate is a two-file change.

Run `npm audit --audit-level=high` first. If it is not clean, fix or document an override with an
expiry before the gate blocks; a gate must not go blocking while red.

## Acceptance Criteria

- [ ] **AC1** — `npm audit --audit-level=high` exits 0 on the lockfile at the time of the change (or
  each remaining advisory has a documented override with an expiry date).
- [ ] **AC2** — The audit step in `ci.yml` is named `Audit` (no date) and has no `continue-on-error`;
  `grep -n continue-on-error .github/workflows/ci.yml` shows only the Linux job at line 69.
- [ ] **AC3** — `scripts/repo-hygiene.test.mjs` no longer asserts `continue-on-error` is `true` on
  the audit step and no longer requires `2026-10-09` in the roadmap; a named test fails when
  `continue-on-error` is added back to the audit step (seeded defect).
- [ ] **AC4** — A `.node-version` file exists at the repo root with a version `>= 22.12.0`.
- [ ] **AC5** — `.github/actions/setup-node-electron/action.yml` uses `node-version-file:
  .node-version`; `grep -n "default: '22'" .github/actions/setup-node-electron/action.yml` returns
  nothing.
- [ ] **AC6** — `docs/ROADMAP.md` no longer lists the audit follow-up as open; `npm test` and
  `npm run lint` exit 0.

## Open Questions

- Which version to pin: exactly `22.12.0` (exercises the floor) or a current 22.x (less drift from
  developers)? The judge gives 22.12.0 only as an example.
- Add a `workflows.test.mjs` assertion for the pin? The judge says skip it or fold it into the
  literal-restating rework of story 272, since it deepens that problem.
- A scheduled audit job so a new transitive advisory does not block unrelated PRs (judge: bigger
  cut, can be left out) versus the blocking step in the PR lane.
- A dated-comment scanner for calendar promises (judge: optional, P3) versus only the "no
  `continue-on-error` in ci.yml" assertion.

## Decisions (Sprint)

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
