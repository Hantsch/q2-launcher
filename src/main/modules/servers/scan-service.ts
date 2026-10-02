import { refuse } from '@shared/types'
import {
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  SCAN_FAVOURITES_NOT_IN_LAN_REASON_KEY,
  SERVERS_EVENTS,
  type ScanBlockedReason,
  type ScanQueryResult,
  type ScanScope,
  type ScanServerPush,
  type ScanSnapshot,
  type ScanStartResult,
  type ScanTarget,
  type ServerDetail,
  type ServerListEntry,
  type ServersBrowseMode,
  type ServersContract,
  type ServersOverview,
  type ServersScanState,
  type ServersState,
} from '@shared/modules/servers'
import type { ParsedServerAddress } from '@shared/servers/address'
import { readIntKey } from '@shared/servers/infostring'
import { deriveGamemode } from '@shared/servers/row-markers'
import type { LaunchHost } from '../../services/write-guard'
import type { BoundModule } from '../define-module'
import { electronNetFetch, type FetchImpl } from '../downloads/fetcher'
import { discoverLanServers } from './lan-discovery'
import { isScanBlocked } from './scan-guard'
import { appendRttSample, mergeStaleRound } from './scan-merge'
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
 * - **Story 196 D2, two lists.** The online list and the LAN list are separate `ScanList`s (each
 *   its own `entries`/`statusInfo`/`lastScanAt`); `setMode` (in memory, default `'online'`) picks
 *   which one `read()`/`readDetail()`/`overview()`/`start()` use. `start()` captures the active
 *   list for the whole round, so a mid-scan switch never redirects writes. A LAN `'all'` round
 *   replaces the LAN list: discovery broadcast, then `runScan` over the answers - no source
 *   resolution, no stale merge, no `onStage2Row`. Favourites are refused in LAN; a `'server'`
 *   round refreshes a row already in the LAN list and never adds one (only broadcast answers
 *   ever enter it).
 */

/** Injectable seams for both `resolveSources` and `runScan`, all optional - each defaults to the
 * real implementation the same way `ResolveSourcesDeps`/`ScanRunnerDeps` already do. Bundled into
 * one options bag here because the service is the one place that needs both at once. */
export interface ScanServiceDeps {
  fetchImpl?: FetchImpl
  udpImpl?: MasterUdpImpl
  clock?: Clock
  queryServer?: QueryServerFn
  /** Story 196 D2: the LAN discovery round, defaulting to `discoverLanServers` - same injection
   * style as `queryServer`. The UI harness wraps the real one with its `targetsOverride`. */
  lanDiscovery?: LanDiscoveryFn
}

export type LanDiscoveryFn = typeof discoverLanServers

export interface CreateScanServiceOptions {
  /** Reads the current `ServersState` fresh at call time - sources/favourites/manual servers can
   * change between scans, so this must never be a snapshot captured once at `setup()` time. */
  getServersState: () => ServersState
  emit: BoundModule<ServersContract>['emit']
  /** Story 116 D3 (D-E): the structural launch seam, never `LaunchService` itself. */
  launch: LaunchHost
  deps?: ScanServiceDeps
  /** Story 131 D4: an optional hook fed one `ScanServerPush` per stage-2 row, purely as an
   * observer - the watchlist service is the only current consumer. Called synchronously from the
   * scan's own `onServer` callback, only for `stage === 'stage2'` rows, and only *after* this
   * service's own entry-merge-and-emit for that row (never reordered ahead of it). Wrapped in a
   * try/catch here and never awaited: a throwing or slow/hanging observer must never affect the
   * scan's own results or timing (AC5/AC8 of story 131 - the scan must be byte-for-byte identical
   * whether or not this is set). */
  onStage2Row?: (row: ScanServerPush) => void
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
  /** `listMode` (story 196 D3) reads that mode's list regardless of the active one - the watchlist
   * passes `'online'` so LAN rows never reach it. Omitted means the active mode. */
  read: (listMode?: ServersBrowseMode) => ScanSnapshot
  overview: () => ServersOverview
  /** Story 122 D2: one server's detail - the row as `read()` already knows it (favourite/pending
   * placeholders included) plus the last successful `status` reply's full `serverinfo`. `null` when
   * there is no row for the address at all. */
  readDetail: (address: string) => ServerDetail | null
  /** Story 196 D2: switches the active list (in memory only). Never aborts or redirects a running
   * scan - that round keeps writing into the list it started with. */
  setMode: (mode: ServersBrowseMode) => void
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
    mode: 'online',
  }
}

/** Story 196 D2: one mode's last-known rows. `statusInfo` is story 122 D2's last successful `status`
 * serverinfo per address, replaced whole on each new one (an `info` or failed reply never touches
 * it); `lastScanAt` is when a round on this list last finished. */
interface ScanList {
  entries: Map<string, ServerListEntry>
  statusInfo: Map<string, Record<string, string>>
  lastScanAt: string | null
}

function emptyList(): ScanList {
  return { entries: new Map(), statusInfo: new Map(), lastScanAt: null }
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
): Pick<
  ServerListEntry,
  'name' | 'map' | 'mod' | 'maxclients' | 'needpass' | 'spectatorPass' | 'gamemode'
> {
  const hostname = typeof serverinfo.hostname === 'string' ? serverinfo.hostname : undefined
  const map = typeof serverinfo.mapname === 'string' ? serverinfo.mapname : undefined
  const mod =
    typeof serverinfo.gamename === 'string' && serverinfo.gamename !== ''
      ? serverinfo.gamename
      : undefined
  const maxclients = readIntKey(serverinfo, 'maxclients')
  // Story S25 D2: bit 0 of `needpass` is the password flag (3 -> true, 2 -> false); an absent key
  // keeps whatever the entry previously knew rather than clobbering it with `undefined`.
  const n = readIntKey(serverinfo, 'needpass')
  const needpass = n === undefined ? existing?.needpass : (n & 1) === 1
  // Story 126: bit 1 of `needpass` is the spectator-password flag; an absent/invalid key keeps
  // whatever the entry previously knew rather than clobbering it with `undefined`.
  const spectatorPass = n === undefined ? existing?.spectatorPass : (n & 2) !== 0

  return {
    name: hostname ?? existing?.name,
    map: map ?? existing?.map,
    mod: mod ?? existing?.mod,
    maxclients: maxclients ?? existing?.maxclients,
    needpass,
    spectatorPass,
    gamemode: readGamemode(serverinfo, existing),
  }
}

/** The dm/coop/ctf/teamplay flags only describe the game for the stock `baseq2` game. Every mod
 * (RPG, bot, ...) runs `deathmatch 1` as its engine base, so on a mod the flags say nothing about
 * what the mod actually is: the gamemode stays unknown (never guessed) until the mods feature can
 * categorise known mods. A reply that names no game at all keeps the entry's previous value. */
function readGamemode(
  serverinfo: Record<string, string>,
  existing: ServerListEntry | undefined,
): ServerListEntry['gamemode'] {
  if (typeof serverinfo.gamename !== 'string' || serverinfo.gamename.trim() === '')
    return existing?.gamemode
  if (serverinfo.gamename.trim().toLowerCase() !== 'baseq2') return undefined
  return deriveGamemode(serverinfo) ?? existing?.gamemode
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
  const players =
    result.kind === 'status' ? result.reply.players : (result.reply.clients ?? existing?.players)

  return {
    address: target.address,
    origins: target.origins,
    status: 'online',
    ...fields,
    rttMs: result.rttMs,
    // Story 124 D1: session history of measured round trips, oldest first - the single `rttMs`
    // field above still tracks only the latest value, unchanged.
    rttHistory: appendRttSample(existing?.rttHistory, { at: now, rttMs: result.rttMs }),
    players,
    lastSeenAt: now,
  }
}

export function createScanService(options: CreateScanServiceOptions): ScanService {
  const { getServersState, emit, launch, onStage2Row } = options
  const deps = options.deps ?? {}

  const blockedReasonFor = (blocked: boolean): ScanBlockedReason | null =>
    blocked ? 'game-running' : null

  const lists: Record<ServersBrowseMode, ScanList> = { online: emptyList(), lan: emptyList() }
  let mode: ServersBrowseMode = 'online'
  let lanFailureKey: string | null = null
  let scanState: ServersScanState = {
    ...initialScanState(),
    blockedReason: blockedReasonFor(isScanBlocked(launch.getState())),
  }
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

  /** Merges one successful reply into `list` (D-J/D-K: only an `ok` reply ever writes a row). */
  function storeReply(
    list: ScanList,
    target: ScanTarget,
    result: Extract<ScanQueryResult, { ok: true }>,
  ): void {
    const now = new Date().toISOString()
    list.entries.set(
      target.address,
      mergeSuccessfulReply(list.entries.get(target.address), target, result, now),
    )
    if (result.kind === 'status')
      list.statusInfo.set(target.address, { ...result.reply.serverinfo })
  }

  async function runOnlineRound(
    list: ScanList,
    current: ServersState,
    scope: ScanScope,
    selectedAddress: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
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
          const existing = list.entries.get(row.target.address)
          list.entries.set(
            row.target.address,
            mergeSuccessfulReply(existing, row.target, row.result, now),
          )
          if (row.result.kind === 'status') {
            list.statusInfo.set(row.target.address, { ...row.result.reply.serverinfo })
          }
        }
        // A failed reply never creates or overwrites an entry here - it is left exactly as it
        // was; D-K's `'stale'` flip only happens once, below, after the whole sweep settles.
        emit(SERVERS_EVENTS.scanServer, row)
        // Story 131 D4: fired strictly after the scan's own merge+emit above, only for stage-2
        // rows, never awaited and never allowed to throw out of this callback - see
        // `onStage2Row`'s own doc comment on `CreateScanServiceOptions`.
        if (row.stage === 'stage2' && onStage2Row !== undefined) {
          try {
            onStage2Row(row)
          } catch {
            // Swallowed on purpose (debug-only concern) - an observer's failure must never
            // affect the scan itself.
          }
        }
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
    for (const [address, entry] of mergeStaleRound(
      list.entries,
      scopeTargets,
      answeredOnline,
      outcome.aborted,
      new Date().toISOString(),
    )) {
      list.entries.set(address, entry)
    }
  }

  /** Story 196 D2: a LAN round on the LAN list. `'all'` replaces the list with this round's
   * broadcast answers, then runs the usual two stages over them; `'server'` refreshes one row
   * already in the list. Never resolves sources, never stale-merges, never feeds `onStage2Row`
   * (the watchlist only follows online servers, D-B). `'favourites'` never gets here. */
  async function runLanRound(
    list: ScanList,
    current: ServersState,
    scope: ScanScope,
    selectedAddress: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    // Only broadcast answers ever enter the LAN list: a reply for an address not already in it is
    // neither stored nor pushed, so a scoped refresh can never add a non-LAN row.
    const onServer = (row: ScanServerPush): void => {
      if (!list.entries.has(row.target.address)) return
      const target: ScanTarget = { address: row.target.address, origins: ['lan'] }
      if (row.result.ok) storeReply(list, target, row.result)
      emit(SERVERS_EVENTS.scanServer, { ...row, target })
    }
    const onProgress = (progress: Partial<ServersScanState>): void => {
      scanState = { ...scanState, ...progress }
      emitChanged()
    }

    if (scope.kind === 'server') {
      await runScan({
        targets: [],
        settings: current.scan,
        selectedAddress: scope.address,
        signal,
        deps: { queryServer: deps.queryServer },
        onServer,
        onProgress,
      })
      return
    }

    // D-E: the round replaces the list - a server that stopped answering is gone, not stale.
    list.entries.clear()
    list.statusInfo.clear()
    lanFailureKey = null
    const discovered: ScanTarget[] = []
    const discovery = await (deps.lanDiscovery ?? discoverLanServers)({
      settings: current.scan,
      signal,
      onReply: (reply) => {
        if (list.entries.has(reply.address)) return
        const target: ScanTarget = { address: reply.address, origins: ['lan'] }
        const result: ScanQueryResult = {
          ok: true,
          kind: 'info',
          reply: reply.reply,
          rttMs: reply.rttMs,
        }
        discovered.push(target)
        storeReply(list, target, result)
        emit(SERVERS_EVENTS.scanServer, {
          stage: 'stage1',
          target,
          result,
        } satisfies ScanServerPush)
        onProgress({ stage1Done: discovered.length, stage1Total: discovered.length })
      },
    })
    lanFailureKey = discovery.failureKey
    if (signal.aborted || discovered.length === 0) return

    await runScan({
      targets: discovered,
      settings: current.scan,
      selectedAddress: discovered.some((t) => t.address === selectedAddress)
        ? selectedAddress
        : undefined,
      signal,
      deps: { queryServer: deps.queryServer },
      onServer,
      onProgress,
    })
  }

  async function runSweep(
    list: ScanList,
    sweepMode: ServersBrowseMode,
    scope: ScanScope,
    selectedAddress: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      // Review fix (story 114): reading the current state and building `resolveDeps` now happens
      // *inside* the try - previously it ran before the try block, so a throwing `getServersState()`
      // would skip `finally` below entirely and leave `running: true` stuck forever (D-L's
      // single-flight guard would then refuse every future `scan.start` for the rest of the
      // process's life).
      const current = getServersState()
      if (sweepMode === 'lan') await runLanRound(list, current, scope, selectedAddress, signal)
      else await runOnlineRound(list, current, scope, selectedAddress, signal)
    } catch {
      // Review fix: `runSweep` is fire-and-forget (`start()` returns before this settles, `void
      // runSweep(...)` below has no `.catch()`), so an unexpected throw here (a `getServersState()`
      // failure, or `runScan` rethrowing a callback error once every pool slot has stopped) must
      // not become an unhandled rejection. `finally` below always resets `running` regardless.
    } finally {
      const finishedAt = new Date().toISOString()
      list.lastScanAt = finishedAt
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
      return refuse(SCAN_BLOCKED_GAME_RUNNING_REASON_KEY)
    }

    if (scanState.running) {
      return refuse(SCAN_ALREADY_RUNNING_REASON_KEY)
    }

    const scope: ScanScope = options.scope ?? { kind: 'all' }
    // Story 196 D2: the round belongs to the mode active *now*; its list is captured here and
    // handed to the sweep, so a `setMode` mid-round never redirects its writes.
    const sweepMode = mode
    if (sweepMode === 'lan' && scope.kind === 'favourites') {
      return refuse(SCAN_FAVOURITES_NOT_IN_LAN_REASON_KEY)
    }
    const list = lists[sweepMode]
    const controller = new AbortController()
    abortController = controller

    // `scope` stays on the state after the round finishes (like `startedAt`/`sourceFailures`), so
    // the final `scan.changed` push still says which scope it was - and `mode` which list.
    scanState = {
      ...initialScanState(),
      running: true,
      phase: 'stage1',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      scope,
      mode: sweepMode,
    }
    emitChanged()

    void runSweep(list, sweepMode, scope, options.selectedAddress, controller.signal)

    return { ok: true }
  }

  function read(listMode: ServersBrowseMode = mode): ScanSnapshot {
    // Story S25 D2: `favourite` is derived fresh from the live state on every `read()` (never
    // cached alongside `entries`), same "read live at call time" rule `getServersState` itself
    // already carries - a favourites-list edit between two `read()` calls must be visible on the
    // very next one without needing a new scan.
    const current = getServersState()
    const favouriteAddresses = new Set(current.favourites.map((f) => f.address))
    const manualAddresses = new Set(current.manualServers.map((m) => m.address))
    // Story 196 D2: the active mode's list only - never a mix of online and LAN rows.
    const activeMode = listMode
    const entries = lists[activeMode].entries

    const rows = [...entries.values()].map((entry) => ({
      ...entry,
      favourite: favouriteAddresses.has(entry.address),
    }))

    // Every favourite/manual address with no entry yet (never answered, never even attempted) still
    // gets a placeholder row - a favourite the user just added must show up immediately, not only
    // after the next scan finds it. Online only: the LAN list holds broadcast answers and nothing else.
    const knownAddresses = new Set(entries.keys())
    const placeholderAddresses = new Set(
      [...favouriteAddresses, ...manualAddresses].filter((address) => !knownAddresses.has(address)),
    )
    if (activeMode === 'lan') placeholderAddresses.clear()
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
      mode: activeMode,
      lan: { lastFinishedAt: lists.lan.lastScanAt, failureKey: lanFailureKey },
    }
  }

  function readDetail(address: string): ServerDetail | null {
    const row = read().entries.find((entry) => entry.address === address)
    if (row === undefined) return null
    return { row, serverinfo: lists[mode].statusInfo.get(address) ?? null }
  }

  function overview(): ServersOverview {
    return {
      scanning: scanState.running,
      knownServerCount: lists[mode].entries.size,
      lastScanAt: lists[mode].lastScanAt,
    }
  }

  function setMode(next: ServersBrowseMode): void {
    mode = next
  }

  function dispose(): void {
    unsubscribeLaunch()
    abortController?.abort()
  }

  return { start, read, overview, readDetail, setMode, dispose }
}
