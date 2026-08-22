import { idSchema, jobsListSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle, handleOutcome } from './index'

export function registerJobsIpc(app: AppContext): void {
  handle('jobs:list', jobsListSchema, () => app.jobs.list())
  handleOutcome('jobs:cancel', idSchema, (id) => app.jobs.cancel(id))
}
