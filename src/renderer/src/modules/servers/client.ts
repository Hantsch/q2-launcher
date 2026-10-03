import {
  SERVERS_EVENTS,
  SERVERS_HANDLERS,
  type FavouriteServerEntry,
  type MasterSource,
  type MasterSourcesResult,
  type MasterSourceType,
  type QuickFiltersResult,
  type ScanScope,
  type ScanServerPush,
  type ScanSnapshot,
  type ScanStartResult,
  type ServerDetail,
  type ServerListSort,
  type ServersContract,
  type ServersBrowseMode,
  type ServersOverview,
  type ServersScanSettings,
  type ServersScanState,
  SERVERS_WATCHLIST_HANDLERS,
  type WatchlistMatchMode,
  type WatchlistMutationResult,
  type WatchlistSnapshot,
} from '@shared/modules/servers'
import type { QuickFilter, QuickFilterCriteria } from '@shared/servers/quick-filters'
import type { Outcome } from '@shared/types'
import { createModuleClient } from '../moduleClient'

const client = createModuleClient<ServersContract>('servers')

/** Typed client for the servers module's handlers (story 106). One function per handler in its
 * contract - mirrors `modules/downloads/client.ts`. */
export function getServersOverview(): Promise<Outcome<ServersOverview>> {
  return client.call(SERVERS_HANDLERS.overviewRead)
}

/**
 * Story 111: the five `sources.*` handlers. Each resolves to `Outcome<T>` at the transport
 * level (`callModule`'s own contract - a schema/handler-registry failure) wrapping the *domain*
 * result underneath: `sourcesList` always succeeds and answers the list directly, the four
 * mutations answer a `MasterSourcesResult` (its own `ok`/`reason` - a refusal, not a thrown
 * error) so the section can tell "IPC failed" apart from "the edit was refused" without
 * flattening one into the other.
 */
export function listMasterSources(): Promise<Outcome<MasterSource[]>> {
  return client.call(SERVERS_HANDLERS.sourcesList)
}

export function addMasterSource(input: {
  type: MasterSourceType
  address: string
}): Promise<Outcome<MasterSourcesResult>> {
  return client.call(SERVERS_HANDLERS.sourcesAdd, input)
}

export function removeMasterSource(id: string): Promise<Outcome<MasterSourcesResult>> {
  return client.call(SERVERS_HANDLERS.sourcesRemove, { id })
}

export function updateMasterSourceAddress(input: {
  id: string
  type: MasterSourceType
  address: string
}): Promise<Outcome<MasterSourcesResult>> {
  return client.call(SERVERS_HANDLERS.sourcesUpdate, input)
}

export function setMasterSourceEnabled(
  id: string,
  enabled: boolean,
): Promise<Outcome<MasterSourcesResult>> {
  return client.call(SERVERS_HANDLERS.sourcesUpdate, {
    id,
    enabled,
  })
}

export function reorderMasterSources(ids: string[]): Promise<Outcome<MasterSourcesResult>> {
  return client.call(SERVERS_HANDLERS.sourcesReorder, { ids })
}

/**
 * Story 114: the scan's renderer-side transport. No component, no store, no i18n string lives
 * here (D-M) - `startScan`/`readScan` are one-shot calls and `onScanChanged`/`onScanServer` are
 * subscriptions; nothing here polls `scan.read` on a timer ("nothing in the renderer
 * polls for progress" - the scan's own doc, D-C). [[118]] builds its store and view on top of
 * these.
 *
 * `scan.server`'s payload is `ScanServerPush` (`@shared/modules/servers`, review fix: previously
 * this file hand-declared a structurally-identical copy since the main-only `ScanServerResult`
 * type it mirrors, `src/main/modules/servers/scan-runner.ts`, cannot be imported here -
 * `tsconfig.web.json` has no `@main/*` alias and the renderer must never import from `src/main`
 * (electron-arch). The shared type is now the one source of truth both sides alias.
 */

/**
 * Starts a scan (D-G, D-L). `selectedAddress` is optional and passed through as-is -
 * `scanStartInputSchema` (`@shared/modules/servers`) accepts it omitted entirely, same as every
 * other optional-only handler payload in this module.
 *
 * Story 117: `scope` is required here and not defaulted - this file is a thin transport layer,
 * so the choice of "all"/"favourites"/"server" stays visible at each call site (the three Servers
 * view controls) rather than being baked in as a client-side default.
 */
export function startScan(
  scope: ScanScope,
  selectedAddress?: string,
): Promise<Outcome<ScanStartResult>> {
  return client.call(SERVERS_HANDLERS.scanStart, {
    scope,
    selectedAddress,
  })
}

/** Marks/unmarks `address` as a favourite; both resolve to the persisted favourites list. The
 * address is the bare payload (`serverAddressSchema`), same as `readServerDetail` below. */
export function addFavourite(address: string): Promise<Outcome<FavouriteServerEntry[]>> {
  return client.call(SERVERS_HANDLERS.favouritesAdd, address)
}

export function removeFavourite(address: string): Promise<Outcome<FavouriteServerEntry[]>> {
  return client.call(SERVERS_HANDLERS.favouritesRemove, address)
}

/** One-shot catch-up read (D-D) for a renderer that mounts mid-scan - never polled. */
export function readScan(): Promise<Outcome<ScanSnapshot>> {
  return client.call(SERVERS_HANDLERS.scanRead)
}

/** Story 196: switches the browser's mode in main (in memory, never aborts a running scan). */
export function setMode(mode: ServersBrowseMode): Promise<Outcome<void>> {
  return client.call(SERVERS_HANDLERS.scanSetMode, { mode })
}

/** Subscribes to the scan's own state/progress push (`scan.changed`, D-C). */
export function onScanChanged(listener: (state: ServersScanState) => void): () => void {
  return client.on(SERVERS_EVENTS.scanChanged, listener)
}

/** Subscribes to one scanned server's row the moment it lands (`scan.server`, D-C). */
export function onScanServer(listener: (row: ScanServerPush) => void): () => void {
  return client.on(SERVERS_EVENTS.scanServer, listener)
}

/**
 * Story 115: the scan's settings handlers. `getScanSettings` resolves to the full persisted
 * `ServersScanSettings`; `patchScanSettings` validates and persists a partial patch and resolves to
 * the full merged+persisted settings - the section that calls it re-syncs from this returned value
 * rather than merging the patch locally (`ServersSettingsSection.tsx`'s own discipline).
 */
export function getScanSettings(): Promise<Outcome<ServersScanSettings>> {
  return client.call(SERVERS_HANDLERS.scanGetSettings)
}

export function patchScanSettings(
  patch: Partial<ServersScanSettings>,
): Promise<Outcome<ServersScanSettings>> {
  return client.call(SERVERS_HANDLERS.scanPatchSettings, patch)
}

/**
 * Story 115: tells main whether the Servers view is currently mounted (`true`) or just
 * unmounted (`false`) - `scanCadence.onViewActive()`'s (`main/modules/servers/scan-cadence.ts`)
 * own signal for auto-scan-on-open/auto-refresh timing. The handler itself resolves to nothing
 * (`main/modules/servers/index.ts`'s `scanSetViewActive` handler returns `undefined`), so this
 * resolves `Outcome<void>` - the caller only needs to know the transport succeeded.
 */
export function setScanViewActive(active: boolean): Promise<Outcome<void>> {
  return client.call(SERVERS_HANDLERS.scanSetViewActive, { active })
}

/**
 * Story 119: the persisted list-sort's renderer-side transport, mirroring
 * `getScanSettings`/`patchScanSettings` exactly. `getListSort` resolves to the current
 * `ServerListSort | null` (`null` meaning the default order); `setListSort` persists a new one (or
 * clears it back to the default with `null`) and resolves to what was actually persisted.
 */
export function getListSort(): Promise<Outcome<ServerListSort | null>> {
  return client.call(SERVERS_HANDLERS.listGetSort)
}

export function setListSort(sort: ServerListSort | null): Promise<Outcome<ServerListSort | null>> {
  return client.call(SERVERS_HANDLERS.listSetSort, { sort })
}

/**
 * Story 122: reads one server's detail - the row plus its last-known `serverinfo`, or `null` for
 * an address the scan has no row for at all. `address` is passed through as the bare payload,
 * mirroring `favouritesAdd`/`favouritesRemove`'s `serverAddressSchema` convention (not a `{ address
 * }` wrapper) - `detailReadInputSchema` is that same bare schema.
 */
export function readServerDetail(address: string): Promise<Outcome<ServerDetail | null>> {
  return client.call(SERVERS_HANDLERS.detailRead, address)
}

/**
 * Story 132: the watchlist's own renderer-side transport, mirroring the scan's
 * `startScan`/`readScan`/`onScanChanged` triad above. `add`/`update`/`remove` resolve at the
 * transport level to `Outcome<WatchlistMutationResult>` - a schema/handler-registry failure is
 * `Outcome`'s own concern, while a refused mutation (name too long, duplicate, ...) is the
 * `WatchlistMutationResult`'s own `{ ok: false; reasonKey }`, mirroring `MasterSourcesResult`
 * above. `recheck` is a "please recheck" trigger, not a snapshot - the updated snapshot (if any)
 * arrives later via `watchlist.changed`, exactly like a scan's own `scanStart`/`scan.changed`
 * split.
 */
export function readWatchlist(): Promise<Outcome<WatchlistSnapshot>> {
  return client.call(SERVERS_WATCHLIST_HANDLERS.read)
}

export function addWatchlistEntry(input: {
  name: string
  mode: WatchlistMatchMode
}): Promise<Outcome<WatchlistMutationResult>> {
  return client.call(SERVERS_WATCHLIST_HANDLERS.add, input)
}

export function updateWatchlistEntry(input: {
  id: string
  name: string
  mode: WatchlistMatchMode
}): Promise<Outcome<WatchlistMutationResult>> {
  return client.call(SERVERS_WATCHLIST_HANDLERS.update, input)
}

export function removeWatchlistEntry(id: string): Promise<Outcome<WatchlistMutationResult>> {
  return client.call(SERVERS_WATCHLIST_HANDLERS.remove, { id })
}

export function recheckWatchlistEntry(id: string): Promise<Outcome<ScanStartResult>> {
  return client.call(SERVERS_WATCHLIST_HANDLERS.recheck, { id })
}

/** Subscribes to the watchlist's own push (`watchlist.changed`) - the recomputed snapshot. */
export function onWatchlistChanged(listener: (snapshot: WatchlistSnapshot) => void): () => void {
  return client.on(SERVERS_EVENTS.watchlistChanged, listener)
}

/** Story 197: the four `quickFilters.*` handlers. `list` answers the plain list; the three
 * mutations answer a `QuickFiltersResult` (a refusal carries a reason key, not a thrown error). */
export function listQuickFilters(): Promise<Outcome<QuickFilter[]>> {
  return client.call(SERVERS_HANDLERS.quickFiltersList)
}

export function saveQuickFilter(input: {
  name: string
  criteria: QuickFilterCriteria
  overwrite: boolean
}): Promise<Outcome<QuickFiltersResult>> {
  return client.call(SERVERS_HANDLERS.quickFiltersSave, input)
}

export function renameQuickFilter(input: {
  id: string
  name: string
}): Promise<Outcome<QuickFiltersResult>> {
  return client.call(SERVERS_HANDLERS.quickFiltersRename, input)
}

export function removeQuickFilter(id: string): Promise<Outcome<QuickFiltersResult>> {
  return client.call(SERVERS_HANDLERS.quickFiltersRemove, { id })
}
