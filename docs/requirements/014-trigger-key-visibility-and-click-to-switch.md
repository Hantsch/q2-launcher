---
id: 014
title: Show an alt-layer trigger's action on its own keycap, and switch layers by clicking it
status: draft
created: 2026-08-18
---

## Requirement

As a user, when I bind a key as an alt layer's trigger, I want that key's role to be obvious
directly on the keyboard overview — today I bound "-" as the "Test" layer's trigger and the
board gives no sign of it. The trigger key should stand out (distinct from a normal bound key)
and name the layer it leads to. Because releasing/toggling a trigger always returns to the base
layer, the same key should read "Base" while its own layer is the one currently shown — it is
a two-way switch, not a one-way jump. Clicking the trigger key on the board should switch which
layer is currently shown, the same as picking it from the layer switcher.

Confirmed while working through the feedback: the existing "Bound in an alt layer" legend/badge
should stay — it is not confusing once you know the rest of the keyboard isn't touched, only the
keys a layer actually overrides get rebound differently while that layer is active.

## Acceptance Criteria

- [ ] A key that is a layer's trigger is visually distinct from both a normal bound key and a
      free key (e.g. its own color/highlight), on every layer view where that key is visible.
- [ ] While viewing the base layer, a trigger key's label names the layer it switches into (e.g.
      "Test").
- [ ] While viewing the layer that key triggers, the same key's label instead reads "Base" (or
      equivalent), reflecting that using it now returns to the base layer.
- [ ] Clicking a trigger key on the board (outside of test/edit mode, or in whatever mode this
      ends up living) switches the currently shown/edited layer, equivalently to using the layer
      switcher from the companion story on selector placement.
- [ ] A key that is simultaneously a trigger and carries its own base bind (flagged today as a
      conflict, trigger wins) still shows the trigger state as primary, per existing precedent.
- [ ] The "Bound in an alt layer" legend entry is kept, unchanged in meaning.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
