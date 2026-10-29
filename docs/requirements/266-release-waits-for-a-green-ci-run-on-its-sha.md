---
id: 266
title: Release waits for a green CI run on its SHA
status: ready # draft -> ready -> in-progress -> done
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

- ~~Guard mechanism: a `plan`-step check of the head SHA's `ci` run (judge's choice, `gh api` on
  check-runs) versus a `workflow_run` trigger. `workflow_run` changes the trigger model and the
  `[skip ci]` handling; decide in refine.~~ answered → Decisions (Sprint)
- ~~Wait or fail? If the push-to-main `ci` run is still in progress when release starts, does the
  guard poll up to N minutes or fail at once? Failing at once means every normal merge needs a
  re-dispatch.~~ answered → Decisions (Sprint)
- ~~Dropping the repeated windows test and typecheck (about 300 s saved) is a later cut that waits
  for the packaged smoke of story 264 (judge); AC7 holds them until then.~~ answered → Decisions
  (Sprint)
- ~~Override input name and who may use it; it must be visible in the release run log.~~ answered →
  Decisions (Sprint)
- ~~Verifying the guard is only possible through a dry-run dispatch; is that acceptable for AC5?~~
  answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Guard is a plan-step check of the head SHA's ci run that fails at once (no polling, no workflow_run).
- The guard reads the Actions runs of `ci.yml` filtered by `head_sha` (any event: push,
  pull_request, dispatch) and passes only on a completed run with `conclusion: success`; an
  in-progress run fails at once with a "dispatch release again once ci is green" message — reason:
  the binding user decision, and a per-workflow run filter is exact where a check-runs listing mixes
  in other workflows.
- A head that is the release commit (`release: <v> [skip ci]`) is judged by its first parent —
  reason: AC2 wants the feature commit checked, and the release commit never has a `ci` run.
- The override input is `skip_ci_guard` (boolean, default false), usable by anyone who may dispatch
  the workflow, and logged as a `::warning::` naming `github.actor` and the SHA — reason: dispatch
  already requires write access, and an extra actor allowlist would be a policy nobody asked for.
- The windows `npm test`/typecheck steps stay (AC7); dropping them waits for story 264's packaged
  smoke — reason: the review's judge tied that cut to 264.
- AC5 is manual residue on a real dispatch with `dry_run: false` (a dry run passes the guard by AC3)
  on a throwaway branch whose `## Unreleased` is empty, so a broken guard would still be stopped by
  the plan's own refusal one step later — reason: only a real GitHub run with the repo token
  exercises the `gh api` call, and the empty changelog makes that run unable to publish.
- `build-linux` and `release` fail when their checkout of `github.ref_name` is not the SHA `plan`
  guarded — reason: those jobs check the branch out again, and a push landing between jobs would
  otherwise ship a commit the guard never saw.

## Plan

Gate the release on a green `ci` run for the commit being released, inside the existing `plan` job.

1. **Pure decision** `scripts/lib/release/ci-guard.mjs`: `resolveGuardTarget({ headSha,
   headMessage, parentSha })` (release commit → parent) and `decideCiGuard({ dryRun, override,
   targetSha, runs })` → `{ pass, reason }`. Unit-tested over fixtures, no network. The
   release-commit template moves into an exported helper in `plan.mjs` so it is not retyped.
2. **CLI** `scripts/release-ci-guard.mjs`: reads HEAD/HEAD^ via git, fetches
   `gh api repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?head_sha=<sha>&per_page=100`,
   calls the decision, prints the reason (`::warning::` on override), exits 0/1, writes
   `sha=<HEAD>` to `$GITHUB_OUTPUT`.
3. **Wiring** in `.github/workflows/release.yml`: `permissions` gains `actions: read`; dispatch
   input `skip_ci_guard`; step `id: ci-guard` in `plan` after setup-node and before the
   `id: plan` step; `plan` outputs `sha`; `build-linux` and `release` get a step right after
   checkout that fails when `git rev-parse HEAD` ≠ `needs.plan.outputs.sha`. The windows test +
   typecheck steps stay untouched.
4. **Tests**: `scripts/workflows.test.mjs` asserts the guard's placement, the same-commit checks
   and the kept windows steps; `scripts/lib/release/wiring.test.mjs` learns the new input and that
   CLAUDE.md states the rule.
5. **CLAUDE.md**: one Key-rules bullet — a release needs a green `ci` run on its SHA; recovery
   (dispatch release again once `ci` is green) and the logged override.

Order D1 → D2. No product code, no IPC, no CHANGELOG entry (nothing user-visible), no systems doc.
`verify:release` calls `release.mjs --print-plan` directly and is unaffected.

## Deliverables

- [ ] D1 — **Guard decision + CLI.** New `scripts/lib/release/ci-guard.mjs` exporting
      `resolveGuardTarget({ headSha, headMessage, parentSha })` → the SHA to judge (the parent
      when the first line of `headMessage` is a release commit, else `headSha`) and
      `decideCiGuard({ dryRun, override, targetSha, runs })` → `{ pass: boolean, reason: string }`:
      `dryRun` → pass ("dry run, guard not applied"); `override` → pass with a reason saying the
      guard was skipped; otherwise pass iff some item of `runs` (GitHub `workflow_runs` items:
      `head_sha`, `status`, `conclusion`) has `head_sha === targetSha`, `status === 'completed'`
      and `conclusion === 'success'`; a matching run not yet completed fails with a reason telling
      the maintainer to dispatch release again once `ci` is green; no run fails with
      "no successful ci run for <sha>". Release-commit recognition must not retype the template:
      in `scripts/lib/release/plan.mjs` move the message built at line ~140
      (`release: ${version} [skip ci]`) into an exported `releaseCommitMessage(version)` used
      there, plus an exported `isReleaseCommitMessage(message)`; `ci-guard.mjs` imports the latter.
      New CLI `scripts/release-ci-guard.mjs`: reads env `RELEASE_DRY_RUN_INPUT` and
      `RELEASE_SKIP_CI_GUARD_INPUT` (`'true'` = on; both empty on a push), `GITHUB_REPOSITORY`,
      `GITHUB_ACTOR`; gets HEAD, HEAD^ and HEAD's message via `git`; calls `gh api` (spawnSync,
      argv array, no shell) only when neither dry run nor override; prints the reason, and on
      override prints `::warning::ci guard skipped by <actor> for <sha>`; appends `sha=<HEAD>` to
      `$GITHUB_OUTPUT` when set; exits 0 on pass, 1 on fail (also 1 when `gh` fails or returns
      unparsable JSON).
      Test: `scripts/lib/release/ci-guard.test.mjs` over the pure functions only (the release head
      message is built with `releaseCommitMessage('1.0.1')`), test names as in Acceptance Tests
      below. Mirror the existing pure-module + test pairs in `scripts/lib/release/`
      (`version.mjs` / `version.test.mjs`).
      Files: `scripts/lib/release/ci-guard.mjs`, `scripts/lib/release/ci-guard.test.mjs`,
      `scripts/lib/release/plan.mjs`, `scripts/release-ci-guard.mjs`.
- [ ] D2 — **Workflow wiring, its tests, CLAUDE.md.** In `.github/workflows/release.yml`:
      top-level `permissions` adds `actions: read` (keep `contents: write`); `workflow_dispatch`
      gains input `skip_ci_guard` (boolean, default false, description: skips the green-`ci` check,
      logged in the run); in `plan`, a step `name: Require a green ci run`, `id: ci-guard`, after
      `./.github/actions/setup-node-electron` and before the `id: plan` step, `shell: bash`, env
      `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `RELEASE_DRY_RUN_INPUT: ${{ inputs.dry_run }}`,
      `RELEASE_SKIP_CI_GUARD_INPUT: ${{ inputs.skip_ci_guard }}`, run
      `node scripts/release-ci-guard.mjs`; `plan.outputs` gains `sha: ${{ steps.ci-guard.outputs.sha }}`;
      `build-linux` and `release` each get, directly after their `actions/checkout` step, a bash step
      that fails with a clear message when `git rev-parse HEAD` differs from
      `${{ needs.plan.outputs.sha }}` (passed through `env`, not inlined in `run`). Leave the windows
      `Test` / `Typecheck` steps and everything else unchanged; the header comment gains one line
      for the guard.
      Tests: in `scripts/workflows.test.mjs` a new `describe('release workflow')` with
      "the release plan requires a green ci run before any build job" (a `plan` step has
      `id: ci-guard` and runs `scripts/release-ci-guard.mjs`, its index is lower than the `id: plan`
      step's, and `build-linux` and `release` both list `plan` in `needs`), "later release jobs
      refuse a commit the guard did not see" (in `build-linux` and `release` the step after checkout
      references `needs.plan.outputs.sha`; `permissions.actions` is `read`) and "the release job
      still runs unit tests and typecheck on windows" (`release` step `run`s include `npm test` and
      `npm run typecheck`). In `scripts/lib/release/wiring.test.mjs` update the dispatch-inputs
      assertion (line ~132) to include `skip_ci_guard`, and add "CLAUDE.md states that a release
      needs a green ci run on its SHA" (reads `CLAUDE.md`; some line contains `green`, `ci` and
      `SHA`). In `CLAUDE.md` add one bullet under `## Key rules`: **A release needs a green `ci` run
      on its SHA** — the release `plan` job refuses otherwise, also right after a merge while `ci`
      is still running (dispatch release again once it is green); `skip_ci_guard` overrides and is
      logged; dry runs are not guarded.
      Files: `.github/workflows/release.yml`, `scripts/workflows.test.mjs`,
      `scripts/lib/release/wiring.test.mjs`, `CLAUDE.md`.

## Model Hints

Both deliverables on the default tier: a pure function over fixtures and a YAML wiring change,
each pinned by tests.

Review: → default

## Acceptance Tests

- AC1 → unit `scripts/lib/release/ci-guard.test.mjs` › "a feature commit without a successful ci
  run is refused" and › "an in-progress ci run is refused at once", with unit
  `scripts/workflows.test.mjs` › "the release plan requires a green ci run before any build job"
  proving the decision is wired into `plan`; the live run is AC5's residue.
- AC2 → unit `scripts/lib/release/ci-guard.test.mjs` › "a release commit is judged by its parent's
  ci run" and › "a feature commit without a successful ci run is refused".
- AC3 → unit `scripts/lib/release/ci-guard.test.mjs` › "a dry run passes without any ci run" and ›
  "the override passes without any ci run and says the guard was skipped".
- AC4 → unit `scripts/workflows.test.mjs` › "the release plan requires a green ci run before any
  build job".
- AC5 → **manual residue:** needs a real GitHub Actions run (repo token, `gh api` against the live
  Actions API). The maintainer dispatches `release` with `dry_run: false` on a throwaway branch with
  no `ci` run and an empty `## Unreleased`; the run must fail at "Require a green ci run"; the run
  link goes into Done.
- AC6 → unit `scripts/lib/release/wiring.test.mjs` › "CLAUDE.md states that a release needs a green
  ci run on its SHA".
- AC7 → unit `scripts/workflows.test.mjs` › "the release job still runs unit tests and typecheck on
  windows".

## Done

<Leave empty. Filled by `/build 266` after implementation:
- Short summary (2–5 lines): what was done.
- Commit message (1–2 lines, keywords are enough).
- Verification: build/test/lint result + review outcome; open points/blockers, if any.>
