---
id: 279
title: Doc-shape tests leave the blocking unit lane
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

About 50 tests in about eight files assert on Markdown prose: the roadmap's follow-up line count,
TECH-DEBT row format, sentences in `docs/ARCHITECTURE.md` and `docs/systems/`, the `CLAUDE.md`
deviation rows and lane-map shape, links between docs. They run in `npm test`, so in every PR and
in the release job. Since S33 they were six of the eleven red unit tests in sprint gates, and the
cause of the red S36 PR on 2026-10-29; none of them found a product defect. The sprint process
edits these docs all the time, so the rules break where docs are written, not where code is.

Doc rules are checked where docs are written — `/roadmap check` and sprint phase 3 — and never
block a PR or a release. Code rules stay in the blocking lane.

## Acceptance Criteria

- [ ] **AC1** — `npm test` runs no test that asserts on the prose or shape of a project doc
      (`docs/**/*.md`, `CLAUDE.md`, `.claude/**/*.md`, `README.md`). Tests of Markdown the
      product or the release reads (`CHANGELOG.md` for release notes and the release plan) stay.
- [ ] **AC2** — `npm run check:docs` runs every moved rule and exits non-zero on a violation; a
      rule dropped instead of moved is listed in this story's Done with its reason.
- [ ] **AC3** — `.claude/ai-scrum.md` `## Notes` has `/roadmap check` and sprint phase 3 run
      `npm run check:docs` and fix a violation in the doc before the review commit.
- [ ] **AC4** — The code rules stay in `npm test`: layering and architecture, the comment rule,
      IPC coverage, repo hygiene on source files.
- [ ] **AC5** — `CLAUDE.md` `## Test lanes` has a `docs` row (local, `npm run check:docs`,
      blocks no PR or release).

## Open Questions

- Should `check:docs` also run on PRs as a warning-only step (yellow, never red), or stay local?

## Decisions (Sprint)

## Plan

## Deliverables

## Done
