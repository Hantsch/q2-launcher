---
id: 016
title: Auto-create an Alt/Ctrl/Shift layer when a modifier is held during key capture
status: done
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
- [x] A Weapon-dropping row's ammo choice and team-message text produce the identical rendered
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

## Decisions (Refine, AC 5 re-plan)

The first build attempt treated a layer override as a *source* of a row's state and tried to
re-derive row identity from the override's command text. That cannot work: two catalogue rows
legitimately produce the identical command - the weapon droppable `grenades` and the ammo
droppable `hgrenades` both render `drop grenades` (`action-catalog.ts`) - so no textual or
structural match can attribute an override to one row. The following decisions replace that
approach (option B, chosen by the user).

14. **The `ConfigAction` is the only place a row's state lives.** A modifier binding is stored on
    the action itself: `keyModifier` / `secondaryKeyModifier` next to `key` / `secondaryKey`,
    optional and additive exactly like story 015 added `secondaryKey` / `catalogId` - no
    `STATE_SCHEMA_VERSION` bump, no migration, a pre-016 action just omits them.
15. **A row's layer override is a derived mirror, never a source.** `setActions`
    (`main/modules/config/profiles.ts`) already rebuilds the `q2l_a_*` half of `binds` from
    `actions` and leaves every other bind alone; the same rule is extended to modifier layers'
    `overrides`. The renderer stops writing a row's override at all, which also retires
    decision 8's clobber risk - a capture slot no longer calls `updateProfileLayers`.
16. **The override value is the action's alias name** (`aliasNameFor(action)`), the same token a
    base bind carries - not the row's command text. Identity is then unique by construction
    (derived from `action.id`), so the collision that blocked AC 5 cannot arise. Side effects:
    a mirrored override is one short token, so `needsHelperAlias`, the `layer.quote` warning and
    the layer name budget's chunking reserve are never triggered by it, and the existing
    `resolveAliasChain` (`keyboard-layout.ts`) already expands it in the overview.
17. **A slot that carries a modifier is skipped by the base `binds` mirror.** That single rule is
    what keeps AC 4 true - the base bind for that key is never written or dropped.
18. **`setLayers` applies the same mirror**, so a stale Layers-panel save cannot drop a row's
    override.
19. **Layer find-or-create (AC 2, 3) happens inside the mirror step**, in main, against the
    authoritative `layers` array. `upsertModifierLayerOverride` keeps its existing matching rules
    (normalized `triggerKey`, name `Alt`/`Ctrl`/`Shift`, `mode: 'hold'`) - only its caller moves.
20. **Decision 12 is superseded.** The single command builder is `action.commands` ->
    `renderActionAlias`, which both paths now share literally. `buildRowCommandString`,
    `parseRowCommandState`, `findRowLayerOverride` and `findBindLocation` lose their last callers
    and are deleted with their tests rather than repaired.
21. **No migration for raw-text overrides** left behind by the blocked attempt (commit `29b4f4f`,
    never released): such a value does not start with `ACTION_ALIAS_PREFIX`, so the mirror treats
    it as a hand-made override and leaves it alone; the user can delete it in the Layers panel.

## Plan

Turn the modifier binding into a property of the action and the layer override into a generated
mirror of it - the same relationship `binds` already has to `actions`. Then AC 5 is not a feature
to implement but a consequence: base path and layer path bind the *same generated alias*.

1. **Type** - `ConfigAction` gains `keyModifier` / `secondaryKeyModifier` (`ModifierTrigger`,
   optional); both zod schemas (strict IPC + forgiving persisted) learn the fields.
2. **Mirror** - new pure `applyActionLayerMirror(layers, actions)` in
   `src/shared/config/modifier-layers.ts`: drop every override whose value starts with
   `ACTION_ALIAS_PREFIX`, then per action-slot-with-modifier find-or-create that modifier's layer
   and write `overrides[normalizeBindKey(key)] = aliasNameFor(action)`.
3. **Main** - `setActions` skips modifier slots when rebuilding the `binds` mirror and runs (2);
   `setLayers` runs (2) as well.
4. **Renderer** - a modifier capture becomes an ordinary `applySlot(..., modifier)` call persisted
   through the existing action save. Delete the reverse-parse machinery
   (`parseRowCommandState`, `findRowLayerOverride`, `buildRowCommandString`, `findBindLocation`)
   and the debounced direct-override write. Ammo/message go through `applyAmmo`/`applyMessage`
   with no branch on where the key lives - that is AC 5 in the diff.
5. **Collision** - `findModifierSlotCollision` reads the actions array instead of override text
   and can therefore name the occupying *action*; hand-made overrides keep the raw-text label.

D5 (mode select in the Layers panel, AC 7) is built and stays as is. D1/D2's capture resolution,
the bare-modifier-release fix and `AdvancedTab`'s save-status fix stay as is.
Order: D6 -> D7 -> D8 -> D9 -> D10. Guardrails unchanged (`/karpathy`, `/frontend-guidelines`,
`/design-tokens`, `/electron-arch`, `/typed-ipc`; i18n for every string, no image assets).

## Deliverables

D1-D5 of the first attempt stay in place except where a deliverable below names their files.
The remaining work is D6-D10.

**D6 - modifier location on the action (types + validation)**
Files: `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
`src/main/lib/schemas.ts`. Mirror: the `secondaryKey` / `catalogId` additions of story 015 in all
three files (doc comment included).
Acceptance: `ConfigAction` carries optional `keyModifier` / `secondaryKeyModifier` typed
`ModifierTrigger`; the strict IPC schema accepts only `ALT`/`CTRL`/`SHIFT` and rejects anything
else; the forgiving persisted schema accepts them and still keeps a pre-016 row that has neither;
both `tsc` projects clean. -> enabler for AC 1, 2, 4, 5

**D7 - the derived layer mirror (pure)**
Files: `src/shared/config/modifier-layers.ts`, `src/shared/config/modifier-layers.test.ts`.
Mirror: `setActions`'s existing `ACTION_ALIAS_PREFIX` filter for the `binds` mirror.
Acceptance: `applyActionLayerMirror(layers, actions)` drops every override whose value starts with
`ACTION_ALIAS_PREFIX` and rewrites one per modifier-carrying slot as `aliasNameFor(action)`;
hand-made overrides and non-modifier layers are returned untouched; Alt+R and Ctrl+R yield two
layers each owning their own `R`; a pre-existing hand-made layer with `triggerKey: 'ALT'` and any
name is reused and never duplicated; calling it twice is idempotent; an action that lost its
modifier leaves no stale override. **Regression test for the blocker:** the rows
`dropWeapon:grenades` and `dropAmmo:hgrenades` - whose command text is literally identical - are
mirrored as two distinct overrides and neither read nor write is attributed to the wrong row.
`findBindLocation` and its tests are deleted (no callers left). -> AC 2, 3, 5 (mirror half)

**D8 - main applies the mirror**
Files: `src/main/modules/config/profiles.ts` + its existing test file.
Acceptance: `setActions` skips a slot that carries a modifier when rebuilding the `q2l_a_*` binds
mirror, so the base bind for that key is neither written nor dropped, and applies D7's mirror to
`current.layers`; `setLayers` applies it to the incoming layers; hand-typed binds and non-mirrored
overrides survive both; a test asserts `renderProfileFile` produces the *identical* executed
command for one and the same action whether it is base-bound or modifier-bound, including the
ammo + `say_team` case (this replaces D2's textual render test). -> AC 2, 3, 4, 5

**D9 - one write path, one read path in the renderer**
Files: `src/renderer/src/modules/config/components/DualBindPanel.tsx`,
`.../components/DropBindPanel.tsx`, `.../components/BindSlot.tsx`,
`.../lib/catalog-binds.ts` (+ `catalog-binds.test.ts`).
Acceptance: `applySlot` takes the modifier and stores it on the action; a modifier capture
persists through the existing action save (`setActions`) and through nothing else - no
`updateProfileLayers` call from a slot, exactly one IPC round trip per capture; the layer and its
override exist afterwards; the slot label `Alt+R` comes from `action.keyModifier`; ammo and
message edits run through the unchanged `applyAmmo` / `applyMessage` with no branch on where the
key lives, and behave identically on a layer-only row; `parseRowCommandState`,
`findRowLayerOverride`, `buildRowCommandString` and the debounced direct-override write are gone,
with their tests. -> AC 1 (UI path), 4, 5

**D10 - collision warning reads the actions array**
Files: `src/renderer/src/modules/config/lib/bind-slot-collision.ts` (+ its test),
`.../components/BindSlot.tsx`, `src/renderer/src/i18n/locales/en.json`.
Acceptance: `findModifierSlotCollision` detects "this (modifier, key) already serves another
action" from the actions array and names that action; a hand-made override at the same location is
still reported, labelled with its raw command as today; re-capturing a row's own current location
is not a collision; confirming replaces via the actions array, declining leaves actions and layers
byte-identical. -> AC 6

## Model Hints

- D6 -> default
- D7 -> default
- D8 -> **deliverable-hard** - it edits the one function that rebuilds a persisted `binds` map and
  now also a persisted `layers` array wholesale; a wrong prefix filter silently deletes a user's
  hand-typed binds or hand-made overrides, and no test or build turns red for data that is simply
  gone.
- D9 -> **deliverable-hard** - this is the exact seam all three review cycles of the first attempt
  failed at; it must remove the old write path completely while keeping 015's plain-key path
  untouched, and a leftover second writer reintroduces the desync.
- D10 -> default
- Review: -> **story-review-hard** - the story rebuilds the persisted `layers` array from derived
  data, so a subtly wrong mirror loses user data invisibly, and AC 5 has already survived three
  review passes on the previous design.

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
   Then reopen the tab: the ammo checkbox and the message field still show what you typed (this is
   the case the previous attempt got wrong — a layer-only row read back its default instead of its
   real state).
7. Layers panel → the `Alt` layer: rename it, switch its mode to toggle, add and remove an override
   from the keyboard overview. All work exactly as on a hand-made layer.
8. In a slot capture, hold **Alt+Ctrl** and press **R**. Expect: a hint, no layer created, capture
   still active; releasing Ctrl and pressing R then works.
9. **Row-identity regression (the blocker):** in Weapon dropping, put the *weapons* group's
   **Hand grenades** on **Alt+G** and the *ammo* group's **Hand grenades** on **Alt+H** — two
   different rows whose label *and* rendered command (`drop grenades`) are literally identical.
   Expect: two separate overrides in the `Alt` layer, each row showing its own key, and editing one
   row's team message leaves the other row's message untouched.
10. Layers panel → add a hand-made override on `Alt`+`K` by hand, then change any row's ammo choice.
    Expect: the hand-made override is still there afterwards (the mirror only owns `q2l_a_*`
    values).

## Previous Attempt (S03 - blocked on AC 5)

_History of the first build attempt, kept for whoever implements D6–D10. Its AC 5 design was
replaced by the refine decisions 14–21 above; the code it describes is still in the tree
(commit `29b4f4f`) and D7/D9 name what gets deleted._

**Status then: BLOCKED (AC 5 unresolved after 3 review-fix cycles).**

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

## Done

### Summary

D6–D10 (the refine's re-plan, decisions 14–21) closed AC 5: a modifier binding is now stored on the
`ConfigAction` itself (`keyModifier`/`secondaryKeyModifier`), and a layer's `overrides` map became a
generated mirror of the actions array (`applyActionLayerMirror`, applied by `setActions`/`setLayers`
in main), so a modifier-bound row and a base-bound row share the exact same `ConfigAction` and the
exact same `commands` — the row-identity bug that blocked three prior review cycles (two catalogue
rows rendering the identical command, `dropWeapon:grenades`/`dropAmmo:hgrenades`) cannot arise
anymore, since identity is `action.id` via `aliasNameFor`, never command text. The renderer's entire
reverse-parse machinery (`buildRowCommandString`, `parseRowCommandState`, `findRowLayerOverride`,
`findBindLocation`, the debounced direct-layer write) was deleted outright rather than patched.

A first `story-review-hard` pass found one BLOCKING regression this redesign introduced into
story 015's own collision code: `bind-collision.ts`'s `findBindCollision` didn't yet know a slot
could carry a modifier, so a modifier-bound action's plain key falsely collided with (and, via
Replace, could destroy) an unrelated plain-key capture of the same literal key. Fixed
(`slotValue` now treats a modifier-carrying slot as invisible to the base-layer check, matching
what `setActions`'s bind mirror already does), along with four smaller findings: `releaseKey` now
clears an action's modifier field alongside its key (defense in depth), `findModifierSlotCollision`
no longer misses an occupying action in the narrow window before its layer object exists,
`upsertModifierLayerOverride`/`findModifierOverrideOwner` (dead code since D9/D10, and using a
different key-normalization convention than their replacement) were deleted with their tests, and
the collision banner's wording was corrected for showing an action name instead of raw command
text. A second `story-review-hard` pass confirmed all fixes correct and returned PASS.

### Commit message

```
016: auto-create Alt/Ctrl/Shift layer on modifier bind capture
```

### Verification

- `npx tsc -p tsconfig.node.json --noEmit` — clean.
- `npx tsc -p tsconfig.web.json --noEmit` — clean.
- `npm test -- --run` — 568/568 passing across 33 files.
- `npm run build` — succeeds (main/preload/renderer).
- Live UI smoke test (Playwright `_electron` against the built app, real keyboard events): drove
  test-plan steps 1, 2, 4, 6 and 9 (the AC 5 row-identity regression). All passed — slot badges read
  `ALT+R`/`CTRL+R`, the Layers panel showed the correct new layers, and the generated config file was
  inspected directly, confirming two distinct aliases for the two "Hand grenades" rows that render
  the identical `drop grenades` command.
- Code review: two `story-review-hard` passes (pass 1 FAIL with one blocking + four minor findings,
  all fixed; pass 2 PASS). Full history above under each finding.

### Known, deliberately unfixed (accepted, not required by any AC)

- Deleting an auto-created modifier layer via the Layers panel resurrects it on the next save if an
  action still carries that modifier (decision 18's explicit intent: a layer's overrides are a
  derived mirror, never a source) — a rename/mode change on that layer is lost when it does. Same
  behaviour for a hand-made layer whose overrides get re-mirrored; AC 7 itself (rename/mode/overrides
  editable) is unaffected.
- `applyActionLayerMirror`'s strip pass removes any `ACTION_ALIAS_PREFIX`-valued override from *any*
  layer, including a non-modifier one — defensible (a layer whose trigger changed away from a
  modifier must lose its stale mirror too) but wider than the mirror's own ownership; no reported
  path produces this today.
- `findBindCollision` (base-layer, story 015) ignores a single slot on self-recapture;
  `findModifierSlotCollision` (story 016) ignores the whole action — a row with both slots on the
  same `(modifier, key)` sees no warning. Harmless (both slots mirror the same alias) but the two
  checks are not symmetric.
- **Pre-existing, unrelated bug found during this story's live smoke test, out of scope for 016:**
  the Raw file tab (story 012) crashes when previewing a profile — `previewConfigProfile`/
  `writeConfigProfile` (`src/renderer/src/modules/config/client.ts`) don't flatten the double-
  `Outcome` wrap `MainModuleRegistry.invoke` applies, unlike `assignConfigProfile`/
  `unassignConfigProfile`, which already do. Worth its own story/fix.
