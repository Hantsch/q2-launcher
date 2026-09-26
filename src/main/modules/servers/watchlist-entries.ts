import { randomUUID } from 'node:crypto'
import { WATCHLIST_NAME_MAX, type WatchlistEntry, type WatchlistMatchMode } from '@shared/modules/servers'

/**
 * Story 131 D2: the watchlist entry collection's three operations, as pure functions over
 * `ServersState['watchlist']` - no I/O, no `AppContext`, mirroring `manual-servers.ts` (story 113
 * D2)'s shape: an injectable `mintId` (defaulting to `randomUUID`) for new ids, and a returned
 * `{ ok: true; list }` / `{ ok: false; reasonKey }` result rather than a thrown error, so a caller
 * never has to distinguish "domain refusal" from "IPC failure".
 *
 * CRITICAL: validation only ever *compiles* a candidate regex (`new RegExp(...)` in a try/catch) -
 * it must never call `.test()`/`.exec()` on any string here. Running a user-supplied regex against
 * any input on main's thread is exactly the ReDoS risk this story exists to avoid; that work is a
 * later deliverable's worker, not this file.
 */

export type WatchlistEntryMutationResult =
  | { ok: true; list: WatchlistEntry[] }
  | { ok: false; reasonKey: string }

/** Validates `name`/`mode` in the fixed order the story specifies: empty, too long, then (for
 * `'regex'` only) whether the pattern compiles at all. Returns `null` when the input is valid. */
function validateNameAndMode(name: string, mode: WatchlistMatchMode): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return 'servers.watchlist.error.empty'
  }
  if (trimmed.length > WATCHLIST_NAME_MAX) {
    return 'servers.watchlist.error.tooLong'
  }
  if (mode === 'regex') {
    try {
      // eslint-disable-next-line no-new -- compiling only, never run against any string here.
      new RegExp(trimmed, 'i')
    } catch {
      return 'servers.watchlist.error.invalidRegex'
    }
  }
  return null
}

/**
 * Adds a new watchlist entry for `name`/`mode` to `list`. Refuses (never persists) on any
 * validation failure (AC per the story's Plan). On success, mints a fresh id via `mintId`
 * (defaulting to `randomUUID`, injectable for tests) and appends a new `tooSlow: false` entry.
 */
export function addWatchlistEntry(
  list: readonly WatchlistEntry[],
  input: { name: string; mode: WatchlistMatchMode },
  mintId: () => string = randomUUID,
): WatchlistEntryMutationResult {
  const reasonKey = validateNameAndMode(input.name, input.mode)
  if (reasonKey !== null) {
    return { ok: false, reasonKey }
  }

  const entry: WatchlistEntry = {
    id: mintId(),
    name: input.name.trim(),
    mode: input.mode,
    tooSlow: false,
  }
  return { ok: true, list: [...list, entry] }
}

/**
 * Updates an existing watchlist entry's `name`/`mode` by `id`. Refuses on the same validation as
 * `addWatchlistEntry`, plus an unknown `id`. On success, `tooSlow` is always cleared back to
 * `false` - a new name/mode invalidates whatever "too slow" verdict the old pattern earned.
 */
export function updateWatchlistEntry(
  list: readonly WatchlistEntry[],
  input: { id: string; name: string; mode: WatchlistMatchMode },
): WatchlistEntryMutationResult {
  const reasonKey = validateNameAndMode(input.name, input.mode)
  if (reasonKey !== null) {
    return { ok: false, reasonKey }
  }

  const index = list.findIndex((entry) => entry.id === input.id)
  if (index === -1) {
    return { ok: false, reasonKey: 'servers.watchlist.error.notFound' }
  }

  const next = [...list]
  next[index] = {
    ...next[index],
    name: input.name.trim(),
    mode: input.mode,
    tooSlow: false,
  }
  return { ok: true, list: next }
}

/**
 * Removes the entry with `id` from `list`. An unknown `id` is a no-op that still succeeds (mirrors
 * `removeManualServer`'s idempotent-remove convention) - the list comes back unchanged either way.
 */
export function removeWatchlistEntry(
  list: readonly WatchlistEntry[],
  id: string,
): WatchlistEntryMutationResult {
  return { ok: true, list: list.filter((entry) => entry.id !== id) }
}
