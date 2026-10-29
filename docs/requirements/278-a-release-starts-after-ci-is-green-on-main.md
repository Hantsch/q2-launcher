---
id: 278
title: A release starts after ci is green on main
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

Since story 266, `release.yml`'s `plan` job refuses a commit without a green `ci` run. But
`release.yml` and `ci.yml` both start on the same push to `main`, so at a merge `ci` is still
running when the guard looks: every merge produces a red release run, and the release has to be
dispatched again by hand once `ci` is green.

A merge into `main` releases by itself once `ci` has passed on that commit, and leaves no red run
behind when it has to wait.

## Acceptance Criteria

- [ ] **AC1** — A merge into `main` starts the release build only after `ci` on that commit has
      completed successfully, with no manual dispatch.
- [ ] **AC2** — While `ci` runs, and when `ci` fails, no release run ends red.
- [ ] **AC3** — A manual dispatch keeps its `version`, `bump`, `dry_run` and `skip_ci_guard`
      inputs and the guard.
- [ ] **AC4** — The `release: x.y.z [skip ci]` commit starts no release.
- [ ] **AC5** — `scripts/workflows.test.mjs` pins the trigger: a release that starts on a push to
      `main` again fails it.

## Open Questions

- The release job runs `npm test` and typecheck again (~4 min) on a commit the guard has already
  seen green; `workflows.test.mjs` pins that on purpose. Keep it, or drop it now that the guard
  exists?

## Decisions (Sprint)

## Plan

## Deliverables

## Done
