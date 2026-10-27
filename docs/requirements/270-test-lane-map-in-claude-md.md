---
id: 270
title: Test lane map in CLAUDE.md, Linux advisory exit condition, one meaning of e2e
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

A developer or agent wants one place that says which test lane blocks a PR or a release, on which
OS, and what "e2e" means — and wants the deliberate "Linux UI lanes are advisory" policy to carry an
exit condition — so that nobody reads five workflows and a 470-line script to learn the gates.

Comes after stories 264 and 265: the table is written once, with their final blocking/advisory values.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F08, F02, F14; P2):

- F08: `CLAUDE.md` has no `## Test lanes` section. Lane facts are spread over `.claude/ai-scrum.md:20-43`,
  `scripts/verify-release.mjs:1-45`, `linux-verify.yml:3-21` and `ui-flows.yml:3-5`. "e2e" means
  `ui:verify` for agents (`.claude/ai-scrum.md:29`, `e2e: npm run ui:verify`) but sharded `ui:flows`
  in CI (`ui-flows.yml:51`). `CONTRIBUTING.md` and `docs/UI-VERIFICATION.md` hold a partial map for
  humans.
- F02: `continue-on-error: ${{ github.actor != 'nektos/act' }}` is on 4 Linux jobs (`ci.yml:69`,
  `ui-flows.yml:22`, `linux-verify.yml:38`, `linux-update.yml:51`), pinned by
  `scripts/workflows.test.mjs:84-97`. The policy is deliberate (commit 586ea43) and documented in
  `docs/UI-VERIFICATION.md` (~1608), but has no exit condition; only `test (ubuntu-latest)` blocks
  Linux on GitHub.
- F14: `scripts/verify-release.mjs:387-394` acts only `ci.yml`, `linux-verify.yml`,
  `linux-update.yml`; `ui-flows.yml` is rehearsed separately by `npm run rehearse` (story 234).

Out of scope, by the judges' scoping: a new test-gates skill; restructuring `ai-scrum.md` beyond
replacing its "e2e" wording with a link; making any Linux lane blocking now; adding `ui-flows.yml`
to the act list (about +1400 s on a ~1000 s gate, against story 234's split).

## Acceptance Criteria

- [ ] **AC1** — `CLAUDE.md` contains a `## Test lanes` section with a table of 6–8 rows and the
  columns lane, trigger, command, OS, blocking/advisory (`grep -n '^## Test lanes' CLAUDE.md`
  returns one match).
- [ ] **AC2** — A test in `scripts/workflows.test.mjs` (or `repo-hygiene.test.mjs`) fails when a
  workflow file name or npm script named in the table no longer exists (seeded defect: rename
  `ui-flows.yml` in the table).
- [ ] **AC3** — `CLAUDE.md` defines "e2e" once, naming both `ui:verify` and `ui:flows`;
  `.claude/ai-scrum.md` links to that definition next to its `e2e:` line and does not duplicate the table.
- [ ] **AC4** — The Linux advisory policy appears in `CLAUDE.md` with a written exit condition and
  names the one job to flip first.
- [ ] **AC5** — The header of `scripts/verify-release.mjs` states that `ui-flows.yml` is advisory
  on GitHub and rehearsed via `npm run rehearse` / `ci:local:flows`; `grep -n "ui-flows"
  scripts/verify-release.mjs` returns a match within the first 45 lines.
- [ ] **AC6** — `npm run lint` and `npm test` exit 0.

## Open Questions

- Exit condition: "N consecutive green runs of `linux-verify`" (judge: make only the packaged
  AppImage job blocking after a stability window) or "quarantine set below M" (story 269)? Who owns
  the flip decision, given the owner reversed the policy recently (586ea43)?
- The refuter notes the platform-parity rule concerns UI controls, not CI; does the policy belong
  in the lane table alone rather than under that rule?
- Keep the drift test (AC2) at all? The judge allows it only as a small existence check.

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
