import type { ModuleId, Outcome } from '@shared/types'
import type {
  EventPayload,
  HandlerReq,
  HandlerRes,
  ModuleContract,
  PayloadArgs,
} from '@shared/modules/contract'
import { invoke, onEvent } from '../lib/bridge'

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

/**
 * Subscribes to a module's push notifications through the shell's single
 * `module:event` channel (`ModuleEvent`, `@shared/types`).
 *
 * All module traffic rides this one channel, namespaced by `moduleId` + `type`
 * (mirrors `callModule`'s single-channel request/response side), so a module
 * never needs a new top-level IPC channel of its own to push updates. This
 * function is the plumbing every module's typed client builds its own
 * `on<Thing>Changed`-style wrapper on top of (see `modules/home/client.ts`'s
 * `onNewsChanged`).
 *
 * `listener` fires only for events whose `moduleId` and `type` both match; any
 * other module's traffic on the same channel is filtered out here. Returns an
 * unsubscribe function - calling it stops further delivery to `listener`.
 */
export function onModuleEvent<T = unknown>(
  moduleId: ModuleId,
  type: string,
  listener: (payload: T) => void,
): () => void {
  return onEvent('module:event', (event) => {
    if (event.moduleId !== moduleId || event.type !== type) {
      return
    }
    listener(event.payload as T)
  })
}

/**
 * A module client typed from the module's contract: `call` infers the payload and the
 * `Outcome<Res>` per handler, `on` the event payload. This is the single place the untyped
 * `callModule`/`onModuleEvent` generics are cast; callers never write `callModule<T>` themselves.
 *
 * `call` and `on` are plain closures (no `this`), so they are safe to destructure.
 */
export function createModuleClient<H extends ModuleContract>(id: ModuleId) {
  return {
    call<K extends keyof H['handlers'] & string>(
      type: K,
      ...args: PayloadArgs<HandlerReq<H, K>>
    ): Promise<Outcome<HandlerRes<H, K>>> {
      return callModule<HandlerRes<H, K>>(id, type, args[0])
    },
    on<E extends keyof H['events'] & string>(
      type: E,
      listener: (payload: EventPayload<H, E>) => void,
    ): () => void {
      return onModuleEvent<EventPayload<H, E>>(id, type, listener)
    },
  }
}
