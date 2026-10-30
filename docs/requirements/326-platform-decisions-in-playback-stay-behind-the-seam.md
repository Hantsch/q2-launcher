---
id: 326
title: Platform decisions in playback stay behind the seam
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-005 and TD-023: platform decisions in the playback channel leak outside its seam,
and the X11 stage keeper drops fire-and-forget X errors, supports only the Local/Wild auth families,
reports park geometry as placed and has a cinema ABOVE ordering edge. Linux is an additional target
(story 276): this story makes the code honest; Linux results stay advisory.

## Acceptance Criteria

- [ ] **AC1** — No file outside the playback channel's platform seam branches on `process.platform`
      for playback; a check enforces it (TD-005).
- [ ] **AC2** — An X error from a fire-and-forget request is logged with its request (TD-023).
- [ ] **AC3** — The stage keeper reports a parked window as parked, not placed (TD-023).
- [ ] **AC4** — An unsupported X auth family is refused with a named reason instead of failing
      silently (TD-023).
- [ ] **AC5** — Rows TD-005 and TD-023 are removed from `docs/TECH-DEBT.md`; what only a real X11
      session can show is manual residue for the local Linux run.

## Open Questions

- Cinema ABOVE ordering: fix it, or keep it as a documented limitation?

## Decisions (Sprint)

## Plan

## Deliverables

## Done
