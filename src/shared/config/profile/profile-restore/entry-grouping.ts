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
 * Every launcher-owned line, grouped into entries by what the config *text* says, in the order the
 * file itself puts those entries in (`orderGroupsByFile`), plus any `alias` definition that carries
 * no `[q2l` tag at all (`untaggedAliases`).
 *
 * Identity comes out of the lines themselves - one shared `Map` keyed on alias names and bind
 * values, each **scoped to the category section the line sits in** (`groupKey`; story 050):
 *
 * - an alias line is keyed by its alias name; a chunk-split body (`alias <base>_p<n>`) folds onto
 *   the launcher-owned base alias of the *same* category that calls it, never onto an untagged one;
 * - a bind line is keyed by its bind value, so several `bind` lines running one command are one
 *   entry with several keys; a bind value equal to a grouped alias name joins that alias's group;
 * - an anchor line is matched by `matchAnchor` (`cid`, then exact prose, within its category).
 *
 * The category scope is what keeps two entries the user named alike (`Fire` under Weapons and under
 * Movement, both rendering `alias fire`) apart. It cannot restore a body the engine's alias name
 * space already lost: every reader folds same-named `alias` lines (last definition wins) before this
 * runs, and that fold reports the loss (`entry-alias-duplicate`).
 *
 * Tag *presence* is the whole launcher-owned signal: a code line with no `[q2l` is not an entry
 * line, and a line whose tag is present but unreadable is reported as `tag-malformed` and not
 * claimed. Either way its `bind`/`alias` line survives untouched in `profile.binds`.
 *
 * An untagged `alias` line is not malformed, and dropping it would silently lose it (nothing
 * re-derives an `alias` line from `profile.binds`/`profile.cvars` on render), so it is returned in
 * `untaggedAliases` for the caller to infer an entry from; a *malformed* tag is excluded to avoid a
 * duplicate entry. A raw `bind` line legitimately carries no tag and is never warned about.
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
  // the merges - see each phase's own doc comment.
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
 * and whether this pass claims it for an entry. Reported here rather than at the two call sites,
 * so a malformed tag or an unknown key is warned about exactly once per line whatever becomes of
 * the line afterwards.
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
  // A tag with one garbled token among good ones still identifies its line as the launcher's -
  // only a tag nothing at all could be read out of does not. `claimsEntryAnchor` says the same
  // thing for a comment-only line, and the two predicates have to agree (see there).
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
    // A switch-bind chain alias (story 007) is never a hand-added definition - it is
    // `renderLoaderFile`'s own generated content, untagged by this story's own design (the Plan's
    // "Not touched" list). Recovering it through 041's inference would file it as a real
    // Controls-tab entry and warn about metadata that was never supposed to exist.
    //
    // Matches the exact shape `stepAliasName` in `switch-bind.ts` generates (prefix, then digits, then
    // end of string), not `startsWith(STEP_ALIAS_PREFIX)`: a hand-added `alias q2l_sword "…"` must not
    // be silently excluded - the data-loss class this exclusion exists to avoid.
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
 * The owned-names phase. The `_p<n>` fold needs every owned alias name up front, which is why the
 * alias lines were collected first rather than grouped as they were read. Scoped by category like
 * the group key itself: a chunk line and the base line that calls it are always emitted into one
 * alias section.
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
    // The bind value, straight into the same key space the alias names live in - see the join rule
    // in `groupEntryLines`' doc comment. Two lines with one value therefore meet in one group without
    // either of them having to say so.
    const group = groupFor(state, categoryKeyOf(state, item), item.command.trim())
    group.binds.push(line)
    chain(state, 'binds', group)
  }
}

/**
 * The two-part idioms (story 045, D7), recognised here - after every alias and bind line has
 * found its group, before the anchor scan.
 *
 * The *position* matters, and it is the anchor scan that forces it. `render.ts` writes the
 * entry's one display prose on every line of its alias family, so a toggle's three groups carry
 * three *identical* proses - and `matchAnchor` demands exactly one candidate, which means a
 * toggle whose only key slot is a modified one (its claim lives on an anchor line, since a
 * modifier binding has no bind line at all - story 016) matched three candidates, matched none,
 * and its key came back as a separate, commandless entry of its own. Excluding the two half
 * groups from the candidate set leaves exactly the group the anchor is *for*: the dispatch alias
 * for a toggle, the `+` half for a pair - the same group `bindValueFor` mirrors onto, and the
 * same one `buildTwoPartEntry` reads the merged entry's slots off.
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
 * The comment phase: the anchor lines (`render.ts#buildAnchorLines`) and unbound lines. Scanned
 * last, and in document order, so every entry that has a real config line already exists to be
 * matched against - and so an anchor-only entry's *second* anchor can match the group its first one
 * created.
 *
 * `parseComment`, not `parseMetaTag`: a comment-only line may be a banner, whose tag sits inside
 * trailing decoration. Malformed tags and unknown keys are *not* reported here - `scanComments`
 * already walked every one of these lines and reported them once.
 */
export function groupCommentLines(
  state: EntryGroupingState,
  comments: readonly RestoreCommentLine[],
): void {
  for (const item of comments) {
    const parsed = parseComment(item.text)
    // A tagged comment inside a layer section belongs to the layer, which is positional and
    // therefore stays here rather than moving into either predicate.
    if (insideLayer(state, item)) continue

    // `claimsEntryAnchor`/`claimsUnboundEntry` are the shared predicates: a section header or the
    // header block's version marker is not an entry line even if someone hand-edited a `key` into
    // it, and - the other way round - a line either of them claims is never read as a section header
    // either (`claimedByEntryScan`, see there). The two are mutually exclusive, so the order of
    // these two branches decides nothing; both run *here*, in the one pass that consumes a comment
    // line, so a claimed line never reaches the import preview's `preserved` list.
    if (claimsEntryAnchor(parsed)) {
      if (!parsed.malformed) state.consumed.push({ file: item.file, line: item.line })
      const anchor: TaggedLine<RestoreCommentLine> = {
        item,
        fields: parsed.fields,
        prose: parsed.prose,
      }
      // An unmatched anchor becomes its own entry, created *inside its own category scope* so a
      // later anchor of the same (anchor-only) entry can still find it - `anchor:<file>:<line>` is
      // unique per line, so its own second anchor never lands here at all: it matches by `cid`/prose
      // above.
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
    // The alias line of the same entry when the file names one (story 063 D2 - a keyless bodied
    // `bind`/`message` entry has both lines since D1, and they are one entry), else a group of this
    // line's own: before D2 that was unconditional, because the writer only ever wrote this line for
    // an entry with no other line at all, and a merge it cannot vouch for could only fold two rows
    // into one (see `matchUnbound` and `EntryGroup.unbounds`). Filed in the line's own category scope
    // either way, so an unjoined entry lands in the `Entries: <cat>` section it sits under, exactly
    // as an anchor does.
    const owner =
      matchUnbound(state, unbound) ??
      groupFor(state, categoryKeyOf(state, item), `unbound:${item.file}:${item.line}`)
    owner.unbounds.push(unbound)
    // The same chain the anchors use: unbound lines and anchor lines are siblings in one `Entries:`
    // section, emitted in one merged `profile.actions` order (`render.ts#buildEntrySectionItems`),
    // so they are one subsequence of that order rather than two.
    chain(state, 'anchors', owner)
  }
}

/**
 * The groups in an order the file's own line order can vouch for.
 *
 * Why this is not just "sorted by first line": the writer does not lay an entry's lines out in one
 * run. `renderProfileFile` emits *every* category's alias section, then every category's bind
 * section, then the anchor sections - and sorts each of those independently by the owning action's
 * index (`compareOwnedBinds`). So the file carries the action order three times over, once per line
 * kind, each as a *subsequence* of it, and nothing else. Grouping in map-insertion order ignored all
 * three: groups were created from the alias lines before any bind line was read, so an aliasless
 * entry (a continuous catalogue row bound to its bare `+command`) always sorted *after* every
 * alias-backed entry of its category no matter where its bind line actually sat. `compareOwnedBinds`
 * then re-sorted that category's bind lines by the new index on the next render and the two key
 * lines swapped places - a byte difference on a file nobody had touched, which is exactly what
 * story 042's fixed point forbids.
 *
 * So the answer is the one order consistent with all three subsequences at once: a topological sort
 * over the chains, tie-broken by creation order for the pairs the file genuinely does not order (an
 * alias-only entry and a bind-only entry never share a section, so their relative order cannot be
 * read off the file - and cannot matter either, since no section re-renders them side by side).
 *
 * A cycle can only come from a hand-edited file whose sections were physically reordered against
 * each other; it is resolved by taking the earliest-created group still left and dropping its
 * incoming edges, so this always terminates and always returns every group exactly once.
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
 * Story 053 D4: promotes the sections `scanComments`'s repeated-decoration heuristic detected into
 * the actions `buildImportedActions` (story 041) already produced, for a wholly foreign file (no
 * `[q2l …]` tag anywhere) whose own untagged headers happen to state a real category + sub-category
 * pair (a `dm.cfg`-shaped file: `.: Main Key's :.` with `##### 1st row #####` blocks beneath).
 *
 * Deliberately additive rather than a parallel entry-builder: `buildImportedActions` already turns
 * every `alias` definition into a `ConfigAction` (AC8 - a foreign config still imports exactly as
 * story 041 leaves it), complete with its own content-guessed `categoryId` (`guessCategoryKey`). This
 * function only *overrides* that guess, and only for an action whose defining `alias` line's own
 * position falls inside a section the heuristic actually recognised - every other action, and every
 * file with no heuristic pair at all (the overwhelming majority; AC8's own pinned fixture included,
 * since its two banners each use a decoration seen only once and so never clears the "recurs on at
 * least two lines" gate), comes back untouched, categories and all.
 *
 * A raw bind with no alias line of its own is not reachable here - `buildImportedActions` never
 * builds a `ConfigAction` for one at all (`profile.binds` carries it directly, independent of this
 * whole restore), so it stays exactly as unowned as it always was; only
 * an alias-backed entry, which is what a foreign author's own `bind key aliasname` + `alias aliasname
 * …` pair always is, can be re-homed.
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

  // Last definition of a name wins - the same fold every reader of this format applies before a body
  // ever reaches here; `aliases` is already that folded array, so "the" position
  // of a name is unambiguous.
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

  // Only the categories an action still points at survive: a category `guessCategoryKey` minted for
  // an action this pass just re-homed would otherwise linger in the result with nothing in it,
  // contradicting "one category with sub-categories" (D4's own Accept). Every category this registry
  // itself mints *is* referenced, by construction (`idFor` only ever runs for an action being
  // re-homed onto it), so the filter only ever drops `delegated.categories` entries, never its own.
  const usedIds = new Set(actions.map((action) => action.categoryId))
  const categories = [...registry.created(), ...delegated.categories].filter((category) =>
    usedIds.has(category.id),
  )
  return { actions, categories }
}
