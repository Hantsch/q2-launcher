import { ACTION_ALIAS_PREFIX, aliasNameFor } from '@shared/config/alias-render'
import type { AltLayer } from '@shared/config/alt-layers'
import { normalizeBindKey } from '@shared/config/key-names'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'

/**
 * The profile-wide conflict scan (story 020 D7): every key that is claimed more than once,
 * anywhere in `profile` - "a key bound twice is a conflict no matter which drawer you happen to
 * be looking at" (the story's sprint decision). Mirrors `@shared/config/bind-collision.ts`'s
 * notion of what counts as a "claim" (`findBindCollision`'s three sources: `profile.binds`, an
 * action's key/secondary slot when it is not modifier-carrying, and a layer's own `overrides`),
 * but that file answers "does THIS one candidate key collide with anything" for an interactive
 * capture; this one scans the *whole* profile once and reports every group of 2+ claimants, for
 * the header's conflict count and the per-slot/per-row markers D5/D6 already built the surface
 * for.
 *
 * Two independent scan channels, per decision 14 in `bind-collision.ts`'s doc comment ("layers
 * legitimately coexist with the base bind they temporarily override"):
 *
 * - `'base'` scope: `profile.binds` plus every non-alias action's `key`/`secondaryKey`, but only
 *   the slot half that is *not* modifier-carrying (`slotValue`'s rule in `bind-collision.ts` -
 *   a slot with a `keyModifier`/`secondaryKeyModifier` lives only inside that modifier's layer,
 *   never on the base layer).
 * - `{ layerId }` scope, one per `AltLayer` in `profile.layers`: that layer's own modifier-carrying
 *   claims only - another action's `keyModifier`/`key` (or secondary) pair targeting this layer's
 *   modifier, plus this layer's own hand-made `overrides` entries. A base-layer conflict and a
 *   same-layer modifier conflict on the "same" physical key are two separate, functionally
 *   independent claims (decision 14), so they are reported as two separate `BindConflict`s, never
 *   merged.
 *
 * Deliberately scans `profile.layers` itself rather than re-deriving a layer from a modifier the
 * way `findModifierSlotCollision` does for a single candidate: a whole-profile scan has no single
 * "the modifier being captured right now" to key off, and a modifier with no `AltLayer` yet has no
 * `overrides` map to conflict inside your (the mirror only ever writes to an existing/created
 * layer on save, and this scan intentionally mirrors what is actually persisted, not what a save
 * would produce next).
 *
 * Pure - no DOM, no hooks, no IPC - so a vitest file can import it directly, the same rule
 * `catalog-binds.ts`/`bind-collision.ts` already follow.
 */
export interface BindConflict {
  /** Normalized key (`normalizeBindKey`) that two or more owners both claim. */
  key: string
  /** Which layer of the profile this claim group lives in - the base layer, or one specific
   * `AltLayer` (by id). A base conflict and a layer conflict on the same physical key are always
   * two separate entries, never merged (decision 14). */
  scope: 'base' | { layerId: string }
  /** Display names of everyone claiming `key` in this scope, in claim order. Always 2+. */
  owners: string[]
}

/** Accumulates claims for one scan channel, keyed by normalized key. */
class ClaimTracker {
  private readonly claims = new Map<string, string[]>()

  add(rawKey: string | undefined, owner: string): void {
    if (!rawKey) return
    const normalizedKey = normalizeBindKey(rawKey)
    const owners = this.claims.get(normalizedKey)
    if (owners) {
      owners.push(owner)
    } else {
      this.claims.set(normalizedKey, [owner])
    }
  }

  conflicts(scope: BindConflict['scope']): BindConflict[] {
    return [...this.claims.entries()]
      .filter(([, owners]) => owners.length >= 2)
      .map(([key, owners]) => ({ key, scope, owners }))
  }
}

/**
 * The base-layer channel: `profile.binds` plus every non-alias action's non-modifier-carrying
 * `key`/`secondaryKey`.
 *
 * `setActions` (main) mirrors every action's key onto `profile.binds[normalizeBindKey(key)] =
 * aliasNameFor(action)` (see `bind-collision.ts`'s file doc comment) - so an action's own current
 * key always shows up in `profile.binds` too, and counting both would report an action as
 * conflicting with its own mirror. That mirror entry is recognised by value (`aliasNameFor` of an
 * action already claiming this exact same normalized key) and skipped, exactly the reasoning
 * `findBindCollision`'s `isOwnMirror` check applies to a single candidate.
 */
function findBaseConflicts(profile: ConfigProfile): BindConflict[] {
  const actions = (profile.actions ?? []).filter((action) => action.kind !== 'alias')
  const tracker = new ClaimTracker()
  const ownMirrorsByKey = new Map<string, Set<string>>()

  const addActionClaim = (rawKey: string | undefined, action: ConfigAction): void => {
    if (!rawKey) return
    tracker.add(rawKey, action.name)
    const normalizedKey = normalizeBindKey(rawKey)
    const mirrors = ownMirrorsByKey.get(normalizedKey) ?? new Set<string>()
    mirrors.add(aliasNameFor(action))
    ownMirrorsByKey.set(normalizedKey, mirrors)
  }

  for (const action of actions) {
    // A slot carrying a modifier lives only inside that modifier's layer (`slotValue`'s rule in
    // `bind-collision.ts`) - invisible to the base layer, so it must not be counted as a base
    // claim here.
    if (!action.keyModifier) addActionClaim(action.key, action)
    if (!action.secondaryKeyModifier) addActionClaim(action.secondaryKey, action)
  }

  for (const [rawKey, command] of Object.entries(profile.binds)) {
    if (!command) continue
    const normalizedKey = normalizeBindKey(rawKey)
    if (ownMirrorsByKey.get(normalizedKey)?.has(command)) continue
    tracker.add(rawKey, command)
  }

  return tracker.conflicts('base')
}

/** The three literal modifier triggers a layer can be keyed by - narrows a layer's raw
 * `triggerKey` down to the type `ConfigAction.keyModifier` actually carries. */
function modifierForLayer(layer: AltLayer): ModifierTrigger | undefined {
  if (!layer.triggerKey) return undefined
  const normalized = normalizeBindKey(layer.triggerKey)
  return normalized === 'ALT' || normalized === 'CTRL' || normalized === 'SHIFT' ? normalized : undefined
}

/**
 * One `AltLayer`'s own channel: claims made *within that layer only* (decision 14 - a modifier
 * layer conflict is two things fighting over the same override in the same layer, never a
 * cross-layer or base-vs-layer collision).
 *
 * Two sources, both scoped to this one layer:
 *
 * - Every non-alias action whose `keyModifier`/`secondaryKeyModifier` matches this layer's own
 *   trigger, by its `key`/`secondaryKey`. Read straight off `actions`, not off `layer.overrides` -
 *   `applyActionLayerMirror` writes one value per key into a plain object, so if two actions
 *   raced to claim the same `(modifier, key)` the mirror already resolved to "last one wins" and
 *   the conflict would be invisible if this scan only looked at the persisted map (the same
 *   reasoning `findModifierSlotCollision`'s doc comment gives for reading `actions` directly).
 * - This layer's own hand-made `overrides` entries - anything whose value does *not* start with
 *   `ACTION_ALIAS_PREFIX`. A mirrored entry is skipped here: it is the *result* of exactly one of
 *   the action claims above (never a second, independent claim), so counting it too would inflate
 *   every modifier-bound action into a conflict with its own mirror.
 */
function findLayerConflicts(actions: ConfigAction[], layer: AltLayer): BindConflict[] {
  const modifier = modifierForLayer(layer)
  const tracker = new ClaimTracker()

  if (modifier) {
    for (const action of actions) {
      if (action.kind === 'alias') continue
      if (action.keyModifier === modifier) tracker.add(action.key, action.name)
      if (action.secondaryKeyModifier === modifier) tracker.add(action.secondaryKey, action.name)
    }
  }

  for (const [rawKey, command] of Object.entries(layer.overrides)) {
    if (!command || command.startsWith(ACTION_ALIAS_PREFIX)) continue
    tracker.add(rawKey, command)
  }

  return tracker.conflicts({ layerId: layer.id })
}

/** Every key `profile` claims more than once, across the base layer and every alt layer, each as
 * its own `BindConflict` (decision 14: a base claim and a same-layer modifier claim on the same
 * physical key are independent and are never merged into one entry). */
export function findBindConflicts(profile: ConfigProfile): BindConflict[] {
  const actions = profile.actions ?? []
  const layers = profile.layers ?? []
  return [
    ...findBaseConflicts(profile),
    ...layers.flatMap((layer) => findLayerConflicts(actions, layer)),
  ]
}

/** `scope:key` lookup key shared by `indexBindConflicts` and `findSlotConflictOwner`. */
function conflictLookupKey(scope: BindConflict['scope'], normalizedKey: string): string {
  const scopePart = scope === 'base' ? 'base' : `layer:${scope.layerId}`
  return `${scopePart}:${normalizedKey}`
}

/** Indexes a scan's results for O(1) per-slot lookup, keyed by `scope:normalizedKey`. */
export function indexBindConflicts(conflicts: BindConflict[]): Map<string, BindConflict> {
  const index = new Map<string, BindConflict>()
  for (const conflict of conflicts) {
    index.set(conflictLookupKey(conflict.scope, conflict.key), conflict)
  }
  return index
}

/**
 * The other claimant's display name for one slot, or `undefined` when that slot's key is not
 * conflicted. `boundKey`/`modifier` describe the slot exactly as `BindSlot`/`ControlsOptionsCell`
 * already read it off a row (`deriveRowState`/a plain action's own fields); `ownerName` is this
 * row's own display name, excluded from the result so the Options cell names the *other* owner,
 * never itself.
 *
 * A modifier-carrying slot is looked up in the layer whose `triggerKey` matches `modifier` -
 * exactly the lookup `layerNameForModifier`/`findModifierSlotCollision` already do - and reads as
 * unconflicted when that layer does not exist yet (nothing for `findBindConflicts` to have scanned
 * either, so this stays consistent with the scan it reads).
 */
export function findSlotConflictOwner(
  index: Map<string, BindConflict>,
  layers: AltLayer[],
  boundKey: string | undefined,
  modifier: ModifierTrigger | undefined,
  ownerName: string,
): string | undefined {
  if (!boundKey) return undefined
  const normalizedKey = normalizeBindKey(boundKey)

  const scope: BindConflict['scope'] | undefined = modifier
    ? (() => {
        const layer = layers.find((candidate) => normalizeBindKey(candidate.triggerKey ?? '') === modifier)
        return layer ? { layerId: layer.id } : undefined
      })()
    : 'base'
  if (!scope) return undefined

  const conflict = index.get(conflictLookupKey(scope, normalizedKey))
  if (!conflict) return undefined

  const ownIndex = conflict.owners.indexOf(ownerName)
  const others =
    ownIndex >= 0
      ? [...conflict.owners.slice(0, ownIndex), ...conflict.owners.slice(ownIndex + 1)]
      : conflict.owners
  return others[0]
}
