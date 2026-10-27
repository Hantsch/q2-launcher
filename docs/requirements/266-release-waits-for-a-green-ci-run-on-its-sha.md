---
id: 266
title: Release waits for a green CI run on its SHA
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

As a maintainer, I want the release to refuse to publish a commit on which the PR lane has not
passed, so a direct push, an admin merge or a dispatch cannot ship untested code.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F01): `release.yml:3-6` triggers
on push to `main` and `workflow_dispatch`, independent of `ci.yml:3-8`; there is no `workflow_run`,
`needs` or check-status guard. `plan` skips only on `[skip ci]` (`release.yml:53`), and the checkout
uses `ref: github.ref_name` (:61/94/150). The release job repeats `npm test` and typecheck on
windows-latest (:157-161) and runs no lint, UI lane or Linux unit run. In the normal path
(dev to main by pull request) `ci.yml` has already run on the content; the gap is the admin merge,
direct push or dispatch, and the push-to-main `ci` run starts in parallel with release, so a
post-merge failure would not stop publishing either. The release commit itself is `[skip ci]`
(`scripts/release.mjs`) and has no `ci` run.

## Acceptance Criteria

- [ ] **AC1** — The `plan` job in `.github/workflows/release.yml` fails when no successful `ci`
      workflow run exists for the head SHA being released.
- [ ] **AC2** — The guard checks the feature-commit SHA, never the `[skip ci]` release commit: a
      unit test over the guard's decision function passes a run on a `[skip ci]` release commit
      without a `ci` run and rejects a feature commit without one.
- [ ] **AC3** — A `workflow_dispatch` with `dry_run: true` passes without a `ci` run, and an
      explicit override input skips the guard; both are covered by the same unit test.
- [ ] **AC4** — `scripts/workflows.test.mjs` asserts the guard step exists in `plan` and precedes
      the build jobs; deleting the step fails that test.
- [ ] **AC5** — A dispatch on a test branch SHA with no `ci` run exits non-zero at the guard step,
      recorded once in the Done section with the run link.
- [ ] **AC6** — `CLAUDE.md` names the checks a release requires: `grep -n "green" CLAUDE.md` matches
      a line stating that release needs a green `ci` run on its SHA.
- [ ] **AC7** — The windows `npm test` and typecheck steps in `release.yml:157-161` are still present
      after this story (a search for `npm run typecheck` in `release.yml` matches).

## Open Questions

- Guard mechanism: a `plan`-step check of the head SHA's `ci` run (judge's choice, `gh api` on
  check-runs) versus a `workflow_run` trigger. `workflow_run` changes the trigger model and the
  `[skip ci]` handling; decide in refine.
- Wait or fail? If the push-to-main `ci` run is still in progress when release starts, does the guard
  poll up to N minutes or fail at once? Failing at once means every normal merge needs a re-dispatch.
- Dropping the repeated windows test and typecheck (about 300 s saved) is a later cut that waits for
  the packaged smoke of story 264 (judge); AC7 holds them until then.
- Override input name and who may use it; it must be visible in the release run log.
- Verifying the guard is only possible through a dry-run dispatch; is that acceptable for AC5?

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 266` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 266`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 266`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 266`: one line per acceptance criterion above, naming the
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

<Leave empty. Filled by `/build 266` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
