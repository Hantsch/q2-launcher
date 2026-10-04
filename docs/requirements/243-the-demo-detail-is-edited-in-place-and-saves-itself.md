---
id: 243
title: the demo detail is edited in place and saves itself
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player, the demo detail is one view: I click a field and change it, add a tag by typing it, and
the change is saved on its own — there is no separate edit mode and no Save button to forget.

User feedback 2026-10-04: the detail view should be directly editable and not have two different
views, which only confuses users; tagging should work directly and save immediately.

Today the detail has a read mode (`DemoDetailPanel.tsx`) and an edit mode behind a pencil button
(`DemoDetailEditor.tsx`) with Cancel/Save, a draft store and a discard dialog. Only favourite and
rating are already "quick edits" that save at once through `quickEdit`.

Concept: [replays-module.md](../systems/replays-module.md).

## Acceptance Criteria

- [ ] **AC1** — The detail has a single view; there is no Edit button, no Cancel/Save and no discard
      dialog.
- [ ] **AC2** — Name, description, date, map, mod, gamemode and sides are edited in place: a field
      looks like text until hovered/focused, and is an input when focused.
- [ ] **AC3** — A text change is saved when the field loses focus or Enter is pressed (Escape reverts
      the field); a failed save shows a toast and the field keeps the user's text.
- [ ] **AC4** — Tags are added by typing and Enter (with the existing suggestions) and removed with
      the chip's ×; each add/remove is saved at once.
- [ ] **AC5** — A saved change is visible in the list row without a rescan.
- [ ] **AC6** — An invalid value (e.g. a too-long name) is refused at the field with a visible reason
      and is not saved.
- [ ] **AC7** — If the demo's existing sidecar is unreadable, the first edit still asks before
      replacing it, as today.
- [ ] **AC8** — Zip entries show the same view read-only, with the reason as visible text.
- [ ] **AC9** — Saves to one demo are queued so that quick successive edits never overwrite each
      other.

## Open Questions

- **Q1** — Undo: is a short "Undo" in the save toast wanted? Recommendation: no for now — every
  field reverts with Escape before it is saved.
- **Q2** — The "known players" chips from the sides editor: kept as-is inside the in-place sides
  field? Recommendation: yes; [[245]] may replace the sides display with a team table later.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
