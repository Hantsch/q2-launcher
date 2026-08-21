---
id: 034
title: Controls and the keyboard overview share one source of truth
status: done # draft -> ready -> in-progress -> done
created: 2026-08-21
---

## Requirement

The Controls tab shows actions as empty although the keyboard overview shows the very same keys as
bound. Reported cases (Config → profile "Hantsch - Test"):

- Overview shows `W`/`A`/`S`/`D`/`C`/`SPACE`/`MOUSE1`/`MOUSE2` bound to the movement commands,
  while Controls → Movement reads "14 rows · 0 bound".
- `Alt+Q` drops a weapon (visible in the Alt layer on the board) but Controls → Weapon dropping
  shows every row empty.

There must be no discrepancy between the keyboard overview and Controls — it is all one thing: the
same profile, the same keys, one answer.

## Acceptance Criteria

- [x] A bind made on the Overview keyboard shows up on its Controls row (and vice versa), without
      a restart or a profile switch.
- [x] An override in a modifier layer (ALT/CTRL/SHIFT) shows up on its Controls row as a
      modifier-carrying slot (`Alt+Q`).
- [x] An existing `state.json` (and an imported `config.cfg`) is reconciled on read, so the
      discrepancy is gone on first render, before the user touches anything.
- [x] Adoption never changes what a key does: the rendered config keeps running the same commands,
      and a continuous (`+`) movement bind keeps working in-engine.
- [x] Commands no catalogue row renders (`kill`, `+use`, chained macros) keep working as raw binds.

## Open Questions

Root cause (code review + a dry run of the real `%APPDATA%/Q2 Launcher/state.json`): the profile
had **two disjoint editing surfaces over two disjoint storages**. `OverviewKeyboardPanel` /
`KeyBindDialog` / `LayersPanel` write command text into `profile.binds` and `layers[].overrides`;
`ControlsTab` reads only `profile.actions` (catalogue rows keyed by `catalogId`). The mirror only
ran one way — `setActions` derived `binds`/`overrides` from `actions` — and nothing ever went back.
So every hand-made or imported bind was invisible to Controls, by construction.

## Plan

Make `actions` the single authority and reconcile raw binds into it on every read and every write.

## Deliverables

- [x] **D1 — the row model moves to `shared`.** `src/shared/config/catalog-rows.ts`: `CatalogRow`,
      `CatalogRowKind`, the three builders, `commandsForRow`, plus `allCatalogRows()` (its order is
      the tie-break rule for ambiguous command text). The renderer's
      `modules/config/lib/catalog-binds.ts` imports and re-exports them, so no other renderer file
      changed. Reason: main has to mint the *identical* `catalogId` for a bind it recognises.
- [x] **D2 — one function owns the mirror value.** `src/shared/config/action-mirror.ts`:
      `bindValueFor(action)`, `isMirroredValue`, and `applyActionBindMirror` (moved out of
      `setActions`, unchanged in rule, extended with a value-based strip). Every writer *and* every
      reader of a mirrored value now routes through it: `modifier-layers.ts`, `bind-collision.ts`,
      `bind-conflicts.ts`, `bind-slot-collision.ts`, `profiles.ts`.
- [x] **D3 — adoption.** `src/shared/config/bind-adoption.ts`: `adoptRawBinds({binds, layers,
      actions}, newId)` resolves a raw entry's command text to a catalogue row, finds or creates
      that row's action, claims Primary then Secondary, and rewrites the entry to `bindValueFor`.
      Modifier layers (ALT/CTRL/SHIFT) adopt as `keyModifier` slots.
- [x] **D4 — run it on both paths.** `ProfilesStore.commit` (every write, incl. create/import) and
      `normalizeConfigProfile` (`main/lib/schemas.ts`, every read).
- [x] **D5 — the renderer draft stops freezing `actions`.** `useProfileDraft` tracks which
      locally-patched fields actually have an edit in flight instead of always preferring the
      draft's `cvars`/`categories`/`actions`; otherwise a bind saved from the Overview would not
      reach the Controls tab until a remount.
- [x] **D6 — tests.** New: `bind-adoption.test.ts` (17), `action-mirror.test.ts` (8), four
      store-level round trips in `profiles.test.ts`, one merge case in `useProfileDraft.test.ts`.

## Decisions

1. **`actions` is the authority, `binds`/`overrides` are its mirror.** Adoption re-encodes, it
   never re-binds: an entry is adopted only when the row it resolves to renders exactly the
   commands that entry already runs. A row that is full (both slots taken) or whose action's
   commands differ leaves the entry raw.
2. **A continuous catalogue row is bound directly, not through its alias.** The engine only sends
   `-command` on key-up when the bind string itself starts with `+` (`keys.c`:
   `if (kb && kb[0] == '+')`), so `bind w q2l_a_forward_1234` would press `+forward` and never
   release it. `bindValueFor` therefore returns the raw command for a `catalogId` row whose whole
   body is one `+command`, and the alias for everything else. This also fixes a latent pre-existing
   bug: movement rows bound in the Controls grid produced exactly that stuck-key form.
3. **The strip pass is value-based *and* key-scoped.** A direct `+forward` mirror is
   indistinguishable from a hand-typed one by value alone, so both mirrors strip "the value the
   previous action held on the key it held". Consequence and accepted trade-off: a `setActions`
   payload assembled from a stale actions array can drop that action's bind (the window is one
   debounce, and D5 narrows it) — the alternative, a prefix-only strip, would make "clear a slot"
   silently not clear, permanently.
4. **Ambiguous command text resolves by catalogue order.** `drop grenades` is both
   `dropWeapon:grenades` and `dropAmmo:hgrenades`; `allCatalogRows()`'s order decides (weapon
   first), deterministically.
5. **Two keys on one command become one row with two slots** (sorted key order, so which one is
   Primary is deterministic); a third key on the same command stays raw.
6. **Out of scope, by data model.** A non-modifier layer's overrides (e.g. the "test" layer
   triggered by `-`) cannot be represented in `actions` — `ConfigAction` only knows
   ALT/CTRL/SHIFT — and a command no catalogue row renders has no Controls category to live in.
   Both stay raw binds, visible on the Overview board only.

## Done

Verified against the reported profile by running `adoptRawBinds` over the real
`%APPDATA%/Q2 Launcher/state.json`: 9 entries adopted — `movement:forward`(w), `back`(s),
`moveleft`(a), `moveright`(d), `movedown`(c), `attack`(MOUSE1), `moveup`(MOUSE2 + SPACE as its
secondary slot), `weaponUse:use_sshotgun`(q), and `dropWeapon:shotgun` on `q+ALT` with ammo on —
i.e. exactly the rows that read "empty" before, including the reported `Alt+Q` case (which is
`drop shotgun; drop shells`, not super shotgun). Base binds keep their text; the Alt override
becomes that action's alias; the `test` layer's `+use` override is untouched.

`npm run typecheck` clean, 727/727 unit tests pass (30 new).
