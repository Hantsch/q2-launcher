import { moduleInvokeSchema, modulesListSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle, handleOutcome } from './index'

export function registerModulesIpc(app: AppContext): void {
  handle('modules:list', modulesListSchema, () => app.modules.manifests())

  handleOutcome('module:invoke', moduleInvokeSchema, async (request) => {
    return app.modules.invoke(request)
  })
}
