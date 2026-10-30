import { z } from 'zod'

/** How a demo is played: in the native Q2PRO engine window, or inside the launcher. */
export const PLAYER_MODES = ['engine', 'integrated'] as const
export type PlayerMode = (typeof PLAYER_MODES)[number]
export const playerModeSchema = z.enum(PLAYER_MODES)
export const DEFAULT_PLAYER_MODE: PlayerMode = 'engine'
