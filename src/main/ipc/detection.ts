import type { DriveInfo } from '@shared/ipc'
import { detectionListDrivesSchema, idSchema, scanOptionsSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerDetectionIpc(app: AppContext): void {
  handle('detection:scan', scanOptionsSchema, (options) => app.detection.scan(options))

  handle('detection:cancel', idSchema, (scanId) => {
    app.detection.cancel(scanId)
  })

  handle('detection:listDrives', detectionListDrivesSchema, async (): Promise<DriveInfo[]> => {
    const drives = await app.detection.listDrives()
    return drives.map((path) => ({ path }))
  })
}
