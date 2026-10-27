---
id: 259
title: Batch actions show from one selected demo
status: ready # draft -> ready -> in-progress -> done
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
- The bar's condition becomes "one or more selected, or an outcome is shown"; `multiSelected` (> 1) stays
  the switch for the selection summary and the detail split, because AC1 only moves the bar and story 260
  owns the detail pane.
- With one demo selected the detail panel and the bar are both shown; the panel keeps its own
  delete/move, because the user asked for the same bar regardless of count and removing the panel's
  actions is not in scope.
- The row context menu keeps its single-demo vs. selection logic (`inSelection = selectedIds.length > 1`),
  because a one-element selection already resolves to `[demo]` there and the ACs do not touch the menu.
- The bar's count line also shows at one ("1 demo selected"), because the existing plural keys
  (`replays.multi.count_one`, `bulk.delete.title_one`, `bulk.zipSkipped_one`) already cover it and the
  bar should read the same at every count.
- AC4's "same reason" is the existing `replays-bulk-zip-skip` line plus disabled buttons
  (`BulkActionBar` derives `actionable = count - zipCount > 0`), so no new string or logic is needed.
- Proven by a new flow `replays-bulk-one-selected` rather than extending the two-demo flows, because
  those assert the multi path and a separate flow keeps each story's acceptance selectable on its own.

## Plan

Trivial renderer change plus its acceptance flow, one deliverable.

1. `ReplaysView.tsx`: render `BulkActionBar` when `selectedIds.length > 0 || bulk.outcome !== null`
   (today `multiSelected || ...`). Nothing else in the view changes; `BulkActionBar` already handles
   count 1 and an all-zip selection (disabled buttons + zip-skip line).
2. New flow `scripts/flows/replays-bulk-one-selected.mjs`, registered in the `replays-bulk` area of
   `scripts/flows/areas.json`; fix the stale "shown at two or more" selector comment in
   `replays-bulk-delete.mjs`.
3. Docs: one bullet in `docs/systems/replays-module.md` (renderer map), one `### Changed` line in
   `CHANGELOG.md` under `## Unreleased`.

Order note: 260 edits the same `ReplaysView` layout afterwards (sprint order 259 then 260).

## Deliverables

- **D1 — The bulk bar shows from one selected demo.**
  Files: `src/renderer/src/modules/replays/ReplaysView.tsx` (the `{(multiSelected || bulk.outcome !== null) && <BulkActionBar …/>}`
  condition, ~line 842 — change to `selectedIds.length > 0 || bulk.outcome !== null`; keep `multiSelected`
  for `detailSplit` and the `replays-multi-selection` pane; do not touch `openDemoMenu`).
  `src/renderer/src/modules/replays/components/BulkActionBar.test.tsx`: add a case "one selected demo inside a zip:
  every action is disabled and the zip reason is shown" (`count: 1, zipCount: 1` → `replays-bulk-delete/-tag/-move`
  disabled, `replays-bulk-zip-skip` reads "1 zip entry is skipped").
  New flow `scripts/flows/replays-bulk-one-selected.mjs` — mirror `scripts/flows/replays-bulk-delete.mjs`
  (setup/teardown with `writeReplaysZipPackArchive`/`removeReplaysZipPackArchive`, the `vendoredExtractorExists`
  guard, the harness-trash check via `variantUserDataDir(variant)/harness-trash`) and helpers from
  `scripts/lib/replays-copy-in.mjs` (`openAllDemos`, `openFolder`, `rowFor`, `poll`, `TIMEOUT_MS`). Fixture:
  loose `test-q2lbo-a.dm2`, `-b.dm2`, `-c.dm2` in INSTALL_ONE's `demos/`, an empty subfolder `q2lbo-sub`, plus
  the zip pack's `test.dm2`. Steps, each a `step(...)` with the exact names below:
  1. "with no demo selected the bar is not shown" — list loaded, `replays-bulk-bar` count is 0.
  2. "one selected demo shows Delete, Tag and Move" — click row a; bar visible, `replays-bulk-count` says
     "1 demo selected", `replays-bulk-delete/-tag/-move` visible and enabled.
  3. "Tag acts on the one selected demo" — Tag; dialog title "Tag 1 demo"; add `q2lbo` via `replays-tag-input` +
     Enter, `replays-bulk-tag-apply`; summary "1 tagged"; a's `.json` sidecar carries `q2lbo`, b and c have no
     sidecar with it.
  4. "Move acts on the one selected demo" — select a, Move, click `replays-bulk-move-folder[data-path="q2lbo-sub"]`;
     summary "1 moved"; a is in `q2lbo-sub/`, b and c still in `demos/`.
  5. "Delete asks first and removes only the one selected demo" — select b, Delete; "Delete 1 demo?" visible;
     `replays-bulk-delete-confirm`; summary "1 deleted"; b gone and in harness trash, c still on disk.
  6. "clearing the selection hides the bar" — select c, press Escape in the list (as `replays-multi-select.mjs`
     does); `replays-bulk-bar` count 0.
  7. "one selected zip demo disables the actions with the zip reason" — click the `test.dm2` row alone; the three
     buttons are disabled; `replays-bulk-zip-skip` says "1 zip entry is skipped".
  Register the flow in the `replays-bulk` entry's `flows` in `scripts/flows/areas.json`; in
  `scripts/flows/replays-bulk-delete.mjs` line 10 change "shown at two or more selected" to "shown at one or more
  selected". Docs: `docs/systems/replays-module.md` renderer map gets a bullet "`components/BulkActionBar.tsx`,
  `components/SelectionSummary.tsx`, `useBulkActions.ts` — the Delete/Tag/Move bar shows from one selected demo (and
  while an outcome is shown); the selection summary replaces the detail from two". `CHANGELOG.md` under
  `## Unreleased` → `### Changed`: "- **Replays** — Delete, Tag and Move show as soon as one demo is selected."

## Model Hints

- D1 → default.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-bulk-one-selected.mjs` › "one selected demo shows Delete, Tag and Move"
- AC2 → e2e `scripts/flows/replays-bulk-one-selected.mjs` › "Tag acts on the one selected demo",
  "Move acts on the one selected demo", "Delete asks first and removes only the one selected demo"
- AC3 → e2e `scripts/flows/replays-bulk-one-selected.mjs` › "with no demo selected the bar is not shown",
  "clearing the selection hides the bar"
- AC4 → e2e `scripts/flows/replays-bulk-one-selected.mjs` › "one selected zip demo disables the actions with the zip reason";
  unit `src/renderer/src/modules/replays/components/BulkActionBar.test.tsx` › "one selected demo inside a zip: every
  action is disabled and the zip reason is shown"

## Done
