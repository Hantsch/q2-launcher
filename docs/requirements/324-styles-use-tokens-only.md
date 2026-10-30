---
id: 324
title: Styles use tokens only, and UI kit controls keep their own rules
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-004, TD-006, TD-021, TD-026 and TD-032 are renderer style and UI-kit debt: rgb
literals instead of tokens, 51 arbitrary micro font sizes, a radio row below the size floor without
a deviation, a dialog confirm that ignores `canSubmit`, a dangling `aria-labelledby`, and a grid that
re-renders every row.

## Acceptance Criteria

- [ ] **AC1** — `controls-grid.css` and `surfaces.css` contain no rgb/hex colour literal; a check
      fails when one is added under `src/renderer/src/styles/` (TD-004).
- [ ] **AC2** — Font sizes come from a typography token scale; no arbitrary `text-[Npx]` class
      remains in the renderer, enforced by a check (TD-006).
- [ ] **AC3** — The mods remove dialog's changed-files radios are at least 24px high (TD-021).
- [ ] **AC4** — DeleteCategoryDialog's confirm is disabled while `canSubmit` is false; no TabPanel
      has an `aria-labelledby` pointing at a missing element, verified by the axe report (TD-026).
- [ ] **AC5** — Re-rendering `ControlsGrid` with unchanged props does not re-render unchanged
      `ControlsEntryRow`s; row tests cover compactAdd, extra-key rows and drop toggles (TD-032).
- [ ] **AC6** — Rows TD-004, TD-006, TD-021, TD-026 and TD-032 are removed from `docs/TECH-DEBT.md`.

## Open Questions

- Typography scale: how many steps (proposal: four micro steps, 11/12/13/14px), and may a size move
  by 1px to land on a step?

## Decisions (Sprint)

## Plan

## Deliverables

## Done
