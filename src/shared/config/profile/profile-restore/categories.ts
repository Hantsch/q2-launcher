import {
  TEMPLATE_ACTION_CATEGORIES,
  type ConfigActionCategory,
  type ConfigActionSubcategory,
} from '@shared/modules/config'
import { type Section, HEURISTIC_SUBCATEGORY_PREFIX } from './types'
import { taggedSubcategoryId, adoptableId } from './comment-parse'

/** Name for the drawer a tagged entry lands in when its own section cannot be determined - the
 * same plain-English label `alias-import.ts` gives an import's leftovers. */
export const FALLBACK_CATEGORY_NAME = 'Imported'

/** Registry key of the shared fallback drawer - the one key that belongs to no section at all, which
 * is why it sorts last (`orderByFileSections`). Distinct by construction from every section-derived
 * key, which is either `cat:<id>` or `<kind>:<file>:<line>`. */
export const FALLBACK_CATEGORY_KEY = 'fallback'

/**
 * The registry key a section's entries are filed under - the identity a category's `Aliases: `,
 * `Binds: ` and `Entries: ` headers share (all three carry the same `cat=` tag), `null` for a
 * section that never mints a category at all (the reserved "Other" bucket).
 *
 * Pure and side-effect free on purpose: `idFor` mints from it, and `orderByFileSections` re-derives
 * it for **every** header in the file - including the ones no entry happened to be filed under, so a
 * category whose `Binds:` header carries all its entries still takes its place in the `Aliases:`
 * block's sequence.
 */
export function categoryKeyFor(section: Section | null): string | null {
  if (section === null) return FALLBACK_CATEGORY_KEY
  // A sub-category section files its lines under its *parent*: the second level is a
  // grouping inside a category, never a category of its own, so `categoryId` has to come out the
  // same for an entry in a sub-category as for one in that category's ungrouped run. A sub-banner
  // with no parent header at all (hand-edited) yields the shared fallback drawer, exactly like any
  // other tagged line whose section cannot be determined.
  if (section.kind === 'subcategory') return categoryKeyFor(section.parent ?? null)
  if (section.kind === 'other') return null
  const tagged = section.fields.cat
  if (tagged !== undefined && tagged.length > 0) return `cat:${tagged}`
  return `${section.kind}:${section.file}:${section.line}`
}

/**
 * The minted categories in the order their sections appear in the file.
 *
 * Not simply "sort by the first header that mentions the category": `render.ts` writes the category
 * sections in three separate passes over `profile.categories` (aliases, then binds, then `Entries:`
 * anchors/unbound lines), and a category only gets a section in a pass that has something to put in
 * it. Document order is therefore three interleaved *subsequences* of one order - `Aliases: Alpha`
 * really does precede `Binds: Bewegung` in a file whose profile has Bewegung first - so the first
 * header alone reorders the rail exactly the way the bug being fixed here did, only more subtly.
 *
 * So each block (`Section.block`) contributes its own sequence, ordered within that block only, and
 * the sequences are merged: an edge per consecutive pair, then a topological walk that picks, among
 * the categories nothing is waiting on, the one whose first header comes first in the file. Since
 * every sequence is a subsequence of one and the same profile order, the merge reproduces that
 * order whenever the file states enough to determine it, and falls back to plain document order for
 * the pairs it does not (two categories that never share a block - possible only for a category
 * whose entries are all keyless aliases, where the file genuinely does not record the answer).
 *
 * Total and deterministic for any input, hand-edited files included: a contradictory pair of
 * sequences would leave a cycle with no zero-indegree node, and the loop then takes the earliest
 * remaining category by document position rather than dropping it. The fallback drawer belongs to no
 * section at all and so always sorts last.
 *
 * ## `ord`, and the pairs the sections genuinely cannot state
 *
 * The merge above is exact for every pair of categories that share a block, and *guesses* for the
 * rest - two categories whose blocks never meet have no header pair to compare, so it falls back to
 * document position, which only says which of their two blocks the writer emits first. That is not a
 * near-miss: a profile whose category Alpha has only unbound entries (an `Entries:` section) and
 * whose category Bravo has only bound ones (a `Binds:` section) renders **byte-identically** with
 * those two swapped, so the reader was not misreading a signal - there was none, and Alpha and Bravo
 * changed places in the rail on the first rebuild-from-file whichever way round the user had put
 * them.
 *
 * `render.ts#categoryOrdinals` therefore records each category's position in the header's own tag,
 * and it is applied *on top of* the merge rather than instead of it: the merged order stands, and
 * `ord` re-sorts it. That ordering keeps three things a plain "sort by `ord`" would not:
 *
 * - a file written before this field existed (or one whose tags were hand-deleted) orders exactly as
 *   it did, since a missing `ord` changes nothing;
 * - a category with no `ord` - a hand-added section in an otherwise launcher-written file, the
 *   fallback drawer - keeps its merged position *relative to the numbered ones* by carrying the last
 *   `ord` seen before it forward, instead of being swept to one end of the rail;
 * - hand-edited nonsense (a duplicated or non-numeric `ord`) degrades to the merged order for the
 *   categories it affects rather than reordering the file at random, because the sort is stable and
 *   an unreadable value is treated as absent.
 */
export function orderByFileSections(
  created: ReadonlyMap<string, ConfigActionCategory>,
  sections: readonly Section[],
): ConfigActionCategory[] {
  const keys = [...created.keys()]
  const firstAt = new Map<string, number>()
  const sequences = new Map<string, string[]>()
  /** The `ord` the file states for a category, from the first of its headers that carries a readable
   * one - all three of a category's headers carry the same value when this writer wrote them, so
   * "the first readable one wins" only ever picks between hand-edited disagreements, and it picks
   * deterministically. */
  const statedOrdinals = new Map<string, number>()

  sections.forEach((section, index) => {
    // A sub-category banner states nothing about the *category* order and must not be read as if it
    // did. Its `categoryKeyFor` is its parent's, and its `block` is `undefined` (a
    // sub-banner carries no `Aliases: `/`Binds: `/`Entries: ` prefix by design), so leaving it in
    // would drop every category that has sub-categories into the one shared `''` sequence below -
    // where the three per-block subsequences are interleaved rather than comparable, and an edge
    // between two categories that share no block would be invented from nothing but which block the
    // writer happens to emit first. That is precisely the pair `ord` exists to answer.
    if (section.kind === 'subcategory') return
    const key = categoryKeyFor(section)
    if (key === null || !created.has(key)) return
    if (!firstAt.has(key)) firstAt.set(key, index)
    if (!statedOrdinals.has(key)) {
      const ordinal = readOrdinal(section.fields.ord)
      if (ordinal !== null) statedOrdinals.set(key, ordinal)
    }
    const block = section.block ?? ''
    const sequence = sequences.get(block) ?? []
    // A key repeated inside one block (only reachable by hand-editing two headers of the same
    // category into the same block) keeps its first position rather than adding a self-edge.
    if (!sequence.includes(key)) sequence.push(key)
    sequences.set(block, sequence)
  })

  const successors = new Map<string, Set<string>>()
  const waitingOn = new Map<string, number>(keys.map((key) => [key, 0]))
  for (const sequence of sequences.values()) {
    for (let index = 1; index < sequence.length; index += 1) {
      const from = sequence[index - 1]!
      const to = sequence[index]!
      const edges = successors.get(from) ?? new Set<string>()
      if (!edges.has(to)) {
        edges.add(to)
        waitingOn.set(to, (waitingOn.get(to) ?? 0) + 1)
      }
      successors.set(from, edges)
    }
  }

  // A category with no header of its own (the fallback drawer) sorts behind every one that has one.
  const position = (key: string): number => firstAt.get(key) ?? Number.MAX_SAFE_INTEGER
  const remaining = new Set(keys)
  const ordered: ConfigActionCategory[] = []
  while (remaining.size > 0) {
    let pick: string | null = null
    for (const key of remaining) {
      if (waitingOn.get(key) !== 0) continue
      if (pick === null || position(key) < position(pick)) pick = key
    }
    // Only a cycle (a hand-edited file whose blocks contradict each other) gets here.
    if (pick === null) {
      for (const key of remaining) if (pick === null || position(key) < position(pick)) pick = key
    }
    const next = pick!
    remaining.delete(next)
    ordered.push(created.get(next)!)
    for (const successor of successors.get(next) ?? []) {
      waitingOn.set(successor, (waitingOn.get(successor) ?? 1) - 1)
    }
  }
  return applyStatedOrdinals(ordered, created, statedOrdinals)
}

/** A category header's `ord` value as a number, or `null` when the header carries none or carries
 * something no writer of this format ever wrote (a hand-edited `ord=first`, a value past the safe
 * integer range). `null` means "this category is unnumbered", which `applyStatedOrdinals` handles as
 * a position to preserve rather than as an error - the file is never rejected over decoration. */
export function readOrdinal(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * `merged` re-sorted by the `ord` the file states for each category (`render.ts#categoryOrdinals`),
 * with the merged order kept wherever the file states nothing - see `orderByFileSections`' doc
 * comment for why both halves are needed.
 *
 * The sort key is `(ord, offset)`: a numbered category takes its own `ord` at offset 0, and every
 * unnumbered category takes the last `ord` seen before it in the merged order at a growing offset,
 * so it lands immediately behind the numbered category it already followed. A category before any
 * numbered one carries `-Infinity` and stays at the front, in merged order. The comparison is by
 * `<` rather than by subtraction, so an infinite carry never produces `NaN`, and it is stable, so
 * two categories a hand-edited file gives the same `ord` keep the merged order between them.
 */
export function applyStatedOrdinals(
  merged: readonly ConfigActionCategory[],
  created: ReadonlyMap<string, ConfigActionCategory>,
  statedOrdinals: ReadonlyMap<string, number>,
): ConfigActionCategory[] {
  if (statedOrdinals.size === 0) return [...merged]

  const byCategory = new Map<ConfigActionCategory, number>()
  for (const [key, category] of created) {
    const ordinal = statedOrdinals.get(key)
    if (ordinal !== undefined) byCategory.set(category, ordinal)
  }

  const sortKeys = new Map<ConfigActionCategory, { ordinal: number; offset: number }>()
  let ordinal = Number.NEGATIVE_INFINITY
  let offset = 0
  for (const category of merged) {
    const stated = byCategory.get(category)
    if (stated === undefined) offset += 1
    else {
      ordinal = stated
      offset = 0
    }
    sortKeys.set(category, { ordinal, offset })
  }

  return [...merged].sort((a, b) => {
    const left = sortKeys.get(a)!
    const right = sortKeys.get(b)!
    if (left.ordinal !== right.ordinal) return left.ordinal < right.ordinal ? -1 : 1
    return left.offset - right.offset
  })
}

export interface CategoryRegistryState {
  created: Map<string, ConfigActionCategory>
  subcategories: Map<string, Map<string, ConfigActionSubcategory>>
  taken: Set<string>
  newId: () => string
}

/**
 * One sub-category section registered into its parent category - **eagerly**, before a single
 * entry has been read.
 *
 * That is the one place this registry is deliberately not lazy, and the reason is the shape the
 * lazy rule cannot see: a sub-category the user has just created holds no entries, so nothing
 * would ever ask for it, and `render.ts#withSubcategoryBuckets` writes its banner anyway
 * (`banner()` rather than `section()`, precisely so an empty one still leaves a trace). Registering
 * from the tag itself is what makes that trace mean something - it is story 052's "the file is the
 * source of truth for an empty row" mechanism one level down.
 *
 * Minting the *parent* eagerly with it follows from the same file: a category whose only content
 * is a sub-category renders a section too, and dropping the category would take the sub-category
 * with it. A category with neither is still minted by nothing at all, so a cvar group's banner
 * stays what it always was.
 *
 * The `sub` id the file states is the *lookup key*, scoped to its parent's key, and
 * also the record's own id when it is well-formed and not yet taken in this restore
 * (`adoptableId`) - so two categories that happen to state the same `sub` id stay two
 * sub-categories, the second one minted. A heuristic sub-category's synthetic
 * `HEURISTIC_SUBCATEGORY_PREFIX` key is not something the file states and is never adopted.
 */
export function registerSubcategory(
  state: CategoryRegistryState,
  idFor: (section: Section | null) => string,
  section: Section,
): void {
  const { created, subcategories, taken, newId } = state
  const stated = taggedSubcategoryId(section.fields)
  if (stated === null) return
  const key = categoryKeyFor(section)
  // `null` is the reserved "Other" bucket, which is the *absence* of a category (see `idFor`) and
  // so has nothing to hang a sub-category on. Nothing is registered; the lines under the banner
  // still land where they would have.
  if (key === null) return
  // Mints the parent if this is the first mention of it - see this function's doc comment.
  idFor(section)
  const category = created.get(key)
  if (!category) return
  const known = subcategories.get(key) ?? new Map<string, ConfigActionSubcategory>()
  subcategories.set(key, known)
  if (known.has(stated)) return
  const adoptable = stated.startsWith(HEURISTIC_SUBCATEGORY_PREFIX) ? null : stated
  const record: ConfigActionSubcategory = {
    id: adoptableId(adoptable, taken, newId),
    name: section.title,
  }
  known.set(stated, record)
  // Attached in first-seen document order, which is the order `withSubcategoryBuckets` wrote them
  // in: it walks `category.subcategories` for every one of the category's three sections, so all
  // three state the same order and the first of them settles it. The field is only created once
  // there is something to put in it, so a category with no sub-categories keeps the exact shape it
  // had before this story.
  category.subcategories = [...(category.subcategories ?? []), record]
}

/**
 * Hands out category ids, lazily: one category per distinct `cat` id, one per untagged section, and
 * one shared fallback drawer. Lazy is what keeps a normal launcher file's cvar-group and
 * `Other binds` banners from minting categories nothing is ever filed under.
 *
 * `created()` orders the minted categories by the file's own section order (`orderByFileSections`),
 * not by mint order: a category is minted the first time an **entry** asks for it, so mint order is
 * entry-discovery order and says nothing about where the sections sit in the file. Because
 * `orderedCategoryIds` follows `profile.categories`, this array *is* the next file's section order -
 * a different order would silently move sections nobody had touched (story 052 D5).
 *
 * A *template* `cat` id (`movement`/`weapons`/`drops`) mints a real, ordinary category like any
 * other: a profile has exactly the categories it carries, so adopting an id without a record would
 * point the restored entries at a category the profile does not have, and the next render would
 * sweep them into the trailing "Other" bucket, losing the name and position the file stated. It only
 * keeps its *id* rather than getting a local one, so that
 * `cat=` tags, the template seed and the migration all keep meaning the same drawer (the story's
 * Decisions: "built-in ids stay `movement`/`weapons`/`drops`").
 */
export function categoryRegistry(
  newId: () => string,
  sections: readonly Section[],
): {
  idFor: (section: Section | null) => string
  subcategoryIdFor: (section: Section | null) => string | undefined
  created: () => ConfigActionCategory[]
} {
  const created = new Map<string, ConfigActionCategory>()
  /** `<category key>` -> `<the `sub` id the file states>` -> the record it resolves to. */
  const subcategories = new Map<string, Map<string, ConfigActionSubcategory>>()
  /** Every category and sub-category id this registry has handed out - see `adoptableId`. */
  const taken = new Set<string>()

  /**
   * a `cat=` id the file states is adopted rather than re-minted (`adoptableId`), so
   * the next render writes the same tag back. An untagged banner states nothing and mints, exactly
   * as before.
   */
  const mint = (key: string, name: string, stated?: string): string => {
    const existing = created.get(key)
    if (existing) return existing.id
    const category: ConfigActionCategory = { id: adoptableId(stated, taken, newId), name }
    created.set(key, category)
    return category.id
  }

  /**
   * A `cat` id that names a template category: the id verbatim, the header's own title as the name
   * (a renamed category must come back renamed - AC 8), and the template's `nameKey` re-attached
   * only when the title is still exactly the template's English default, per the story's Decisions.
   * A renamed one is plain prose from here on, exactly like a user-created category.
   */
  const mintTemplate = (
    key: string,
    template: (typeof TEMPLATE_ACTION_CATEGORIES)[number],
    title: string,
  ): string => {
    const existing = created.get(key)
    if (existing) return existing.id
    const category: ConfigActionCategory = {
      id: template.id,
      name: title,
      ...(title === template.label ? { nameKey: template.labelKey } : {}),
    }
    taken.add(template.id)
    created.set(key, category)
    return category.id
  }

  /**
   * The category id a section's lines are filed under, minting the category if this is the first
   * thing to ask for it. Hoisted out of the returned object so the eager sub-category pass below can
   * call it too - registering a sub-category has to mint its parent, or the second level would be
   * attached to nothing.
   */
  const idFor = (section: Section | null): string => {
    if (section === null) return mint(FALLBACK_CATEGORY_KEY, FALLBACK_CATEGORY_NAME)
    // A sub-category banner is not a category: its lines belong to the category it sits inside, so
    // the whole question is delegated one level up. Delegating rather than reading
    // `categoryKeyFor`'s parent key and minting from *this* section is what keeps the category's
    // name the category's own - minting from here would name it after the sub-category.
    if (section.kind === 'subcategory') return idFor(section.parent ?? null)
    // The reserved "Other"/"Other binds" bucket
    // (`Section.kind === 'other'`) is deliberately never `mint()`-ed into a real, persisted
    // `ConfigActionCategory` - `ConfigAction.categoryId` still has to be *some* real string (the
    // field is non-nullable), but `render.ts`'s "Other" bucket is defined as "this categoryId
    // matches nothing the profile has" (`groupByCategory`'s trailing bucket), not as a stored
    // `null`. Handing back a fresh id from `newId()` that is never registered anywhere satisfies
    // both: the action gets a valid id, and because that id was never added to any category list,
    // the very next render buckets it right back into the untagged "Other" section - the same
    // outcome the original (unrecoverable) orphaned id would have produced, and the fixed point AC2
    // asks for. Minting a real "Other" category would create one the source profile never had.
    // `categoryKeyFor` is `null` for exactly that bucket, and is the *only* place a key is
    // derived from a section - `orderByFileSections` reads the same one back off the file.
    const key = categoryKeyFor(section)
    if (key === null) return newId()
    const tagged = section.fields.cat
    if (tagged !== undefined && tagged.length > 0) {
      // A template id keeps its id and gets its `nameKey` back - see this registry's doc comment.
      // Any other `cat=` id is adopted too, named from the header's
      // own title, so a colleague's category comes back as a real local category under the id
      // their file states and the next render writes that same tag back.
      const template = TEMPLATE_ACTION_CATEGORIES.find((category) => category.id === tagged)
      return template
        ? mintTemplate(key, template, section.title)
        : mint(key, section.title, tagged)
    }
    return mint(key, section.title)
  }

  for (const section of sections) {
    if (section.kind === 'subcategory') {
      registerSubcategory({ created, subcategories, taken, newId }, idFor, section)
    }
  }

  return {
    idFor,
    subcategoryIdFor(section) {
      if (section === null || section.kind !== 'subcategory') return undefined
      const stated = taggedSubcategoryId(section.fields)
      if (stated === null) return undefined
      const key = categoryKeyFor(section)
      return key === null ? undefined : subcategories.get(key)?.get(stated)?.id
    },
    created: () => orderByFileSections(created, sections),
  }
}

/**
 * How this section identifies its *category*, for the "within the same section" scope an anchor is
 * matched in (the story's decision).
 *
 * Not the `Section` object itself: one category writes three separate banners in a launcher file
 * (`Aliases: X`, `Binds: X`, `Entries: X` - `render.ts`), so an anchor and the entry it belongs to
 * sit under three *different* header lines of the same category by construction. A tagged header's
 * `cat` id is that identity; the reserved "Other" bucket is one shared scope (all three of its
 * banners are `kind: 'other'`); an untagged banner falls back to its own title, which is what a
 * category whose `cat=` tag was hand-deleted still has in common across its three banners. A layer
 * header stays per-line, since layer membership is positional and never shared.
 */
export function sectionCategoryKey(section: Section | null): string {
  if (section === null) return 'none'
  if (section.kind === 'layer') return `layer:${section.file}:${section.line}`
  if (section.kind === 'other') return 'other'
  // A sub-category narrows the scope rather than sharing its parent's. The three
  // banners of one sub-category (its category's `Aliases: `/`Binds: `/`Entries: ` sections each carry
  // it, `withSubcategoryBuckets`) state the same parent and the same `sub` id, so an entry's own
  // lines still meet - and two entries the user named the same thing in two different
  // sub-categories of one category stay two entries, for exactly the reason the scope was made
  // per-category in the first place.
  if (section.kind === 'subcategory') {
    return `${sectionCategoryKey(section.parent ?? null)}|sub:${taggedSubcategoryId(section.fields) ?? ''}`
  }
  const tagged = section.fields.cat
  if (tagged !== undefined && tagged.length > 0) return `cat:${tagged}`
  return `title:${section.title}`
}
