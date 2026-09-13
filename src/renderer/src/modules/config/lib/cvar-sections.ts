import { CVAR_DEFAULTS_SECTION_ID } from '@shared/config/render'
import type { ConfigCvarSection, ConfigCvarSubsection } from '@shared/modules/config'

/**
 * Story 059 D8: pure array math for editing `profile.cvarSections`, mirroring
 * `lib/delete-category.ts`/`lib/entry-order.ts` and `ControlsTab.tsx`'s inline category/
 * sub-category handlers one level down (sections/sub-sections of cvars instead of categories/
 * sub-categories of actions). `SettingsTab.tsx` is the single owner of the draft and the save path,
 * same as `ControlsTab` is for categories/actions - every function here only computes the next
 * array, never persists it.
 */

export function createCvarSection(name: string): ConfigCvarSection {
  return { id: crypto.randomUUID(), name, cvars: [] }
}

/**
 * Story 052 D7's "a rename drops it" rule, applied to `nameKey` only: unlike
 * `ControlsTab#handleRenameCategory` (which rebuilds the whole object from just `{ id, name }`,
 * silently dropping `subcategories` too - an oversight that predates sub-categories existing at
 * all), a cvar section's `cvars`/`subsections` are its entire reason for being and must survive a
 * rename intact. Only `nameKey` - the seed's display hint, meaningless once the section has a
 * user-typed name of its own - is dropped.
 */
export function renameCvarSection(
  sections: ConfigCvarSection[],
  sectionId: string,
  name: string,
): ConfigCvarSection[] {
  return sections.map((section) => {
    if (section.id !== sectionId) return section
    const { nameKey: _dropped, ...rest } = section
    return { ...rest, name }
  })
}

/** Adjacent-swap reorder, mirroring `ControlsTab#handleMoveCategory` one level down. */
export function moveCvarSection(
  sections: ConfigCvarSection[],
  sectionId: string,
  direction: 'up' | 'down',
): ConfigCvarSection[] {
  const index = sections.findIndex((section) => section.id === sectionId)
  if (index === -1) return sections
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= sections.length) return sections
  const next = [...sections]
  const moved = next[index]!
  next[index] = next[targetIndex]!
  next[targetIndex] = moved
  return next
}

/**
 * Deletes a section, dialog-free (story 059 Decisions: mirrors 053's dialog-free sub-category
 * delete, NOT 052's delete-or-move modal - "052's delete-or-move modal would be ceremony" here).
 * Every cvar the deleted section held - its own ungrouped run and every sub-section's - moves to
 * the PREVIOUS section in profile order; the first section instead hands its cvars to the
 * FOLLOWING one (there is no previous); and deleting the profile's only section leaves its cvars
 * with no section at all - they simply fall into the reserved Defaults/Other buckets the next
 * render computes, since nothing here ever touches `profile.cvars` itself (AC: deleting a section
 * keeps every cvar).
 */
export function deleteCvarSection(
  sections: ConfigCvarSection[],
  sectionId: string,
): ConfigCvarSection[] {
  const index = sections.findIndex((section) => section.id === sectionId)
  if (index === -1) return sections
  const removed = sections[index]!
  const remaining = sections.filter((_, i) => i !== index)
  if (remaining.length === 0) return remaining

  const targetOriginalIndex = index === 0 ? 1 : index - 1
  const targetId = sections[targetOriginalIndex]!.id
  return remaining.map((section) =>
    section.id === targetId
      ? {
          ...section,
          cvars: [...section.cvars, ...removed.cvars],
          subsections: [...(section.subsections ?? []), ...(removed.subsections ?? [])],
        }
      : section,
  )
}

/** Mirrors `ControlsTab#handleCreateSubcategory` one level down: appends a fresh, empty
 * sub-section to `sectionId`'s own list. */
export function createCvarSubsection(
  sections: ConfigCvarSection[],
  sectionId: string,
  name: string,
): ConfigCvarSection[] {
  const subsection: ConfigCvarSubsection = { id: crypto.randomUUID(), name, cvars: [] }
  return sections.map((section) =>
    section.id === sectionId
      ? { ...section, subsections: [...(section.subsections ?? []), subsection] }
      : section,
  )
}

/** A sub-section has no `nameKey` to drop (`ConfigCvarSubsection` never carries one), so this is a
 * plain rename - mirrors `ControlsTab#handleRenameSubcategory`. */
export function renameCvarSubsection(
  sections: ConfigCvarSection[],
  sectionId: string,
  subsectionId: string,
  name: string,
): ConfigCvarSection[] {
  return sections.map((section) =>
    section.id === sectionId
      ? {
          ...section,
          subsections: (section.subsections ?? []).map((subsection) =>
            subsection.id === subsectionId ? { ...subsection, name } : subsection,
          ),
        }
      : section,
  )
}

/** Mirrors `ControlsTab#handleMoveSubcategory` one level down. */
export function moveCvarSubsection(
  sections: ConfigCvarSection[],
  sectionId: string,
  subsectionId: string,
  direction: 'up' | 'down',
): ConfigCvarSection[] {
  return sections.map((section) => {
    if (section.id !== sectionId) return section
    const subsections = section.subsections ?? []
    const index = subsections.findIndex((subsection) => subsection.id === subsectionId)
    if (index === -1) return section
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= subsections.length) return section
    const nextSubsections = [...subsections]
    const moved = nextSubsections[index]!
    nextSubsections[index] = nextSubsections[targetIndex]!
    nextSubsections[targetIndex] = moved
    return { ...section, subsections: nextSubsections }
  })
}

/**
 * Deletes a sub-section, dialog-free (story 059 Decisions, same as `deleteCvarSection`): unlike
 * deleting a section, there is only ever one outcome here, no "which section" choice to make -
 * its cvars fall into the parent section's own ungrouped run rather than becoming unplaced.
 * Mirrors `ControlsTab#handleDeleteSubcategory`.
 */
export function deleteCvarSubsection(
  sections: ConfigCvarSection[],
  sectionId: string,
  subsectionId: string,
): ConfigCvarSection[] {
  return sections.map((section) => {
    if (section.id !== sectionId) return section
    const subsections = section.subsections ?? []
    const target = subsections.find((subsection) => subsection.id === subsectionId)
    if (!target) return section
    return {
      ...section,
      cvars: [...section.cvars, ...target.cvars],
      subsections: subsections.filter((subsection) => subsection.id !== subsectionId),
    }
  })
}

/** Strips `name` out of every section's own run and every sub-section's, wherever it currently
 * sits - the shared first step both "move to another section" and "remove from this section"
 * (unplace) need, so a cvar can never end up listed twice after either operation. */
export function removeCvarFromSections(
  sections: ConfigCvarSection[],
  name: string,
): ConfigCvarSection[] {
  return sections.map((section) => ({
    ...section,
    cvars: section.cvars.filter((cvar) => cvar !== name),
    subsections: (section.subsections ?? []).map((subsection) => ({
      ...subsection,
      cvars: subsection.cvars.filter((cvar) => cvar !== name),
    })),
  }))
}

/** One place a cvar can be placed: a section's own ungrouped run (`subsectionId` omitted) or one
 * of its sub-sections. */
export interface CvarPlacementTarget {
  sectionId: string
  subsectionId?: string
}

/**
 * Moves `name` to `target`, removing it from wherever it already sat first (story 059 D8: "move a
 * cvar to another section... changes which section's `cvars` array contains its name"). Also how a
 * freshly added cvar is placed into the section its "Add cvar" dialog was opened from - adding and
 * moving are the same array operation, only the caller's reason for calling it differs.
 */
export function moveCvarToSection(
  sections: ConfigCvarSection[],
  name: string,
  target: CvarPlacementTarget,
): ConfigCvarSection[] {
  const cleaned = removeCvarFromSections(sections, name)
  return cleaned.map((section) => {
    if (section.id !== target.sectionId) return section
    if (!target.subsectionId) return { ...section, cvars: [...section.cvars, name] }
    return {
      ...section,
      subsections: (section.subsections ?? []).map((subsection) =>
        subsection.id === target.subsectionId
          ? { ...subsection, cvars: [...subsection.cvars, name] }
          : subsection,
      ),
    }
  })
}

/** One selectable entry for a "move to..." picker: every section's own run, then each of its
 * sub-sections, in profile order - the same order sections/sub-sections render in. */
export interface CvarPlacementOption extends CvarPlacementTarget {
  label: string
}

export function cvarPlacementOptions(
  sections: readonly ConfigCvarSection[],
  sectionLabel: (section: ConfigCvarSection) => string,
): CvarPlacementOption[] {
  const options: CvarPlacementOption[] = []
  for (const section of sections) {
    const label = sectionLabel(section)
    options.push({ sectionId: section.id, label })
    for (const subsection of section.subsections ?? []) {
      options.push({ sectionId: section.id, subsectionId: subsection.id, label: `${label} / ${subsection.name}` })
    }
  }
  return options
}

/**
 * Story 054 D9: index-position reorder for drag-and-drop, one level more precise than
 * `moveCvarSection`'s adjacent up/down swap - a drop needs "land at this exact index", not "nudge
 * one step". `Defaults`/`Other` (`cvar-rows.ts`'s reserved `CvarGroupKind`s) are never minted as
 * entries of `profile.cvarSections` in the first place - `buildCvarSectionGroups` computes and
 * appends them at render time (`render.ts#buildCvarSections` never writes an id for them into the
 * profile either) - so there is structurally no reserved-bucket element in `sections` for a real
 * section to ever displace. `RESERVED_CVAR_SECTION_IDS` is only a defensive guard against a caller
 * that (mistakenly) passes one of those reserved ids as `sectionId` - it makes the "reserved
 * buckets are never reordered themselves" rule hold even if that structural guarantee is ever
 * broken upstream, rather than relying on `findIndex` returning -1 by accident.
 */
const RESERVED_CVAR_SECTION_IDS = new Set<string>([CVAR_DEFAULTS_SECTION_ID, 'other'])

/** Removes the item at `fromIndex` and reinserts it at `toIndex`, clamped to the array's bounds -
 * the shared index-move primitive `moveSectionToIndex`/`moveSubsectionToIndex` both reduce to. */
function moveItemToIndex<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  const clampedIndex = Math.max(0, Math.min(toIndex, next.length))
  next.splice(clampedIndex, 0, moved as T)
  return next
}

/** Reorders top-level sections by index (story 054 D9). No-op for an unknown `sectionId` or one of
 * the reserved bucket ids (see above) - never for a real section id, however far `toIndex` is out
 * of range: `moveItemToIndex` clamps that instead of refusing the move. */
export function moveSectionToIndex(
  sections: ConfigCvarSection[],
  sectionId: string,
  toIndex: number,
): ConfigCvarSection[] {
  if (RESERVED_CVAR_SECTION_IDS.has(sectionId)) return sections
  const index = sections.findIndex((section) => section.id === sectionId)
  if (index === -1) return sections
  return moveItemToIndex(sections, index, toIndex)
}

/** Reorders one section's sub-sections by index (story 054 D9), mirroring `moveSectionToIndex` one
 * level down. Sub-sections have no reserved counterpart - the `Defaults`/`Other` buckets are always
 * top-level groups (`cvar-rows.ts#finishGroup` never nests one under a sub-section) - so there is no
 * reserved-id guard to mirror here. No-op for an unknown `subsectionId`. */
export function moveSubsectionToIndex(
  section: ConfigCvarSection,
  subsectionId: string,
  toIndex: number,
): ConfigCvarSection {
  const subsections = section.subsections ?? []
  const index = subsections.findIndex((subsection) => subsection.id === subsectionId)
  if (index === -1) return section
  return { ...section, subsections: moveItemToIndex(subsections, index, toIndex) }
}

/** Where `moveCvarToPosition` should land a cvar: `CvarPlacementTarget`'s section/sub-section pair
 * plus the index within that list's (post-removal) run to insert at - the same `sectionId`/
 * `subsectionId` field names `moveCvarToSection`/`cvarPlacementOptions` already use, so a caller
 * building this from a `CvarPlacementOption` only has to add `index`. */
export interface CvarPositionTarget extends CvarPlacementTarget {
  index: number
}

/**
 * Moves `name` to an exact index within `target`'s section (or sub-section) run (story 054 D9),
 * the drag-and-drop counterpart to `moveCvarToSection`'s "append to this section" - reusing
 * `removeCvarFromSections` for the same "strip it from wherever it sits first" step so a cvar can
 * never end up listed twice.
 *
 * No-op when `target.sectionId` names a reserved bucket (`Defaults`/`Other` are computed, never
 * populated by hand - see `RESERVED_CVAR_SECTION_IDS` above) or an unknown section/sub-section id.
 *
 * Deliberately does *not* require `name` to already be present in `sections`: the reserved buckets
 * hold every catalogue/unplaced cvar the profile's sections do not mention (`cvar-rows.ts`), so a
 * name "moved out of Defaults/Other" is, from this array's point of view, a name `sections` has
 * never heard of - exactly the case D9 requires to work (moving out of a reserved bucket into a
 * real section). Treating an unfamiliar name as an error would make that direction impossible, so
 * the only "unknown id" no-op here is the destination's, not the cvar's.
 */
export function moveCvarToPosition(
  sections: ConfigCvarSection[],
  name: string,
  target: CvarPositionTarget,
): ConfigCvarSection[] {
  if (RESERVED_CVAR_SECTION_IDS.has(target.sectionId)) return sections
  const targetSection = sections.find((section) => section.id === target.sectionId)
  if (!targetSection) return sections
  if (
    target.subsectionId &&
    !(targetSection.subsections ?? []).some((subsection) => subsection.id === target.subsectionId)
  ) {
    return sections
  }

  const cleaned = removeCvarFromSections(sections, name)
  return cleaned.map((section) => {
    if (section.id !== target.sectionId) return section
    if (!target.subsectionId) {
      return { ...section, cvars: insertAt(section.cvars, target.index, name) }
    }
    return {
      ...section,
      subsections: (section.subsections ?? []).map((subsection) =>
        subsection.id === target.subsectionId
          ? { ...subsection, cvars: insertAt(subsection.cvars, target.index, name) }
          : subsection,
      ),
    }
  })
}

/** Inserts `value` at `index`, clamped to `[0, items.length]` - the same clamping rule
 * `moveItemToIndex` uses, so an out-of-range drop index never throws, it just lands at the nearer
 * end. */
function insertAt<T>(items: readonly T[], index: number, value: T): T[] {
  const next = [...items]
  const clampedIndex = Math.max(0, Math.min(index, next.length))
  next.splice(clampedIndex, 0, value)
  return next
}
