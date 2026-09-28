import { REPLAYS_HANDLERS, replaysNoInputSchema } from '@shared/modules/replays'
import type { MainModule } from '../types'

/**
 * The replays module - story 135 D2 registers its main half with a single handler,
 * `overview.read`, answering a hardcoded zeroed overview. There is no demo scan yet: no
 * filesystem access, no `process.platform` checks, no state - that is a later deliverable of this
 * story. Mirrors `src/main/modules/servers/index.ts`'s D2 shape (`overview.read` answering a
 * hardcoded zeroed overview before any real service exists) and `src/main/modules/home/index.ts`'s
 * shape - `setup()` registers handlers and does nothing else.
 */
export const replaysModule: MainModule = {
  id: 'replays',

  setup({ handle, log }) {
    handle(REPLAYS_HANDLERS.overviewRead, replaysNoInputSchema, () => ({
      scanning: false,
      demoCount: 0,
    }))

    log.debug('replays module ready')
  },
}
