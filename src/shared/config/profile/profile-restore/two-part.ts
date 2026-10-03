import { withKeySlot } from '@shared/config/catalog/action-slots'
import { splitAliasBody } from '@shared/config/aliases/alias-import'
import {
  recognizeEntryIdioms,
  type RecognizedPressRelease,
  type RecognizedToggle,
} from '@shared/config/syntax/entry-idioms'
import type { ActionEntryPart, ConfigAction, ConfigCommand } from '@shared/modules/config'
import { type RestoreWarning, type Section, sectionFor, type EntryGroup } from './types'
import { categoryRegistry, sectionCategoryKey } from './categories'
import {
  foldedAliasBody,
  commandsFromSegments,
  keySlotsFrom,
  entryProse,
  proseCutOf,
} from './entry-build'

// ---------------------------------------------------------------------------
// Two-part entries: the toggle trio and the `+x`/`-x` pair (story 045, D7)
// ---------------------------------------------------------------------------

/**
 * One accepted merge: the 2-3 `EntryGroup`s the config text wires into a single `toggle`/
 * `press-release` entry, and which of them the entry stands in for.
 */
export interface TwoPartMerge {
  kind: 'toggle' | 'press-release'
  /**
   * The entry's one display prose, reassembled across the merged groups' lines: the longest of them,
   * and the merge only happened at all because every shorter one is exactly the cut that line's own
   * byte budget would have made of it (see `twoPartProse`). Carried on the merge rather than re-read
   * off `primary` in `buildTwoPartEntry`,
   * since `primary` is not always the line that kept the whole name - a press/release entry's
   * primary *is* its `+` half, and that is exactly the half a long body can truncate.
   */
  prose: string
  /**
   * The group the merged entry takes the place of - its position in the output, its prose, its
   * `cid`, its section and, crucially, its key slots. That is the group whose own name is what
   * `action-mirror.ts#bindValueFor` writes on every one of the entry's keys, so it is the group a
   * `bind` line lands in: the **dispatch** alias for a toggle (`bind v "zoom"`), the **press** half
   * for a pair (`bind SHIFT "+slow"`, sign and all - there is no group keyed on the sign-free base,
   * because `groupEntryLines` keys strictly on the literal alias name / bind value text).
   */
  primary: EntryGroup
  /** The name the merged entry renders under: the dispatch name, or the pair's sign-free base. */
  aliasName: string
  /** State 1 then state 2, or press then release - the order `parts` is stored in. */
  halves: { group: EntryGroup; keptName: string; segments: readonly string[] }[]
  /** Every group the merge consumes, `primary` included, so none of them also becomes its own entry. */
  consumed: EntryGroup[]
}

/**
 * Does this group claim a key of its own (a `bind` line or an anchor line)?
 *
 * Recognition runs before the anchor scan (see `merges` in `groupEntryLines`), so in practice only
 * the bind half can be non-empty here. Both are checked anyway: an anchor is a key claim by
 * definition, and a predicate that silently depends on *when* it is called is the kind of thing a
 * later reordering breaks without a failing test.
 */
export function claimsAKey(group: EntryGroup): boolean {
  return group.binds.length > 0 || group.anchors.length > 0
}

/**
 * The one display prose the groups a two-part merge would collapse all agree on, or `null` when they
 * do not - the gate that decides whether the config text says these 2-3 alias families are *one
 * entry* (prose is the entry's identity) or several entries whose bodies happen to be
 * wired into an idiom.
 *
 * ## Why this is not plain string equality
 *
 * `render.ts` writes the entry's one display name onto every line of its alias family, but each line
 * spends its own byte budget on its own *code* first: a 900-character toggle state and the
 * `alias zoom zoom_s1` dispatch beside it get very different amounts of what is left over, so one
 * line can carry `Zoom with a long name` while the other carries `Zoom with a l`. Both are the same
 * entry, and requiring them to match character for character split it back into three plain alias
 * entries on read-back - kind, `parts` and `lbl` labels gone, and a next render that differs from
 * the last, which is exactly what AC6's fixed point forbids.
 *
 * ## And why it is not a plain prefix relation either
 *
 * `matchAnchor` (below) deliberately has no prefix-tolerant prose match: `Reload` is a prefix of `Reload weapon`, and merging two genuinely different
 * sibling names loses one of them whole. Nor is "a prefix, on a line the whole name would not have
 * fitted on" enough: that admits three real, never-cut
 * sibling names on three cramped lines - `Slow`, `Slow mo`, `Slow motion walk` - collapsing into one
 * entry and losing two names with no warning, because it never checks that the shorter spelling sits
 * *at* the cut point. A line with four characters of room and `Slow` on it says nothing about
 * `Slow motion walk`; a line with eleven characters of room whose prose reads `Slow motion` does.
 *
 * So the condition is exact: every line's prose must be **what the writer would have written there**
 * for the candidate name, cut or whole (`proseCutOf`, which re-runs `fitProseAndTag` against that
 * line's own measured budget).
 *
 * The returned prose is the *longest* candidate, i.e. the least-cut spelling of the name the file
 * still has. Restoring the truncated one instead would make the next render write that shortened
 * name onto the short lines too - a different file, one render later.
 */
export function twoPartProse(primary: EntryGroup, groups: readonly EntryGroup[]): string | null {
  const lines = groups.flatMap((group) => group.aliases)
  // `entryProse(primary)` is in the candidate set, not just the alias lines': a primary whose alias
  // line lost its prose entirely still has its bind/anchor lines to name it, and that fallback is
  // the one `buildEntry` would have used had this group stayed an entry of its own.
  const candidates = [...lines.map((line) => line.prose.trim()), entryProse(primary)]
  const full = candidates.reduce(
    (longest, prose) => (prose.length > longest.length ? prose : longest),
    '',
  )

  for (const line of lines) {
    const prose = line.prose.trim()
    if (prose === full) continue
    if (!proseCutOf(prose, full, line)) return null
  }
  return full
}

/**
 * A recognised toggle trio -> one merge, or `null` when the *file* says these are separate
 * entries after all.
 *
 * `entry-idioms.ts` decides whether the three bodies are *wired* as a toggle; the two extra
 * conditions here are about whether they are *one entry*, which only this reader can know:
 *
 *  - **One prose across all three lines** (`twoPartProse` - up to the per-line budget cut it
 *    documents). `render.ts#buildAliasSections` writes the entry's one display name on every line of
 *    its alias family, so a launcher-written toggle always agrees with itself. Three lines that
 *    disagree are three entries whose bodies happen to be wired into a loop - merging them would take
 *    two display names, and on the next render two `//` comments, out of the file. Prose is the
 *    entry's identity; this is that rule applied.
 *  - **Neither state claims a key of its own.** The writer binds a toggle's *dispatch* and nothing
 *    else, so a `bind`/anchor line on a state is a shape this reader has never written. Merging it
 *    would move that key onto the dispatch value (`bindValueFor`) and rewrite a bind line the user
 *    put there by hand, which is the one thing "the config line wins" forbids.
 *
 * Both fall back to the plain per-group `buildEntry` path, untouched - the story's all-or-nothing
 * rule, and what makes a hand-edited broken trio come back as plain alias entries for D8's Care
 * checks to report rather than as a half-built toggle.
 */
export function toggleMergeFor(
  toggle: RecognizedToggle,
  byName: ReadonlyMap<string, EntryGroup>,
): TwoPartMerge | null {
  const dispatch = byName.get(toggle.dispatchName.toLowerCase())
  const first = byName.get(toggle.states[0].name.toLowerCase())
  const second = byName.get(toggle.states[1].name.toLowerCase())
  if (!dispatch || !first || !second) return null
  if (claimsAKey(first) || claimsAKey(second)) return null

  const prose = twoPartProse(dispatch, [dispatch, first, second])
  if (prose === null) return null

  return {
    kind: 'toggle',
    prose,
    primary: dispatch,
    aliasName: toggle.dispatchName,
    halves: [
      { group: first, keptName: toggle.states[0].name, segments: toggle.states[0].segments },
      { group: second, keptName: toggle.states[1].name, segments: toggle.states[1].segments },
    ],
    consumed: [dispatch, first, second],
  }
}

/**
 * A recognised `+x`/`-x` pair -> one merge, or `null`.
 *
 * The same two conditions as `toggleMergeFor` (one prose per `twoPartProse`, no key of the release
 * half's own), plus
 * one this shape needs on its own: the release half's name must be **exactly** `-<base>`, casing
 * included. `entry-idioms.ts` pairs the two halves case-insensitively, because the engine's own
 * alias lookup is - but a `press-release` entry stores only the sign-free base and appends `+`/`-`
 * at render time (story 045's Decisions), so merging `+Slow` with a hand-written `-slow` would
 * re-render that definition as `-Slow`: a rename of a line the user typed, and a byte the fixed
 * point would lose.
 */
export function pressReleaseMergeFor(
  pair: RecognizedPressRelease,
  byName: ReadonlyMap<string, EntryGroup>,
): TwoPartMerge | null {
  if (pair.release.name !== `-${pair.baseName}`) return null

  const press = byName.get(pair.press.name.toLowerCase())
  const release = byName.get(pair.release.name.toLowerCase())
  if (!press || !release) return null
  if (claimsAKey(release)) return null

  const prose = twoPartProse(press, [press, release])
  if (prose === null) return null

  return {
    kind: 'press-release',
    prose,
    primary: press,
    aliasName: pair.baseName,
    halves: [
      { group: press, keptName: pair.press.name, segments: pair.press.segments },
      { group: release, keptName: pair.release.name, segments: pair.release.segments },
    ],
    consumed: [press, release],
  }
}

/**
 * Every two-part entry the config text wires out of `groups`, found by the one shared recogniser
 * `alias-import.ts` uses (story 045): there is no `k` tag to read a kind off, so both
 * readers derive it from the text.
 *
 * ## Folded bodies, one per group
 *
 * The recogniser wants one `{ name, body }` per entry with the body already recombined - see
 * `foldedAliasBody`. `groupEntryLines` has already folded the `_p<n>` *lines* onto their base
 * group, so one group is one alias definition here; folding the *text* is what is left to do, and
 * it is what lets a chunk-split toggle state (`alias zoom_s1 "zoom_s1_p1; zoom_s1_p2"`, its
 * `alias zoom zoom_s2` rewrite hiding in the last chunk) be recognised at all.
 *
 * ## Scoped per category section
 *
 * Recognition runs once per category scope, the same scope `groupEntryLines` keys its groups in.
 * An entry's whole alias family is written into one category's alias section by construction
 * (`render.ts#buildAliasSections`), so scoping costs a healthy file nothing - and merging across
 * two sections would produce one entry where the file has two, which re-renders into a different
 * file and loses story 042's fixed point outright.
 *
 * ## `waitAliases` is deliberately not used here
 *
 * The recogniser also resolves a `waitN` family to a frame count, which is right for a *foreign*
 * config (D6) and wrong for our own file: `alias hop20 "hop5; hop5; hop5; hop5"` would become one
 * `{ kind: 'wait', frames: 20 }` command and re-render as twenty literal `wait`s, silently
 * rewriting four references the user's other bodies may still call. The launcher's own file already
 * writes a `wait` command as literal `wait` segments, and `commandsFromAliases`' `collapseWaitRuns`
 * reads exactly those back - no name resolution needed, and none wanted.
 */
export function recognizeTwoPartGroups(
  groups: readonly EntryGroup[],
  sections: readonly Section[],
): TwoPartMerge[] {
  const byScope = new Map<string, { group: EntryGroup; name: string; body: string }[]>()
  for (const group of groups) {
    const firstAlias = group.aliases[0]
    if (!firstAlias) continue
    const { body, aliasName } = foldedAliasBody(group.aliases)
    const scope = sectionCategoryKey(sectionFor(sections, firstAlias.item))
    const list = byScope.get(scope) ?? []
    list.push({ group, name: aliasName, body })
    byScope.set(scope, list)
  }

  const merges: TwoPartMerge[] = []
  for (const definitions of byScope.values()) {
    const recognized = recognizeEntryIdioms(definitions.map(({ name, body }) => ({ name, body })))
    if (recognized.toggles.length === 0 && recognized.pressReleases.length === 0) continue

    const byName = new Map<string, EntryGroup>(
      definitions.map(({ group, name }) => [name.toLowerCase(), group]),
    )
    for (const toggle of recognized.toggles) {
      const merge = toggleMergeFor(toggle, byName)
      if (merge) merges.push(merge)
    }
    for (const pair of recognized.pressReleases) {
      const merge = pressReleaseMergeFor(pair, byName)
      if (merge) merges.push(merge)
    }
  }
  return merges
}

/**
 * One `toggle`/`press-release` entry out of the groups `merge` collapses.
 *
 * A parallel path to `buildEntry` rather than a branch inside it: everything that function derives
 * per group - `kind` inference, the single `commands` list, `keepEmptyAlias`, the `aliasName`
 * fallbacks - is either already known here or does not apply to an entry whose bodies live in
 * `parts`. What *is* shared is shared through the same helpers (`entryProse`, `keySlotsFrom`,
 * `categories.idFor`), so the two paths cannot disagree about a name, a category or a key slot.
 *
 * - `parts[i].aliasName` carries the half's kept name verbatim for a toggle, exactly as D6 does on
 *   the import side, which is what makes `alias-render.ts#twoPartHalfNames` reproduce an imported
 *   `zoomin`/`zoomout` trio (or our own `zoom_s1`/`zoom_s2`) byte for byte instead of deriving a
 *   fresh pair. A `press-release` half gets none: the renderer appends `+`/`-` to the entry's own
 *   base name and ignores a per-part name there by design, so storing one would be dead data.
 * - `parts[i].label` is the half's own line's `lbl` (story 045, D4) - read off the line named
 *   exactly like the half, never off a `_p<n>` chunk, which is precisely where `render.ts` puts it.
 * - `commands` stays `[]`, per `ConfigAction.parts`' own contract.
 */
export function buildTwoPartEntry(
  merge: TwoPartMerge,
  sections: readonly Section[],
  categories: ReturnType<typeof categoryRegistry>,
  newId: () => string,
  warnings: RestoreWarning[],
): ConfigAction {
  const group = merge.primary
  const first = group.aliases[0]?.item ?? group.binds[0]?.item ?? group.anchors[0]!.item

  const section = sectionFor(sections, first)
  if (section === null)
    warnings.push({
      reason: 'entry-section-unknown',
      file: first.file,
      line: first.line,
      subject: group.key,
    })

  // `merge.prose`, not `entryProse(group)`: the primary's own line is not always the one that kept
  // the whole display name (see `twoPartProse`).
  const prose = merge.prose
  const catalogId = group.aliases[0]?.fields.cid

  const parts = merge.halves.map((half): ActionEntryPart => {
    const label = half.group.aliases
      .find((line) => line.item.name === half.keptName)
      ?.fields.lbl?.trim()
    return {
      commands: commandsForHalf(half),
      ...(label ? { label } : {}),
      ...(merge.kind === 'toggle' ? { aliasName: half.keptName } : {}),
    }
  })

  const subcategoryId = categories.subcategoryIdFor(section)

  const base: ConfigAction = {
    id: newId(),
    categoryId: categories.idFor(section),
    ...(subcategoryId ? { subcategoryId } : {}),
    name: prose.length > 0 ? prose : merge.aliasName,
    kind: merge.kind,
    commands: [],
    ...(catalogId ? { catalogId } : {}),
    aliasName: merge.aliasName,
    parts: [parts[0]!, parts[1]!],
  }

  return keySlotsFrom(group, warnings).reduce(
    (carried, slot, index) => withKeySlot(carried, index, slot),
    base,
  )
}

/**
 * One half of a two-part entry's commands, with the chunk boundaries the file records still in place
 * (the same rule `commandsFromAliases` applies, on the path a toggle state or a `+`/`-` half takes).
 *
 * `half.segments` comes from the recogniser, which reads the half's *folded* body and therefore
 * cannot say where the writer's chunk boundaries were. The half's own alias lines can: they are the
 * `<half>_p<n>` family, and re-splitting each chunk body on its own is what keeps two adjacent
 * `wait` commands that straddle the boundary two commands.
 *
 * The recogniser's list stays the authority on *what the half's body is* - the two splits are
 * compared segment by segment first, and the recogniser's answer is used unchanged unless the chunk
 * split reproduces it exactly (a toggle state's list is the same one minus its trailing
 * `alias <dispatch> <other state>` rewrite, hence the one allowed missing tail segment). So a future
 * change to either splitter degrades to today's behaviour rather than to a silently different body.
 */
export function commandsForHalf(half: TwoPartMerge['halves'][number]): ConfigCommand[] {
  const chunks = foldedAliasBody(half.group.aliases).chunkBodies.map(splitAliasBody)
  const flat = chunks.flat()
  const tail = flat.length - half.segments.length
  const aligned =
    (tail === 0 || tail === 1) && half.segments.every((segment, index) => segment === flat[index])
  if (!aligned) return commandsFromSegments(half.segments)

  const kept = [...chunks]
  const last = kept.length - 1
  if (tail === 1) kept[last] = kept[last]!.slice(0, -1)
  return kept.flatMap((chunk) => commandsFromSegments(chunk))
}
