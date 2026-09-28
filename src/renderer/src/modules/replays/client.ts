import { REPLAYS_HANDLERS, type ReplaysOverview } from '@shared/modules/replays'
import type { Outcome } from '@shared/types'
import { callModule } from '../moduleClient'

/** Typed client for the replays module's handlers (story 135 D3). One function per handler in its
 * contract - mirrors `modules/servers/client.ts`. */
export function getReplaysOverview(): Promise<Outcome<ReplaysOverview>> {
  return callModule<ReplaysOverview>('replays', REPLAYS_HANDLERS.overviewRead)
}
