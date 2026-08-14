import { randomUUID } from 'node:crypto'
import {
  STANDARD_TEMPLATE,
  type AssignProfileInput,
  type ConfigProfile,
  type CreateConfigProfileInput,
  type RenameConfigProfileInput,
  type RemoveConfigProfileInput,
  type SetDefaultProfileInput,
  type SetProfileCvarsInput,
  type UnassignProfileInput,
} from '@shared/modules/config'
import type { StateStore } from '../../services/state'
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

  rename(input: RenameConfigProfileInput): ConfigProfile[] {
    const current = this.find(input.id)
    if (!current) throw new Error(`config profile not found: ${input.id}`)

    const next: ConfigProfile = { ...current, name: input.name, updatedAt: new Date().toISOString() }
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

  reconcile(knownInstallationIds: string[]): ConfigProfile[] {
    return this.commit(reconcileAssignments(this.list(), knownInstallationIds))
  }

  private commit(profiles: ConfigProfile[]): ConfigProfile[] {
    return this.state.setConfigProfiles(profiles)
  }
}
