---
id: 230
title: comments state invariants, not sprint history
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a reader without the story archive I want a comment to tell me the rule or the non-obvious
reason, not which deliverable of which review round introduced the line, so that the densest
files read as code again, headers are not the opposite of what the file does, and leftover
diagnostics do not spam the user's log.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F38): ~4,800 story
references in non-test source across 778 files; comment share is 55 % in `profile-restore.ts`
(a 254-line header essay), 55 % in `render.ts`, 57 % in `shared/modules/servers.ts`, 26 % in
`ControlsTab.tsx` (139 references), 135 of 580 lines in `useLauncher.ts`. Forms like "story-045
review round 2, finding 4", "Reversed by story 079 (was: …)", "Story 067 review finding F1 (third
round)". Stale headers: `servers/index.ts` says "There is no scanning yet" above a file wiring
scan, cadence, watchlist and LAN; `replays/index.ts` says "no process.platform checks" while
using it three times; `modules/index.ts` narrates a superseded stand-in. Three `[diag187]`
`log.info` lines remain in production.

Depends on story 227 (the comment convention in CLAUDE.md). Priority P3: do the sweep file by
file as those files are opened by other stories, or as a quiet filler.

## Acceptance Criteria

- [ ] **AC1** — The `[diag187]` log lines are deleted or downgraded to `debug`; a test fails on
      any `log.info('[diag` in `src/main`.
- [ ] **AC2** — The headers of `servers/index.ts`, `replays/index.ts`, `modules/index.ts`,
      `profile-restore.ts`, `render.ts` and `rebuild.ts` are rewritten in present tense and state
      what the file does today; none exceeds 40 lines.
- [ ] **AC3** — One bounded sweep over the densest files (`profile-restore.ts`,
      `ControlsTab.tsx`, `lib/schemas.ts`, `shared/modules/{config,downloads,servers,replays}.ts`,
      `scan-service.ts`, `useLauncher.ts`, `ConfigView.tsx`) rewrites history narrative into
      invariants or deletes it; story pointers remain only as trailing `(story NNN)`; narrative
      worth keeping moves to the module's systems doc (story 228). Comment share in each swept
      file drops below 35 %.
- [ ] **AC4** — No `D\d`/`AC\d` deliverable or acceptance-criterion ids remain in non-test source
      (grep-zero for `\bD[1-9]\b` and `\bAC[1-9]\b` inside comments), per the CLAUDE.md
      convention.
- [ ] **AC5** — The story review (`/build`'s clean-agent review) checks new comments against the
      convention; the instruction is in the review prompt.

## Open Questions

- none

## Plan

<!-- Filled by /refine 230. -->

## Deliverables

<!-- Filled by /refine 230. -->

## Model Hints

<!-- Filled by /refine 230. -->

## Acceptance Tests

<!-- Filled by /refine 230. -->

## Done

<!-- Filled by /build 230. -->
