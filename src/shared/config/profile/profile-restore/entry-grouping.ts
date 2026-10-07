import { type ImportedActionsResult } from '@shared/config/aliases/alias-import'
import { parseMetaTag } from '@shared/config/profile/profile-metadata'
import { SWITCH_ALIAS } from '@shared/config/aliases/switch-bind'
import type { ConfigAction, ConfigActionCategory } from '@shared/modules/config'
import {
  type RestoreSourcePosition,
  type RestoreAliasLine,
  type RestoreBindLine,
  type RestoreCommentLine,
  type RestoreWarning,
  type Section,
  sectionFor,
  type TaggedLine,
  type UnboundEntryLine,
  type EntryGroup,
  HEURISTIC_SUBCATEGORY_PREFIX,
} from './types'
import {
  STEP_ALIAS_NAME,
  TAG_SIGIL,
  parseComment,
  claimsEntryAnchor,
  claimsUnboundEntry,
  unboundLineParts,
} from './comment-parse'
import { categoryRegistry } from './categories'
import { CHUNK_SUFFIX } from './entry-build'
import {
  type EntryGroupingState,
  allGroups,
  categoryKeyOf,
  createEntryGroupingState,
  groupFor,
  insideLayer,
  matchAnchor,
  matchUnbound,
} from './entry-matching'
import { type TwoPartMerge, recognizeTwoPartGroups } from './two-part'

// ---------------------------------------------------------------------------
// Entry grouping
// ---------------------------------------------------------------------------

/**
 * Every launcher-owned line, grouped into entries by what the config text says, in the order the
 * file puts those entries in (`orderGroupsByFile`), plus any `alias` definition with no `[q2l` tag
 * (`untaggedAliases`).
 *
 * Identity comes from the lines themselves - one shared `Map` keyed on alias names and bind values,
 * each scoped to the category section the line sits in (`groupKey`;):
 *
 * - an alias line is keyed by its alias name; a chunk-split body (`alias <base>_p<n>`) folds onto the
 *   launcher-owned base alias of the same category that calls it, never onto an untagged one;
 * - a bind line is keyed by its bind value, so several `bind` lines running one command are one entry
 *   with several keys; a bind value equal to a grouped alias name joins that alias's group;
 * - an anchor line is matched by `matchAnchor` (`cid`, then exact prose, within its category).
 *
 * The category scope keeps two entries the user named alike (`Fire` under Weapons and Movement, both
 * rendering `alias fire`) apart. It cannot restore a body the engine's alias namespace already lost:
 * every reader folds same-named `alias` lines (last wins) before this runs and reports the loss
 * (`entry-alias-duplicate`).
 *
 * Tag presence is the whole launcher-owned signal: a code line with no `[q2l` is not an entry line,
 * and one whose tag is present but unreadable is reported as `tag-malformed` and not claimed. Either
 * way its `bind`/`alias` line survives untouched in `profile.binds`.
 *
 * An untagged `alias` line is not malformed, and dropping it would lose it (nothing re-derives an
 * `alias` line on render), so it is returned in `untaggedAliases` for the caller to infer an entry
 * from; a malformed tag is excluded to avoid a duplicate entry. A raw `bind` line legitimately
 * carries no tag and is never warned about.
 */
export function groupEntryLines(
  aliases: readonly RestoreAliasLine[],
  binds: readonly RestoreBindLine[],
  comments: readonly RestoreCommentLine[],
  layerSections: readonly Section[],
  sections: readonly Section[],
  warnings: RestoreWarning[],
  consumed: RestoreSourcePosition[],
): { groups: EntryGroup[]; untaggedAliases: RestoreAliasLine[]; merges: TwoPartMerge[] } {
  // The phase order is load-bearing: the `_p<n>` fold needs every owned alias name before any alias
  // line is grouped, the two-part merge needs every alias and bind group, and the comment scan needs
  // the merges.
  const state = createEntryGroupingState(layerSections, sections, warnings, consumed)
  collectAliasLines(state, aliases)
  indexOwnedAliasNames(state)
  groupAliasLines(state)
  groupBindLines(state, binds)
  recognizeMerges(state)
  groupCommentLines(state, comments)
  const { chains } = state
  return {
    groups: orderGroupsByFile(allGroups(state), [chains.aliases, chains.binds, chains.anchors]),
    untaggedAliases: state.untaggedAliases,
    merges: state.merges,
  }
}

/**
 * One code line's trailing comment, read once: its parsed tag, whether it carried a `[q2l` at all,
 * and whether this pass claims it. Reported here rather than at the two call sites so a malformed
 * tag or unknown key is warned about once per line whatever becomes of it.
 */
export function readTag<T extends RestoreSourcePosition & { comment: string }>(
  state: EntryGroupingState,
  item: T,
): { line: TaggedLine<T>; owned: boolean; tagged: boolean } {
  const tagged = item.comment.includes(TAG_SIGIL)
  const parsed = parseMetaTag(item.comment)
  if (parsed.malformed) {
    state.warnings.push({ reason: 'tag-malformed', file: item.file, line: item.line })
  }
  if (parsed.unknownKeys.length > 0) {
    state.warnings.push({
      reason: 'tag-unknown-keys',
      file: item.file,
      line: item.line,
      subject: parsed.unknownKeys.join(','),
    })
  }
  // A tag with one garbled token among good ones still identifies the launcher's line; only a tag
  // yielding nothing does not. `claimsEntryAnchor` says the same for comment-only lines and the two
  // must agree.
  const readable = !parsed.malformed || Object.keys(parsed.fields).length > 0
  return {
    line: { item, fields: parsed.fields, prose: parsed.prose },
    owned: tagged && readable && !insideLayer(state, item),
    tagged,
  }
}

/** The alias phase: every owned alias line into `aliasLines`, every untagged hand-added one into
 * `untaggedAliases` with a `tag-missing` warning. */
export function collectAliasLines(
  state: EntryGroupingState,
  aliases: readonly RestoreAliasLine[],
): void {
  for (const item of aliases) {
    const { line, owned, tagged } = readTag(state, item)
    if (owned) {
      state.aliasLines.push(line)
      continue
    }
    if (tagged || insideLayer(state, item)) continue
    // A switch-bind chain alias is `renderLoaderFile`'s own untagged content, never a hand-added
    // definition; inferring it would file a bogus Controls-tab entry and warn about metadata that
    // was never meant to exist. Matched by the exact `stepAliasName` shape, not
    // `startsWith(STEP_ALIAS_PREFIX)`: a hand-added `alias q2l_sword "…"` must not be silently
    // excluded.
    if (item.name === SWITCH_ALIAS || STEP_ALIAS_NAME.test(item.name)) continue
    state.untaggedAliases.push(item)
    state.warnings.push({ reason: 'tag-missing', file: item.file, line: item.line })
  }
}

/** Appends `group` to the `kind` chain the first time a line of that kind reaches it. */
export function chain(
  state: EntryGroupingState,
  kind: keyof EntryGroupingState['chains'],
  group: EntryGroup,
): void {
  if (!state.chains[kind].includes(group)) state.chains[kind].push(group)
}

/**
 * The owned-names phase. The `_p<n>` fold needs every owned alias name up front, so alias lines are
 * collected first rather than grouped as read. Scoped by category like the group key: a chunk line
 * and the base line that calls it are always emitted into one alias section.
 */
export function indexOwnedAliasNames(state: EntryGroupingState): void {
  for (const line of state.aliasLines) {
    const category = categoryKeyOf(state, line.item)
    const named = state.ownedAliasNames.get(category) ?? new Set<string>()
    named.add(line.item.name)
    state.ownedAliasNames.set(category, named)
  }
}

/** The alias grouping phase: each owned alias line into its group, a `_p<n>` chunk onto its base. */
export function groupAliasLines(state: EntryGroupingState): void {
  for (const line of state.aliasLines) {
    const category = categoryKeyOf(state, line.item)
    const chunk = CHUNK_SUFFIX.exec(line.item.name)
    const key =
      chunk && state.ownedAliasNames.get(category)?.has(chunk[1]!) ? chunk[1]! : line.item.name
    const group = groupFor(state, category, key)
    group.aliases.push(line)
    chain(state, 'aliases', group)
  }
}

/** The bind phase: each owned bind line into the group of its bind value. */
export function groupBindLines(state: EntryGroupingState, binds: readonly RestoreBindLine[]): void {
  for (const item of binds) {
    const { line, owned } = readTag(state, item)
    if (!owned) continue
    // The bind value goes into the same key space as alias names (the join rule in
    // `groupEntryLines`), so two lines with one value meet in one group unprompted.
    const group = groupFor(state, categoryKeyOf(state, item), item.command.trim())
    group.binds.push(line)
    chain(state, 'binds', group)
  }
}

/**
 * The two-part idioms, recognised after every alias and bind line has found its group and before
 * the anchor scan.
 *
 * The anchor scan forces that position: `render.ts` writes an entry's one display prose on every line
 * of its alias family, so a toggle's three groups carry three identical proses, and `matchAnchor`
 * demands exactly one candidate. A toggle whose only key slot is modified (its claim lives on an
 * anchor line, since a modifier binding has no bind line) matched none and its key came
 * back as a separate commandless entry. Excluding the two half groups leaves the group the anchor is
 * for: the dispatch alias for a toggle, the `+` half for a pair - the group `bindValueFor` mirrors
 * onto and `buildTwoPartEntry` reads the slots off.
 */
export function recognizeMerges(state: EntryGroupingState): void {
  state.merges.push(...recognizeTwoPartGroups(allGroups(state), state.sections))
  for (const merge of state.merges) {
    for (const group of merge.consumed) {
      if (group !== merge.primary) state.halfGroups.add(group)
      state.twoPartGroups.add(group)
    }
  }
}

/**
 * The comment phase: anchor lines (`render.ts#buildAnchorLines`) and unbound lines. Scanned last and
 * in document order, so every entry with a real config line exists to match against and an
 * anchor-only entry's second anchor can match the group its first created.
 *
 * `parseComment`, not `parseMetaTag`: a comment-only line may be a banner whose tag sits inside
 * trailing decoration. Malformed tags and unknown keys are not reported here - `scanComments`
 * already reported them once.
 */
export function groupCommentLines(
  state: EntryGroupingState,
  comments: readonly RestoreCommentLine[],
): void {
  for (const item of comments) {
    const parsed = parseComment(item.text)
    // A tagged comment inside a layer section belongs to the layer (positional), so the check stays
    // here rather than in either predicate.
    if (insideLayer(state, item)) continue

    // `claimsEntryAnchor`/`claimsUnboundEntry` are the shared predicates: a section header or the
    // version marker is not an entry line even with a hand-edited `key`, and a claimed line is never
    // read as a section header (`claimedByEntryScan`). They are mutually exclusive, so branch order
    // decides nothing; both run in the one pass that consumes a comment line, so a claimed line never
    // reaches the preview's `preserved` list.
    if (claimsEntryAnchor(parsed)) {
      if (!parsed.malformed) state.consumed.push({ file: item.file, line: item.line })
      const anchor: TaggedLine<RestoreCommentLine> = {
        item,
        fields: parsed.fields,
        prose: parsed.prose,
      }
      // An unmatched anchor becomes its own entry inside its own category scope. The key
      // `anchor:<file>:<line>` is unique per line, so a second anchor of the same entry matches by
      // `cid`/prose above instead.
      const owner =
        matchAnchor(state, anchor) ??
        groupFor(state, categoryKeyOf(state, item), `anchor:${item.file}:${item.line}`)
      owner.anchors.push(anchor)
      chain(state, 'anchors', owner)
      continue
    }

    if (!claimsUnboundEntry(parsed)) continue
    if (!parsed.malformed) state.consumed.push({ file: item.file, line: item.line })
    const { command, prose } = unboundLineParts(parsed)
    const unbound: UnboundEntryLine = { item, fields: parsed.fields, prose, command }
    // The alias line of the same entry when the file names one (a keyless bodied `bind`/`message`
    // entry has both lines and they are one entry), else a group of its own: a merge the
    // file cannot vouch for could only fold two rows into one (`matchUnbound`,
    // `EntryGroup.unbounds`). Filed in the line's own category scope either way, so an unjoined
    // entry lands in its `Entries: <cat>` section as an anchor does.
    const owner =
      matchUnbound(state, unbound) ??
      groupFor(state, categoryKeyOf(state, item), `unbound:${item.file}:${item.line}`)
    owner.unbounds.push(unbound)
    // Same chain as the anchors: both are siblings in one `Entries:` section, emitted in one merged
    // `profile.actions` order (`render.ts#buildEntrySectionItems`), so one subsequence, not two.
    chain(state, 'anchors', owner)
  }
}

/**
 * The groups in an order the file's own line order can vouch for.
 *
 * Not simply "sorted by first line": the writer does not lay an entry's lines out in one run.
 * `renderProfileFile` emits every category's alias section, then every category's bind section, then
 * the anchor sections, each sorted independently by the owning action's index (`compareOwnedBinds`).
 * So the file carries the action order three times, once per line kind, each a subsequence of it.
 * Map-insertion order ignored all three: groups were created from alias lines before any bind line
 * was read, so an aliasless entry (a continuous catalogue row bound to its bare `+command`) always
 * sorted after every alias-backed entry of its category. `compareOwnedBinds` then re-sorted that
 * category's bind lines on the next render and the two key lines swapped - a byte difference on an
 * untouched file, which the fixed point forbids.
 *
 * So the answer is the one order consistent with all three subsequences: a topological sort over the
 * chains, tie-broken by creation order for pairs the file does not order (an alias-only and a
 * bind-only entry never share a section, so no section re-renders them side by side).
 *
 * A cycle can only come from a hand-edited file whose sections were physically reordered against
 * each other; it is resolved by taking the earliest-created group left and dropping its incoming
 * edges, so this terminates and returns every group exactly once.
 */
export function orderGroupsByFile(
  all: readonly EntryGroup[],
  chains: readonly (readonly EntryGroup[])[],
): EntryGroup[] {
  const successors = new Map<EntryGroup, EntryGroup[]>(all.map((group) => [group, []]))
  const indegree = new Map<EntryGroup, number>(all.map((group) => [group, 0]))

  for (const chain of chains) {
    for (let index = 1; index < chain.length; index += 1) {
      const from = chain[index - 1]!
      const to = chain[index]!
      successors.get(from)!.push(to)
      indegree.set(to, indegree.get(to)! + 1)
    }
  }

  const remaining = new Set(all)
  const ordered: EntryGroup[] = []
  while (remaining.size > 0) {
    let next: EntryGroup | undefined
    for (const group of remaining) {
      if (indegree.get(group) === 0) {
        next = group
        break
      }
    }
    next ??= remaining.values().next().value!
    remaining.delete(next)
    ordered.push(next)
    for (const successor of successors.get(next)!) {
      indegree.set(successor, Math.max(0, indegree.get(successor)! - 1))
    }
  }

  return ordered
}

/**
 * Promotes the sections `scanComments`'s repeated-decoration heuristic detected into the actions
 * `buildImportedActions` already produced, for a wholly foreign file (no `[q2l …]` tag) whose own
 * untagged headers state a category + sub-category pair (a `dm.cfg`-shaped file: `.: Main Key's :.`
 * with `##### 1st row #####` blocks beneath).
 *
 * Additive rather than a parallel entry-builder: `buildImportedActions` already turns every `alias`
 * definition into a `ConfigAction` with a content-guessed `categoryId` (`guessCategoryKey`), so a
 * foreign config still imports as it did before. This only overrides that guess for an action
 * whose defining `alias` line sits inside a section the heuristic recognised; every other action,
 * and every file with no heuristic pair (the overwhelming majority, including decoration seen only
 * once, which never clears the "recurs on two lines" gate), comes back untouched.
 *
 * A raw bind with no alias line is out of reach: `buildImportedActions` builds no `ConfigAction` for
 * it (`profile.binds` carries it directly), so only an alias-backed entry - what a foreign author's
 * `bind key aliasname` + `alias aliasname …` pair always is - can be re-homed.
 */
export function applyForeignSubcategoryHeuristic(
  delegated: Pick<ImportedActionsResult, 'actions' | 'categories'>,
  aliases: readonly RestoreAliasLine[],
  sections: readonly Section[],
  newId: () => string,
): { actions: ConfigAction[]; categories: ConfigActionCategory[] } {
  const heuristicSections = sections.filter(
    (section) =>
      section.kind === 'subcategory' &&
      (section.fields.sub ?? '').startsWith(HEURISTIC_SUBCATEGORY_PREFIX),
  )
  if (heuristicSections.length === 0)
    return { actions: [...delegated.actions], categories: [...delegated.categories] }

  // Last definition of a name wins - the fold every reader applies before a body reaches here, so
  // `aliases` is already folded and a name's position is unambiguous.
  const positionByName = new Map(aliases.map((alias) => [alias.name, alias]))
  const registry = categoryRegistry(newId, sections)

  const actions = delegated.actions.map((action) => {
    if (!action.aliasName) return action
    const position = positionByName.get(action.aliasName)
    if (!position) return action
    const section = sectionFor(sections, position)
    if (!section) return action
    const isHeuristicSub = heuristicSections.includes(section)
    const isHeuristicParent = heuristicSections.some((sub) => sub.parent === section)
    if (!isHeuristicSub && !isHeuristicParent) return action
    const categoryId = registry.idFor(section)
    const subcategoryId = registry.subcategoryIdFor(section)
    return { ...action, categoryId, ...(subcategoryId ? { subcategoryId } : {}) }
  })

  // Only categories an action still points at survive: one `guessCategoryKey` minted for an action
  // just re-homed would linger empty, contradicting "one category with sub-categories". Every
  // category this registry mints is referenced by construction (`idFor` runs only for a re-homed
  // action), so the filter only ever drops `delegated.categories` entries.
  const usedIds = new Set(actions.map((action) => action.categoryId))
  const categories = [...registry.created(), ...delegated.categories].filter((category) =>
    usedIds.has(category.id),
  )
  return { actions, categories }
}
