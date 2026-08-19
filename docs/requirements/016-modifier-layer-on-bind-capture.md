---
id: 016
title: Auto-create an Alt/Ctrl/Shift layer when a modifier is held during key capture
status: in-progress
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

- [x] Capturing a key while exactly one of Alt/Ctrl/Shift is held resolves to that plain key plus
      the held modifier, not to a literal combined key string (Quake 2 cannot bind "ALT+R" as one
      key, per `alt-layers.ts`).
- [x] If no layer exists yet whose trigger is that modifier, one is created automatically (hold
      mode, trigger key `ALT`/`CTRL`/`SHIFT`), named recognizably after its modifier.
- [x] If a layer with that modifier as its trigger already exists — auto-created earlier in this
      flow, or hand-made in the Layers panel — the new assignment is added to that same layer's
      overrides; a second layer is never created for the same modifier.
- [x] The assignment lands as an override on the resolved key inside that layer; the base layer's
      existing bind for that key (if any) is untouched.
- [ ] A Weapon-dropping row's ammo choice and team-message text produce the identical rendered
      command(s) whether the row's key ends up on the base layer or inside an auto-created
      modifier layer.
- [x] Capturing a modifier+key combination that already has an override in that layer (used by a
      different action) warns before overwriting, the same way a plain-key collision is already
      surfaced elsewhere in the keybinding editor.
- [x] An auto-created modifier layer is a completely ordinary layer afterwards — visible and
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

**Status: BLOCKED (AC 5 unresolved after 3 review-fix cycles) — story left `in-progress`.**

### Summary

D1 (`modifier-capture.ts`), D2 (`modifier-layers.ts`) and D3 (capture-slot wiring across
`BindSlot.tsx`/`DualBindPanel.tsx`/`DropBindPanel.tsx`/`AdvancedTab.tsx`/`catalog-binds.ts`) were
inherited from an earlier partial build attempt. This session verified D1–D3 line by line against
all 13 sprint decisions and the D1–D3 acceptance text before building anything further — no bugs
found, no changes needed. D4 (overwrite warning for modifier captures) and D5 (mode select in the
Layers panel) were then implemented fresh. Three `story-review-hard` passes followed (the maximum
this project's build procedure allows); AC 1, 2, 3, 4, 6 and 7 passed cleanly across all three.
AC 5 (a Weapon-dropping row renders the identical command whether base-bound or modifier-bound) was
never fully closed — two fix attempts each closed the previously-found gap but exposed a new one,
and the third attempt's remaining gap (a row-identity collision, below) was found after this
session's fix-cycle budget was spent. Per the QA rule ("never weaken tests to go green"), no test
was loosened to make this pass, and the code is left in its last reviewed (still-imperfect) state
rather than shipped as if AC 5 were satisfied.

### Decisions taken beyond the sprint's own

- **D4 does not add a `modifierLayer` case to `BindCollision`** (`src/shared/config/bind-collision.ts`),
  even though decision 10 suggested "adds a case to it". `findBindCollision`, `releaseKey` and
  `ownerLabel` all switch exhaustively on `BindCollision['kind']`, and a modifier-layer collision has
  no base-bind angle and nothing to release — forcing those three unrelated call sites to grow a
  branch they could never take would violate the file's own purpose. Instead, a new, parallel
  function `findModifierSlotCollision` was added to `bind-slot-collision.ts` (015's own
  `findSlotCollision`/`SlotCollision`/`applyReplace` home), and `BindSlot.tsx` renders it with the
  exact same banner markup and Cancel/"Replace" button pair the existing `pending` state already
  uses — satisfying AC 6's "the same way" without widening an unrelated discriminated union.
  Reviewed and accepted as correct in pass 1.
- **D5** replaces the Layers panel's read-only mode `Badge` with an inline `Select` next to the
  layer's name (rather than a separate dialog), persisting immediately through the panel's existing
  `persist()`/`updateProfileLayers` call — mirroring `handleRename`'s persist shape as the
  deliverable asked, just without a modal since a single-field mode toggle doesn't need one.
- **Review-fix, bare-modifier regression** (found in pass 1): `classifyModifierCapture`'s `pending`
  result now carries `{modifier}` (was bare), and a new pure `resolveModifierRelease` helper plus an
  optional `onKeyUp` parameter on `useKeyCapture` let `BindSlot` tell "holding a modifier before the
  real key" apart from "pressed and released a bare modifier with nothing else happening" — restoring
  the pre-story ability to bind a bare modifier as an ordinary key (e.g. `bind SHIFT +speed`, a real
  stock Quake II bind that story 015's original capture supported and D1's keydown-only decision
  table had silently made impossible). Confirmed sound in passes 2 and 3.
- **Review-fix, silent save failures** (found in pass 1): `AdvancedTab.persistLayers` now drives the
  same `saving`/`status` state its sibling `persistCategoriesAndActions` already does, so a failed
  `updateProfileLayers` call is no longer invisible to the user.
- **AC 5 fix attempts (both superseded, documented for whoever continues this):**
  1. First attempt: `renameModifierOverrideCommand`, a value-based "find whatever override still
     holds the row's old command string and rewrite it". Pass 2 found two problems this caused: a
     layer-only-bound row (no `ConfigAction`) had no way to *read back* its real current ammo/message
     state (`deriveRowState(undefined, row)` only ever reports its "unbound" default), and the
     value-diff raced its own debounced IPC round trip on the message field, silently getting stuck
     mid-word once the comparison stopped matching a `draft.layers` that hadn't caught up yet. This
     function and its tests were deleted entirely rather than patched further.
  2. Second attempt: identity-based reads and writes. New pure functions `parseRowCommandState` and
     `findRowLayerOverride` (`catalog-binds.ts`) let a layer-only row read its actual stored
     ammo/message state via a structural reverse-parse of the override's command text, and
     `DropCatalogRow` writes directly to the known `(modifier, key)` location
     (`upsertModifierLayerOverride`) instead of searching by value, with the message field debounced
     the same way `AdvancedTab`'s action save already is. This closed pass 2's two bugs, but pass 3
     found the structural match itself is not safe: two Weapon-dropping rows whose command text
     overlaps or prefix-collides can cause `findRowLayerOverride` to attribute an override to the
     wrong row, and flagged remaining staleness/decision-8-adjacent concerns in the debounced write.
     **This is the current, unresolved state** — see Blocker below.

### Verification

- `npx tsc -p tsconfig.web.json --noEmit` — clean.
- `npx tsc -p tsconfig.node.json --noEmit` — clean.
- `npm test -- --run` — 571/571 passing across 34 files (authoritative run via PowerShell; the Bash
  tool intermittently threw a uniform `Cannot read properties of undefined (reading 'config')`
  across every file in this environment, matching this sprint's known, unrelated environment quirk —
  confirmed clean on retry).
- `npm run build` — succeeds (main/preload/renderer all build).
- Live UI smoke test: not performed (no Playwright/`_electron` harness available in this
  environment; not the blocker for this story — see Blocker below, which is a real correctness gap
  found by code review, not a missing manual check).

### Review history (`story-review-hard`, max 3 cycles per the build procedure)

- **Pass 1 — FAIL.** D1–D3 (inherited) confirmed correct against all 13 decisions, no bugs. Found:
  AC 5 broken for a layer-only-bound row's ammo/message edits (silent no-op or desync), and the
  bare-modifier-key regression above. Fixed both, plus the should-fix `persistLayers` status gap.
  Also flagged as informational (not required to fix): the `findModifierSlotCollision`-vs-union
  deviation (see above, judged correct), `findBindLocation`'s base-before-layer precedence
  potentially suppressing an `Alt+key` label (superseded by the AC 5 redesign, which stopped using
  `findBindLocation` for that lookup entirely), the non-blocking "auto-created CTRL/SHIFT layer
  shadows a stock bind with no visible warning" gap (no AC covers it, not addressed), and D2's
  identical-render test not literally asserting the `layer.quote` warning by name (the generator
  never raises it for that path, accepted as intentional).
- **Pass 2 — FAIL, AC 5 only.** AC 1, 2, 3, 4, 6, 7 confirmed PASS; the bare-modifier-regression fix
  confirmed sound (state machine walked through for hold/press, hold/chord and refusal cases; no
  stray keyup misfires). Found the two problems in the first AC 5 fix attempt described above.
- **Pass 3 (final) — FAIL, AC 5 only.** AC 1, 2, 3, 4, 6, 7 re-confirmed PASS, undisturbed by the AC 5
  redesign. Found the row-identity collision in the second AC 5 fix attempt (two rows with
  overlapping/prefix-colliding command text can be matched to the wrong row by
  `findRowLayerOverride`'s structural/textual match) plus remaining staleness/decision-8-adjacent
  concerns in the debounced write. Review-fix cycles are now exhausted per the build procedure ("max
  3 cycles, then stop and ask the user").

### Blocker

AC 5 is not satisfied for Weapon-dropping rows whose binding lives entirely inside a modifier layer
(no base `ConfigAction`) when two catalog rows' command text can structurally collide. The root
cause both AC 5 fix attempts share: a layer override is stored as a bare `command: string`
(`AltLayer.overrides: Record<string, string>`) with nothing identifying *which row* wrote it, so any
read-back or write-back has to re-derive row identity from the command text itself — which is not
guaranteed unique across the catalog. Closing this properly likely needs a plan-level decision this
build session cannot make unilaterally: whether the override value's *shape* should change to carry
an explicit row/catalog identity (a schema change touching `AltLayer`, `generateLayerAliases`, and
every existing override in a saved profile), or whether some other invariant (e.g. a stricter
uniqueness guarantee across `action-catalog.ts`'s row commands, if one can be established) makes the
textual match safe without a schema change. Recommend routing this back through `/refine` before a
fourth implementation attempt.

### Commit message (draft, for whenever this is completed and committed)

```
016: modifier-layer auto-creation on bind capture (D1–D5 built; AC5 unresolved, story left in-progress)
```
