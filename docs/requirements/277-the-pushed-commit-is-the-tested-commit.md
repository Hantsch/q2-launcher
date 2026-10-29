---
id: 277
title: The pushed commit is the tested commit
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

On 2026-10-29 the S36 PR went red on `fca1c8e` — the sprint review commit, made after the
regression gate and `verify:release`, which nothing had tested. Its roadmap edit broke a unit
test; format check, typecheck, lint and the unit tests together take about 70 seconds locally and
would have caught it. `verify:release` reaches the format check only inside act, after about
eight minutes.

Every commit that leaves the machine has passed the checks the blocking `ci` job runs, and the
release verification fails on a cheap check within minutes, not after the expensive ones.

## Acceptance Criteria

- [ ] **AC1** — `npm run check` runs the format check, typecheck, lint and unit tests, in that
      order, and stops at the first failure.
- [ ] **AC2** — `git push` runs `npm run check` through a pre-push hook versioned in the repo and
      refuses the push when it fails; `npm ci` / `npm install` installs the hook with no manual
      step, and installs without error where there is no `.git` (act, the `verify:release`
      snapshots).
- [ ] **AC3** — The hook judges the pushed commit: an uncommitted fix does not let a broken
      commit through, and an uncommitted breakage does not refuse a good one.
- [ ] **AC4** — `npm run verify:release` runs the format check, typecheck, lint and unit tests
      before `ui:verify` and any packaging, and stops there on the first failure; a seeded
      format error fails it in under three minutes.
- [ ] **AC5** — `CLAUDE.md` `## Test lanes` has a `pre-push` row (local, every push,
      `npm run check`, blocks the push), and `.claude/ai-scrum.md` `## Notes` says that sprint
      phase 3's doc edits are covered by `npm run check` before the review commit.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Done
