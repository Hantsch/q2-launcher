import {
  SERVERS_HANDLERS,
  favouritesAddInputSchema,
  favouritesListInputSchema,
  favouritesRemoveInputSchema,
  historyReadInputSchema,
  manualAddInputSchema,
  manualListInputSchema,
  manualRemoveInputSchema,
  scanGetSettingsInputSchema,
  scanPatchSettingsInputSchema,
  scanReadInputSchema,
  scanSetViewActiveInputSchema,
  scanStartInputSchema,
  serversNoInputSchema,
  sourcesAddInputSchema,
  sourcesListInputSchema,
  sourcesRemoveInputSchema,
  sourcesReorderInputSchema,
  sourcesUpdateInputSchema,
  type ManualServerAddResult,
  type MasterSource,
  type MasterSourcesResult,
} from '@shared/modules/servers'
import type { MainModule } from '../types'
import { addFavourite, listFavourites, removeFavourite } from './favourites'
import { readServerHistory } from './history-log'
import { addManualServer, removeManualServer } from './manual-servers'
import { addSource, removeSource, reorderSources, updateSource } from './master-sources'
import { createScanCadence, type ScanCadence } from './scan-cadence'
import { createScanService, type ScanService } from './scan-service'

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
 * with the real `ScanService`'s numbers - `activeScanService` is a module-level reference (mirroring
 * `src/main/modules/downloads/index.ts`'s `subscriptions` set) so this file's own static `dispose()`
 * can reach whichever service the most recent `setup()` created.
 *
 * Story 115 D3 adds `activeScanCadence` the same way: the auto-scan-on-open / auto-refresh timer
 * owner (`scan-cadence.ts`), so `dispose()` can tear its timer down on shutdown.
 */
let activeScanService: ScanService | null = null
let activeScanCadence: ScanCadence | null = null

export const serversModule: MainModule = {
  id: 'servers',

  setup({ handle, emit, app, log }) {
    // Reads `app.state.serversState()` live at call time, never a snapshot captured here - sources/
    // favourites/manual servers can be mutated by the handlers below in between two scans.
    // Story 116 D3: both halves take `app.launch` (structurally a `LaunchHost`) and each reads it
    // live at decision time, so neither depends on the other's `onStateChange` listener running
    // first. A superseded service is retired too now that it holds a launch subscription.
    activeScanCadence?.dispose()
    activeScanService?.dispose()
    const scanService = createScanService({
      getServersState: () => app.state.serversState(),
      emit,
      launch: app.launch,
    })
    activeScanService = scanService

    // Story 115 D3: a cadence from a superseded `setup()` could no longer be reached by `dispose()`,
    // so its timer would outlive it - it is retired above, before either reference is replaced.
    const scanCadence = createScanCadence({
      getServersState: () => app.state.serversState(),
      scanService,
      launch: app.launch,
      onError: (error) => log.warn('automatic scan trigger failed', error),
    })
    activeScanCadence = scanCadence

    handle(SERVERS_HANDLERS.overviewRead, serversNoInputSchema, () => scanService.overview())

    handle(SERVERS_HANDLERS.scanStart, scanStartInputSchema, (payload) =>
      scanService.start({ scope: payload?.scope, selectedAddress: payload?.selectedAddress }),
    )
    handle(SERVERS_HANDLERS.scanRead, scanReadInputSchema, () => scanService.read())

    /**
     * Story 115 D2: the two `scan.*` settings handlers, mirroring `DOWNLOADS_HANDLERS.getSettings`/
     * `patchSettings` (`src/main/modules/downloads/index.ts`). `scanGetSettings` is a plain read, no
     * failure mode of its own - same reasoning as `DOWNLOADS_HANDLERS.getSettings`. `scanPatchSettings`
     * follows the same read/merge/persist discipline as the `favourites.*`/`manual.*` handlers below:
     * only `scan` is replaced, every other `ServersState` key is carried over from the same snapshot
     * untouched, and what's returned is what `setServersState` actually persisted, not the local
     * `merged` candidate. Out-of-range/garbage fields never reach this handler at all -
     * `scanPatchSettingsInputSchema` already rejects them at the registry (per-field choice-list
     * `.refine()`), so there is nothing left for this handler itself to validate.
     */
    handle(SERVERS_HANDLERS.scanGetSettings, scanGetSettingsInputSchema, () =>
      app.state.serversState().scan,
    )
    handle(SERVERS_HANDLERS.scanPatchSettings, scanPatchSettingsInputSchema, (patch) => {
      const current = app.state.serversState()
      const merged = { ...current.scan, ...patch }
      const persisted = app.state.setServersState({ ...current, scan: merged }).scan
      // Story 115 D3: a changed interval (or auto-refresh on/off) reschedules immediately; every
      // other setting is read fresh at the next decision/scan anyway.
      scanCadence.onSettingsChanged()
      return persisted
    })
    // Story 115 D3: the renderer's view-active signal drives both automatic triggers. The manual
    // `scan.start` handler above stays a bare, ungated `scanService.start()` call on purpose (AC3).
    handle(SERVERS_HANDLERS.scanSetViewActive, scanSetViewActiveInputSchema, (payload) => {
      scanCadence.onViewActive(payload.active)
    })

    /**
     * Story 111 D3: the single read/mutate/persist path every `sources.*` mutation goes through.
     *
     * - `serversState()` is read once, so the op and the write see the same snapshot.
     * - A refusal returns before `setServersState` is reached: nothing is persisted, and the reason
     *   code travels back as a value (a thrown error would collapse into the registry's generic
     *   `modules.error.handlerFailed` and lose it - story 111's Decisions).
     * - Only `sources` is replaced; `favourites`/`manualServers`/`history`/`scan` are carried over
     *   from the same snapshot untouched, so a source edit can never clip another part of story
     *   110's state key.
     * - What comes back is what `setServersState` actually stored, not the local candidate, so the
     *   renderer's list and `state.json` can never disagree.
     */
    const mutate = (op: (sources: MasterSource[]) => MasterSourcesResult): MasterSourcesResult => {
      const current = app.state.serversState()
      const result = op(current.sources)
      if (!result.ok) return result
      const persisted = app.state.setServersState({ ...current, sources: result.sources })
      return { ok: true, sources: persisted.sources }
    }

    handle(
      SERVERS_HANDLERS.sourcesList,
      sourcesListInputSchema,
      () => app.state.serversState().sources,
    )
    handle(SERVERS_HANDLERS.sourcesAdd, sourcesAddInputSchema, (payload) =>
      mutate((sources) => addSource(sources, payload)),
    )
    handle(SERVERS_HANDLERS.sourcesRemove, sourcesRemoveInputSchema, (payload) =>
      mutate((sources) => removeSource(sources, payload)),
    )
    handle(SERVERS_HANDLERS.sourcesUpdate, sourcesUpdateInputSchema, (payload) =>
      mutate((sources) => updateSource(sources, payload)),
    )
    handle(SERVERS_HANDLERS.sourcesReorder, sourcesReorderInputSchema, (payload) =>
      mutate((sources) => reorderSources(sources, payload)),
    )

    /**
     * Story 112 D3: the `favourites.*` handlers. Unlike `mutate()` above, `addFavourite`/
     * `removeFavourite` never refuse (D-F/D-G in favourites.ts's doc comment) - there is no
     * `MasterSourcesResult`-style ok/refusal union to thread through, so each handler just reads
     * the current snapshot, runs the pure op, persists only the `favourites` slice (carrying
     * `sources`/`manualServers`/`history`/`scan` over untouched, same discipline as `mutate()`),
     * and returns what was actually persisted (D-E) - not the local candidate.
     */
    handle(SERVERS_HANDLERS.favouritesList, favouritesListInputSchema, () =>
      listFavourites(app.state.serversState()),
    )
    handle(SERVERS_HANDLERS.favouritesAdd, favouritesAddInputSchema, (address) => {
      const current = app.state.serversState()
      const favourites = addFavourite(current, address)
      return app.state.setServersState({ ...current, favourites }).favourites
    })
    handle(SERVERS_HANDLERS.favouritesRemove, favouritesRemoveInputSchema, (address) => {
      const current = app.state.serversState()
      const favourites = removeFavourite(current, address)
      return app.state.setServersState({ ...current, favourites }).favourites
    })

    /**
     * Story 113 D4: the `manual.*`/`history.*` handlers - same read/run/persist discipline as the
     * `favourites.*` block above, not `mutate()`'s: `addManualServer` already carries its own
     * ok/refusal union (`ManualServerAddResult`'s shape), so a refusal is returned as a value
     * *before* anything is written, and `removeManualServer` cannot refuse at all (D-I: removing an
     * address that was never stored is a successful no-op).
     *
     * Each write replaces exactly one collection and carries `sources`/`favourites` plus the other
     * of `manualServers`/`history` over from the same snapshot, so a manual add or remove can never
     * clip the history (AC6's cross-collection half) or any other part of story 110's state key.
     *
     * `history.read` is read-only on purpose (D-H): there is no `history.record` channel, because
     * only main ever appends to the history.
     */
    handle(SERVERS_HANDLERS.manualList, manualListInputSchema, () =>
      app.state.serversState().manualServers,
    )
    handle(
      SERVERS_HANDLERS.manualAdd,
      manualAddInputSchema,
      (payload): ManualServerAddResult => {
        const current = app.state.serversState()
        const result = addManualServer(current.manualServers, payload)
        if (!result.ok) return result
        // `result.entry` is a member of `result.list`, which is what gets stored verbatim - so the
        // entry handed back is the persisted one, not a separate local candidate.
        app.state.setServersState({ ...current, manualServers: result.list })
        return { ok: true, entry: result.entry }
      },
    )
    handle(SERVERS_HANDLERS.manualRemove, manualRemoveInputSchema, (payload) => {
      const current = app.state.serversState()
      const manualServers = removeManualServer(current.manualServers, payload.address)
      return app.state.setServersState({ ...current, manualServers }).manualServers
    })
    handle(SERVERS_HANDLERS.historyRead, historyReadInputSchema, () =>
      readServerHistory(app.state.serversState().history),
    )

    log.debug('servers module ready')
  },

  dispose() {
    // Cadence first, so no timer tick can start a new scan after the running one is aborted.
    activeScanCadence?.dispose()
    activeScanService?.dispose()
  },
}
