---
id: 246
title: an installation with several engines lets me choose one
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player whose Quake II folder holds more than one engine (e.g. `r1q2.exe` and `q2pro.exe`), the
launcher shows every engine it found and lets me choose which one the installation starts.

User feedback 2026-10-04: a Quake installation can contain several engines; if several are detected
the user should be able to change the engine. One user's `q2pro.exe` was not recognised although it
was in the Quake folder.

Today (`src/main/services/inspector.ts`, `src/shared/types/engine.ts`):

- detection checks the root against an ordered table and **the first match wins** — `r1q2` comes
  before `q2pro`, so a folder with both is r1q2;
- an installation has exactly one `engineKind` and one `executablePath`; the path is only set when
  empty, so a `q2pro.exe` added later never replaces a stored `r1q2.exe`;
- there is no UI to choose the engine; only a "select executable" fix appears when a check fails.

That explains the report: q2pro.exe was present but shadowed by r1q2.

## Acceptance Criteria

- [ ] **AC1** — Detection reports every known engine whose executable is in the installation root,
      not only the first match.
- [ ] **AC2** — A folder with both `r1q2.exe` and `q2pro.exe` lists both engines on the installation.
- [ ] **AC3** — With more than one engine detected, the installation offers an engine choice (library
      card/installation settings); choosing one changes what Play starts, and the choice persists.
- [ ] **AC4** — The installation's engine badge, the config module's engine-specific settings and the
      launch arguments follow the chosen engine.
- [ ] **AC5** — An engine added to the folder later appears after the next revalidation; the user's
      choice is not changed by it.
- [ ] **AC6** — If the chosen engine's executable disappears, the installation reports it and offers
      the other detected engines, instead of silently switching.
- [ ] **AC7** — Unsupported engines (yquake2, kmquake2 …) are listed as detected but cannot be
      chosen; the reason shows as visible text.
- [ ] **AC8** — Existing installations keep their current engine after the update.

## Open Questions

- **Q1** — Demo playback needs Q2PRO: when an installation has q2pro.exe but r1q2 is chosen, should
  demos still play with its Q2PRO? Recommendation: yes — playback uses the installation's Q2PRO if
  one is detected, and says so.
- **Q2** — Config profiles are engine-specific (cvar defaults differ). Does switching the engine keep
  the active profile? To be decided in refine with the config module.
- **Q3** — Default for a new installation with two engines: q2pro or r1q2? Recommendation: q2pro
  (needed for demos, the current recommendation in the bootstrap manifest).

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
