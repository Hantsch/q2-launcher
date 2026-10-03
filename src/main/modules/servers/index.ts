import { ok } from '@shared/types'
import { defineModule } from '../define-module'
import {
  SERVERS_EVENTS,
  SERVERS_CONTRACT_SCHEMAS,
  SERVERS_HANDLERS,
  type ServersContract,
  SERVERS_WATCHLIST_HANDLERS,
  type MasterSource,
  type MasterSourcesResult,
  type QuickFiltersResult,
  type WatchlistEntry,
} from '@shared/modules/servers'
import type { QuickFilter } from '@shared/servers/quick-filters'
import {
  removeQuickFilter,
  renameQuickFilter,
  saveQuickFilter,
  type QuickFilterMutationResult,
} from './quick-filter-entries'
import { uiHarnessLanTargets } from '../../lib/ui-harness'
import type { MainModule } from '../types'
import { addFavourite, removeFavourite } from './favourites'
import { readServerHistory, recordServerVisit } from './history-log'
import { addSource, removeSource, reorderSources, updateSource } from './master-sources'
import { discoverLanServers } from './lan-discovery'
import { serversState } from './persisted'
import { createScanCadence } from './scan-cadence'
import { createScanService, type ScanService } from './scan-service'
import { createRegexHost } from './watchlist-regex-host'
import {
  createWatchlistService,
  type WatchlistScanHost,
  type WatchlistService,
} from './watchlist-service'

/**
 * The servers module - story 106 D2 registers its main half with a single
 * handler, `overview.read`, answering a hardcoded zeroed overview. There is
 * no scanning yet: no `dgram`, no `fetch`, no state - that is 9.2+. Mirrors
 * `src/main/modules/home/index.ts`'s shape - `setup()` registers handlers
 * and does nothing else.
 *
 * Story 111 D3 adds the five `sources.*` handlers on top. All the rules live in
 * `master-sources.ts` (pure, list in / list-or-reason out); what stays here is the only thing that
 * needs `app.state`: read the current `ServersState`, run the op, and persist exactly once - and
 * only on success.
 *
 * Story 114 D6 adds the `scan.*` handlers and replaces `overview.read`'s hardcoded zeroed object
 * with the real `ScanService`'s numbers. Everything `setup()` creates (scan service, cadence, launch
 * subscription, and - only while the `'watchlist'` feature is unlocked - watchlist service and regex
 * host) lives in its closure and is released through `onDispose`; the module holds no state of its own.
 */
export const serversModule: MainModule = {
  id: 'servers',

  setup(setup) {
    const { app, log, onDispose } = setup
    const servers = serversState(app.state)
    const { handle, emit } = defineModule<ServersContract>(
      'servers',
      SERVERS_CONTRACT_SCHEMAS,
    ).bind(setup)
    // Reads `servers.get()` live at call time, never a snapshot captured here - sources/
    // favourites/manual servers can be mutated by the handlers below in between two scans.
    // Story 116 D3: both halves take `app.launch` (structurally a `LaunchHost`) and each reads it
    // live at decision time, so neither depends on the other's `onStateChange` listener running
    // first. Disposers run in reverse creation order: the cadence stops before the scan it feeds.

    /**
     * Story 131 D5: the watchlist's service/worker are only ever constructed while the
     * `'watchlist'` feature is unlocked (AC10) - `watchlistService` stays `undefined` on a locked
     * start, so `onStage2Row` below is `undefined` too (no observer attached to the scan service)
     * and the `watchlist.*` handlers further down are never reached to register at all. A forward
     * reference (`scanServiceRef`) lets `watchlistService` be built *before* `scanService` exists -
     * it needs `scanService` only for `getKnownServers`/`recheck`, neither of which the module ever
     * calls before `createScanService` below has run and filled the ref in.
     */
    const scanServiceRef: { current: ScanService | null } = { current: null }
    let watchlistService: WatchlistService | undefined
    if (app.features.isFeatureUnlocked('watchlist')) {
      const regexHost = createRegexHost()
      onDispose(() => regexHost.dispose())

      const watchlistScanHost: WatchlistScanHost = {
        start: (scanOptions) => scanServiceRef.current!.start(scanOptions),
      }

      watchlistService = createWatchlistService({
        getEntries: () => servers.get().watchlist,
        setEntries: (list: WatchlistEntry[]) => {
          servers.update((s) => ({ ...s, watchlist: list }))
        },
        getKnownServers: () => scanServiceRef.current!.read('online').entries,
        scanService: watchlistScanHost,
        regexHost,
        emit: (snapshot) => emit(SERVERS_EVENTS.watchlistChanged, snapshot),
      })
      const createdWatchlist = watchlistService
      onDispose(() => createdWatchlist.dispose())
    }

    const scanService = createScanService({
      getServersState: () => servers.get(),
      emit,
      launch: app.launch,
      onStage2Row: watchlistService?.onStage2Row,
      deps: {
        // Story 196 D3: the real discovery, except that the UI harness (and only it) may name the
        // loopback fixture servers to query instead of enumerating interfaces. Read per round.
        lanDiscovery: (options) =>
          discoverLanServers({
            ...options,
            deps: {
              ...options.deps,
              targetsOverride: uiHarnessLanTargets(app.harness),
            },
          }),
      },
    })
    onDispose(() => scanService.dispose())
    scanServiceRef.current = scanService

    const scanCadence = createScanCadence({
      getServersState: () => servers.get(),
      scanService,
      launch: app.launch,
      onError: (error) => log.warn('automatic scan trigger failed', error),
    })
    onDispose(() => scanCadence.dispose())

    handle(SERVERS_HANDLERS.overviewRead, async () => ok(await scanService.overview()))

    handle(SERVERS_HANDLERS.scanStart, async (payload) =>
      ok(
        await scanService.start({
          scope: payload?.scope,
          selectedAddress: payload?.selectedAddress,
        }),
      ),
    )
    handle(SERVERS_HANDLERS.scanRead, async () => ok(await scanService.read()))
    // Story 196 D3: the active list is main's in-memory state; a first visit to a never-scanned
    // mode lets the cadence apply the same view-open auto trigger.
    handle(SERVERS_HANDLERS.scanSetMode, (payload) => {
      scanService.setMode(payload.mode)
      scanCadence.onModeChanged()
      return ok(undefined)
    })

    // Story 122 D2: `detailReadInputSchema` is a bare `serverAddressSchema` (like
    // `favouritesAddInputSchema`), not a `{ address }` wrapper, so the payload arrives already
    // normalized as a plain string - no destructuring needed.
    handle(SERVERS_HANDLERS.detailRead, async (address) =>
      ok(await scanService.readDetail(address)),
    )

    /**
     * Story 115 D2: the two `scan.*` settings handlers, mirroring `DOWNLOADS_HANDLERS.getSettings`/
     * `patchSettings` (`src/main/modules/downloads/index.ts`). `scanGetSettings` is a plain read, no
     * failure mode of its own - same reasoning as `DOWNLOADS_HANDLERS.getSettings`. `scanPatchSettings`
     * follows the same read/merge/persist discipline as the `favourites.*` handlers below:
     * only `scan` is replaced, every other `ServersState` key is carried over from the same snapshot
     * untouched, and what's returned is what `updateSlice` actually persisted, not the local
     * merged candidate. Out-of-range/garbage fields never reach this handler at all -
     * `scanPatchSettingsInputSchema` already rejects them at the registry (per-field choice-list
     * `.refine()`), so there is nothing left for this handler itself to validate.
     */
    handle(SERVERS_HANDLERS.scanGetSettings, () => ok(servers.get().scan))
    handle(SERVERS_HANDLERS.scanPatchSettings, (patch) => {
      const persisted = servers.update((live) => ({
        ...live,
        scan: { ...live.scan, ...patch },
      })).scan
      // Story 115 D3: a changed interval (or auto-refresh on/off) reschedules immediately; every
      // other setting is read fresh at the next decision/scan anyway.
      scanCadence.onSettingsChanged()
      return ok(persisted)
    })
    // Story 115 D3: the renderer's view-active signal drives both automatic triggers. The manual
    // `scan.start` handler above stays a bare, ungated `scanService.start()` call on purpose (AC3).
    handle(SERVERS_HANDLERS.scanSetViewActive, (payload) => {
      scanCadence.onViewActive(payload.active)
      return ok(undefined)
    })

    /**
     * Story 111 D3: the single read/mutate/persist path every `sources.*` mutation goes through.
     *
     * - The op runs on the live slice inside `updateSlice`, so the op and the write see the same value.
     * - A refusal returns the live slice unchanged: nothing is persisted, and the reason
     *   code travels back as a value (a thrown error would collapse into the registry's generic
     *   `modules.error.handlerFailed` and lose it - story 111's Decisions).
     * - Only `sources` is replaced; every other key is carried over from the live slice untouched,
     *   so a source edit can never clip another part of story 110's state key.
     * - What comes back is what `updateSlice` actually stored, not the local candidate, so the
     *   renderer's list and `state.json` can never disagree.
     */
    const mutate = (op: (sources: MasterSource[]) => MasterSourcesResult): MasterSourcesResult => {
      let result: MasterSourcesResult | undefined
      const persisted = servers.update((live) => {
        result = op(live.sources)
        return result.ok ? { ...live, sources: result.sources } : live
      })
      if (!result || !result.ok) return result as MasterSourcesResult
      return { ok: true, sources: persisted.sources }
    }

    handle(SERVERS_HANDLERS.sourcesList, () => ok(servers.get().sources))
    handle(SERVERS_HANDLERS.sourcesAdd, (payload) =>
      ok(mutate((sources) => addSource(sources, payload))),
    )
    handle(SERVERS_HANDLERS.sourcesRemove, (payload) =>
      ok(mutate((sources) => removeSource(sources, payload))),
    )
    handle(SERVERS_HANDLERS.sourcesUpdate, (payload) =>
      ok(mutate((sources) => updateSource(sources, payload))),
    )
    handle(SERVERS_HANDLERS.sourcesReorder, (payload) =>
      ok(mutate((sources) => reorderSources(sources, payload))),
    )

    /**
     * Story 112 D3: the `favourites.*` handlers. Unlike `mutate()` above, `addFavourite`/
     * `removeFavourite` never refuse (D-F/D-G in favourites.ts's doc comment) - there is no
     * `MasterSourcesResult`-style ok/refusal union to thread through, so each handler just reads
     * the current snapshot, runs the pure op, persists only the `favourites` slice (carrying
     * `sources`/`manualServers`/`history`/`scan` over untouched, same discipline as `mutate()`),
     * and returns what was actually persisted (D-E) - not the local candidate.
     */
    handle(SERVERS_HANDLERS.favouritesAdd, (address) => {
      return ok(
        servers.update((live) => ({
          ...live,
          favourites: addFavourite(live, address),
        })).favourites,
      )
    })
    handle(SERVERS_HANDLERS.favouritesRemove, (address) => {
      return ok(
        servers.update((live) => ({
          ...live,
          favourites: removeFavourite(live, address),
        })).favourites,
      )
    })

    /**
     * `history.read` is read-only on purpose: there is no `history.record` channel, because only
     * main appends to the history (the `app.launch.onStateChange` subscription below).
     */
    handle(SERVERS_HANDLERS.historyRead, () => ok(readServerHistory(servers.get().history)))

    /**
     * Story 125 D3: a successful join records one history visit. `state.connect` is only set once a
     * launch reaches `'running'` (story 125's `LaunchState.connect`), so this fires exactly once per
     * join - not on `'starting'` (no `connect` yet) and not again on `'exited'`/`'failed'` (`connect`
     * may still be set there, but `phase` no longer is `'running'`). A `'running'` state with no
     * `connect` (a plain, non-join launch) and a `'handed-off'` join (Steam takes over; nothing here
     * ever sees `'running'` for it) both write nothing, on purpose (AC: only `running` + `connect`
     * writes). Same read/run/persist discipline as `favourites.*` above: one snapshot, one slice
     * replaced, the rest of `ServersState` carried over untouched.
     */
    const unsubscribeHistory = app.launch.onStateChange((state) => {
      if (state.phase !== 'running' || !state.connect) return
      const connect = state.connect
      servers.update((live) => ({
        ...live,
        history: recordServerVisit(live.history, {
          address: connect,
          connectedAt: new Date().toISOString(),
        }),
      }))
    })
    onDispose(unsubscribeHistory)

    /**
     * Story 119 D2: the `list.*` sort handlers - same read/merge/persist discipline as
     * `scanGetSettings`/`scanPatchSettings` above. `listSetSort` replaces the top-level `listSort`
     * field wholesale (there is nothing to merge - a sort is either set or cleared) while carrying
     * every other `ServersState` key over from the same snapshot untouched; a cleared sort is a
     * stored `null`. What's returned is what `update` actually persisted, not the local candidate.
     */
    handle(SERVERS_HANDLERS.listGetSort, () => ok(servers.get().listSort))
    handle(SERVERS_HANDLERS.listSetSort, (payload) => {
      return ok(servers.update((live) => ({ ...live, listSort: payload.sort })).listSort)
    })

    /**
     * Story 197 D2: the saved quick filters. Always registered (not behind the watchlist gate); each
     * mutation reads one snapshot, runs the pure entry function, and on success replaces only the
     * `quickFilters` slice, returning what `updateSlice` actually persisted.
     */
    const mutateQuickFilters = (
      run: (list: readonly QuickFilter[]) => QuickFilterMutationResult,
    ): QuickFiltersResult => {
      let result: QuickFilterMutationResult | undefined
      const persisted = servers.update((live) => {
        result = run(live.quickFilters)
        return result.ok ? { ...live, quickFilters: result.list } : live
      })
      if (!result || !result.ok) return result as QuickFiltersResult
      return { ok: true, list: persisted.quickFilters }
    }
    handle(SERVERS_HANDLERS.quickFiltersList, () => ok(servers.get().quickFilters))
    handle(SERVERS_HANDLERS.quickFiltersSave, (payload) =>
      ok(mutateQuickFilters((list) => saveQuickFilter(list, payload))),
    )
    handle(SERVERS_HANDLERS.quickFiltersRename, (payload) =>
      ok(mutateQuickFilters((list) => renameQuickFilter(list, payload))),
    )
    handle(SERVERS_HANDLERS.quickFiltersRemove, (payload) =>
      ok(mutateQuickFilters((list) => removeQuickFilter(list, payload))),
    )

    /**
     * Story 131 D5: the five `watchlist.*` handlers. Defined inside the same
     * `isFeatureUnlocked('watchlist')` branch that built `watchlistService` above, so a locked start
     * never even reaches these `handle()` calls - the `{ feature: 'watchlist' }` option is kept on
     * each anyway (belt-and-braces with the registry's own gate from story 130, and it keeps every
     * gated handler in this codebase self-documenting the same way), but the handlers themselves are
     * only reachable at all when `watchlistService` exists to back them. Each delegates straight to
     * the matching `WatchlistService` method - no read/persist discipline needed here, unlike
     * `sources.*`/`favourites.*` above, because `watchlist-service.ts` already owns that (via its own
     * `getEntries`/`setEntries` closures wired above).
     */
    if (watchlistService !== undefined) {
      const service = watchlistService
      handle(SERVERS_WATCHLIST_HANDLERS.read, async () => ok(await service.read()), {
        feature: 'watchlist',
      })
      handle(SERVERS_WATCHLIST_HANDLERS.add, async (payload) => ok(await service.add(payload)), {
        feature: 'watchlist',
      })
      handle(
        SERVERS_WATCHLIST_HANDLERS.update,
        async (payload) => ok(await service.update(payload)),
        { feature: 'watchlist' },
      )
      handle(
        SERVERS_WATCHLIST_HANDLERS.remove,
        async (payload) => ok(await service.remove(payload)),
        { feature: 'watchlist' },
      )
      handle(
        SERVERS_WATCHLIST_HANDLERS.recheck,
        async (payload) => ok(await service.recheck(payload)),
        { feature: 'watchlist' },
      )
    }

    log.debug('servers module ready')
  },
}
