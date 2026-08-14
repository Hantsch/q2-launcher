import {
  CONFIG_HANDLERS,
  type AssignProfileInput,
  type ConfigProfile,
  type CreateConfigProfileInput,
  type RemoveConfigProfileInput,
  type RenameConfigProfileInput,
  type SetDefaultProfileInput,
  type UnassignProfileInput,
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

/**
 * `assign`/`unassign`/`setDefault` each return, as the transport-level
 * `Outcome`'s own value, an inner `Outcome<ConfigProfile[]>` built by the main
 * process handler - so a raw `callModule` call here yields
 * `Outcome<Outcome<ConfigProfile[]>>`. These three functions flatten that one
 * level so every other file only ever sees a flat `Outcome<ConfigProfile[]>`,
 * same as `create`/`rename`/`remove` above.
 */
export async function assignConfigProfile(
  input: AssignProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  const result = await callModule<Outcome<ConfigProfile[]>>('config', CONFIG_HANDLERS.assign, input)
  return result.ok ? result.value : result
}

/** Unassigns a profile from an installation and returns the full, updated profile list. */
export async function unassignConfigProfile(
  input: UnassignProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  const result = await callModule<Outcome<ConfigProfile[]>>('config', CONFIG_HANDLERS.unassign, input)
  return result.ok ? result.value : result
}

/** Marks a profile as an installation's default and returns the full, updated profile list. */
export async function setDefaultConfigProfile(
  input: SetDefaultProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  const result = await callModule<Outcome<ConfigProfile[]>>(
    'config',
    CONFIG_HANDLERS.setDefault,
    input,
  )
  return result.ok ? result.value : result
}
