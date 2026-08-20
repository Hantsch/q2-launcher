import { randomUUID } from 'node:crypto'
import {
  STANDARD_TEMPLATE,
  type AssignProfileInput,
  type ConfigProfile,
  type CreateConfigProfileInput,
  type RenameConfigProfileInput,
  type RemoveConfigProfileInput,
  type SetDefaultProfileInput,
  type SetProfileActionsInput,
  type SetProfileBindsInput,
  type SetProfileCvarsInput,
  type SetProfileLayersInput,
  type UnassignProfileInput,
  type UnrecognizedConfigLine,
} from '@shared/modules/config'
import { normalizeBindKey } from '@shared/config/key-names'
import type { StateStore } from '../../services/state'
import { ACTION_ALIAS_PREFIX, aliasNameFor } from '@shared/config/alias-render'
import { applyActionLayerMirror } from '@shared/config/modifier-layers'
import {
  assign as assignProfile,
  unassign as unassignProfile,
  setDefault as setDefaultProfile,
  reconcileAssignments,
} from './assignments'

/**
 * CRUD over config profiles.
 *
 * Simpler than `InstallationsService`: a profile has no path to canonicalize,
 * nothing to validate against the filesystem, and no uniqueness rule - identity
 * is the generated `id`, and a duplicate name is fine. This is the only thing
 * outside `state.ts`/`schemas.ts` that touches `configProfiles`, including its
 * assignment links to installations (mutated through `./assignments`'s pure
 * functions).
 */
export class ProfilesStore {
  private readonly state: StateStore

  constructor(state: StateStore) {
    this.state = state
  }

  list(): ConfigProfile[] {
    return this.state.configProfiles()
  }

  find(id: string): ConfigProfile | undefined {
    return this.state.configProfiles().find((profile) => profile.id === id)
  }

  create(input: CreateConfigProfileInput): ConfigProfile[] {
    const now = new Date().toISOString()
    const profile: ConfigProfile = {
      id: randomUUID(),
      name: input.name,
      createdAt: now,
      updatedAt: now,
      ...(input.from === 'template'
        ? { cvars: { ...STANDARD_TEMPLATE.cvars }, binds: { ...STANDARD_TEMPLATE.binds } }
        : { cvars: {}, binds: {} }),
      assignments: [],
    }

    return this.commit([...this.state.configProfiles(), profile])
  }

  /**
   * Creates a profile seeded from an import (story 005) instead of from
   * `STANDARD_TEMPLATE` or empty maps. Same shape and same `commit` path as
   * `create()` - fresh id, both timestamps, no assignments - which is what
   * makes the result an ordinary profile by construction (decision 11):
   * nothing downstream needs to know it came from an import rather than the
   * create-profile dialog.
   */
  createFromImport(input: {
    name: string
    cvars: Record<string, string>
    binds: Record<string, string>
    unrecognized: UnrecognizedConfigLine[]
  }): ConfigProfile[] {
    const now = new Date().toISOString()
    const profile: ConfigProfile = {
      id: randomUUID(),
      name: input.name,
      createdAt: now,
      updatedAt: now,
      cvars: { ...input.cvars },
      binds: { ...input.binds },
      assignments: [],
      unrecognized: input.unrecognized,
    }

    return this.commit([...this.state.configProfiles(), profile])
  }

  rename(input: RenameConfigProfileInput): ConfigProfile[] {
    const current = this.find(input.id)
    if (!current) throw new Error(`config profile not found: ${input.id}`)

    const next: ConfigProfile = {
      ...current,
      name: input.name,
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  remove(input: RemoveConfigProfileInput): ConfigProfile[] {
    const current = this.find(input.id)
    if (!current) throw new Error(`config profile not found: ${input.id}`)

    return this.commit(this.state.configProfiles().filter((p) => p.id !== input.id))
  }

  assign(input: AssignProfileInput): ConfigProfile[] {
    return this.commit(assignProfile(this.list(), input))
  }

  unassign(input: UnassignProfileInput): ConfigProfile[] {
    return this.commit(unassignProfile(this.list(), input))
  }

  setDefault(input: SetDefaultProfileInput): ConfigProfile[] {
    return this.commit(setDefaultProfile(this.list(), input))
  }

  /**
   * Replaces a profile's entire `cvars` map with `input.cvars`. Not a partial
   * merge - the renderer is expected to send the full map it wants persisted
   * (see D4's debounced save), so a caller wanting to keep existing entries
   * must include them.
   */
  setCvars(input: SetProfileCvarsInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      cvars: { ...input.cvars },
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Replaces a profile's entire `binds` map with `input.binds`. Mirrors
   * `setCvars` exactly - not a partial merge, full-map replace semantics.
   */
  setBinds(input: SetProfileBindsInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      binds: { ...input.binds },
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Replaces a profile's entire `layers` array with `input.layers`. Same
   * replace-whole-array semantics as `setBinds`/`setCvars` above - the
   * renderer sends the full array it wants persisted.
   *
   * Story 016 (decision 18): the incoming array then goes through
   * `applyActionLayerMirror` against the profile's *existing* `actions` before
   * being stored, exactly as `setActions` does below. `layers` is replaced
   * wholesale, so a Layers-panel save that was assembled from a slightly stale
   * profile snapshot would otherwise silently drop the `q2l_a_*` overrides
   * `setActions` derived for every modifier-bound slot - and nothing would turn
   * red, the binds would just stop working. Re-deriving them here makes the
   * mirror an invariant of the persisted state rather than of one write path:
   * whichever of the two setters ran last, the modifier overrides are correct.
   *
   * `input.layers` is the layer *content* authority (names, modes, trigger
   * keys, hand-made overrides) and `current.actions` is the mirror authority -
   * this call never changes `actions`, so it cannot invent an override for a
   * slot the actions array does not carry, and a hand-made override in
   * `input.layers` (any value not starting with `ACTION_ALIAS_PREFIX`) is
   * passed through untouched.
   */
  setLayers(input: SetProfileLayersInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      layers: applyActionLayerMirror(input.layers, current.actions ?? [], randomUUID),
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Replaces a profile's entire `categories` and `actions` wholesale (same
   * replace-whole-array semantics as `setLayers`) and rebuilds the `binds`
   * map's `q2l_a_*` mirror: every existing bind whose value starts with
   * `ACTION_ALIAS_PREFIX` is dropped first (an action that lost its key, or
   * was deleted outright, must not leave a stale bind pointing at an alias
   * this save no longer generates), then one
   * `binds[normalizeBindKey(key)] = aliasNameFor(action)` is written per key an
   * action still carries, in `input.actions` array order - so when two actions
   * land on the same (normalized) key, the later one in the array wins,
   * deterministically. Every other bind (the user's own, hand-typed ones, and
   * anything from an alt layer's own overrides, which live in a separate map
   * entirely) is untouched.
   *
   * Story 015 (decision 1): "every key an action carries" is `key` *and*
   * `secondaryKey`, both pointing at the same `aliasNameFor(action)` - the alias
   * is per action, not per slot, so a two-slot row costs one alias and two bind
   * lines. The consequences fall out of that single rule rather than needing
   * their own branches: clearing one slot drops only that key's bind (the whole
   * `q2l_a_*` mirror is rebuilt from the surviving slots anyway), and an action
   * whose two slots normalize to the same key writes that key twice with the
   * same value, which is a no-op rather than a conflict.
   *
   * Story 016 (decisions 17-18) adds the modifier half, and it is deliberately
   * *two* mirrors over the same one loop's worth of information, not one mirror
   * with a branch:
   *
   * - A slot that carries a modifier (`keyModifier` for `key`,
   *   `secondaryKeyModifier` for `secondaryKey`) is skipped by the `binds`
   *   mirror above. Quake 2 has no modifiers, so `Alt+R` is not a bind at all -
   *   it is an override inside the ALT layer. Writing a base `bind r` for it
   *   would make the action fire on bare `r` too, which is precisely the
   *   collision the modifier exists to avoid. The two slots are judged
   *   independently: a row can have Primary on `Alt+R` and Secondary on plain
   *   `MOUSE2` at the same time, and each slot's own modifier field decides only
   *   that slot's own fate.
   * - Skipping is not the same as *dropping*: the strip pass above only removes
   *   binds whose value starts with `ACTION_ALIAS_PREFIX`, so a user's
   *   hand-typed `bind r "weapnext"` on that same key survives a row moving to
   *   `Alt+R` untouched. What does disappear is a stale `q2l_a_*` base bind for
   *   a slot that just *gained* a modifier - it has to, or the key would keep
   *   firing the action without the modifier held.
   * - A `kind: 'alias'` action (story 019) is skipped by both mirrors outright:
   *   it renders as `alias <its own name>` and exists to be *called* by a
   *   binding, so it is never bound to a key nor overridden into a layer. Same
   *   strip-then-skip consequence as above - a row that was a bind and became
   *   an alias loses its `q2l_a_*` bind, while a hand-typed bind on that key
   *   stays.
   * - `layers` is rebuilt by `applyActionLayerMirror` (`@shared/config/
   *   modifier-layers`), the exact layer-side counterpart of the `binds` mirror:
   *   same strip-then-rewrite shape, same `ACTION_ALIAS_PREFIX` filter, same
   *   later-wins array order. Hand-made overrides and non-modifier layers are
   *   left alone; `randomUUID` is passed as its id factory so that pure,
   *   `src/shared` function stays free of `node:crypto`.
   */
  setActions(input: SetProfileActionsInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const nextBinds: Record<string, string> = {}
    for (const [key, command] of Object.entries(current.binds)) {
      if (!command.startsWith(ACTION_ALIAS_PREFIX)) nextBinds[key] = command
    }
    for (const action of input.actions) {
      // An alias entry is a definition other bindings call, never something a
      // key runs (story 019) - so it contributes no bind, whatever key data the
      // row happens to still carry. Combined with the unconditional strip pass
      // above, that is also what removes the stale `q2l_a_*` bind of a row that
      // used to be a bind and has just become an alias.
      if (action.kind === 'alias') continue

      // A slot with a modifier belongs to that modifier's layer, not to `binds`
      // (story 016 decision 17) - each slot is judged by its own modifier field.
      const keys = [
        action.keyModifier ? undefined : action.key,
        action.secondaryKeyModifier ? undefined : action.secondaryKey,
      ]
        .map((slot) => slot?.trim())
        .filter((slot): slot is string => Boolean(slot))
      if (keys.length === 0) continue
      const alias = aliasNameFor(action)
      for (const key of keys) nextBinds[normalizeBindKey(key)] = alias
    }

    const next: ConfigProfile = {
      ...current,
      categories: [...input.categories],
      actions: [...input.actions],
      binds: nextBinds,
      layers: applyActionLayerMirror(current.layers ?? [], input.actions, randomUUID),
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  reconcile(knownInstallationIds: string[]): ConfigProfile[] {
    return this.commit(reconcileAssignments(this.list(), knownInstallationIds))
  }

  private commit(profiles: ConfigProfile[]): ConfigProfile[] {
    return this.state.setConfigProfiles(profiles)
  }
}
