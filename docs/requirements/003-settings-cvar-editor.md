---
id: 003
title: Settings/cvar editor with per-engine defaults and clamps
status: draft
created: 2026-08-14
---

## Requirement

As a user, I want to edit player and graphics cvars for a profile, seeing each engine's
default, clamp range and any special-value warning, so I don't have to guess safe values per
engine or discover surprises like `r_maxfps 0` meaning "5 FPS" on R1Q2 the hard way.

Engine facts (defaults, clamps, per-engine meaning of the same value) are carried over from
q2-config-manager's `src/core/settings.ts` (source-cited against r1q2/Q2PRO/vanilla source —
see [docs/concepts/config-module.md](../concepts/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned)).
Cvar values are stored on the profile (story 001); which engines apply comes from the
installations the profile is assigned to (story 002). Writing the result to disk is story 004.

## Acceptance Criteria

- [ ] Each cvar control shows the current value alongside the engine's default and the range
      that engine clamps to.
- [ ] A value the engine treats specially (e.g. `r_maxfps 0`) is flagged with an explanation of
      what actually happens.
- [ ] A cvar the engine doesn't support is named/shown rather than silently omitted.
- [ ] When a profile is assigned to installations with different engines, the view makes clear
      which engine's defaults/clamps/warnings are being shown for each cvar.
- [ ] Cvar edits are saved on the profile and survive an app restart.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
