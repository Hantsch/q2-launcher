import { updateCheckSchema, updateGetStateSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle } from './index'

/**
 * Story 097 D5: the update-check channels. Both resolve with the service's `UpdateState` directly
 * (never an `Outcome`), per the shared contract - `handle`, not `handleOutcome`, is the right
 * wrapper here, same as `launch:getState` in `launch.ts`. Neither handler needs its own try/catch:
 * `service.ts`'s `getState()`/`checkNow()` are both documented to never reject.
 */
export function registerUpdateIpc(app: AppContext): void {
  handle('update:getState', updateGetStateSchema, () => app.update.getState())

  handle('update:check', updateCheckSchema, () => app.update.checkNow())
}
