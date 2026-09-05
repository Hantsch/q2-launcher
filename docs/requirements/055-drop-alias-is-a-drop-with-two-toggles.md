---
id: 055
title: A `drop_` alias is a drop, with two toggles instead of two checkboxes
status: draft
created: 2026-09-05
---

## Requirement

In my config every drop is an alias called `drop_<something>` - `drop_shotgun`, `drop_rail`,
`drop_shells`, `drop_tech`, `drop_powers` (`docs/fixtures/dmalias.cfg:86-103`, sixteen of them) -
with a body of the shape `drop <item>; [drop <ammo>;] [say_team ...;] [extras such as wave 1]`. That
name pattern *is* the type: a drop is a helper type, like a toggle or a press/release pair, and
"Weapon dropping" is just where the template happens to put them.

The launcher instead identifies a drop by `row.categoryId === 'drops'` on a catalogue row
(`ControlsTab.tsx:672`, `:758`; "drops machinery is catalogue-only", `:866-869`). An imported
`drop_rail` is therefore a plain alias row with no ammo or message option, and the launcher's own
drop rows render under an alias derived from the display name rather than `drop_...`. The two
options themselves are two stacked checkboxes with text labels in the 150px Options track
(`ControlsTab.tsx:664-697`, `data-testid="drop-ammo-*"` / `drop-message-*`) - functional, but heavy
and text-only.

What I want: a `drop_` alias is a drop wherever it sits, and every drop gets the drop options; the
options are two toggle buttons (on/off) with an icon and a tooltip - ammo and team message - instead
of two checkboxes.

## Acceptance Criteria

- [ ] Any entry whose alias name starts with `drop_` and whose body contains a `drop <item>` command
      is a drop entry - in any category, imported or created - and gets the drop options; an entry
      that does not match keeps behaving as a plain alias.
- [ ] The launcher's own drop entries (the template's Weapon dropping rows and newly created ones)
      render as `drop_<slug>` aliases, so one rule recognises hand-written and generated drops alike.
- [ ] The Options cell of a drop row shows two toggle buttons - "Drop ammo too" and "Announce to
      team" - each with an icon, a tooltip, a pressed state that is not colour-only, and full
      keyboard operability; the two checkboxes and their text labels are gone.
- [ ] The ammo toggle adds/removes the `drop <ammo>` command for the item's ammo (the existing
      weapon -> ammo knowledge in the catalogue); it is disabled with an explaining tooltip when the
      item has no ammo (`drop_tech`).
- [ ] The message toggle adds/removes the `say_team` message (channel as today); the inline message
      row with "Edit message" from story 029 stays the way to edit the text.
- [ ] Extra commands in a drop body (`wave 1`, a second `drop shells`) survive both toggles and
      round-trip untouched.
- [ ] Import: `drop_*` aliases from a foreign config arrive as drop entries with their ammo/message
      state read off the body; importing `docs/fixtures/dmalias.cfg` yields sixteen drop entries and
      leaves `dall` a plain alias.
- [ ] Story 042's round-trip property, Care and the Overview keep working; a drop key on the
      keyboard shows the entry's display name as before.
- [ ] `npm run ui:verify`'s `config-controls-drop-message` screen and the `drop-message-checkbox`
      flow are updated to the toggles.

## Open Questions

1. **Body shape:** does the rule also apply when the first command is not `drop ...`
   (`drop_tech` is `say_team ...; drop tech`)? Recommendation: yes - any body with at least one
   `drop <item>` command qualifies; the item is the first `drop` command's argument.
2. **Ammo for items outside the weapon table** (`drop_powers` = `drop cells; drop power shield`):
   treat any further `drop <known ammo name>` as the ammo toggle and everything else as an extra?
   Recommendation: yes, using the catalogue's ammo names.
3. **Aliases tab:** should the two toggles also appear on a drop entry there? Recommendation: no -
   Controls is the editor, Aliases is the name space.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
