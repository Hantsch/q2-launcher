import { randomUUID } from 'node:crypto'
import {
  STANDARD_TEMPLATE,
  type ConfigProfile,
  type CreateConfigProfileInput,
  type RenameConfigProfileInput,
  type RemoveConfigProfileInput,
} from '@shared/modules/config'
import type { StateStore } from '../../services/state'

/**
 * CRUD over config profiles.
 *
 * Simpler than `InstallationsService`: a profile has no path to canonicalize,
 * nothing to validate against the filesystem, and no uniqueness rule - identity
 * is the generated `id`, and a duplicate name is fine. This is the only thing
 * outside `state.ts`/`schemas.ts` that touches `configProfiles`.
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

  private commit(profiles: ConfigProfile[]): ConfigProfile[] {
    return this.state.setConfigProfiles(profiles)
  }
}
