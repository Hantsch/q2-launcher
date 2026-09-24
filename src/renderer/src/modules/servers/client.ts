import {
  SERVERS_HANDLERS,
  type MasterSource,
  type MasterSourcesResult,
  type MasterSourceType,
  type ServersOverview,
} from '@shared/modules/servers'
import type { Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

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
