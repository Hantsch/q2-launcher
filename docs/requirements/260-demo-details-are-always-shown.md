---
id: 260
title: Demo details are always shown
status: ready # draft -> ready -> in-progress -> done
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
- The empty pane uses the UI-kit `EmptyState` (`src/renderer/src/components/ui/primitives.tsx`) with one
  new key `replays.detail.empty` ("Select a demo to see its details.") — reuses the existing primitive
  instead of hand-rolling another empty block.
- No component is shared with the servers pane (story 256) — modules may not import each other, and the
  `EmptyState` primitive is already the shared piece.
- Escape and the filter still clear/prune the selection exactly as today (`closeDemo`,
  `deselectIfMissing`) — unlike servers, AC5 keeps deselection; only the pane's reaction changes.
- Stage mode is unchanged: the docked pane beside the stage still appears only with a demo selected — on
  the stage there is no list beside it, so there is no layout jump to prevent and the ACs are about the list.
- The split applies at every width: at `@4xl` and up the fixed `32rem` column, below it the existing
  stacked rows — one rule for all widths is what keeps the list from jumping (AC6).
- The pane wrapper gets one stable testid `replays-detail-pane` for all three states; `replays-detail` and
  `replays-multi-selection` keep their ids — existing flows keep selecting what they select today.
- `DemoDetailPanel` loses the `onClose` prop entirely, not just the button — a prop with no caller is dead
  code.
- One CHANGELOG line under `## Unreleased` / `### Changed` — it is a user-visible behaviour change.

## Plan

Renderer-only change in the `replays` module; no IPC, no main.

1. `ReplaysView.tsx`: `detailSplit` drops its `detailOpen` argument — outside stage mode the grid is always
   list + `32rem` pane. The pane wrapper (`DETAIL_PANE`, `data-testid="replays-detail-pane"`) is always
   rendered and holds exactly one of: `SelectionSummary` (2+ selected), `DemoDetailPanel` (1 selected),
   `EmptyState` with `replays.detail.empty` (none). The list column gets `data-testid="replays-list-pane"`
   so a flow can measure its width. Stage mode keeps today's wrapper rule (`selected ? w-[32rem] : hidden`).
2. `DemoDetailPanel.tsx`: remove the close `IconButton` and the `onClose` prop; `ReplaysView` stops passing it.
3. Tests: component tests in `ReplaysView.test.tsx` / `DemoDetailPanel.test.tsx`; a new flow
   `scripts/flows/replays-detail-always-shown.mjs`; the two flows that click `replays-detail-close`
   and the multi-select flow's last assertion are updated.
4. Docs: `docs/systems/replays-module.md` (detail pane always present), one CHANGELOG line.

Order: D1 (always-present pane) then D2 (no close button) — D1 leaves the close button working, so its
tests stay green between the two.

## Deliverables

- **D1 — The detail pane is always present, empty until a demo is chosen.** Files:
  `src/renderer/src/modules/replays/ReplaysView.tsx`, `src/renderer/src/modules/replays/ReplaysView.test.tsx`,
  `src/renderer/src/modules/replays/locale/en.json`, `scripts/flows/replays-detail-always-shown.mjs` (new),
  `scripts/flows/replays-multi-select.mjs`, `docs/systems/replays-module.md`, `CHANGELOG.md`.
  In `ReplaysView.tsx`: `detailSplit(stageMode)` — outside stage mode always
  `grid-rows-[minmax(0,1fr)_minmax(0,1fr)] @4xl:grid-cols-[minmax(0,1fr)_32rem] @4xl:grid-rows-1`, in stage
  mode `grid-rows-1`; update its doc comment (it says "one slot until a demo is selected"). Replace the two
  conditional pane blocks (`multiSelected && ...`, `selected && ...`) with one always-rendered wrapper
  `<div className={cn(DETAIL_PANE, stageMode ? 'border-l' : 'border-t @4xl:border-t-0 @4xl:border-l')}
  data-testid="replays-detail-pane">` whose child is: `multiSelected` → the existing
  `data-testid="replays-multi-selection"` div with `SelectionSummary`; else `selected` → `DemoDetailPanel`
  (unchanged props); else `<EmptyState title={t('replays.detail.empty')} />` from
  `src/renderer/src/components/ui/primitives.tsx`, wrapped in `data-testid="replays-detail-empty"`.
  Add `data-testid="replays-list-pane"` to the list column div (`flex min-h-0 flex-col p-5`). Leave the
  stage-mode wrapper rule (`selected ? 'w-[32rem] shrink-0' : 'hidden'`), `closeDemo` on Escape and the
  `deselectIfMissing` effect untouched. Locale: `replays.detail.empty` = "Select a demo to see its details."
  Tests: component tests in `ReplaysView.test.tsx` — "with no demo selected the detail pane shows the empty
  state", "two selected demos show the selection summary in the pane", "Escape returns the pane to its empty
  state". The existing test that asserts `replays-detail` is absent before a click stays valid. New flow
  `replays-detail-always-shown.mjs` (variant `replays-rows`; mirror the header, `export const variant` and
  helpers `openDemosRoot` / `rowFor` of `scripts/flows/replays-demo-detail.mjs`): (1) `replays-detail-pane`
  and `replays-detail-empty` visible, record `replays-list-pane` `boundingBox().width`; (2) click a row →
  `replays-detail` inside `replays-detail-pane` shows its name, list width unchanged (within 1px); (3) Escape
  on `replays-demo-scroll` → empty state back, pane still visible; (4) select a row, type a non-matching text
  into `replays-filter-search` → empty state, pane visible, width unchanged; clear the filter and wait
  600 ms (debounced persist) before returning. `replays-multi-select.mjs`: after the final Escape also wait
  for `replays-detail-empty` to be visible; fix its testid comment for `replays-detail`.
  `docs/systems/replays-module.md`: state that the detail pane is always present (empty / one demo /
  selection summary). CHANGELOG `## Unreleased` → `### Changed`: "- **Demos** — The detail pane stays
  beside the list; empty until you pick a demo."
- **D2 — The demo detail pane has no close button.** Files:
  `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`,
  `src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx`,
  `src/renderer/src/modules/replays/ReplaysView.tsx`, `src/renderer/src/modules/replays/ReplaysView.test.tsx`,
  `scripts/flows/replays-demo-detail.mjs`, `scripts/flows/replays-demo-rows.mjs`,
  `scripts/flows/replays-detail-always-shown.mjs`.
  Remove the `IconButton` with `data-testid="replays-detail-close"` (and the `X` import if now unused) and
  the `onClose` prop from `DemoDetailPanel`; drop `onClose={...}` from its use in `ReplaysView.tsx`. Tests:
  in `DemoDetailPanel.test.tsx` replace "close calls onClose" with "the detail panel has no close button"
  and drop `onClose` from `renderPanel` and the other render call; in `ReplaysView.test.tsx` replace
  "closing the detail panel clears the selection" with "the detail panel offers no close button".
  Flows: `replays-demo-detail.mjs` and `replays-demo-rows.mjs` stop clicking `replays-detail-close` — that
  closing step becomes Escape on `replays-demo-scroll` followed by waiting for `replays-detail-empty`;
  remove the `replays-detail-close` line from both testid header comments. In
  `replays-detail-always-shown.mjs` step (2) also assert `replays-detail-close` has count 0.

## Model Hints

No `deliverable-hard`: a bounded layout/JSX change in one view plus one removed button.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-detail-always-shown.mjs` › "replays-detail-always-shown" (step 1);
  component `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "with no demo selected the detail
  pane shows the empty state" (D1)
- AC2 → e2e `scripts/flows/replays-detail-always-shown.mjs` › "replays-detail-always-shown" (step 2) (D1)
- AC3 → e2e `scripts/flows/replays-multi-select.mjs` › "replays-multi-select"; component
  `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "two selected demos show the selection summary
  in the pane" (D1)
- AC4 → e2e `scripts/flows/replays-detail-always-shown.mjs` › "replays-detail-always-shown" (step 2);
  component `src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx` › "the detail panel has
  no close button" (D2)
- AC5 → e2e `scripts/flows/replays-detail-always-shown.mjs` › "replays-detail-always-shown" (steps 3 and 4);
  component `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "Escape returns the pane to its empty
  state" (D1)
- AC6 → e2e `scripts/flows/replays-detail-always-shown.mjs` › "replays-detail-always-shown" (steps 1, 2, 4:
  `replays-list-pane` width unchanged) (D1)

## Done
