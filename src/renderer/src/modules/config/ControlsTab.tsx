import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  ListChecks,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { actionKeySlots, withKeySlot } from '@shared/config/action-slots'
import { nameForCatalogRow } from '@shared/config/catalog-rows'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import {
  STANDARD_TEMPLATE,
  TEMPLATE_ACTION_CATEGORIES,
  type ActionEntryKind,
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigActionSubcategory,
  type ConfigProfile,
} from '@shared/modules/config'
import { Button, IconButton } from '../../components/ui/Button'
import { Checkbox, Field, Input, Select } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { EmptyState, SectionLabel } from '../../components/ui/primitives'
import { ActionEditor } from './components/ActionEditor'
import { BindSlot, BindSlotPlaceholder } from './components/BindSlot'
import { ControlsGrid } from './components/ControlsGrid'
import { ControlsOptionsCell } from './components/ControlsOptionsCell'
import { ControlsRow } from './components/ControlsRow'
import { DeleteCategoryDialog } from './components/DeleteCategoryDialog'
import { MessageEditor } from './components/MessageEditor'
import { RenameActionDialog } from './components/RenameActionDialog'
import { updateProfileActions } from './client'
import { useProfileChanges } from './lib/profile-changes'
import { findBindConflicts, findSlotConflictOwner, indexBindConflicts } from './lib/bind-conflicts'
import {
  applyModifierReplace,
  applyReplace,
  findModifierSlotCollision,
  findSlotCollision,
  layerNameForModifier,
} from './lib/bind-slot-collision'
import {
  applyAmmo,
  applyMessage,
  applySlot,
  deriveRowState,
  editorKeySlot,
  rawKeyIndex,
  withCatalogBody,
  type CatalogRow,
} from './lib/catalog-binds'
import {
  allCatalogRowInfos,
  buildControlsRowEntries,
  type CatalogControlsRowEntry,
  type CatalogRowInfo,
  type ControlsRowEntry,
} from './lib/controls-row-entries'
import { groupControlsRowEntries } from './lib/controls-row-groups'
import { categoryDisplayName as resolveCategoryDisplayName } from './lib/category-display'
import { applyCategoryDeletion, type DeleteCategoryChoice } from './lib/delete-category'
import { buildMoveTargets, swapEntries } from './lib/entry-order'

const SAVE_DEBOUNCE_MS = 500

type SaveStatus = 'idle' | 'saving' | 'saved'

export interface ControlsTabProps {
  profile: ConfigProfile
  /** Story 009 D6: the shared in-progress draft, owned by `ConfigView`'s `useProfileDraft`. */
  draft: ConfigProfile
  patch: (
    partial: Partial<ConfigProfile> | ((prev: ConfigProfile) => Partial<ConfigProfile>),
  ) => void
  onChanged: (profiles: ConfigProfile[]) => void
  /** Story 044 D6: the owning action's id, when the Aliases tab's owner link for a `generated` row
   * asked to land here - selects that action's own category and focuses its row. Handled once on
   * mount only (see the focus effect below): `ConfigView` only ever mounts this tab fresh when the
   * deep link fires, since the tab panel it lives in unmounts on every tab switch. */
  focusActionId?: string
}

/**
 * Story 008 D6: category management plus a bare action list. This is
 * deliberately not a full action editor - `ConfigAction.commands`/`.key`
 * are never touched here, they stay whatever they were (`[]` for a freshly
 * created action). A later deliverable (D7) wires a row click to a
 * command/key editor, and another (D8) adds a message editor; both extend
 * this file rather than replace it, which is why every action row is
 * rendered as a distinct, addressable list item even though nothing reacts
 * to clicking one yet.
 *
 * Category CRUD is a handful of discrete dialog submits, so it saves
 * immediately (`persistCategoriesAndActions`), same reasoning `LayersPanel`
 * uses for its own immediate `persist()`. The action list's add/remove goes
 * through a debounced save instead, mirroring `SettingsTab`'s
 * `scheduleSave`/`clearPendingSave` - not because actions are typed
 * continuously, but so a burst of quick adds/removes does not fire one
 * `updateProfileActions` per click.
 */
export function ControlsTab({
  profile,
  draft,
  patch,
  onChanged,
  focusActionId,
}: ControlsTabProps) {
  const { t, i18n } = useTranslation()
  // Story 049 D8: the profile's pending change set, read once here so `renderCatalogRow`/
  // `renderPlainActionRow` can each ask "is my action id in `keys.actions`" - same predicate the
  // save bar's badge and count use (`useProfileChanges`, `lib/profile-changes.tsx`).
  const changeSet = useProfileChanges()

  // Story 009 D6: `localCategories`/`localActions` used to live here as their
  // own `useState`; they are now `draft.categories`/`draft.actions`, lifted
  // into `ConfigView` so the Validation tab sees an edit immediately, with no
  // debounce and no IPC round trip in between (AC 4).
  const categories = draft.categories ?? []
  const actions = draft.actions ?? []

  /**
   * Story 020 D7: the profile-wide conflict scan, computed once per relevant draft change (not
   * per category) - "the header conflict count is profile-wide, not per category" (sprint
   * decision). `indexBindConflicts` turns the flat scan result into an O(1) per-slot lookup so
   * `renderCatalogSlot`/`renderPlainSlot`/the Options cell can each ask "is my own key in here"
   * without re-scanning the whole profile per row.
   */
  const conflicts = useMemo(
    () => findBindConflicts(draft),
    [draft.binds, draft.actions, draft.layers],
  )
  const conflictIndex = useMemo(() => indexBindConflicts(conflicts), [conflicts])
  const layers = draft.layers ?? []
  // Story 052 D7: no category is special any more - the rail's initial selection is simply the
  // profile's first category (in its own order), or '' for a freshly-created, still-empty profile
  // (the empty state below offers the template instead of a selectable category).
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    () => (profile.categories ?? [])[0]?.id ?? '',
  )
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saving, setSaving] = useState(false)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Story 020 D9: one entry per rendered category chip (built-in or custom), keyed by category
   * id, so the scroll-into-view effect below can find the selected chip's DOM node without a
   * ref per category living in component state - a plain mutable map updated by each chip's own
   * callback ref is enough for this presentational concern. */
  const categoryChipRefs = useRef(new Map<string, HTMLElement>())
  /** Story 044 D6: same idiom as `categoryChipRefs` above, one entry per rendered row that carries a
   * real `ConfigAction` - keyed by that action's id, so the focus effect below can find a
   * cross-tab-focused row's element regardless of whether it rendered as a catalogue row or a plain
   * action row. */
  const focusRowRefs = useRef(new Map<string, HTMLDivElement>())
  const [pendingFocusActionId, setPendingFocusActionId] = useState<string | null>(null)
  const focusAppliedRef = useRef<string | null>(null)

  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [renamingCategory, setRenamingCategory] = useState<ConfigActionCategory | null>(null)
  const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<string | null>(null)
  /** Story 052 D9: a category with entries opens `DeleteCategoryDialog` instead of the plain
   * inline confirm `pendingDeleteCategoryId` still drives for an empty one - "move 0 entries" is
   * not a real choice to force on the user (story's own judgement call). */
  const [deletingCategory, setDeletingCategory] = useState<ConfigActionCategory | null>(null)
  const [showCreateAction, setShowCreateAction] = useState(false)
  const [renamingAction, setRenamingAction] = useState<ConfigAction | null>(null)
  /** Story 053 D6: the group header's own create/rename dialogs, mirroring
   * `showCreateCategory`/`renamingCategory` one level down - both are scoped to
   * `selectedCategory`, so there is no separate "which category" state to carry. */
  const [showCreateSubcategory, setShowCreateSubcategory] = useState(false)
  const [renamingSubcategory, setRenamingSubcategory] = useState<ConfigActionSubcategory | null>(
    null,
  )
  const [editingActionId, setEditingActionId] = useState<string | null>(null)
  /** Story 020 D8: local, not persisted - the filter is a view concern, not a draft edit. Reset
   * whenever the selected category changes so a filter typed in one category never silently hides
   * rows in the next one. */
  const [filterText, setFilterText] = useState('')
  /** Review fix (findings 4/5): which drops row's message `Modal` is open, or `null` for none.
   * The editor reads its initial channel/text off `actions` itself (looked up by the entry's id,
   * story 052 D8), so this only has to remember *which* row - plus the row's already-resolved i18n
   * label, because a `CatalogRow` carries no `labelKey` and the modal's title needs one (029 D4). */
  const [messageEditorRow, setMessageEditorRow] = useState<{
    row: CatalogRow
    actionId: string
    label: string
  } | null>(null)
  /**
   * Story 029 D4: which drops rows have their inline message row revealed *without* a message
   * being stored yet (AC 3/5). Local view state, not a draft edit - and deliberately not derived:
   * an empty message is never persisted (`applyMessage('')` removes the command), so a row the user
   * just checked has nothing in `actions` to read the checked state back from. The checkbox and the
   * sub-row are both rendered from "has a stored message OR is in this set", so the two can never
   * disagree (story decision). Keyed by the entry's id, not its `catalogId` (story 052 D8): a row is
   * an entry, and two entries could name the same catalogue row.
   */
  const [revealedMessageRows, setRevealedMessageRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  /**
   * Story 056 D3: which rows' extra-key sub-rows are folded open, keyed by `action.id` - mirrors
   * `revealedMessageRows` exactly (local view state, tab-lifetime persistence per AC 3, not a
   * draft edit). Default fold state is collapsed (the sprint decision), so this starts empty
   * rather than pre-populated: a row is "open" whenever its id is in the set (two-or-more-extras
   * case), or unconditionally when it has exactly one extra (the fold rule's "always visible"
   * case, which `renderKeyCell`/`renderExtraKeyRows` both compute without consulting this set at
   * all).
   */
  const [expandedKeyRows, setExpandedKeyRows] = useState<ReadonlySet<string>>(() => new Set())

  const toggleExpandedKeyRow = (actionId: string): void => {
    setExpandedKeyRows((current) => {
      const updated = new Set(current)
      if (updated.has(actionId)) updated.delete(actionId)
      else updated.add(actionId)
      return updated
    })
  }

  const clearPendingSave = (): void => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current)
      saveTimeout.current = null
    }
  }

  // Re-seed the save/status UI whenever the selected profile changes,
  // dropping any save still pending for the profile being switched away from
  // - same pattern as `SettingsTab`. The draft's own content reseed is
  // `useProfileDraft`'s job now (story 009 D6), keyed on the same
  // `profile.id`.
  useEffect(() => {
    setSelectedCategoryId((profile.categories ?? [])[0]?.id ?? '')
    setStatus('idle')
    clearPendingSave()
    // Story 029 D4: the reveal set and an open message editor both name a row of the profile being
    // switched away from - carrying them over would show another profile's row as "has a message
    // pending" and let a Save land on the wrong profile's actions.
    setRevealedMessageRows(new Set())
    setMessageEditorRow(null)
    // Story 044 D6: a pending cross-tab focus names a row of the profile being switched away from -
    // same reasoning as the reveal set/message editor just above.
    setPendingFocusActionId(null)
    focusAppliedRef.current = null
  }, [profile.id])

  useEffect(() => clearPendingSave, [])

  // Story 020 D8: a filter typed while looking at one category must not silently hide rows once
  // the user switches categories - clear it on every category change, same reasoning the profile
  // switch effect above already documents for `status`/pending saves.
  useEffect(() => {
    setFilterText('')
  }, [selectedCategoryId])

  // Story 020 D9: "the selected tab is scrolled into view when it is off-screen" - `'nearest'`
  // only moves the rail when the chip is actually outside the visible scroll area, rather than
  // re-centring a chip that is already fully visible.
  useEffect(() => {
    categoryChipRefs.current
      .get(selectedCategoryId)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedCategoryId])

  /**
   * Story 044 D6: a deep link from the Aliases tab's owner column for a `generated` row - the
   * owning action always exists (`AliasesTab`'s index is built from `draft.actions` itself), so this
   * only has to find it, select its category (which also clears `filterText` via the effect above,
   * so a stale filter from a previous session can never hide it) and queue it to be focused once its
   * row renders. Runs once on mount only - see `ControlsTabProps.focusActionId`'s own doc comment
   * for why a nonce/re-trigger guard is unnecessary here.
   */
  useEffect(() => {
    if (!focusActionId) return
    const action = (draft.actions ?? []).find((candidate) => candidate.id === focusActionId)
    if (!action) return
    setSelectedCategoryId(action.categoryId)
    setPendingFocusActionId(action.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusActionId])

  /**
   * Applies the real DOM focus queued by either effect above, once the target row has actually
   * rendered (it may not have on the same tick: switching category re-renders the whole grid).
   * `focusAppliedRef` guards against re-stealing focus on a later, unrelated re-render - e.g. the
   * user editing a different row afterwards, which also changes `rowEntries`.
   */
  useEffect(() => {
    if (!pendingFocusActionId || focusAppliedRef.current === pendingFocusActionId) return
    const el = focusRowRefs.current.get(pendingFocusActionId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus()
    focusAppliedRef.current = pendingFocusActionId
  })

  const persistCategoriesAndActions = async (
    nextCategories: ConfigActionCategory[],
    nextActions: ConfigAction[],
  ): Promise<boolean> => {
    // Cancels any debounced action-list save still pending from
    // `scheduleActionsSave` below - that save's own `categories` argument is
    // a closure captured at *schedule* time, so letting it fire after this
    // call would overwrite whatever this call is about to persist with a
    // stale snapshot (review finding: a category create/rename/delete done
    // while an action add/remove's debounce is still pending was silently
    // reverted on disk once the debounce fired). This call's own
    // `nextCategories`/`nextActions` already carry everything the pending
    // debounce would have sent, since `scheduleActionsSave` patches the draft
    // synchronously - only the network round trip was ever delayed - so
    // cancelling it here loses no edit.
    clearPendingSave()
    setSaving(true)
    setStatus('saving')
    const result = await updateProfileActions({
      profileId: profile.id,
      categories: nextCategories,
      actions: nextActions,
    })
    setSaving(false)
    if (result.ok) {
      patch({ categories: nextCategories, actions: nextActions })
      onChanged(result.value)
      setStatus('saved')
    } else {
      setStatus('idle')
    }
    return result.ok
  }

  const scheduleActionsSave = (nextActions: ConfigAction[]): void => {
    patch({ actions: nextActions })
    setStatus('saving')
    clearPendingSave()
    saveTimeout.current = setTimeout(() => {
      saveTimeout.current = null
      void updateProfileActions({
        profileId: profile.id,
        categories,
        actions: nextActions,
      }).then((result) => {
        if (result.ok) {
          onChanged(result.value)
          setStatus('saved')
        } else {
          // Revert the optimistic patch applied above: the shared draft
          // (story 009 D6) survives a tab switch (unlike the removed
          // `useState`, which self-corrected on every remount), so a failed
          // save would otherwise leave a phantom action in the draft - and
          // therefore in the validator - indefinitely (review finding).
          patch({ actions: profile.actions ?? [] })
          setStatus('idle')
        }
      })
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * Story 052 D9: "New category" offers the template's three categories next to a blank one
   * (AC 6). `input.templateId`, when set, names one of `TEMPLATE_ACTION_CATEGORIES` - the created
   * category then carries that template's own fixed id plus `{ name: label, nameKey }`, exactly the
   * shape `STANDARD_TEMPLATE.categories` and the migration already give a template-seeded category,
   * so a catalogue suggestion filed under it later lines up with `row.categoryId` the same way it
   * would have from the start. `CreateCategoryDialog` only ever offers a template id the profile
   * does not already carry (`existingCategoryIds`), so the two ids colliding here is not a real
   * path - the free-form fallback (no `templateId`) is unaffected and keeps minting a fresh id.
   */
  const handleCreateCategory = async (input: {
    name: string
    templateId?: string
  }): Promise<boolean> => {
    const template = input.templateId
      ? TEMPLATE_ACTION_CATEGORIES.find((candidate) => candidate.id === input.templateId)
      : undefined
    const category: ConfigActionCategory = template
      ? { id: template.id, name: template.label, nameKey: template.labelKey }
      : { id: crypto.randomUUID(), name: input.name }
    const ok = await persistCategoriesAndActions([...categories, category], actions)
    if (ok) {
      setShowCreateCategory(false)
      setSelectedCategoryId(category.id)
    }
    return ok
  }

  const handleRenameCategory = async (categoryId: string, name: string): Promise<boolean> => {
    // Story 052 D7 decision: "a rename drops it" - the object is rebuilt from just `id`/`name`
    // rather than spread from the previous category, so a `nameKey` a template seed or the
    // migration attached is dropped the moment the category gets a user-typed name of its own.
    const nextCategories = categories.map((category) =>
      category.id === categoryId ? { id: category.id, name } : category,
    )
    const ok = await persistCategoriesAndActions(nextCategories, actions)
    if (ok) setRenamingCategory(null)
    return ok
  }

  /** The plain, no-choice delete path (story 052 D7) - kept for a category with no entries at all,
   * where "delete or move" is not a real question (story 052 D9's judgement call). */
  const handleDeleteCategory = async (categoryId: string): Promise<void> => {
    const nextCategories = categories.filter((category) => category.id !== categoryId)
    const nextActions = actions.filter((action) => action.categoryId !== categoryId)
    const ok = await persistCategoriesAndActions(nextCategories, nextActions)
    if (ok) {
      setPendingDeleteCategoryId(null)
      // No category is special any more (story 052 D7): fall back to whatever is now first in the
      // profile's own order, or '' if that was the last one - the empty state below then offers
      // the template again.
      if (categoryId === selectedCategoryId) setSelectedCategoryId(nextCategories[0]?.id ?? '')
    }
  }

  /**
   * Story 052 D9: a category with entries goes through `DeleteCategoryDialog` instead - AC 9's
   * "asks first and says what happens to its entries", with a real delete-or-move choice defaulting
   * to move. The array math itself is `applyCategoryDeletion` (pure, its own tests) - this just
   * persists the result through the same `persistCategoriesAndActions` path every other category
   * edit uses and closes the dialog on success.
   */
  const handleDeleteCategoryChoice = async (
    categoryId: string,
    choice: DeleteCategoryChoice,
    targetCategoryId?: string,
  ): Promise<void> => {
    const { categories: nextCategories, actions: nextActions } = applyCategoryDeletion(
      categories,
      actions,
      categoryId,
      choice,
      targetCategoryId,
    )
    const ok = await persistCategoriesAndActions(nextCategories, nextActions)
    if (ok) {
      setDeletingCategory(null)
      if (categoryId === selectedCategoryId) setSelectedCategoryId(nextCategories[0]?.id ?? '')
    }
  }

  /**
   * Story 052 D7: category reorder mirrors `moveEntryWithinCategory`'s adjacent-swap idiom, but
   * over the flat `categories` array itself rather than a same-category subset of `actions` - every
   * category is its own "group" of one, so there is no neighbour-skip to do. Saves through the same
   * immediate `persistCategoriesAndActions` path `handleMoveAction` uses - a reorder is a discrete
   * click, not typed input.
   */
  const handleMoveCategory = (categoryId: string, direction: 'up' | 'down'): void => {
    const index = categories.findIndex((category) => category.id === categoryId)
    if (index === -1) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= categories.length) return
    const nextCategories = [...categories]
    const moved = nextCategories[index]!
    nextCategories[index] = nextCategories[targetIndex]!
    nextCategories[targetIndex] = moved
    void persistCategoriesAndActions(nextCategories, actions)
  }

  /**
   * Story 052 D7: the empty state's one-click "Add the standard template" - reuses
   * `STANDARD_TEMPLATE` itself (D1) rather than re-deriving the seed client-side, copying it with a
   * fresh id per action exactly the way `profiles.ts#create`'s own `from: 'template'` branch does
   * (category ids stay the template's own `movement`/`weapons`/`drops` - only offered here while the
   * profile has none yet, so there is nothing for them to collide with).
   */
  const handleAddStandardTemplate = async (): Promise<void> => {
    const nextCategories = STANDARD_TEMPLATE.categories.map((category) => ({ ...category }))
    const nextActions = STANDARD_TEMPLATE.actions.map((action) => ({
      ...action,
      id: crypto.randomUUID(),
      commands: action.commands.map((command) => ({ ...command })),
    }))
    const ok = await persistCategoriesAndActions(nextCategories, nextActions)
    if (ok) setSelectedCategoryId(nextCategories[0]?.id ?? '')
  }

  /** Story 052 D1/D7: the renderer prefers a category's `nameKey` (a still-unrenamed template
   * seed) over its stored `name`; a category the user has renamed, or one they typed themselves,
   * carries no `nameKey` and shows its stored prose verbatim. The rule itself (including the
   * fallback for a `nameKey` this build does not know - review finding 9) is
   * `lib/category-display.ts`, so it can be tested without mounting the tab. */
  const categoryDisplayName = (category: ConfigActionCategory): string =>
    resolveCategoryDisplayName(category, {
      t: (key) => t(key),
      exists: (key) => i18n.exists(key),
    })

  const handleRenameAction = async (
    actionId: string,
    input: { name: string; aliasName: string | undefined },
  ): Promise<boolean> => {
    const nextActions = actions.map((action) =>
      action.id === actionId ? { ...action, name: input.name, aliasName: input.aliasName } : action,
    )
    const ok = await persistCategoriesAndActions(categories, nextActions)
    if (ok) setRenamingAction(null)
    return ok
  }

  /**
   * Story 052 D9: "Add action" offers catalogue suggestions next to a free-form entry (AC 6).
   * `catalogId`, when a suggestion was picked, is the only difference from the free-form path - it
   * is what makes `controlsRowEntryFor` render the new entry as a `'catalog'` row (translated
   * label, fixed command preview, ammo/message affordances for a drops row) the moment it exists,
   * exactly like any other catalogue-backed entry. `commands` stays `[]` either way: a suggestion is
   * unbound until the user actually assigns a key, same as a template-seeded row
   * (`withCatalogBody` fills the body on that first assignment).
   */
  const handleCreateAction = (name: string, kind: ActionEntryKind, catalogId?: string): void => {
    const action: ConfigAction = {
      id: crypto.randomUUID(),
      categoryId: selectedCategoryId,
      name,
      // Story 019 D4: the create dialog now asks for the kind directly - the
      // category can no longer answer for the entry.
      kind,
      commands: [],
      ...(catalogId ? { catalogId } : {}),
      // Story 045 D9: `toggle`/`press-release` render from `parts`, not `commands` (which stays
      // `[]` for them) - both zod mirrors require exactly two parts for these kinds, so a freshly
      // created entry must seed them here or fail the strict payload schema on the very first save.
      ...(kind === 'toggle' || kind === 'press-release'
        ? { parts: [{ commands: [] }, { commands: [] }] }
        : {}),
    }
    scheduleActionsSave([...actions, action])
    setShowCreateAction(false)
  }

  const handleRemoveAction = (actionId: string): void => {
    scheduleActionsSave(actions.filter((action) => action.id !== actionId))
  }

  /**
   * Story 019 D7: reorder is a discrete click, not continuous typing, so it
   * saves through the same immediate `persistCategoriesAndActions` path
   * category CRUD uses, rather than the debounced `scheduleActionsSave` add/
   * remove use - one click should not risk being reverted by a later failed
   * debounce firing on stale data.
   *
   * Story 052 review (finding 4): the row it swaps with is named by the caller (`moveTargets`,
   * built from the *rendered* groups) rather than derived from `actions` here - see
   * `lib/entry-order.ts` for why a neighbour picked out of the raw array could be a row rendered
   * in another catalogue group, i.e. a real mutation with nothing visibly moving.
   */
  const handleMoveAction = (actionId: string, targetId: string): void => {
    void persistCategoriesAndActions(categories, swapEntries(actions, actionId, targetId))
  }

  /**
   * `ActionEditor` (D7) hands back the fully updated action rather than
   * saving itself, so `ControlsTab` stays the single owner of the draft's
   * actions and the save path - same reasoning `persistCategoriesAndActions`
   * already documents for category CRUD. A discrete "Save" closing a modal is
   * a commit like a rename, not a continuously-typed value, so this saves
   * immediately rather than through the debounced path add/remove use.
   */
  const handleSaveAction = async (next: ConfigAction): Promise<void> => {
    const nextActions = actions.map((action) => (action.id === next.id ? next : action))
    const ok = await persistCategoriesAndActions(categories, nextActions)
    if (ok) setEditingActionId(null)
  }

  /**
   * Story 020 D4: a catalogue row's slot assign/clear/replace persists immediately, mirroring
   * `DualBindPanel`/`DropBindPanel`'s `onActionsChange` (decision 16 - a click, not a keystroke
   * burst). `categories` never changes along this path.
   */
  const handleCatalogActionsChange = (nextActions: ConfigAction[]): void => {
    void persistCategoriesAndActions(categories, nextActions)
  }

  /**
   * Story 029 D4: the drops row's "With message" checkbox (AC 5/6).
   *
   * Checking only reveals the inline message row - there is no text to write yet, and writing an
   * empty one would immediately be pruned again, taking the checked state with it (story
   * decision: the "just checked" state lives in `revealedMessageRows`). Unchecking clears the
   * stored message right away, no confirm - exactly how "With ammo" already mutates on toggle,
   * and required by AC 6: a hidden-but-still-saved message would contradict the box being a
   * mirror of the stored command.
   *
   * Only the message command is touched either way: `applyMessage` merges into the action's
   * existing `commands`, so the row's `drop <item>` / ammo raw commands survive an uncheck.
   */
  const handleToggleRowMessage = (row: CatalogRow, action: ConfigAction, next: boolean): void => {
    setRevealedMessageRows((current) => {
      const updated = new Set(current)
      if (next) updated.add(action.id)
      else updated.delete(action.id)
      return updated
    })
    if (next) return
    // Nothing stored means nothing to clear - skip the save rather than persisting an array that
    // is identical to the one already on disk.
    if (deriveRowState(action, row).message.trim().length > 0) {
      handleCatalogActionsChange(applyMessage(actions, action.id, ''))
    }
  }

  /** A row's own reset (AC 4/5): clears its key slots, never its `commands` and never the entry
   * itself - the entry stays in the profile exactly as it was, unbound.
   *
   * Story 052 D8: one handler for every row. A catalogue row used to reset through a
   * `CatalogRow`-keyed `applySlot` that could prune the whole action away; it is an ordinary entry
   * now, so both kinds of row clear their two slots the same way and both keep their ammo/message
   * settings ("resets that row's binds" is the key slots, not the row's other settings - D4's own
   * judgement call, see the story requirement).
   *
   * Story 056: `applySlot` clears by index now, and clearing compacts - each clear at index 0
   * removes the current first slot and shifts every later one down, so a plain loop that also
   * advances its index would skip every other slot as the array shrinks under it. Clearing index 0
   * repeatedly, once per real slot the entry has, empties the whole list without that hazard and
   * without needing a new shared-layer "clear all" helper for this one call site. */
  const handleResetAction = (actionId: string): void => {
    const action = actions.find((candidate) => candidate.id === actionId)
    const slotCount = action ? actionKeySlots(action).length : 0
    let nextActions = actions
    for (let i = 0; i < slotCount; i += 1) {
      nextActions = applySlot(nextActions, actionId, 0, undefined)
    }
    void persistCategoriesAndActions(categories, nextActions)
  }

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? null
  const selectedCategoryLabel = selectedCategory ? categoryDisplayName(selectedCategory) : ''

  /**
   * Story 053 D6: sub-category CRUD, scoped to `selectedCategory` - the group headers a user can
   * see and click all belong to it. Mirrors the category rail's own rename/move/delete handlers
   * above almost verbatim, just one level down: the same `{ ...category, subcategories: [...] }`
   * splice, saved through the same immediate `persistCategoriesAndActions` path (a create/rename/
   * reorder/delete click is a discrete edit, not typed input, exactly the reasoning
   * `handleMoveCategory`'s own doc comment gives).
   */
  const handleCreateSubcategory = async (name: string): Promise<boolean> => {
    if (!selectedCategory) return false
    const subcategory: ConfigActionSubcategory = { id: crypto.randomUUID(), name }
    const nextCategories = categories.map((category) =>
      category.id === selectedCategory.id
        ? { ...category, subcategories: [...(category.subcategories ?? []), subcategory] }
        : category,
    )
    const ok = await persistCategoriesAndActions(nextCategories, actions)
    if (ok) setShowCreateSubcategory(false)
    return ok
  }

  const handleRenameSubcategory = async (subcategoryId: string, name: string): Promise<boolean> => {
    if (!selectedCategory) return false
    const nextCategories = categories.map((category) =>
      category.id === selectedCategory.id
        ? {
            ...category,
            subcategories: (category.subcategories ?? []).map((subcategory) =>
              subcategory.id === subcategoryId ? { ...subcategory, name } : subcategory,
            ),
          }
        : category,
    )
    const ok = await persistCategoriesAndActions(nextCategories, actions)
    if (ok) setRenamingSubcategory(null)
    return ok
  }

  const handleMoveSubcategory = (subcategoryId: string, direction: 'up' | 'down'): void => {
    if (!selectedCategory) return
    const subcategories = selectedCategory.subcategories ?? []
    const index = subcategories.findIndex((subcategory) => subcategory.id === subcategoryId)
    if (index === -1) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= subcategories.length) return
    const nextSubcategories = [...subcategories]
    const moved = nextSubcategories[index]!
    nextSubcategories[index] = nextSubcategories[targetIndex]!
    nextSubcategories[targetIndex] = moved
    const nextCategories = categories.map((category) =>
      category.id === selectedCategory.id
        ? { ...category, subcategories: nextSubcategories }
        : category,
    )
    void persistCategoriesAndActions(nextCategories, actions)
  }

  /**
   * Story 053 (Decisions): "deleting a sub-category keeps its entries in the parent category" -
   * unconditionally, unlike a category delete (052 D9's delete-or-move choice). No confirm dialog
   * at all: there is no real choice to ask about, only one outcome. Every one of this category's
   * entries pointing at the deleted id has its `subcategoryId` dropped (not set to `undefined` -
   * omitted entirely, same `{ id, name }` rebuild idiom `handleRenameCategory` already uses to drop
   * a stale `nameKey`) so the data model does not keep a dangling reference around, even though
   * `groupControlsRowEntries` would already treat it as ungrouped either way (D1/D5's own "no id is
   * special" rule).
   */
  const handleDeleteSubcategory = (subcategoryId: string): void => {
    if (!selectedCategory) return
    const nextCategories = categories.map((category) =>
      category.id === selectedCategory.id
        ? {
            ...category,
            subcategories: (category.subcategories ?? []).filter(
              (subcategory) => subcategory.id !== subcategoryId,
            ),
          }
        : category,
    )
    const nextActions = actions.map((action) => {
      if (action.categoryId !== selectedCategory.id || action.subcategoryId !== subcategoryId) {
        return action
      }
      const { subcategoryId: _removed, ...rest } = action
      return rest as ConfigAction
    })
    void persistCategoriesAndActions(nextCategories, nextActions)
  }
  const editingAction = editingActionId
    ? (actions.find((action) => action.id === editingActionId) ?? null)
    : null
  /** Story 053 D7: the category `editingAction` actually belongs to, looked up from `categories`
   * rather than assumed to be `selectedCategory` - a dangling `categoryId` (its category deleted
   * out from under it) falls back to a no-subcategories stand-in so `ActionEditor` still opens,
   * just without a sub-category control to offer. */
  const editingActionCategory: ConfigActionCategory = editingAction
    ? (categories.find((category) => category.id === editingAction.categoryId) ?? {
        id: editingAction.categoryId,
        name: '',
      })
    : { id: '', name: '' }
  /** Story 052 D8: the drops row whose message modal is open, resolved out of `actions` on every
   * render rather than captured into state - the editor then always opens on the entry as it is
   * now, and an entry that disappeared under it (its category deleted) closes the modal instead of
   * editing a stale copy. */
  const messageEditorAction = messageEditorRow
    ? (actions.find((action) => action.id === messageEditorRow.actionId) ?? null)
    : null

  // Story 052 D8: one rule for every category - a row is one of the profile's own entries, in the
  // profile's own order, and no row is rendered for an entry the profile does not have (AC 3).
  // movement/weapons/drops used to render one row per *catalogue* entry regardless (lazy
  // materialisation); the catalogue now only says what an entry the profile already carries means
  // (`controls-row-entries.ts`).
  const rowEntries: ControlsRowEntry[] = buildControlsRowEntries(selectedCategoryId, actions)

  /** A raw text preview of a plain action's commands, mirroring what a catalogue row's own
   * `row.commands` already give it - the first raw command, or nothing for a pure alias/message
   * action (there is no single fixed command to show). */
  const actionCommandPreview = (action: ConfigAction): string | undefined => {
    const raw = action.commands.find((command) => command.kind === 'raw')
    return raw?.kind === 'raw' ? raw.text : undefined
  }

  /**
   * Story 020 D8: "the filter matches action name and command, case-insensitively, within the
   * active category only" (sprint decision). `rowEntries` above is already derived per-category,
   * so filtering it (rather than some wider list) keeps the filter scoped to `selectedCategoryId`
   * by construction. Matches against EITHER field, not both - a hit on the command text alone
   * (e.g. typing a raw console command) has to surface the row even if the action's display name
   * doesn't mention it, and vice versa.
   */
  const filterQuery = filterText.trim().toLowerCase()
  const filteredRowEntries = filterQuery
    ? rowEntries.filter((entry) => {
        const name = entry.kind === 'catalog' ? t(entry.labelKey) : entry.action.name
        const command =
          entry.kind === 'catalog'
            ? entry.row.commands.join(', ')
            : (actionCommandPreview(entry.action) ?? '')
        return (
          name.toLowerCase().includes(filterQuery) || command.toLowerCase().includes(filterQuery)
        )
      })
    : rowEntries
  const rowGroups = groupControlsRowEntries(filteredRowEntries, selectedCategory?.subcategories ?? [])
  /** Story 052 review (finding 4): move up/down reads its neighbour - and therefore its own
   * enabled state - off `rowGroups`, the structure the grid actually draws, not off the raw
   * `actions` order. Cheap enough to rebuild per render (one pass over the rows already built
   * above), same as `rowGroups`/`boundCount` themselves. */
  const moveTargets = buildMoveTargets(rowGroups)
  // "n rows · m bound" follows the filter (D8) - unlike `conflicts.length` below, which stays a
  // profile-wide scan per D7's own decision and must NOT be recomputed off the filtered subset.
  const boundCount = filteredRowEntries.filter((entry) => {
    if (entry.kind === 'catalog') {
      const state = deriveRowState(entry.action, entry.row)
      return state.keys.some((slot) => Boolean(slot.key))
    }
    return actionKeySlots(entry.action).some((slot) => slot.key.trim().length > 0)
  }).length

  /**
   * The actions array a catalogue row's *assigning* write starts from: the row's entry with its
   * catalogue commands filled in if it had none yet (story 052 D8's `withCatalogBody` - see its doc
   * comment for why a seeded, body-less entry must get one before a key can point at it). Not used
   * on a clear, where there is nothing to make real.
   */
  const catalogWriteBase = (row: CatalogRow, actionId: string): ConfigAction[] =>
    withCatalogBody(actions, actionId, row)

  /** One catalogue row's Primary/Secondary `BindSlot`, wired exactly like `DualBindPanel`'s
   * `CatalogBindRow` - same collision plumbing, same `apply*` helpers, just inside `ControlsRow`'s
   * layout instead of the old `<li>` one. Story 052 D8: `action` is the row's real entry, so every
   * write below is keyed by its id, exactly like a free-form row's. */
  /** Story 056 D3: the accessible name of one key slot - "Primary key" for slot 0, "Key n"
   * (1-based) for every extra slot (the story's Wording decision), replacing the old
   * Primary/Secondary pair now that a row can carry any number of keys. */
  const keySlotLabel = (slotIndex: number): string =>
    slotIndex === 0
      ? t('config.controls.dualBind.primaryKey')
      : t('config.controls.dualBind.keyN', { n: slotIndex + 1 })

  const renderCatalogSlot = (row: CatalogRow, action: ConfigAction, slotIndex: number) => {
    const state = deriveRowState(action, row)
    const slot = state.keys[slotIndex]
    const boundKey = slot?.key
    const boundModifier = boundKey ? slot?.modifier : undefined
    const ownerName = action.name
    const isConflicted = Boolean(
      findSlotConflictOwner(conflictIndex, layers, boundKey, boundModifier, ownerName),
    )
    const checkModifierCollision = (modifier: ModifierTrigger, key: string) =>
      findModifierSlotCollision(actions, draft.layers ?? [], modifier, key, action.id)
    return (
      <BindSlot
        label={keySlotLabel(slotIndex)}
        boundKey={boundKey}
        boundModifier={boundModifier}
        // AC 6: a bound Primary cell is the strongest element in its row. AC 8: a slot whose key
        // collides with another owner anywhere in the profile is marked (D7's whole-profile scan).
        isPrimary={slotIndex === 0}
        isConflicted={isConflicted}
        checkModifierCollision={checkModifierCollision}
        checkCollision={(key) =>
          findSlotCollision(draft, key, { actionId: action.id, slot: rawKeyIndex(action, slotIndex) })
        }
        onAssign={(key) =>
          handleCatalogActionsChange(
            applySlot(catalogWriteBase(row, action.id), action.id, slotIndex, key),
          )
        }
        onAssignModifier={({ modifier, key }) =>
          handleCatalogActionsChange(
            applyModifierReplace({
              actions: catalogWriteBase(row, action.id),
              collision: checkModifierCollision(modifier, key),
              actionId: action.id,
              slotIndex,
              key,
              modifier,
            }),
          )
        }
        onReplace={(key, collision) =>
          handleCatalogActionsChange(
            applyReplace({
              actions: catalogWriteBase(row, action.id),
              binds: draft.binds,
              collision,
              actionId: action.id,
              slotIndex,
              key,
            }),
          )
        }
        onClear={() =>
          handleCatalogActionsChange(applySlot(actions, action.id, slotIndex, undefined))
        }
      />
    )
  }

  /**
   * The Options cell for a catalogue row (D6): a modifier-bound slot names its layer, a
   * conflicting row reads "also: <owner>" (D7's scan), an ordinary row reads "—"
   * (`ControlsOptionsCell`'s own dash fallback), and - for drops - the ammo toggle sits alongside
   * that text via `extra`.
   *
   * Review fix (findings 4/5): the message is not a `w-28` `Input` living directly in this
   * 150px-wide column - a free-text field does not fit next to the ammo checkbox and the
   * layer/conflict text (sprint decision).
   *
   * Story 029 D4 (AC 1/2): nor is it the icon button that replaced that field. A drops row now
   * carries a plain "With message" `Checkbox` with the same weight as "With ammo"; checking it
   * reveals the row's own full-width message row (`renderMessageSubRow`), and the editing itself
   * happens in `MessageEditor` from there. So this cell holds two checkboxes and no icon button,
   * and "is a message set" is stated in words rather than by a filled-vs-outline glyph.
   */
  const renderCatalogOptionsCell = (row: CatalogRow, action: ConfigAction) => {
    const state = deriveRowState(action, row)
    // Story 056: a row can carry a modifier on any of its N slots, or none; the Options cell scans
    // every slot in order and the first one with a modifier wins (the "one modifier per row"
    // prototype case is by far the common one - documenting the choice per the deliverable's own
    // note). The same first-in-order tie-break applies to which slot's conflict the cell names.
    const modifier = state.keys.find((slot) => slot.modifier !== undefined)?.modifier
    const layer = modifier ? layerNameForModifier(draft.layers ?? [], modifier) : undefined
    const ownerName = action.name
    const conflictOwner = state.keys
      .map((slot) => findSlotConflictOwner(conflictIndex, layers, slot.key, slot.modifier, ownerName))
      .find((owner) => owner !== undefined)
    const conflict = conflictOwner ? { owner: conflictOwner } : null
    // Review fix (finding 2): a `shrink-0` wrapper keeps the ammo/message checkboxes from being
    // squeezed by the flex layout - only the conflict/layer text (which now truncates, see
    // `ControlsOptionsCell.tsx`) gives up space in the Options column (150px, 200px since story
    // 052 D8 put the move buttons in it too).
    //
    // Story 029 D4: the two checkboxes stack instead of sitting on one line. "With ammo" plus
    // "With message" is ~190px of content, and the Options track was a fixed 150px with
    // `overflow: hidden` (`controls-grid.css`) - side by side, the left checkbox would be clipped
    // instead of the layer/conflict text truncating, which is exactly the regression AC 7 forbids.
    // `leading-4` holds the pair at 2x16px, inside the row's fixed 40px height, so no grid
    // geometry and no zebra parity changes for this (and a row with no ammo item still shows a
    // single checkbox, unchanged in position). `items-start` keeps both boxes on one x.
    const extra =
      row.categoryId === 'drops' ? (
        <span className="flex shrink-0 flex-col items-start gap-0.5">
          {row.ammoCommand && (
            // Story 029 live-smoke flow (test-only, additive): a stable selector for the
            // ui:flow harness - `Checkbox` itself takes no pass-through props, so the testid
            // sits on a `contents` wrapper that does not affect the flex layout above.
            <span className="contents" data-testid={`drop-ammo-${row.catalogId}`}>
              <Checkbox
                className="leading-4"
                checked={state.withAmmo}
                onChange={(next) =>
                  handleCatalogActionsChange(applyAmmo(actions, action.id, row, next))
                }
                label={t('config.controls.dropBind.withAmmo')}
              />
            </span>
          )}
          <span className="contents" data-testid={`drop-message-${row.catalogId}`}>
            <Checkbox
              className="leading-4"
              // AC 6: checked = the action carries a message, OR the user just checked the box and
              // has not written one yet (`revealedMessageRows`) - same expression the sub-row's own
              // visibility uses in `renderCatalogRow`.
              checked={state.message.trim().length > 0 || revealedMessageRows.has(action.id)}
              onChange={(next) => handleToggleRowMessage(row, action, next)}
              label={t('config.controls.dropBind.withMessage')}
            />
          </span>
        </span>
      ) : undefined
    return <ControlsOptionsCell layer={layer} conflict={conflict} extra={extra} />
  }

  /**
   * Story 029 D4 (AC 3): the inline message row under a revealed drops row - the stored message
   * text, or a placeholder while none is set yet, plus the button into `MessageEditor`. Read-only:
   * every edit goes through that modal, so nothing here writes to the draft. Rendered through
   * `ControlsRow`'s `subRow` slot (D3), which owns the `role="row"`/`role="cell"` pair and the
   * `.ctrl-msgrow` styling.
   */
  const renderMessageSubRow = (
    row: CatalogRow,
    action: ConfigAction,
    label: string,
    message: string,
  ) => (
    // Story 029 live-smoke flow (test-only, additive): `contents` keeps this span out of the
    // `.ctrl-msgrow` flex layout while still giving the harness one selector for the whole row.
    <span className="contents" data-testid={`drop-message-row-${row.catalogId}`}>
      <span
        className={
          message ? 'min-w-0 truncate text-xs text-ink' : 'min-w-0 truncate text-xs text-ink-faint'
        }
        title={message || undefined}
      >
        {message || t('config.controls.dropBind.messagePlaceholder')}
      </span>
      <Button
        size="sm"
        data-testid={`drop-message-edit-${row.catalogId}`}
        // The grid renders one of these per revealed row, so "Edit message" alone would read as a
        // wall of identical buttons - the accessible name names the row, same rule as
        // `ControlsRow`'s per-row reset button.
        aria-label={t('config.controls.dropBind.editMessageFor', { name: label })}
        onClick={() => setMessageEditorRow({ row, actionId: action.id, label })}
      >
        {t('config.controls.dropBind.editMessage')}
      </Button>
    </span>
  )

  /**
   * Story 052 D8 (AC 3): "every row can be moved". The same up/down pair every free-form row has
   * had since story 019, rendered for catalogue rows too - one helper rather than two copies of the
   * pair, since the only thing that differs is which options cell it sits next to.
   *
   * Story 052 review (finding 4): both the target and the disabled state come from `moveTargets`,
   * i.e. from the row's position inside the group it is *rendered* in (`rowGroups`, filter
   * included). They used to come from the raw `actions` order, which the grid does not draw: at a
   * catalogue-group boundary the button was enabled, the click swapped two entries of different
   * groups, the profile went dirty - and nothing on screen moved. A button with no target is now
   * disabled instead of promising a move it cannot show; the grouping itself stays purely derived
   * from the rows that exist (AC 4), nothing here rewrites a row's `catalogId`.
   */
  const renderMoveButtons = (action: ConfigAction) => {
    const target = moveTargets.get(action.id)
    return (
      <>
        <IconButton
          label={t('config.controls.actions.moveUp')}
          size="sm"
          disabled={!target?.up}
          onClick={() => target?.up && handleMoveAction(action.id, target.up)}
        >
          <ArrowUp className="size-3.5" />
        </IconButton>
        <IconButton
          label={t('config.controls.actions.moveDown')}
          size="sm"
          disabled={!target?.down}
          onClick={() => target?.down && handleMoveAction(action.id, target.down)}
        >
          <ArrowDown className="size-3.5" />
        </IconButton>
      </>
    )
  }

  const renderCatalogRow = (entry: CatalogControlsRowEntry, odd: boolean) => {
    const { row, labelKey, action } = entry
    const label = t(labelKey)
    // Story 029 D4 (AC 3/5): only drops rows have a message at all, and the row is revealed on the
    // same condition its checkbox is checked on - a stored message, or a box the user just ticked.
    const isDropRow = row.categoryId === 'drops'
    const message = isDropRow ? deriveRowState(action, row).message : ''
    const showMessageRow =
      isDropRow && (message.trim().length > 0 || revealedMessageRows.has(action.id))
    return (
      <ControlsRow
        // Story 052 D8: keyed by the entry, not by `catalogId` - a row *is* an entry now, and a
        // move reorders entries.
        key={action.id}
        name={label}
        // The catalogue's own command text, not the entry's: a seeded row that carries no commands
        // yet still says what it will run once bound (`withCatalogBody`).
        command={row.commands.join(', ')}
        resetLabel={t('config.controls.actions.reset', { name: label })}
        onReset={() => handleResetAction(action.id)}
        odd={odd}
        edited={changeSet.keys.actions.has(action.id)}
        keyCell={renderKeyCell(row, action, label)}
        extraKeyRows={renderExtraKeyRows(row, action, label)}
        rowId={action.id}
        optionsCell={
          <div className="flex w-full items-center justify-end gap-0.5">
            <div className="min-w-0 overflow-hidden">{renderCatalogOptionsCell(row, action)}</div>
            {renderMoveButtons(action)}
          </div>
        }
        subRow={showMessageRow ? renderMessageSubRow(row, action, label, message) : undefined}
        // Story 044 D6: every row carries a real `ConfigAction` now, so every row is addressable by
        // the `focusActionId` deep link.
        rowRef={(el) => {
          if (el) focusRowRefs.current.set(action.id, el)
          else focusRowRefs.current.delete(action.id)
        }}
      />
    )
  }

  /**
   * A plain action's Primary/Secondary `BindSlot` (story 020 D6 plan-gap fix): a custom
   * category's own `bind`/`message` entry, or a legacy free-form action living inside a
   * catalogue category, gets a live capturable slot exactly like a catalogue row - only an
   * `alias` entry gets the inert placeholder (story 019). Wired the same way `renderCatalogSlot`
   * wires a catalogue row's slot - same collision plumbing, same immediate
   * `handleCatalogActionsChange` save, same `applySlot`/`applyReplace`/`applyModifierReplace` write
   * paths keyed by `action.id`. Story 052 D8: the only thing left that a catalogue row does
   * differently is `withCatalogBody` (an entry with no commands of its own gets the catalogue's).
   */
  const renderPlainSlot = (action: ConfigAction, slotIndex: number) => {
    // Review fix (finding 1): read off the same filtered/compacted view `renderKeyCell`/
    // `renderExtraKeyRows` already build for a plain row (`plainKeySlots`, defined below) - not the
    // raw, uncompacted `action.keys[slotIndex]` `keySlotAt` gives. `applySlot` (the write side)
    // already compacts before writing at `slotIndex`, so a mid-array `{ key: '' }` blank (left by
    // `releaseKey`/`applyModifierReplace` blanking another row's slot in place, story 056 D1's
    // deliberate choice) must be invisible here too - otherwise this render shows the row as
    // unbound at a slot the next write actually lands on a *different*, still-real key, silently
    // overwriting it.
    const slotState = plainKeySlots(action)[slotIndex]
    const boundKey = slotState?.key || undefined
    const boundModifier = boundKey ? slotState?.modifier : undefined
    const isConflicted = Boolean(
      findSlotConflictOwner(conflictIndex, layers, boundKey, boundModifier, action.name),
    )
    const checkModifierCollision = (modifier: ModifierTrigger, key: string) =>
      findModifierSlotCollision(actions, draft.layers ?? [], modifier, key, action.id)
    return (
      <BindSlot
        label={keySlotLabel(slotIndex)}
        boundKey={boundKey}
        boundModifier={boundModifier}
        isPrimary={slotIndex === 0}
        isConflicted={isConflicted}
        checkModifierCollision={checkModifierCollision}
        checkCollision={(key) =>
          findSlotCollision(draft, key, { actionId: action.id, slot: rawKeyIndex(action, slotIndex) })
        }
        onAssign={(key) => handleCatalogActionsChange(applySlot(actions, action.id, slotIndex, key))}
        onAssignModifier={({ modifier, key }) =>
          handleCatalogActionsChange(
            applyModifierReplace({
              actions,
              collision: checkModifierCollision(modifier, key),
              actionId: action.id,
              slotIndex,
              key,
              modifier,
            }),
          )
        }
        onReplace={(key, collision) =>
          handleCatalogActionsChange(
            applyReplace({
              actions,
              binds: draft.binds,
              collision,
              actionId: action.id,
              slotIndex,
              key,
            }),
          )
        }
        onClear={() =>
          handleCatalogActionsChange(applySlot(actions, action.id, slotIndex, undefined))
        }
      />
    )
  }

  /** Every real key slot of `action` (the same "empty key is not a slot" filter `deriveRowState`
   * applies for a catalogue row, story 056), for a plain action - which has no `deriveRowState` of
   * its own to read this off. */
  const plainKeySlots = (action: ConfigAction) => actionKeySlots(action).filter((slot) => slot.key)

  /**
   * Story 056 D3: the Key column's content for a row that can be bound - a catalogue row (`row`
   * set) or a plain `bind`/`message` entry (`row` undefined; an alias never reaches this, see
   * `renderPlainActionRow`). Always the slot-0 `BindSlot`, then:
   *
   * - no extra key: the `+` add-key affordance sits right next to it (next free index, i.e.
   *   `keys.length`).
   * - exactly one extra: the fold rule says it always renders with no chevron - `renderExtraKeyRows`
   *   below puts it in a sub-row, so nothing more appears here.
   * - two or more extras: a "+n" toggle button switches `expandedKeyRows`; the `+` also stays here
   *   while the group is collapsed (the "+ placement" decision - a collapsed group still needs an
   *   add path) and moves into `renderExtraKeyRows`'s output once expanded.
   *
   * One implementation for both row kinds (rather than two near-identical copies) via `renderSlot`,
   * which is the only thing that differs between them.
   */
  const renderKeyCell = (row: CatalogRow | undefined, action: ConfigAction, label: string) => {
    const keys = row ? deriveRowState(action, row).keys : plainKeySlots(action)
    const renderSlot = (slotIndex: number) =>
      row ? renderCatalogSlot(row, action, slotIndex) : renderPlainSlot(action, slotIndex)
    const extraCount = Math.max(keys.length - 1, 0)
    const expanded = expandedKeyRows.has(action.id)
    // The group is "open" - its extras rendered as sub-rows rather than folded - whenever there is
    // exactly one extra (always visible, no chevron) or two-plus and the user expanded it.
    const isOpen = extraCount === 1 || (extraCount >= 2 && expanded)
    return (
      <>
        {renderSlot(0)}
        {extraCount >= 2 && (
          <button
            type="button"
            className="ctrl-keymore"
            aria-expanded={expanded}
            aria-label={t(
              expanded ? 'config.controls.grid.keyMoreHide' : 'config.controls.grid.keyMoreShow',
              { count: extraCount, name: label },
            )}
            onClick={() => toggleExpandedKeyRow(action.id)}
          >
            {`+${extraCount}`}
          </button>
        )}
        {/* Story 056 "+ placement" decision: the add-key affordance sits here only while the
            group is not open (no extras yet, or a collapsed 2+ group) - once open it is the last
            sub-row `renderExtraKeyRows` renders instead, never both places at once. Reusing the
            row's own `BindSlot` for the next free index (rather than a plain `+` button) is
            deliberate: `BindSlot` owns its capture lifecycle internally and exposes no way to
            start it from outside, so the only affordance that can actually begin a capture *is* a
            real `BindSlot` instance - its own "Empty" idle state doubles as the "+" trigger. Left
            at its natural full-slot size rather than squeezed into the 26px `.ctrl-keymore`
            footprint: shrinking an unmodified `BindSlot` (out of scope to edit) would clip its
            label unreadably, so it renders exactly like every other slot instance. */}
        {/* Review fix (finding 2): with zero keys, the primary `BindSlot` rendered above (also
            slot 0, since there is nothing to shift it past) already *is* the add-key affordance -
            clicking it starts capture at index 0. Rendering this add-key slot too would duplicate
            it verbatim (same index, same "Empty" idle state, same write target), which is exactly
            the two-column look this story exists to remove. Once the row has >=1 key, slot
            `keys.length` is a genuinely different index and this is the only place to add one. */}
        {!isOpen && keys.length >= 1 && renderSlot(keys.length)}
      </>
    )
  }

  /**
   * Story 056 D3: a row's further keys (slots 1..n) as full-width sub-rows below it, one
   * `.ctrl-keysub-row` per extra key plus - only while the group is "open" (`renderKeyCell`'s own
   * rule, computed identically here) - one more carrying the `+` add-key affordance. `undefined`
   * when there is nothing to show below the row at all: no extra keys, and the `+` is not
   * homeless (`renderKeyCell` is still showing it).
   */
  const renderExtraKeyRows = (
    row: CatalogRow | undefined,
    action: ConfigAction,
    label: string,
  ): ReactNode => {
    const keys = row ? deriveRowState(action, row).keys : plainKeySlots(action)
    const renderSlot = (slotIndex: number) =>
      row ? renderCatalogSlot(row, action, slotIndex) : renderPlainSlot(action, slotIndex)
    const extraCount = Math.max(keys.length - 1, 0)
    const expanded = expandedKeyRows.has(action.id)
    const isOpen = extraCount === 1 || (extraCount >= 2 && expanded)
    if (!isOpen) return undefined

    // Clearing a sub-row's key: the exact same write every slot's own `onClear` already performs
    // (`applySlot` removes the slot and compacts the rest, story 056 D1) - `BindSlot` itself
    // renders no visible Clear button (its own doc comment), so AC 4's "clear button" per sub-row
    // is this dedicated icon button instead.
    const clearSlot = (slotIndex: number): void =>
      handleCatalogActionsChange(applySlot(actions, action.id, slotIndex, undefined))

    const rows: ReactNode[] = []
    for (let slotIndex = 1; slotIndex < keys.length; slotIndex += 1) {
      rows.push(
        <div key={`key-${slotIndex}`} className="ctrl-keysub-row" data-row-id={action.id} role="row">
          <div className="ctrl-keysub" role="cell">
            {renderSlot(slotIndex)}
            <IconButton
              label={t('config.controls.actions.clearKey', { name: label, n: slotIndex + 1 })}
              size="sm"
              onClick={() => clearSlot(slotIndex)}
            >
              <X className="size-3.5" />
            </IconButton>
          </div>
        </div>,
      )
    }
    // The last sub-row while the group is open: the `+` add-key affordance, moved here from the
    // Key cell per the "+ placement" decision - same `BindSlot`-as-trigger reasoning as
    // `renderKeyCell`'s own copy above.
    rows.push(
      <div key="key-add" className="ctrl-keysub-row" data-row-id={action.id} role="row">
        <div className="ctrl-keysub" role="cell">
          {renderSlot(keys.length)}
        </div>
      </div>,
    )
    return <>{rows}</>
  }

  /**
   * Review fix (finding 2): a plain action's Options cell used to be *only* the move/edit/rename/
   * remove icon buttons - unlike a catalogue row, it never showed the modifier layer name, the
   * "also: <owner>" conflict text or the plain dash. Mirrors `renderCatalogOptionsCell`'s
   * conflict/layer lookup exactly, just keyed by the action's own key slots (slots 0 and 1 of
   * `action.keys`) instead of `deriveRowState`'s catalogue-row read - there
   * is no drops-only ammo/message `extra` slot here, that machinery is catalogue-only (drops rows
   * are always catalogue rows, never plain actions).
   */
  const renderPlainOptionsCell = (action: ConfigAction) => {
    // Story 056: scan every real slot in order, same "first modifier wins / first conflict wins"
    // rule as `renderCatalogOptionsCell`, generalized from the old fixed slot-0/slot-1 check.
    const keys = actionKeySlots(action).filter((slot) => slot.key)
    const modifier = keys.find((slot) => slot.modifier !== undefined)?.modifier
    const layer = modifier ? layerNameForModifier(draft.layers ?? [], modifier) : undefined
    const conflictOwner = keys
      .map((slot) => findSlotConflictOwner(conflictIndex, layers, slot.key, slot.modifier, action.name))
      .find((owner) => owner !== undefined)
    const conflict = conflictOwner ? { owner: conflictOwner } : null
    return <ControlsOptionsCell layer={layer} conflict={conflict} />
  }

  /**
   * A plain `ConfigAction` row: a custom category's own entry, or a legacy free-form action
   * living inside a catalogue category ("Other actions", decision 5). Both get the full move/
   * edit/rename/remove treatment D3's placeholder already offered every action - the move pair is
   * `renderMoveButtons`', so its neighbour is the row rendered next to this one (story 052 review,
   * finding 4), free-form and catalogue-backed rows alike.
   *
   * Renders exactly one row - the press/release grouping (story 041 D5) wraps this, it never
   * replaces it, so an unpaired action (the overwhelming majority: every custom-category entry,
   * every bind/message row) renders through here completely unchanged from before D5 existed.
   */
  const renderPlainActionRow = (action: ConfigAction, odd: boolean) => {
    // Story 019/020 decision: an alias entry gets inert placeholder cells, never a live slot -
    // binding an alias has to be impossible through the UI, not merely discouraged. A `bind`/
    // `message` entry gets a live, capturable slot exactly like a catalogue row (story 020
    // D6 plan-gap fix) - `renderPlainSlot`'s `applyPlainSlot` write path.
    const inertSlots = action.kind === 'alias'
    return (
      <ControlsRow
        key={action.id}
        name={action.name}
        command={actionCommandPreview(action)}
        resetLabel={t('config.controls.actions.reset', { name: action.name })}
        onReset={() => handleResetAction(action.id)}
        odd={odd}
        edited={changeSet.keys.actions.has(action.id)}
        keyCell={inertSlots ? <BindSlotPlaceholder /> : renderKeyCell(undefined, action, action.name)}
        extraKeyRows={inertSlots ? undefined : renderExtraKeyRows(undefined, action, action.name)}
        rowId={action.id}
        optionsCell={
          // Story 028 D1: no `flex-wrap`, and gap-0.5 — the Options track (150px then, 200px since
          // story 052 D8) fits the five 28px icon buttons only at 2px gaps (5x28 + 4x2 = 148px).
          // With wrap enabled the buttons spilled onto extra lines outside the 40px row. The
          // options text yields
          // entirely (`min-w-0` + `overflow-hidden` lets it collapse below its content width);
          // conflict/layer state stays visible on the slots themselves and the header badge.
          <div className="flex w-full items-center justify-end gap-0.5">
            {!inertSlots && (
              <div className="min-w-0 overflow-hidden">{renderPlainOptionsCell(action)}</div>
            )}
            {renderMoveButtons(action)}
            <IconButton
              label={t('config.controls.actions.edit')}
              size="sm"
              data-testid={`action-edit-${action.id}`}
              onClick={() => setEditingActionId(action.id)}
            >
              <SlidersHorizontal className="size-3.5" />
            </IconButton>
            <IconButton
              label={t('config.controls.actions.rename')}
              size="sm"
              onClick={() => setRenamingAction(action)}
            >
              <Pencil className="size-3.5" />
            </IconButton>
            <IconButton
              label={t('config.controls.actions.remove')}
              size="sm"
              variant="danger"
              onClick={() => handleRemoveAction(action.id)}
            >
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        }
        rowRef={(el) => {
          if (el) focusRowRefs.current.set(action.id, el)
          else focusRowRefs.current.delete(action.id)
        }}
      />
    )
  }

  return (
    // Story 020 review fix: AC 2's ~1120px cap has to hold the whole tab body, not just the grid
    // - an ultrawide window otherwise stretches the category rail and toolbar full-width while the
    // grid caps underneath them, which reads as broken. `ControlsGrid`'s own `.ctrl-stage` still
    // caps the table itself (harmless redundancy, both centre on the same 1120px), but this outer
    // wrapper is what actually caps the category rail and the filter toolbar.
    <div className="ctrl-stage space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{t('config.controls.label')}</SectionLabel>
          {status !== 'idle' && (
            <span className="text-xs text-ink-muted">
              {status === 'saving' ? t('config.settings.saving') : t('config.settings.saved')}
            </span>
          )}
        </div>

        {/*
          Story 052 D7: no category is special any more - the rail renders exactly
          `profile.categories`, in the profile's own order, and every one of them (including a
          former built-in) gets the same rename/delete/move-up/move-down affordances the old
          custom-chip loop alone used to offer. A profile with none yet gets the empty state below
          instead of an empty rail.
        */}
        {categories.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-6" />}
            title={t('config.controls.categoriesEmpty.title')}
            body={t('config.controls.categoriesEmpty.body')}
            actions={
              <>
                <Button variant="primary" size="sm" onClick={() => void handleAddStandardTemplate()}>
                  {t('config.controls.categoriesEmpty.addTemplate')}
                </Button>
                <Button
                  variant="neutral"
                  size="sm"
                  icon={<Plus className="size-3.5" />}
                  onClick={() => setShowCreateCategory(true)}
                >
                  {t('config.controls.create')}
                </Button>
              </>
            }
          />
        ) : (
          // Story 020 D9: a single-row, horizontally scrollable rail (sprint decision) instead of
          // the old `flex flex-wrap` strip - `.ctrl-category-rail` (controls-grid.css) adds
          // `overflow-x-auto` and a themed scrollbar, and every chip carries `shrink-0` so the row
          // scrolls instead of squeezing. "+ New category" stays the rail's own trailing item,
          // matching the prototype's single-row `Movement | Weapons | ... | + New category`
          // (a-column-grid.html).
          <div className="ctrl-category-rail">
            {categories.map((category, index) => {
              const isPendingDelete = pendingDeleteCategoryId === category.id
              return (
                <div
                  key={category.id}
                  ref={(el) => {
                    if (el) categoryChipRefs.current.set(category.id, el)
                    else categoryChipRefs.current.delete(category.id)
                  }}
                  className="flex shrink-0 items-center gap-1.5 rounded-sm border border-line px-1.5 py-1"
                >
                  {/* Story 020 review fix (round 2): a real `tablist`/`tab` pairing requires every
                      direct child of the tablist to carry `role="tab"` (axe: aria-required-children)
                      - the "+ New category" button and the rename/delete/move icon buttons sitting
                      next to a category button are not tabs, so a full ARIA tabs pattern does not
                      fit this rail's mixed content. Selection is already conveyed visually
                      (`variant='primary'`) and via `aria-pressed` below - no `role`/`aria-selected`
                      claim that isn't backed by real tab semantics (arrow-key roving tabindex,
                      `aria-controls`). */}
                  <Button
                    aria-pressed={selectedCategoryId === category.id}
                    variant={selectedCategoryId === category.id ? 'primary' : 'neutral'}
                    size="sm"
                    onClick={() => setSelectedCategoryId(category.id)}
                  >
                    {categoryDisplayName(category)}
                  </Button>
                  {isPendingDelete ? (
                    <>
                      <span className="text-xs text-danger whitespace-nowrap">
                        {t('config.controls.deleteConfirm')}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => setPendingDeleteCategoryId(null)}
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={saving}
                        onClick={() => void handleDeleteCategory(category.id)}
                      >
                        {t('config.controls.deleteConfirmAction')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <IconButton
                        label={t('config.controls.categoryMoveUp')}
                        size="sm"
                        disabled={index === 0}
                        onClick={() => handleMoveCategory(category.id, 'up')}
                      >
                        <ArrowUp className="size-3.5" />
                      </IconButton>
                      <IconButton
                        label={t('config.controls.categoryMoveDown')}
                        size="sm"
                        disabled={index === categories.length - 1}
                        onClick={() => handleMoveCategory(category.id, 'down')}
                      >
                        <ArrowDown className="size-3.5" />
                      </IconButton>
                      <IconButton
                        label={t('config.controls.rename')}
                        size="sm"
                        onClick={() => setRenamingCategory(category)}
                      >
                        <Pencil className="size-3.5" />
                      </IconButton>
                      <IconButton
                        label={t('config.controls.delete')}
                        size="sm"
                        variant="danger"
                        // Story 052 D9 (AC 9): a category with entries opens the delete-or-move
                        // modal; an empty one keeps the plain inline confirm right above (nothing
                        // to move, so a choice would be pointless - story's own judgement call).
                        onClick={() => {
                          const hasEntries = actions.some(
                            (candidate) => candidate.categoryId === category.id,
                          )
                          if (hasEntries) setDeletingCategory(category)
                          else setPendingDeleteCategoryId(category.id)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </>
                  )}
                </div>
              )
            })}

            <Button
              variant="neutral"
              size="sm"
              className="shrink-0"
              icon={<Plus className="size-3.5" />}
              onClick={() => setShowCreateCategory(true)}
            >
              {t('config.controls.create')}
            </Button>
          </div>
        )}
      </div>

      {/*
        Story 020 D3/D4: one grid for every category - `DualBindPanel`, `DropBindPanel` and the
        old bare `<ul>` collapse into `ControlsGrid`. D5/D6 own the real slot surface and
        Options-cell content respectively - `renderCatalogRow`/`renderPlainActionRow` above wire
        today's `BindSlot`/CRUD affordances into D4's `ControlsRow` shell.

        Story 052 D8: every category, catalogue-backed or not, shows exactly its persisted entries
        (`rowEntries`) - the catalogue no longer contributes rows of its own, only what a row of the
        profile's means.

        Story 052 D7: hidden entirely while the profile has no categories - the empty state above
        already offers the only actions that make sense with nothing selected.
      */}
      {categories.length > 0 && (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>
            {t('config.controls.actions.label', { category: selectedCategoryLabel })}
          </SectionLabel>
          <div className="flex items-center gap-3">
            <Input
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder={t('config.controls.filter.placeholder')}
              aria-label={t('config.controls.filter.placeholder')}
              className="w-48"
            />
            {/* Story 020 review fix: AC 8/9 put the profile-wide conflict count in the header,
                not the footer (mirrors the prototype's toolbar: filter, conflict badge, Restore
                defaults, in that order) - `ControlsGrid` no longer renders this itself. */}
            {conflicts.length > 0 && (
              <span className="ctrl-conflict-badge" role="status">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                {t('config.controls.grid.conflictCount', { count: conflicts.length })}
              </span>
            )}
            {/* Story 053 D6: create is the one sub-category operation that has no group header of
                its own to sit on yet - mirrors "New category" living in the rail rather than on a
                category chip. Scoped to `selectedCategory` (disabled instead of hidden while none
                is selected, matching every other button in this toolbar). */}
            <Button
              variant="neutral"
              size="sm"
              icon={<Plus className="size-3.5" />}
              disabled={!selectedCategory}
              onClick={() => setShowCreateSubcategory(true)}
            >
              {t('config.controls.subcategory.create')}
            </Button>
            <Button
              variant="neutral"
              size="sm"
              icon={<Plus className="size-3.5" />}
              onClick={() => setShowCreateAction(true)}
            >
              {t('config.controls.actions.add')}
            </Button>
          </div>
        </div>

        {rowEntries.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-6" />}
            title={t('config.controls.actions.empty.title')}
            body={t('config.controls.actions.empty.body')}
          />
        ) : filteredRowEntries.length === 0 ? (
          // Story 020 D8 AC 10: a filter that matches nothing in this category still needs an
          // explanation, not a silently empty grid - distinct copy from the "category has zero
          // rows at all" EmptyState above so it reads as "narrow your search", not "add an action".
          <EmptyState
            icon={<ListChecks className="size-6" />}
            title={t('config.controls.filter.noMatches.title')}
            body={t('config.controls.filter.noMatches.body')}
          />
        ) : (
          <ControlsGrid
            ariaLabel={t('config.controls.grid.ariaLabel', { category: selectedCategoryLabel })}
            groups={rowGroups}
            rowCount={filteredRowEntries.length}
            boundCount={boundCount}
            renderRow={(entry, index) => {
              // Story 020 D4: parity across the whole filtered row list, not per group - see
              // `ControlsRow`'s doc comment for why this replaces CSS `:nth-of-type`.
              const odd = index % 2 === 0
              return entry.kind === 'catalog'
                ? renderCatalogRow(entry, odd)
                : renderPlainActionRow(entry.action, odd)
            }}
            onRenameSubcategory={(subcategory) => setRenamingSubcategory(subcategory)}
            onMoveSubcategory={handleMoveSubcategory}
            onDeleteSubcategory={handleDeleteSubcategory}
          />
        )}
      </div>
      )}

      {showCreateCategory && (
        <CreateCategoryDialog
          existingCategoryIds={categories.map((category) => category.id)}
          onClose={() => setShowCreateCategory(false)}
          onSubmit={handleCreateCategory}
        />
      )}

      {deletingCategory && (
        <DeleteCategoryDialog
          categoryLabel={categoryDisplayName(deletingCategory)}
          entryCount={actions.filter((action) => action.categoryId === deletingCategory.id).length}
          otherCategories={categories
            .filter((category) => category.id !== deletingCategory.id)
            .map((category) => ({ id: category.id, label: categoryDisplayName(category) }))}
          onClose={() => setDeletingCategory(null)}
          onConfirm={(choice, targetCategoryId) =>
            handleDeleteCategoryChoice(deletingCategory.id, choice, targetCategoryId)
          }
        />
      )}

      {renamingCategory && (
        <RenameCategoryDialog
          category={renamingCategory}
          onClose={() => setRenamingCategory(null)}
          onSubmit={(name) => handleRenameCategory(renamingCategory.id, name)}
        />
      )}

      {showCreateSubcategory && selectedCategory && (
        <CreateSubcategoryDialog
          onClose={() => setShowCreateSubcategory(false)}
          onSubmit={handleCreateSubcategory}
        />
      )}

      {renamingSubcategory && (
        <RenameSubcategoryDialog
          subcategory={renamingSubcategory}
          onClose={() => setRenamingSubcategory(null)}
          onSubmit={(name) => handleRenameSubcategory(renamingSubcategory.id, name)}
        />
      )}

      {showCreateAction && (
        <CreateActionDialog
          onClose={() => setShowCreateAction(false)}
          onSubmit={handleCreateAction}
        />
      )}

      {renamingAction && (
        <RenameActionDialog
          action={renamingAction}
          actions={actions}
          binds={draft.binds}
          layers={layers}
          onClose={() => setRenamingAction(null)}
          onSubmit={(input) => handleRenameAction(renamingAction.id, input)}
        />
      )}

      {editingAction && editingAction.kind === 'message' && (
        <MessageEditor
          action={editingAction}
          cvars={draft.cvars}
          onClose={() => setEditingActionId(null)}
          onSave={(draft) =>
            void handleSaveAction(
              withKeySlot(
                {
                  ...editingAction,
                  commands: [
                    { kind: 'message', channel: draft.channel as 'say' | 'say_team', text: draft.text },
                  ],
                },
                0,
                // Story-050 review, finding 2: this editor has no modifier capture, so its save
                // must carry the slot's existing modifier over rather than write a bare `{ key }`
                // and silently turn an `Alt+F1` binding into a plain `F1` one. Same helper
                // `ActionEditor`'s save uses for the identical case.
                editorKeySlot(editingAction, draft.key),
              ),
            )
          }
        />
      )}

      {editingAction && editingAction.kind !== 'message' && (
        <ActionEditor
          action={editingAction}
          actions={actions}
          category={editingActionCategory}
          onClose={() => setEditingActionId(null)}
          onSave={(next) => void handleSaveAction(next)}
        />
      )}

      {/* Story 029 D4 (AC 4): a drops row opens the same rich editor a "Team messages" entry does
          - channel, macro bar, symbol picker, live preview - with key capture hidden, because a
          catalogue row's key belongs to the grid's `BindSlot`s and their collision/replace flow
          (story decision; a second, collision-blind key field here would regress AC 7). The save
          merges through `applyMessage`, which only adds/replaces/removes the row's message
          command: the `drop <item>` and ammo raw commands are carried over untouched. */}
      {messageEditorAction && messageEditorRow && (
        <MessageEditor
          action={messageEditorAction}
          cvars={draft.cvars}
          titleName={messageEditorRow.label}
          showKeyCapture={false}
          onClose={() => setMessageEditorRow(null)}
          onSave={(draft) => {
            // Story 052 D8: the row's entry is real, so the message is written straight onto it -
            // through `withCatalogBody` first, so setting a message on a still-body-less seeded row
            // gives it the `drop <item>` commands the message is meant to accompany, exactly as the
            // pre-D8 lazy `freshAction` did. Clearing the message writes nothing new: an entry with
            // no body has none of its own to keep either.
            const base =
              draft.text.trim().length > 0
                ? catalogWriteBase(messageEditorRow.row, messageEditorAction.id)
                : actions
            handleCatalogActionsChange(
              applyMessage(
                base,
                messageEditorAction.id,
                draft.text,
                draft.channel as 'say' | 'say_team',
              ),
            )
            setMessageEditorRow(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Create-category form: name, plus (story 052 D9, AC 6) a suggestions list offering the template's
 * own three categories next to the blank/free-form field. `existingCategoryIds` filters out a
 * template category the profile already has - its fixed id (`movement`/`weapons`/`drops`) cannot be
 * created twice, so offering it again would either collide or silently do nothing.
 *
 * Exported (not module-local like most of this file's dialogs) so it can be unit-tested directly -
 * story 052 D9's accept criteria name both suggestion lists as something to verify.
 */
export function CreateCategoryDialog({
  existingCategoryIds,
  onClose,
  onSubmit,
}: {
  existingCategoryIds: readonly string[]
  onClose: () => void
  onSubmit: (input: { name: string; templateId?: string }) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const ok = await onSubmit({ name: name.trim() })
    setSubmitting(false)
    if (!ok) return
  }

  const pickTemplate = async (templateId: string): Promise<void> => {
    setSubmitting(true)
    await onSubmit({ name: '', templateId })
    setSubmitting(false)
  }

  const suggestions = TEMPLATE_ACTION_CATEGORIES.filter(
    (category) => !existingCategoryIds.includes(category.id),
  )

  return (
    <Modal
      open
      size="sm"
      title={t('config.controls.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.controls.createDialog.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {suggestions.length > 0 && (
          <Field label={t('config.controls.createDialog.suggestions.label')}>
            <div className="space-y-0.5 rounded-sm border border-line">
              {suggestions.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  disabled={submitting}
                  onClick={() => void pickTemplate(category.id)}
                  className="flex w-full items-center px-2.5 py-1.5 text-left text-xs text-ink transition-colors duration-[--dur-fast] hover:bg-hover disabled:opacity-50"
                >
                  {t(category.labelKey)}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label={t('config.controls.createDialog.nameLabel')}>
          <Input
            value={name}
            autoFocus
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) void submit()
            }}
          />
        </Field>
      </div>
    </Modal>
  )
}

/** Renames one custom category. Mirrors `RenameProfileDialog`'s shape. */
function RenameCategoryDialog({
  category,
  onClose,
  onSubmit,
}: {
  category: ConfigActionCategory
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(category.name)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    await onSubmit(name.trim())
    setSubmitting(false)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.controls.renameDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('config.controls.renameDialog.label')}>
        <Input
          value={name}
          autoFocus
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim().length > 0) void submit()
          }}
        />
      </Field>
    </Modal>
  )
}

/** Create-sub-category form: name only (story 053 D6) - a sub-category has no template
 * suggestions to offer, unlike `CreateCategoryDialog`. Exported like the category/action create
 * dialogs so it can be unit-tested directly. */
export function CreateSubcategoryDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    const ok = await onSubmit(name.trim())
    setSubmitting(false)
    if (!ok) return
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.controls.subcategory.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('config.controls.subcategory.createDialog.submit')}
          </Button>
        </>
      }
    >
      <Field label={t('config.controls.subcategory.createDialog.nameLabel')}>
        <Input
          value={name}
          autoFocus
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmit) void submit()
          }}
        />
      </Field>
    </Modal>
  )
}

/** Renames one sub-category. Mirrors `RenameCategoryDialog`'s shape one level down. */
export function RenameSubcategoryDialog({
  subcategory,
  onClose,
  onSubmit,
}: {
  subcategory: ConfigActionSubcategory
  onClose: () => void
  onSubmit: (name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(subcategory.name)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = name.trim().length > 0 && !submitting

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    await onSubmit(name.trim())
    setSubmitting(false)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.controls.subcategory.renameDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('config.controls.subcategory.renameDialog.label')}>
        <Input
          value={name}
          autoFocus
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim().length > 0) void submit()
          }}
        />
      </Field>
    </Modal>
  )
}

const ENTRY_KIND_OPTIONS: ActionEntryKind[] = ['bind', 'message', 'alias', 'toggle', 'press-release']

/**
 * Create-action form: name plus the kind (story 019 D4 - the entry, not the category, carries
 * the kind), plus (story 052 D9, AC 6) a catalogue suggestions list above the free-form fields.
 * Picking a suggestion submits immediately with that row's `catalogId` - the same "one entry, one
 * click" shape `ActionEditor`'s own "pick from the catalogue" list already uses for a command, just
 * one level up (an entire entry instead of one of its commands). Debounced-saved by the caller
 * either way, so this dialog never waits on a network round trip.
 *
 * Exported (like `CreateCategoryDialog`) so both suggestion lists can be unit-tested directly.
 */
export function CreateActionDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (name: string, kind: ActionEntryKind, catalogId?: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ActionEntryKind>('bind')
  const [filter, setFilter] = useState('')

  const canSubmit = name.trim().length > 0

  const submit = (): void => {
    if (!canSubmit) return
    onSubmit(name.trim(), kind)
  }

  /**
   * Story 052 review (finding 8): the *stored* name is the catalogue's own locale-independent one
   * (`nameForCatalogRow`), never `t(info.labelKey)`. `ConfigAction.name` is persisted and written
   * verbatim into the `.cfg` comment by `render.ts`, so a translated label here would make the
   * user's file depend on the UI language it happened to be created in - and every other
   * catalogue-backed entry (`STANDARD_TEMPLATE`, the D6 migration, `bind-adoption.ts#materialise`)
   * already uses `nameForCatalogRow` for exactly that reason. The list above still *shows* the
   * translated label: that is UI chrome, and the row renders under its translated label either way
   * once it exists, because it carries the `catalogId`.
   */
  const pickSuggestion = (info: CatalogRowInfo): void => {
    onSubmit(nameForCatalogRow(info.row), 'bind', info.row.catalogId)
  }

  const suggestions = useMemo(() => {
    const all = allCatalogRowInfos()
    const query = filter.trim().toLowerCase()
    return query ? all.filter((info) => t(info.labelKey).toLowerCase().includes(query)) : all
  }, [filter, t])

  return (
    <Modal
      open
      size="sm"
      title={t('config.controls.actions.createDialog.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {t('config.controls.actions.createDialog.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('config.controls.actions.createDialog.suggestions.label')}>
          <Input
            value={filter}
            placeholder={t('config.controls.actions.createDialog.suggestions.filterPlaceholder')}
            aria-label={t('config.controls.actions.createDialog.suggestions.filterPlaceholder')}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-sm border border-line">
            {suggestions.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-ink-muted">{t('common.none')}</p>
            ) : (
              suggestions.map((info) => (
                <button
                  key={info.row.catalogId}
                  type="button"
                  onClick={() => pickSuggestion(info)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-ink transition-colors duration-[--dur-fast] hover:bg-hover"
                >
                  <span>{t(info.labelKey)}</span>
                  <code className="text-ink-muted">
                    {info.row.commands.join('; ')}
                    {info.row.ammoCommand
                      ? ` +${t('config.controls.actions.createDialog.suggestions.ammoBadge')}`
                      : ''}
                  </code>
                </button>
              ))
            )}
          </div>
        </Field>

        <Field label={t('config.controls.actions.createDialog.nameLabel')}>
          <Input
            value={name}
            // Story 052 review (finding 2): no `autoFocus` here, deliberately - `Modal` focuses the
            // first control in its body on open (`Modal.tsx`), which since D9 put the suggestions
            // list on top is the catalogue filter, and that wins over any `autoFocus` set here. The
            // field is instead identified by its `Field` label ("Name"), which is what the two
            // `ui:flow` scripts that fill it now locate it by, rather than by being the dialog's
            // first text input.
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) submit()
            }}
          />
        </Field>
        <Field label={t('config.controls.createDialog.entryKindLabel')}>
          <Select
            options={ENTRY_KIND_OPTIONS.map((option) => ({
              value: option,
              label: t(`config.controls.entryKind.${option}`),
            }))}
            value={kind}
            onChange={(event) => setKind(event.target.value as ActionEntryKind)}
          />
        </Field>
      </div>
    </Modal>
  )
}

// `RenameActionDialog` moved to `./components/RenameActionDialog.tsx` (story 044, D5) - reused as-is
// by `AliasesTab.tsx`, imported above.
