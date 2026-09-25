import type {
  ScanScope,
  ScanServerPush,
  ScanStartResult,
  ServerListRow,
  WatchlistEntry,
  WatchlistMatch,
  WatchlistMatchMode,
  WatchlistSnapshot,
} from '@shared/modules/servers'
import type { ServerPlayer } from '@shared/servers/status-reply'
import { addWatchlistEntry, removeWatchlistEntry, updateWatchlistEntry } from './watchlist-entries'
import { buildWatchlistSnapshot, matchPlainEntry, type WatchlistRosterContext } from './watchlist-matcher'
import type { RegexHost } from './watchlist-regex-host'

/**
 * Story 131 D4: the watchlist service - the one stateful thing this deliverable owns. It is fed
 * one row at a time through `onStage2Row` (wired fire-and-forget from `scan-service.ts`'s Part A
 * hook, story 131 D4), keeps its own in-memory match state (never persisted - rebuilt from the
 * scan's own results, exactly like `scan-service.ts`'s `entries` map), and turns a mutation
 * (`add`/`update`/`remove`/`recheck`) into a fresh `WatchlistSnapshot` push.
 *
 * `rosterMatchesByAddress` is `address -> entryId -> matches at that address` rather than a flat
 * `entryId -> matches` map, so a name seen on two servers at once (AC4) keeps both hits without one
 * server's row overwriting the other's - `buildSnapshot()` flattens across addresses per entry only
 * when it hands the aggregate off to `buildWatchlistSnapshot`.
 *
 * CRITICAL, same rule as `watchlist-entries.ts`/`watchlist-matcher.ts`: a regex entry's pattern is
 * never run with `.test()`/`.exec()` anywhere in this file - every regex match goes through
 * `regexHost.match()` (story 131 D3's worker), and `onStage2Row` never awaits it inline (it kicks
 * the promise off and returns `void` synchronously, same fire-and-forget contract its caller in
 * `scan-service.ts` already relies on).
 */

export type WatchlistServiceMutationResult =
  | { ok: true; snapshot: WatchlistSnapshot }
  | { ok: false; reasonKey: string }

/** The scan-service surface this service needs - just enough to start a single-server recheck
 * round, never the full `ScanService` (this file must not depend on scan-service.ts's own types
 * beyond the shared `ScanStartResult`). */
export interface WatchlistScanHost {
  start: (options: { scope: ScanScope }) => ScanStartResult
}

export interface CreateWatchlistServiceOptions {
  getEntries: () => WatchlistEntry[]
  setEntries: (list: WatchlistEntry[]) => void
  /** The scan's own last-known roster per server - `scanService.read().entries`. Consulted only to
   * re-match a brand new/edited entry for free (D-M); `onStage2Row` never reads this. */
  getKnownServers: () => ServerListRow[]
  scanService: WatchlistScanHost
  regexHost: RegexHost
  /** Fires `SERVERS_EVENTS.watchlistChanged`'s payload - the caller's job to wire to the actual
   * IPC push (a later deliverable), this service only ever calls it with the fresh snapshot. */
  emit: (snapshot: WatchlistSnapshot) => void
  /** Injectable clock, defaulting to `() => new Date().toISOString()` - same seam as
   * `scan-service.ts`'s own `Clock` deps. */
  now?: () => string
}

export interface WatchlistService {
  /** Fed one stage-2 row at a time by `scan-service.ts`'s `onStage2Row` hook. Returns `void`
   * synchronously - any regex match it kicks off resolves later, asynchronously, and emits its own
   * follow-up snapshot when it does. */
  onStage2Row: (row: ScanServerPush) => void
  read: () => WatchlistSnapshot
  add: (input: { name: string; mode: WatchlistMatchMode }) => Promise<WatchlistServiceMutationResult>
  update: (input: {
    id: string
    name: string
    mode: WatchlistMatchMode
  }) => Promise<WatchlistServiceMutationResult>
  remove: (input: { id: string }) => WatchlistServiceMutationResult
  recheck: (input: { id: string }) => ScanStartResult
  dispose: () => void
}

function readHostname(serverinfo: Record<string, string>): string | undefined {
  return typeof serverinfo.hostname === 'string' ? serverinfo.hostname : undefined
}

/** Builds the `WatchlistMatch[]` a regex host's per-name `hits` boolean array implies - the plain
 * equivalent of `matchPlainEntry`, just driven by the worker's own verdict instead of a local
 * string comparison. */
function buildRegexMatches(
  players: readonly ServerPlayer[],
  hits: readonly boolean[],
  context: WatchlistRosterContext,
): WatchlistMatch[] {
  const matches: WatchlistMatch[] = []
  players.forEach((player, index) => {
    if (hits[index] === true) {
      matches.push({
        address: context.address,
        serverName: context.serverName,
        playerName: player.name,
        score: player.score,
        ping: player.ping,
        seenAt: context.seenAt,
      })
    }
  })
  return matches
}

export function createWatchlistService(options: CreateWatchlistServiceOptions): WatchlistService {
  const { getEntries, setEntries, getKnownServers, scanService, regexHost, emit } = options
  const now = options.now ?? (() => new Date().toISOString())

  /** `address -> entryId -> matches found for that entry at that address`. Never persisted. */
  const rosterMatchesByAddress = new Map<string, Map<string, WatchlistMatch[]>>()
  const leftByEntry = new Map<string, { address: string; checkedAt: string }>()
  const recheckByEntry = new Map<string, 'pending' | 'no-reply'>()
  /** `entryId -> address` while a `recheck()` for that entry is in flight - cleared the moment the
   * matching stage-2 row for that address lands (found again, no longer found, or no reply). */
  const pendingRecheckAddress = new Map<string, string>()
  let asOf: string | null = null

  /** `entryId -> generation`. Bumped every time `update()` changes an entry's name/mode, and
   * deleted on `remove()`. A regex job captures the entry's generation at queue time; when it
   * resolves, the callback only applies the result if the entry still exists and its generation is
   * unchanged - otherwise the entry was edited or removed since the job was queued, and the result
   * (a stale verdict for an identity that no longer exists) is silently discarded. */
  const entryGeneration = new Map<string, number>()

  function currentGeneration(entryId: string): number {
    return entryGeneration.get(entryId) ?? 0
  }

  function isStaleGeneration(entryId: string, generation: number): boolean {
    return !getEntries().some((entry) => entry.id === entryId) || currentGeneration(entryId) !== generation
  }

  function setEntryMatches(address: string, entryId: string, matches: WatchlistMatch[]): void {
    let byEntry = rosterMatchesByAddress.get(address)
    if (byEntry === undefined) {
      byEntry = new Map()
      rosterMatchesByAddress.set(address, byEntry)
    }
    byEntry.set(entryId, matches)
  }

  function clearEntryMatches(entryId: string): void {
    for (const byEntry of rosterMatchesByAddress.values()) {
      byEntry.delete(entryId)
    }
  }

  function aggregateMatchesForEntry(entryId: string): WatchlistMatch[] {
    const all: WatchlistMatch[] = []
    for (const byEntry of rosterMatchesByAddress.values()) {
      const matches = byEntry.get(entryId)
      if (matches !== undefined) all.push(...matches)
    }
    return all
  }

  function markEntryTooSlow(entryId: string): void {
    const list = getEntries()
    const index = list.findIndex((entry) => entry.id === entryId)
    if (index === -1 || list[index]!.tooSlow) return
    const next = [...list]
    next[index] = { ...next[index]!, tooSlow: true }
    setEntries(next)
  }

  /** Resolves a pending `recheck()` the moment the row for its address lands - found again (still
   * has a match anywhere) clears the recheck/left state, no longer found marks the entry `'left'`
   * (AC9), and nothing further is queried either way. A no-op unless `entryId`'s pending recheck was
   * actually waiting on `address`. */
  function resolveRecheckIfPending(entryId: string, address: string): void {
    if (pendingRecheckAddress.get(entryId) !== address) return
    pendingRecheckAddress.delete(entryId)
    recheckByEntry.delete(entryId)
    if (aggregateMatchesForEntry(entryId).length > 0) {
      leftByEntry.delete(entryId)
    } else {
      leftByEntry.set(entryId, { address, checkedAt: now() })
    }
  }

  function buildSnapshot(): WatchlistSnapshot {
    const entries = getEntries()
    const matchesByEntry = new Map<string, WatchlistMatch[]>()
    for (const byEntry of rosterMatchesByAddress.values()) {
      for (const [entryId, matches] of byEntry) {
        if (matches.length === 0) continue
        const existing = matchesByEntry.get(entryId) ?? []
        matchesByEntry.set(entryId, [...existing, ...matches])
      }
    }
    return buildWatchlistSnapshot(entries, matchesByEntry, leftByEntry, recheckByEntry, asOf)
  }

  function emitSnapshot(): void {
    emit(buildSnapshot())
  }

  function onStage2Row(row: ScanServerPush): void {
    const address = row.target.address

    if (row.result.ok && row.result.kind === 'status') {
      const nowTs = now()
      asOf = nowTs
      const players = row.result.reply.players
      const context: WatchlistRosterContext = {
        address,
        serverName: readHostname(row.result.reply.serverinfo),
        seenAt: nowTs,
      }

      for (const entry of getEntries()) {
        if (entry.mode !== 'regex') {
          setEntryMatches(address, entry.id, matchPlainEntry(entry, players, context))
          resolveRecheckIfPending(entry.id, address)
          continue
        }
        // Never sent to the host again once flagged too-slow (checked here, against the live
        // entry list, immediately before the only call site in this file).
        if (entry.tooSlow) continue

        const names = players.map((player) => player.name)
        // Captured now, at queue time: if `update()`/`remove()` changes this entry's identity
        // before the job resolves, the callback below must not apply a verdict that belonged to a
        // pattern/mode this entry no longer has (see the `entryGeneration` doc comment above).
        const generation = currentGeneration(entry.id)
        // Fire-and-forget: `onStage2Row` itself must return synchronously without the caller
        // (scan-service.ts's `onServer`) ever needing to await this - see the file doc comment.
        regexHost
          .match(entry.id, entry.name, names)
          .then((outcome) => {
            if (isStaleGeneration(entry.id, generation)) return
            if (outcome.ok) {
              setEntryMatches(address, entry.id, buildRegexMatches(players, outcome.hits, context))
            } else if (outcome.reason === 'too-slow') {
              markEntryTooSlow(entry.id)
            }
            resolveRecheckIfPending(entry.id, address)
            emitSnapshot()
          })
          .catch(() => undefined)
      }

      emitSnapshot()
      return
    }

    // A failed/errored stage2 reply for an address nothing is waiting on is not this service's
    // concern - a plain scan pass's ordinary retries/timeouts never touch watchlist state. Only a
    // pending recheck cares (D-L: silence is not evidence of leaving).
    let changed = false
    for (const [entryId, pendingAddress] of pendingRecheckAddress) {
      if (pendingAddress !== address) continue
      pendingRecheckAddress.delete(entryId)
      recheckByEntry.set(entryId, 'no-reply')
      changed = true
    }
    if (changed) emitSnapshot()
  }

  /** Re-matches a single (new or edited) entry against every already-known roster - zero new
   * queries, the mechanism behind "adding an entry shows a known name immediately" (D-M). Stops
   * early once an entry is found too-slow: there is nothing further worth checking for it. */
  async function rematchEntryAgainstKnownServers(entry: WatchlistEntry): Promise<void> {
    const generation = currentGeneration(entry.id)
    for (const row of getKnownServers()) {
      const players = Array.isArray(row.players) ? row.players : undefined
      if (players === undefined) continue

      const context: WatchlistRosterContext = {
        address: row.address,
        serverName: row.name,
        seenAt: row.lastSeenAt ?? now(),
      }

      if (entry.mode !== 'regex') {
        setEntryMatches(row.address, entry.id, matchPlainEntry(entry, players, context))
        continue
      }
      if (entry.tooSlow) continue

      const names = players.map((player) => player.name)
      // Still never a sync `.test()`/`.exec()` even for a re-match against data already held in
      // memory - every regex evaluation goes through the worker, no exceptions.
      const outcome = await regexHost.match(entry.id, entry.name, names)
      if (isStaleGeneration(entry.id, generation)) return
      if (outcome.ok) {
        setEntryMatches(row.address, entry.id, buildRegexMatches(players, outcome.hits, context))
      } else if (outcome.reason === 'too-slow') {
        markEntryTooSlow(entry.id)
        return
      }
    }
  }

  function read(): WatchlistSnapshot {
    return buildSnapshot()
  }

  async function add(input: {
    name: string
    mode: WatchlistMatchMode
  }): Promise<WatchlistServiceMutationResult> {
    const list = getEntries()
    const result = addWatchlistEntry(list, input)
    if (!result.ok) return result

    setEntries(result.list)
    const entry = result.list[result.list.length - 1] as WatchlistEntry
    await rematchEntryAgainstKnownServers(entry)
    return { ok: true, snapshot: buildSnapshot() }
  }

  async function update(input: {
    id: string
    name: string
    mode: WatchlistMatchMode
  }): Promise<WatchlistServiceMutationResult> {
    const list = getEntries()
    const result = updateWatchlistEntry(list, input)
    if (!result.ok) return result

    setEntries(result.list)
    const entry = result.list.find((candidate) => candidate.id === input.id)
    if (entry !== undefined) {
      // A new name/mode invalidates whatever the old one matched (or left) - never let a stale
      // verdict from before the edit linger under the new identity. Bumping the generation also
      // invalidates any regex job already queued for the pre-edit name/mode (see
      // `entryGeneration`'s doc comment): its eventual resolution is discarded, not applied.
      entryGeneration.set(entry.id, currentGeneration(entry.id) + 1)
      clearEntryMatches(entry.id)
      leftByEntry.delete(entry.id)
      await rematchEntryAgainstKnownServers(entry)
    }
    return { ok: true, snapshot: buildSnapshot() }
  }

  function remove(input: { id: string }): WatchlistServiceMutationResult {
    const list = getEntries()
    const result = removeWatchlistEntry(list, input.id)
    if (!result.ok) return result
    setEntries(result.list)
    clearEntryMatches(input.id)
    leftByEntry.delete(input.id)
    recheckByEntry.delete(input.id)
    pendingRecheckAddress.delete(input.id)
    // Any regex job already queued for this id is now for an entry that no longer exists -
    // `isStaleGeneration` treats a missing entry as stale regardless of the map, but drop the
    // stored generation too so nothing lingers.
    entryGeneration.delete(input.id)
    return { ok: true, snapshot: buildSnapshot() }
  }

  function recheck(input: { id: string }): ScanStartResult {
    const entry = getEntries().find((candidate) => candidate.id === input.id)
    if (entry === undefined) {
      return { ok: false, reasonKey: 'servers.watchlist.error.notFound' }
    }

    const matches = aggregateMatchesForEntry(entry.id)
    if (matches.length === 0) {
      return { ok: false, reasonKey: 'servers.watchlist.error.notFound' }
    }

    // Most recently seen wins; ties keep the first in encounter order (a stable sort over the
    // already-gathered array).
    const mostRecent = [...matches].sort((a, b) => b.seenAt.localeCompare(a.seenAt))[0] as WatchlistMatch

    pendingRecheckAddress.set(entry.id, mostRecent.address)
    recheckByEntry.set(entry.id, 'pending')
    emitSnapshot()

    return scanService.start({ scope: { kind: 'server', address: mostRecent.address } })
  }

  function dispose(): void {
    rosterMatchesByAddress.clear()
    leftByEntry.clear()
    recheckByEntry.clear()
    pendingRecheckAddress.clear()
    entryGeneration.clear()
  }

  return { onStage2Row, read, add, update, remove, recheck, dispose }
}
