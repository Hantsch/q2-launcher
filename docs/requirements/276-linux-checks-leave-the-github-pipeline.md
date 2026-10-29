---
id: 276
title: Linux checks leave the GitHub pipeline and run by hand
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-29
---

## Requirement

The user decided in S36 that Linux is not a supported platform: it is an additional target,
qualified by hand, never part of a pipeline. Today `linux-verify.yml`, `linux-update.yml`, the
`linux-journey` job in `ci.yml` and the Linux job of `ui-flows.yml` still trigger on GitHub as
advisory jobs (found by story 270's review), and the S36 lane map lists them as advisory. They
should run only when the maintainer starts them, and the lane map should say so.

## Acceptance Criteria

- [ ] **AC1** — No push or pull-request workflow starts a Linux job; each Linux workflow/job
      runs only on manual dispatch (or locally via `verify:release` / `rehearse`).
- [ ] **AC2** — The `## Test lanes` table in `CLAUDE.md` lists the Linux lane as manual, with the
      command that runs it.
- [ ] **AC3** — `scripts/workflows.test.mjs` fails when a Linux job gets a `push` or
      `pull_request` trigger back.

## Open Questions

- Does `verify:release` keep running the Linux workflows under act (local, manual), or do they
  leave it too?

## Decisions (Sprint)

## Plan

## Deliverables

## Done
