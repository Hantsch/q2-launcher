import {
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  SERVERS_EVENTS,
  type ScanBlockedReason,
  type ScanScope,
  type ScanSnapshot,
  type ScanStartResult,
  type ScanTarget,
  type ServerListEntry,
  type ServersOverview,
  type ServersScanState,
  type ServersState,
} from '@shared/modules/servers'
import type { ParsedServerAddress } from '@shared/servers/address'
import { readIntKey } from '@shared/servers/infostring'
import { deriveGamemode } from '@shared/servers/row-markers'
import type { LaunchHost } from '../../services/write-guard'
import { electronNetFetch, type FetchImpl } from '../downloads/fetcher'
import { isScanBlocked } from './scan-guard'
import { mergeStaleRound } from './scan-merge'
import { resolveScanScopeAddresses } from './scan-scope'
import { resolveSources, type ResolveSourcesDeps } from './source-resolution'
import { runScan, type QueryServerFn } from './scan-runner'
import type { ServerQueryResult } from './server-query'
import type { Clock, MasterUdpImpl } from './udp-master-source'

/**
 * Story 114 D6: the scan service - the one stateful thing this module owns. Everything upstream
 * of this file (D2-D5) is pure or purely transport; this is where "a scan" becomes a thing with a
 * lifetime, a single-flight rule, and a memory that survives past any one sweep.
 *
 * - **D-L, single-flight.** `start()` is synchronous and answers immediately: a refusal when a
 *   scan is already running, or `{ ok: true }` once the new scan's state has been reset and its
 *   `scan.changed` emitted - the sweep itself (`runSweep`) is fired with `void` and continues in the
 *   background. There is never a queue: a second `start()` while one is running does not schedule
 *   anything, it just says no.
 * - **D-J/D-K, the last-known map.** `entries` is a plain in-memory `Map`, never touched by
 *   `state.json` - it is rebuilt from nothing every process lifetime. A row is only ever added or
 *   refreshed by a successful (`ok: true`) reply; a failed reply for an address already in the map
 *   leaves that entry exactly as it was (never zeroed, never removed). At the end of a sweep, every
 *   target this round's address set named but that never produced a successful reply keeps its old
 *   entry with `status` flipped to `'stale'` - an address with no previous entry and no reply this
 *   round simply never gets a row.
 * - **D-D, `read()`.** A synchronous getter over the live state and the current entry map - no
 *   polling anywhere in this file, so a renderer that mounts mid-scan just asks once.
 * - **`overview()`.** Feeds `servers` module's `overview.read` handler (index.ts) with the three
 *   numbers that used to be hardcoded. `lastScanAt` is tracked as its own field, separate from
 *   `ServersScanState.finishedAt` - the latter is documented (shared/modules/servers.ts) to go back
 *   to `null` the moment a new scan starts, which is correct for the live scan state but wrong for
 *   "when did a scan last actually finish": that question should keep answering with the previous
 *   scan's timestamp for as long as the next one is still running, not flash back to "never".
 * - **Story 116 D3, the game-running guard.** `start()` refuses with
 *   `SCAN_BLOCKED_GAME_RUNNING_REASON_KEY` while `isScanBlocked(launch.getState())` - checked ahead
 *   of the single-flight rule, and the *only* extra condition on the manual path (D-Q). The launch
 *   state is always read live at call time, never cached, so the refusal cannot depend on the order
 *   in which `onStateChange` listeners run. `blockedReason` is a reactive mirror of that same
 *   predicate: set at construction and on every launch state change, so the view can show the
 *   reason (and disable its refresh control) for the whole session, and it clears the moment the
 *   session ends (AC4) without any scan attempt being needed first. An automatic trigger never
 *   reaches `start()` while blocked (scan-cadence.ts skips it with `'game-running'`), which is why
 *   the mirror - not a refusal - is what publishes the reason for AC1's skipped round.
 * - **Story 117 D3, scoped rounds.** `start()` takes an optional `ScanScope` (default `'all'`, so
 *   every automatic trigger and "Refresh servers" are literally the same run). A scope only narrows
 *   the address set; the guard, single-flight, `runScan` and `mergeStaleRound` are the same calls for
 *   every scope - there is no second scan path. Two address sets exist per round and must not be
 *   confused: `runTargets` (what stage 1 queries) and `scopeTargets` (the scope's real address set,
 *   the only addresses `mergeStaleRound` may stale-flip). They are identical for `'all'` and
 *   `'favourites'`; for `'server'` stage 1 gets no targets and the address rides in as runScan's
 *   `selectedAddress` - exactly one `status` query, no `info` query - while `scopeTargets` still names
 *   it, so a timed-out single-server refresh flips that row stale like any other unanswered target.
 *   An address outside `scopeTargets` is never queried, rewritten or staled by a scoped round.
 *   Source resolution only runs for `'all'`; the other scopes never use source addresses, so they
 *   make no master/list request and report no `sourceFailures`.
 */

/** Injectable seams for both `resolveSources` and `runScan`, all optional - each defaults to the
 * real implementation the same way `ResolveSourcesDeps`/`ScanRunnerDeps` already do. Bundled into
 * one options bag here because the service is the one place that needs both at once. */
export interface ScanServiceDeps {
  fetchImpl?: FetchImpl
  udpImpl?: MasterUdpImpl
  clock?: Clock
  queryServer?: QueryServerFn
}

export interface CreateScanServiceOptions {
  /** Reads the current `ServersState` fresh at call time - sources/favourites/manual servers can
   * change between scans, so this must never be a snapshot captured once at `setup()` time. */
  getServersState: () => ServersState
  emit: (type: string, payload: unknown) => void
  /** Story 116 D3 (D-E): the structural launch seam, never `LaunchService` itself. */
  launch: LaunchHost
  deps?: ScanServiceDeps
}

export interface ScanStartOptions {
  /** Which addresses this round touches (story 117). Omitted means `{ kind: 'all' }`. */
  scope?: ScanScope
  /** Story 114's "currently selected server", queried in stage 2 of a full scan. Only honoured for
   * the `'all'` scope - `'favourites'` ignores it, `'server'` already names its one address. */
  selectedAddress?: string
}

export interface ScanService {
  start: (options?: ScanStartOptions) => ScanStartResult
  read: () => ScanSnapshot
  overview: () => ServersOverview
  dispose: () => void
}

/** D-L's refusal reason, in the same `servers.<namespace>.error.<reason>` key convention
 * `masterSourceFailureKey`/`serverAddressRejectionKey` already use - matching `en.json` entry added
 * alongside this deliverable under `servers.scan.error.already-running`. */
export const SCAN_ALREADY_RUNNING_REASON_KEY = 'servers.scan.error.already-running'

function initialScanState(): ServersScanState {
  return {
    running: false,
    phase: 'idle',
    stage1Done: 0,
    stage1Total: 0,
    stage2Done: 0,
    stage2Total: 0,
    sourceFailures: [],
    startedAt: null,
    finishedAt: null,
    blockedReason: null,
    scope: null,
  }
}

/** The well-known `serverinfo` keys this module reads out of a reply's raw record, shared by both
 * stages - both an `info` and a `status` reply carry the same serverinfo line, so there is exactly
 * one place that reads `hostname`/`mapname`/`gamename`/`maxclients`/`needpass` off it. A field
 * absent from *this* reply falls back to the entry's previous value (`existing`) rather than
 * clobbering already-known data with `undefined` - a reply is never required to repeat everything
 * a previous one already established. */
function readServerInfoFields(
  serverinfo: Record<string, string>,
  existing: ServerListEntry | undefined,
): Pick<ServerListEntry, 'name' | 'map' | 'mod' | 'maxclients' | 'needpass' | 'gamemode'> {
  const hostname = typeof serverinfo.hostname === 'string' ? serverinfo.hostname : undefined
  const map = typeof serverinfo.mapname === 'string' ? serverinfo.mapname : undefined
  const mod = typeof serverinfo.gamename === 'string' && serverinfo.gamename !== '' ? serverinfo.gamename : undefined
  const maxclients = readIntKey(serverinfo, 'maxclients')
  // Story S25 D2: bit 0 of `needpass` is the password flag (3 -> true, 2 -> false); an absent key
  // keeps whatever the entry previously knew rather than clobbering it with `undefined`.
  const n = readIntKey(serverinfo, 'needpass')
  const needpass = n === undefined ? existing?.needpass : (n & 1) === 1

  return {
    name: hostname ?? existing?.name,
    map: map ?? existing?.map,
    mod: mod ?? existing?.mod,
    maxclients: maxclients ?? existing?.maxclients,
    needpass,
    gamemode: deriveGamemode(serverinfo) ?? existing?.gamemode,
  }
}

/** Builds the refreshed `ServerListEntry` for one successful reply. `players` is the numeric count
 * while only `info` has answered, and is replaced by the full roster the moment a `status` reply
 * lands (same field, never two) - see `ServerListEntry`'s own doc comment. */
function mergeSuccessfulReply(
  existing: ServerListEntry | undefined,
  target: ScanTarget,
  result: Extract<ServerQueryResult, { ok: true }>,
  now: string,
): ServerListEntry {
  const fields = readServerInfoFields(result.reply.serverinfo, existing)
  const players = result.kind === 'status' ? result.reply.players : result.reply.clients ?? existing?.players

  return {
    address: target.address,
    origins: target.origins,
    status: 'online',
    ...fields,
    rttMs: result.rttMs,
    players,
    lastSeenAt: now,
  }
}

export function createScanService(options: CreateScanServiceOptions): ScanService {
  const { getServersState, emit, launch } = options
  const deps = options.deps ?? {}

  const blockedReasonFor = (blocked: boolean): ScanBlockedReason | null => (blocked ? 'game-running' : null)

  const entries = new Map<string, ServerListEntry>()
  let scanState: ServersScanState = {
    ...initialScanState(),
    blockedReason: blockedReasonFor(isScanBlocked(launch.getState())),
  }
  let lastScanAt: string | null = null
  let abortController: AbortController | null = null

  const emitChanged = (): void => emit(SERVERS_EVENTS.scanChanged, { ...scanState })

  /** Keeps `blockedReason` in step with the live launch state; pushes only on a real change. */
  function syncBlockedReason(blocked: boolean): void {
    const next = blockedReasonFor(blocked)
    if (scanState.blockedReason === next) return
    scanState = { ...scanState, blockedReason: next }
    emitChanged()
  }

  const unsubscribeLaunch = launch.onStateChange((state) => syncBlockedReason(isScanBlocked(state)))

  async function runSweep(scope: ScanScope, selectedAddress: string | undefined, signal: AbortSignal): Promise<void> {
    try {
      // Review fix (story 114): reading the current state and building `resolveDeps` now happens
      // *inside* the try - previously it ran before the try block, so a throwing `getServersState()`
      // would skip `finally` below entirely and leave `running: true` stuck forever (D-L's
      // single-flight guard would then refuse every future `scan.start` for the rest of the
      // process's life).
      const current = getServersState()

      // Story 117 D3: only the 'all' scope uses source addresses, so only it resolves sources -
      // a favourites/single-server refresh never touches a master or list source's network, and
      // keeps the `sourceFailures: []` `start()` already reset it to.
      let resolvedSourceAddresses: ParsedServerAddress[] = []
      if (scope.kind === 'all') {
        const resolveDeps: ResolveSourcesDeps = {
          fetchImpl: deps.fetchImpl ?? electronNetFetch,
          udpImpl: deps.udpImpl,
          clock: deps.clock,
          signal,
        }

        const resolved = await resolveSources(current.sources, resolveDeps)
        scanState = { ...scanState, sourceFailures: resolved.failures }
        emitChanged()
        resolvedSourceAddresses = resolved.addresses
      }

      // `scopeTargets` is the scope's real address set - the ONLY addresses `mergeStaleRound` below
      // may stale-flip. `runTargets` is what stage 1 queries: the same set, except for the
      // single-server scope, which skips stage 1 entirely and reaches runScan's stage 2 through
      // `selectedAddress` instead (one `status` query, no `info` query - see the file doc comment).
      const scopeTargets = resolveScanScopeAddresses(current, scope, resolvedSourceAddresses)
      const runTargets = scope.kind === 'server' ? [] : scopeTargets
      const runSelectedAddress =
        scope.kind === 'server' ? scope.address : scope.kind === 'all' ? selectedAddress : undefined

      const answeredOnline = new Set<string>()

      const outcome = await runScan({
        targets: runTargets,
        settings: current.scan,
        selectedAddress: runSelectedAddress,
        signal,
        deps: { queryServer: deps.queryServer },
        onServer: (row) => {
          const now = new Date().toISOString()
          if (row.result.ok) {
            answeredOnline.add(row.target.address)
            const existing = entries.get(row.target.address)
            entries.set(row.target.address, mergeSuccessfulReply(existing, row.target, row.result, now))
          }
          // A failed reply never creates or overwrites an entry here - it is left exactly as it
          // was; D-K's `'stale'` flip only happens once, below, after the whole sweep settles.
          emit(SERVERS_EVENTS.scanServer, row)
        },
        onProgress: (progress) => {
          scanState = { ...scanState, ...progress }
          emitChanged()
        },
      })

      // D-K (story 116 D4: now extracted into scan-merge.ts's `mergeStaleRound`): anything this
      // round's address set named but that never answered successfully keeps its last-known row
      // (if it has one at all) but flagged stale - never removed, never reported as freshly empty.
      // Skipped entirely when the sweep was aborted - `runScan`'s own contract (scan-runner.ts) is
      // that an abort must never mark a row stale, because "never answered" then means "we didn't
      // get to ask", not "the server was silent"; an aborted sweep leaves every entry exactly as
      // the last *completed* scan left it. `entries` stays the single mutable closure Map the
      // `onServer` callback above also writes into, so the merge's result is copied back in place
      // rather than reassigning `entries` to a new object. Story 117 D3: `scopeTargets`, never
      // `runTargets` - the single-server scope's `runTargets` is empty, and its one address must
      // still go stale on a timeout; and no address outside the scope may be named here at all.
      for (const [address, entry] of mergeStaleRound(entries, scopeTargets, answeredOnline, outcome.aborted)) {
        entries.set(address, entry)
      }
    } catch {
      // Review fix: `runSweep` is fire-and-forget (`start()` returns before this settles, `void
      // runSweep(...)` below has no `.catch()`), so an unexpected throw here (a `getServersState()`
      // failure, or `runScan` rethrowing a callback error once every pool slot has stopped) must
      // not become an unhandled rejection. `finally` below always resets `running` regardless.
    } finally {
      const finishedAt = new Date().toISOString()
      lastScanAt = finishedAt
      scanState = { ...scanState, running: false, phase: 'idle', finishedAt }
      abortController = null
      emitChanged()
    }
  }

  function start(options: ScanStartOptions = {}): ScanStartResult {
    // Story 117 D3: the guard and single-flight below are scope-agnostic on purpose - a refusal is
    // a refusal whatever scope was asked for, so the scope is only resolved once both have passed.
    // Story 116 D3 (D-H, D-Q): main stays authoritative - refused regardless of what the renderer
    // shows, never queued, and checked before single-flight so the reason is always the game.
    if (isScanBlocked(launch.getState())) {
      syncBlockedReason(true)
      return { ok: false, reasonKey: SCAN_BLOCKED_GAME_RUNNING_REASON_KEY }
    }

    if (scanState.running) {
      return { ok: false, reasonKey: SCAN_ALREADY_RUNNING_REASON_KEY }
    }

    const scope: ScanScope = options.scope ?? { kind: 'all' }
    const controller = new AbortController()
    abortController = controller

    // `scope` stays on the state after the round finishes (like `startedAt`/`sourceFailures`), so
    // the final `scan.changed` push still says which scope it was.
    scanState = {
      ...initialScanState(),
      running: true,
      phase: 'stage1',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      scope,
    }
    emitChanged()

    void runSweep(scope, options.selectedAddress, controller.signal)

    return { ok: true }
  }

  function read(): ScanSnapshot {
    // Story S25 D2: `favourite` is derived fresh from the live state on every `read()` (never
    // cached alongside `entries`), same "read live at call time" rule `getServersState` itself
    // already carries - a favourites-list edit between two `read()` calls must be visible on the
    // very next one without needing a new scan.
    const current = getServersState()
    const favouriteAddresses = new Set(current.favourites.map((f) => f.address))
    const manualAddresses = new Set(current.manualServers.map((m) => m.address))

    const rows = [...entries.values()].map((entry) => ({
      ...entry,
      favourite: favouriteAddresses.has(entry.address),
    }))

    // Every favourite/manual address with no entry yet (never answered, never even attempted) still
    // gets a placeholder row - a favourite the user just added must show up immediately, not only
    // after the next scan finds it.
    const knownAddresses = new Set(entries.keys())
    const placeholderAddresses = new Set(
      [...favouriteAddresses, ...manualAddresses].filter((address) => !knownAddresses.has(address)),
    )
    for (const address of placeholderAddresses) {
      const origins: ServerListEntry['origins'] = []
      if (favouriteAddresses.has(address)) origins.push('favourite')
      if (manualAddresses.has(address)) origins.push('manual')
      rows.push({
        address,
        origins,
        status: 'pending',
        lastSeenAt: null,
        favourite: favouriteAddresses.has(address),
      })
    }

    return {
      state: { ...scanState },
      entries: rows,
    }
  }

  function overview(): ServersOverview {
    return {
      scanning: scanState.running,
      knownServerCount: entries.size,
      lastScanAt,
    }
  }

  function dispose(): void {
    unsubscribeLaunch()
    abortController?.abort()
  }

  return { start, read, overview, dispose }
}
