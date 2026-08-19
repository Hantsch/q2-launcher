---
sprint: S03
status: done
branch: sprint/S03
milestone: Config module — UX polish following S02 acceptance (docs/systems/config-module.md)
---

# Sprint S03 — Config module UX polish

## Goal

Fix the friction found while running S02's live acceptance pass: alt-layer triggers can be
assigned/reassigned by binding instead of only at layer creation, the alt-layers panel and layer
switcher are laid out more usably next to the keyboard overview, a trigger key's role and target
layer are visible directly on the board, a profile's raw rendered config file can be inspected
and revealed on disk, and the Movement/Weapons/Weapon-dropping categories in the Advanced tab get
a dedicated dual-bind (Primary/Secondary) editor with modifier-layer auto-creation on capture.

## Stories (in build order)

- [x] 011 — Assign an alt layer's trigger by binding it to a key, not at creation (built, live acceptance pending)
- [x] 013 — Compact the empty alt-layers state and move the layer switcher next to the keyboard overview (built, live acceptance pending)
- [x] 014 — Show an alt-layer trigger's action on its own keycap, and switch layers by clicking it (built, live acceptance pending)
- [x] 012 — Raw config view with reveal-in-folder (built, live acceptance pending)
- [x] 015 — Advanced tab — dual-bind editor for Movement, Weapons and Weapon dropping (built, live acceptance pending)
- [ ] 016 — Auto-create an Alt/Ctrl/Shift layer when a modifier is held during key capture (blocked: AC5 unresolved after 3 review-fix cycles — layer overrides store a bare command string with no row identity, so two catalog rows with colliding command text can't be told apart on read-back/write-back; needs a plan-level decision, routed back through `/refine`)

## Notes

All six stories were filed as drafts (2026-08-18) after S02's live acceptance pass surfaced real
friction — not pulled from unimplemented concept scope, since the config-module concept
([docs/systems/config-module.md](../../systems/config-module.md)) reached full q2-config-manager
feature parity at the end of S02 and moved out of `concepts/`.

Order matters: 011 changes how a layer's trigger key is assigned/reassigned, which 013's layout
move and 014's on-keycap trigger display build on top of — so those three go first, in that
order (014's acceptance criteria explicitly reference 013's relocated switcher). 012 (raw config
view) is independent of the layer work and of 015/016, and sits here mainly to keep the two
independent layer-UX stories (011/013/014) grouped together before the larger dual-bind editor
work starts. 015 must land before 016: 016's modifier-capture flow plugs into the Primary/
Secondary capture slots 015 introduces and has "nowhere to plug into" without them (016's own
requirement text).
