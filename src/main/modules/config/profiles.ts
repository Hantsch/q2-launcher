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
   */
  setLayers(input: SetProfileLayersInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      layers: [...input.layers],
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
   * `binds[normalizeBindKey(action.key)] = aliasNameFor(action)` is written
   * per action that still has a `key`, in `input.actions` array order - so
   * when two actions land on the same (normalized) key, the later one in the
   * array wins, deterministically. Every other bind (the user's own,
   * hand-typed ones, and anything from an alt layer's own overrides, which
   * live in a separate map entirely) is untouched.
   */
  setActions(input: SetProfileActionsInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const nextBinds: Record<string, string> = {}
    for (const [key, command] of Object.entries(current.binds)) {
      if (!command.startsWith(ACTION_ALIAS_PREFIX)) nextBinds[key] = command
    }
    for (const action of input.actions) {
      const key = action.key?.trim()
      if (!key) continue
      nextBinds[normalizeBindKey(key)] = aliasNameFor(action)
    }

    const next: ConfigProfile = {
      ...current,
      categories: [...input.categories],
      actions: [...input.actions],
      binds: nextBinds,
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
