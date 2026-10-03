---
id: 213
title: the Controls tab is a component tree with a shared test harness
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the Controls tab to be a tree of components and hooks instead of one
function, so that a binds story edits a row component, a drag story edits a drag hook, a slot fix
is applied once, and a Controls test costs a few lines on a shared harness instead of 150–280
copied lines. As a user I want the Controls grid to stay smooth while dragging.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F16, F41, F42, F66):
`src/renderer/src/modules/config/ControlsTab.tsx` is 2,524 lines — 34 `useState`, 6 `useRef`,
6 `useEffect`, 27 handlers, 11 `render*` JSX helpers, a 507-line `return` mounting 11 dialogs,
and five more dialog components appended at the bottom; 20 commits since August, the most
recent from a demo-browser story. `renderCatalogSlot` (90 lines) and `renderPlainSlot` (72)
build the identical `<BindSlot>` wiring; the row pipeline (`buildControlsRowEntries`, filter,
`groupControlsRowEntries`, `buildMoveTargets`, `boundCount`) runs at render time with
`deriveRowState` 3–5x per row, and dnd-kit re-renders on every pointer move (a timer bug already
needed a `useCallback` + ref workaround). Three components reset 5–7 atoms in a
`useEffect(..., [profile.id])`; 30 `setState` calls inside effects across 8 files. Seven
`ControlsTab.*.test.tsx` suites each re-declare `profileFixture()`, `renderTab()`, the `window.q2`
stub and `IS_REACT_ACT_ENVIRONMENT`, in two mounting idioms; 16 config components over 150 lines
(`ConfigCodeView` 692, `CvarRow` 642, `OverviewKeyboardPanel` 642, `BindSlot` 570, …) have no
direct test.

Depends on story 212 (save hook). The review's judge recommends three ordered, independently
committable slices rather than one line-count target.

## Acceptance Criteria

- [ ] **AC1** — `lib/useControlsRows.ts` computes entries, groups, move targets, bound count and a
      per-entry `rowState` map in one `useMemo` (so `deriveRowState` runs once per entry), with a
      `renderHook` test; the tab reads rows from it.
- [ ] **AC2** — One `components/ControlsEntryRow.tsx` (taking a `ControlsRowEntry` and a small
      context) replaces the six `render*` row/slot helpers; assign, clear and replace are tested
      for both catalog and plain rows; the "only difference is withCatalogBody" comment is gone
      because there is one path.
- [ ] **AC3** — Drag state lives in `lib/useControlsDrag.ts`; the category rail and its dialogs
      live in `components/ControlsCategoryRail.tsx`; the five dialog components appended to
      `ControlsTab.tsx` live under `components/` (or `dialogs/`, per the placement rule story 227
      writes) and `ControlsTab.dialogs.test.ts` imports them directly without loading the tab.
- [ ] **AC4** — The detail tabs are mounted with `key={selected.id}` and the three
      `[profile.id]` reset effects are deleted; `setFilterText('')` moves into a
      `selectCategory(id)` handler; the ConfigView "one-tick staleness" comment is gone.
- [ ] **AC5** — `src/renderer/src/modules/config/test/` provides `profileFixture(overrides)`,
      `stubBridge()` and `renderWithProviders(ui)`; the seven ControlsTab suites plus the
      SettingsTab and AliasesTab tests use them on `@testing-library/react` only; no test file in
      the module declares its own `profileFixture`.
- [ ] **AC6** — `ControlsTab.tsx` is under 800 lines and under 12 `useState` (soft caps for
      story 208's architecture test); the four `controls-*` flows and every config flow pass.
- [ ] **AC7** — Focused tests exist for `BindSlot`, `CvarRow`, `KeyBindDialog` and `LayersPanel`
      (one behaviour each is enough to anchor coverage).

## Decisions (Sprint)

- **(User)** Q1: Per-component tests only; no coverage threshold.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Is a vitest coverage threshold for `modules/config/components/**` wanted, or is
      the per-component test list enough?

## Plan

<!-- Filled by /refine 213. -->

## Deliverables

<!-- Filled by /refine 213. -->

## Model Hints

<!-- Filled by /refine 213. -->

## Acceptance Tests

<!-- Filled by /refine 213. -->

## Done

<!-- Filled by /build 213. -->
