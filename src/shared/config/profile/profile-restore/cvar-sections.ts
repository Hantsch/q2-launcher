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
 * a cvar placement at all - `categoryKeyFor`'s counterpart one namespace over, pure and side-effect
 * free for the same reason (`cvarSectionRegistry` mints from it, and `created()` re-derives it for
 * every banner in the file to read the section order back off the document).
 *
 * Four `null` cases, and each one is a deliberate rule rather than a gap:
 *
 * - **the reserved `Defaults` bucket** (`cvs=defaults`, `CVAR_DEFAULTS_SECTION_ID`). The writer's
 *   always-write bucket for catalogue cvars no real section placed - never one of
 *   `profile.cvarSections`, so minting it here would turn the whole catalogue into a persisted
 *   section on the first reload and make the very next render write it out twice over. Its lines
 *   stay unplaced, which re-renders exactly the same bucket.
 * - **the reserved `Other` bucket** (`Section.kind: 'other'`), for the same reason and by the same
 *   rule the bind side already applies to it: "Other" is the absence of a section, not a section.
 * - **a bind-side or layer section.** A `set` line someone moved under an `Aliases: Weapons` banner
 *   is unplaced, not the seed of a cvar section named "Weapons" - the two groupings are separate
 *   namespaces (`cvs` vs `cat`), and minting across them would invent a section on one round trip
 *   and write it into the file on the next.
 * - **no section at all** - a `set` line above every banner in the file.
 *
 * `'plain'` (an untagged banner: a foreign `.cfg`'s group header, a pre-059 launcher file, a
 * hand-deleted `cvs=`) keys positionally, so it mints from its own title once something lands under
 * it - the lazy half, exactly as `categoryKeyFor` does for an untagged category banner.
 */
export function cvarSectionKeyFor(section: Section | null): string | null {
  if (section === null) return null
  // A sub-section files its lines under its parent section, which is where the placement lives; the
  // sub-section record itself is looked up separately (`registerSubsection`), exactly as
  // `categoryKeyFor`/`subcategoryIdFor` split the same question one namespace over.
  if (section.kind === 'cvarsubsection') return cvarSectionKeyFor(section.parent ?? null)
  // A `'subcategory'`-kind section - a real `[q2l sub=…]` banner or 053
  // D4's own repeated-decoration heuristic (`heuristicSubcategoryParent`) - carries no `cvs=`/
  // `cvsub=` tag of its own (`scanComments` never gives one both kinds of tag at once), so it has no
  // cvar-section identity independent of whatever it sits inside. Recursing into its own `parent`
  // (the nearest preceding `'category'`/`'plain'` header, same field the bind side's
  // `categoryKeyFor` already walks one namespace over) is what lets a foreign sub-banner under a
  // cvar-holding `'plain'` banner attribute its `set` lines correctly instead of falling to `null`
  // and reading back unplaced - see `registerSubsection`'s own doc comment for the second half (the
  // sub-section record itself).
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
 * counterpart of `categoryRegistry`, and deliberately built to the same shape: eager registration
 * from a `cvs=`/`cvsub=` tag, lazy minting from an untagged banner's own title, a stated id adopted
 * when well-formed and not yet taken and minted otherwise, and the
 * file's own banner order as the order the sections come back in.
 *
 * Eager is the important half, and for the same reason it is one namespace over: a section (or
 * sub-section) the user has just created holds no cvars, its banner is its only trace in the file -
 * `render.ts#buildCvarSectionBlock` writes it through `bannerSection` precisely so an empty one
 * still leaves one - and minting it only when a `set` line lands under it would make it vanish on
 * the first reload. It is also what makes a rename stick: the tag is the identity, so a section
 * whose banner text the user changed is still the same section rather than a new one.
 *
 * Unlike `categoryRegistry` there is no `ord`/three-block merge to undo here: `buildCvarSections`
 * renders every section in exactly one pass over `profile.cvarSections`, so document order already
 * *is* the profile's order (the story's own Decisions) and `created()` simply reads it back.
 *
 * The `cvs`/`cvsub` ids the file states are the lookup *keys* and the records'
 * own ids too. The template case mirrors `categoryRegistry`'s `mintTemplate` in what it adds on
 * top: an id naming one of the four seeded template sections (`STANDARD_TEMPLATE.cvarSections` -
 * `player`/`network`/`graphics`/`sound`) also gets its `nameKey` back, but only while the banner
 * still carries the template's frozen English name. A renamed one is plain prose from here on,
 * exactly like a user-created section.
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
  /** The writer's own two claim sets (`render.ts#makeCvarResolver`), mirrored: a catalogue cvar is
   * claimed by its catalogue identity (so two spellings of one cvar are one placement, exactly as
   * the writer emits one line for them) and anything else by its literal name. First placement in
   * the file wins, which is the story's rule and the writer's rule in one. */
  const placedCatalogIds = new Set<string>()
  const placedNames = new Set<string>()
  /** Every section and sub-section id this registry has handed out - see `adoptableId`. */
  const taken = new Set<string>()

  /**
   * The cvar section a line under `section` belongs to, minting it if this is the first thing to ask
   * for it - `null` for every section that holds no placements (`cvarSectionKeyFor`).
   */
  const ownerFor = (section: Section | null): ConfigCvarSection | null => {
    if (section === null) return null
    if (section.kind === 'cvarsubsection') return ownerFor(section.parent ?? null)
    // Same recursion, one section kind over - see `cvarSectionKeyFor`'s own
    // doc comment for why a `'subcategory'`-kind section has no cvar identity of its own.
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
    // A template id is kept verbatim exactly as `categoryRegistry#mintTemplate` keeps one; any other
    // stated id is adopted through `adoptableId`, and an untagged `'plain'` banner
    // (`stated === null`) mints from its title as before.
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
   * hold placements (a hand-edited `cvsub=` above every section header, or one under `Defaults`) -
   * in which case the lines under it are simply unplaced, never an error.
   */
  const registerSubsection = (section: Section): ConfigCvarSubsection | null => {
    // A `'subcategory'`-kind section (real `sub=` tag or 053 D4's heuristic
    // one, which reuses the same `sub` field for its synthetic key - see `HEURISTIC_SUBCATEGORY_PREFIX`)
    // has no `cvsub=` of its own to key by; `sub` is the only identity it carries, and reusing it here
    // is exactly what lets one physical sub-banner be both a bind sub-category and a cvar sub-section
    // independently (the story's "an untagged section mints a cvar section and a category
    // independently" rule, one level down).
    const stated =
      section.kind === 'subcategory'
        ? taggedSubcategoryId(section.fields)
        : taggedCvarSubsectionId(section.fields)
    if (stated === null) return null
    const key = cvarSectionKeyFor(section)
    if (key === null) return null
    // Mints the parent if this is the first mention of it - a section whose only content is a
    // sub-section still writes a banner, and dropping it would take the sub-section with it.
    const owner = ownerFor(section)
    if (owner === null) return null
    const known = subsections.get(key) ?? new Map<string, ConfigCvarSubsection>()
    subsections.set(key, known)
    const existing = known.get(stated)
    if (existing) return existing
    // a real `cvsub=` id is adopted (`adoptableId`). A `'subcategory'`-kind banner's
    // `sub` value is the bind side's identity, not a cvar sub-section id the file states, so that
    // shape keeps minting - adopting it would hand one id to two records of different kinds.
    const adoptable = section.kind === 'cvarsubsection' ? stated : null
    const record: ConfigCvarSubsection = {
      id: adoptableId(adoptable, taken, newId),
      name: section.title,
      cvars: [],
    }
    known.set(stated, record)
    // First-seen document order, which is the order `buildCvarSectionBlock` wrote them in. The
    // field is only created once there is something to put in it, so a section with no sub-sections
    // keeps the exact shape it had before.
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
      // A `'subcategory'`-kind section is the other shape a cvar sub-section
      // can arrive in - see `registerSubsection`'s own doc comment.
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
