---
id: 013
title: Compact the empty alt-layers state and move the layer switcher next to the keyboard overview
status: draft
created: 2026-08-18
---

## Requirement

As a user with no alt layers yet, I want the "no alt layers" state to take up little vertical
space instead of dominating the screen. And since flipping between the base layer and a
specific alt layer is something I do constantly while working on the keyboard overview, I want
that switcher positioned right next to the keyboard overview itself, not above it in a separate
panel — so switching and looking at the board happen in the same glance.

## Acceptance Criteria

- [ ] With zero alt layers on a profile, the alt-layers panel renders as a compact hint rather
      than a large, tall empty-state block.
- [ ] The base/layer switcher (pick which layer's state is currently shown/edited on the board)
      sits next to the keyboard overview's own header, not inside the layers management panel.
- [ ] Layer CRUD (create, rename, delete, generated-alias preview) keeps working from wherever it
      now lives; moving the switcher does not remove or hide any existing layer-management
      capability.
- [ ] The keyboard overview subtitle/legend ("Bound in an alt layer" etc.) is unaffected by this
      layout change — this story only relocates/compacts, it does not change what the legend
      means (see the follow-up story on trigger visibility for that).

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
