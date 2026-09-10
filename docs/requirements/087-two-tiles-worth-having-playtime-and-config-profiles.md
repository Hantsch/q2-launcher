---
id: 087
title: Two tiles worth having — playtime and config profiles
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

An empty grid is a promise, not a feature. The dashboard ships with the two things the launcher
already knows about me: what I have installed and played, and which config profiles I keep. Both
are real tiles with real data — no placeholder, no "coming soon", and nothing for a module that
does not exist yet.

A tile must be honest about its own state: it says when it is still loading, when its data source
failed (and lets me retry), when there is genuinely nothing to show, and otherwise shows the
content. That behaviour lives in the tile frame, once, so a failing data source degrades the same
way everywhere.

Fresh installs start on the composition the prototype decided: the two tiles side by side under
the 320px hero. See [concepts/home-screen.md](../concepts/home-screen.md) §8.4 and §11.

## Acceptance Criteria

- [ ] **AC1** — A "Playtime & statistics" tile shows installations by status and engine,
      favourites, total playtime and the last session, from the `library` module's existing stats
      handler.
- [ ] **AC2** — A "Config profiles" tile lists profiles with their sync and care state, and
      opening one jumps into the config editor for that profile.
- [ ] **AC3** — The dashboard offers exactly these two modules; Gamebrowser, Friendlist,
      Downloads, Mods and Assets appear neither in the grid nor in the catalog.
- [ ] **AC4** — Every tile renders one of four explicit states — loading, error with a working
      retry, empty with a sentence and an action, filled — through one shared tile frame.
- [ ] **AC5** — A tile whose data source fails does not break the dashboard: the other tile keeps
      working and arrange mode still functions.
- [ ] **AC6** — The default layout of a fresh profile is the two tiles at 6 × 5 cells each, side
      by side, directly under the 320px hero, matching
      `docs/prototypes/home/a-large-hero.html`.
- [ ] **AC7** — All tile labels are i18n keys; only data crosses IPC as prose.
- [ ] **AC8** — All four states of both tiles are in the `ui:verify` registry, fed from the
      fixture, at zero axe violations.

## Open Questions

- What does each tile refuse to shrink below, in cells? (Concept open point 4 — shared with 086.)
- Does the Config profiles tile show all profiles or only those of the active installation, and
  what does it do when there are more than fit the tile?

## Plan

_Filled by `/refine 087`._

## Deliverables

_Filled by `/refine 087`._

## Model Hints

_Filled by `/refine 087`._

## Acceptance Tests

_Filled by `/refine 087`._

## Done

_Filled by `/build 087`._
