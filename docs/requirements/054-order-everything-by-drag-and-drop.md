---
id: 054
title: Order everything by drag and drop
status: draft
created: 2026-09-05
---

## Requirement

Ordering is how I make a config mine, and today it is nearly absent. Only free-form rows have
move-up/move-down buttons (`ControlsTab.tsx:934-949`, `lib/entry-order.ts:22-45`); catalogue rows
cannot be moved at all; categories cannot be reordered (`ControlsTab.tsx:1012-1111`, no order in the
model); nothing anywhere is draggable (no drag-and-drop dependency in `package.json`, no drag
handlers in the Controls sources, none in the prototypes). Story 019 chose buttons over drag and
drop for keyboard reach - right for a first cut, wrong as the end state.

After stories 052/053 (and 059 for Settings) everything has a user-controlled order. I want to
arrange all of it by clean drag and drop - rows within and between sub-categories, rows between
categories, sub-categories within a category, categories in the rail, and in Settings the sections
and the cvars inside them - and see the file follow.

## Acceptance Criteria

- [ ] Every row in Controls has a drag handle; a row can be dropped at any position within its
      category, into another sub-category of the same category, or onto another category's chip
      (moving it there, appended at the end).
- [ ] Sub-category headers can be dragged to reorder within their category; category chips can be
      dragged to reorder the rail.
- [ ] In Settings, sections and the cvars inside a section can be reordered the same way (story
      059's model).
- [ ] While dragging: a clear drop indicator, the grid auto-scrolls near its edges, the dragged
      row keeps its 40px height (no layout jump), Escape cancels.
- [ ] A keyboard path stays for every drag operation (the library's keyboard sensor, or move
      up/down plus "move to..." on every row, sub-category and category) - the accessibility floor
      from `/frontend-guidelines` and `/design-tokens`.
- [ ] Order persists as array position (story 019's decision); the save bar shows a reorder as an
      unsaved change; Discard restores the old order; the rendered file emits sections and lines in
      the new order and story 042's round-trip property holds.
- [ ] Multi-key sub-rows (story 056) are not drag targets; conflicts, the filter and the
      "n rows - m bound" footer keep working with any order.
- [ ] The production CSP stays `style-src 'self'` (story 046) with the chosen technique;
      `npm run ui:verify` shows the drag handles with no new axe findings; a `ui:flow` performs one
      real drag through the running app.

## Open Questions

1. **Library or hand-rolled:** `@dnd-kit` (accessible, keyboard sensor, React 19), Atlassian's
   `pragmatic-drag-and-drop` (native events underneath, small), or native HTML5 drag events with our
   own indicator. Recommendation: `@dnd-kit/core` + `@dnd-kit/sortable` - the keyboard and
   screen-reader work comes with it; refine verifies against the real production build that it
   injects no runtime `<style>` (the CSP gate from story 046 would fail otherwise).
2. **Cross-category drops:** onto the category chip only, or also into another category's grid?
   Recommendation: chip only - one grid is visible at a time.
3. **The buttons:** keep move up/down on every row (five icons in the Options track) as the
   keyboard path, or move them behind a row menu once drag is the primary path? Recommendation:
   behind the row menu; story 055 already frees that cell.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
