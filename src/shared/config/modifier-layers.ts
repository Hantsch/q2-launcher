/**
 * Modifier-layer upsert + reverse bind lookup (story 016).
 *
 * Quake 2 has no modifiers (see `alt-layers.ts`'s file doc comment): a capture
 * of "Alt+R" cannot be stored as a literal bind, only as an override inside an
 * alt layer whose `triggerKey` is `ALT`. This module is the pure glue between
 * "the user captured a modifier chord" and "there is now an `AltLayer` with
 * that override" - it never decides *whether* to write one (that is D1's
 * capture-resolution logic, `modifier-capture.ts`), only *where*.
 *
 * Two operations:
 *
 * - `upsertModifierLayerOverride` finds-or-creates the one layer per modifier
 *   (`ALT`/`CTRL`/`SHIFT`) and writes an override into it.
 * - `findBindLocation` is the reverse direction: given a command string,
 *   where on the keyboard does it already live - the base layer, or inside
 *   which modifier's layer.
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
import { sanitizeCommand } from '@shared/config/alt-layers'
import { normalizeBindKey } from '@shared/config/key-names'
import type { ConfigProfile } from '@shared/modules/config'

export type ModifierTrigger = 'ALT' | 'CTRL' | 'SHIFT'

/** The literal English layer name a freshly created layer gets, keyed by modifier. */
const MODIFIER_LAYER_NAME: Record<ModifierTrigger, string> = {
  ALT: 'Alt',
  CTRL: 'Ctrl',
  SHIFT: 'Shift',
}

/** Every modifier layer created by this module holds while its trigger is down. */
const MODIFIER_LAYER_MODE: AltLayerMode = 'hold'

export interface UpsertModifierLayerOverrideInput {
  layers: AltLayer[]
  modifier: ModifierTrigger
  key: string
  /**
   * The exact command string to store as the override's value - stored
   * verbatim (only `sanitizeCommand` applied), never re-derived or
   * re-joined here. Whoever resolved a capture into one command string
   * (D1) already decided what that string is; duplicating that logic here
   * would be a second place it could drift from.
   */
  command: string
  /**
   * Id for a newly created layer. Caller supplies it (e.g.
   * `crypto.randomUUID()`) so this function stays free of any
   * id-generation policy/dependency - the same reason `assignLayerTrigger`
   * and the rest of `alt-layers.ts` take ids as plain strings.
   */
  newId: string
}

export interface UpsertModifierLayerOverrideResult {
  /** A new array - `layers` and its elements are never mutated in place. */
  layers: AltLayer[]
  /** Id of the layer the override was written into (existing or freshly created). */
  layerId: string
  /** True if a new layer was created by this call. */
  created: boolean
  /**
   * The override's previous command at `key` in that layer, if any
   * (`undefined` if the key had no override yet) - so a caller can warn
   * before silently replacing it, the same shape `findBindCollision`'s
   * `layerOverride` case reports for the non-blocking layer-level warning.
   */
  previousCommand: string | undefined
}

/**
 * Find-or-create the one layer for `modifier` and write `command` as its
 * override at `key`.
 *
 * Lookup is by normalized `triggerKey` only (see the file doc comment for
 * why never by `name`). `key` itself is stored and read back **verbatim**
 * (not normalized): the override map's own producer (`generateLayerAliases`)
 * already `.trim()`s keys when it reads them, and every other write path in
 * this module and the renderer stores raw captured key tokens the same way
 * `layer.overrides` already does elsewhere in the codebase (e.g. hand-built
 * layers in `alt-layers.test.ts`). Being consistent about that here - write
 * by exact `key`, read `previousCommand` by that same exact `key` - is what
 * lets `findBindLocation`'s reverse scan (which also compares raw override
 * keys) reliably find what this function just wrote.
 */
export function upsertModifierLayerOverride(
  input: UpsertModifierLayerOverrideInput,
): UpsertModifierLayerOverrideResult {
  const { layers, modifier, key, command, newId } = input
  const sanitized = sanitizeCommand(command)

  const existingIndex = layers.findIndex(
    (candidate) => normalizeBindKey(candidate.triggerKey ?? '') === modifier,
  )

  if (existingIndex === -1) {
    const created: AltLayer = {
      id: newId,
      name: MODIFIER_LAYER_NAME[modifier],
      mode: MODIFIER_LAYER_MODE,
      triggerKey: modifier,
      overrides: { [key]: sanitized },
    }
    return {
      layers: [...layers, created],
      layerId: newId,
      created: true,
      previousCommand: undefined,
    }
  }

  const existing = layers[existingIndex]!
  const previousCommand = existing.overrides[key]
  const updated: AltLayer = {
    ...existing,
    overrides: { ...existing.overrides, [key]: sanitized },
  }

  return {
    layers: layers.map((candidate, index) => (index === existingIndex ? updated : candidate)),
    layerId: existing.id,
    created: false,
    previousCommand,
  }
}

export interface ModifierOverrideOwner {
  /** The layer that already owns `key`'s override for this modifier. */
  layerId: string
  layerName: string
  /** The override's current, exact command string - the thing a write would replace. */
  command: string
}

/**
 * What already occupies `key`'s override inside the one layer for `modifier`,
 * if anything (story 016 D4, AC 6). Pure lookup only - it does not compare
 * against a candidate new command, so a caller deciding "is this actually a
 * different assignment, or the same row recapturing its own combo" does that
 * comparison itself (see `findModifierSlotCollision` in the renderer's
 * `bind-slot-collision.ts`, the one call site).
 *
 * Layer lookup is the exact same rule as `upsertModifierLayerOverride` - by
 * normalized `triggerKey`, never by name - and the override lookup is the
 * same exact, non-normalized `key` read `upsertModifierLayerOverride` uses for
 * `previousCommand`, so this reports precisely what a write to the same
 * `(modifier, key)` would be about to overwrite.
 */
export function findModifierOverrideOwner(
  layers: AltLayer[],
  modifier: ModifierTrigger,
  key: string,
): ModifierOverrideOwner | null {
  const layer = layers.find(
    (candidate) => normalizeBindKey(candidate.triggerKey ?? '') === modifier,
  )
  if (!layer) return null

  const command = layer.overrides[key]
  if (!command) return null

  return { layerId: layer.id, layerName: layer.name, command }
}

export interface BindLocation {
  key: string
  /** `null` when found in the base layer's `binds`, otherwise which modifier layer's override it was. */
  modifier: ModifierTrigger | null
}

const MODIFIER_TRIGGERS: readonly ModifierTrigger[] = ['ALT', 'CTRL', 'SHIFT']

/** Exported (review-fix) so `catalog-binds.ts`'s `findRowLayerOverride` can scan
 * `profile.layers` for modifier layers the same way `findBindLocation` does below,
 * without duplicating the trigger-name check in a second file. */
export function isModifierTrigger(value: string): value is ModifierTrigger {
  return (MODIFIER_TRIGGERS as readonly string[]).includes(value)
}

/**
 * Reverse lookup: given an exact command string, find where it is bound.
 *
 * Matching is **exact string equality against the stored value**, not a
 * second `sanitizeCommand` pass here. Every writer that puts a command into
 * `profile.binds` or a layer's `overrides` already sanitizes on the way in -
 * `upsertModifierLayerOverride` above, and the base-bind editor per
 * `alt-layers.ts`'s own D6 doc comment ("safe to store as a base bind at
 * all"). Re-sanitizing in the reverse lookup would only ever paper over a
 * caller that forgot to sanitize on write, at the cost of this function
 * silently matching a command that is not actually byte-identical to what
 * a fresh `upsertModifierLayerOverride` call would store - worse than
 * failing loudly.
 *
 * Scan order: `profile.binds` first (base layer), then `profile.layers` in
 * array order, each layer's `overrides` in object-insertion order - first
 * match wins, mirroring `findBindCollision`'s base-before-layer precedence.
 *
 * A layer is only treated as a *modifier* layer's match when its
 * `triggerKey`, once normalized, is actually one of `ALT`/`CTRL`/`SHIFT`.
 * Layers with some other trigger (or none) are skipped entirely - not just
 * excluded from being reported as a modifier match, but not scanned at all -
 * for two reasons: `BindLocation.modifier` is typed as `ModifierTrigger |
 * null`, so returning an arbitrary trigger string would need an unsafe cast
 * to satisfy that contract; and semantically, a plain layer like "Zoom"
 * (trigger `v`) holding a command that happens to equal one this module also
 * wrote elsewhere is not "the same bind living under a modifier" - it is a
 * coincidence this function has no business reporting as one. A command that
 * lives only inside such a non-modifier layer is therefore not found by this
 * function at all (returns `null` unless it also matches somewhere else).
 */
export function findBindLocation(profile: ConfigProfile, command: string): BindLocation | null {
  for (const [rawKey, boundCommand] of Object.entries(profile.binds)) {
    if (boundCommand === command) {
      return { key: normalizeBindKey(rawKey), modifier: null }
    }
  }

  for (const layer of profile.layers ?? []) {
    const normalizedTrigger = normalizeBindKey(layer.triggerKey ?? '')
    if (!isModifierTrigger(normalizedTrigger)) continue

    for (const [rawKey, overrideCommand] of Object.entries(layer.overrides)) {
      if (overrideCommand === command) {
        return { key: normalizeBindKey(rawKey), modifier: normalizedTrigger }
      }
    }
  }

  return null
}

