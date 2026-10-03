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

/** Registry key of the shared fallback drawer - the one key that belongs to no section, which is why
 * it sorts last (`orderByFileSections`). Distinct from every section-derived key (`cat:<id>` or
 * `<kind>:<file>:<line>`). */
export const FALLBACK_CATEGORY_KEY = 'fallback'

/**
 * The registry key a section's entries are filed under - the identity a category's `Aliases: `,
 * `Binds: ` and `Entries: ` headers share (all carry the same `cat=` tag), `null` for a section that
 * never mints a category (the reserved "Other" bucket).
 *
 * Pure on purpose: `idFor` mints from it, and `orderByFileSections` re-derives it for every header
 * in the file - including those no entry was filed under, so a category whose `Binds:` header holds
 * all its entries still takes its place in the `Aliases:` block's sequence.
 */
export function categoryKeyFor(section: Section | null): string | null {
  if (section === null) return FALLBACK_CATEGORY_KEY
  // A sub-category files its lines under its parent: the second level is a grouping inside a
  // category, so `categoryId` must match the category's ungrouped run. A sub-banner with no parent
  // header (hand-edited) yields the fallback drawer like any other tagged line without a section.
  if (section.kind === 'subcategory') return categoryKeyFor(section.parent ?? null)
  if (section.kind === 'other') return null
  const tagged = section.fields.cat
  if (tagged !== undefined && tagged.length > 0) return `cat:${tagged}`
  return `${section.kind}:${section.file}:${section.line}`
}

/**
 * The minted categories in the order their sections appear in the file. Not "first header that
 * mentions the category": `render.ts` writes categories in three passes (aliases, binds,
 * `Entries:`), each only for categories with content, so document order is three interleaved
 * subsequences of one order.
 *
 * Each block (`Section.block`) gives its own sequence; they merge by an edge per consecutive pair,
 * then a topological walk picks, among categories nothing waits on, the one whose first header
 * comes first. A cyclic (contradictory) input takes the earliest remaining category rather than
 * dropping it; the fallback drawer belongs to no section and sorts last.
 *
 * `ord`: categories whose blocks never meet (one only unbound, one only bound) render identically
 * swapped, so `render.ts#categoryOrdinals` stamps each position into the header tag, applied on
 * top of the merge: no `ord` keeps the merged order; a category without one carries the last
 * `ord` seen forward; a duplicated or non-numeric `ord` counts as absent.
 */
export function orderByFileSections(
  created: ReadonlyMap<string, ConfigActionCategory>,
  sections: readonly Section[],
): ConfigActionCategory[] {
  const keys = [...created.keys()]
  const firstAt = new Map<string, number>()
  const sequences = new Map<string, string[]>()
  /** The `ord` the file states for a category, from the first of its headers carrying a readable
   * one. All three headers agree in a launcher-written file, so first-wins only arbitrates
   * hand-edited disagreements, deterministically. */
  const statedOrdinals = new Map<string, number>()

  sections.forEach((section, index) => {
    // A sub-category banner states nothing about category order. Its `categoryKeyFor` is its
    // parent's and its `block` is `undefined`, so keeping it would put every category with
    // sub-categories into the shared `''` sequence, inventing edges between categories that share no
    // block from which block the writer happens to emit first - the pair `ord` exists to answer.
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
    // A key repeated inside one block (two hand-edited headers) keeps its first position rather
    // than adding a self-edge.
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

/** A category header's `ord` as a number, or `null` when absent or something no writer of this
 * format wrote (`ord=first`, past the safe-integer range). `null` means unnumbered, which
 * `applyStatedOrdinals` treats as a position to preserve - the file is never rejected over
 * decoration. */
export function readOrdinal(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * `merged` re-sorted by the `ord` the file states for each category (`render.ts#categoryOrdinals`),
 * keeping the merged order wherever the file states nothing (see `orderByFileSections`).
 *
 * The sort key is `(ord, offset)`: a numbered category takes its own `ord` at offset 0; an
 * unnumbered one takes the last `ord` seen before it in merged order at a growing offset, landing
 * right behind the numbered category it already followed. A category before any numbered one carries
 * `-Infinity` and stays in front. Comparison is by `<`, not subtraction, so an infinite carry never
 * yields `NaN`; the sort is stable, so equal `ord`s keep their merged order.
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
 * One sub-category section registered into its parent category - eagerly, before any entry is read.
 *
 * This is the one deliberately non-lazy spot: a freshly created sub-category holds no entries, so
 * nothing would ask for it, yet `render.ts#withSubcategoryBuckets` writes its banner anyway
 * (`banner()` rather than `section()`, so an empty one still leaves a trace). Registering from the
 * tag makes that trace meaningful - the file is the source of truth for an empty row, one level
 * down. The parent is minted with it: a category whose only content is a sub-category
 * still renders a section, and dropping the category would take the sub-category along.
 *
 * The stated `sub` id is the lookup key (scoped to the parent's key) and also the record's id when
 * well-formed and not yet taken in this restore (`adoptableId`), so two categories stating the same
 * `sub` id keep two sub-categories. A heuristic `HEURISTIC_SUBCATEGORY_PREFIX` key is not stated by
 * the file and is never adopted.
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
  // `null` is the reserved "Other" bucket, the absence of a category (see `idFor`), so there is
  // nothing to hang a sub-category on; the lines under the banner still land where they would have.
  if (key === null) return
  // Mints the parent if this is its first mention.
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
  // First-seen document order, which is the order `withSubcategoryBuckets` wrote them in (all three
  // of a category's sections state the same order). The field is only created once non-empty, so a
  // category without sub-categories keeps its shape.
  category.subcategories = [...(category.subcategories ?? []), record]
}

/**
 * Hands out category ids lazily: one per distinct `cat` id, one per untagged banner, one shared
 * fallback drawer - so a launcher file's cvar-group and `Other binds` banners mint nothing.
 *
 * `created()` orders by the file's section order (`orderByFileSections`), not mint order (entry
 * discovery): `orderedCategoryIds` follows `profile.categories`, so this array is the next file's
 * section order and a different one would silently move sections nobody touched.
 *
 * A template `cat` id mints a real, ordinary category: leaving it without a record would point
 * entries at a category the profile lacks, and the next render would sweep them into "Other".
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

  /** A `cat=` id the file states is adopted (`adoptableId`) so the next render writes the same tag
   * back; an untagged banner states nothing and mints. */
  const mint = (key: string, name: string, stated?: string): string => {
    const existing = created.get(key)
    if (existing) return existing.id
    const category: ConfigActionCategory = { id: adoptableId(stated, taken, newId), name }
    created.set(key, category)
    return category.id
  }

  /**
   * A `cat` id naming a template category: the id verbatim, the header's title as the name (a
   * renamed category comes back renamed), and the template's `nameKey` re-attached only while the
   * title is still the template's English default. A renamed one is plain prose from then on.
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
   * The category id a section's lines are filed under, minting the category on first ask. Hoisted so
   * the eager sub-category pass can call it too: registering a sub-category must mint its parent.
   */
  const idFor = (section: Section | null): string => {
    if (section === null) return mint(FALLBACK_CATEGORY_KEY, FALLBACK_CATEGORY_NAME)
    // A sub-category's lines belong to the category it sits inside. Delegating (rather than minting
    // from this section) keeps the category's name its own instead of the sub-category's.
    if (section.kind === 'subcategory') return idFor(section.parent ?? null)
    // The reserved "Other" bucket is never minted into a persisted category: `render.ts` defines it
    // as "this `categoryId` matches nothing the profile has" (`groupByCategory`'s trailing bucket).
    // `ConfigAction.categoryId` is non-nullable, so a fresh `newId()` that is never registered gives
    // the action a valid id, and the next render buckets it back into "Other" - the fixed point.
    // Minting a real "Other" category would create one the source profile never had.
    const key = categoryKeyFor(section)
    if (key === null) return newId()
    const tagged = section.fields.cat
    if (tagged !== undefined && tagged.length > 0) {
      // A template id keeps its id and gets its `nameKey` back; any other `cat=` id is adopted too,
      // named from the header's title, so a colleague's category comes back under the id their file
      // states and the next render writes that tag back.
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
 * How this section identifies its category, for the "within the same section" scope an anchor is
 * matched in.
 *
 * Not the `Section` object itself: one category writes three banners (`Aliases: X`, `Binds: X`,
 * `Entries: X`), so an anchor and its entry sit under different header lines by construction. A
 * tagged header's `cat` id is the identity; the reserved "Other" bucket is one shared scope; an
 * untagged banner falls back to its title, which a category with a hand-deleted `cat=` still shares
 * across its three banners. A layer header stays per-line - membership is positional.
 */
export function sectionCategoryKey(section: Section | null): string {
  if (section === null) return 'none'
  if (section.kind === 'layer') return `layer:${section.file}:${section.line}`
  if (section.kind === 'other') return 'other'
  // A sub-category narrows the scope instead of sharing its parent's: its three banners state the
  // same parent and `sub` id so an entry's lines still meet, while two same-named entries in
  // different sub-categories of one category stay two entries.
  if (section.kind === 'subcategory') {
    return `${sectionCategoryKey(section.parent ?? null)}|sub:${taggedSubcategoryId(section.fields) ?? ''}`
  }
  const tagged = section.fields.cat
  if (tagged !== undefined && tagged.length > 0) return `cat:${tagged}`
  return `title:${section.title}`
}
