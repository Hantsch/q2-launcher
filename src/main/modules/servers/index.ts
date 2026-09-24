import {
  SERVERS_HANDLERS,
  serversNoInputSchema,
  sourcesAddInputSchema,
  sourcesListInputSchema,
  sourcesRemoveInputSchema,
  sourcesReorderInputSchema,
  sourcesUpdateInputSchema,
  type MasterSource,
  type MasterSourcesResult,
  type ServersOverview,
} from '@shared/modules/servers'
import type { MainModule } from '../types'
import { addSource, removeSource, reorderSources, updateSource } from './master-sources'

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
 */
export const serversModule: MainModule = {
  id: 'servers',

  setup({ handle, app, log }) {
    const overview: ServersOverview = {
      scanning: false,
      knownServerCount: 0,
      lastScanAt: null,
    }

    handle(SERVERS_HANDLERS.overviewRead, serversNoInputSchema, () => overview)

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

    log.debug('servers module ready')
  },
}
