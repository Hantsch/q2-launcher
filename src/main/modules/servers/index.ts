import { SERVERS_HANDLERS, serversNoInputSchema, type ServersOverview } from '@shared/modules/servers'
import type { MainModule } from '../types'

/**
 * The servers module - story 106 D2 registers its main half with a single
 * handler, `overview.read`, answering a hardcoded zeroed overview. There is
 * no scanning yet: no `dgram`, no `fetch`, no state - that is 9.2+. Mirrors
 * `src/main/modules/home/index.ts`'s shape - `setup()` registers handlers
 * and does nothing else.
 */
export const serversModule: MainModule = {
  id: 'servers',

  setup({ handle, log }) {
    const overview: ServersOverview = {
      scanning: false,
      knownServerCount: 0,
      lastScanAt: null,
    }

    handle(SERVERS_HANDLERS.overviewRead, serversNoInputSchema, () => overview)

    log.debug('servers module ready')
  },
}
