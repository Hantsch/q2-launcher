import { z } from 'zod'
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

/** `stats` derives everything from the shell's own state, so it takes no payload. */
export const LIBRARY_HANDLER_SCHEMAS = {
  [LIBRARY_HANDLERS.stats]: z.void(),
} satisfies Record<(typeof LIBRARY_HANDLERS)[keyof typeof LIBRARY_HANDLERS], z.ZodTypeAny>

type LibrarySchemas = typeof LIBRARY_HANDLER_SCHEMAS

/** The library module's typed contract; `req` is each schema's parsed output. */
export type LibraryContract = {
  handlers: {
    [LIBRARY_HANDLERS.stats]: { req: z.infer<LibrarySchemas['stats']>; res: LibraryStats }
  }
  events: {}
}

export interface LibraryStats {
  total: number
  ok: number
  needsAttention: number
  missing: number
  favorites: number
  totalPlaytimeSeconds: number
  byEngine: Partial<Record<EngineKind, number>>
  /** The installation with the newest `lastPlayedAt`, if any installation has ever been played. */
  lastSession?: { installationId: string; name: string; at: string }
}
