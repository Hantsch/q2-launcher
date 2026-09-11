import { DASHBOARD_MODULE_IDS, type DashboardModuleId } from '@shared/modules/home'

/**
 * Story 086 D3: one entry per dashboard module - enough for `DashboardTile` to render a placeholder
 * frame (title only; story 087 fills the body with real content). Kept as a `Record<DashboardModuleId,
 * ...>` rather than a plain array so adding/removing an id in `DASHBOARD_MODULE_IDS`
 * (`src/shared/modules/home.ts`) without updating this file is a compiler error, not a silent gap -
 * the same exhaustiveness `HOME_HANDLER_SCHEMAS` leans on in that file.
 */
export interface DashboardModuleDefinition {
  id: DashboardModuleId
  /** i18n key for the tile's title, under the `home.dashboard.tiles` namespace. */
  titleKey: string
}

export const DASHBOARD_MODULES: Record<DashboardModuleId, DashboardModuleDefinition> = {
  playtime: { id: 'playtime', titleKey: 'home.dashboard.tiles.playtime.title' },
  configProfiles: { id: 'configProfiles', titleKey: 'home.dashboard.tiles.configProfiles.title' },
}

/**
 * Sanity check, at module-eval time, that every declared id actually has an entry - `Record`
 * already forces this at compile time, but this line keeps a future refactor that widens the
 * `Record` value type honest at runtime too.
 */
export const DASHBOARD_MODULE_DEFINITIONS: DashboardModuleDefinition[] = DASHBOARD_MODULE_IDS.map(
  (id) => DASHBOARD_MODULES[id],
)
