import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowLeftRight, ArrowUp, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { closestCenter, type CollisionDetection, type UniqueIdentifier } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { ConfigCvarSection, ConfigCvarSubsection, ConfigProfile } from '@shared/modules/config'
import type { EngineKind } from '@shared/types/engine'
import { CVAR_DEFAULTS_SECTION_ID } from '@shared/config/render'
import { Button, IconButton } from '../../components/ui/Button'
import { Input, Switch } from '../../components/ui/controls'
import {
  DragHandle,
  SortableItem,
  SortableZone,
  type SortableDropMeta,
} from '../../components/dnd'
import { cn } from '../../lib/cn'
import { useLauncher } from '../../store/useLauncher'
import { AddCvarDialog } from './components/AddCvarDialog'
import { CreateCvarSectionDialog } from './components/CreateCvarSectionDialog'
import { CreateCvarSubsectionDialog } from './components/CreateCvarSubsectionDialog'
import { CvarRow, PlainCvarRow } from './components/CvarRow'
import { EngineScopeSelect } from './components/EngineScopeSelect'
import { MoveCvarDialog } from './components/MoveCvarDialog'
import { RenameCvarSectionDialog } from './components/RenameCvarSectionDialog'
import { RenameCvarSubsectionDialog } from './components/RenameCvarSubsectionDialog'
import { namedDisplayName } from './lib/category-display'
import {
  createCvarSection,
  createCvarSubsection,
  cvarPlacementOptions,
  deleteCvarSection,
  deleteCvarSubsection,
  moveCvarSection,
  moveCvarSubsection,
  moveCvarToPosition,
  moveCvarToSection,
  moveSectionToIndex,
  moveSubsectionToIndex,
  removeCvarFromSections,
  renameCvarSection,
  renameCvarSubsection,
  type CvarPlacementOption,
} from './lib/cvar-sections'
import {
  buildCvarSectionGroups,
  visibleRowsOf,
  type CvarRowEntry,
  type CvarSectionResult,
} from './lib/cvar-rows'
import { assignedEngineKinds } from './lib/engine-scope'
import { useProfileChanges } from './lib/profile-changes'
import { updateProfileCvars, updateProfileWriteCatalogDefaults } from './client'

/**
 * Story 054 D10: id-namespacing for the two header drag axes, mirroring `ControlsDragZone.tsx`'s
 * `subcategoryDragId`/`categoryDragId` one level up - a section header's and a sub-section header's
 * own `SortableItem` ids can never collide with a cvar row's (a cvar's raw name, the primary zone's
 * `items`), so `settingsCollisionDetection` and the zone's `onDropOutside` can both tell "a header was
 * dropped on another header" apart from "a cvar was dropped among the rows" by the id alone.
 */
const SECTION_DRAG_PREFIX = 'section-drag:'

function sectionDragId(sectionId: string): string {
  return `${SECTION_DRAG_PREFIX}${sectionId}`
}

function sectionIdFromDragId(id: UniqueIdentifier): string | undefined {
  const value = String(id)
  return value.startsWith(SECTION_DRAG_PREFIX) ? value.slice(SECTION_DRAG_PREFIX.length) : undefined
}

const SUBSECTION_DRAG_PREFIX = 'subsection-drag:'

/** Namespaced by its *own section's* id too (unlike a Controls sub-category, which only ever has one
 * category): every section's sub-sections are on screen at once here (Settings is one long page, not
 * a per-category tab), so a sub-section drag must resolve only against another header of the *same*
 * section - `settingsCollisionDetection` reads the section id back out of this to enforce that. */
function subsectionDragId(sectionId: string, subsectionId: string): string {
  return `${SUBSECTION_DRAG_PREFIX}${sectionId}:${subsectionId}`
}

function subsectionIdsFromDragId(
  id: UniqueIdentifier,
): { sectionId: string; subsectionId: string } | undefined {
  const value = String(id)
  if (!value.startsWith(SUBSECTION_DRAG_PREFIX)) return undefined
  const rest = value.slice(SUBSECTION_DRAG_PREFIX.length)
  const separator = rest.indexOf(':')
  if (separator === -1) return undefined
  return { sectionId: rest.slice(0, separator), subsectionId: rest.slice(separator + 1) }
}

/** Reserved-bucket id, mirroring `cvar-sections.ts`'s own `RESERVED_CVAR_SECTION_IDS` (not exported):
 * what a cvar dropped among a reserved group's rows resolves its (no-op) target `sectionId` to. */
const RESERVED_SECTION_ID: Record<'defaults' | 'other', string> = {
  defaults: CVAR_DEFAULTS_SECTION_ID,
  other: 'other',
}

/**
 * Three distinct sortable axes share the one `DndContext` `SortableZone` configures (story 054 D10,
 * mirroring `ControlsDragZone.tsx#controlsCollisionDetection` one level up): a section header may
 * only resolve against another section header, a sub-section header only against another header of
 * its *own* section, and a cvar row against anything else (another row, in any section/sub-section,
 * including a reserved bucket's). Checked in that order so a header drag can never accidentally
 * resolve to a cvar row or a foreign section's header.
 */
const settingsCollisionDetection: CollisionDetection = (args) => {
  const activeSubsection = subsectionIdsFromDragId(args.active.id)
  if (activeSubsection) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) => {
        const candidate = subsectionIdsFromDragId(container.id)
        return candidate !== undefined && candidate.sectionId === activeSubsection.sectionId
      }),
    })
  }

  if (sectionIdFromDragId(args.active.id) !== undefined) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => sectionIdFromDragId(container.id) !== undefined,
      ),
    })
  }

  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) =>
        sectionIdFromDragId(container.id) === undefined &&
        subsectionIdsFromDragId(container.id) === undefined,
    ),
  })
}

const SAVE_DEBOUNCE_MS = 500

/** The one-line explanation each reserved bucket gets under its header - neither is a section the
 * profile owns, so saying why it is there (and that its structure is not editable) beats letting it
 * look like a section the user forgot creating. `'section'` groups get none: their name is the
 * user's own. */
const RESERVED_HINT_KEY: Record<'defaults' | 'other', string> = {
  defaults: 'config.settings.reserved.defaultsHint',
  other: 'config.settings.reserved.otherHint',
}

const RESERVED_LABEL_KEY: Record<'defaults' | 'other', string> = {
  defaults: 'config.settings.reserved.defaults',
  other: 'config.settings.reserved.other',
}

type SaveStatus = 'idle' | 'saving' | 'saved'

export interface SettingsTabProps {
  profile: ConfigProfile
  /** Story 009 D6: the shared in-progress draft, owned by `ConfigView`'s `useProfileDraft`. */
  draft: ConfigProfile
  patch: (
    partial: Partial<ConfigProfile> | ((prev: ConfigProfile) => Partial<ConfigProfile>),
  ) => void
  onChanged: (profiles: ConfigProfile[]) => void
}

/**
 * The settings/cvar section of a config profile's detail view (story 021 D4): a capped, dense list
 * of the profile's cvars in sticky-headed sections, with a header bar for the profile-wide counts,
 * a session-local filter and "unsaved only" toggle and a per-section Advanced collapse. Both reset
 * affordances ("Reset all" here and the per-row reset in `CvarRow`) were removed in story 048 D5;
 * only the default-value text remains.
 *
 * Story 059 D7 changed what a section *is*: `buildCvarSectionGroups` groups the profile's own
 * `cvarSections` (D1), ungrouped run first, then sub-sections, then the two reserved buckets the
 * file writer appends (`Defaults`, `Other`). Story 059 D8 (this deliverable) makes that structure
 * editable: create/rename/reorder/delete a section and a sub-section from its own header (mirroring
 * `ControlsTab.tsx`'s category/sub-category CRUD, stories 052/053), move a cvar to another section,
 * and add/remove a cvar by name and value. Every one of those writes both `cvars` and
 * `cvarSections` through the same `updateProfileCvars` (`setCvars`) patch path D1 already extended
 * to carry `cvarSections` - see `persistSections` below.
 *
 * Only `'section'` groups (the profile's own, as opposed to the two reserved buckets) get CRUD
 * chrome at all - a reserved bucket's shape is computed, not stored, so there is nothing in it to
 * rename, reorder or delete (the same rule `cvar-rows.ts`'s own doc comment gives for why creating/
 * renaming/reordering/deleting only ever applies to `'section'`).
 *
 * Edits write into the shared `draft` (story 009 D6) immediately and persist to the main process.
 * Value edits (`handleChange`) stay debounced, same as before D8; every structural edit (section/
 * sub-section CRUD, move/add/remove-cvar) is a discrete click, so it saves immediately through
 * `persistSections` instead - the same "a click is not typed input" reasoning
 * `ControlsTab#persistCategoriesAndActions` documents for category/action CRUD.
 *
 * Judgement call (story's own "remove a cvar" wording, Test Plan step 7 - "gone from Settings and
 * from the Raw File"): a catalogue cvar's per-row "Remove" only *unplaces* it (drops it from every
 * section's `cvars` list, keeps its value in `profile.cvars`) - it can still resurface under
 * `Defaults` if `writeCatalogDefaults` is on, exactly the story's "removing a catalogue cvar from a
 * section unplaces it rather than erasing it from the world" decision. A cvar the catalogue does
 * not know (a `PlainCvarRow`) has no such afterlife - its only reason to exist in `profile.cvars` at
 * all *is* its section placement, and the writer's own reserved `Other` bucket would otherwise keep
 * emitting it even after "removing" it from every section. So a plain cvar's "Remove" deletes its
 * key from `profile.cvars` outright, which is what actually satisfies "gone from the Raw File".
 *
 * The engine every row resolves its facts against is owned here and chosen by `EngineScopeSelect`
 * from the profile's assignments. It is deliberately nullable: when the profile is assigned
 * nowhere, or only to engines the catalog has no facts for, the rows are still rendered but with no
 * engine - never with r1q2's numbers under another engine's name. Both components derive the
 * assigned engines through `lib/engine-scope.ts`, so neither owns a second copy of story 002's
 * assignment cross-reference.
 *
 * Story 049 D7: the "edited"/"unsaved" signal for the row border, the filter and both counters comes
 * from `useProfileChanges()` - the main-process-computed diff of the live profile against its own
 * `profile.baseline` (`@shared/config/profile-diff`) - not from a renderer-local baseline snapshot
 * (the old `savedCvars` mechanism, story 048 D6, since removed from `useProfileDraft` for having no
 * consumer left). That renderer-local baseline lagged an external file adopt or a conflict-dialog
 * resolution because it only reseeded on this hook's own effect; the change set is reseeded
 * main-side at exactly those moments, so this tab, the save bar and every other row can never
 * disagree about what is pending (story 049, Decisions).
 */
export function SettingsTab({ profile, draft, patch, onChanged }: SettingsTabProps) {
  const { t, i18n } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  // Story 059 review Fix 2: same "no shell-store dependency beyond pushToast for action failures"
  // idiom `RawFileTab.tsx` uses - a rejected structural save (schema validation failure or any
  // other IPC error) must not just silently reset the status, or the dialog stays open with no
  // explanation.
  const pushToast = useLauncher((state) => state.pushToast)
  // Story 049 D7: the change set every row's "edited"/"unsaved" indicator reads - `ConfigView`
  // mounts `ProfileChangesProvider` around this tab, so this always resolves rather than throwing.
  const changeSet = useProfileChanges()
  const [engine, setEngine] = useState<EngineKind | null>(null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saving, setSaving] = useState(false)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Filter, "edited only" and the per-group Advanced collapse are session-local UI state (story
  // 021 Decisions: "not persisted per profile, no extra saved UI state") - reset below whenever the
  // selected profile changes, alongside the save/status reset that already ran here.
  const [filter, setFilter] = useState('')
  const [editedOnly, setEditedOnly] = useState(false)
  // Keyed by `CvarSectionResult.key` (`cvarGroupKey`), not by a section id: a profile may own a
  // section whose id happens to be `defaults` or `other`, and the key's kind prefix is what keeps it
  // from sharing an expand state with the reserved bucket of that name.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  /** Story 059 D8: section/sub-section CRUD dialog state, mirroring `ControlsTab.tsx`'s own
   * `showCreateCategory`/`renamingCategory`/etc. one level down. */
  const [showCreateSection, setShowCreateSection] = useState(false)
  const [renamingSection, setRenamingSection] = useState<ConfigCvarSection | null>(null)
  const [creatingSubsectionFor, setCreatingSubsectionFor] = useState<string | null>(null)
  const [renamingSubsection, setRenamingSubsection] = useState<{
    sectionId: string
    subsection: ConfigCvarSubsection
  } | null>(null)
  const [addingCvarTo, setAddingCvarTo] = useState<{ sectionId: string; label: string } | null>(
    null,
  )
  const [movingCvar, setMovingCvar] = useState<string | null>(null)

  const assignedEngines = useMemo(
    () => assignedEngineKinds(profile, installations),
    [profile, installations],
  )
  const otherAssignedEngines = useMemo(
    () => assignedEngines.filter((kind) => kind !== engine),
    [assignedEngines, engine],
  )

  const clearPendingSave = (): void => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current)
      saveTimeout.current = null
    }
  }

  // Re-seed the save/status UI and the session-local filter/toggle/Advanced state whenever the
  // selected profile changes (switching profiles in the master list), dropping any save still
  // pending for the profile being switched away from. The draft's own content reseed is
  // `useProfileDraft`'s job now, keyed on the same `profile.id`.
  useEffect(() => {
    setStatus('idle')
    clearPendingSave()
    setFilter('')
    setEditedOnly(false)
    setExpandedSections(new Set())
  }, [profile.id])

  useEffect(() => clearPendingSave, [])

  const scheduleSave = (next: Record<string, string>): void => {
    setStatus('saving')
    clearPendingSave()
    saveTimeout.current = setTimeout(() => {
      saveTimeout.current = null
      void updateProfileCvars({ profileId: profile.id, cvars: next }).then((result) => {
        if (result.ok) {
          onChanged(result.value)
          setStatus('saved')
        } else {
          // Revert the optimistic patch: unlike a plain `useState` (which would self-correct on
          // every remount), the shared draft (story 009 D6) survives a tab switch, so a failed save
          // would otherwise leave a phantom edit in the draft - and therefore in the validator -
          // indefinitely (review finding).
          patch({ cvars: profile.cvars })
          setStatus('idle')
        }
      })
    }, SAVE_DEBOUNCE_MS)
  }

  // Functional form: reads `prev.cvars` at commit time rather than the `draft` closure captured
  // when this callback was created, so two edits landing in the same tick can never lose one of
  // them (same guarantee a plain `setLocalCvars(prev => ...)` had - review finding).
  const handleChange = (name: string, value: string): void => {
    patch((prev) => {
      const next = { ...prev.cvars, [name]: value }
      scheduleSave(next)
      return { cvars: next }
    })
  }

  /**
   * Story 059 D8: the structural-edit save path - section/sub-section CRUD, move/add/remove-cvar
   * all go through this, immediately (a discrete click, not typed input, same reasoning
   * `ControlsTab#persistCategoriesAndActions` gives for category/action CRUD). Cancels any pending
   * debounced value-edit save first, for the same "a stale debounce must not overwrite what this
   * call is about to persist" reason that function documents.
   */
  const persistSections = async (
    nextCvars: Record<string, string>,
    nextSections: ConfigCvarSection[],
  ): Promise<boolean> => {
    clearPendingSave()
    setSaving(true)
    setStatus('saving')
    const result = await updateProfileCvars({
      profileId: profile.id,
      cvars: nextCvars,
      cvarSections: nextSections,
    })
    setSaving(false)
    if (result.ok) {
      patch({ cvars: nextCvars, cvarSections: nextSections })
      onChanged(result.value)
      setStatus('saved')
    } else {
      // Story 059 review Fix 2: surface the rejection instead of leaving the dialog open with no
      // explanation - same `pushToast`/`error.key`/`timeoutMs: 0` shape `RawFileTab.tsx`'s
      // `openFile` uses for a failed action.
      pushToast({
        level: 'error',
        messageKey: result.error.key,
        timeoutMs: 0,
        ...(result.error.params ? { params: result.error.params } : {}),
      })
      setStatus('idle')
    }
    return result.ok
  }

  const sections = draft.cvarSections ?? []

  const handleCreateSection = async (name: string): Promise<boolean> => {
    const section = createCvarSection(name)
    const ok = await persistSections(draft.cvars, [...sections, section])
    if (ok) setShowCreateSection(false)
    return ok
  }

  const handleRenameSection = async (sectionId: string, name: string): Promise<boolean> => {
    const ok = await persistSections(draft.cvars, renameCvarSection(sections, sectionId, name))
    if (ok) setRenamingSection(null)
    return ok
  }

  const handleMoveSection = (sectionId: string, direction: 'up' | 'down'): void => {
    void persistSections(draft.cvars, moveCvarSection(sections, sectionId, direction))
  }

  /** Dialog-free (story 059 Decisions - mirrors 053's dialog-free sub-category delete, not 052's
   * delete-or-move modal): every cvar the section held keeps its value in `profile.cvars`
   * regardless (AC: deleting a section keeps every cvar), only where it is *placed* changes. */
  const handleDeleteSection = (sectionId: string): void => {
    void persistSections(draft.cvars, deleteCvarSection(sections, sectionId))
  }

  const handleCreateSubsection = async (sectionId: string, name: string): Promise<boolean> => {
    const ok = await persistSections(draft.cvars, createCvarSubsection(sections, sectionId, name))
    if (ok) setCreatingSubsectionFor(null)
    return ok
  }

  const handleRenameSubsection = async (
    sectionId: string,
    subsectionId: string,
    name: string,
  ): Promise<boolean> => {
    const ok = await persistSections(
      draft.cvars,
      renameCvarSubsection(sections, sectionId, subsectionId, name),
    )
    if (ok) setRenamingSubsection(null)
    return ok
  }

  const handleMoveSubsection = (
    sectionId: string,
    subsectionId: string,
    direction: 'up' | 'down',
  ): void => {
    void persistSections(
      draft.cvars,
      moveCvarSubsection(sections, sectionId, subsectionId, direction),
    )
  }

  /** Dialog-free (story 059 Decisions, same as `handleDeleteSection`): a sub-section's cvars fall
   * into the parent section's own ungrouped run, never deleted. */
  const handleDeleteSubsection = (sectionId: string, subsectionId: string): void => {
    void persistSections(draft.cvars, deleteCvarSubsection(sections, sectionId, subsectionId))
  }

  /**
   * Story 059 D8: adds a cvar by name and value, placing it directly into the section whose
   * toolbar the dialog was opened from. `moveCvarToSection` also strips the name out of any
   * section it already sat in first, so re-"adding" an already-placed cvar under a new value
   * simply relocates it rather than listing it twice.
   */
  const handleAddCvar = async (
    sectionId: string,
    name: string,
    value: string,
  ): Promise<boolean> => {
    const nextCvars = { ...draft.cvars, [name]: value }
    const nextSections = moveCvarToSection(sections, name, { sectionId })
    const ok = await persistSections(nextCvars, nextSections)
    if (ok) setAddingCvarTo(null)
    return ok
  }

  const handleMoveCvarSubmit = async (target: CvarPlacementOption): Promise<boolean> => {
    if (!movingCvar) return false
    const ok = await persistSections(draft.cvars, moveCvarToSection(sections, movingCvar, target))
    if (ok) setMovingCvar(null)
    return ok
  }

  /** Story 059 D8: see this component's own doc comment for the remove-vs-unplace judgement call.
   * A catalogue row keeps its value (`removeCvarFromSections` only edits placement); a plain row's
   * key is deleted from `profile.cvars` outright, since a plain cvar's only reason to exist there
   * at all is the section that used to place it. */
  const handleRemoveCvar = (entry: CvarRowEntry): void => {
    const nextSections = removeCvarFromSections(sections, entry.name)
    if (entry.kind === 'catalog') {
      void persistSections(draft.cvars, nextSections)
      return
    }
    const { [entry.name]: _removed, ...nextCvars } = draft.cvars
    void persistSections(nextCvars, nextSections)
  }

  /**
   * Story 054 D10: a section header was dropped on another section header - resolved to "move it to
   * this index", the over section's own index in `sections` before the move (the same semantics
   * `ControlsDragZone#handleCategoryChipDrop` resolves a category-chip drop with one level up).
   */
  const handleSectionDrop = (activeDragId: string, overDragId: string): void => {
    const activeSectionId = sectionIdFromDragId(activeDragId)
    const overSectionId = sectionIdFromDragId(overDragId)
    if (!activeSectionId || !overSectionId) return
    const toIndex = sections.findIndex((section) => section.id === overSectionId)
    if (toIndex === -1) return
    void persistSections(draft.cvars, moveSectionToIndex(sections, activeSectionId, toIndex))
  }

  /** Same idea one level down: a sub-section header dropped on another header of its *own* section
   * (`settingsCollisionDetection` never lets one resolve against a foreign section's header). */
  const handleSubsectionDrop = (activeDragId: string, overDragId: string): void => {
    const active = subsectionIdsFromDragId(activeDragId)
    const over = subsectionIdsFromDragId(overDragId)
    if (!active || !over || active.sectionId !== over.sectionId) return
    const section = sections.find((candidate) => candidate.id === active.sectionId)
    if (!section) return
    const toIndex = (section.subsections ?? []).findIndex(
      (subsection) => subsection.id === over.subsectionId,
    )
    if (toIndex === -1) return
    const nextSections = sections.map((candidate) =>
      candidate.id === section.id
        ? moveSubsectionToIndex(candidate, active.subsectionId, toIndex)
        : candidate,
    )
    void persistSections(draft.cvars, nextSections)
  }

  // One call for the whole tab now: grouping is the profile's section list (story 059 D7), so the
  // per-group Advanced state travels in as `expandedSections` rather than as one call per group.
  // `total`/`edited` still come out right per group because `buildCvarSectionGroups` computes them
  // over that group's own rows before filter/editedOnly/the collapse are applied.
  //
  // Everything is read off `draft`, not `profile`: the values are already the draft's (an edit must
  // show before its debounced save lands), and taking the sections from the same object is what
  // keeps a row's placement and its value from ever coming from two different snapshots.
  const groups = useMemo<CvarSectionResult[]>(
    () =>
      buildCvarSectionGroups({
        sections: draft.cvarSections,
        values: draft.cvars,
        // Story 049 D7: `edited` (the filter, the counters below and `CvarRow`'s own indicator)
        // is a lookup into the profile's pending change set, not a comparison against the
        // catalogue default or a renderer-local baseline - see `useProfileChanges`'s own doc
        // comment.
        unsavedKeys: changeSet.keys.cvars,
        filter,
        // `cvar-rows.ts` stays i18n-free (like every other `lib/*.ts` file here); resolving
        // `labelKey`/`descriptionKey` to the English text a user would actually type is this
        // component's job, since it already holds `t` (sprint decision: filter matches cvar name,
        // label and description, not their i18n keys - review finding).
        labelText: (def) => t(def.labelKey),
        descriptionText: (def) => t(def.descriptionKey),
        editedOnly,
        expandedSections,
        writeCatalogDefaults: draft.writeCatalogDefaults,
      }),
    [
      draft.cvarSections,
      draft.cvars,
      draft.writeCatalogDefaults,
      changeSet,
      filter,
      editedOnly,
      expandedSections,
      t,
    ],
  )

  // Summed over the very groups rendered below, so the header can never claim a size the sections
  // do not add up to (story 059 AC8: no counter may disagree with the rows).
  const profileTotal = groups.reduce((sum, group) => sum + group.total, 0)
  const profileEdited = groups.reduce((sum, group) => sum + group.edited, 0)
  const profileVisible = groups.reduce((sum, group) => sum + visibleRowsOf(group).length, 0)

  /** Whether the view is currently narrower than the profile: only then can "N cvars" (the
   * section's real size, story 021's semantics, which the Advanced collapse and "N more" are
   * measured against) differ from what is on screen. */
  const narrowed = filter.trim() !== '' || editedOnly

  /**
   * Story 054 D10: dragging a cvar row resolves to an exact index in the *underlying* section/
   * sub-section array, computed from the *rendered* row order - which only agrees with that array
   * when every one of its cvars is actually on screen. A filter, "Unsaved only" or a collapsed
   * Advanced section can each hide some of them, and a drop between two visible rows then has no
   * defined array position among the ones hidden - the same reasoning `ControlsGrid`'s own
   * `dragDisabled` gives for turning drag off while its filter narrows the list. `advancedHidden` is
   * the Advanced collapse's own count (not filter/editedOnly, which `narrowed` already covers), so
   * this is "no group anywhere is missing a row right now", not "no group is filtered".
   *
   * Section and sub-section headers are never filtered this way (the section/sub-section *list*
   * itself is never narrowed, only the cvars inside), so their own drag stays enabled regardless -
   * see the explicit `disabled={false}` on their `SortableItem`s below.
   *
   * Review-fix (finding 4): `advancedHidden` is scoped to the *section the row is actually in*
   * (`group.advancedHidden`, a single section's own rows plus its sub-sections), not summed with
   * `.some()` across every group on the page - a collapsed Advanced sub-section anywhere used to
   * disable dragging everywhere, which, since Advanced starts collapsed, made cvar drag practically
   * unreachable on a realistic profile. `narrowed` (filter/editedOnly) genuinely does narrow every
   * group at once, so it still gates globally.
   */
  const cvarDragDisabledFor = (group: CvarSectionResult): boolean =>
    narrowed || group.advancedHidden > 0

  const sectionDragIds = sections.map((section) => sectionDragId(section.id))

  /** One place a cvar can currently be dragged to: which section (or reserved bucket) and
   * sub-section it renders under, keyed by the cvar's own name (`entry.name`, the primary drag
   * zone's item id) - built off the very `group.rows`/`subgroups[].rows` arrays the JSX renders, so
   * a drop can never resolve against a row that is not actually on screen. */
  interface CvarPlacementLookup {
    sectionId: string
    subsectionId?: string
  }
  const cvarRowIds: string[] = []
  const placementByCvarName = new Map<string, CvarPlacementLookup>()
  const rowNamesByPlacementKey = new Map<string, string[]>()
  const placementKey = (placement: CvarPlacementLookup): string =>
    placement.subsectionId
      ? `${placement.sectionId}:${placement.subsectionId}`
      : placement.sectionId
  for (const group of groups) {
    const sectionId =
      group.section?.id ?? RESERVED_SECTION_ID[group.kind === 'defaults' ? 'defaults' : 'other']
    const ownNames = group.rows.map((entry) => entry.name)
    rowNamesByPlacementKey.set(placementKey({ sectionId }), ownNames)
    for (const name of ownNames) {
      cvarRowIds.push(name)
      placementByCvarName.set(name, { sectionId })
    }
    for (const sub of group.subgroups) {
      const placement: CvarPlacementLookup = { sectionId, subsectionId: sub.subsection.id }
      const names = sub.rows.map((entry) => entry.name)
      rowNamesByPlacementKey.set(placementKey(placement), names)
      for (const name of names) {
        cvarRowIds.push(name)
        placementByCvarName.set(name, placement)
      }
    }
  }

  /** The destination placement's real, unfiltered name list - `section.cvars`/`subsection.cvars`
   * straight off `sections`, not `rowNamesByPlacementKey`'s rendered subset. Review-fix (finding 5):
   * `buildCvarSectionGroups`'s row resolver drops a name from rendering entirely - a duplicate
   * already claimed by an earlier section, or a non-catalogue name with no stored value
   * (`makeRowResolver`, `cvar-rows.ts`) - while it stays present in the underlying array
   * `moveCvarToPosition` actually splices into, so a rendered-row index can land the drop one or
   * more slots away from where it visually appears to land whenever such a "ghost" name sits between
   * the drop point and the array's start. */
  const realNamesForPlacement = (placement: CvarPlacementLookup): string[] => {
    const section = sections.find((s) => s.id === placement.sectionId)
    if (!section) return []
    if (!placement.subsectionId) return section.cvars
    return (section.subsections ?? []).find((sub) => sub.id === placement.subsectionId)?.cvars ?? []
  }

  /**
   * A cvar row was dropped among another group's rows (story 054 D10) - resolved to an exact index
   * in the destination's (post-removal) cvars run, the same "rest = ... filter out the dragged
   * item, find where the hovered one now sits, before/after by direction" shape
   * `ControlsDragZone#handleDrop` uses for a Controls row one level up. Reaches every group
   * including a reserved `Defaults`/`Other` bucket - `moveCvarToPosition` itself is what turns "the
   * destination is a reserved bucket" into a no-op (`RESERVED_CVAR_SECTION_IDS`), so a cvar dragged
   * *into* one simply does not move, while a cvar dragged *out of* one (this function's `activeId`
   * naming a name `sections` has never placed) moves normally - exactly D9's "out of the reserved
   * bucket into a real section" case.
   *
   * The rendered position is found first (`rest`/`overIndex`, in rendered-only names), then mapped
   * back onto `realNamesForPlacement`'s real array (review-fix, finding 5): the rendered name at (or
   * just before) the drop point is looked up by *value* in the real array, since ghost names never
   * appear in `rest` and so can never shift that lookup off by themselves.
   */
  const handleCvarDrop = (meta: SortableDropMeta): void => {
    const toPlacement = placementByCvarName.get(meta.overId)
    if (!toPlacement) return
    const rowNames = rowNamesByPlacementKey.get(placementKey(toPlacement)) ?? []
    const rest = rowNames.filter((name) => name !== meta.activeId)
    const overIndex = rest.indexOf(meta.overId)
    if (overIndex === -1) return
    const movingDown = meta.newIndex > meta.oldIndex
    const renderedIndex = movingDown ? overIndex + 1 : overIndex

    const realNames = realNamesForPlacement(toPlacement).filter((name) => name !== meta.activeId)
    let index: number
    if (renderedIndex < rest.length) {
      const realIndex = realNames.indexOf(rest[renderedIndex]!)
      index = realIndex === -1 ? realNames.length : realIndex
    } else if (rest.length === 0) {
      index = 0
    } else {
      const realIndex = realNames.indexOf(rest[rest.length - 1]!)
      index = realIndex === -1 ? realNames.length : realIndex + 1
    }

    void persistSections(
      draft.cvars,
      moveCvarToPosition(sections, meta.activeId, { ...toPlacement, index }),
    )
  }

  /** A count readout that cannot disagree with the rows under it (story 059 AC8): the section's own
   * size and unsaved count as before, plus - only while a filter or "Unsaved only" is narrowing the
   * view - how many rows are actually showing. `visible` is counted off the very row arrays the JSX
   * maps over, never recomputed from the predicates. */
  const countLabel = (total: number, edited: number, visible: number): string => {
    const size = t('config.settings.header.count', { total, edited })
    return narrowed ? `${size} · ${t('config.settings.header.shown', { count: visible })}` : size
  }

  const toggleAdvanced = (key: string): void => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /**
   * Story 059 D9: toggles the profile's `writeCatalogDefaults` flag - mirrors `RawFileTab.tsx`'s
   * `toggleWriteUnbindall` exactly, a direct write-through with no debounce (a click, not typed
   * input), since it changes whether the `Defaults` bucket appears at all, here and in the Raw
   * File tab.
   */
  const toggleWriteCatalogDefaults = async (checked: boolean): Promise<void> => {
    const outcome = await updateProfileWriteCatalogDefaults({
      profileId: profile.id,
      writeCatalogDefaults: checked,
    })
    if (outcome.ok) {
      onChanged(outcome.value)
    }
  }

  /** A section's own name (the profile's prose, or its seed's `nameKey` while it still carries the
   * default one - `namedDisplayName`, 052's rule), or the fixed label of a reserved bucket. */
  const groupLabel = (group: CvarSectionResult): string =>
    group.section
      ? namedDisplayName(group.section, { t, exists: (key) => i18n.exists(key) })
      : t(RESERVED_LABEL_KEY[group.kind === 'defaults' ? 'defaults' : 'other'])

  /**
   * Story 059 D8/review Fix 5: the move/remove icon-button pair next to a row. Story Decisions
   * text: "Settings shows the 'Defaults' section only while the toggle is on, read-only in
   * structure (no rename/delete/reorder) but a cvar can be dragged/moved out of it, which places it
   * in a real section" - so "move to..." (the non-drag mechanism this deliverable actually built)
   * has to work FROM a reserved `Defaults`/`Other` group too, even though every *structural* action
   * on those two groups (rename/delete/reorder the group itself) stays disabled. `showRemove` is
   * `false` for a reserved group's rows: unlike a real section, there is nothing there to "remove
   * from" - a catalogue cvar in `Defaults` is already unplaced, and a plain cvar's "remove" (which
   * deletes its `profile.cvars` key outright, see this component's own doc comment) is a distinct,
   * still section-scoped affordance this fix does not touch.
   *
   * Accessible names carry the row's own name (same rule `ControlsTab`'s per-row buttons already
   * follow), so a screen reader over a wall of identical icons still says which row each acts on.
   */
  const renderRowActions = (entry: CvarRowEntry, showRemove: boolean) => (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton
        label={t('config.settings.section.moveCvar', { name: entry.name })}
        size="sm"
        onClick={() => setMovingCvar(entry.name)}
      >
        <ArrowLeftRight className="size-3.5" />
      </IconButton>
      {showRemove && (
        <IconButton
          label={t('config.settings.section.removeCvar', { name: entry.name })}
          variant="danger"
          size="sm"
          onClick={() => handleRemoveCvar(entry)}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      )}
    </div>
  )

  const renderRow = (entry: CvarRowEntry, showRemove: boolean, dragDisabled: boolean) => {
    const row =
      entry.kind === 'catalog' ? (
        <CvarRow
          def={entry.def}
          engine={engine}
          otherAssignedEngines={otherAssignedEngines}
          value={entry.value}
          edited={entry.edited}
          onChange={(value) => handleChange(entry.name, value)}
        />
      ) : (
        <PlainCvarRow
          name={entry.name}
          value={entry.value}
          edited={entry.edited}
          onChange={(value) => handleChange(entry.name, value)}
        />
      )
    // Story 059 review Fix 5: every row - reserved-group ones included - gets the move affordance
    // now, so this no longer early-returns a bare, action-less row for a reserved group.
    // Story 054 D10: every row - reserved-group ones included, per D9's "out of the reserved bucket
    // into a real section" - also gets a drag grip now, wired to `handleCvarDrop` through the
    // primary `SortableZone` below (`id={entry.name}`, the same identity `placementByCvarName`/
    // `rowNamesByPlacementKey` are keyed on).
    return (
      <SortableItem key={entry.name} id={entry.name} disabled={dragDisabled}>
        {({ setNodeRef, style, attributes, listeners, isDragging }) => (
          <div
            ref={setNodeRef}
            style={style}
            data-cvar-name={entry.name}
            className={cn('flex items-stretch gap-1', isDragging && 'opacity-60')}
          >
            <DragHandle
              className="mt-1 self-start"
              attributes={attributes}
              listeners={listeners}
              disabled={dragDisabled}
              disabledReason={t('config.settings.section.gripDisabledReason')}
            />
            <div className="min-w-0 flex-1">{row}</div>
            {renderRowActions(entry, showRemove)}
          </div>
        )}
      </SortableItem>
    )
  }

  const placementTargets = useMemo(
    () =>
      cvarPlacementOptions(sections, (section) =>
        namedDisplayName(section, { t, exists: (key) => i18n.exists(key) }),
      ),
    [sections, t, i18n],
  )

  // Story 059 review Fix 6: every name `AddCvarDialog` must warn about overwriting rather than
  // silently blanking - `draft.cvars`' own keys, not just what is currently placed in a section (an
  // unplaced/`Defaults` cvar's value is just as real and just as blankable).
  const existingCvarNames = useMemo(() => new Set(Object.keys(draft.cvars)), [draft.cvars])

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-sm tracking-[0.06em] text-ink uppercase">
          {t('config.settings.title')}
        </h3>
        <div className="flex items-center gap-3">
          {status !== 'idle' && (
            <span className="text-xs text-ink-muted">
              {status === 'saving' ? t('config.settings.saving') : t('config.settings.saved')}
            </span>
          )}
          <Button
            variant="neutral"
            size="sm"
            icon={<Plus className="size-3.5" />}
            disabled={saving}
            onClick={() => setShowCreateSection(true)}
          >
            {t('config.settings.section.create')}
          </Button>
        </div>
      </div>

      {/*
        `setEngine` is passed straight through: its identity is stable, which
        is what keeps `EngineScopeSelect`'s selection-repair effect from
        re-running on every render.
      */}
      <EngineScopeSelect profile={profile} value={engine} onChange={setEngine} />

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-line bg-raised/60 px-3 py-2.5">
        <span className="shrink-0 text-xs text-ink-muted">
          {countLabel(profileTotal, profileEdited, profileVisible)}
        </span>
        <Input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('config.settings.header.filterPlaceholder')}
          aria-label={t('config.settings.header.filterPlaceholder')}
          className="h-8 min-w-40 flex-1"
        />
        <Switch
          checked={editedOnly}
          onChange={setEditedOnly}
          label={t('config.settings.header.unsavedOnly')}
        />
        <Switch
          checked={profile.writeCatalogDefaults !== false}
          onChange={(next) => void toggleWriteCatalogDefaults(next)}
          label={t('config.settings.header.writeCatalogDefaults')}
          hint={t('config.settings.header.writeCatalogDefaultsHint')}
        />
      </div>

      {/*
        Story 054 D10: the one `DndContext` this tab drags inside (`SortableZone`, D1's single
        dnd-kit configuration) - the primary axis is every rendered cvar row (`cvarRowIds`), in
        exactly the order the JSX below renders them in, so dnd-kit's index-to-item mapping matches
        the screen. Section and sub-section headers are not among `items`: their own `SortableItem`s
        (below, each with `disabled={false}` so the cvar-row gate above never silences them) resolve
        through `onDropOutside` instead, the same seam `ControlsDragZone` uses for the Controls
        rail's category chips and sub-category headers one level up.
      */}
      <SortableZone
        items={cvarRowIds}
        getItemId={(name) => name}
        disabled={narrowed}
        collisionDetection={settingsCollisionDetection}
        onReorder={(_next, meta) => handleCvarDrop(meta)}
        onDropOutside={(activeId, overId) => {
          if (sectionIdFromDragId(activeId) !== undefined) {
            handleSectionDrop(activeId, overId)
            return
          }
          if (subsectionIdsFromDragId(activeId) !== undefined) {
            handleSubsectionDrop(activeId, overId)
          }
        }}
      >
        {() => (
          <div className="space-y-6">
            {groups.map((group, groupIndex) => {
              const movable = group.kind === 'section'
              const sectionActions = movable && group.section && (
                <div className="flex items-center gap-0.5">
                  <IconButton
                    label={t('config.settings.section.addCvar')}
                    size="sm"
                    onClick={() =>
                      setAddingCvarTo({ sectionId: group.section!.id, label: groupLabel(group) })
                    }
                  >
                    <Plus className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.settings.section.subsection.create')}
                    size="sm"
                    onClick={() => setCreatingSubsectionFor(group.section!.id)}
                  >
                    <FolderPlus className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.settings.section.moveUp')}
                    size="sm"
                    disabled={groupIndex === 0}
                    onClick={() => handleMoveSection(group.section!.id, 'up')}
                  >
                    <ArrowUp className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.settings.section.moveDown')}
                    size="sm"
                    disabled={groupIndex === groups.filter((g) => g.kind === 'section').length - 1}
                    onClick={() => handleMoveSection(group.section!.id, 'down')}
                  >
                    <ArrowDown className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.settings.section.rename')}
                    size="sm"
                    onClick={() => setRenamingSection(group.section!)}
                  >
                    <Pencil className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={t('config.settings.section.delete')}
                    variant="danger"
                    size="sm"
                    onClick={() => handleDeleteSection(group.section!.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              )
              const sectionHeader = (
                grip: ReactNode,
                setNodeRef?: (node: HTMLElement | null) => void,
                style?: CSSProperties,
                isDragging?: boolean,
              ) => (
                <div
                  ref={setNodeRef}
                  style={style}
                  data-section-id={group.section?.id}
                  className={cn(
                    'sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-panel px-1 py-2',
                    isDragging && 'opacity-60',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {grip}
                    <span className="truncate font-display text-xs tracking-[0.06em] text-ink-dim uppercase">
                      {groupLabel(group)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="numeric text-xs text-ink-faint">
                      {countLabel(group.total, group.edited, visibleRowsOf(group).length)}
                    </span>
                    {sectionActions}
                  </div>
                </div>
              )
              return (
                <section key={group.key}>
                  {movable && group.section ? (
                    <SortableContext items={sectionDragIds} strategy={verticalListSortingStrategy}>
                      <SortableItem
                        id={sectionDragId(group.section.id)}
                        disabled={false}
                        data={{ label: groupLabel(group) }}
                      >
                        {({ setNodeRef, style, attributes, listeners, isDragging }) =>
                          sectionHeader(
                            <DragHandle attributes={attributes} listeners={listeners} />,
                            setNodeRef,
                            style,
                            isDragging,
                          )
                        }
                      </SortableItem>
                    </SortableContext>
                  ) : (
                    sectionHeader(null)
                  )}

                  {group.kind !== 'section' && (
                    <p className="px-1 py-1.5 text-xs text-ink-faint">
                      {t(RESERVED_HINT_KEY[group.kind === 'defaults' ? 'defaults' : 'other'])}
                    </p>
                  )}

                  <div>
                    {group.rows.map((entry) =>
                      renderRow(entry, movable, cvarDragDisabledFor(group)),
                    )}
                  </div>

                  {/* Sub-sections always render their own header, even with no rows left after the
                  filter and even when genuinely empty - an empty sub-section still has to be visible
                  so it can be renamed, reordered or deleted, exactly the rule `ControlsGrid` follows
                  one level up (story 053 D5). Only a `'section'` group ever has one (`cvar-rows.ts`
                  never gives a reserved bucket sub-sections), so `group.section!` below is always
                  defined here - no `movable`/`group.section` guard needed the way the header buttons
                  above still need one for a reserved group's *own* row. */}
                  {group.subgroups.map((sub, subIndex) => {
                    const subsectionActions = (
                      <div className="flex items-center gap-0.5">
                        <IconButton
                          label={t('config.settings.section.subsection.moveUp')}
                          size="sm"
                          disabled={subIndex === 0}
                          onClick={() =>
                            handleMoveSubsection(group.section!.id, sub.subsection.id, 'up')
                          }
                        >
                          <ArrowUp className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={t('config.settings.section.subsection.moveDown')}
                          size="sm"
                          disabled={subIndex === group.subgroups.length - 1}
                          onClick={() =>
                            handleMoveSubsection(group.section!.id, sub.subsection.id, 'down')
                          }
                        >
                          <ArrowDown className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={t('config.settings.section.subsection.rename')}
                          size="sm"
                          onClick={() =>
                            setRenamingSubsection({
                              sectionId: group.section!.id,
                              subsection: sub.subsection,
                            })
                          }
                        >
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={t('config.settings.section.subsection.delete')}
                          variant="danger"
                          size="sm"
                          onClick={() =>
                            handleDeleteSubsection(group.section!.id, sub.subsection.id)
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    )
                    return (
                      <div key={sub.subsection.id}>
                        <SortableContext
                          items={(group.section!.subsections ?? []).map((subsection) =>
                            subsectionDragId(group.section!.id, subsection.id),
                          )}
                          strategy={verticalListSortingStrategy}
                        >
                          <SortableItem
                            id={subsectionDragId(group.section!.id, sub.subsection.id)}
                            disabled={false}
                            data={{ label: sub.subsection.name }}
                          >
                            {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                              <div
                                ref={setNodeRef}
                                style={style}
                                data-subsection-id={sub.subsection.id}
                                className={cn(
                                  'flex items-center justify-between gap-3 border-b border-line/70 py-1.5 pr-1 pl-4',
                                  isDragging && 'opacity-60',
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <DragHandle attributes={attributes} listeners={listeners} />
                                  <span className="truncate font-display text-[11px] tracking-[0.06em] text-ink-faint uppercase">
                                    {sub.subsection.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="numeric text-xs text-ink-faint">
                                    {countLabel(sub.total, sub.edited, sub.rows.length)}
                                  </span>
                                  {subsectionActions}
                                </div>
                              </div>
                            )}
                          </SortableItem>
                        </SortableContext>
                        <div>
                          {sub.rows.map((entry) =>
                            renderRow(entry, movable, cvarDragDisabledFor(group)),
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {group.hasAdvanced && (
                    // Gated on `hasAdvanced` (does this group have an advanced section at all), not on
                    // `advancedHidden > 0` (how many rows the collapse is hiding *right now*) - the latter
                    // legitimately reads 0 once the group is expanded, which used to make this button
                    // disappear and leave no way back to the collapsed state (review finding). The "N
                    // more" count itself still comes from `advancedHidden`, post-filter/editedOnly, and is
                    // simply omitted when it would misleadingly read 0 or when the section is expanded.
                    <button
                      type="button"
                      onClick={() => toggleAdvanced(group.key)}
                      className="w-full rounded-sm px-1 py-1.5 text-left text-xs text-ink-muted transition-colors duration-[--dur-fast] hover:text-ink"
                    >
                      {expandedSections.has(group.key)
                        ? t('config.settings.advanced.hide')
                        : group.advancedHidden > 0
                          ? t('config.settings.advanced.show', { count: group.advancedHidden })
                          : t('config.settings.advanced.showAdvanced')}
                    </button>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </SortableZone>

      <p className="flex flex-wrap items-center gap-4 text-xs text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-0.5 bg-flame-600" />
          {t('config.settings.legend.unsaved')}
        </span>
        <span>{t('config.settings.legend.default')}</span>
      </p>

      {showCreateSection && (
        <CreateCvarSectionDialog
          onClose={() => setShowCreateSection(false)}
          onSubmit={handleCreateSection}
        />
      )}

      {renamingSection && (
        <RenameCvarSectionDialog
          section={renamingSection}
          onClose={() => setRenamingSection(null)}
          onSubmit={(name) => handleRenameSection(renamingSection.id, name)}
        />
      )}

      {creatingSubsectionFor && (
        <CreateCvarSubsectionDialog
          onClose={() => setCreatingSubsectionFor(null)}
          onSubmit={(name) => handleCreateSubsection(creatingSubsectionFor, name)}
        />
      )}

      {renamingSubsection && (
        <RenameCvarSubsectionDialog
          subsection={renamingSubsection.subsection}
          onClose={() => setRenamingSubsection(null)}
          onSubmit={(name) =>
            handleRenameSubsection(
              renamingSubsection.sectionId,
              renamingSubsection.subsection.id,
              name,
            )
          }
        />
      )}

      {addingCvarTo && (
        <AddCvarDialog
          sectionLabel={addingCvarTo.label}
          existingCvarNames={existingCvarNames}
          onClose={() => setAddingCvarTo(null)}
          onSubmit={(name, value) => handleAddCvar(addingCvarTo.sectionId, name, value)}
        />
      )}

      {movingCvar && (
        <MoveCvarDialog
          cvarName={movingCvar}
          targets={placementTargets}
          onClose={() => setMovingCvar(null)}
          onSubmit={handleMoveCvarSubmit}
        />
      )}
    </div>
  )
}
