import type { DriveInfo } from '@shared/ipc'
import { idSchema, scanOptionsSchema } from '../lib/schemas'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerDetectionIpc(app: AppContext): void {
  handle('detection:scan', (options) => app.detection.scan(scanOptionsSchema.parse(options)))

  handle('detection:cancel', (scanId) => {
    app.detection.cancel(idSchema.parse(scanId))
  })

  handle('detection:listDrives', async (): Promise<DriveInfo[]> => {
    const drives = await app.detection.listDrives()
    return drives.map((path) => ({ path }))
  })
}
