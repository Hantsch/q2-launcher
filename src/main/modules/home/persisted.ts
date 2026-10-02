import { z } from 'zod'
import {
  DASHBOARD_MODULE_IDS,
  DEFAULT_HOME_LAYOUT,
  type HomeLayout,
  type TilePlacement,
} from '@shared/modules/home'
import { parseKeyedRows } from '../../lib/forgiving'
import type { StateSection, StateSectionSpec, StateStore } from '../../services/state'

/**
 * One persisted tile placement. `moduleId` is checked against `DASHBOARD_MODULE_IDS`
 * here - a row naming a module this build doesn't know (e.g. saved by a newer launcher, or a typo
 * from hand-editing `state.json`) fails this schema and is dropped by `parseHomeLayout`, exactly
 * like `parseConfigProfile`/`configProfileSchema` drop a malformed profile row. The four
 * coordinates are checked as non-negative integers - cells are always whole, non-negative numbers
 * (see `TilePlacement`'s own doc comment and every real producer of one: `layout.ts`'s
 * `place`/`move`/`resize`, `DEFAULT_HOME_LAYOUT`) - which is the actual invariant this schema can
 * check without importing grid geometry into a shape check. It deliberately does not bound a
 * coordinate against `GRID_COLUMNS`: an over-wide-but-otherwise-well-formed tile is something a
 * user could produce transiently mid-resize, and the layout engine (`layout.ts`) is what enforces
 * that bound on any change, not this schema, and nothing here re-clamps a value that already made
 * it into `state.json`.
 */
const tilePlacementSchema: z.ZodType<TilePlacement> = z.object({
  moduleId: z.enum(DASHBOARD_MODULE_IDS),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().nonnegative(),
  h: z.number().int().nonnegative(),
})

/** A deep clone, so nothing that mutates a persisted layout can corrupt the shipped default. */
export function defaultHomeLayout(): HomeLayout {
  return { tiles: DEFAULT_HOME_LAYOUT.tiles.map((tile) => ({ ...tile })) }
}

/**
 * The persisted `homeLayout` top-level `state.json` key. Rows go
 * through `lib/forgiving.ts`'s row-level drop: a tile naming an unknown `moduleId`, or one
 * that is otherwise malformed, is dropped on its own rather than costing the whole layout. A
 * second row naming a `moduleId` that already appeared earlier in the array is dropped too (first
 * occurrence wins) - the renderer keys tiles by `moduleId` in a `.map()`, so a duplicate would
 * produce duplicate React keys; `layout.ts`'s own `place()` already refuses to create one from the
 * app itself, so this only guards against a hand-edited or foreign file.
 *
 * Deliberately does **not** merge the parsed result with `DEFAULT_HOME_LAYOUT` - a layout that
 * legitimately has only one tile (the user removed the other one) must stay a one-tile layout
 * after a reload, not get padded back to two. Only a value that fails to parse as "an object with
 * a `tiles` array" at all falls back to `DEFAULT_HOME_LAYOUT` wholesale - a missing/garbled key
 * reads the same as "never customised", which is exactly what a fresh install has.
 */
export function parseHomeLayout(raw: unknown): HomeLayout {
  const envelope = z.object({ tiles: z.array(z.unknown()) }).safeParse(raw)
  if (!envelope.success) return defaultHomeLayout()
  return {
    tiles: parseKeyedRows(tilePlacementSchema, envelope.data.tiles, { keyOf: (t) => t.moduleId }),
  }
}

const homeLayoutSpec: StateSectionSpec<HomeLayout> = {
  key: 'homeLayout',
  parse: parseHomeLayout,
  defaults: defaultHomeLayout,
}

/** The home module's persisted dashboard layout; the same handle on every call for one store. */
export function homeState(state: StateStore): StateSection<HomeLayout> {
  return state.section(homeLayoutSpec)
}
