import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type EventPayload,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
  type LauncherBridge,
} from '@shared/ipc'

/**
 * The only bridge between renderer and main.
 *
 * The renderer runs with `contextIsolation: true`, `sandbox: true` and
 * `nodeIntegration: false`; it can reach exactly the channels listed in
 * `src/shared/ipc.ts` and nothing else. Both allowlists are checked at runtime
 * so a compromised renderer cannot reach arbitrary `ipcRenderer` channels.
 */
const allowedInvoke = new Set<string>(INVOKE_CHANNELS)
const allowedEvents = new Set<string>(EVENT_CHANNELS)

function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeRequest<C> extends void ? [] : [InvokeRequest<C>]
): Promise<InvokeResponse<C>> {
  if (!allowedInvoke.has(channel)) {
    return Promise.reject(new Error(`[preload] blocked invoke on unknown channel: ${channel}`))
  }
  return ipcRenderer.invoke(channel, ...(args as unknown[])) as Promise<InvokeResponse<C>>
}

function on<E extends EventChannel>(
  channel: E,
  listener: (payload: EventPayload<E>) => void,
): () => void {
  if (!allowedEvents.has(channel)) {
    throw new Error(`[preload] blocked subscription on unknown channel: ${channel}`)
  }
  const handler = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload as EventPayload<E>)
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const bridge: LauncherBridge = { invoke, on }

contextBridge.exposeInMainWorld('q2', bridge)
