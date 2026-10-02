import { fail, type Installation, type Outcome } from '@shared/types'
import type { InstallationsService } from '../../../services/installations'
import {
  readEngineState,
  writeEngineState,
  type InstallationEngineState,
} from '../../../services/engine-state'

/**
 * Records (or extends) an installation's engine state under `moduleData['downloads']` and mirrors
 * the merged `version` onto `detectedVersion` in the same single write. A merged state without a
 * version passes `undefined`, which removes the field - it is never left stale.
 */
export function setEngineState(
  installations: Pick<InstallationsService, 'find' | 'patch'>,
  id: string,
  patch: Partial<InstallationEngineState>,
): Outcome<Installation> {
  const current = installations.find(id)
  if (!current) return fail('installations.error.notFound')

  const moduleData = writeEngineState(current.moduleData, patch)
  const merged = readEngineState(moduleData)
  return installations.patch(id, { moduleData, detectedVersion: merged.version || undefined })
}

/**
 * The service viewed through the jobs' structural `setEngineState(id, patch)` member. A prototype
 * view rather than a spread, so the service's methods (and spies installed on it) stay live.
 */
export function withEngineState<T extends Pick<InstallationsService, 'find' | 'patch'>>(
  installations: T,
): T & {
  setEngineState(id: string, patch: Partial<InstallationEngineState>): Outcome<Installation>
} {
  return Object.create(installations, {
    setEngineState: {
      value: (id: string, patch: Partial<InstallationEngineState>) =>
        setEngineState(installations, id, patch),
    },
  })
}
