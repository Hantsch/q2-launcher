---
id: 277
title: verify:release checks exactly what a PR and a release check, cheap steps first
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

On 2026-10-29 the S36 PR went red on `fca1c8e` — the sprint review commit, made after the
regression gate and `verify:release`, which nothing had tested. The user's goal: after every
sprint the project is releasable, and opening a PR or starting a release does not fail.

The user decided that nothing runs by itself — no git hook, no watcher; the sprint process runs
the checks (`.claude/ai-scrum.md` `## Notes`: `verify:release` is the sprint's last step, after
`/roadmap check`). For that step to mean "the PR and the release will pass", `verify:release` has
to run every blocking check those run, fail within minutes on a cheap one, and say afterwards
which commit it verified.

Today it misses the `ci` audit step and the core-journey flows `windows-verify` blocks on, and it
reaches the format check only inside act, after about eight minutes.

## Acceptance Criteria

- [ ] **AC1** — `npm run check` runs the format check, typecheck, lint and unit tests, in that
      order, and stops at the first failure.
- [ ] **AC2** — `npm run verify:release` runs every blocking step of the PR workflows and the
      release job on Windows — the `ci` audit included, `windows-verify`'s `ui:verify` and every
      flow it runs. The list is read from the workflow files, so a blocking step added to a PR
      workflow and missing from `verify:release` fails a test.
- [ ] **AC3** — `verify:release` runs `npm run check` before `ui:verify` and any packaging, and
      stops there on the first failure; a seeded format error fails it in under three minutes.
- [ ] **AC4** — `verify:release` leaves a local, uncommitted record of the commit it verified,
      the `origin/main` it merged into and the result; `npm run verify:release -- --status` says
      whether the current `HEAD` is that verified commit and whether `origin/main` has moved
      since.
- [ ] **AC5** — `CLAUDE.md` `## Test lanes` names `npm run check` and the `--status` call in the
      `release-prep` row.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Done
