/**
 * Press/release pairing for `+x`/`-x` alias entries (story 041 D5).
 *
 * A real config commonly defines a press half and a release half of one action as two separate
 * `alias` definitions - `alias +slow "..."` / `alias -slow "..."`, bound once (`bind SHIFT +slow`)
 * so the engine calls `+slow` on key-down and `-slow` on key-up. `alias-import.ts` (D3) turns each
 * definition into its own `ConfigAction`, sign kept in `name` verbatim - it does not know, and does
 * not need to know, that two of those entries belong together.
 *
 * This is the one place that does: `pressReleasePairs` looks at a list of `ConfigAction`s purely by
 * their `name` (never their `kind`, `catalogId` or anything else) and reports which ones share a
 * base name across a `+`/`-` pair. Nothing is written back and no new field is added to
 * `ConfigAction` - the pairing is derived fresh from whatever list a caller hands in, so story 045
 * can later introduce a real, first-class press/release entry kind without a state migration: this
 * module simply stops being called once that exists.
 */

import type { ConfigAction } from '@shared/modules/config'

/** One matched pair: an action named `+<base>` and one named `-<base>`. */
export interface PressReleasePair {
  /** The shared name with its leading sign stripped, e.g. `slow` for `+slow`/`-slow`. */
  base: string
  press: ConfigAction
  release: ConfigAction
}

export interface PressReleasePairsResult {
  /** Every base name with both halves present, in the order the press half is first seen in `actions`. */
  pairs: PressReleasePair[]
  /**
   * Everything not part of a matched pair, in input order: a `+x` with no matching `-x`, a `-x`
   * with no matching `+x`, and any action whose name carries no leading `+`/`-` at all.
   */
  unmatched: ConfigAction[]
}

interface ParsedName {
  sign: '+' | '-'
  base: string
}

/** `+slow` -> `{ sign: '+', base: 'slow' }`; anything without a leading `+`/`-` (or nothing after
 * it) is not a press/release candidate at all. */
function parseName(name: string): ParsedName | null {
  const sign = name.charAt(0)
  if (sign !== '+' && sign !== '-') return null
  const base = name.slice(1)
  return base.length > 0 ? { sign, base } : null
}

/**
 * Pairs `+x`/`-x` entries in `actions` by base name. The only function in the codebase that knows
 * this convention for pairing purposes - `ControlsTab.tsx` calls this rather than inspecting a
 * `name`'s leading character itself.
 */
export function pressReleasePairs(actions: readonly ConfigAction[]): PressReleasePairsResult {
  const releaseByBase = new Map<string, ConfigAction>()
  for (const action of actions) {
    const parsed = parseName(action.name)
    if (parsed?.sign === '-' && !releaseByBase.has(parsed.base)) {
      releaseByBase.set(parsed.base, action)
    }
  }

  const pairs: PressReleasePair[] = []
  const pairedIds = new Set<string>()
  const seenPressBases = new Set<string>()

  for (const action of actions) {
    const parsed = parseName(action.name)
    if (parsed?.sign !== '+' || seenPressBases.has(parsed.base)) continue
    seenPressBases.add(parsed.base)
    const release = releaseByBase.get(parsed.base)
    if (!release) continue
    pairs.push({ base: parsed.base, press: action, release })
    pairedIds.add(action.id)
    pairedIds.add(release.id)
  }

  const unmatched = actions.filter((action) => !pairedIds.has(action.id))
  return { pairs, unmatched }
}
