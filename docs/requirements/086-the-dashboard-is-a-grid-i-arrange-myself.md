---
id: 086
title: The dashboard is a grid I arrange myself
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

Below the news hero is my half of the screen. I decide what sits there, where it sits and how big
it is — and the launcher never rearranges it behind my back. Whoever only cares about config
profiles builds a screen of config; whoever plays a lot builds a screen of playtime.

Editing is deliberate: normally the tiles are just content and nothing can be dragged by
accident. I switch on arrange mode, and only then handles, resize grips and a catalog of the
tiles I have not placed appear. Everything I can do with the mouse I can do with the keyboard,
and the app tells me what happened while I do it. What I arrange is saved as it happens, survives
a restart, and can be put back to the default in one step.

This story is the grid, the mode and the persistence — the tiles that go in it are story 087. See
[concepts/home-screen.md](../concepts/home-screen.md) §8.

## Acceptance Criteria

- [ ] **AC1** — The grid is 12 columns wide with 40px rows; a tile stores `x`, `y`, `w`, `h` in
      cells, and gaps are kept — the layout is never compacted by the launcher.
- [ ] **AC2** — Columns shrink proportionally with the window; below the narrow threshold the grid
      renders as a single column in layout order, and the stored layout is unchanged by that
      (widening restores the arrangement exactly).
- [ ] **AC3** — Outside arrange mode no drag or resize can start, and tiles behave as ordinary
      clickable content.
- [ ] **AC4** — Entering arrange mode moves no tile: the catalog bar and the status line are
      docked over the dashboard, not pushed into its flow.
- [ ] **AC5** — A move or resize that would overlap another tile, leave the grid, or go below the
      tile's minimum size is refused, and is shown as invalid while dragging rather than silently
      snapping back.
- [ ] **AC6** — The catalog lists exactly the modules that are not currently placed; an entry can
      be dragged into the grid or placed with Enter at the first free spot that fits it.
- [ ] **AC7** — A placed tile can be returned to the catalog from arrange mode.
- [ ] **AC8** — Keyboard parity: Space/Enter on a handle lifts, arrows move one cell,
      Shift+arrows resize by one cell, Enter drops, and Esc, blur or Tab cancels and restores the
      placement the tile had before the lift.
- [ ] **AC9** — Every lift, move, resize, drop and cancel is announced in a live region and
      mirrored in a visible status line.
- [ ] **AC10** — Each change is persisted as it happens, in its own `state.json` key with its own
      schema and defensive parse; `LauncherSettings` gains no field.
- [ ] **AC11** — A stored record for an unknown module id is dropped on load, and a module that is
      missing from the layout is not auto-inserted.
- [ ] **AC12** — "Reset to default" restores the shipped default layout after a confirmation.
- [ ] **AC13** — The layout engine (place, move, resize, collide, stack, first free spot) is a
      pure, unit-tested module.
- [ ] **AC14** — Arrange mode, the catalog and the narrow single-column state are in the
      `ui:verify` registry with a `ui:flow` script for the arrange interaction, at zero axe
      violations.

## Open Questions

- Where is the narrow-window threshold, measured from where a 1 × 2 tile stops being readable?
  (Concept open point 2, placeholder 900px.)
- What is each module's minimum size in cells? (Concept open point 4 — the default layout is
  fixed at two tiles of 6 × 5, the floor is not.)
- Where does the arrange control sit — home screen header, titlebar utility row, or both?
  (Concept open point 10, interacts with the recorded titlebar token deviation.)

## Plan

_Filled by `/refine 086`._

## Deliverables

_Filled by `/refine 086`._

## Model Hints

_Filled by `/refine 086`._

## Acceptance Tests

_Filled by `/refine 086`._

## Done

_Filled by `/build 086`._
