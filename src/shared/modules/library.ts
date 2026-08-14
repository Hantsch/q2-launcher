import type { EngineKind } from '../types'

/**
 * The library module's contract.
 *
 * Each module owns one file under `src/shared/modules/` describing the data it
 * exchanges with the UI. Main implements the handlers, the renderer gets a typed
 * client, and neither side imports the other's code - this file is the only
 * thing they share.
 */
export const LIBRARY_HANDLERS = {
  stats: 'stats',
} as const

export interface LibraryStats {
  total: number
  ok: number
  needsAttention: number
  missing: number
  favorites: number
  totalPlaytimeSeconds: number
  byEngine: Partial<Record<EngineKind, number>>
}
