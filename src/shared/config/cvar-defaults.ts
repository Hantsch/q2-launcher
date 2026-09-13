/**
 * Story 048 D1: the shared rule for "is this cvar value the default" and "what should the writer
 * put in the file for it" — the two questions `render.ts`'s cvar section (D2/D3) and any future
 * caller need answered the same way, so this is the one place that answers them.
 *
 * `sameValue` below is copied, not imported, from `cvar-facts.ts`'s private helper of the same
 * name (also independently re-derived in `cvar-rows.ts` as its own `sameValue`): numeric values
 * compare numerically (`"1.0"` equals `"1"`), everything else compares trimmed and
 * case-insensitively. Not exported from either of those modules for one caller — same precedent
 * both existing copies already set.
 *
 * `isDefaultValue` below overrides that case-insensitive fallback for `kind: 'text'` cvars only
 * (e.g. `name`, where the stored value's casing is meaningful, unlike an engine-keyword-style
 * `choice`) — see that function's doc comment.
 */

import type { CvarDef } from './cvar-facts'
import { findCvar } from './cvar-catalog'

/** Numeric-aware, case-insensitive equality — see the file doc comment for why this is a third
 * copy of the same rule rather than an import. */
function sameValue(a: string, b: string): boolean {
  const na = Number(a)
  const nb = Number(b)
  if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
    return na === nb
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Normalizes a raw value per `def.kind`, mirroring `cvar-rows.ts`'s `normalizeCvarValue` (also not
 * imported — that module lives under `renderer/`, which this shared file cannot depend on; see the
 * file doc comment). Only `toggle` needs real normalization, and only for *recognized* boolean
 * spellings: `"1"`/`"true"`/`"TRUE"`/etc. map to canonical `"1"`, `"0"`/`"false"`/`"FALSE"`/etc. map
 * to canonical `"0"`. Some catalogue cvars are `kind: 'toggle'` for UI-styling reasons but actually
 * accept more than two values (e.g. `gl_shadows` takes 0/1/2, `gl_swapinterval` takes -1..3) — an
 * unrecognized value must be left as its own trimmed literal, never force-collapsed to `"0"`, or a
 * deliberately-chosen non-boolean value would be misjudged as the (often `"0"`) default and get
 * silently stripped. Every other kind is just trimmed, with `sameValue` absorbing remaining
 * numeric-formatting differences.
 */
function normalizeForKind(def: CvarDef, rawValue: string): string {
  const trimmed = rawValue.trim()
  if (def.kind === 'toggle') {
    const lower = trimmed.toLowerCase()
    if (lower === '1' || lower === 'true') return '1'
    if (lower === '0' || lower === 'false') return '0'
    return trimmed
  }
  return trimmed
}

/**
 * Whether `value` is `def`'s default value.
 *
 * An empty or whitespace-only `value` is always the default: it means "nothing stored", which has
 * no way to differ from `def.default` regardless of what that default is.
 *
 * The comparison is kind-aware for non-numeric kinds: `kind: 'text'` cvars (e.g. `name`) compare
 * case-sensitively, because case is meaningful in the stored value (a player's display name), while
 * `kind: 'choice'` and everything else non-numeric compares case-insensitively, matching engine
 * constants that are case-insensitive by convention (e.g. `GL_LINEAR_MIPMAP_LINEAR`).
 */
export function isDefaultValue(def: CvarDef, value: string): boolean {
  if (value.trim() === '') return true
  const normValue = normalizeForKind(def, value)
  const normDefault = normalizeForKind(def, def.default)
  if (def.kind === 'text') {
    return normValue === normDefault
  }
  return sameValue(normValue, normDefault)
}

/**
 * The value to write into the rendered `.cfg` for this catalogue cvar def: `stored` verbatim when
 * there is one, `def.default` when there is effectively nothing stored (`stored` is `undefined`,
 * empty, or whitespace-only).
 *
 * Never re-normalizes a real stored value — only the "nothing there" case falls back, so a value
 * the user actually chose is written exactly as chosen.
 */
export function writeValueFor(def: CvarDef, stored: string | undefined): string {
  if (stored === undefined || stored.trim() === '') return def.default
  return stored
}

/**
 * `cvars` with every catalogue cvar at its default value removed, leaving everything else — value,
 * casing, key — untouched.
 *
 * Lookup goes through `findCvar` (case-insensitive by cvar name) so this file can never disagree
 * with the catalogue's own definition of "which cvar is this". A key `findCvar` does not recognize
 * is left alone unconditionally, even when its value is empty or whitespace — it is not a
 * catalogue default to strip, just an unrecognized cvar the file still has to carry.
 *
 * Returns a new map; `cvars` itself is never mutated.
 */
export function stripCatalogDefaults(cvars: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(cvars)) {
    const def = findCvar(name)
    if (def && isDefaultValue(def, value)) continue
    result[name] = value
  }
  return result
}
