---
id: 054
title: Order everything by drag and drop
status: done
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

- [x] Every row in Controls has a drag handle; a row can be dropped at any position within its
      category, into another sub-category of the same category, or onto another category's chip
      (moving it there, appended at the end).
- [x] Sub-category headers can be dragged to reorder within their category; category chips can be
      dragged to reorder the rail.
- [x] In Settings, sections and the cvars inside a section can be reordered the same way (story
      059's model).
- [x] While dragging: a clear drop indicator, the grid auto-scrolls near its edges, the dragged
      row keeps its 40px height (no layout jump), Escape cancels.
- [x] A keyboard path stays for every drag operation (the library's keyboard sensor, or move
      up/down plus "move to..." on every row, sub-category and category) - the accessibility floor
      from `/frontend-guidelines` and `/design-tokens`.
- [x] Order persists as array position (story 019's decision); the save bar shows a reorder as an
      unsaved change; Discard restores the old order; the rendered file emits sections and lines in
      the new order and story 042's round-trip property holds.
- [x] Multi-key sub-rows (story 056) are not drag targets; conflicts, the filter and the
      "n rows - m bound" footer keep working with any order.
- [x] The production CSP stays `style-src 'self'` (story 046) with the chosen technique;
      `npm run ui:verify` shows the drag handles with no new axe findings; a `ui:flow` performs one
      real drag through the running app.

## Open Questions

1. ~~**Library or hand-rolled**~~ answered → Decisions (Sprint)
2. ~~**Cross-category drops**~~ answered → Decisions (Sprint)
3. ~~**The buttons**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Library: `@dnd-kit/core` + `@dnd-kit/sortable`.
- **(User)** Cross-category drops: allowed both onto another category's chip and directly into
  another category's grid (not chip-only as recommended).
- **(User)** Move up/down buttons: move behind the row menu once drag is primary (story 055 frees
  that cell).
- **Packages: `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`** — `utilities` carries
  the `CSS.Transform` helper `sortable` expects; it is a peer of the two the user named, not a
  second library choice.
- **CSP: no change, and no `<style>` injection technique.** dnd-kit applies transforms through
  React's `style` prop (CSSOM `setProperty`), which story 046's decision already established is not
  governed by `style-src`; the drop indicator and grip are ordinary Tailwind/`controls-grid.css`
  classes.
- **A Controls row becomes exactly one DOM element.** `ControlsRow` renders a four-element sibling
  fragment today (row, prompt host, extra-key container, message row); a sortable item needs one
  ref, so the fragment is wrapped in one `role="rowgroup"` element that is a direct child of the
  `role="table"`, and the sub-category divider becomes a `role="row"` direct child instead of a
  wrapping rowgroup — both are valid ARIA (`row`/`rowgroup` may sit directly under `table`) and it
  keeps a row's sub-rows glued to it while dragging.
- **The drag handle is a new leading 20px grip column** in `.ctrl-row`
  (`controls-grid.css:63`), always present in the DOM (so the column never reflows) and visually
  revealed on row hover/focus-within — the 40px row height and zebra parity from stories 020/056
  stay untouched.
- **"Directly into another category's grid" is spring-loaded:** only one category's grid is on
  screen at a time, so hovering a category chip during a drag for ~600 ms switches the grid to that
  category and the drag continues, allowing an exact drop position there; dropping *on* the chip
  itself appends to the end, as the user's decision states.
- **Dragging is disabled while the Controls filter narrows the list** (grip disabled with an
  explaining tooltip, row menu still offers move up/down/"Move to…"): a drop between two visible
  rows has no defined array position among the hidden ones, and order is array position (story 019).
- **The row menu is new and holds only ordering commands** (`Move up`, `Move down`, `Move to…`),
  built on the existing `components/ui/Menu.tsx`; edit/rename/remove stay the icon buttons they are
  today, which keeps the blast radius of the button relocation to the ordering affordances.
- **Settings keeps `MoveCvarDialog`** as the "move to…" keyboard path next to the new keyboard
  sensor; nothing is removed there, only drag is added.
- **`@dnd-kit`'s own screen-reader announcements are translated** through `en.json` and passed as
  `DndContext` `accessibility.announcements`, per CLAUDE.md's "no prose across the UI boundary"
  spirit; the default English strings are not shipped untranslated.

## Plan

Order is already array position everywhere (019/052/053/059) and every reorder already persists
through `persistCategoriesAndActions` / the Settings equivalent — so this story adds an input
technique, not a data model. Work bottom-up: pure helpers, then one sortable primitive, then each
surface.

1. **Foundation** — add the three `@dnd-kit` packages; a thin
   `src/renderer/src/components/dnd/` wrapper (`SortableContextProvider`, `SortableItem`,
   `DragHandle`, drop-indicator + auto-scroll + Escape/keyboard-sensor config, translated
   announcements) so no surface configures sensors itself.
2. **Pure order helpers** — extend `lib/entry-order.ts` (index moves, move to sub-category, move to
   category, move category, move sub-category) and `lib/cvar-sections.ts` (section, sub-section and
   cvar index moves) with tests. No UI in these steps.
3. **Controls structure** — `ControlsRow`/`ControlsGrid`: one element per row, grip column in
   `controls-grid.css`, sub-category divider as a direct `role="row"`. Visual no-op.
4. **Controls behaviour** — rows sortable within a category and across its sub-categories; then
   cross-category (chip drop targets + spring-load switch); then sub-category headers; then the
   category rail chips.
5. **Keyboard/menu** — dnd-kit's `KeyboardSensor` everywhere plus a per-row menu holding
   `Move up`/`Move down`/`Move to…`; the inline move buttons leave the row/Options cell.
6. **Settings** — sections, sub-sections and cvar rows sortable with the same primitive.
7. **Proof** — save-bar/Discard/round-trip tests over reordered structures, a `ui:verify` screen
   with visible grips, a `ui:flow` that performs a real drag, axe still at zero.

Affected files: `package.json`; new `src/renderer/src/components/dnd/*`;
`src/renderer/src/modules/config/lib/{entry-order,cvar-sections}.ts` (+ tests);
`components/{ControlsRow,ControlsGrid}.tsx`; `ControlsTab.tsx`; `SettingsTab.tsx`;
`src/renderer/src/styles/controls-grid.css`; `src/renderer/src/i18n/locales/en.json`;
`scripts/lib/screens.mjs` + a new `scripts/flows/controls-drag-reorder.mjs`.

Risk to watch: the packages must be installable from the registry — if `npm install` cannot reach
it, the story stalls at D1 and nothing below it can be built.

## Deliverables

- [x] **D1 — The DnD primitive.**
      `package.json` (+ lockfile): `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.
      New `src/renderer/src/components/dnd/SortableList.tsx` (+ `index.ts`): a `DndContext`
      configured once with `PointerSensor` (activation distance so a click on the grip is not a
      drag), `KeyboardSensor` with `sortableKeyboardCoordinates`, `restrictToVerticalAxis`-style
      modifier where the list is vertical, auto-scroll enabled, a `DragOverlay` that keeps the
      dragged element's measured height, and translated `accessibility.announcements` from
      `en.json`. Plus `DragHandle` (an icon-button-sized `GripVertical` grip with a translated
      accessible name and a `disabled` mode) and the drop-indicator class in
      `src/renderer/src/styles/controls-grid.css`.
      Mirror for the button/tooltip idiom: `components/ui/Button.tsx`'s `IconButton`.
      *Acceptance:* a throwaway or test-only list reorders by mouse and by keyboard (Space, arrows,
      Space; Escape cancels); `npm run build` production bundle logs no CSP violation and the
      renderer contains no injected `<style>`; `renderer-source.test.ts`'s CSP guard still green.

- [x] **D2 — Controls order helpers (pure).**
      `src/renderer/src/modules/config/lib/entry-order.ts` + `entry-order.test.ts`: add
      `moveEntryToPosition(actions, id, beforeId | end)`, `moveEntryToSubcategory(...)`,
      `moveEntryToCategory(actions, id, categoryId)` (appends at the end of that category),
      `moveCategory(categories, id, toIndex)`, `moveSubcategory(category, id, toIndex)` — all pure,
      array-position semantics, no-ops on unknown ids, existing `swapEntries`/`buildMoveTargets`
      untouched.
      *Acceptance:* tests cover each helper incl. cross-category append and unknown-id no-op;
      `npm test` green.

- [x] **D3 — One element per Controls row, plus the grip column.**
      `components/ControlsRow.tsx`, `components/ControlsGrid.tsx`,
      `src/renderer/src/styles/controls-grid.css`, `components/ControlsGrid.test.ts`.
      Wrap a row's fragment in one `role="rowgroup"` element carrying `data-row-id`; the
      sub-category divider becomes a `role="row"` direct child of the table. Add the leading 20px
      grip cell to `.ctrl-row`'s grid template (`:63`) and the column header's `sr-only` label.
      *Acceptance:* no visual change other than the grip column; 40px row height, zebra parity,
      extra-key sub-rows and message rows unchanged; `npm run ui:verify` axe still at zero.

- [x] **D4 — Rows drag within a category.**
      `ControlsTab.tsx`, `components/ControlsGrid.tsx`, `en.json`.
      Wire D1's primitive over the rendered row list of the active category: drop at any position,
      including into another sub-category of the same category (the drop position determines both
      index and `subcategoryId`), persisting through the existing `persistCategoriesAndActions`.
      Drop indicator, auto-scroll, Escape cancel come from D1. Multi-key sub-rows, prompt hosts and
      message rows are never drag targets. Grip disabled while the filter is active.
      *Acceptance:* a row can be dragged anywhere in its category and into a sibling sub-category;
      the save bar shows it as an unsaved change; the "n rows - m bound" footer and conflict markers
      stay correct.

- [x] **D5 — Cross-category drops.**
      `ControlsTab.tsx` (category rail), `en.json`.
      Category chips become droppables: a drop on a chip moves the row to that category, appended at
      the end; hovering a chip for ~600 ms during a drag switches the visible grid to that category
      so the drag can finish at an exact position there.
      *Acceptance:* both paths move the row and persist; the source category loses it, the target
      shows it; cancelling with Escape after a spring-load switch leaves the model untouched.

- [x] **D6 — Sub-category headers reorder by drag.**
      `components/ControlsGrid.tsx`, `ControlsTab.tsx`.
      The group header gets a grip; dragging reorders sub-categories inside their category via D2's
      `moveSubcategory`, existing up/down buttons on the header stay as the keyboard path.
      *Acceptance:* reorder persists and the rendered file emits the sub-category sections in the
      new order.

- [x] **D7 — Category chips reorder by drag.**
      `ControlsTab.tsx` (rail at `:1466`), `en.json`.
      The rail becomes a horizontal sortable list; existing chip move buttons stay as the keyboard
      path.
      *Acceptance:* chip order persists across tab switches and the file's category sections follow.

- [x] **D8 — The row menu takes over move up/down.**
      New `components/ControlsRowMenu.tsx` (built on `components/ui/Menu.tsx`), `ControlsTab.tsx`
      (`renderMoveButtons` :1035-1057 and the free-form action cell :1360-1403), `en.json`.
      A kebab in the row's action cluster with `Move up`, `Move down`, `Move to…` (category /
      sub-category picker, reusing 053's move path); the inline arrow buttons are removed from the
      row.
      *Acceptance:* every ordering operation is reachable by keyboard alone for every row kind
      (catalogue and free-form); no arrow buttons left in a Controls row; `en.json` has no orphaned
      keys.

- [x] **D9 — Settings order helpers (pure).**
      `src/renderer/src/modules/config/lib/cvar-sections.ts` + `cvar-sections.test.ts`:
      `moveSectionToIndex`, `moveSubsectionToIndex`, `moveCvarToPosition(sections, name, target)`
      where target is a (section|subsection, index) pair, incl. moving out of the reserved
      `Defaults`/`Other` buckets into a real section.
      *Acceptance:* tests cover each; reserved buckets are never reordered themselves.

- [x] **D10 — Settings drags.**
      `SettingsTab.tsx`, `en.json`.
      Grips on section headers, sub-section headers and cvar rows; drag reorders and moves cvars
      between sections/sub-sections using D9's helpers and the existing persist path.
      `MoveCvarDialog` and the arrow buttons stay as the keyboard path.
      *Acceptance:* a section, a sub-section and a cvar can each be dragged; filter, "Unsaved only",
      the Advanced collapse and the per-section counts keep working.

- [x] **D11 — Order survives save, discard and render.**
      Tests only: `src/renderer/src/modules/config/lib/*.test.ts` plus the existing round-trip suite
      for `render.ts`/`rebuild.ts` (story 042's property).
      Cases: a reorder is in the profile diff (save bar), Discard restores the previous order, a
      rendered file emits categories/sub-categories/sections/rows in the new order and re-reads
      identically.
      *Acceptance:* `npm test` green, including a reorder-then-round-trip property case.

- [x] **D12 — Seen and driven in the real app.**
      `scripts/lib/screens.mjs` (a Controls screen with grips visible), new
      `scripts/flows/controls-drag-reorder.mjs` (Playwright `mouse.move/down/up` over a grip:
      reorder a row and drop one onto another category's chip), `docs/UI-VERIFICATION.md` if the
      flow list is documented there.
      Mirror: `scripts/flows/controls-subcategory.mjs`.
      *Acceptance:* `npm run ui:verify` green with zero axe findings; `npm run ui:flow --
      controls-drag-reorder` performs a real drag against the running app and the new order is
      visible in the screenshot.

## Model Hints

- D4 → `deliverable-hard` — the first real dnd-kit wiring over a grid whose rows are multi-element
  fragments with zebra parity, folded extra keys and portalled capture prompts: a wrong drop-index
  mapping silently reorders the wrong rows and regresses stories 020/029/056.
- D5 → `deliverable-hard` — spring-loaded category switching mid-drag changes the rendered list
  under an active drag (dnd-kit measurement/cancel semantics) and mutates cross-category
  membership; getting cancel/Escape wrong here corrupts a category's contents.
- All other Ds → default tier.
- Review: → `story-review-hard` — the story crosses twelve deliverables, restructures the Controls
  grid's ARIA/DOM, relocates existing controls and touches the file-render order; a cheap review
  would not catch a silent ordering or accessibility regression.

## Test Plan (manual acceptance)

1. Open Config → a profile → **Controls**. Every row shows a grip on hover; the row is still 40px
   and the zebra striping is unchanged.
2. Drag a row two positions up inside its sub-category, release. The order changes, the save bar
   reports an unsaved change. Press **Discard** — the old order is back.
3. Drag a row into a different sub-category of the same category; save. Reopen the profile: the row
   is still there.
4. Drag a row onto another category's chip in the rail — it disappears from the current grid.
   Switch to that category: it is the last row.
5. Start dragging a row, hover a foreign chip for a second until the grid switches, then drop the
   row between two rows there — it lands at that exact position.
6. Start a drag and press **Escape** mid-drag: nothing moves, no unsaved change appears.
7. Drag a sub-category header up; drag a category chip to the front of the rail. Open **Raw file** —
   sections are emitted in the new order.
8. With the mouse untouched: Tab to a row grip, press **Space**, arrow up twice, **Space**. The row
   moved. Then open a row's kebab menu and use **Move to…** to send it to another category.
9. Type into the Controls filter: grips are disabled with a tooltip explaining why; the row menu's
   move commands still work.
10. Go to **Settings**: drag a cvar into another section, drag a section above another, drag a
    sub-section. Save, reopen, check **Raw file** — the cvar sections follow the new order.
11. Run `npm run ui:verify` (green, zero axe findings) and
    `npm run ui:flow -- controls-drag-reorder`.

## Coverage (AC → D)

- AC1 (row grip, any position, other sub-category, onto a chip) → D1, D3, D4, D5
- AC2 (sub-category headers, category chips draggable) → D6, D7
- AC3 (Settings sections + cvars) → D9, D10
- AC4 (drop indicator, auto-scroll, no height jump, Escape) → D1, D3, D4
- AC5 (keyboard path for every drag operation) → D1 (keyboard sensor), D8 (row menu), D6/D7/D10
  (existing arrow buttons kept)
- AC6 (array position, save bar, Discard, rendered order, 042 round-trip) → D2, D9, D11
- AC7 (multi-key sub-rows not drag targets; conflicts/filter/footer keep working) → D3, D4, D10
- AC8 (CSP stays `style-src 'self'`, ui:verify axe-clean, a real ui:flow drag) → D1, D12

## Done

Drag-and-drop reordering added everywhere in Config, via `@dnd-kit` (`core`/`sortable`/`utilities`/`modifiers`).
A single shared primitive (`src/renderer/src/components/dnd/`: `SortableZone`/`SortableItem`/`DragHandle`,
translated announcements + instructions) backs every surface. Controls: rows drag within/across
sub-categories, onto another category (chip drop or ~600ms spring-loaded switch), sub-category headers
and category chips reorder, all through one `ControlsDragZone`/`DndContext`; the old inline move
buttons on rows were replaced by a kebab menu (`ControlsRowMenu` + `MoveEntryDialog`: Move up/down/Move
to…). Settings: section, sub-section and cvar rows are all drag-reorderable on top of the existing
`MoveCvarDialog`/arrow-button keyboard path (nothing removed there). Pure array-position helpers
(`entry-order.ts`, `cvar-sections.ts`) back every reorder; all persist through the existing save/dirty/
Discard path. A genuine pre-existing gap was found and fixed while testing Discard: `ProfileBaseline`/
`captureBaseline`/`ProfilesStore.discard()` never captured or restored `cvarSections`, so a Settings
reorder could not be discarded before this fix.

A first review pass (story-review-hard) returned PASS with 6 confirmed findings; all six were fixed in
one review-fix cycle: dnd-kit's untranslated default screen-reader instructions were replaced with a
translated `en.json` string; row drag announcements now speak the row's label instead of its raw id;
`cvarSections` was made an optional/defaulted schema field (was required, which silently discarded
every pre-story baseline on read); Settings' cvar-drag-disabled-while-narrowed check was scoped
per-section instead of globally; a rendered-index vs. real-array-index mismatch for cvar drops next to
a "ghost" (unrendered) cvar name was fixed with an index remap; and the extra-key sub-row/message-row
indent was restored to account for the new grip column's width.

**Decisions (not asked, made and recorded here):**
- D1 added `@dnd-kit/modifiers` (for `restrictToVerticalAxis`) as a fourth package alongside the three
  the user named — it's a peer of `sortable`, not a second library choice, same as `utilities`.
- The Controls row grip column ended up 28px wide, not the 20px the Decisions section named — a 28px
  `IconButton`-sized grip does not fit an accessible hit target in 20px; the extra 8px comes out of the
  Action column's `1fr` track, not a new reflow.
- D5's cross-category spring-load state is provisional-only (a `viewActions`/`viewCategoryId` overlay
  that no code path persists); `onDragFinished` always drops it, so Escape/cancel-after-spring-load is a
  single exit path rather than an explicit undo.
- Settings keeps a reserved-bucket drop as a silent no-op (dropping a cvar onto `Defaults`/`Other` does
  nothing) rather than adding new "not allowed" drag feedback, consistent with D9's existing
  reserved-bucket invariant and out of this story's scope.

**Incident (disclosed):** partway through the build, the D8 agent accidentally ran
`git show HEAD:<path> > <path>` on `ControlsTab.tsx`, resetting that one file to its pre-story version
and destroying D4-D7's wiring that lived only there (confirmed via `git diff --stat HEAD` producing no
output before recovery). All other files were untouched. A follow-up agent reconstructed the lost
wiring from the surviving supporting files (`ControlsDragZone.tsx`, `ControlsGrid.tsx`, the entry-order
helpers) and the surviving test files that encoded the expected integration contract, then re-verified
everything green. The review agent was specifically asked to scrutinize this file for regressions or
leftover dead code and found the reconstruction faithful and complete.

**Verification:** `npm run build` green · `npm test` 2541/2541 green · `npm run typecheck` (node+web)
green · `npm run ui:verify` green, 64/64 screenshots, 0 axe violations · `npm run ui:flow --
controls-drag-reorder` green, performs a real pointer drag (row reorder + drop onto a category chip)
against the running app and confirms the new order in the DOM and screenshots · code review
(story-review-hard): PASS, 6 findings, all fixed in one review-fix cycle, re-verified green after.

**Commit message:** `054: order everything by drag and drop`
