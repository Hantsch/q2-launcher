import {
  REPLAYS_HANDLERS,
  nameTemplatesAddSchema,
  nameTemplatesRemoveSchema,
  nameTemplatesReorderSchema,
  nameTemplatesResetSchema,
  nameTemplatesUpdateSchema,
  replaysNoInputSchema,
} from '@shared/modules/replays'
import type { MainModule } from '../types'
import {
  nameTemplatesAdd,
  nameTemplatesList,
  nameTemplatesRemove,
  nameTemplatesReorder,
  nameTemplatesReset,
  nameTemplatesRestore,
  nameTemplatesUpdate,
} from './name-templates'

/**
 * The replays module - story 135 D2 registered its main half with a single handler,
 * `overview.read`, answering a hardcoded zeroed overview. There is no demo scan yet: no
 * filesystem access, no `process.platform` checks - that is a later deliverable of this story.
 * Mirrors `src/main/modules/servers/index.ts`'s D2 shape (`overview.read` answering a hardcoded
 * zeroed overview before any real service exists) and `src/main/modules/home/index.ts`'s shape -
 * `setup()` registers handlers and does nothing else.
 *
 * Story 140 D2 adds the seven `nameTemplates.*` handlers on top - all the rules live in
 * `name-templates.ts` (read the persisted state, run the op, persist on success); this file just
 * wires each handler's payload schema to its handler body, same as `servers/index.ts` does for
 * `sources.*`.
 */
export const replaysModule: MainModule = {
  id: 'replays',

  setup({ handle, app, log }) {
    handle(REPLAYS_HANDLERS.overviewRead, replaysNoInputSchema, () => ({
      scanning: false,
      demoCount: 0,
    }))

    handle(REPLAYS_HANDLERS.nameTemplatesList, replaysNoInputSchema, () => nameTemplatesList(app))
    handle(REPLAYS_HANDLERS.nameTemplatesAdd, nameTemplatesAddSchema, (payload) =>
      nameTemplatesAdd(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesUpdate, nameTemplatesUpdateSchema, (payload) =>
      nameTemplatesUpdate(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesRemove, nameTemplatesRemoveSchema, (payload) =>
      nameTemplatesRemove(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesReorder, nameTemplatesReorderSchema, (payload) =>
      nameTemplatesReorder(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesReset, nameTemplatesResetSchema, (payload) =>
      nameTemplatesReset(app, payload),
    )
    handle(REPLAYS_HANDLERS.nameTemplatesRestore, replaysNoInputSchema, () =>
      nameTemplatesRestore(app),
    )

    log.debug('replays module ready')
  },
}
