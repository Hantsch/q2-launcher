import {
  SERVERS_EVENTS,
  SERVERS_HANDLERS,
  type MasterSource,
  type MasterSourcesResult,
  type MasterSourceType,
  type ScanServerPush,
  type ScanSnapshot,
  type ScanStartResult,
  type ServersOverview,
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
 * Starts a scan (D-G, D-L). `selectedAddress` is optional and wrapped only when present -
 * `scanStartInputSchema` (`@shared/modules/servers`) accepts the payload omitted entirely, same as
 * every other optional-only handler payload in this module.
 */
export function startScan(selectedAddress?: string): Promise<Outcome<ScanStartResult>> {
  return callModule<ScanStartResult>(
    'servers',
    SERVERS_HANDLERS.scanStart,
    selectedAddress ? { selectedAddress } : undefined,
  )
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
