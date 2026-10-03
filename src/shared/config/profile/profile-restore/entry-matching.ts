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

// ---------------------------------------------------------------------------
// Entry matching: the state `groupEntryLines` phases share, and the rules that decide which group
// a line joins.
// ---------------------------------------------------------------------------

/**
 * Everything `groupEntryLines`' phases share. Every collection is created once and only ever
 * mutated in place, so a phase that reads one always sees what the earlier phases put there.
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
  /**
   * The three per-line-kind chains `orderGroupsByFile` orders the result with: each group in the
   * order its *first* line of that kind appears in the file. Collected while the input arrays
   * (document order, per `RestoreProfilePartsInput`) are being walked, rather than reconstructed
   * from line positions afterwards - a position pair would need a cross-file ordering this module
   * has no way to know, and the arrays already carry the answer.
   */
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
 * Find-or-create, by the line's category scope and then by its own name/value. Two nested maps
 * rather than one composite string key: a bind value is arbitrary config text (`bind x "wait;
 * +attack"`), so there is no printable separator a composite key could safely be joined on, and
 * the per-category map is exactly the candidate set `matchAnchor` needs anyway.
 *
 * The group's own `key` field stays the bare file datum - the alias name, the bind value - because
 * that is what a warning's `subject` and the last-resort display name are allowed to be.
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

/** The category scope a line sits in - the same key `matchAnchor` scopes an anchor by, so an
 * entry's own lines and the anchors that belong to them are scoped identically. */
export function categoryKeyOf(state: EntryGroupingState, position: RestoreSourcePosition): string {
  return sectionCategoryKey(sectionFor(state.sections, position))
}

/** Every group built so far, in creation order (category first seen, then name first seen within
 * it) - the fallback order `orderGroupsByFile` breaks its ties with. */
export function allGroups(state: EntryGroupingState): EntryGroup[] {
  return [...state.groups.values()].flatMap((scope) => [...scope.values()])
}

/**
 * A line inside a layer section belongs to the layer, not to an entry. This protects real
 * content: `render.ts#buildLayerSections` emits a hold layer's `+x`/`-x` alias pair (and a toggle
 * layer's dispatch/chunk/helper aliases, `alt-layers.ts`) with no tag at all - membership is
 * positional, by design (see that function's own doc comment) - so the alias scan needs this
 * exclusion just as much as the bind scan always has.
 *
 * The *alias* recovery gate needs this exclusion too: a hold layer's `+alt`/`-alt` alias pair is
 * layer content, and without it would come back as two bogus Controls-tab entries with false
 * `tag-missing` warnings. Known, accepted limitation: `sectionEnd`
 * returns `Infinity` for a file's *last* section (there is no next one to bound it), so a
 * genuinely hand-added alias a user appends after a file's last layer - the position someone
 * editing the synced file in Notepad would actually pick - still reads as "inside that layer"
 * and is not recovered. Telling the two apart would need either the parser to carry blank-line
 * positions it does not today, or re-deriving `alt-layers.ts`'s full chunk/helper naming budget
 * here to whitelist a layer's *exact* alias family - both a materially larger change than the gap
 * warrants.
 */
export function insideLayer(state: EntryGroupingState, position: RestoreSourcePosition): boolean {
  return state.layerSections.some((section) => {
    const end = sectionEnd(state.sections, section)
    return position.file === section.file && position.line > section.line && position.line < end
  })
}

/** Every non-empty display prose the group's lines carry, in alias -> bind -> anchor order. All of
 * them, not just the first: an entry's lines can legitimately disagree about their prose (one of
 * them hand-renamed, or one of them budget-cut), so an anchor's own prose is compared against each
 * of them rather than against a single designated one. */
export function prosesOf(group: EntryGroup): string[] {
  return [...group.aliases, ...group.binds, ...group.anchors, ...group.unbounds]
    .map((line) => line.prose.trim())
    .filter((prose) => prose.length > 0)
}

/** The catalogue id the group's lines record, `''` for an entry with no catalogue link. Every line
 * of one entry carries the same `cid` (`render.ts#entryTag` reads it off the action, and the tag
 * is never the half that gives way under budget pressure), so the first line that has one speaks
 * for the group. */
export function cidOf(group: EntryGroup): string {
  return (
    [...group.aliases, ...group.binds, ...group.anchors, ...group.unbounds]
      .map((line) => (line.fields.cid ?? '').trim())
      .find((cid) => cid.length > 0) ?? ''
  )
}

/** A group the unbound scan created for an unbound line that joined nothing - one line, no config
 * line of any kind beside it (story 052 D3). */
export function unboundOnly(group: EntryGroup): boolean {
  return (
    group.unbounds.length > 0 &&
    group.aliases.length === 0 &&
    group.binds.length === 0 &&
    group.anchors.length === 0
  )
}

/**
 * The entry an anchor line belongs to, or `null` when the file does not say unambiguously.
 *
 * Scoped to the anchor's own category section (`sectionCategoryKey`) and then, per the story's
 * decision, in two steps: by `cid` when the anchor carries one, else by *exact* display prose.
 * The second step is consulted only when the first had nothing to say, and each demands exactly
 * one candidate - two candidates is ambiguity, and the file has stopped being able to say which.
 *
 * **Exact prose, and nothing wider.** A third step that paired an anchor with an entry whose
 * prose is merely a *prefix* of the anchor's (in either direction) would be meant for one display
 * name `fitProseAndTag` cut at two different lengths on two line kinds. That relation cannot tell
 * such a cut apart from two
 * genuinely different sibling names where one is a prefix of the other (`Reload` next to
 * `Reload weapon`), and merging those two is the one outcome this function must never produce -
 * the merged-away entry loses its name, its commands and its key in one go, with no warning.
 * The entry's own prose display name is the anchor's link, and an exact match is exactly that.
 *
 * What keeps exact matching correct: the budget is spent on a line's *code* first, so even a
 * 120-character name on a 900-byte alias line is cut (see `writtenProseFor`), but an anchor is a
 * comment-only line, so it has the whole budget to itself and always carries the *whole* name, and
 * `prosesOf` offers **every** prose the candidate group's lines carry rather than one designated
 * one. So the anchor's full name still meets the group's own full-length line. The only shape that
 * misses is a group whose lines were *all* cut, which fails in the safe direction: the anchor
 * becomes its own row, nothing is merged away, and no line is lost. The two-part merge gates
 * cannot afford that fallback (splitting there loses the entry's kind), which is why they use
 * `twoPartProse`' budget-aware comparison instead of this one.
 *
 * `null` is not a failure and never drops a line: the caller gives such an anchor an entry of its
 * own. That is the drift the User accepted when the anchor's link became its prose - "if the user
 * later renames the entry's display text inconsistently across its lines, the anchor and the entry
 * drift apart into two separate rows in the UI, accepted as the user's own mistake, not something
 * the parser must reconcile". Splitting is also the safe direction to fail in: a wrong *merge*
 * would silently rewrite which keys one Controls-tab row owns, whereas a split leaves both rows,
 * both keys and every config line intact and visible.
 */
export function matchAnchor(
  state: EntryGroupingState,
  anchor: TaggedLine<RestoreCommentLine>,
): EntryGroup | null {
  // The group map is keyed by category scope first, so the anchor's own scope *is* its candidate
  // set - the entry a match lands on can therefore never sit in a different category than the
  // anchor, which is what keeps the slot the anchor contributes inside the row the user sees it on.
  // Minus the half groups a two-part merge already claimed - see `recognizeMerges` for why.
  // Minus every group an unbound line created a group *of its own* for (story 052 D3), too: such
  // an entry has no key slot at all - that is *why* the writer gave it that line instead of an
  // anchor - so an anchor, which is nothing but a key-slot claim, can never belong to one. Leaving
  // them in the candidate set could only ever cost a real anchor its entry, by making a `cid` or a
  // prose the two happen to share ambiguous.
  //
  // `unboundOnly`, not `unbounds.length === 0` (story 063): an unbound line also
  // joins the alias-line group of a keyless bodied entry (`matchUnbound`), and excluding *that*
  // group would newly deny a real anchor the entry it belongs to.
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
 * The alias-line group an unbound line belongs to, or `null` when the file does not say (story
 * 063, D2 - `matchAnchor`'s counterpart for the other shape an `Entries:` section carries).
 *
 * Since D1 a keyless `bind`/`message` entry with a body leaves *two* lines: `alias <name> "<body>"`
 * in its `Aliases:` section and `//bind "<name>"` in its `Entries:` section. Those two are one
 * entry, and without this they were grouped as two - the alias line under its own name, the
 * unbound line under `unbound:<file>:<line>` - which split one grenade row into an alias row plus a
 * commandless keyless row and, worse, left the alias half inferring `kind: 'alias'` (`inferKind`).
 *
 * Matched by **name**, not by prose: the unbound line's `an` field is the entry's `aliasName` when
 * it has one, and its commented-out `bind`'s own value is `bindValueFor` - which for the ordinary
 * shape (an entry whose mirror goes through its alias) is `aliasNameFor(action)`, the very name the
 * alias line is defined under and therefore the group's own key. So the file states the join twice
 * and the two statements agree; prose, which `matchAnchor` has to fall back on, is not needed and
 * would be the weaker of the two anyway (both halves can be budget-cut).
 *
 * `catalogueMirrorCandidate` is the *one* shape where that name lookup cannot work, because the
 * writer's two statements are two different strings (story 063 D3): a keyless,
 * catalogue-backed entry with a single continuous (`+`/`-`) command mirrors onto its own command
 * text rather than through its alias (`bindValueFor`'s fast path), so its unbound line reads
 * `//bind "+lonerelay"` while its alias line - which exists only because another entry's body calls
 * it by name (`alias-references.ts#actionsWithAliasLine`'s third guard) - is defined under
 * `lone_relay`. Nothing in the file spells the join as a name at all, and the pair split into two
 * `ConfigAction`s sharing one `catalogId`: an inert `kind: 'alias'` row plus a keyless `kind: 'bind'`
 * one. See that helper for why matching the *mirror value* back is as narrow as the name lookup.
 *
 * Every gate below is a refusal to merge, and refusing is safe: the line keeps its own group and
 * the result is exactly the pre-D2 behaviour - two rows, nothing lost, both visible. A wrong merge
 * is not: it fuses two rows into one and the loser's name, body and keys go with it
 * (`matchAnchor`'s doc comment, same rule).
 *
 * - **An alias-line group only.** A group keyed by a *bind value* is a bound entry, and two
 *   unrelated rows can legitimately share one bind value (`//bind "+forward"` next to a real
 *   `bind w "+forward"`), so keying an unbound line into that space is exactly how one row would
 *   swallow another.
 * - **That claims no key** (`claimsAKey`): the writer only ever writes this line for an entry with
 *   no slot at all, so a group that has one cannot be its entry.
 * - **Not a two-part half or primary.** `isUnboundEntry` excludes `alias`/`toggle`/`press-release`
 *   outright, so a recognised toggle or `+`/`-` pair never has an unbound line of its own -
 *   and `buildTwoPartEntry` reads none, so a line folded in there would be silently dropped.
 * - **That has no unbound line yet.** One entry, one empty key slot, one such line.
 * - **Whose `cid` agrees**, when both carry one: the catalogue link is per entry and the tag never
 *   gives way under budget pressure, so two different `cid`s are two different entries whatever
 *   they are named.
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
 * The alias-line group an unbound line belongs to when the two cannot possibly agree on a *name* -
 * the continuous-catalogue mirror shape described in `matchUnbound`'s doc comment above (story 063
 * D3). `undefined` for every other shape, so the name lookup stays the rule and this stays
 * the one exception the writer's own `bindValueFor` fast path creates.
 *
 * Four conditions, and the combination is what makes it exactly as narrow as the name lookup - each
 * one is a fact `render.ts` guarantees for this shape and for no other:
 *
 * - **the line carries no `an`.** `unboundLine` omits that field precisely when an alias line
 *   already spells the entry's name as code, which is the case here; a line that *does* carry one
 *   has stated its join as a name, and a name that matched nothing is a refusal, not an invitation
 *   to guess. This is also what keeps every D2 refusal case (a bound entry's group, a toggle's
 *   dispatch group, a press/release half, a disagreeing `cid`) exactly as refused as it was: all of
 *   them state an `an`.
 * - **its value is continuous** (`+`/`-`-prefixed) and **it carries a `cid`.** `bindValueFor`'s
 *   fast path fires only for a catalogue-backed entry with a single such command, so a value that
 *   is not one, or a line with no catalogue link, can never have been produced by it.
 * - **the group's own folded alias body is that same value.** For this shape the entry's one
 *   command *is* the mirror value, so the alias line beside it renders that exact text - the second
 *   statement of the join the file does make, read off the code rather than off a tag.
 * - **exactly one group in the category qualifies**, `joinableUnboundGroup` included, same
 *   demand `matchAnchor` makes: two candidates means the file has stopped being able to say which,
 *   and splitting loses nothing while a wrong merge takes a row's name, body and keys with it.
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
