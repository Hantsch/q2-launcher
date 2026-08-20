---
id: 029
title: Drop-row team message as checkbox + inline row (mirrors "With ammo")
status: draft
created: 2026-08-20
---

## Requirement

In Config → Controls, every row in the "drops" category (weapon drops, ammo drops, misc drops)
currently exposes its team message via an icon button in the Options cell
(`ControlsTab.tsx`'s `renderCatalogOptionsCell`, `MessageSquare`/`MessageSquareText`): clicking it
jumps straight into the full `MessageEditor` modal, and whether a message is set is only
distinguishable by the icon's filled vs. outline state.

Weapon-drop rows that also have a matching ammo item already show a different pattern right next
to that icon: a plain "With ammo" checkbox (`config.controls.dropBind.withAmmo`,
`applyAmmo`/`deriveRowState`'s `withAmmo`). The message option should work the same way instead of
the icon button: a checkbox (e.g. "With message" — the exact wording is a small thing, not worth
a design detour) sitting in the Options cell like "With ammo" does. Checking it reveals a message
row directly below that catalogue row in the grid, showing the current message text and a button
that opens the existing rich `MessageEditor` modal (channel choice, macro bar, symbol picker, live
preview — unchanged) for full editing. Unchecking it hides that row again.

This is a presentation change only — the underlying data model (`ConfigCommand` of kind
`'message'` on the action) and the `MessageEditor` modal's own editing capabilities are not
expected to change. What changes is how the message option is reached and shown at a glance,
consistent with how the ammo option already works.

How the inline message row fits into the Controls grid's layout — today built on a fixed 40px row
height (`controls-grid.css`, see the `/design-tokens` deviation entry in `CLAUDE.md`) — is left to
`/refine` to work out; this story only states the desired behaviour, not the grid mechanics.

## Acceptance Criteria

- [ ] Each drop row (weapon, ammo, misc) in Config → Controls shows a "With message"-style
  checkbox in its Options cell, replacing today's message icon button.
- [ ] For a weapon-drop row that also has an ammo item, the "With message" checkbox sits alongside
  the existing "With ammo" checkbox with the same visual weight (no icon-button leftover).
- [ ] Checking "With message" reveals a message row directly below that catalogue row, showing the
  action's current message text (or an empty/placeholder state if none is set yet) plus a button
  to edit it.
- [ ] That button opens the existing `MessageEditor` modal unchanged (channel choice, macro bar,
  symbol picker, live preview, key capture).
- [ ] Unchecking "With message" hides the message row again.
- [ ] The checkbox's checked state reflects whether the action currently carries a `message`
  command, the same way "With ammo" reflects `ammoCommand` inclusion today.
- [ ] No regression to the existing ammo toggle, key binding slots, or the Options cell's
  layer/conflict text.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
