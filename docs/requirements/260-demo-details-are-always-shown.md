---
id: 260
title: Demo details are always shown
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, the demo detail pane is always visible next to the list, empty until I pick a demo, so the
layout does not jump.

User feedback 2026-10-26: as with the servers, the details are always shown, initially empty; choosing a
demo shows it in the detail pane, and the pane always stays.

Today `ReplaysView.tsx` collapses to one column with nothing selected (`detailSplit`), and
`DemoDetailPanel` has a close button. With two or more selected a `SelectionSummary` replaces the detail.

## Acceptance Criteria

- [ ] **AC1** — With no demo selected, the Demos view shows the detail pane with an empty-state text.
- [ ] **AC2** — Selecting one demo shows its details in the pane.
- [ ] **AC3** — With two or more selected, the pane shows the selection summary (as today).
- [ ] **AC4** — The detail pane has no close button.
- [ ] **AC5** — Escape (clear selection) and a filter that hides the selected demo return the pane to its
      empty state instead of hiding it.
- [ ] **AC6** — The list keeps its width whether or not a demo is selected.

## Open Questions

## Decisions (Sprint)

- **(User)** Same behaviour as the servers (story 256): the detail pane is always there, empty until a demo
  is chosen, and does not go away.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
