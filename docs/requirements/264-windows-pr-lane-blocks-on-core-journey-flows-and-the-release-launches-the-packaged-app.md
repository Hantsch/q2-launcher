---
id: 264
title: Windows PR lane blocks on core-journey flows and the release launches the packaged app
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

As a maintainer, I want the blocking Windows lane to fail a pull request when a core journey breaks,
and the release to start the packaged Windows app before it publishes, so the build about 80% of
users run is the one that gets tested.

Today ([review 2026-10-27](../reviews/2026-10-27-tests-review.md), F03): the blocking Windows UI job
`windows-verify` runs `ui:verify` plus three flows (about-release-notes, steam-handoff,
open-keycap-dialog) on a dev build (`.github/workflows/ui-flows.yml:62-91`, `npm run build:dev` at
:77; `vitest.config.ts:8` forces `__Q2L_DEV_MODULES__: 'true'`). No Windows flow does add
installation, edit config, Play, exited; the only such journey is `linux-user-journey`, which is
advisory. `release.yml` builds the Windows installer (:189-192) and never launches it; only the
advisory `linux-verify` launches a packaged build. Story 223 chose the dev build deliberately, on the
claim that "the packaged path is already proven by release.yml" — release.yml builds but does not
launch, so that claim has no check behind it. Full Windows flow runs exist only locally
(`verify:release`, `rehearse`).

## Acceptance Criteria

- [ ] **AC1** — `windows-verify` in `.github/workflows/ui-flows.yml` runs at least 4 and at most 8
      core-journey flows beyond `ui:verify`, each as a named step without `continue-on-error`, and
      `scripts/workflows.test.mjs` pins the list; removing one flow from the job fails that test.
- [ ] **AC2** — The set includes one flow covering add installation, edit config, Play, exited on
      Windows (a Windows variant of `linux-user-journey`), and every flow in the set exits 0 on
      `windows-latest` in 3 consecutive CI runs before the story is done.
- [ ] **AC3** — The `windows-verify` job stays within its 30-minute `timeout-minutes`; the job
      duration recorded in the story's Done section is at most 15 minutes.
- [ ] **AC4** — `release.yml` contains a step before the publish step that runs one flow with
      `--app=` against the unpacked Windows build (`--dir`, not the installer UI), and
      `scripts/workflows.test.mjs` asserts that step precedes publish.
- [ ] **AC5** — A seeded defect that makes the packaged app crash at start (injected on a test
      branch) turns the AC4 step red; recorded once in the Done section with the run link.
- [ ] **AC6** — A search for "264" in `docs/UI-VERIFICATION.md` or in
      `docs/requirements/done/223-the-flow-gate-is-green-or-says-why.md` matches, where a note records
      that the dev-build decision of story 223 is superseded for the packaged launch.

## Open Questions

- Blocking at once, or non-blocking for 2 releases? The judge proposes gating the packaged step as
  non-blocking for 2 releases, then blocking, so a runner quirk cannot stop a publish unreviewed.
  AC4 as written is silent on this; decide in refine, and if staged, add the flip as its own AC.
- Which flows? The judge says take proven-stable flows from the smoke tier of story 265, not
  wholesale. Order against 265: either 265 names the tier first, or 264 picks a provisional list that
  265 later replaces.
- Does the fake game runner work on Windows for the Play step? If not, the journey flow in AC2 is out
  of scope and a smaller set (launch, config edit, one list view) replaces it.
- Dev build vs production build for the PR flows: only the release step needs the packaged build;
  should the PR lane also move to `npm run build`? The judge leaves this out; confirm.
- Out of scope: running all flows on Windows; any Linux lane change (story 270).

## Decisions (Sprint)

<Leave empty. Filled by `/sprint`'s clarification round and by `/refine 264` when it runs
inside a sprint: one line per decision the user made, with the answer and why. Empty outside
a sprint.>

## Plan

<Leave empty. Filled by `/refine 264`: a short, precise overview — max. ~50 lines.
Concrete steps, affected files, order. No essay.>

## Deliverables

<Leave empty. Filled by `/refine 264`: small pieces, each with its own acceptance
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

<Leave empty. Filled by `/refine 264`: one line per acceptance criterion above, naming the
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

<Leave empty. Filled by `/build 264` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
