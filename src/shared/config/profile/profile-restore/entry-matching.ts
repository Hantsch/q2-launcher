import {
  type RestoreAliasLine,
  type RestoreCommentLine,
  type RestoreSourcePosition,
  type RestoreWarning,
  type Section,
  sectionFor,
  sectionEnd,
  type TaggedLine,
  type UnboundEntryLine,
  type EntryGroup,
} from './types'
import { sectionCategoryKey } from './categories'
import { foldedAliasBody } from './entry-build'
import { type TwoPartMerge, claimsAKey } from './two-part'

// Entry matching: the state `groupEntryLines` phases share, and the rules that decide which group
// a line joins.

/**
 * Everything `groupEntryLines`' phases share. Every collection is created once and only mutated in
 * place, so a phase always sees what the earlier phases put there.
 */
export interface EntryGroupingState {
  readonly layerSections: readonly Section[]
  readonly sections: readonly Section[]
  readonly warnings: RestoreWarning[]
  readonly consumed: RestoreSourcePosition[]
  /** Category scope -> (alias name / bind value -> the group). */
  readonly groups: Map<string, Map<string, EntryGroup>>
  /** Alias lines carrying no `[q2l` at all - recovered through inference by the caller. */
  readonly untaggedAliases: RestoreAliasLine[]
  /** The owned alias lines, collected before any is grouped (see `indexOwnedAliasNames`). */
  readonly aliasLines: TaggedLine<RestoreAliasLine>[]
  /** The three per-line-kind chains `orderGroupsByFile` orders by: each group in the order its first
   * line of that kind appears, collected in document order (positions alone need a cross-file order). */
  readonly chains: { aliases: EntryGroup[]; binds: EntryGroup[]; anchors: EntryGroup[] }
  /** Category scope -> every owned alias name in it. */
  readonly ownedAliasNames: Map<string, Set<string>>
  /** The accepted two-part merges, filled by `recognizeMerges`. */
  readonly merges: TwoPartMerge[]
  /** The non-primary half of every accepted merge - a group that is no longer an entry of its own. */
  readonly halfGroups: Set<EntryGroup>
  /** Every group a merge consumed, `primary` included - the groups `buildTwoPartEntry`, not
   * `buildEntry`, speaks for, and which therefore read no unbound line at all (`matchUnbound`). */
  readonly twoPartGroups: Set<EntryGroup>
}

export function createEntryGroupingState(
  layerSections: readonly Section[],
  sections: readonly Section[],
  warnings: RestoreWarning[],
  consumed: RestoreSourcePosition[],
): EntryGroupingState {
  return {
    layerSections,
    sections,
    warnings,
    consumed,
    groups: new Map(),
    untaggedAliases: [],
    aliasLines: [],
    chains: { aliases: [], binds: [], anchors: [] },
    ownedAliasNames: new Map(),
    merges: [],
    halfGroups: new Set(),
    twoPartGroups: new Set(),
  }
}

/**
 * Find-or-create, by category scope then the line's own name/value. Nested maps, not a composite
 * string key: a bind value is arbitrary config text, so no printable separator is safe, and the
 * per-category map is `matchAnchor`'s candidate set. The group's `key` stays the bare file datum.
 */
export function groupFor(state: EntryGroupingState, category: string, key: string): EntryGroup {
  let scope = state.groups.get(category)
  if (!scope) {
    scope = new Map<string, EntryGroup>()
    state.groups.set(category, scope)
  }
  const existing = scope.get(key)
  if (existing) return existing
  const created: EntryGroup = { key, aliases: [], binds: [], anchors: [], unbounds: [] }
  scope.set(key, created)
  return created
}

/** The category scope a line sits in - the key `matchAnchor` scopes an anchor by, so an entry's own
 * lines and its anchors are scoped identically. */
export function categoryKeyOf(state: EntryGroupingState, position: RestoreSourcePosition): string {
  return sectionCategoryKey(sectionFor(state.sections, position))
}

/** Every group built so far, in creation order (category first seen, then name first seen within
 * it) - the fallback order `orderGroupsByFile` breaks ties with. */
export function allGroups(state: EntryGroupingState): EntryGroup[] {
  return [...state.groups.values()].flatMap((scope) => [...scope.values()])
}

/**
 * A line inside a layer section belongs to the layer, not to an entry: `render.ts#buildLayerSections`
 * writes a layer's aliases with no tag (membership is positional), so the alias scan needs this
 * exclusion as the bind scan does, or `+alt`/`-alt` would come back as bogus entries.
 *
 * Known limitation: `sectionEnd` is `Infinity` for a file's last section, so a hand-added alias
 * appended after the last layer still reads as inside it and is not recovered.
 */
export function insideLayer(state: EntryGroupingState, position: RestoreSourcePosition): boolean {
  return state.layerSections.some((section) => {
    const end = sectionEnd(state.sections, section)
    return position.file === section.file && position.line > section.line && position.line < end
  })
}

/** Every non-empty display prose the group's lines carry, in alias -> bind -> anchor order. All of
 * them, not the first: an entry's lines can disagree about prose (one hand-renamed or budget-cut),
 * so an anchor's prose is compared against each. */
export function prosesOf(group: EntryGroup): string[] {
  return [...group.aliases, ...group.binds, ...group.anchors, ...group.unbounds]
    .map((line) => line.prose.trim())
    .filter((prose) => prose.length > 0)
}

/** The catalogue id the group's lines record, `''` for an entry with no catalogue link. Every line
 * of one entry carries the same `cid` (`render.ts#entryTag`; the tag never gives way under budget
 * pressure), so the first line that has one speaks for the group. */
export function cidOf(group: EntryGroup): string {
  return (
    [...group.aliases, ...group.binds, ...group.anchors, ...group.unbounds]
      .map((line) => (line.fields.cid ?? '').trim())
      .find((cid) => cid.length > 0) ?? ''
  )
}

/** A group the unbound scan created for an unbound line that joined nothing - one line, no config
 * line of any kind beside it. */
export function unboundOnly(group: EntryGroup): boolean {
  return (
    group.unbounds.length > 0 &&
    group.aliases.length === 0 &&
    group.binds.length === 0 &&
    group.anchors.length === 0
  )
}

/**
 * The entry an anchor line belongs to, or `null` when the file does not say unambiguously. Scoped
 * to the anchor's category section (`sectionCategoryKey`), then by `cid` if the anchor has one,
 * else by exact display prose; each step demands exactly one candidate.
 *
 * Exact prose, nothing wider: a prefix match could not tell one name `fitProseAndTag` cut at two
 * lengths from sibling names (`Reload`, `Reload weapon`), and a wrong merge silently loses the
 * merged-away entry's name, commands and key. A budget-cut code line misses in the safe direction
 * (an anchor is comment-only and carries the whole name; `prosesOf` offers every prose). The
 * two-part gates cannot afford a miss, so they use `twoPartProse`'s budget-aware comparison.
 *
 * `null` never drops a line: the anchor gets its own row. Splitting is the safe direction.
 */
export function matchAnchor(
  state: EntryGroupingState,
  anchor: TaggedLine<RestoreCommentLine>,
): EntryGroup | null {
  // Groups are keyed by category scope first, so a match can never sit in another category. Minus
  // the two-part half groups and groups made for an unbound line alone: that entry has no key slot,
  // and an anchor is a key-slot claim. `unboundOnly`, not `unbounds.length === 0`: an unbound line
  // also joins a keyless bodied entry's alias group (`matchUnbound`), which must stay a candidate.
  const candidates = [
    ...(state.groups.get(categoryKeyOf(state, anchor.item))?.values() ?? []),
  ].filter((group) => !state.halfGroups.has(group) && !unboundOnly(group))
  if (candidates.length === 0) return null

  const cid = (anchor.fields.cid ?? '').trim()
  if (cid.length > 0) {
    const byCid = candidates.filter((group) => cidOf(group) === cid)
    return byCid.length === 1 ? byCid[0]! : null
  }

  const prose = anchor.prose.trim()
  if (prose.length === 0) return null

  const exact = candidates.filter((group) => prosesOf(group).includes(prose))
  return exact.length === 1 ? exact[0]! : null
}

/**
 * The alias-line group an unbound line belongs to, or `null` (`matchAnchor`'s counterpart for the
 * other shape an `Entries:` section carries). A keyless `bind`/`message` entry with a body leaves
 * `alias <name> "<body>"` in `Aliases:` and `//bind "<name>"` in `Entries:`; grouped separately they
 * split one row in two and the alias half infers `kind: 'alias'` (`inferKind`).
 *
 * Matched by name, not prose (prose can be budget-cut): the `an` field, else the commented-out
 * `bind` value (`bindValueFor`), is the alias line's own name. `catalogueMirrorCandidate` covers
 * the one shape where they differ.
 *
 * Every gate refuses to merge, which is safe - the line keeps its own group; a wrong merge loses
 * the loser's name, body and keys:
 *
 * - **An alias-line group only**: a bind-value group is a bound entry, and unrelated rows can share one.
 * - **That claims no key** (`claimsAKey`): the writer emits this line only for an entry with no slot.
 * - **Not a two-part half or primary**: `buildTwoPartEntry` reads no unbound line, so it would be dropped.
 * - **That has no unbound line yet**: one entry, one empty slot, one such line.
 * - **Whose `cid` agrees**, when both carry one.
 */
export function joinableUnboundGroup(
  state: EntryGroupingState,
  candidate: EntryGroup,
  cid: string,
): boolean {
  if (candidate.aliases.length === 0) return false
  if (claimsAKey(candidate)) return false
  if (candidate.unbounds.length > 0) return false
  if (state.twoPartGroups.has(candidate)) return false
  const groupCid = cidOf(candidate)
  return cid.length === 0 || groupCid.length === 0 || cid === groupCid
}

/**
 * The alias-line group an unbound line belongs to when the two cannot agree on a name - the
 * continuous-catalogue mirror shape - or `undefined`. Four conditions, each a fact `render.ts`
 * guarantees for this shape alone:
 *
 * - **no `an`**: `unboundLine` omits it exactly when an alias line already spells the entry's name;
 *   a name matching nothing is a refusal, not an invitation to guess.
 * - **a continuous (`+`/`-`) value with a `cid`**: `bindValueFor`'s fast path.
 * - **the group's folded alias body is that value**, read off the code, not a tag.
 * - **exactly one group in the category qualifies**, as in `matchAnchor`.
 */
export function catalogueMirrorCandidate(
  state: EntryGroupingState,
  scope: ReadonlyMap<string, EntryGroup>,
  line: UnboundEntryLine,
  cid: string,
): EntryGroup | undefined {
  if ((line.fields.an ?? '').trim().length > 0) return undefined
  const value = line.command.trim()
  if (cid.length === 0 || !/^[+-]/.test(value)) return undefined
  const matches = [...scope.values()].filter(
    (group) =>
      joinableUnboundGroup(state, group, cid) &&
      foldedAliasBody(group.aliases).body.trim() === value,
  )
  return matches.length === 1 ? matches[0] : undefined
}

/** The group an unbound line joins: by its stated name when that group is joinable, else by the
 * catalogue-mirror shape - `null` when neither applies (see `joinableUnboundGroup`). */
export function matchUnbound(state: EntryGroupingState, line: UnboundEntryLine): EntryGroup | null {
  const scope = state.groups.get(categoryKeyOf(state, line.item))
  if (!scope) return null

  const cid = (line.fields.cid ?? '').trim()
  const name = (line.fields.an ?? '').trim() || line.command.trim()
  const byName = name.length > 0 ? scope.get(name) : undefined
  if (byName && joinableUnboundGroup(state, byName, cid)) return byName

  return catalogueMirrorCandidate(state, scope, line, cid) ?? null
}
