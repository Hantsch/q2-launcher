/**
 * `dmflags` decoding — a Quake II deathmatch server reports its ruleset as a single bitmask int
 * in `serverinfo.dmflags`. This module only decodes that bitmask into the vanilla rule ids it
 * carries; it never throws on malformed input, since the value is untrusted data off the wire.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

/** The 16 vanilla dmflags bits, in bit order (bit 0 first). */
export const DMFLAG_BITS = [
  'no-health',
  'no-items',
  'weapons-stay',
  'no-falling',
  'instant-items',
  'same-level',
  'skin-teams',
  'model-teams',
  'no-friendly-fire',
  'spawn-farthest',
  'force-respawn',
  'no-armor',
  'allow-exit',
  'infinite-ammo',
  'quad-drop',
  'fixed-fov'
] as const

export type DmflagId = (typeof DMFLAG_BITS)[number]

const MAX_INT32 = 2 ** 31 - 1
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/

export type DecodedDmflags =
  | { ok: true; value: number; rules: DmflagId[]; unknownBits: number[] }
  | { ok: false; raw: string }

/**
 * Decodes a raw `dmflags` string into the vanilla rule ids its set bits carry, never throwing.
 *
 * `raw` must be a clean non-negative decimal integer no larger than 2^31-1 after trimming
 * surrounding whitespace; anything else (non-numeric text, a negative sign, a float, an empty
 * string) yields `{ ok: false, raw }` rather than a guessed value.
 *
 * On success, `rules` lists the ids of set bits 0-15 (the vanilla table) in bit order, and
 * `unknownBits` lists the 0-based indices of any set bits at position 16 or above - bits the
 * vanilla table does not cover.
 */
export function decodeDmflags(raw: string): DecodedDmflags {
  const trimmed = raw.trim()
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(trimmed)) return { ok: false, raw }

  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value > MAX_INT32) return { ok: false, raw }

  const rules: DmflagId[] = []
  for (let bit = 0; bit < DMFLAG_BITS.length; bit++) {
    if ((value & (1 << bit)) !== 0) rules.push(DMFLAG_BITS[bit] as DmflagId)
  }

  const unknownBits: number[] = []
  for (let bit = DMFLAG_BITS.length; bit <= 30; bit++) {
    if ((value & (1 << bit)) !== 0) unknownBits.push(bit)
  }

  return { ok: true, value, rules, unknownBits }
}
