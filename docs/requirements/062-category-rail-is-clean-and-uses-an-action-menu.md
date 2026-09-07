---
id: 062
title: Controls category rail is a clean chip row with an action menu
status: ready
created: 2026-09-07
---

## Requirement

The category rail in Controls looks noisy and homemade. Every category renders as a bordered box
that itself contains another box — a drag grip, the category button, and then four icon buttons in
a row (move up, move down, rename, delete), see
[ControlsTab.tsx:1745-1830](../../src/renderer/src/modules/config/ControlsTab.tsx#L1745-L1830). The
result reads as "box in a box with arrow keys and stuff" rather than as a row of category chips,
and it gets worse the more categories a profile has, because every chip carries its whole toolbar
all the time.

Three concrete asks:

1. **A cleaner layout** — one visual level per category, not a frame inside a frame. A category is
   a chip you click to select; nothing else should compete with it for attention.
2. **Drop the sort arrows** — ordering is drag-and-drop since story
   [[054-order-everything-by-drag-and-drop]], so the move-up/move-down buttons are a second,
   redundant mechanism that costs two controls per chip.
3. **Actions into an action menu** — rename and delete move behind a single overflow menu per
   category, the same pattern the entry rows already use
   ([ControlsRowMenu.tsx](../../src/renderer/src/modules/config/components/ControlsRowMenu.tsx)),
   instead of sitting permanently on the chip.

The sub-category rail ([[053-sub-categories-from-the-file]]) carries the same chip-plus-toolbar
pattern; refine decides whether it is in scope here or a follow-up, but the two must not end up
looking different.

## Acceptance Criteria

- [ ] **AC1** — A category renders as a single chip (one border/background level, no nested box)
      with its label and, when hovered/focused, its drag affordance and one action-menu trigger.
- [ ] **AC2** — The move-up and move-down icon buttons are gone from the category rail; reordering
      is drag-and-drop only and still works.
- [ ] **AC3** — Rename and delete are reachable from a per-category action menu, and behave exactly
      as before (including the delete-or-move modal for a non-empty category and the inline confirm
      for an empty one).
- [ ] **AC4** — Selecting a category still works by clicking the chip, and the selected chip is
      distinguishable without relying on colour alone.
- [ ] **AC5** — Every action stays keyboard reachable with a visible focus state; the menu trigger
      and its items carry accessible names.
- [ ] **AC6** — The rail loses no functionality: nothing that was on a chip becomes unreachable.

## Open Questions

None — everything below was decided in refine.

## Decisions (Sprint)

- **Sub-category rail is out of scope, as a follow-up.** It is a different surface in a different
  file (the grid group header row in `components/ControlsGrid.tsx:206-296`, not a chip in a rail),
  so folding it in would double the diff and cross a second component; D1's menu component is
  written generically enough that the follow-up reuses it verbatim, which is what keeps the two
  from drifting apart visually.
- **The action menu holds `Move up` / `Move down` next to `Rename…` / `Delete…`.** This mirrors
  story 054 D8's row kebab exactly (`ControlsRowMenu.tsx` — inline arrows removed from the row,
  ordering commands moved into the menu), which is the pattern AC3 asks for; AC2 is therefore read
  as "no arrow *icon buttons* on the chip, and drag-and-drop is the only *pointer* mechanism", not
  as "keyboard users lose reordering" (AC5/AC6 forbid that).
- **Existing i18n keys are reused**, `config.controls.categoryMoveUp`/`categoryMoveDown`/`rename`/
  `delete` become the menu item labels; only the trigger needs a new key
  (`config.controls.categoryMenuFor`, mirroring `config.controls.actions.moveMenuFor`) — so the
  story leaves no orphaned keys behind.
- **One level = the chip container owns the single border/background**; the label button becomes
  borderless/background-less (`variant="ghost"`), and selection moves onto the container as
  `data-selected="true"` plus a semibold label and an accent marker, with `aria-pressed` kept on
  the label button. Weight + marker are the non-colour channel AC4 requires, and the container is
  already the one node that carries drag/drop/scroll roles.
- **The kebab follows the grip's existing reveal rule** (`.ctrl-grip-handle`'s
  `:hover`/`:focus-within`/`.is-dragging` block in `controls-grid.css:96-115`) and additionally
  stays visible while its own menu is open (`aria-expanded="true"`) or the chip is selected — a
  portalled menu moves focus off the chip, so `:focus-within` alone would hide the trigger under
  its own open menu.
- **The inline delete confirm for an empty category stays inline in the chip**, unchanged, because
  AC3 explicitly asks for "exactly as before"; only its trigger moves from the trash icon button
  into the menu.
- **The chip gets `data-category-id` / `data-category-name`** as the stable handle for tests and
  the ui:flow order assertion, replacing the flow's fragile "first `<button>` inside the chip
  `<div>`" walk (`scripts/flows/controls-category-rename-reorder.mjs:98-121`) — which breaks the
  moment the chip's button order changes.
- **No role/ARIA-pattern change and no `Menu.tsx` extension.** Story 020's decision against a full
  ARIA tabs pattern for this mixed rail still holds (`ControlsTab.tsx:1750-1757`), and the delete
  item needs no `danger` menu variant because the destructive gate is the existing confirm/modal.
- **The chip keeps 28px (`size="sm"`) icon buttons** for grip and kebab, consistent with the dense
  Controls sizing; CLAUDE.md's deviation table gets one row naming the rail so the `/design-tokens`
  44px deviation stays recorded rather than implicit.

## Plan

Three deliverables, in order, all inside the renderer's config module.

1. **D1 — the menu.** New `components/ControlsCategoryMenu.tsx`, a 1:1 mirror of
   `components/ControlsRowMenu.tsx` (kebab `IconButton` + `components/ui/Menu.tsx`), with items
   `Move up`, `Move down`, `Rename…`, `Delete…`. Wire it into the rail in `ControlsTab.tsx`
   (`:1788-1831`) and delete the four `IconButton`s there; the handlers stay as they are
   (`handleMoveCategory` `:495`, `setRenamingCategory` → `handleRenameCategory` `:435`, the
   has-entries branch → `setDeletingCategory` / `setPendingDeleteCategoryId`). One new `en.json`
   key for the trigger name; CLAUDE.md deviation row.
2. **D2 — the chip.** `ControlsTab.tsx` chip markup (`:1732-1765`) plus
   `styles/controls-grid.css`: one border/background level on `.ctrl-category-chip`,
   `data-selected` / `data-category-id` / `data-category-name` on it, ghost label button,
   semibold + accent-marker selected state, kebab joined to the grip's reveal rule. The node keeps
   all three of its existing roles (sortable item, row drop target, scroll-into-view ref) —
   nothing about `SortableItem`/`CategoryDropTarget` nesting changes.
3. **D3 — the real app.** Rewrite `scripts/flows/controls-category-rename-reorder.mjs` to rename
   and reorder through the menu and to assert selection by clicking a chip, using the new data
   attributes; add a chip-hover step to the `config-controls` screen in `scripts/lib/screens.mjs`
   so the screenshot shows grip + kebab (mirror: story 054 D12's row-grip hover there).

Tests ride with their deliverable: a new `ControlsTab.category-menu.test.tsx` (mirror:
`ControlsTab.row-menu.test.tsx`) covers D1 and D2; `ControlsTab.category-drag.test.tsx` must stay
green untouched, which is the AC2 "drag-and-drop still works" guard.

## Deliverables

- [ ] **D1 — Category action menu replaces the four icon buttons.**
      New `src/renderer/src/modules/config/components/ControlsCategoryMenu.tsx` (mirror:
      `components/ControlsRowMenu.tsx`), `ControlsTab.tsx` (rail `:1788-1831`),
      `src/renderer/src/i18n/locales/en.json` (new `config.controls.categoryMenuFor`, reuse
      `categoryMoveUp`/`categoryMoveDown`/`rename`/`delete`), `CLAUDE.md` (one deviation-table row
      for the rail's 28px icon buttons), plus its test in new
      `src/renderer/src/modules/config/ControlsTab.category-menu.test.tsx` (mirror:
      `ControlsTab.row-menu.test.tsx`).
      *Acceptance:* the rail has no `ArrowUp`/`ArrowDown`/`Pencil`/`Trash2` icon buttons left; one
      kebab per chip opens a `role="menu"` with four named items; move up/down are disabled on the
      first/last chip and reorder + persist as before; rename opens the rename dialog; delete opens
      the delete-or-move modal for a non-empty category and the inline confirm for an empty one;
      trigger and items are keyboard-operable; `en.json` has no orphaned keys; `npm test` and
      `npm run typecheck` green.

- [ ] **D2 — The chip is one visual level.**
      `ControlsTab.tsx` (chip `:1732-1765`), `src/renderer/src/styles/controls-grid.css`
      (`.ctrl-category-chip`, grip/kebab reveal block `:96-115`), plus cases added to
      `ControlsTab.category-menu.test.tsx`.
      Chip container owns the single border/background and gains `data-selected`,
      `data-category-id`, `data-category-name`; the label button is `variant="ghost"` with no own
      border/background and keeps `aria-pressed`; the selected chip is marked by semibold label +
      accent marker, not colour alone; the kebab reveals on hover/focus-within/dragging and stays
      visible while its menu is open or the chip is selected.
      *Acceptance:* clicking a chip still selects it and the grid header follows; no nested bordered
      box in the chip; selected state readable with colour ignored; drag still starts from the grip
      and `ControlsTab.category-drag.test.tsx` / `ControlsTab.dnd.test.tsx` stay green unmodified;
      a row dropped on a chip still moves category (story 054 D5 path intact).

- [ ] **D3 — Seen and driven in the real app.**
      `scripts/flows/controls-category-rename-reorder.mjs` (rename + reorder via the menu, select by
      chip click, order asserted via `data-category-name`), `scripts/lib/screens.mjs`
      (`config-controls`: hover a chip so grip + kebab are on the screenshot; mirror: story 054
      D12's row-grip hover), `docs/UI-VERIFICATION.md` only if it lists the flow's steps.
      *Acceptance:* `npm run ui:flow -- controls-category-rename-reorder` green against the running
      app, its screenshots show the clean chip with an open action menu, and `npm run ui:verify` is
      green with zero axe findings.

## Model Hints

- D2 → `deliverable-hard` — the chip is one DOM node with three simultaneous roles (sortable item,
  row drop target, scroll-into-view ref, `ControlsTab.tsx:1716-1731`), so a restructured nesting
  can silently break story 054 D5's cross-category drop and D7's rail sorting without any test
  naming the chip.
- D1, D3 → default tier.
- Review: → default — the diff is one new presentational component plus one rail block, one CSS
  block and one flow script, with the risky part already carried by D2's tier and guarded by the
  existing drag suites.

## Acceptance Tests

- AC1 → unit `src/renderer/src/modules/config/ControlsTab.category-menu.test.tsx` › "a category
  chip is one level: the label button carries no border or background of its own, and grip plus one
  menu trigger are its only other controls" (D2), with the visual evidence from e2e
  `npm run ui:verify` (screen `config-controls`, chip hovered) (D3)
- AC2 → unit `ControlsTab.category-menu.test.tsx` › "the rail has no move-up or move-down icon
  buttons" (D1) + unmodified unit `ControlsTab.category-drag.test.tsx` (reordering by drag still
  works) + e2e `npm run ui:flow -- controls-category-rename-reorder` › reorders through the menu and
  asserts the rail order (D1/D3)
- AC3 → unit `ControlsTab.category-menu.test.tsx` › "rename opens the rename dialog", › "delete on a
  category with entries opens the delete-or-move modal", › "delete on an empty category shows the
  inline confirm" (D1) + e2e `npm run ui:flow -- controls-category-rename-reorder` › renames through
  the menu (D3)
- AC4 → e2e `npm run ui:flow -- controls-category-rename-reorder` › "clicking a chip selects that
  category" (D3) + unit `ControlsTab.category-menu.test.tsx` › "the selected chip is marked by
  `data-selected`, `aria-pressed` and a semibold label, not by colour alone" (D2)
- AC5 → unit `ControlsTab.category-menu.test.tsx` › "the menu trigger and every item carry an
  accessible name and are reachable by keyboard" (D1) + e2e `npm run ui:verify` axe report at zero
  findings for `config-controls` (D3)
- AC6 → unit `ControlsTab.category-menu.test.tsx` › "every action the chip used to carry is still
  reachable: select, drag grip, move up, move down, rename, delete" (D1/D2)

## Done
