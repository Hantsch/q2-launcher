import {
  updateCancelDownloadSchema,
  updateCheckSchema,
  updateDismissSchema,
  updateDownloadSchema,
  updateGetStateSchema,
  updateInstallAndRestartSchema,
} from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle, handleOutcome } from './index'

/**
 * Story 097 D5: the update-check channels. Both resolve with the service's `UpdateState` directly
 * (never an `Outcome`), per the shared contract - `handle`, not `handleOutcome`, is the right
 * wrapper here, same as `launch:getState` in `launch.ts`. Neither handler needs its own try/catch:
 * `service.ts`'s `getState()`/`checkNow()` are both documented to never reject.
 *
 * Story 098 D1: the four staged actions. These *can* be refused - a download with nothing to
 * download, a restart while a game runs - so they resolve with an `Outcome` and go through
 * `handleOutcome`, the same guard-then-`fail(key)` shape `launch:start` uses for
 * `launch.error.installationBusy`. Every refusal is decided in the service, in main: this file
 * passes the outcome through and adds no judgement of its own.
 */
export function registerUpdateIpc(app: AppContext): void {
  handle('update:getState', updateGetStateSchema, () => app.update.getState())

  handle('update:check', updateCheckSchema, () => app.update.checkNow())

  handleOutcome('update:download', updateDownloadSchema, () => app.update.startDownload())

  handleOutcome('update:cancelDownload', updateCancelDownloadSchema, () =>
    app.update.cancelDownload(),
  )

  handleOutcome('update:installAndRestart', updateInstallAndRestartSchema, () =>
    app.update.installAndRestart(),
  )

  handleOutcome('update:dismiss', updateDismissSchema, () => app.update.dismiss())
}
