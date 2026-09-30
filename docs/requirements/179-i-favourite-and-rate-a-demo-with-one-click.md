---
id: 179
title: I favourite and rate a demo with one click
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

Favourite and rating are the two things I set most often, and today in the detail panel they are a
checkbox and a free number field (1–10) buried in the notes form. They should be one click each,
right where I look:

- **Favourite** is a toggle button in the detail panel's header, next to the demo's name.
- **Rating** is a star selector in the detail panel, not a select or number field.

Both save immediately — like the list row's quick favourite/rating ([[155]] D6) — without the Edit
mode of [[178]].

The roadmap carries a known race: `demo-editor-store.ts`'s `quickEdit` is a fire-and-forget
read-merge-write, so a favourite toggle and a rating pick fired back-to-back on the same demo can
drop one of them ([S27 review](../sprints/done/S27/review.md)). With both controls side by side in
the header this becomes easy to hit, so this story closes it.

## Acceptance Criteria

- [ ] **AC1** — The detail panel's header shows a favourite toggle button next to the title; its
      pressed state is announced (`aria-pressed`) and visible without relying on colour alone.
- [ ] **AC2** — Pressing it saves the favourite to the sidecar at once; the list row's favourite
      star and the favourites-first order update without a rescan.
- [ ] **AC3** — The detail panel shows the rating as a row of stars reflecting the saved rating; no
      rating shows all stars empty.
- [ ] **AC4** — Clicking a star saves that rating at once; clicking the star of the current rating
      clears it. The list row's rating updates without a rescan.
- [ ] **AC5** — The star selector is keyboard-operable (arrow keys change, a key clears) and each
      star has an accessible name stating the value it sets.
- [ ] **AC6** — A favourite toggle and a rating pick fired back-to-back on the same demo both end
      up in the sidecar (no lost write).
- [ ] **AC7** — For an archive entry both controls stay visible, disabled, with the read-only reason
      as visible text ([[158]]).
- [ ] **AC8** — The favourite and rating inputs no longer appear in [[178]]'s edit mode.

## Open Questions

- Q1: The sidecar stores rating as an integer 1–10. Star scale: **5 stars with half steps**
  (recommended: the conventional look, lossless for 1–10), or 10 stars, or 5 whole stars (would
  force a data migration or lossy rounding)?
- Q2: Does the list row's inline rating `<select>` (CLAUDE.md deviation row for story 155 D6) switch
  to the same star control, or stay a select in the dense row? Recommendation: stay out of scope,
  the row is dense.
- Q3: The "Minimum rating" filter is a select over 1–10 today — does it follow the star scale in its
  labels? Recommendation: out of scope.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
