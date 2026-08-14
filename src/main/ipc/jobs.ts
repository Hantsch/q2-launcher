import { idSchema } from '../lib/schemas'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerJobsIpc(app: AppContext): void {
  handle('jobs:list', () => app.jobs.list())
  handle('jobs:cancel', (id) => app.jobs.cancel(idSchema.parse(id)))
}
