import { ok } from '@shared/types'
import { devSimulateJobSchema, devSimulateLaunchSchema } from '@shared/ipc-schemas'
import { isWriteCancelled } from '../services/write-guard'
import type { AppContext } from '../context'
import { handle } from './index'
import { scopedLogger } from '../lib/logger'

const log = scopedLogger('dev-ipc')

/**
 * Development-only channels. Never registered in a packaged build - see
 * `DEV_ONLY_CHANNELS` in `src/shared/ipc.ts`.
 */
export function registerDevIpc(app: AppContext): void {
  handle('dev:simulateJob', devSimulateJobSchema, (payload) => {
    const { scenario } = payload

    if (scenario === 'writing') {
      // Story 091 D7: creates a job that acquires the *real* `InstallationWriteGuard`
      // lock for `installationId` and holds it until cancelled - AC5's Play-button
      // refusal (`launch.error.installationBusy`) has to be exercised through the
      // real guard, not faked, or the e2e flow would prove nothing.
      const { installationId } = payload
      const cancellation = new AbortController()

      const job = app.jobs.create({
        moduleId: 'downloads',
        kind: 'dev-simulated-write',
        labelKey: 'jobs.simulatedWrite',
        installationId,
        cancellable: true,
        onCancel: () => {
          cancellation.abort()
        },
      })

      // Never resolves on its own - it only settles once `onCancel` aborts the
      // signal, same "holds forever until cancelled" contract as the `stall`
      // scenario below, but for the write phase instead of progress.
      const holdUntilCancelled = (): Promise<void> =>
        new Promise((resolve) => {
          if (cancellation.signal.aborted) {
            resolve()
            return
          }
          cancellation.signal.addEventListener('abort', () => resolve(), { once: true })
        })

      app.writeGuard
        .runWrite(installationId, job.id, cancellation.signal, holdUntilCancelled)
        .catch((error: unknown) => {
          // `JobsService.cancel()` already finishes the job as `cancelled` before
          // this rejection is even observed here - nothing more to do for the
          // expected abort-while-waiting path. Anything else is a real bug.
          if (!isWriteCancelled(error)) {
            log.error(`dev:simulateJob 'writing' scenario failed for job ${job.id}`, error)
          }
        })

      return ok(null)
    }

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

  // Story 090 D5: lets the e2e flow put one installation into `running`/`idle`
  // through a real IPC surface - see `devSimulateLaunchSchema` and
  // `LaunchService.simulate` for why this exists instead of a real launch.
  handle('dev:simulateLaunch', devSimulateLaunchSchema, ({ installationId, phase }) => {
    app.launch.simulate(phase, installationId)
    return ok(null)
  })
}
