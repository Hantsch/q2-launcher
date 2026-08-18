---
id: 015
title: Advanced tab — dual-bind editor for Movement, Weapons and Weapon dropping
status: draft
created: 2026-08-18
---

## Requirement

As a user, I want the Movement, Weapons and Weapon dropping categories in the Advanced tab
(story 008) to stop being a generic, free-form action list and instead show the fixed set of
actions each category actually has — one row per action, with a **Primary** and a **Secondary**
bind slot, each showing the key it's bound to or an explicit "empty" state — so I can select a
slot and press the key I want, exactly like the dual-bind keybinding screens most games ship
(a left-hand list of actions, then two columns showing what's bound and letting me reassign it
with a keypress). Today's flow (name a new action, open its editor, pick catalogue entries by
hand, add commands one at a time) is the right shape for genuinely custom, user-authored actions,
but it's the wrong shape for a fixed catalogue like "move forward" or "use rocket launcher" —
those don't need naming, they need binding.

Weapon dropping additionally needs to be organized into three groups instead of one flat list —
**Weapons**, **Ammunition** and **Misc** (everything else droppable: powerups, tech) — and each
weapon-dropping row needs two things the other two categories don't: a choice of whether the drop
includes the matching ammo or not, and a free-text field for the team-chat line said when the key
is pressed (a `say_team` alongside the `drop` command(s)).

The built-in/custom split and the entry-kind picker (`bind`/`message`/`alias`, story 008 decision
6) stop applying to these three categories once they get their own dedicated editor — that
generic machinery stays exactly as it is today, but only for categories the user creates
themselves.

Assigning a key while a modifier (Alt/Ctrl/Shift) is held is a related but separate capability,
covered by [016](016-modifier-layer-on-bind-capture.md) — this story's capture slots must exist
and be pressable before that story has anywhere to plug into.

See [docs/concepts/config-module.md §5](../concepts/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned),
`src/shared/config/action-catalog.ts` (`MOVEMENT_ACTIONS`, `WEAPONS`/`WEAPON_ACTIONS`/
`WEAPON_EXTRA_ACTIONS`, `DROPPABLES`/`DROP_ACTIONS`) and story 008's
`src/renderer/src/modules/config/AdvancedTab.tsx` / `components/ActionEditor.tsx`, which this
story replaces the built-in-category path of.

## Acceptance Criteria

- [ ] Movement, Weapons and Weapon dropping each show every action from their fixed catalogue as
      a row; there is no "create action" step and no name field for these three categories —
      users can neither add nor remove rows there (only custom categories keep today's free-form
      create/rename/remove).
- [ ] Every row has two independent bind slots, **Primary** and **Secondary**; each shows its
      currently bound key, or an explicit "not bound" state when empty.
- [ ] Clicking a slot starts a capture; the next key pressed becomes that slot's key, replacing
      whatever was there; a slot can also be cleared without entering capture.
- [ ] Weapon dropping is split into three groups: **Weapons** (one row per `DROPPABLES` entry of
      kind `weapon` — the Blaster is not listed, matching today's catalogue, since it cannot be
      dropped), **Ammunition** (`kind: 'ammo'`), **Misc** (`kind: 'powerup' | 'tech'`).
- [ ] Every Weapon-dropping row whose droppable has a matching ammo type offers a "with ammo" /
      "without ammo" choice that controls whether the row's key drops one command (the item
      alone) or two (item + ammo); rows without an ammo type (Ammunition and Misc rows, and any
      Weapons row without one) have no such choice to make.
- [ ] Every Weapon-dropping row has a free-text field for the team message said (`say_team`) when
      the row's key is pressed, alongside its `drop` command(s).
- [ ] Movement rows use the same Primary/Secondary editor, with no ammo choice and no message
      field — those are Weapon-dropping-only.
- [ ] Weapons rows let the user assign the "use `<weapon>`" bind, and the `weapnext`/`weapprev`/
      `weaplast` cycling actions, through the same Primary/Secondary editor.
- [ ] Movement, Weapons and Weapon dropping no longer show the "Built-in" badge or an entry-kind
      picker — both stay exactly as they are today, but only for user-created custom categories.
- [ ] Assigning a Primary/Secondary key that collides with a bind already used elsewhere in the
      profile is surfaced to the user, not silently overwritten without warning.
- [ ] Everything bound here shows up correctly in the Overview tab and in the generated profile
      file, the same way story 008's action binds already do.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
