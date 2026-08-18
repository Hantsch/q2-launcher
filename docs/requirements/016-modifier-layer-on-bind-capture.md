---
id: 016
title: Auto-create an Alt/Ctrl/Shift layer when a modifier is held during key capture
status: draft
created: 2026-08-18
---

## Requirement

As a user assigning a Primary/Secondary key in the Movement/Weapons/Weapon-dropping dual-bind
editor ([015](015-dual-bind-editor-movement-weapons-drops.md)), I want to just hold Alt, Ctrl or
Shift while pressing the key I want, and have the launcher figure out the rest — creating the
matching modifier layer if it doesn't exist yet, and placing the assignment there — instead of
making me leave the editor, go create a layer by hand in the Layers panel, and come back.

Quake 2 has no modifier keys at the engine level (`src/shared/config/alt-layers.ts`'s own doc
comment: "the engine sees ALT and W as two unrelated keys") — what looks like "Alt+R" to a player
is really the ALT key's own bind triggering a layer that temporarily rebinds R. So when a capture
sees a modifier held down, that combination is exactly an alt-layer override waiting to happen,
not a literal key to store: hold Alt, press R while assigning "drop rocket launcher" → an "Alt"
layer gets created (if there wasn't one) and R gets overridden inside it to the drop command;
hold Ctrl, press R while assigning "rocket ammo" → a "Ctrl" layer gets created the same way, with
its own R override. Neither layer needs to exist beforehand, and picking Ctrl+R for one action and
Alt+R for another must not fight over which layer owns "R" — they're different layers.

## Acceptance Criteria

- [ ] Capturing a key while exactly one of Alt/Ctrl/Shift is held resolves to that plain key plus
      the held modifier, not to a literal combined key string (Quake 2 cannot bind "ALT+R" as one
      key, per `alt-layers.ts`).
- [ ] If no layer exists yet whose trigger is that modifier, one is created automatically (hold
      mode, trigger key `ALT`/`CTRL`/`SHIFT`), named recognizably after its modifier.
- [ ] If a layer with that modifier as its trigger already exists — auto-created earlier in this
      flow, or hand-made in the Layers panel — the new assignment is added to that same layer's
      overrides; a second layer is never created for the same modifier.
- [ ] The assignment lands as an override on the resolved key inside that layer; the base layer's
      existing bind for that key (if any) is untouched.
- [ ] A Weapon-dropping row's ammo choice and team-message text produce the identical rendered
      command(s) whether the row's key ends up on the base layer or inside an auto-created
      modifier layer.
- [ ] Capturing a modifier+key combination that already has an override in that layer (used by a
      different action) warns before overwriting, the same way a plain-key collision is already
      surfaced elsewhere in the keybinding editor.
- [ ] An auto-created modifier layer is a completely ordinary layer afterwards — visible and
      editable in the existing Layers panel, renameable, its mode changeable, its overrides
      addable/removable there too, same as any hand-created layer.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
