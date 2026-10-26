---
id: 259
title: Batch actions show from one selected demo
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, the Delete / Tag / Move actions above the demo list appear as soon as I select one demo,
so I use the same actions whether I picked one or several.

User feedback 2026-10-26: the batch buttons (delete, tag, move) should already show with one demo selected,
not only from the second.

Today `BulkActionBar` renders only when `selectedIds.length > 1` (`ReplaysView.tsx`).

## Acceptance Criteria

- [ ] **AC1** — With exactly one demo selected, the bar shows Delete, Tag and Move.
- [ ] **AC2** — Each action applied with one demo selected acts on that demo only (Delete asks for
      confirmation as it does with several).
- [ ] **AC3** — With no demo selected, the bar is not shown.
- [ ] **AC4** — With one demo inside a zip selected, the actions are disabled with the same reason as for
      several.

## Open Questions

## Decisions (Sprint)

- **(User)** The Delete / Tag / Move bar shows as soon as one demo is selected, not only from two.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
