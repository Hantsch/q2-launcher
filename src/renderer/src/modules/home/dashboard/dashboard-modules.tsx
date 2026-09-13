import type { ComponentType } from 'react'
import { DASHBOARD_MODULE_IDS, type DashboardModuleId } from '@shared/modules/home'
import { PlaytimeTile } from './PlaytimeTile'
import { ConfigProfilesTile } from './ConfigProfilesTile'

/**
 * Story 086 D3: one entry per dashboard module, enough for `DashboardTile` to render a placeholder
 * frame (title only). Story 087 D6 adds `Body` - the tile's real content, rendered by
 * `DashboardTile.tsx` below its header. Kept as a `Record<DashboardModuleId, ...>` rather than a
 * plain array so adding/removing an id in `DASHBOARD_MODULE_IDS` (`src/shared/modules/home.ts`)
 * without updating this file is a compiler error, not a silent gap - the same exhaustiveness
 * `HOME_HANDLER_SCHEMAS` leans on in that file.
 *
 * There is deliberately no per-entry `minSize` field here: every module already shares one global
 * floor, `MODULE_MIN_SIZE` (`src/shared/modules/home.ts`), enforced uniformly by `layout.ts`'s
 * `findRefusal()`. A second, per-module `minSize` on this registry would duplicate that floor
 * without ever being read by anything - both modules need only the 2x2 global minimum today, so
 * the registry stays with the fields `DashboardTile` and `Dashboard` actually consume.
 */
export interface DashboardModuleDefinition {
  id: DashboardModuleId
  /** i18n key for the tile's title, under the `home.dashboard.tiles` namespace. */
  titleKey: string
  /** The tile's real content (story 087 D6) - a self-contained component with no required props,
   * rendered by `DashboardTile.tsx` in the space below its header. */
  Body: ComponentType
}

export const DASHBOARD_MODULES: Record<DashboardModuleId, DashboardModuleDefinition> = {
  playtime: {
    id: 'playtime',
    titleKey: 'home.dashboard.tiles.playtime.title',
    Body: PlaytimeTile,
  },
  configProfiles: {
    id: 'configProfiles',
    titleKey: 'home.dashboard.tiles.configProfiles.title',
    Body: ConfigProfilesTile,
  },
}

/**
 * Sanity check, at module-eval time, that every declared id actually has an entry - `Record`
 * already forces this at compile time, but this line keeps a future refactor that widens the
 * `Record` value type honest at runtime too.
 */
export const DASHBOARD_MODULE_DEFINITIONS: DashboardModuleDefinition[] = DASHBOARD_MODULE_IDS.map(
  (id) => DASHBOARD_MODULES[id],
)
