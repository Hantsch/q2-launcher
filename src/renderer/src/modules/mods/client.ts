import { MODS_HANDLERS, type ModsListResult } from '@shared/modules/mods'
import type { Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/**
 * Typed client for the mods module. One function per handler in its contract.
 *
 * The module handlers return their own `Outcome`, which `module:invoke` wraps in another one -
 * flattened here so callers see a single `Outcome<T>`.
 */
async function call<T>(type: string, payload: unknown): Promise<Outcome<T>> {
  const outer = await callModule<Outcome<T>>('mods', type, payload)
  return outer.ok ? outer.value : outer
}

export function listMods(installationId: string): Promise<Outcome<ModsListResult>> {
  return call<ModsListResult>(MODS_HANDLERS.list, { installationId })
}

export function revealMod(installationId: string, gameDir: string): Promise<Outcome<null>> {
  return call<null>(MODS_HANDLERS.reveal, { installationId, gameDir })
}
