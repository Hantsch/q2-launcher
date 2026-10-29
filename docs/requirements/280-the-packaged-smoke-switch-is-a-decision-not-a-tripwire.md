---
id: 280
title: The packaged smoke's blocking switch is a decision, not a tripwire
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

Story 264 made the release job's packaged launch smoke non-blocking, and `scripts/workflows.test.mjs`
› "the packaged smoke step's continue-on-error matches the released count" reads `CHANGELOG.md`:
once the second release past 0.8.0 is in it, the next PR goes red until someone edits
`release.yml`. A test that turns red on its own schedule is a planned red PR.

Whether the packaged smoke blocks a release is decided once by the user and pinned, and no test
changes its verdict because a release happened.

## Acceptance Criteria

- [ ] **AC1** — No test's verdict depends on how many releases `CHANGELOG.md` lists.
- [ ] **AC2** — The packaged smoke step blocks or does not block the release as the user decided,
      and a workflows test pins that.
- [ ] **AC3** — When it does not block, a failing smoke ends the step with a `::warning::`
      annotation, not a red step.

## Open Questions

- Does the packaged launch smoke block the release from now on, or stay a warning for good?

## Decisions (Sprint)

## Plan

## Deliverables

## Done
