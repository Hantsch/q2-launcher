---
id: 016
title: Auto-create an Alt/Ctrl/Shift layer when a modifier is held during key capture
status: ready
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

_None — all detail decisions were taken during the sprint refine pass, see below._

## Decisions (Sprint)

1. **Exactly one modifier.** Two or more modifiers held (Alt+Ctrl+R) refuses the capture with an
   inline hint instead of guessing — Q2 has no nested layers, so there is no representation for it.
2. **A modifier keydown alone keeps the capture open** (state `pending`, no refusal) — users press
   Alt before the actual key, so the first keydown is always the modifier.
3. **If the resolved key is itself ALT/CTRL/SHIFT, the capture is refused** — that would remap the
   layer's own trigger, which `alt-layers.ts` already reports as the error `layer.selfbind`.
4. **Auto-created layers are named with the literal English token `Alt` / `Ctrl` / `Shift`**, not an
   i18n string — layer names are persisted, user-renameable profile data, not UI chrome.
5. **An existing layer is matched by its normalized `triggerKey` only, never by name**, so a
   hand-made layer whose trigger is `ALT` is reused (AC 3) even if it is called "Rocketjump".
6. **New layers get `mode: 'hold'` and no "auto-created" marker field** — after creation they are
   byte-for-byte an ordinary `AltLayer`, which is what AC 7 demands.
7. **`resolveQuakeKeyName` keeps its `Pick<KeyboardEvent, 'code'>` signature**; modifier awareness
   goes into a new pure helper — widening it would touch the three unrelated capture sites
   (`SwitchBindControl`, `ActionEditor`, overview test mode) for no gain.
8. **Layer upsert and override write happen in a single `updateProfileLayers` call** — `setLayers`
   replaces the whole array, so two round trips could clobber layers created in between.
9. **The slot shows a composite label (`Alt+R`) derived by reverse lookup over base binds plus each
   layer's overrides; nothing new is persisted** — AC 1 explicitly forbids storing a combined key.
10. **The overwrite warning reuses 015's collision surface**; if 015 ships an inline banner, this
    story adds a `modifier layer` case to it rather than inventing a second pattern (AC 6 says
    "the same way"). Fallback if 015's surface turns out non-reusable: the inline-banner +
    disabled-primary pattern of `components/KeyBindDialog.tsx`.
11. **A mode select is added to the Layers panel** — AC 7 requires the mode to be changeable, and
    today *no* layer (hand-made or not) can change its mode; parity alone would not satisfy the AC.
12. **The override stores the exact command string 015's row builder produces** (one builder, one
    call site, base path and layer path share it) — that is what makes AC 5 true by construction
    instead of by a second implementation.
13. **All logic lives in pure `.ts` helpers, UI stays thin** — `vitest.config.ts` matches only
    `src/**/*.test.ts` (node env, no jsdom), so `.tsx` cannot be tested in this repo.

## Plan

Capture becomes modifier-aware, and a held modifier is translated into an alt-layer override
instead of a base bind. Two pure helpers carry the logic; the UI work is wiring.

1. **Resolve** — new `src/renderer/src/modules/config/lib/modifier-capture.ts`:
   `resolveModifierCapture(event)` → `{kind:'plain',key}` | `{kind:'modifier',key,modifier}` |
   `{kind:'pending'}` | `{kind:'refused',reason:'multipleModifiers'|'modifierOnly'}` | `null`.
   Uses `resolveQuakeKeyName` internally (unchanged) plus `altKey/ctrlKey/shiftKey`.
2. **Upsert** — new `src/shared/config/modifier-layers.ts`: pure
   `upsertModifierLayerOverride(layers, {modifier, key, command, newId})` →
   `{layers, layerId, created, previousCommand}`. Finds a layer by
   `normalizeBindKey(triggerKey) === modifier`, else appends
   `{id, name: 'Alt'|'Ctrl'|'Shift', mode:'hold', triggerKey: modifier, overrides:{}}`; writes only
   `overrides[key]`, never `binds`.
3. **Locate** — new `findBindLocation(profile, command)` (same shared file): reverse lookup over
   `profile.binds` then every `layer.overrides`, returning `{key, modifier|null}` so a slot can
   render `Alt+R`.
4. **Wire** — 015's Primary/Secondary slot component: on a `modifier` capture, call (2) and persist
   via one `updateProfileLayers`; on `plain`, keep 015's existing base-bind path; on `refused`,
   show the hint and stay in capture.
5. **Warn** — when `previousCommand` is non-empty and belongs to another action, route it through
   015's collision surface before writing (decision 10).
6. **Panel** — `LayersPanel.tsx`: add a mode select next to rename (AC 7), mirroring `handleRename`.
7. **i18n** — new keys under `config.advanced.dualBind.*` (modifier hints) and
   `config.layersPanel.mode.*` reuse; no prose crosses IPC.

Order: D1/D2 in parallel (pure, testable) → D3 (wiring, needs 015 merged) → D4 → D5.
Guardrails: `/frontend-guidelines` + `/design-tokens` (semantic tones only, no hex, no raw palette
class, ≥44px hit targets on the slot buttons), no image assets, all strings via i18n.

## Deliverables

**D1 — modifier-aware capture resolution (pure)**
Files: `src/renderer/src/modules/config/lib/modifier-capture.ts` (new),
`…/lib/modifier-capture.test.ts` (new). Mirror: `…/lib/keyboard-layout.ts` (`resolveQuakeKeyName`)
for style, `…/lib/validation-scope.test.ts` for the test shape.
Acceptance: `R` alone → `{kind:'plain',key:'R'}`; Alt+R → `{kind:'modifier',key:'R',modifier:'ALT'}`
(never a combined string); Alt alone → `pending`; Alt+Ctrl+R → `refused/multipleModifiers`;
Alt+Shift (modifier as the pressed key) → `refused/modifierOnly`; unmapped code → `null`.
`resolveQuakeKeyName`'s signature is unchanged. → AC 1

**D2 — layer upsert + bind location (pure)**
Files: `src/shared/config/modifier-layers.ts` (new), `src/shared/config/modifier-layers.test.ts`
(new). Mirror: `src/shared/config/alt-layers.ts` (doc-comment style, `normalizeBindKey` use) and
`alt-layers.test.ts`.
Acceptance: with no ALT layer present, one is created (`mode:'hold'`, `triggerKey:'ALT'`, name
`Alt`) and the override written; called again for Alt+F it reuses that same layer (array length
unchanged); a pre-existing hand-made layer with `triggerKey:'ALT'` (any name) is reused; Ctrl+R and
Alt+R end up in two different layers each owning their own `R`; `profile.binds` and all other
layers/overrides are returned untouched; `previousCommand` reports an override that would be
replaced; the passed-in `command` string is stored verbatim (only `sanitizeCommand`, no
re-derivation). Includes a test that the same command string used as a base bind and as a layer
override renders the identical executed command text via `generateLayerAliases`/`render.ts`
(covers the say_team + drop case, incl. the existing `layer.quote` warning when quotes are
present). → AC 2, 3, 4, 5 (rendering half)

**D3 — wire capture slots to the modifier path**
Files: 015's Primary/Secondary slot + row components under
`src/renderer/src/modules/config/` (≤3 files), `src/renderer/src/i18n/locales/en.json`.
Mirror: `…/SwitchBindControl.tsx` (capture listener shape, `event.preventDefault()`,
skip `event.repeat`), `…/components/ActionEditor.tsx` (`stopPropagation` so Escape does not close
the surrounding modal).
Acceptance: holding Alt/Ctrl/Shift during a slot capture writes an override in the matching layer
through exactly one `updateProfileLayers` call and leaves the base bind for that key alone; the
slot then displays `Alt+R` (via D2's `findBindLocation`); a plain capture still takes 015's
unchanged base-bind path; a Weapon-dropping row uses the *same* command builder for both paths
(single call site — verifiable in the diff); a refused capture shows an i18n hint and stays in
capture. → AC 1 (UI path), 2, 4, 5

**D4 — overwrite warning for modifier captures**
Files: 015's collision-warning component/helper + the slot from D3 (≤3 files),
`src/renderer/src/i18n/locales/en.json`.
Acceptance: capturing Alt+R when that layer's `R` override already serves another action surfaces
the same warning surface a plain-key collision uses, naming the layer and the occupying action, and
requires an explicit confirm before the override is replaced; declining leaves layers unchanged. → AC 6

**D5 — layer mode is changeable in the Layers panel**
Files: `src/renderer/src/modules/config/LayersPanel.tsx`,
`src/renderer/src/i18n/locales/en.json`.
Mirror: `handleRename` / `RenameLayerDialog` in the same file for the persist shape.
Acceptance: an auto-created `Alt` layer appears in the Layers panel like any other, and its mode can
be switched hold↔toggle there and persists; rename, delete and override add/remove already work on
it unchanged; nothing in the panel distinguishes auto-created from hand-made layers. → AC 7

## Model Hints

- D1 → default
- D2 → default
- D3 → **deliverable-hard** — it is the only cross-layer step: it plugs into 015's freshly built
  slot components and replaces the whole `layers` array in one persist call, where a wrong merge
  silently destroys the user's existing layers and overrides.
- D4 → default
- D5 → default
- Review: → **story-review-hard** — the story writes to the persisted `layers` array of a real user
  profile via replace-whole-array semantics, so a subtly wrong upsert loses data without any test
  or build turning red.

## Test Plan (manual acceptance)

Run `npm run dev`, open Config, pick a profile with at least one existing layer and some base binds.

1. Advanced tab → Weapon dropping → Rocket Launcher row → click the **Primary** slot, hold **Alt**
   and press **R**. Expect: slot shows `Alt+R`; Layers panel now lists a layer `Alt`
   (hold, trigger `ALT`).
2. Weapons → Rocket ammo row → **Primary** slot, hold **Ctrl**, press **R**. Expect: a second layer
   `Ctrl` appears, `Alt` is not touched, both own their own `R`.
3. Movement → Forward → **Secondary** slot, hold **Alt**, press **F**. Expect: no third layer — the
   override lands in the existing `Alt` layer.
4. Overview tab: the base bind that `R` had before step 1 is still there.
5. Repeat step 1 on a *different* drop row with Alt+R. Expect: a warning naming the `Alt` layer and
   the occupying action, with an explicit confirm; cancel → nothing changes.
6. Set the rocket-launcher row to "with ammo" and type a team message, then compare the raw config
   view (story 012) against the same row moved to the base layer — the executed commands match.
7. Layers panel → the `Alt` layer: rename it, switch its mode to toggle, add and remove an override
   from the keyboard overview. All work exactly as on a hand-made layer.
8. In a slot capture, hold **Alt+Ctrl** and press **R**. Expect: a hint, no layer created, capture
   still active; releasing Ctrl and pressing R then works.

## Done
