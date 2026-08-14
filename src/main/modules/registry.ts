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

/**
 * Holds the registered main-process module halves and routes `module:invoke`
 * traffic to them.
 *
 * Handler keys are `${moduleId}/${type}`, so two modules can use the same handler
 * name without colliding, and a module can never answer for another one.
 */
export class MainModuleRegistry {
  private readonly modules = new Map<ModuleId, MainModule>()
  private readonly handlers = new Map<string, ModuleHandler>()

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
        handle: (type, handler) => {
          const key = handlerKey(module.id, type)
          if (this.handlers.has(key)) {
            moduleLog.error(`handler '${type}' registered twice`)
            return
          }
          this.handlers.set(key, handler)
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
    const handler = this.handlers.get(handlerKey(request.moduleId, request.type))
    if (!handler) {
      return fail('modules.error.notImplemented', {
        moduleId: request.moduleId,
        type: request.type,
      })
    }

    try {
      return ok(await handler(request.payload))
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
