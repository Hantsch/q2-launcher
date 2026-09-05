---
id: 056
title: Extra keys group under the primary row
status: draft
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

1. **Default fold state:** always expanded, collapsed beyond one extra key, or collapsed whenever
   there is any extra key? Recommendation: collapsed beyond one extra - one extra key is common and
   should stay visible.
2. **Where "add key" lives:** a small `+` slot after the key on the main row, or a "+ key" line as
   the last sub-row? Recommendation: `+` on the main row while there are no extras, and as the last
   sub-row once the group is open.
3. **Overview's key dialog:** should `KeyBindDialog` list all slots of an action too?
   Recommendation: out of scope - it binds one key at a time.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
