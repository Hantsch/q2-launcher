import { SERVERS_HANDLERS, type ServersOverview } from '@shared/modules/servers'
import type { Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/** Typed client for the servers module's handlers (story 106 D3). One function per handler in its
 * contract - mirrors `modules/downloads/client.ts`. */
export function getServersOverview(): Promise<Outcome<ServersOverview>> {
  return callModule<ServersOverview>('servers', SERVERS_HANDLERS.overviewRead)
}
