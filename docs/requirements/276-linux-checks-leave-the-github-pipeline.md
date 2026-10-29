---
id: 276
title: Linux checks leave the PR and release path and are never red
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

Linux is not a supported platform: it is an additional target, qualified by hand. The user decided
on 2026-10-29:

- Linux checks leave every PR and release workflow; they never block a PR or a release.
- A Linux check is never red — at most yellow (a warning).
- Linux checks run locally after a sprint, and sprints still take Linux into account: the result
  is part of the sprint review, its findings become TECH-DEBT rows or follow-ups.
- `verify:release` stops running Linux workflows under act (the open question of the first draft).

Today the `ubuntu-latest` leg of `ci.yml` `test`, the `linux-journey` job, the Linux shards of
`ui-flows.yml`, `linux-verify.yml` and `linux-update.yml` trigger on push/PR (advisory, but shown
red), `verify:release` runs ~11 of its ~17 minutes as Linux workflows under act and treats them as
blocking, and a failed `build-linux` refuses the whole release.

The `linux-user-journey` flow that `windows-verify` runs on Windows is a Windows check and stays.
The release `plan` job runs on an Ubuntu runner but checks nothing about Linux; it stays.

## Acceptance Criteria

- [ ] **AC1** — No workflow triggered by `push` or `pull_request` runs a Linux check: `ci.yml`
      `test` runs on `windows-latest` only (the audit and the format check move to that leg),
      and `linux-journey`, the Linux `ui-flows` shards, `linux-verify.yml` and `linux-update.yml`
      run only on `workflow_dispatch`.
- [ ] **AC2** — A failing Linux check on a manual GitHub run ends with a green job and a
      `::warning::` annotation naming what failed — never a red job.
- [ ] **AC3** — `npm run verify:linux` runs every Linux check locally (act + Docker): the Linux
      unit tests, the Linux journey flows, `linux-verify`, `linux-update`, the Linux flow shards
      and the AppImage build. It prints a failure as a warning and exits 0; it exits non-zero only
      when it could not run (no act, no Docker).
- [ ] **AC4** — `npm run verify:release` runs no Linux workflow and no act step.
- [ ] **AC5** — A failing `build-linux` does not stop a release: the release publishes the
      Windows assets, the run ends green with a warning naming the missing AppImage, and
      `release.mjs` accepts a release without Linux assets.
- [ ] **AC6** — After the regression gate, `/sprint` runs `npm run verify:linux` once and the
      review records it as advisory (green / yellow with the failing checks); a Linux finding
      becomes a TECH-DEBT row or a follow-up, never a gate fix or a merge blocker. Recorded in
      `.claude/ai-scrum.md` `## Notes` (`sprint.md` is plugin-managed).
- [ ] **AC7** — `CLAUDE.md` `## Test lanes`: the `linux` row reads local, after the sprint gate,
      `npm run verify:linux`, advisory; the `pr-unit`, `pr-ui` and `release` rows and the text
      below the table mention no Linux job.
- [ ] **AC8** — `scripts/workflows.test.mjs` fails when a `push` or `pull_request` workflow gets
      a Linux job or an `ubuntu-latest` test leg back, or when a manual Linux job can end red.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Done
