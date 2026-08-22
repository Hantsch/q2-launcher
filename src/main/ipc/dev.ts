import { ok } from '@shared/types'
import { devSimulateJobSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle } from './index'

/**
 * Development-only channels. Never registered in a packaged build - see
 * `DEV_ONLY_CHANNELS` in `src/shared/ipc.ts`.
 */
export function registerDevIpc(app: AppContext): void {
  handle('dev:simulateJob', devSimulateJobSchema, () => {
    // Lets the action bar's progress readout be developed before the download
    // module exists. Numbers mirror a real Quake II download.
    const totalBytes = 1_490_000_000
    const totalFiles = 24_512
    let ratio = 0
    let timer: NodeJS.Timeout | null = null

    const job = app.jobs.create({
      moduleId: 'downloads',
      kind: 'download-game',
      labelKey: 'jobs.simulatedDownload',
      playableAtRatio: 0.35,
      cancellable: true,
      onCancel: () => {
        if (timer) clearInterval(timer)
      },
    })

    timer = setInterval(() => {
      ratio = Math.min(1, ratio + 0.008)
      app.jobs.progress(job.id, {
        ratio,
        bytesDone: Math.round(totalBytes * ratio),
        bytesTotal: totalBytes,
        bytesPerSecond: 7_340_032,
        filesRemaining: Math.round(totalFiles * (1 - ratio)),
        etaSeconds: Math.round((1 - ratio) * 180),
      })
      if (ratio >= 1) {
        if (timer) clearInterval(timer)
        app.jobs.finish(job.id, { status: 'succeeded' })
      }
    }, 200)

    return ok(null)
  })
}
