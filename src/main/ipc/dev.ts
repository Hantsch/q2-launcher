import { ok } from '@shared/types'
import { devSimulateJobSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle } from './index'

/**
 * Development-only channels. Never registered in a packaged build - see
 * `DEV_ONLY_CHANNELS` in `src/shared/ipc.ts`.
 */
export function registerDevIpc(app: AppContext): void {
  handle('dev:simulateJob', devSimulateJobSchema, ({ scenario }) => {
    // Lets the action bar's progress readout and the Downloads tab (story 073) be
    // developed before the download module produces real jobs. Numbers mirror a
    // real Quake II download.
    const totalBytes = 1_490_000_000
    const totalFiles = 24_512

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

    if (scenario === 'failure') {
      // Finishes immediately - the Downloads tab's failure log is what this
      // scenario exists to exercise, not a progress bar.
      app.jobs.finish(job.id, {
        status: 'failed',
        error: { key: 'downloads.error.network' },
      })
      return ok(null)
    }

    if (scenario === 'stall') {
      // Held at ~40% with believable, non-zero bytes/speed/ETA fields - a real
      // running job frozen partway, not a queued job with nothing to show. Never
      // finishes on its own; the dev panel's job list is how it goes away
      // (cancel), same as any other running job.
      const ratio = 0.4
      app.jobs.progress(job.id, {
        ratio,
        bytesDone: Math.round(totalBytes * ratio),
        bytesTotal: totalBytes,
        bytesPerSecond: 7_340_032,
        filesRemaining: Math.round(totalFiles * (1 - ratio)),
        etaSeconds: Math.round((1 - ratio) * 180),
      })
      return ok(null)
    }

    // scenario === 'success': the pre-D5 behaviour, unchanged - progresses to
    // completion on a timer, then finishes `succeeded`.
    let ratio = 0

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
