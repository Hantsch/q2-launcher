import type { LocalizedMessage } from './common'

/**
 * What the user can *do* about an update right now (story 098). One field, derived in exactly one
 * place (`resolveUpdatePhase()` in `src/main/services/update/service.ts`), so it can never
 * contradict {@link UpdateState.status}:
 *
 *  - `idle` - nothing known, or the last check said "up to date"; no control is shown at all.
 *  - `checking` - a check is in flight.
 *  - `available` - a release is known and not downloaded. This is also where a *failed* download
 *    lands (098 AC7): nothing was installed, so the update stays offerable, with `error` saying why.
 *  - `downloading` - the release is being fetched; `progress` is non-null.
 *  - `downloaded` - fetched and staged on disk. Nothing is installed and nothing restarts until the
 *    user confirms a second time (AC4).
 *  - `error` - a check failed and nothing is known; `error` carries the reason.
 */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

/**
 * Progress of the update download. Deliberately *not* a `Job` (098 Decisions): a `Job` is
 * installation-scoped module work, and an app-update download must not trip the "a download job is
 * in flight" restart guard it would otherwise create for itself.
 */
export interface UpdateDownloadProgress {
  /** 0..1, or null while the total size is unknown (indeterminate bar). */
  ratio: number | null
  bytesDone: number
  bytesTotal: number | null
  bytesPerSecond: number | null
}

/** State of the update service (electron-updater based). Stories 097 (check) + 098 (act). */
export interface UpdateState {
  /** The outcome of the last *check attempt* (097). The download lifecycle is `phase`. */
  status: 'idle' | 'checking' | 'upToDate' | 'available' | 'error'
  /** Story 098: what the user can do right now - the one field the update control reads. */
  phase: UpdatePhase
  update: { version: string; notes: string; releasedAt: string | null } | null
  error: LocalizedMessage | null
  /** Non-null only while `phase === 'downloading'`. */
  progress: UpdateDownloadProgress | null
  /**
   * Story 098 AC5: the user waved this session's update away. In-memory in main and never
   * persisted - a renderer reload must not resurrect the nag, and a decision scoped to one session
   * has no business outliving it. Only the attention marker goes; the control stays reachable.
   */
  dismissed: boolean
  /** Any completed attempt, success or failure. */
  lastCheckedAt: string | null
  /** Drives the 24h auto-check window (AC4). */
  lastSuccessAt: string | null
  /** `false` in an unpackaged build (AC5). */
  supported: boolean
}

/**
 * Story 098 D4: the scenarios `dev:simulateAppUpdate` can drive through `UpdateService.simulate()`
 * (`src/main/services/update/service.ts`) - offline, dev-only stand-ins for a real check/download,
 * covering every transition D5's e2e flow needs without a real network call:
 *
 *  - `available` - a release becomes known (AC1/AC2).
 *  - `progress` - one download tick, `ratio` in `0..1` (AC3).
 *  - `downloaded` - the download finished and is staged (AC4).
 *  - `error` - the download ended without a staged release, for each of AC7's reasons.
 *  - `upToDate` - the installed version now matches (AC8): the same facts a real "up to date"
 *    check produces, so the control disappears exactly as it would after a real restart.
 */
export type UpdateSimulateScenario =
  | { scenario: 'available'; version: string; notes?: string }
  | { scenario: 'progress'; ratio: number }
  | { scenario: 'downloaded' }
  | { scenario: 'error'; reason: 'offline' | 'checksum' | 'cancelled' }
  | { scenario: 'upToDate' }
