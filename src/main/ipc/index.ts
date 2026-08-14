import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  DEV_ONLY_CHANNELS,
  INVOKE_CHANNELS,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
} from '@shared/ipc'
import { scopedLogger } from '../lib/logger'
import type { AppContext } from '../context'
import { registerAppIpc } from './app'
import { registerDetectionIpc } from './detection'
import { registerDevIpc } from './dev'
import { registerInstallationsIpc } from './installations'
import { registerJobsIpc } from './jobs'
import { registerLaunchIpc } from './launch'
import { registerModulesIpc } from './modules'
import { registerSettingsIpc } from './settings'
import { registerWindowIpc } from './window'

const log = scopedLogger('ipc')

const registeredChannels = new Set<InvokeChannel>()

/**
 * Typed `ipcMain.handle`.
 *
 * The channel name constrains both the payload and the return type against
 * `IpcInvokeMap`, so main and renderer cannot drift apart: renaming a field in
 * the contract breaks the build on both sides.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  handler: (
    payload: InvokeRequest<C>,
    event: IpcMainInvokeEvent,
  ) => InvokeResponse<C> | Promise<InvokeResponse<C>>,
): void {
  if (registeredChannels.has(channel)) {
    throw new Error(`[ipc] channel '${channel}' registered twice`)
  }
  registeredChannels.add(channel)
  ipcMain.handle(channel, (event, payload: unknown) => handler(payload as InvokeRequest<C>, event))
}

export function registerAllIpc(app: AppContext): void {
  registerAppIpc(app)
  registerWindowIpc()
  registerSettingsIpc(app)
  registerInstallationsIpc(app)
  registerDetectionIpc(app)
  registerLaunchIpc(app)
  registerJobsIpc(app)
  registerModulesIpc(app)
  if (app.isDev) registerDevIpc(app)

  assertContractFullyHandled(app.isDev)
  log.info(`registered ${registeredChannels.size} IPC channels`)
}

/**
 * Fails fast at boot if a channel exists in the contract but nothing answers it.
 * Without this, a missing handler only shows up as a rejected promise in the UI
 * whenever a user happens to hit that path.
 */
function assertContractFullyHandled(isDev: boolean): void {
  const missing = INVOKE_CHANNELS.filter((channel) => {
    if (registeredChannels.has(channel)) return false
    return isDev || !DEV_ONLY_CHANNELS.includes(channel)
  })

  if (missing.length > 0) {
    throw new Error(`[ipc] channels declared but not handled: ${missing.join(', ')}`)
  }
}
