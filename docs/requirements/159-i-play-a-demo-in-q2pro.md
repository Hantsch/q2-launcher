---
id: 159
title: I play a demo in Q2PRO
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user clicks **Play** on a demo and it starts in the real engine — no console, no remembering the
file name, no dialog on every play (concept `docs/concepts/demo-browser.md` §11, DEMO-21, DEMO-22).

The launcher picks the engine itself: a **Q2PRO** installation that has the demo's game dir, the
**active** installation preferred; the user can override the choice for this play. If no
installation has the game dir, Play is disabled with "Mod `<gamedir>` missing". The launch is
`+set game <gamedir>` + `+demo <relative path>` through the existing `buildLaunchArgs` `extraArgs`
path — **never `demomap`** on Q2PRO, because `demomap` executes stufftext from the demo and a file
from a stranger could run commands (§4). Demos never change the game dir themselves, so the launcher
has to pass it.

This story plays demos that already sit inside the chosen installation's `<gamedir>/demos/`;
everything that needs a temporary copy is [[160]], r1q2 is [[161]], MVD2 specifics are [[162]], the
timeline is [[165]].

## Acceptance Criteria

- [ ] **AC1** — Play on a demo starts a Q2PRO installation that has the demo's game dir; if several
      qualify, the active installation is chosen, else the rule decided in Q1.
- [ ] **AC2** — The user can pick a different qualifying installation for this play; the choice
      does not change the active installation.
- [ ] **AC3** — With no installation that has the demo's game dir, Play is disabled with the visible
      text "Mod `<gamedir>` missing".
- [ ] **AC4** — The launch arguments are exactly `+set game <gamedir>` and `+demo <path relative to
      the game dir's demos>`; a unit test asserts `demomap` never appears for Q2PRO.
- [ ] **AC5** — The play handler takes the demo's id and the chosen installation's id only; main
      resolves and validates the path, and a demo outside that installation's file system is not
      launched in place.
- [ ] **AC6** — While the demo plays, the launcher treats it as a running game (game-lifecycle), the
      same as a normal launch.
- [ ] **AC7** — On Linux with no Q2PRO installation, Play is disabled with its reason as visible text
      (concept §13, `linux-support-analysis.md` B1).
- [ ] **AC8** — An e2e flow plays a fixture demo against a stubbed engine process; no test starts a
      real engine.

## Open Questions

- [ ] **Q1 — Tie-break** — several qualifying installations and none active: most recently played,
      alphabetical, or ask once?
- [ ] **Q2 — Where Play lives** — detail view only, or also on the row?

## Plan

<!-- Filled by /refine 159, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 159. -->

## Model Hints

<!-- Filled by /refine 159. -->

## Acceptance Tests

<!-- Filled by /refine 159. -->

## Done

<!-- Filled by /build 159. -->
