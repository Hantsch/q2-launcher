import { findCvar } from '@shared/config/catalog/cvar-catalog'
import { CVAR_DEFAULTS_SECTION_ID } from '@shared/config/syntax/file-vocabulary'
import {
  STANDARD_TEMPLATE,
  type ConfigCvarSection,
  type ConfigCvarSubsection,
} from '@shared/modules/config'
import type { Section } from './types'
import {
  taggedSubcategoryId,
  taggedCvarSectionId,
  taggedCvarSubsectionId,
  adoptableId,
} from './comment-parse'

/**
 * The registry key a section's `set` lines are filed under, or `null` for a section that never holds
 * a cvar placement - `categoryKeyFor`'s counterpart one namespace over, pure so `cvarSectionRegistry`
 * can mint from it and `created()` can re-derive it per banner to read the section order back.
 *
 * Each `null` case is a rule:
 *
 * - **the reserved `Defaults` bucket** (`cvs=defaults`, `CVAR_DEFAULTS_SECTION_ID`): the writer's
 *   always-write bucket is not one of `profile.cvarSections`, so minting it would persist the whole
 *   catalogue on first reload and write it out twice. Its lines stay unplaced and re-render the
 *   same bucket.
 * - **the reserved `Other` bucket** (`Section.kind: 'other'`): the absence of a section, as on the
 *   bind side.
 * - **a bind-side or layer section**: a `set` line moved under `Aliases: Weapons` is unplaced, not
 *   the seed of a cvar section - `cvs` and `cat` are separate namespaces.
 * - **no section at all**: a `set` line above every banner.
 *
 * `'plain'` (untagged banner: foreign group header, pre-059 file, hand-deleted `cvs=`) keys
 * positionally and mints from its own title once something lands under it, as `categoryKeyFor`
 * does for an untagged category banner.
 */
export function cvarSectionKeyFor(section: Section | null): string | null {
  if (section === null) return null
  // A sub-section files its lines under its parent, where the placement lives; the sub-section
  // record is looked up separately (`registerSubsection`).
  if (section.kind === 'cvarsubsection') return cvarSectionKeyFor(section.parent ?? null)
  // A `'subcategory'` section (a `[q2l sub=…]` banner or the repeated-decoration heuristic,
  // `heuristicSubcategoryParent`) carries no `cvs=`/`cvsub=` tag, so it takes its parent's cvar
  // identity; that lets a foreign sub-banner under a cvar-holding `'plain'` banner attribute its
  // `set` lines instead of reading back unplaced.
  if (section.kind === 'subcategory') return cvarSectionKeyFor(section.parent ?? null)
  if (section.kind === 'cvarsection') {
    const stated = taggedCvarSectionId(section.fields)
    if (stated === null || stated === CVAR_DEFAULTS_SECTION_ID) return null
    return `cvs:${stated}`
  }
  if (section.kind === 'plain') return `plain:${section.file}:${section.line}`
  return null
}

/**
 * Hands out cvar sections and sub-sections and files `set` lines into them - the Settings-tab
 * counterpart of `categoryRegistry`, built to the same shape: eager registration from a
 * `cvs=`/`cvsub=` tag, lazy minting from an untagged banner's title, a stated id adopted when
 * well-formed and free (minted otherwise), and the file's banner order as the section order.
 *
 * Eager matters because a freshly created, empty section's banner is its only trace in the file
 * (`render.ts#buildCvarSectionBlock` writes it through `bannerSection`); minting only when a `set`
 * line lands would lose it on reload. It also makes a rename stick: the tag is the identity.
 *
 * There is no `ord`/three-block merge to undo here: every section is rendered in one pass over
 * `profile.cvarSections`, so document order is the profile's order and `created()` reads it back.
 *
 * Stated `cvs`/`cvsub` ids are the lookup keys and the records' own ids. An id naming a seeded
 * template section (`STANDARD_TEMPLATE.cvarSections`) also gets its `nameKey` back, but only while
 * the banner still carries the template's frozen English name; a renamed one is plain prose.
 */
export function cvarSectionRegistry(
  newId: () => string,
  sections: readonly Section[],
): {
  place: (section: Section | null, name: string) => void
  created: () => ConfigCvarSection[]
} {
  const created = new Map<string, ConfigCvarSection>()
  /** `<section key>` -> `<the `cvsub` id the file states>` -> the locally minted record. */
  const subsections = new Map<string, Map<string, ConfigCvarSubsection>>()
  /** The writer's two claim sets (`render.ts#makeCvarResolver`), mirrored: a catalogue cvar is
   * claimed by catalogue identity (two spellings are one placement) and anything else by literal
   * name. First placement in the file wins. */
  const placedCatalogIds = new Set<string>()
  const placedNames = new Set<string>()
  /** Every section and sub-section id this registry has handed out - see `adoptableId`. */
  const taken = new Set<string>()

  /** The cvar section a line under `section` belongs to, minted on first ask, or `null` for a
   * section that holds no placements (`cvarSectionKeyFor`). */
  const ownerFor = (section: Section | null): ConfigCvarSection | null => {
    if (section === null) return null
    if (section.kind === 'cvarsubsection') return ownerFor(section.parent ?? null)
    // Same recursion as `cvarSectionKeyFor`: a `'subcategory'` section has no cvar identity.
    if (section.kind === 'subcategory') return ownerFor(section.parent ?? null)
    const key = cvarSectionKeyFor(section)
    if (key === null) return null
    const existing = created.get(key)
    if (existing) return existing
    const stated = taggedCvarSectionId(section.fields)
    const template =
      stated === null
        ? undefined
        : STANDARD_TEMPLATE.cvarSections.find((seed) => seed.id === stated)
    // A template id is kept verbatim like `categoryRegistry#mintTemplate`; any other stated id goes
    // through `adoptableId`, and an untagged `'plain'` banner mints from its title.
    if (template) taken.add(template.id)
    const record: ConfigCvarSection = template
      ? {
          id: template.id,
          name: section.title,
          ...(section.title === template.name && template.nameKey
            ? { nameKey: template.nameKey }
            : {}),
          cvars: [],
        }
      : { id: adoptableId(stated, taken, newId), name: section.title, cvars: [] }
    created.set(key, record)
    return record
  }

  /**
   * One sub-section registered into its parent section, minting both if needed. Returns the record a
   * `set` line under this banner is filed into, or `null` when the banner has no parent that can
   * hold placements (a `cvsub=` above every section header, or under `Defaults`) - its lines are
   * then unplaced, never an error.
   */
  const registerSubsection = (section: Section): ConfigCvarSubsection | null => {
    // A `'subcategory'` section (a real `sub=` tag or the heuristic, whose synthetic key reuses the
    // `sub` field - `HEURISTIC_SUBCATEGORY_PREFIX`) has no `cvsub=`; `sub` is its only identity, and
    // reusing it lets one physical banner be a bind sub-category and a cvar sub-section independently.
    const stated =
      section.kind === 'subcategory'
        ? taggedSubcategoryId(section.fields)
        : taggedCvarSubsectionId(section.fields)
    if (stated === null) return null
    const key = cvarSectionKeyFor(section)
    if (key === null) return null
    // Mints the parent on first mention: a section holding only a sub-section still writes a
    // banner, and dropping it would take the sub-section with it.
    const owner = ownerFor(section)
    if (owner === null) return null
    const known = subsections.get(key) ?? new Map<string, ConfigCvarSubsection>()
    subsections.set(key, known)
    const existing = known.get(stated)
    if (existing) return existing
    // A real `cvsub=` id is adopted (`adoptableId`); a `'subcategory'` banner's `sub` is the bind
    // side's identity, so it keeps minting - adopting it would give one id to two kinds of record.
    const adoptable = section.kind === 'cvarsubsection' ? stated : null
    const record: ConfigCvarSubsection = {
      id: adoptableId(adoptable, taken, newId),
      name: section.title,
      cvars: [],
    }
    known.set(stated, record)
    // First-seen document order, as `buildCvarSectionBlock` wrote them. The field is only created
    // once non-empty, so a section without sub-sections keeps its shape.
    owner.subsections = [...(owner.subsections ?? []), record]
    return record
  }

  for (const section of sections) {
    if (section.kind === 'cvarsection') ownerFor(section)
    if (section.kind === 'cvarsubsection') registerSubsection(section)
  }

  return {
    place(section, name) {
      const owner = ownerFor(section)
      if (owner === null) return
      const def = findCvar(name)
      const claimed = def ? placedCatalogIds : placedNames
      const claim = def ? def.name.toLowerCase() : name
      if (claimed.has(claim)) return
      claimed.add(claim)
      // A `'subcategory'` section is the other shape a cvar sub-section arrives in.
      const bucket =
        section?.kind === 'cvarsubsection' || section?.kind === 'subcategory'
          ? registerSubsection(section)
          : null
      ;(bucket ?? owner).cvars.push(name)
    },
    created() {
      const ordered: ConfigCvarSection[] = []
      const seen = new Set<string>()
      for (const section of sections) {
        if (section.kind !== 'cvarsection' && section.kind !== 'plain') continue
        const key = cvarSectionKeyFor(section)
        if (key === null || seen.has(key)) continue
        const record = created.get(key)
        if (record === undefined) continue
        seen.add(key)
        ordered.push(record)
      }
      return ordered
    },
  }
}
