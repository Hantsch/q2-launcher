import type { ModuleId, Outcome } from '@shared/types'
import { invoke } from '../lib/bridge'

/**
 * Calls a module handler through the shell's single `module:invoke` channel.
 *
 * The generic is the module's own responsibility to get right: each module ships
 * a thin typed client (see `modules/library/client.ts`) so components never call
 * this directly with a loose type.
 */
export async function callModule<T>(
  moduleId: ModuleId,
  type: string,
  payload?: unknown,
): Promise<Outcome<T>> {
  const result = await invoke('module:invoke', {
    moduleId,
    type,
    ...(payload !== undefined ? { payload } : {}),
  })
  return result as Outcome<T>
}
