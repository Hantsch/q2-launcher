// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { DASHBOARD_MODULE_IDS, DEFAULT_HOME_LAYOUT } from '@shared/modules/home'
import type { ModuleId } from '@shared/types/module'

/**
 * Story 087 D6 (AC3/AC6): locks two facts already true from story 086 rather than re-deriving them -
 * this file's job is to make a future accidental change (a third tile id sneaking onto the
 * dashboard, or the default layout's geometry drifting from the prototype) fail a test instead of
 * only showing up in a screenshot review.
 *
 * `jsdom` (rather than this file's otherwise-pure content) and the `q2` bridge stub are needed only
 * because `dashboard-modules.tsx` now imports `PlaytimeTile`/`ConfigProfilesTile` (D6), which reach
 * `window.q2` through `lib/bridge.ts` at module scope - mirrors `Dashboard.test.tsx`'s own stub.
 */
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

const { DASHBOARD_MODULES } = await import('./dashboard-modules')

/**
 * The shell's real module ids (`src/shared/types/module.ts`'s `ModuleId` union), minus `home`
 * itself - `home` is the module that *owns* the dashboard, not one of the planned-but-unbuilt
 * modules a dashboard tile could be confused with. `DashboardModuleId` is a separate, narrower
 * type from `ModuleId` on purpose (a dashboard tile and a shell module are different concepts), so
 * this list is hand-derived from the real union rather than imported - there is no type-level
 * relationship to assert against, only "none of these strings leak into the tile registry".
 */
const OTHER_REAL_MODULE_IDS: Exclude<ModuleId, 'home'>[] = [
  'library',
  'config',
  'downloads',
  'mods',
  'assets',
]

describe('the dashboard registry (AC3, AC6)', () => {
  it('the dashboard offers exactly playtime and config profiles', () => {
    expect([...DASHBOARD_MODULE_IDS].sort()).toEqual(['configProfiles', 'playtime'])
    expect(Object.keys(DASHBOARD_MODULES).sort()).toEqual(['configProfiles', 'playtime'])
  })

  it('none of the other real module ids appear in the dashboard registry or its id list', () => {
    const idListStrings: string[] = [...DASHBOARD_MODULE_IDS]
    const registryStrings = Object.keys(DASHBOARD_MODULES)

    for (const otherId of OTHER_REAL_MODULE_IDS) {
      expect(idListStrings).not.toContain(otherId)
      expect(registryStrings).not.toContain(otherId)
    }
  })

  it('every registry entry\'s own id matches the key it is stored under', () => {
    for (const id of DASHBOARD_MODULE_IDS) {
      expect(DASHBOARD_MODULES[id].id).toBe(id)
    }
  })

  it('a fresh profile starts with two 6x5 tiles side by side under the hero', () => {
    // Matches docs/prototypes/home/a-large-hero.html: a 320px hero above a two-tile row, each tile
    // 6 columns wide (half of the 12-column grid) and 5 rows tall - "a 5-row tile fits fully, a
    // second row of tiles does not".
    expect(DEFAULT_HOME_LAYOUT.tiles).toHaveLength(2)

    const playtime = DEFAULT_HOME_LAYOUT.tiles.find((tile) => tile.moduleId === 'playtime')
    const configProfiles = DEFAULT_HOME_LAYOUT.tiles.find(
      (tile) => tile.moduleId === 'configProfiles',
    )

    expect(playtime).toEqual({ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 })
    expect(configProfiles).toEqual({ moduleId: 'configProfiles', x: 6, y: 0, w: 6, h: 5 })
  })
})
