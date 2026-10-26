---
id: 253
title: An unassigned config profile tells me it is not used
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, when a config profile is not assigned to any installation I see a clear warning, so I know
the game is not using this config yet.

User feedback 2026-10-26: if a config is not assigned to an installation, show the user a warning/hint so
it is clear the config is not being used yet.

Today the only signals are the header button "0 of N assigned", a sentence in the engine-scope box and one
on the Care tab; the profile list shows nothing, and the Home profiles tile counts an unassigned profile as
in sync.

## Acceptance Criteria

- [ ] **AC1** — Opening a profile that is assigned to no installation shows a warning banner stating that no
      installation uses this config.
- [ ] **AC2** — The banner has an action that opens the assignment panel.
- [ ] **AC3** — In the profile list, an unassigned profile's row carries a visible "Not assigned" marker (text,
      not colour only).
- [ ] **AC4** — Assigning the profile to an installation removes the banner and the marker without a reload.
- [ ] **AC5** — A profile assigned to at least one installation shows neither banner nor marker.

## Open Questions

## Decisions (Sprint)

- Placement decided at the cut (the user asked for "a warning/hint so it is clear"): a warning banner in the
  profile view with a direct "Assign…" action, plus a marker on the profile's row in the list. Refine may
  adjust wording, not drop either place.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
