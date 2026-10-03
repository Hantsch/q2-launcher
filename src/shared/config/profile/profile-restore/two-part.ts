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
// Two-part entries: the toggle trio and the `+x`/`-x` pair (story 045)
// ---------------------------------------------------------------------------

/**
 * One accepted merge: the 2-3 `EntryGroup`s the config text wires into a single `toggle`/
 * `press-release` entry, and which of them the entry stands in for.
 */
export interface TwoPartMerge {
  kind: 'toggle' | 'press-release'
  /**
   * The entry's one display prose, reassembled across the merged groups: the longest, the merge
   * having happened only because every shorter one is the cut that line's own byte budget would make
   * (`twoPartProse`). Carried here rather than re-read off `primary`, which is not always the line
   * that kept the whole name - a press/release primary is its `+` half, the one a long body truncates.
   */
  prose: string
  /**
   * The group the merged entry takes the place of: its output position, prose, `cid`, section and
   * key slots. Its own name is what `action-mirror.ts#bindValueFor` writes on every key of the
   * entry, so it is the group a `bind` line lands in: the dispatch alias for a toggle
   * (`bind v "zoom"`), the press half for a pair (`bind SHIFT "+slow"`, sign included, because
   * `groupEntryLines` keys on the literal alias name / bind value text).
   */
  primary: EntryGroup
  /** The name the merged entry renders under: the dispatch name, or the pair's sign-free base. */
  aliasName: string
  /** State 1 then state 2, or press then release - the order `parts` is stored in. */
  halves: { group: EntryGroup; keptName: string; segments: readonly string[] }[]
  /** Every group the merge consumes, `primary` included, so none also becomes its own entry. */
  consumed: EntryGroup[]
}

/**
 * Does this group claim a key of its own (a `bind` line or an anchor line)?
 *
 * Recognition runs before the anchor scan, so in practice only the bind half can be non-empty. Both
 * are checked anyway: an anchor is a key claim by definition, and a predicate that depends on when it
 * is called breaks silently under a later reordering.
 */
export function claimsAKey(group: EntryGroup): boolean {
  return group.binds.length > 0 || group.anchors.length > 0
}

/**
 * The one display prose the groups of a two-part merge agree on, or `null` - the gate deciding
 * whether these 2-3 alias families are one entry or several wired into an idiom.
 *
 * Not string equality: each line of the family spends its own byte budget on its code first, so
 * one carries `Zoom with a long name` and another `Zoom with a l`; requiring equality would split
 * the entry on read-back and break the fixed point. Not a plain prefix relation either: `Slow`,
 * `Slow mo`, `Slow motion walk` on three cramped lines would collapse into one, losing two names.
 * So every line's prose must be what the writer would have written there for the candidate name
 * (`proseCutOf` re-runs `fitProseAndTag` against that line's own budget). The result is the
 * longest candidate - restoring a truncated one would shorten the other lines a render later.
 */
export function twoPartProse(primary: EntryGroup, groups: readonly EntryGroup[]): string | null {
  const lines = groups.flatMap((group) => group.aliases)
  // `entryProse(primary)` is a candidate too: a primary whose alias line lost its prose still has
  // bind/anchor lines to name it, the fallback `buildEntry` would use for a standalone group.
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
 * A recognised toggle trio -> one merge, or `null` when the file says these are separate entries.
 * `entry-idioms.ts` decides whether the bodies are wired as a toggle; this reader adds two
 * conditions:
 *
 *  - **One prose across all three lines** (`twoPartProse`): three disagreeing lines are three
 *    entries wired into a loop, and merging would drop two names and two comments.
 *  - **Neither state claims a key**: the writer binds a toggle's dispatch only, so merging would
 *    move a hand-typed key onto the dispatch value, which "the config line wins" forbids.
 *
 * Either failure falls back to the per-group `buildEntry` path (all-or-nothing).
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
 * The same two conditions as `toggleMergeFor` (one prose, no key on the release half), plus one of
 * its own: the release name must be exactly `-<base>`, casing included. `entry-idioms.ts` pairs the
 * halves case-insensitively like the engine's alias lookup, but a `press-release` entry stores only
 * the sign-free base and appends `+`/`-` at render time, so merging `+Slow` with a
 * hand-written `-slow` would re-render it as `-Slow` - renaming a line the user typed.
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
 * Every two-part entry the config text wires out of `groups`, found by the recogniser
 * `alias-import.ts` shares (there is no `k` tag, so both readers derive the kind from the text).
 *
 * One `{ name, body }` per group, the body recombined (`foldedAliasBody`), so a chunk-split toggle
 * state is recognised. Recognition runs per category scope: an alias family lives in one
 * category's alias section, so scoping costs a healthy file nothing, while merging across sections
 * would break the fixed point.
 *
 * `waitAliases` is deliberately not used: it would resolve `alias hop20 "hop5; hop5; hop5; hop5"`
 * to one `{ kind: 'wait', frames: 20 }` and re-render twenty literal `wait`s, rewriting four
 * references. Our file writes `wait` as literal segments (`collapseWaitRuns`).
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
 * One `toggle`/`press-release` entry out of the groups `merge` collapses. A parallel path to
 * `buildEntry`, not a branch in it: what that derives per group does not apply to an entry whose
 * bodies live in `parts`. Shared helpers keep the two agreeing on name, category and key slot.
 *
 * - `parts[i].aliasName` carries a toggle half's name verbatim so `alias-render.ts#twoPartHalfNames`
 *   reproduces the trio byte for byte; a `press-release` half gets none (the renderer ignores it).
 * - `parts[i].label` is the `lbl` of the line named exactly like the half, never of a `_p<n>` chunk.
 * - `commands` stays `[]`, per `ConfigAction.parts`' contract.
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

  // `merge.prose`, not `entryProse(group)`: the primary's line is not always the one that kept the
  // whole name (see `twoPartProse`).
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
 * One half of a two-part entry's commands, keeping the chunk boundaries the file records. The
 * recogniser reads the folded body and cannot say where the writer split chunks; the half's own
 * `<half>_p<n>` lines can, so two `wait`s straddling a boundary stay two commands. The recogniser
 * stays the authority: its answer is used unless the chunk split reproduces it exactly (a toggle
 * state differs by one trailing `alias <dispatch> <other state>` segment).
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
