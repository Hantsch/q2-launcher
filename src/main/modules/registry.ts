import type { ZodType } from 'zod'
import {
  MODULE_MANIFESTS,
  fail,
  ok,
  type ModuleId,
  type ModuleInvokeRequest,
  type ModuleManifest,
  type Outcome,
} from '@shared/types'
import { scopedLogger } from '../lib/logger'
import type { AppContext } from '../context'
import type { MainModule, ModuleHandler } from './types'

const log = scopedLogger('modules')

/** Fallback rejection key, matching the shell's `handleOutcome` wrapper. */
const INVALID_PAYLOAD_KEY = 'ipc.error.invalidPayload'

/**
 * A handler plus the schema it was registered with. The pair is stored together
 * because the map has to forget the handler's payload type to hold handlers from
 * different modules - `invoke()` re-establishes the link by parsing with this
 * entry's own schema before calling this entry's handler.
 */
interface RegisteredHandler {
  handler: ModuleHandler
  schema: ZodType<unknown>
}

/**
 * Holds the registered main-process module halves and routes `module:invoke`
 * traffic to them.
 *
 * Handler keys are `${moduleId}/${type}`, so two modules can use the same handler
 * name without colliding, and a module can never answer for another one.
 */
export class MainModuleRegistry {
  private readonly modules = new Map<ModuleId, MainModule>()
  private readonly handlers = new Map<string, RegisteredHandler>()

  manifests(): ModuleManifest[] {
    // Registration reality wins over the declared status: a module whose
    // main half is missing is reported as `planned`, whatever the manifest says.
    return MODULE_MANIFESTS.map((manifest) => ({
      ...manifest,
      status: this.modules.has(manifest.id) ? manifest.status : 'planned',
    }))
  }

  registered(): ModuleId[] {
    return [...this.modules.keys()]
  }

  async register(module: MainModule, app: AppContext): Promise<void> {
    const manifest = MODULE_MANIFESTS.find((entry) => entry.id === module.id)
    if (!manifest) {
      log.error(`refusing to register module '${module.id}': no manifest in shared/types/module.ts`)
      return
    }
    if (this.modules.has(module.id)) {
      log.error(`module '${module.id}' is already registered`)
      return
    }

    const moduleLog = scopedLogger(`module:${module.id}`)

    try {
      await module.setup({
        app,
        log: moduleLog,
        handle: (type, schema, handler) => {
          const key = handlerKey(module.id, type)
          if (this.handlers.has(key)) {
            moduleLog.error(`handler '${type}' registered twice`)
            return
          }
          // The two casts drop the payload type `handle` inferred at the call
          // site; it is only needed there, to check `schema` against `handler`.
          // `invoke()` never mixes entries, so what it feeds the handler is
          // always what this schema produced.
          this.handlers.set(key, {
            handler: handler as ModuleHandler,
            schema: schema as ZodType<unknown>,
          })
        },
        emit: (type, payload) => {
          app.broadcast.emit('module:event', { moduleId: module.id, type, payload })
        },
      })
    } catch (error) {
      log.error(`module '${module.id}' failed to set up`, error)
      return
    }

    this.modules.set(module.id, module)
    log.info(`registered module '${module.id}'`)
  }

  async invoke(request: ModuleInvokeRequest): Promise<Outcome<unknown>> {
    const entry = this.handlers.get(handlerKey(request.moduleId, request.type))
    if (!entry) {
      return fail('modules.error.notImplemented', {
        moduleId: request.moduleId,
        type: request.type,
      })
    }

    // Validation happens here, once, before the handler is entered - a module
    // handler cannot be reached with a payload its schema rejects. Like the
    // shell's `handleOutcome`, a bad payload becomes a failed outcome the
    // renderer can render rather than a rejected promise.
    const parsed = entry.schema.safeParse(request.payload)
    if (!parsed.success) {
      log.error(
        `module '${request.moduleId}' handler '${request.type}' rejected an invalid payload`,
      )
      return fail(INVALID_PAYLOAD_KEY)
    }

    try {
      return ok(await entry.handler(parsed.data))
    } catch (error) {
      log.error(`module '${request.moduleId}' handler '${request.type}' threw`, error)
      return fail('modules.error.handlerFailed', {
        moduleId: request.moduleId,
        type: request.type,
      })
    }
  }

  async disposeAll(): Promise<void> {
    for (const module of this.modules.values()) {
      try {
        await module.dispose?.()
      } catch (error) {
        log.error(`module '${module.id}' failed to dispose`, error)
      }
    }
    this.modules.clear()
    this.handlers.clear()
  }
}

function handlerKey(moduleId: ModuleId, type: string): string {
  return `${moduleId}/${type}`
}
