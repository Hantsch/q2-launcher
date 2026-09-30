---
id: 177
title: The demo detail reads at a glance
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

The demo detail panel ([[155]]) is a long list of rows where half the content is noise: a subheader
("What the browser knows") that says nothing, the name shown twice (header and first row), a
"Source" row with an internal installation id, a "Format" row that the file name already says, and a
provenance label ("from the demo", "from the file name", "file time", "guessed") behind every value.

The panel should read at a glance: the demo's name is the prominent header, and below it the facts
I care about, in the order I care about them — first the file, then the match:

1. File name, Length, Recorded
2. *(visual gap)*
3. Map, Mod, Gamemode, Players, Point of view

This changes concept DEMO-13 ("the detail view shows each value's source"): the effective-value
precedence stays, only its display in the detail panel goes.

## Acceptance Criteria

- [ ] **AC1** — The panel header shows the demo's effective name (falling back to the file name) as
      its prominent title — visibly larger/stronger than today's `text-sm` header and than the field
      values below it.
- [ ] **AC2** — The panel shows no "What the browser knows" subheader.
- [ ] **AC3** — The facts list shows no Name, Source or Format row.
- [ ] **AC4** — The facts list shows, top to bottom, File name, Length, Recorded, then a visible gap,
      then Map, Mod, Gamemode, Players, Point of view; a fact with no value anywhere is omitted as
      today, never shown blank.
- [ ] **AC5** — No value in the facts list carries a provenance label ("from the demo", "from the
      file name", "file time", "guessed").
- [ ] **AC6** — The MVD2 note and the sidecar-issue list are still shown when they apply.

## Open Questions

- Q1: "Length" vs. "Duration" — the user's list says "Duration (Length)". Keep the label "Length"
  (matches the list column) or rename both to "Duration"? Recommendation: keep "Length", one word
  for one thing across list and detail.
- Q2: The list row still shows "Duel (guessed)" under the file name. Does the provenance removal
  apply to the row as well, or only to the detail panel (as asked)? Recommendation: detail panel
  only in this story; the row is a separate decision.
- Q3: Host, description, tags, favourite and rating also come out of `buildDemoDetail` today. Host
  is not in the user's list — drop it or append it after Point of view? Description and tags move
  to the edit story [[178]], favourite and rating to [[179]].

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
