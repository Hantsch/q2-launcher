import { configState } from '../main/modules/config/persisted'
import type { StateStore } from '../main/services/state'
import type { ConfigProfile } from '@shared/modules/config'

/** Replaces the stored config profiles wholesale, the way tests seed a starting library. */
export function seedConfigProfiles(state: StateStore, profiles: ConfigProfile[]): ConfigProfile[] {
  return configState(state).profiles.update(() => profiles)
}
