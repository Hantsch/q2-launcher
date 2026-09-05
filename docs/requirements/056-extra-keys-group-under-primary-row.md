---
id: 056
title: Extra keys group under the primary row
status: ready
created: 2026-09-05
---

## Requirement

Story 050 made an entry's keys an uncapped list, but the Controls grid still has exactly two key
columns, Primary and Secondary (`src/renderer/src/styles/controls-grid.css:52-59`:
`minmax(180px, 1fr) 34px 190px 190px 150px`), renders exactly two `BindSlot`s per row
(`components/ControlsRow.tsx:131-132`) and shows nothing for a third key - 050 explicitly deferred
"an N-slot editing surface" as a story of its own (`docs/requirements/050-...md:161-168`); today a
hand-added third key is visible only in Care's tidy-up rows ("slot 3").

Two equal columns also read wrong: my main key is not one of two peers, it is *the* key, and further
keys are extras.

What I want: one key per line. The row shows the primary key; each additional key is its own
indented line directly beneath, visibly subordinate; when there is more than one additional key the
group folds behind a chevron with a count. Adding another key is one click on the group, not a
second column.

## Acceptance Criteria

- [ ] The grid has one Key column instead of Primary/Secondary; a row shows its first key (or
      Empty) there.
- [ ] Each further key renders as an indented sub-row under its row: key cap (with the modifier cap
      for a layer key), conflict marker, clear button; sub-rows follow the file's slot order.
- [ ] With more than one additional key the sub-rows collapse behind a chevron on the main row that
      shows "+n"; the fold state is kept while the tab is open.
- [ ] An "add key" affordance on the row (or its last sub-row) starts key capture for a new slot,
      with the same capture, collision (Cancel/Replace) and modifier-layer rules as today.
- [ ] Clearing the primary key promotes the next key; clearing a sub-row removes that key; no other
      slot moves, and Care's tidy-up operations that name a slot stay valid.
- [ ] Every key of every entry is now editable in Controls - the hand-added third key from story
      050's test plan is visible and clearable here, not only in Care.
- [ ] The freed width goes to the Action and Options columns; the 1120px stage, 40px rows and
      zebra parity stay (the `/design-tokens` deviation recorded in `CLAUDE.md` is unchanged); the
      "n rows - m bound" footer counts any slot for every row kind.
- [ ] Overview keyboard, Aliases, the conflict scan, tidy-up and the save-bar change list keep
      working; no "Primary"/"Secondary" wording is left in the UI or in `en.json`
      (`config.controls.grid.colPrimary/colSecondary`, `config.controls.dualBind.primary/secondary`).
- [ ] `npm run ui:verify` shows a row with two extra keys folded and unfolded; a `ui:flow` adds a
      third key and clears the primary through the real UI.

## Open Questions

1. ~~**Default fold state:**~~ answered → Decisions (Sprint)
2. ~~**Where "add key" lives:**~~ answered → Decisions (Sprint)
3. ~~**Overview's key dialog:**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Default fold state: collapsed beyond one extra key - one extra key is common and
  should stay visible.
- **(User)** Where "add key" lives: `+` on the main row while there are no extras, and as the last
  sub-row once the group is open.
- **(User)** Overview's key dialog: out of scope - `KeyBindDialog` keeps binding one key at a time.
- **Clear semantics:** clearing a key removes its slot entry (the `keys` array compacts) instead of
  writing story 050's `{ key: '' }` placeholder, so the next key moves up - once every slot is
  editable, the placeholder that only existed to stop a hand-added slot from shifting has no purpose
  and AC 5's "promotes the next key" requires the compaction.
- **Legacy empty slots:** a `{ key: '' }` slot read from an existing profile is filtered out on read
  and dropped on the next write - it is the old cleared marker and would otherwise render as a
  phantom sub-row.
- **Slot vocabulary:** the renderer's `slot: 'primary' | 'secondary'` union is replaced by a numeric
  slot index everywhere - it is the last place that caps the model's already-N-ary `action.keys` at
  two (`src/shared/config/action-slots.ts`, `bind-collision.ts` and `tidy-up.ts` are already N-ary).
- **Grid template:** `minmax(220px, 1fr) 34px 224px 190px` (Action / reset / Key / Options), the Key
  cell being the 190px slot plus a 34px affordance area - this hands the freed second 190px track to
  Action (+~116px) and Options (150→190px) as AC 7 asks, with the 1120px stage untouched.
- **Sub-rows reuse `BindSlot` unchanged** (only `isPrimary` is false) - AC 4 demands identical
  capture, collision and modifier-layer behaviour, and reusing the component is cheaper and less
  regression-prone than a second slot implementation.
- **Fold rule:** exactly one extra key renders with no chevron (always visible); from two extras a
  chevron on the main row shows "+n" (n = total extras) and starts collapsed, its state held in a
  `Set` of row ids in `ControlsTab` like the existing `revealedMessageRows` - that is the user's
  default-fold decision plus AC 3's tab-lifetime persistence.
- **`+` placement:** the add-key button sits on the main row whenever the extras group is not open
  (no extras at all, or a collapsed group) and moves to the last sub-row while it is open - the user
  decision names the two common cases; without this a collapsed group would lose its add path.
- **Row markup stays flat siblings** (`.ctrl-row`, prompt-host row, key sub-rows, message row), but
  every element of one row carries `data-row-id` - this keeps story 020's explicit zebra parity, the
  ARIA table structure and the prompt portal host intact while giving story 054's drag and drop one
  stable unit to grab, matching 054's "multi-key sub-rows are not drag targets".
- **Alias entries** keep their inert `BindSlotPlaceholder`, get no sub-rows and no `+` - story 019's
  rule that binding an alias must be impossible through the UI is unchanged.
- **Wording:** the column header becomes "Key"; a slot's accessible name becomes "Primary key" /
  "Key n" - AC 8 forbids leftover Primary/Secondary wording, but a slot still needs a distinguishing
  accessible name.
- **Options cell and footer scan every slot in order** (first modifier wins, first conflict wins) -
  extends today's primary-first tie-break to N slots without inventing a second rule, and is what
  AC 7's "counts any slot for every row kind" needs.
- **The populated `ui:verify` fixture gains an action with three keys** - AC 9's folded/unfolded
  screenshots need a row that actually has two extras.

## Plan

The model is already N-ary (`ConfigAction.keys`, `src/shared/config/action-slots.ts`), and so are
the conflict scan (`bind-collision.ts`), the renderer scan (`bind-slot-collision.ts`) and Care's
tidy-up. The two-slot cap is renderer-only, in four places: `catalog-binds.ts`'s
`'primary' | 'secondary'` union, `ControlsTab.tsx`'s two `render*Slot` helpers (each called exactly
twice), `ControlsRow.tsx`'s `primarySlot`/`secondarySlot` props and `ControlsGrid.tsx`'s two header
cells. So this is a renderer refactor plus one semantic change (clear compacts).

Order:

1. **Write layer first** (`lib/catalog-binds.ts`): numeric slot index instead of the union, plus
   append-a-slot and compacting-clear; `deriveRowState` exposes the whole slot list. Unit-tested on
   its own before any markup moves.
2. **Shell** (`controls-grid.css`, `ControlsGrid.tsx`, `ControlsRow.tsx`): four columns, one Key
   cell, sub-row classes at 30px inside 40px rows, `data-row-id` on every element of a row.
3. **Tab wiring** (`ControlsTab.tsx`): primary slot + chevron/"+n" + `+` in the Key cell, extras as
   sub-rows, fold state, add-key capture.
4. **Promotion, counts, options cell** wired onto D1's semantics.
5. **Wording, fixture, `ui:verify` screens and the `ui:flow`.**

Affected files: `src/renderer/src/modules/config/lib/catalog-binds.ts` (+ test),
`src/renderer/src/modules/config/ControlsTab.tsx`,
`src/renderer/src/modules/config/components/{ControlsRow,ControlsGrid}.tsx`,
`src/renderer/src/styles/controls-grid.css`, `src/renderer/src/i18n/locales/en.json`,
`scripts/lib/{fixture,screens}.mjs`, `scripts/flows/`.

Not touched: `src/shared/**` (already N-ary), `BindSlot.tsx` (reused as-is), main process, IPC.

## Deliverables

**D1 — the write layer counts slots, and a clear compacts**
`src/renderer/src/modules/config/lib/catalog-binds.ts` (+ its test file). Replace
`slot: 'primary' | 'secondary'` with `slotIndex: number` in `applySlot`, `applyPlainSlot`,
`applyReplace`, `applyModifierReplace`, `applyPlainReplace`, `applyPlainModifierReplace`; add
`appendKeySlot` (write at the first free index) and make a clear **remove** the slot entry rather
than write `{ key: '' }`; `deriveRowState` gains `keys: readonly ActionKeySlot[]` (empty-key slots
filtered) and loses `primary`/`secondary`/`*Modifier`. Update the non-Controls callers
(`ActionEditor`, `editorKeySlot`, `bind-slot-collision.ts` if it re-declares the union).
*Acceptance:* unit tests cover — clearing slot 0 of a 3-key action promotes keys 2/3 to 0/1 and
touches nothing else; clearing a middle slot removes only it; append lands after the last key; a
legacy `{ key: '' }` slot is not returned by `deriveRowState` and is gone after the next write;
`isEmptyAction`/pruning still behaves as before. `npm test`/`npm run typecheck` green.

**D2 — one Key column in the grid shell**
`src/renderer/src/styles/controls-grid.css`, `components/ControlsGrid.tsx`,
`components/ControlsRow.tsx`, `i18n/locales/en.json`. Grid template →
`minmax(220px, 1fr) 34px 224px 190px`; header cell → `config.controls.grid.colKey`; `ControlsRow`
swaps `primarySlot`/`secondarySlot` for `keyCell: ReactNode` + `extraKeyRows?: ReactNode` and takes
a `rowId` it stamps as `data-row-id` on `.ctrl-row`, the prompt-host row, the extra-key rows and the
message row. New classes `.ctrl-keycell`, `.ctrl-keysub-row`, `.ctrl-keysub` (30px slot, indented on
the `.ctrl-msgrow` `padding-left: calc(16px + 34px + 10px)` pattern), `.ctrl-keymore`.
*Mirror:* `.ctrl-msgrow-row`/`.ctrl-msgrow` (`controls-grid.css:330-351`) for the sub-row shape and
`ControlsRow.tsx:156-162` for how an optional sub-row is rendered.
*Acceptance:* the tab renders with one Key column, 1120px stage, 40px rows and unchanged zebra
parity; no extra-key content yet. Build/typecheck green.

**D3 — primary key, extra-key sub-rows, fold and add**
`src/renderer/src/modules/config/ControlsTab.tsx`, `i18n/locales/en.json`. `renderCatalogSlot`/
`renderPlainSlot` take a numeric slot index; a new `renderKeyCell` puts the slot-0 `BindSlot` plus
(from two extras) a chevron button reading "+n" and — when the group is not open — the `+` add
button into the Key cell; `renderExtraKeyRows` maps slots 1..n to `BindSlot`s (`isPrimary={false}`)
with the `+` as the last sub-row while the group is open. Fold state: `expandedKeyRows` `Set<string>`
keyed by `catalogId`/`action.id`, mirroring `revealedMessageRows` (`ControlsTab.tsx:190-192`);
exactly one extra always renders, two or more start collapsed. `+` starts capture on
`appendKeySlot`'s index with the unchanged collision/modifier plumbing. Alias rows keep
`BindSlotPlaceholder` and get neither sub-rows nor `+`.
*Acceptance:* a row with three keys shows one key plus a "+2" chevron; expanding shows two indented
sub-rows each with cap, modifier cap, conflict marker and clear, in file order, plus the `+`; the
fold survives switching category and back within the tab; `+` captures into a new slot and the
Cancel/Replace prompt still renders in the row's prompt host.

**D4 — promotion, counts and the Options cell go N-ary**
`src/renderer/src/modules/config/ControlsTab.tsx`. Wire D1's compacting clear into the slot
`onClear` paths; `boundCount` uses `actionKeySlots(...).some(key)` for catalogue rows too
(`ControlsTab.tsx:550-556`); `renderCatalogOptionsCell`/`renderPlainOptionsCell` scan every slot in
order for the modifier/layer name and the "also: <owner>" conflict instead of slots 0/1; the row
reset clears all slots.
*Acceptance:* clearing the primary of a 3-key row promotes key 2 into the Key column and leaves key
3 as the single extra; clearing a sub-row removes only that key; the footer's "m bound" counts a row
whose only key is a third slot; a modifier or conflict on slot 3 shows in Options.

**D5 — wording, fixture, screenshots and the flow**
`src/renderer/src/i18n/locales/en.json`, `scripts/lib/fixture.mjs`, `scripts/lib/screens.mjs`,
`scripts/flows/controls-extra-keys.mjs` (new). Remove `config.controls.grid.colPrimary`/
`colSecondary` and `config.controls.dualBind.primary`/`secondary`; give the populated fixture an
action with three keys; add two screen-registry entries (extras folded, extras unfolded) mirroring
an existing entry in `scripts/lib/screens.mjs`; add a `ui:flow` that adds a third key and clears the
primary through the real UI, mirroring `scripts/flows/open-keycap-dialog.mjs`.
*Acceptance:* no "Primary"/"Secondary" string remains in `en.json` or the UI; `npm run ui:verify` is
green with zero axe violations at every impact level and both new screens shot;
`npm run ui:flow -- controls-extra-keys` completes and its screenshots show the third key added and
the primary cleared/promoted.

## Model Hints

- **D1 → `deliverable-hard`** — this is the key-write path: turning story 050's in-place
  `{ key: '' }` clear into a compacting removal can silently drop a user's binds across the
  catalogue/plain/replace/modifier variants, and the milestone's carry-over rule for render/restore-
  adjacent code (039, 042, 050, 045) says exactly this kind of change is not safe to review from a
  diff.
- D2, D3, D4, D5 → default.
- **Review: → `story-review-hard`** — the story changes what a save writes to `action.keys` for
  every Controls edit, and a lost or shifted slot would surface only after a render/re-import cycle,
  not in any per-deliverable test.

## Test Plan (manual acceptance)

1. Start the app (`npm run dev` or a built run), open Config → a profile → **Controls**.
2. Confirm the grid header reads **Action / Key / Options** — no "Primary", no "Secondary" anywhere.
3. Pick a bound row. Click the `+` on the row, press a key → it appears as one indented sub-row
   directly under the row, no chevron.
4. Click `+` on that sub-row, press another key → the sub-rows now fold behind a chevron reading
   **+2** on the main row, collapsed by default. Click the chevron → both sub-rows and the `+`
   appear; click again → collapsed.
5. Expand, switch to another category and back → the row is still expanded.
6. Assign a key that is already used elsewhere → the Cancel/Replace prompt appears under the row and
   both choices behave as before. Hold Alt while capturing on a sub-row → the modifier cap shows on
   that sub-row and the layer name appears in Options.
7. Clear the primary key (its clear button, or DEL while capturing) → the second key moves into the
   Key column and the third becomes the single remaining extra. Clear a sub-row → only that key
   goes.
8. Check the footer "n rows · m bound" counts a row whose only remaining key is an extra one.
9. Open **Care** and run a tidy-up action that names a slot → it still applies to the right key.
   Open **Overview** and **Aliases** → both still render, the key you added is on the keyboard.
10. Save, open **Raw file** → the added key is in the file in slot order; reload the profile → the
    row still shows the same keys in the same order.

## Done
