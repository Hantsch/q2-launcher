---
id: 278
title: A release runs only when the user starts it, and checks its own commit
status: done # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

The user decided on 2026-10-29 that nothing runs by itself; the process and the user start
things. Today `release.yml` starts on every push to `main`, at the same moment as `ci`. Since
story 266 its `plan` job refuses a commit without a green `ci` run, and at a merge `ci` is still
running — so every merge produces a red release run, and the release has to be dispatched again
by hand once `ci` is green.

A release runs only when the user dispatches it. It does not depend on a separate `ci` run
having finished: it checks the release commit itself before it builds, and a release of a
commit `verify:release` passed does not fail.

## Acceptance Criteria

- [x] **AC1** — No push to `main` starts a release; `release.yml` runs on `workflow_dispatch`
      only.
- [x] **AC2** — A dispatched release runs the blocking `ci` checks on its commit inside the same
      run, before `plan` builds anything, and stops before any build when they fail.
- [x] **AC3** — A release never ends red because another `ci` run is missing or still running.
- [x] **AC4** — The `version`, `bump`, `dry_run` and `skip_ci_guard` inputs keep working.
- [x] **AC5** — `scripts/workflows.test.mjs` fails when `release.yml` gets a `push` trigger back
      or loses its own `ci` checks.
- [x] **AC6** — `CLAUDE.md` (`## Test lanes` `release` row, the "A release needs a green `ci`
      run" key rule) describes the dispatched release.

## Open Questions

~~`ci.yml` also runs on every push to `main`. With the release checking its own commit, that run~~ answered → Decisions (Sprint)
is redundant — drop the push trigger and keep only `pull_request` and `workflow_dispatch`?
~~Decided: Dependabot is removed (`.github/dependabot.yml` deleted). Dependencies are checked in the~~ answered → Decisions (Sprint)
process instead (e.g. `npm outdated` / `npm audit` in `/roadmap check`, a story when something is due).
~~The release job runs `npm test` and typecheck again (~4 min). With AC2 that is a second run of~~ answered → Decisions (Sprint)
the same checks in the same workflow — drop it?

## Decisions (Sprint)

- **(User)** drop ci.yml push trigger and the release job's repeated npm test/typecheck: drop both
- The in-run checks are a `ci` job in `release.yml` whose steps are a verbatim copy of `ci.yml` ›
  `test`, pinned equal by a workflows test — it keeps every blocking step a visible `run:` line
  that `verify:release` (story 277) reads, where a reusable workflow would drag `linux-journey`
  and `ci.yml`'s concurrency group along and a composite action would hide the steps.
- The `ci` job runs on `windows-latest`, the blocking OS (story 276); `matrix.os` conditions
  copied verbatim evaluate false there, so the copy behaves exactly like the Windows leg.
- `skip_ci_guard` keeps its name and now skips the `ci` job, and `plan` logs
  `::warning::ci checks skipped by <actor> for <sha>` — it stays a logged override, only what it
  skips changed.
- A dry run runs the checks too: they need no external run any more, so a dry run becomes a full
  rehearsal instead of an unguarded one.
- `scripts/release-ci-guard.mjs`, `scripts/lib/release/ci-guard.mjs` and its test are deleted and
  `permissions.actions: read` goes: nothing in the release may wait on or read another
  workflow's runs (AC3), and least privilege follows.
- The SHA pinning stays (`plan` outputs the `HEAD` it checked, `build-linux`/`release` refuse any
  other checkout), because `main` can still move between jobs.
- `plan`'s `[skip ci]` push guard goes with the push trigger (dead code); the release commit keeps
  its `[skip ci]` marker — harmless, and `release.mjs` is out of scope.
- AC6 is proven by a doc-vs-workflow consistency rule in the `check:docs` suite, not a prose pin
  in `npm test` — story 279 moves doc-shape tests out of the blocking lane and is built first.
- Review stays default: the one non-obvious trap (a skipped `ci` silently skipping the build
  jobs through the transitive `success()`) is spelled out in D1 and pinned by its test.

## Plan

Order: after 276 (ci.yml Windows-only, build-linux non-blocking), 279 (`check:docs`) and 280
(smoke step) — they edit the same files; build on what they left.

1. `release.yml`: `on: workflow_dispatch` only; new first job `ci` (windows-latest, checkout +
   steps copied verbatim from `ci.yml` › `test`, output `sha`), skipped by `skip_ci_guard`.
   `plan` `needs: ci`, runs when `ci` succeeded or was skipped by the input, replaces the guard
   step with a SHA check + skip warning. `build-linux` and `release` get
   `if: !cancelled() && needs.plan.result == 'success'`. `release` drops `npm test`/typecheck.
   Polling guard scripts deleted.
2. `ci.yml`: drop `push`; `pull_request` + `workflow_dispatch` remain.
3. `CLAUDE.md` key rule + lane rows rewritten; a `check:docs` rule keeps the lane map's push
   triggers honest.

Files: `.github/workflows/{release,ci}.yml`, `scripts/workflows.test.mjs`,
`scripts/lib/release/wiring.test.mjs`, `scripts/lib/build-linux-workflow.mjs`,
`scripts/release-ci-guard.mjs` (del), `scripts/lib/release/ci-guard{,.test}.mjs` (del),
`CLAUDE.md`, the `check:docs` rules file.

## Deliverables

- **D1 — The release runs on dispatch and checks its own commit.** Touches
  `.github/workflows/release.yml`, `scripts/workflows.test.mjs` (`describe('release workflow')`),
  `scripts/lib/release/wiring.test.mjs`, `scripts/lib/build-linux-workflow.mjs` (and
  `scripts/build-linux-workflow.test.mjs` only if it breaks); deletes
  `scripts/release-ci-guard.mjs`, `scripts/lib/release/ci-guard.mjs`,
  `scripts/lib/release/ci-guard.test.mjs`.
  - `on:` keeps only `workflow_dispatch` with the same four inputs (`version`, `bump`, `dry_run`,
    `skip_ci_guard`; `skip_ci_guard` description → "Skip the in-run ci checks (logged in the
    run)"). Drop `permissions.actions`.
  - New first job `ci`: `runs-on: windows-latest`, `if: ${{ !inputs.skip_ci_guard }}`; steps =
    `actions/checkout@v4` with `ref: ${{ github.ref_name }}`, a bash step `id: sha` writing
    `sha=$(git rev-parse HEAD)` to `$GITHUB_OUTPUT`, then **exactly** the steps of `ci.yml` ›
    `jobs.test.steps` after its checkout, copied verbatim incl. their `if:` (whatever `ci.yml`
    holds at build time). Job output `sha: ${{ steps.sha.outputs.sha }}`.
  - `plan`: `needs: ci`; its `if` becomes `${{ !cancelled() && (needs.ci.result == 'success' ||
(needs.ci.result == 'skipped' && inputs.skip_ci_guard)) }}`. Replace the `ci-guard` step by a
    bash step `id: head`: writes `sha=$(git rev-parse HEAD)`; exits 1 with `::error::` when
    `needs.ci.outputs.sha` is non-empty and differs; when `inputs.skip_ci_guard` is true prints
    `::warning::ci checks skipped by $GITHUB_ACTOR for <sha>`. Output
    `sha: ${{ steps.head.outputs.sha }}`. The version step is unchanged.
  - `build-linux` and `release`: `if: ${{ !cancelled() && needs.plan.result == 'success' }}` —
    without it GitHub skips them whenever `ci` was skipped, because the default `success()`
    covers every ancestor job, not only `plan`. If story 276 already gave a job an `if`, AND the
    two. Their "Refuse a commit …" steps stay on `needs.plan.outputs.sha` ("ci guard" → "ci
    checks" in name and message).
  - `release` job: delete the `Test` (`npm test`) and `Typecheck` steps. Rewrite the header
    comment's `plan` line (no guard, no polling). Delete the three guard files.
  - `scripts/lib/build-linux-workflow.mjs`: drop the job's `if` together with its `needs` (act
    runs it without `plan`); its existing test stays green.
  - `wiring.test.mjs`: delete "the job carries a guard that skips a push carrying [skip ci]"; in
    "the release commit carries [skip ci] and the workflow skips such a commit" keep only the
    commit-message half and rename it "the release commit carries [skip ci]".
  - Tests in `scripts/workflows.test.mjs` › `describe('release workflow')`, replacing the three
    there today:
    - "a release starts only by dispatch": `Object.keys(on)` equals `['workflow_dispatch']`.
    - "the release runs the ci checks on its own commit before plan": `jobs.ci['runs-on']` is
      `windows-latest`; `jobs.ci.steps` without the checkout and `sha` steps deep-equals `ci.yml`
      `jobs.test.steps` without its checkout; `[plan.needs].flat()` contains `ci`;
      `build-linux` and `release` need `plan`; no `release.yml` step `run` mentions
      `release-ci-guard`, `actions/workflows` or `gh api`; `permissions.actions` is undefined.
    - "skip_ci_guard skips the checks with a warning and the build jobs still run": `ci.if`
      references `inputs.skip_ci_guard`; `plan.if` contains `!cancelled()` and
      `needs.ci.result`; a `plan` step's `run` contains `::warning::` and `GITHUB_ACTOR`;
      `build-linux.if` and `release.if` contain `!cancelled()` and
      `needs.plan.result == 'success'`.
    - "later release jobs refuse a commit plan did not see": the existing test, same substance.
    - "the release job runs no second unit test or typecheck": the `release` job's runs contain
      neither `npm test` nor `npm run typecheck`.

- **D2 — ci runs on PRs and dispatch; the docs describe the dispatched release.** Touches
  `.github/workflows/ci.yml`, `scripts/workflows.test.mjs`, `CLAUDE.md`, and the `check:docs`
  rules file story 279 created (where the rules of `workflows.test.mjs` ›
  `describe('lane map in CLAUDE.md')` now live; runner `scripts/check-docs.mjs`).
  - `ci.yml`: remove the `push` trigger; keep `pull_request: branches: [main]` and
    `workflow_dispatch`. Test in `scripts/workflows.test.mjs` › "ci runs on pull requests into
    main and on dispatch only": `Object.keys(ci.on).sort()` equals
    `['pull_request', 'workflow_dispatch']`.
  - `CLAUDE.md`: the key rule "A release needs a green `ci` run on its SHA" becomes one bullet: a
    release runs only when dispatched; its `ci` job runs `ci.yml`'s blocking checks on the
    release commit before `plan`, and a failure stops it before any build; `skip_ci_guard` skips
    them and is logged; dry runs run them too. `## Test lanes`: `pr-unit` trigger → "PR into
    main, manual (`ci.yml`)"; `release` trigger → "manual (`release.yml`)", command begins "`ci`
    checks on the commit, `plan`, …" (no `ci-guard`). Leave the other cells as 276/280 left them;
    run `npm run format`.
  - New `check:docs` rule "a lane's trigger names push only for workflows that run on push": for
    every lane-map row, each `` `*.yml` `` it names has `push` in its `on:` exactly when the
    row's Trigger cell contains `push`. Fails on today's `CLAUDE.md`.

## Model Hints

Review: → default

## Acceptance Tests

- AC1 → unit `scripts/workflows.test.mjs` › "a release starts only by dispatch" (D1)
- AC2 → unit `scripts/workflows.test.mjs` › "the release runs the ci checks on its own commit
  before plan" (D1). Manual residue for the runtime half: the first dispatched release shows
  `ci` → `plan` → builds on GitHub — act cannot run the `windows-latest` `ci` job.
- AC3 → unit `scripts/workflows.test.mjs` › "the release runs the ci checks on its own commit
  before plan" (no workflow-run query, `actions: read` gone) (D1)
- AC4 → unit `scripts/lib/release/wiring.test.mjs` › "workflow_dispatch exposes exactly version,
  bump, dry_run and skip_ci_guard as inputs" (existing) and `scripts/workflows.test.mjs` ›
  "skip_ci_guard skips the checks with a warning and the build jobs still run" (D1)
- AC5 → the AC1 and AC2 tests are the tripwire: a `push` trigger back turns "a release starts
  only by dispatch" red; a removed or drifted `ci` job turns "the release runs the ci checks on
  its own commit before plan" red (D1)
- AC6 → `check:docs` › "a lane's trigger names push only for workflows that run on push" (D2)

## Done

**Summary.** `release.yml` is dispatch-only and carries its own `ci` job (windows-latest, a verbatim copy of `ci.yml` > `test`); `plan` needs it (or its `skip_ci_guard` skip, logged as a warning) and pins the SHA; `build-linux`/`release` run on `!cancelled() && needs.plan.result == 'success'`. The polling guard scripts, `permissions.actions` and the release job's second test/typecheck are gone. `ci.yml` runs on PRs and dispatch only; CLAUDE.md key rule and lane rows describe the dispatched release; a `check:docs` rule keeps lane push triggers honest.

**Commit message:** `278: release runs on dispatch only and checks its own commit - in-run ci job, guard scripts removed, ci.yml no push trigger`

**Verification (narrow gate).** typecheck, lint green; `npx vitest run --changed HEAD` 34 tests green; release/workflow/build-linux suites 82 tests green; `npm run check:docs` 69 green. No build/e2e: no UI or app code touched. Review 1 (default): PASS.
AC -> test: AC1 "a release starts only by dispatch"; AC2/AC3 "the release runs the ci checks on its own commit before plan"; AC4 wiring "workflow_dispatch exposes exactly version, bump, dry_run and skip_ci_guard as inputs" + "skip_ci_guard skips the checks with a warning and the build jobs still run"; AC5 the AC1/AC2 tests; AC6 check:docs "a lane's trigger names push only for workflows that run on push" - all passed.
Manual residue: AC2 runtime half - the first dispatched release must show `ci` -> `plan` -> builds on GitHub (act cannot run the windows `ci` job).

**Decisions.**

- Docs-lane rules live in `scripts/project-docs.docs.test.mjs` (story 279's file), not a separate rules file; its old "release needs a green ci run on its SHA" test was rewritten to the new bullet.
- `linuxJobs()` in `workflows.test.mjs` skips release.yml and the `PUSH_PR_EXCEPTED` exception is removed (release no longer push-triggered); `build-linux` keeps its own test.
- Unfixed review findings (test strength, not bugs): `ci` `sha` output / `plan` `head` step not asserted directly; `plan.if` pinned by substring only; `npm test` check matches whole elements; `ci` job inherits top-level `contents: write`; stale describe name "three jobs" in wiring.test.mjs (now four jobs).

tiers: D 2 / hard 0 · review default · cycles 1 · agents 5
