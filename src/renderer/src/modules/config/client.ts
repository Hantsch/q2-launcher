import {
  CONFIG_HANDLERS,
  type ConfigProfile,
  type CreateConfigProfileInput,
  type RemoveConfigProfileInput,
  type RenameConfigProfileInput,
} from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/** Typed client for the config module. One function per handler in its contract. */
export function listConfigProfiles(): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.list)
}

/** Creates a profile and returns the full, updated profile list. */
export function createConfigProfile(
  input: CreateConfigProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.create, input)
}

/** Renames a profile and returns the full, updated profile list. */
export function renameConfigProfile(
  input: RenameConfigProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.rename, input)
}

/** Removes a profile and returns the full, updated profile list. */
export function removeConfigProfile(
  input: RemoveConfigProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  return callModule<ConfigProfile[]>('config', CONFIG_HANDLERS.remove, input)
}
