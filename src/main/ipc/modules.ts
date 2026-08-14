import { fail } from '@shared/types'
import { moduleInvokeSchema } from '../lib/schemas'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerModulesIpc(app: AppContext): void {
  handle('modules:list', () => app.modules.manifests())

  handle('module:invoke', async (request) => {
    const parsed = moduleInvokeSchema.safeParse(request)
    if (!parsed.success) return fail('ipc.error.invalidPayload')
    return app.modules.invoke(parsed.data)
  })
}
