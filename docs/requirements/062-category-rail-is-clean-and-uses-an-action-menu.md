---
id: 062
title: Controls category rail is a clean chip row with an action menu
status: draft
created: 2026-09-07
---

## Requirement

The category rail in Controls looks noisy and homemade. Every category renders as a bordered box
that itself contains another box — a drag grip, the category button, and then four icon buttons in
a row (move up, move down, rename, delete), see
[ControlsTab.tsx:1745-1830](../../src/renderer/src/modules/config/ControlsTab.tsx#L1745-L1830). The
result reads as "box in a box with arrow keys and stuff" rather than as a row of category chips,
and it gets worse the more categories a profile has, because every chip carries its whole toolbar
all the time.

Three concrete asks:

1. **A cleaner layout** — one visual level per category, not a frame inside a frame. A category is
   a chip you click to select; nothing else should compete with it for attention.
2. **Drop the sort arrows** — ordering is drag-and-drop since story
   [[054-order-everything-by-drag-and-drop]], so the move-up/move-down buttons are a second,
   redundant mechanism that costs two controls per chip.
3. **Actions into an action menu** — rename and delete move behind a single overflow menu per
   category, the same pattern the entry rows already use
   ([ControlsRowMenu.tsx](../../src/renderer/src/modules/config/components/ControlsRowMenu.tsx)),
   instead of sitting permanently on the chip.

The sub-category rail ([[053-sub-categories-from-the-file]]) carries the same chip-plus-toolbar
pattern; refine decides whether it is in scope here or a follow-up, but the two must not end up
looking different.

## Acceptance Criteria

- [ ] **AC1** — A category renders as a single chip (one border/background level, no nested box)
      with its label and, when hovered/focused, its drag affordance and one action-menu trigger.
- [ ] **AC2** — The move-up and move-down icon buttons are gone from the category rail; reordering
      is drag-and-drop only and still works.
- [ ] **AC3** — Rename and delete are reachable from a per-category action menu, and behave exactly
      as before (including the delete-or-move modal for a non-empty category and the inline confirm
      for an empty one).
- [ ] **AC4** — Selecting a category still works by clicking the chip, and the selected chip is
      distinguishable without relying on colour alone.
- [ ] **AC5** — Every action stays keyboard reachable with a visible focus state; the menu trigger
      and its items carry accessible names.
- [ ] **AC6** — The rail loses no functionality: nothing that was on a chip becomes unreachable.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
