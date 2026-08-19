/**
 * The actions -> modifier-layer-overrides mirror (story 016).
 *
 * Quake 2 has no modifiers (see `alt-layers.ts`'s file doc comment): a capture
 * of "Alt+R" cannot be stored as a literal bind, only as an override inside an
 * alt layer whose `triggerKey` is `ALT`. `applyActionLayerMirror` rebuilds
 * every layer's `overrides` map from scratch as a **derived mirror** of
 * `actions`' `keyModifier`/`secondaryKeyModifier` slots, the exact layer-side
 * counterpart of `setActions`'s `binds` mirror in
 * `src/main/modules/config/profiles.ts`. This is the only writer of a
 * modifier override on the normal save path.
 *
 * A modifier binding is keyed off a `ConfigAction`'s own identity
 * (`aliasNameFor(action)`), never off the command text it happens to render -
 * that was an earlier design's bug (two actions can render the identical
 * command, e.g. `dropWeapon:grenades`/`dropAmmo:hgrenades` both rendering
 * `drop grenades`) and this module's whole reason to exist is to make that
 * class of bug impossible. Story 016 D9 removed the last pieces that used to
 * read *back* by command string (`upsertModifierLayerOverride`,
 * `findModifierOverrideOwner`, `findBindLocation`, plus `catalog-binds.ts`'s
 * reverse-parse helpers) once this mirror made them dead code - a command
 * string is not an identifier.
 *
 * A layer is matched by its normalized `triggerKey`, **never by `name`**: a
 * user can hand-build a layer named "Rocketjump" whose trigger happens to be
 * ALT (e.g. by wiring it up in the layer editor before this story existed),
 * and that layer is exactly as much "the ALT layer" as one this module
 * created itself. Matching by name would silently create a second, competing
 * ALT layer the moment a hand-made one used a different label - two layers
 * racing to bind the same trigger key is precisely the bug `assignLayerTrigger`
 * (`alt-layers.ts`) exists to prevent on the trigger side; this module
 * prevents its upsert-time equivalent on the override side.
 *
 * Pure by contract, like `alt-layers.ts` and `bind-collision.ts`: this file
 * lives in `src/shared`, so no `node:*`, no DOM, no electron.
 */

import type { AltLayer, AltLayerMode } from '@shared/config/alt-layers'
import { ACTION_ALIAS_PREFIX, aliasNameFor } from '@shared/config/alias-render'
import { normalizeBindKey } from '@shared/config/key-names'
import type { ConfigAction } from '@shared/modules/config'

export type ModifierTrigger = 'ALT' | 'CTRL' | 'SHIFT'

/** The literal English layer name a freshly created layer gets, keyed by modifier. Exported for
 * `bind-slot-collision.ts`'s `findModifierSlotCollision`, which needs the same name a fresh layer
 * would get to label a collision against an action that occupies `(modifier, key)` before that
 * modifier's layer has actually been created yet (i.e. before the next `setActions`/`setLayers`
 * mirror pass has run) - the layer name is otherwise only known once the layer object exists. */
export const MODIFIER_LAYER_NAME: Record<ModifierTrigger, string> = {
  ALT: 'Alt',
  CTRL: 'Ctrl',
  SHIFT: 'Shift',
}

/** Every modifier layer created by this module holds while its trigger is down. */
const MODIFIER_LAYER_MODE: AltLayerMode = 'hold'

/**
 * A single key+modifier slot an action may carry - `{ key: action.key,
 * modifier: action.keyModifier }` or the secondary equivalent. Local to
 * `applyActionLayerMirror`; not worth exporting on its own.
 */
interface ActionModifierSlot {
  key: string | undefined
  modifier: ModifierTrigger | undefined
}

/**
 * Derive, for every alt/ctrl/shift layer, the `overrides` mirror of `actions`'
 * modifier slots - the layer-side equivalent of `setActions`'s `binds` mirror
 * in `src/main/modules/config/profiles.ts` (decision 17 there; this is its
 * D7 counterpart for story 016's re-plan, decisions 14-21).
 *
 * A modifier binding is a property of the `ConfigAction` itself
 * (`keyModifier`/`secondaryKeyModifier`), never derived from command text -
 * that was the bug this redesign replaces: two distinct actions can render
 * the identical command string (e.g. `dropWeapon:grenades` and
 * `dropAmmo:hgrenades` both rendering `drop grenades`), so a lookup keyed by
 * command text cannot tell them apart, while `aliasNameFor(action)` always
 * can, since it is keyed by the action's own `id`.
 *
 * Two passes, exactly mirroring `setActions`:
 *
 * 1. Strip. Every override whose *value* starts with `ACTION_ALIAS_PREFIX` is
 *    dropped from every layer, regardless of that layer's `triggerKey` - such
 *    a value can only have been written by a previous call to this function,
 *    so this is "forget everything this function ever wrote" before
 *    rewriting it from scratch. A hand-made override (any other value) is
 *    left alone; a layer with nothing to strip is returned as the same object
 *    reference, so an untouched layer stays untouched by identity too, not
 *    just by value.
 * 2. Rewrite. For every action, in array order (later wins on a key
 *    collision, the same determinism rule as `setActions`), each of its two
 *    slots (`key`+`keyModifier`, `secondaryKey`+`secondaryKeyModifier`) that
 *    carries **both** a key and a modifier gets one
 *    `overrides[normalizeBindKey(key)] = aliasNameFor(action)` written into
 *    the layer for that modifier - found by normalized `triggerKey`, never by
 *    name, so a hand-built layer (e.g. one named "Rocketjump" whose trigger
 *    happens to be ALT) is reused rather than shadowed by a second, competing
 *    ALT layer. A slot with a key but no modifier is a normal base bind -
 *    `setActions`'s job, out of scope here.
 *
 * Because the strip pass is unconditional and total (every layer, regardless
 * of whether anything will be rewritten into it afterwards), an action that
 * lost its modifier - or was removed from `actions` altogether - leaves no
 * stale override anywhere: nothing conditions the strip on "this layer is
 * about to receive a new write".
 *
 * `newId` mints a fresh layer id, called once per newly created layer (a
 * single call can create more than one, e.g. the first time both an ALT and
 * a CTRL slot appear together) - a factory rather than a single pre-supplied
 * id, since one call may need more than one, or `crypto.randomUUID()` called
 * internally - no file under `src/shared` calls that directly today, and this
 * module stays free of that dependency.
 *
 * Never mutates `layers` or any layer object in place; returns a new array.
 * Pure and idempotent - calling it twice with the same `layers`/`actions`
 * produces the same result both times.
 */
export function applyActionLayerMirror(
  layers: AltLayer[],
  actions: ConfigAction[],
  newId: () => string,
): AltLayer[] {
  // --- pass 1: strip every previously-mirrored override -------------------
  let result = layers.map((existingLayer) => {
    const hasMirroredEntry = Object.values(existingLayer.overrides).some((command) =>
      command.startsWith(ACTION_ALIAS_PREFIX),
    )
    if (!hasMirroredEntry) return existingLayer

    const overrides: Record<string, string> = {}
    for (const [key, command] of Object.entries(existingLayer.overrides)) {
      if (!command.startsWith(ACTION_ALIAS_PREFIX)) overrides[key] = command
    }
    return { ...existingLayer, overrides }
  })

  // --- pass 2: rewrite one override per modifier-carrying slot -------------
  for (const action of actions) {
    const slots: ActionModifierSlot[] = [
      { key: action.key, modifier: action.keyModifier },
      { key: action.secondaryKey, modifier: action.secondaryKeyModifier },
    ]

    for (const slot of slots) {
      const key = slot.key?.trim()
      const modifier = slot.modifier
      if (!key || !modifier) continue

      const normalizedKey = normalizeBindKey(key)
      const alias = aliasNameFor(action)

      const existingIndex = result.findIndex(
        (candidate) => normalizeBindKey(candidate.triggerKey ?? '') === modifier,
      )

      if (existingIndex === -1) {
        const created: AltLayer = {
          id: newId(),
          name: MODIFIER_LAYER_NAME[modifier],
          mode: MODIFIER_LAYER_MODE,
          triggerKey: modifier,
          overrides: { [normalizedKey]: alias },
        }
        result = [...result, created]
        continue
      }

      const existing = result[existingIndex]!
      const updated: AltLayer = {
        ...existing,
        overrides: { ...existing.overrides, [normalizedKey]: alias },
      }
      result = result.map((candidate, index) => (index === existingIndex ? updated : candidate))
    }
  }

  return result
}

