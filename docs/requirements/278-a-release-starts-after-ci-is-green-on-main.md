---
id: 278
title: A release runs only when the user starts it, and checks its own commit
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — No push to `main` starts a release; `release.yml` runs on `workflow_dispatch`
      only.
- [ ] **AC2** — A dispatched release runs the blocking `ci` checks on its commit inside the same
      run, before `plan` builds anything, and stops before any build when they fail.
- [ ] **AC3** — A release never ends red because another `ci` run is missing or still running.
- [ ] **AC4** — The `version`, `bump`, `dry_run` and `skip_ci_guard` inputs keep working.
- [ ] **AC5** — `scripts/workflows.test.mjs` fails when `release.yml` gets a `push` trigger back
      or loses its own `ci` checks.
- [ ] **AC6** — `CLAUDE.md` (`## Test lanes` `release` row, the "A release needs a green `ci`
      run" key rule) describes the dispatched release.

## Open Questions

- `ci.yml` also runs on every push to `main`. With the release checking its own commit, that run
  is redundant — drop the push trigger and keep only `pull_request` and `workflow_dispatch`?
- Decided: Dependabot is removed (`.github/dependabot.yml` deleted). Dependencies are checked in the
  process instead (e.g. `npm outdated` / `npm audit` in `/roadmap check`, a story when something is due).
- The release job runs `npm test` and typecheck again (~4 min). With AC2 that is a second run of
  the same checks in the same workflow — drop it?

## Decisions (Sprint)

## Plan

## Deliverables

## Done
