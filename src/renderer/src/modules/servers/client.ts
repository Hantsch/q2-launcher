import {
  SERVERS_EVENTS,
  SERVERS_HANDLERS,
  type MasterSource,
  type MasterSourcesResult,
  type MasterSourceType,
  type ScanScope,
  type ScanServerPush,
  type ScanSnapshot,
  type ScanStartResult,
  type ServerDetail,
  type ServerListSort,
  type ServersOverview,
  type ServersScanSettings,
  type ServersScanState,
} from '@shared/modules/servers'
import type { Outcome } from '@shared/types'
import { callModule, onModuleEvent } from '../moduleClient'

/** Typed client for the servers module's handlers (story 106 D3). One function per handler in its
 * contract - mirrors `modules/downloads/client.ts`. */
export function getServersOverview(): Promise<Outcome<ServersOverview>> {
  return callModule<ServersOverview>('servers', SERVERS_HANDLERS.overviewRead)
}

/**
 * Story 111 D4: the five `sources.*` handlers. Each resolves to `Outcome<T>` at the transport
 * level (`callModule`'s own contract - a schema/handler-registry failure) wrapping the *domain*
 * result underneath: `sourcesList` always succeeds and answers the list directly, the four
 * mutations answer a `MasterSourcesResult` (its own `ok`/`reason` - a refusal, not a thrown
 * error) so the section can tell "IPC failed" apart from "the edit was refused" without
 * flattening one into the other.
 */
export function listMasterSources(): Promise<Outcome<MasterSource[]>> {
  return callModule<MasterSource[]>('servers', SERVERS_HANDLERS.sourcesList)
}

export function addMasterSource(input: {
  type: MasterSourceType
  address: string
}): Promise<Outcome<MasterSourcesResult>> {
  return callModule<MasterSourcesResult>('servers', SERVERS_HANDLERS.sourcesAdd, input)
}

export function removeMasterSource(id: string): Promise<Outcome<MasterSourcesResult>> {
  return callModule<MasterSourcesResult>('servers', SERVERS_HANDLERS.sourcesRemove, { id })
}

export function updateMasterSourceAddress(input: {
  id: string
  type: MasterSourceType
  address: string
}): Promise<Outcome<MasterSourcesResult>> {
  return callModule<MasterSourcesResult>('servers', SERVERS_HANDLERS.sourcesUpdate, input)
}

export function setMasterSourceEnabled(
  id: string,
  enabled: boolean,
): Promise<Outcome<MasterSourcesResult>> {
  return callModule<MasterSourcesResult>('servers', SERVERS_HANDLERS.sourcesUpdate, {
    id,
    enabled,
  })
}

export function reorderMasterSources(ids: string[]): Promise<Outcome<MasterSourcesResult>> {
  return callModule<MasterSourcesResult>('servers', SERVERS_HANDLERS.sourcesReorder, { ids })
}

/**
 * Story 114 D7: the scan's renderer-side transport. No component, no store, no i18n string lives
 * here (D-M) - `startScan`/`readScan` are one-shot calls and `onScanChanged`/`onScanServer` are
 * subscriptions; nothing here polls `scan.read` on a timer, per AC5 ("nothing in the renderer
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
 * Story 117 D4: `scope` is required here and not defaulted - this file is a thin transport layer,
 * so the choice of "all"/"favourites"/"server" stays visible at each call site (the three Servers
 * view controls, D5) rather than being baked in as a client-side default.
 */
export function startScan(
  scope: ScanScope,
  selectedAddress?: string,
): Promise<Outcome<ScanStartResult>> {
  return callModule<ScanStartResult>('servers', SERVERS_HANDLERS.scanStart, {
    scope,
    selectedAddress,
  })
}

/** One-shot catch-up read (D-D) for a renderer that mounts mid-scan - never polled. */
export function readScan(): Promise<Outcome<ScanSnapshot>> {
  return callModule<ScanSnapshot>('servers', SERVERS_HANDLERS.scanRead)
}

/** Subscribes to the scan's own state/progress push (`scan.changed`, D-C). */
export function onScanChanged(listener: (state: ServersScanState) => void): () => void {
  return onModuleEvent<ServersScanState>('servers', SERVERS_EVENTS.scanChanged, listener)
}

/** Subscribes to one scanned server's row the moment it lands (`scan.server`, D-C). */
export function onScanServer(listener: (row: ScanServerPush) => void): () => void {
  return onModuleEvent<ScanServerPush>('servers', SERVERS_EVENTS.scanServer, listener)
}

/**
 * Story 115 D4: the scan's settings handlers. `getScanSettings` resolves to the full persisted
 * `ServersScanSettings`; `patchScanSettings` validates and persists a partial patch and resolves to
 * the full merged+persisted settings - the section that calls it re-syncs from this returned value
 * rather than merging the patch locally (`ServersSettingsSection.tsx`'s own discipline).
 */
export function getScanSettings(): Promise<Outcome<ServersScanSettings>> {
  return callModule<ServersScanSettings>('servers', SERVERS_HANDLERS.scanGetSettings)
}

export function patchScanSettings(
  patch: Partial<ServersScanSettings>,
): Promise<Outcome<ServersScanSettings>> {
  return callModule<ServersScanSettings>('servers', SERVERS_HANDLERS.scanPatchSettings, patch)
}

/**
 * Story 115 D5: tells main whether the Servers view is currently mounted (`true`) or just
 * unmounted (`false`) - `scanCadence.onViewActive()`'s (`main/modules/servers/scan-cadence.ts`)
 * own signal for auto-scan-on-open/auto-refresh timing. The handler itself resolves to nothing
 * (`main/modules/servers/index.ts`'s `scanSetViewActive` handler returns `undefined`), so this
 * resolves `Outcome<void>` - the caller only needs to know the transport succeeded.
 */
export function setScanViewActive(active: boolean): Promise<Outcome<void>> {
  return callModule<void>('servers', SERVERS_HANDLERS.scanSetViewActive, { active })
}

/**
 * Story 119 D3: the persisted list-sort's renderer-side transport, mirroring
 * `getScanSettings`/`patchScanSettings` exactly. `getListSort` resolves to the current
 * `ServerListSort | null` (`null` meaning the default order); `setListSort` persists a new one (or
 * clears it back to the default with `null`) and resolves to what was actually persisted.
 */
export function getListSort(): Promise<Outcome<ServerListSort | null>> {
  return callModule<ServerListSort | null>('servers', SERVERS_HANDLERS.listGetSort)
}

export function setListSort(sort: ServerListSort | null): Promise<Outcome<ServerListSort | null>> {
  return callModule<ServerListSort | null>('servers', SERVERS_HANDLERS.listSetSort, { sort })
}

/**
 * Story 122 D3: reads one server's detail - the row plus its last-known `serverinfo`, or `null` for
 * an address the scan has no row for at all. `address` is passed through as the bare payload,
 * mirroring `favouritesAdd`/`favouritesRemove`'s `serverAddressSchema` convention (not a `{ address
 * }` wrapper) - `detailReadInputSchema` is that same bare schema.
 */
export function readServerDetail(address: string): Promise<Outcome<ServerDetail | null>> {
  return callModule<ServerDetail | null>('servers', SERVERS_HANDLERS.detailRead, address)
}
