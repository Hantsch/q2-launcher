---
id: 011
title: Assign an alt layer's trigger by binding it to a key, not at creation
status: draft
created: 2026-08-18
---

## Requirement

As a user building an alt layer, I want to create the layer without having to pick a trigger
key up front, and instead assign (or later reassign) its trigger the same way I bind any other
key — by binding a key to "switch into this layer" from the keyboard overview. Today the trigger
key is mandatory at creation time and, per the roadmap's known gap, can never be changed
afterwards — the only way to pick a different trigger is to delete the layer and recreate it,
losing its overrides in the process.

## Acceptance Criteria

- [ ] Creating a layer does not require a trigger key; a layer can exist with no trigger
      assigned yet.
- [ ] A key can be bound to "switch into layer X" from the keyboard overview, the same place
      any other bind happens — this becomes the layer's trigger.
- [ ] A layer's trigger can be moved to a different key without deleting/recreating the layer,
      and without losing the layer's overrides.
- [ ] A layer's trigger can be cleared, leaving the layer intact but not reachable from the
      keyboard until a new trigger is assigned.
- [ ] Assigning a trigger to a key that already carries a base bind is flagged the same way it
      is today (trigger wins, conflict surfaced) — this existing behavior is preserved, not
      regressed.
- [ ] A layer with no trigger assigned is clearly distinguishable from one with a trigger, in
      both the layers list and the generated file preview.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
