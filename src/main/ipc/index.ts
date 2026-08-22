import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'
import {
  DEV_ONLY_CHANNELS,
  INVOKE_CHANNELS,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
} from '@shared/ipc'
import { fail, type Outcome } from '@shared/types'
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

/** Fallback rejection key for `handleOutcome`; per-channel keys are passed explicitly. */
const INVALID_PAYLOAD_KEY = 'ipc.error.invalidPayload'

/**
 * A handler for `channel`, receiving the payload *after* validation.
 *
 * The payload type comes from the contract, not from the schema, so a schema
 * that parses to the wrong shape is a compile error at the call site.
 */
type Handler<C extends InvokeChannel> = (
  payload: InvokeRequest<C>,
  event: IpcMainInvokeEvent,
) => InvokeResponse<C> | Promise<InvokeResponse<C>>

/**
 * Channels whose response is an `Outcome`, and which can therefore report a bad
 * payload as a failed outcome instead of a rejected promise. Anything else must
 * use `handle`.
 */
type OutcomeChannel = {
  [C in InvokeChannel]: InvokeResponse<C> extends Outcome<unknown> ? C : never
}[InvokeChannel]

/**
 * The one place a channel is bound to `ipcMain`, so the registration bookkeeping
 * `assertContractFullyHandled()` and the startup count rely on cannot drift
 * between the two public wrappers.
 */
function register<C extends InvokeChannel>(
  channel: C,
  listener: (event: IpcMainInvokeEvent, payload: unknown) => unknown,
): void {
  if (registeredChannels.has(channel)) {
    throw new Error(`[ipc] channel '${channel}' registered twice`)
  }
  registeredChannels.add(channel)
  ipcMain.handle(channel, listener)
}

/**
 * Typed `ipcMain.handle` for channels that return a plain value.
 *
 * The channel name constrains the payload schema, the payload and the return
 * type against `IpcInvokeMap`, so main and renderer cannot drift apart: renaming
 * a field in the contract breaks the build on both sides.
 *
 * Validation is not optional - the schema is a required parameter, and it is
 * parsed before the handler runs, so no handler ever sees an unvalidated
 * payload. A malformed payload **throws**, which surfaces in the renderer as a
 * rejected `invoke` promise. That is deliberate: these channels have no failure
 * channel in their return type, and a bad payload here is a renderer bug rather
 * than user input.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  schema: ZodType<InvokeRequest<C>>,
  handler: Handler<C>,
): void {
  register(channel, (event, payload) => handler(schema.parse(payload), event))
}

/**
 * Typed `ipcMain.handle` for channels that return an `Outcome`.
 *
 * A malformed payload **resolves** to `fail(invalidKey)` instead of throwing:
 * the response type already carries a failure case, so the renderer gets a
 * localized error it can render rather than an unhandled rejection.
 *
 * `invalidKey` defaults to the generic `ipc.error.invalidPayload`; pass a
 * channel-specific key where the UI has a better message for it.
 */
export function handleOutcome<C extends OutcomeChannel>(
  channel: C,
  schema: ZodType<InvokeRequest<C>>,
  handler: Handler<C>,
  invalidKey: string = INVALID_PAYLOAD_KEY,
): void {
  register(channel, (event, payload) => {
    const parsed = schema.safeParse(payload)
    if (!parsed.success) return fail(invalidKey)
    return handler(parsed.data, event)
  })
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
