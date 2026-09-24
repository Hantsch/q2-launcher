import type { ServerHistoryEntry } from '@shared/modules/servers'
import { SERVER_HISTORY_CAP } from '@shared/modules/servers'

/**
 * Story 113 D3: the connection history's pure rules (mirrors
 * `main/modules/downloads/failure-log.ts` - no I/O, no electron, plain-array-in/plain-array-out).
 * `entry.address` is already a normalized address string by the time it reaches this module; the
 * manual-servers store (a different deliverable) owns validating/normalizing raw user input, not
 * this one.
 */

/**
 * Records a visit to `entry.address`. Dedupes by address (D-E): if the address already exists
 * anywhere in `log`, its old row is dropped rather than kept alongside the new one. The
 * fresh/updated entry is then prepended (`[fresh, ...rest]`), so the result is always newest-first,
 * and capped at `SERVER_HISTORY_CAP`, oldest (tail) evicted first (AC3).
 */
export function recordServerVisit(
  log: readonly ServerHistoryEntry[],
  entry: { address: string; connectedAt?: string },
): ServerHistoryEntry[] {
  const fresh: ServerHistoryEntry = {
    address: entry.address,
    connectedAt: entry.connectedAt ?? new Date().toISOString(),
  }
  const rest = log.filter((row) => row.address !== entry.address)
  const combined = [fresh, ...rest]
  return combined.slice(0, SERVER_HISTORY_CAP)
}

/**
 * Reads the history back in most-recent-first order (AC4). `recordServerVisit` already always
 * maintains that order, so this is a copy of `log` as-is - the explicit function (rather than
 * callers reading `log` directly) is what documents the ordering guarantee.
 */
export function readServerHistory(log: readonly ServerHistoryEntry[]): ServerHistoryEntry[] {
  return [...log]
}

/**
 * Caps an arbitrary/foreign log (e.g. a hand-edited `state.json` with more than
 * `SERVER_HISTORY_CAP` rows) down to the cap. Assumes `log` is already in the order it should be
 * kept - most-recent-first, same as `recordServerVisit` produces - and only truncates the tail; it
 * does not re-sort by `connectedAt` or otherwise reorder.
 */
export function capServerHistory(log: readonly ServerHistoryEntry[]): ServerHistoryEntry[] {
  return log.slice(0, SERVER_HISTORY_CAP)
}
