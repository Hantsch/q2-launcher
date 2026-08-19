---
id: 017
title: Overview — editing is the default, no dedicated edit mode
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

On the profile's Overview tab, editing a bind is what I do 95% of the time. Having to arm
"Start edit" first is a toll on every single change. Clicking a keycap should open the bind
dialog straight away — the edit toggle disappears entirely. Test mode stays an explicit mode,
because it grabs the physical keyboard and therefore cannot be the resting state.

The one collision this creates has to be resolved deliberately: a layer's trigger keycap
currently switches the displayed layer on click (story 014), and that role has to survive
next to "a click edits this key".

## Acceptance Criteria

- [ ] The Overview header has no edit-mode toggle any more; only Start/Stop test mode remains.
- [ ] Clicking any keycap outside test mode opens `KeyBindDialog` for that key — scoped to the
      base layer or, with a layer selected, to that layer's overrides, exactly as edit mode did.
- [ ] Clicking a layer's trigger keycap still switches the board to/from that layer, and its own
      bind is still editable through a separate, visible affordance on the same keycap.
- [ ] Starting test mode suspends editing (a keycap click captures instead of opening the dialog);
      stopping test mode returns to editing without any further click.
- [ ] Keycap hover/cursor affordance reflects "click edits" everywhere it applies — no keycap
      looks clickable while doing nothing, and none looks inert while being editable.
- [ ] Switching profiles resets test mode; there is no edit-mode state left to reset.

## Open Questions

- The trigger keycap's second affordance: a small pencil in the keycap corner, a context menu, or
  a modifier-click? Pick one and use it consistently — it is the only key on the board with two
  actions.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
