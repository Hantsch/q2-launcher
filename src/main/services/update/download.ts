import type { Outcome, UpdateState } from '@shared/types'
import { fail, isJobActive, ok } from '@shared/types'
import type { UpdateChecks } from './check'
import {
  APP_UPDATE_REFUSAL_KEYS,
  updateDownloadErrorKey,
  type UpdateDownloadOutcome,
  type UpdateServiceLog,
  type UpdateServiceOptions,
} from './service'
import { describeError, type UpdateFacts, type UpdateStateCell } from './state'

/**
 * The four staged actions of story 098 - download, cancel, restart-and-install, dismiss. Only a
 * user does any of them; nothing in here runs on its own.
 */
export class UpdateDownloads {
  private readonly cell: UpdateStateCell
  private readonly checks: Pick<UpdateChecks, 'ensureRestored' | 'persist'>
  private readonly options: UpdateServiceOptions
  private readonly now: () => Date
  private readonly log: UpdateServiceLog | undefined

  constructor(
    cell: UpdateStateCell,
    checks: Pick<UpdateChecks, 'ensureRestored' | 'persist'>,
    options: UpdateServiceOptions,
    now: () => Date,
  ) {
    this.cell = cell
    this.checks = checks
    this.options = options
    this.now = now
    this.log = options.log
    // Story 098, belt: off from the moment the service exists, not only once a download starts,
    // so a release staged by a *previous* session's `electron-updater` cannot install itself on this
    // session's next quit either.
    options.backend.autoInstallOnAppQuit = false
  }

  /**
   * Runs one download to completion and writes the single state change it produces. The *only*
   * writer of `stage`/`progress` once a download is under way - `cancelDownload()` deliberately
   * does not write the "back to available" state itself, so there is exactly one place that can
   * decide how a download ended.
   */
  private async runDownload(generation: number): Promise<void> {
    const cell = this.cell
    let outcome: UpdateDownloadOutcome
    try {
      outcome = await this.options.backend.download((next) => {
        // A callback from a superseded download, or one arriving after this one ended, is dropped
        // rather than published - progress from a download nobody is waiting on is noise.
        if (generation !== cell.downloadGeneration || cell.stage !== 'downloading') return
        cell.progress = next
        cell.publish()
      })
    } catch (error) {
      this.log?.warn(`update: the download failed (${describeError(error)})`)
      outcome = { ok: false, reason: 'unknown' }
    }

    if (generation !== cell.downloadGeneration) return

    cell.progress = null

    if (!outcome.ok && outcome.reason === 'upToDate') {
      // The known release turned out to be stale - typically the very build now running, carried
      // over from the check the previous version made. That is a successful check saying "up to
      // date", so it is recorded as one instead of offering a download that can never succeed.
      cell.stage = 'none'
      const completedAt = this.now().toISOString()
      const next: UpdateFacts = {
        status: 'upToDate',
        update: null,
        error: null,
        lastCheckedAt: completedAt,
        lastSuccessAt: completedAt,
        supported: cell.supported,
      }
      cell.emit(next)
      await this.checks.persist(next)
      return
    }

    if (outcome.ok) {
      // It finished, so it finished - even if a cancel was requested just too late. Nothing is
      // installed by this: `phase: 'downloaded'` only *offers* the restart.
      cell.stage = 'downloaded'
      cell.emit({ ...cell.facts, error: null })
      return
    }

    // nothing was installed and nothing on disk changed, so the update stays offerable -
    // `resolveUpdatePhase` puts a known release back at `available` on its own, and the reason
    // rides along in `error`.
    cell.stage = 'none'
    const reason = cell.cancelRequested ? 'cancelled' : outcome.reason
    this.log?.warn(`update: the download ended without a staged release (${reason})`)
    cell.emit({ ...cell.facts, error: { key: updateDownloadErrorKey(reason) } })
  }

  async startDownload(): Promise<Outcome<UpdateState>> {
    const cell = this.cell
    await this.checks.ensureRestored()
    if (!cell.supported || cell.facts.update === null) {
      return fail(APP_UPDATE_REFUSAL_KEYS.notAvailable)
    }
    // Already running or already staged: report where we are instead of starting a second fetch of
    // the same release.
    if (cell.stage !== 'none') return ok(cell.state)

    // Braces to the constructor's belt: `electron-updater` arms its install-on-quit handler
    // when a download *completes*, so this is the last moment the flag can be turned off.
    this.options.backend.autoInstallOnAppQuit = false

    cell.downloadGeneration += 1
    cell.cancelRequested = false
    cell.stage = 'downloading'
    cell.progress = { ratio: null, bytesDone: 0, bytesTotal: null, bytesPerSecond: null }
    // Clears a previous attempt's failure reason, and publishes the `downloading` phase.
    cell.emit({ ...cell.facts, error: null })

    // Deliberately not awaited: the launcher stays fully usable while this runs, and every
    // later state change arrives through `onStateChange`. `runDownload` cannot reject.
    void this.runDownload(cell.downloadGeneration).catch((error: unknown) => {
      this.log?.warn(`update: the download ended unexpectedly (${describeError(error)})`)
    })

    return ok(cell.state)
  }

  cancelDownload(): Outcome<UpdateState> {
    if (this.cell.stage !== 'downloading') return ok(this.cell.state)
    this.cell.cancelRequested = true
    try {
      this.options.backend.cancelDownload()
    } catch (error) {
      // A backend that cannot be cancelled is not a failure the user can act on; the download
      // either finishes or fails, and both are handled above.
      this.log?.warn(`update: the download could not be cancelled (${describeError(error)})`)
    }
    return ok(this.cell.state)
  }

  async installAndRestart(): Promise<Outcome<null>> {
    await this.checks.ensureRestored()

    // nothing is installed until there is something staged to install. Deliberately not also
    // gated on `supported`: `simulate()` (story 098) legitimately drives `stage` to `'downloaded'` on an
    // unpackaged build so the game/job guards below can be proven for real without a packaged
    // install - `download()` already refuses `!supported` on the real path, so `stage` cannot
    // reach `'downloaded'` there without simulation, and `checker.ts`'s `quitAndInstall()` still
    // throws on an unresolved updater as the last line of defence.
    if (this.cell.stage !== 'downloaded') return fail(APP_UPDATE_REFUSAL_KEYS.notReady)

    // Both guards *read* live state that main already tracks and return before anything is
    // touched - the game keeps running, the job keeps running, and the staged update stays staged
    // so the user can come back to it. Nothing here cancels, kills or quits.
    if (this.options.isGameRunning()) {
      this.log?.warn('update: refused to restart - a game started by this launcher is running')
      return fail(APP_UPDATE_REFUSAL_KEYS.gameRunning)
    }
    if (this.options.listJobs().some(isJobActive)) {
      this.log?.warn('update: refused to restart - a job is in flight')
      return fail(APP_UPDATE_REFUSAL_KEYS.jobActive)
    }

    try {
      this.options.backend.quitAndInstall()
    } catch (error) {
      this.log?.warn(`update: quitAndInstall() failed (${describeError(error)})`)
      return fail(APP_UPDATE_REFUSAL_KEYS.installFailed)
    }
    return ok(null)
  }

  dismiss(): Outcome<UpdateState> {
    this.cell.dismissed = true
    this.cell.publish()
    return ok(this.cell.state)
  }
}
