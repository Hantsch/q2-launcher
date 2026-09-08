import { randomUUID } from 'node:crypto'
import type { DownloadFailure } from '@shared/modules/downloads'

/**
 * Story 073 D1: the failure log's pure rules (AC2). No I/O, no electron - `main/services/state.ts`
 * is the only caller that touches disk, and it applies `pruneFailures` both when it reads the
 * persisted list back (`getDownloadFailures`) and again on every write these functions produce
 * (append/dismiss/restore), so a list loaded from an old `state.json` is pruned exactly once per
 * access rather than only at the moment it happens to be saved.
 */

/** The list is capped at this many newest-first entries (Decisions (Sprint)), so a retry loop
 * cannot grow `state.json` without bound. */
export const FAILURE_LOG_CAP = 50

/** A dismissed entry older than this is pruned; an undismissed one is never pruned regardless of
 * age (Decisions (Sprint), AC2). */
export const FAILURE_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export type NewDownloadFailure = Omit<DownloadFailure, 'id' | 'createdAt' | 'dismissedAt'>

/**
 * Drops every entry whose `dismissedAt` is older than `FAILURE_LOG_RETENTION_MS` relative to `now`.
 * An entry with no `dismissedAt` (never dismissed) is left untouched no matter how old `createdAt`
 * is - that is what "persists until the user dismisses it" (AC2) means.
 */
export function pruneFailures(log: readonly DownloadFailure[], now: number): DownloadFailure[] {
  return log.filter((entry) => {
    if (entry.dismissedAt === undefined) return true
    return now - entry.dismissedAt <= FAILURE_LOG_RETENTION_MS
  })
}

/**
 * Appends a new entry (a fresh id, `createdAt` set to `now`) to the front of the list - the log is
 * newest-first, so a fresh entry is always index 0. Prunes first (a stale dismissed entry should
 * not count against the cap) and caps the result at `FAILURE_LOG_CAP`, dropping the oldest entries
 * first since ordering is already newest-first.
 */
export function appendFailure(
  log: readonly DownloadFailure[],
  entry: NewDownloadFailure,
  now: number = Date.now(),
): DownloadFailure[] {
  const fresh: DownloadFailure = { ...entry, id: randomUUID(), createdAt: now }
  const combined = [fresh, ...pruneFailures(log, now)]
  return combined.slice(0, FAILURE_LOG_CAP)
}

/**
 * Marks the entry named by `id` dismissed as of `now`, moving it into the 7-day recoverable
 * history. A missing `id` is a no-op - the list comes back unchanged (same convention as the
 * config module's other id-addressed setters).
 */
export function dismissFailure(
  log: readonly DownloadFailure[],
  id: string,
  now: number = Date.now(),
): DownloadFailure[] {
  const updated = log.map((entry) => (entry.id === id ? { ...entry, dismissedAt: now } : entry))
  return pruneFailures(updated, now)
}

/**
 * Clears `dismissedAt` on the entry named by `id`, bringing it back out of the dismissed history.
 * A missing `id` is a no-op.
 */
export function restoreFailure(
  log: readonly DownloadFailure[],
  id: string,
  now: number = Date.now(),
): DownloadFailure[] {
  const updated = log.map((entry) => {
    if (entry.id !== id) return entry
    const { dismissedAt: _dismissedAt, ...rest } = entry
    return rest
  })
  return pruneFailures(updated, now)
}
