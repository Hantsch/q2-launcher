import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import type { ModifierTrigger } from '@shared/config/modifier-layers'
import type { AltLayer } from '@shared/config/alt-layers'
import { aliasNameFor, derivedAliasName } from '@shared/config/alias-render'
import { validateAliasName } from '@shared/config/alias-names'
import { findAliasReferrers, type AliasReferrer } from '@shared/config/alias-references'
import {
  BUILT_IN_ACTION_CATEGORIES,
  type ActionEntryKind,
  type ConfigAction,
  type ConfigActionCategory,
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
import { MessageEditor } from './components/MessageEditor'
import { updateProfileActions } from './client'
import { findBindConflicts, findSlotConflictOwner, indexBindConflicts } from './lib/bind-conflicts'
import {
  applyModifierReplace,
  applyPlainModifierReplace,
  applyPlainReplace,
  applyReplace,
  findModifierSlotCollision,
  findSlotCollision,
  layerNameForModifier,
} from './lib/bind-slot-collision'
import {
  applyAmmo,
  applyMessage,
  applyPlainSlot,
  applySlot,
  deriveRowState,
  type CatalogRow,
} from './lib/catalog-binds'
import {
  buildCatalogControlsRowEntries,
  type CatalogControlsRowEntry,
  type ControlsRowEntry,
  type DualBindCategoryId,
} from './lib/controls-row-entries'
import { groupControlsRowEntries } from './lib/controls-row-groups'
import { moveEntryWithinCategory } from './lib/entry-order'
import { restoreDefaultActions } from './lib/restore-defaults'

const SAVE_DEBOUNCE_MS = 500

type SaveStatus = 'idle' | 'saving' | 'saved'

/**
 * Story 015 D5/D6: the three built-in categories that used to get their own dedicated dual-bind
 * editor. Story 020 D3 collapsed `DualBindPanel`/`DropBindPanel`/the generic action list into one
 * `ControlsGrid` for every category (see the render below) - this set now only decides which
 * categories are catalogue-driven (`isDualBindCategory` below), not which component renders the
 * action list. `DualBindPanel.tsx`/`DropBindPanel.tsx` themselves were deleted once nothing
 * imported them any more (review fix); their `lib/catalog-binds.ts` helpers live on, called from
 * this file's own `renderCatalogRow`/`renderCatalogSlot`/`renderCatalogOptionsCell`.
 */
const DUAL_BIND_CATEGORY_IDS = new Set<string>(['movement', 'weapons', 'drops'])

export interface ControlsTabProps {
  profile: ConfigProfile
  /** Story 009 D6: the shared in-progress draft, owned by `ConfigView`'s `useProfileDraft`. */
  draft: ConfigProfile
  patch: (
    partial: Partial<ConfigProfile> | ((prev: ConfigProfile) => Partial<ConfigProfile>),
  ) => void
  onChanged: (profiles: ConfigProfile[]) => void
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
export function ControlsTab({ profile, draft, patch, onChanged }: ControlsTabProps) {
  const { t } = useTranslation()

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
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    BUILT_IN_ACTION_CATEGORIES[0].id,
  )
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saving, setSaving] = useState(false)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Story 020 D9: one entry per rendered category chip (built-in or custom), keyed by category
   * id, so the scroll-into-view effect below can find the selected chip's DOM node without a
   * ref per category living in component state - a plain mutable map updated by each chip's own
   * callback ref is enough for this presentational concern. */
  const categoryChipRefs = useRef(new Map<string, HTMLElement>())

  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [renamingCategory, setRenamingCategory] = useState<ConfigActionCategory | null>(null)
  const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<string | null>(null)
  const [showCreateAction, setShowCreateAction] = useState(false)
  const [renamingAction, setRenamingAction] = useState<ConfigAction | null>(null)
  const [editingActionId, setEditingActionId] = useState<string | null>(null)
  /** Story 020 D10: "Restore defaults" asks before it discards every bind in the profile - opening
   * the confirm never touches `actions` by itself; only a confirmed submit does. */
  const [showRestoreDefaults, setShowRestoreDefaults] = useState(false)
  /** Story 020 D8: local, not persisted - the filter is a view concern, not a draft edit. Reset
   * whenever the selected category changes so a filter typed in one category never silently hides
   * rows in the next one. */
  const [filterText, setFilterText] = useState('')
  /** Review fix (findings 4/5): which drops row's message `Modal` is open, or `null` for none.
   * The editor reads its initial channel/text off `actions` itself (looked up by `catalogId`), so
   * this only has to remember *which* row - plus the row's already-resolved i18n label, because a
   * `CatalogRow` carries no `labelKey` and the modal's title needs one (story 029 D4). */
  const [messageEditorRow, setMessageEditorRow] = useState<{
    row: CatalogRow
    label: string
  } | null>(null)
  /**
   * Story 029 D4: which drops rows have their inline message row revealed *without* a message
   * being stored yet (AC 3/5). Local view state, not a draft edit - and deliberately not derived:
   * an empty message is never persisted (`applyMessage('')` prunes it), so a row the user just
   * checked has nothing in `actions` to read the checked state back from. The checkbox and the
   * sub-row are both rendered from "has a stored message OR is in this set", so the two can never
   * disagree (story decision).
   */
  const [revealedMessageRows, setRevealedMessageRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

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
    setSelectedCategoryId(BUILT_IN_ACTION_CATEGORIES[0].id)
    setStatus('idle')
    clearPendingSave()
    // Story 029 D4: the reveal set and an open message editor both name a row of the profile being
    // switched away from - carrying them over would show another profile's row as "has a message
    // pending" and let a Save land on the wrong profile's actions.
    setRevealedMessageRows(new Set())
    setMessageEditorRow(null)
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

  const handleCreateCategory = async (input: { name: string }): Promise<boolean> => {
    const category: ConfigActionCategory = {
      id: crypto.randomUUID(),
      name: input.name,
    }
    const ok = await persistCategoriesAndActions([...categories, category], actions)
    if (ok) {
      setShowCreateCategory(false)
      setSelectedCategoryId(category.id)
    }
    return ok
  }

  const handleRenameCategory = async (categoryId: string, name: string): Promise<boolean> => {
    const nextCategories = categories.map((category) =>
      category.id === categoryId ? { ...category, name } : category,
    )
    const ok = await persistCategoriesAndActions(nextCategories, actions)
    if (ok) setRenamingCategory(null)
    return ok
  }

  const handleDeleteCategory = async (categoryId: string): Promise<void> => {
    const nextCategories = categories.filter((category) => category.id !== categoryId)
    const nextActions = actions.filter((action) => action.categoryId !== categoryId)
    const ok = await persistCategoriesAndActions(nextCategories, nextActions)
    if (ok) {
      setPendingDeleteCategoryId(null)
      if (categoryId === selectedCategoryId) setSelectedCategoryId(BUILT_IN_ACTION_CATEGORIES[0].id)
    }
  }

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

  const handleCreateAction = (name: string, kind: ActionEntryKind): void => {
    const action: ConfigAction = {
      id: crypto.randomUUID(),
      categoryId: selectedCategoryId,
      name,
      // Story 019 D4: the create dialog now asks for the kind directly - the
      // category can no longer answer for the entry.
      kind,
      commands: [],
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
   */
  const handleMoveAction = (actionId: string, direction: 'up' | 'down'): void => {
    void persistCategoriesAndActions(
      categories,
      moveEntryWithinCategory(actions, actionId, direction),
    )
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
   * A catalogue row's own reset (AC 4/5): both key slots go through the same `applySlot` helper
   * `DualBindPanel`/`DropBindPanel` already use, one combined save rather than two round trips.
   * Ammo/message are left untouched - "resets that row's binds" is the key slots, not the row's
   * other settings (D4's own judgement call, see the story requirement).
   */
  const handleResetCatalogRow = (row: CatalogRow): void => {
    const cleared = applySlot(
      applySlot(actions, row, 'primary', undefined),
      row,
      'secondary',
      undefined,
    )
    handleCatalogActionsChange(cleared)
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
  const handleToggleRowMessage = (row: CatalogRow, next: boolean): void => {
    setRevealedMessageRows((current) => {
      const updated = new Set(current)
      if (next) updated.add(row.catalogId)
      else updated.delete(row.catalogId)
      return updated
    })
    if (next) return
    const action = actions.find((entry) => entry.catalogId === row.catalogId)
    // Nothing stored means nothing to clear - skip the save rather than persisting an array that
    // is identical to the one already on disk.
    if (deriveRowState(action, row).message.trim().length > 0) {
      handleCatalogActionsChange(applyMessage(actions, row, ''))
    }
  }

  /** A plain action's own reset: clears its key slots, never its `commands` and never the action
   * itself - the action stays in the profile exactly as `ActionEditor` left it. */
  const handleResetAction = (actionId: string): void => {
    const nextActions = actions.map((action) =>
      action.id === actionId
        ? {
            ...action,
            key: undefined,
            secondaryKey: undefined,
            keyModifier: undefined,
            secondaryKeyModifier: undefined,
          }
        : action,
    )
    void persistCategoriesAndActions(categories, nextActions)
  }

  /**
   * "Restore defaults" (D10, AC 11): acts on the whole profile, not the selected category (sprint
   * decision) - `restoreDefaultActions` reads/writes the full `actions` array regardless of which
   * category tab happens to be open. A discrete confirmed action, not a debounced one, same
   * reasoning `persistCategoriesAndActions` already documents for category CRUD: one click should
   * not risk being silently reverted by an unrelated debounce firing on stale data afterwards.
   */
  const handleRestoreDefaults = async (): Promise<void> => {
    const ok = await persistCategoriesAndActions(categories, restoreDefaultActions(actions))
    if (ok) setShowRestoreDefaults(false)
  }

  const selectedBuiltIn =
    BUILT_IN_ACTION_CATEGORIES.find((category) => category.id === selectedCategoryId) ?? null
  const selectedCustom = categories.find((category) => category.id === selectedCategoryId)
  const selectedCategoryLabel = selectedBuiltIn
    ? t(selectedBuiltIn.labelKey)
    : (selectedCustom?.name ?? '')
  const actionsForCategory = actions.filter((action) => action.categoryId === selectedCategoryId)
  const editingAction = editingActionId
    ? (actions.find((action) => action.id === editingActionId) ?? null)
    : null

  // Story 020 D4: movement/weapons/drops are catalogue-driven - every catalogue action is a row
  // whether or not it has a matching persisted `ConfigAction` yet (lazy materialisation), unioned
  // with that category's legacy free-form actions. Every other category keeps showing exactly its
  // persisted `actionsForCategory`, one entry per action.
  const isDualBindCategory = DUAL_BIND_CATEGORY_IDS.has(selectedCategoryId)
  const rowEntries: ControlsRowEntry[] = isDualBindCategory
    ? buildCatalogControlsRowEntries(selectedCategoryId as DualBindCategoryId, actions)
    : actionsForCategory.map((action) => ({ kind: 'action', action }))

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
  const rowGroups = groupControlsRowEntries(filteredRowEntries)
  // "n rows · m bound" follows the filter (D8) - unlike `conflicts.length` below, which stays a
  // profile-wide scan per D7's own decision and must NOT be recomputed off the filtered subset.
  const boundCount = filteredRowEntries.filter((entry) => {
    if (entry.kind === 'catalog') {
      const state = deriveRowState(entry.action, entry.row)
      return Boolean(state.primary) || Boolean(state.secondary)
    }
    return Boolean(entry.action.key?.trim()) || Boolean(entry.action.secondaryKey?.trim())
  }).length

  /** One catalogue row's Primary/Secondary `BindSlot`, wired exactly like `DualBindPanel`'s
   * `CatalogBindRow` - same collision plumbing, same `apply*` helpers, just inside `ControlsRow`'s
   * layout instead of the old `<li>` one. */
  const renderCatalogSlot = (
    row: CatalogRow,
    action: ConfigAction | undefined,
    slot: 'primary' | 'secondary',
  ) => {
    const state = deriveRowState(action, row)
    const boundKey = slot === 'primary' ? state.primary : state.secondary
    const boundModifier = slot === 'primary' ? state.primaryModifier : state.secondaryModifier
    const ownerName = action?.name ?? row.commands[0] ?? row.catalogId
    const isConflicted = Boolean(
      findSlotConflictOwner(conflictIndex, layers, boundKey, boundModifier, ownerName),
    )
    const checkModifierCollision = (modifier: ModifierTrigger, key: string) =>
      findModifierSlotCollision(actions, draft.layers ?? [], modifier, key, action?.id)
    return (
      <BindSlot
        label={t(
          slot === 'primary'
            ? 'config.controls.dualBind.primary'
            : 'config.controls.dualBind.secondary',
        )}
        boundKey={boundKey}
        boundModifier={boundModifier}
        // AC 6: a bound Primary cell is the strongest element in its row. AC 8: a slot whose key
        // collides with another owner anywhere in the profile is marked (D7's whole-profile scan).
        isPrimary={slot === 'primary'}
        isConflicted={isConflicted}
        checkModifierCollision={checkModifierCollision}
        checkCollision={(key) =>
          findSlotCollision(draft, key, action ? { actionId: action.id, slot } : undefined)
        }
        onAssign={(key) => handleCatalogActionsChange(applySlot(actions, row, slot, key))}
        onAssignModifier={({ modifier, key }) =>
          handleCatalogActionsChange(
            applyModifierReplace({
              actions,
              collision: checkModifierCollision(modifier, key),
              row,
              slot,
              key,
              modifier,
            }),
          )
        }
        onReplace={(key, collision) =>
          handleCatalogActionsChange(
            applyReplace({ actions, binds: draft.binds, collision, row, slot, key }),
          )
        }
        onClear={() => handleCatalogActionsChange(applySlot(actions, row, slot, undefined))}
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
  const renderCatalogOptionsCell = (row: CatalogRow, action: ConfigAction | undefined) => {
    const state = deriveRowState(action, row)
    // A row can carry a modifier on either slot, on both, or on neither; the prototype's common
    // case is one modifier per row, so the primary slot's modifier wins when both happen to carry
    // one (the rare case - documenting the choice per the deliverable's own note). The same
    // primary-first tie-break applies to which slot's conflict the Options cell names.
    const modifier = state.primaryModifier ?? state.secondaryModifier
    const layer = modifier ? layerNameForModifier(draft.layers ?? [], modifier) : undefined
    const ownerName = action?.name ?? row.commands[0] ?? row.catalogId
    const conflictOwner =
      findSlotConflictOwner(
        conflictIndex,
        layers,
        state.primary,
        state.primaryModifier,
        ownerName,
      ) ??
      findSlotConflictOwner(
        conflictIndex,
        layers,
        state.secondary,
        state.secondaryModifier,
        ownerName,
      )
    const conflict = conflictOwner ? { owner: conflictOwner } : null
    // Review fix (finding 2): a `shrink-0` wrapper keeps the ammo/message checkboxes from being
    // squeezed by the flex layout - only the conflict/layer text (which now truncates, see
    // `ControlsOptionsCell.tsx`) gives up space in the 150px column.
    //
    // Story 029 D4: the two checkboxes stack instead of sitting on one line. "With ammo" plus
    // "With message" is ~190px of content, and the Options track is a fixed 150px with
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
                onChange={(next) => handleCatalogActionsChange(applyAmmo(actions, row, next))}
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
              checked={state.message.trim().length > 0 || revealedMessageRows.has(row.catalogId)}
              onChange={(next) => handleToggleRowMessage(row, next)}
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
  const renderMessageSubRow = (row: CatalogRow, label: string, message: string) => (
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
        onClick={() => setMessageEditorRow({ row, label })}
      >
        {t('config.controls.dropBind.editMessage')}
      </Button>
    </span>
  )

  /**
   * The seed `MessageEditor` opens with for a drops row. A row nobody has touched yet has no
   * `ConfigAction` at all (decision 3's lazy materialisation), and the editor takes one - so this
   * hands it a stand-in carrying no commands, which is exactly "no message set". It is never
   * persisted: the save path is `applyMessage(actions, row, ...)`, which does its own
   * find-or-create against the real array.
   */
  const messageEditorSeed = (row: CatalogRow, label: string): ConfigAction =>
    actions.find((action) => action.catalogId === row.catalogId) ?? {
      id: row.catalogId,
      categoryId: row.categoryId,
      name: label,
      kind: 'bind',
      catalogId: row.catalogId,
      commands: [],
    }

  const renderCatalogRow = (entry: CatalogControlsRowEntry, odd: boolean) => {
    const { row, labelKey, action } = entry
    const label = t(labelKey)
    // Story 029 D4 (AC 3/5): only drops rows have a message at all, and the row is revealed on the
    // same condition its checkbox is checked on - a stored message, or a box the user just ticked.
    const isDropRow = row.categoryId === 'drops'
    const message = isDropRow ? deriveRowState(action, row).message : ''
    const showMessageRow =
      isDropRow && (message.trim().length > 0 || revealedMessageRows.has(row.catalogId))
    return (
      <ControlsRow
        key={row.catalogId}
        name={label}
        command={row.commands.join(', ')}
        resetLabel={t('config.controls.actions.reset', { name: label })}
        onReset={() => handleResetCatalogRow(row)}
        odd={odd}
        primarySlot={renderCatalogSlot(row, action, 'primary')}
        secondarySlot={renderCatalogSlot(row, action, 'secondary')}
        optionsCell={renderCatalogOptionsCell(row, action)}
        subRow={showMessageRow ? renderMessageSubRow(row, label, message) : undefined}
      />
    )
  }

  /**
   * A plain action's Primary/Secondary `BindSlot` (story 020 D6 plan-gap fix): a custom
   * category's own `bind`/`message` entry, or a legacy free-form action living inside a
   * catalogue category, gets a live capturable slot exactly like a catalogue row - only an
   * `alias` entry gets the inert placeholder (story 019). Wired the same way `renderCatalogSlot`
   * wires a catalogue row's slot - same collision plumbing, same immediate
   * `handleCatalogActionsChange` save - just keyed by `action.id` through `applyPlainSlot`/
   * `applyPlainReplace`/`applyPlainModifierReplace` instead of a `CatalogRow`.
   */
  const renderPlainSlot = (action: ConfigAction, slot: 'primary' | 'secondary') => {
    const boundKey = slot === 'primary' ? action.key : action.secondaryKey
    const boundModifier = slot === 'primary' ? action.keyModifier : action.secondaryKeyModifier
    const isConflicted = Boolean(
      findSlotConflictOwner(conflictIndex, layers, boundKey, boundModifier, action.name),
    )
    const checkModifierCollision = (modifier: ModifierTrigger, key: string) =>
      findModifierSlotCollision(actions, draft.layers ?? [], modifier, key, action.id)
    return (
      <BindSlot
        label={t(
          slot === 'primary'
            ? 'config.controls.dualBind.primary'
            : 'config.controls.dualBind.secondary',
        )}
        boundKey={boundKey}
        boundModifier={boundModifier}
        isPrimary={slot === 'primary'}
        isConflicted={isConflicted}
        checkModifierCollision={checkModifierCollision}
        checkCollision={(key) => findSlotCollision(draft, key, { actionId: action.id, slot })}
        onAssign={(key) =>
          handleCatalogActionsChange(applyPlainSlot(actions, action.id, slot, key))
        }
        onAssignModifier={({ modifier, key }) =>
          handleCatalogActionsChange(
            applyPlainModifierReplace({
              actions,
              collision: checkModifierCollision(modifier, key),
              actionId: action.id,
              slot,
              key,
              modifier,
            }),
          )
        }
        onReplace={(key, collision) =>
          handleCatalogActionsChange(
            applyPlainReplace({
              actions,
              binds: draft.binds,
              collision,
              actionId: action.id,
              slot,
              key,
            }),
          )
        }
        onClear={() =>
          handleCatalogActionsChange(applyPlainSlot(actions, action.id, slot, undefined))
        }
      />
    )
  }

  /**
   * Review fix (finding 2): a plain action's Options cell used to be *only* the move/edit/rename/
   * remove icon buttons - unlike a catalogue row, it never showed the modifier layer name, the
   * "also: <owner>" conflict text or the plain dash. Mirrors `renderCatalogOptionsCell`'s
   * conflict/layer lookup exactly, just keyed by the action's own `key`/`secondaryKey`/
   * `keyModifier`/`secondaryKeyModifier` instead of `deriveRowState`'s catalogue-row read - there
   * is no drops-only ammo/message `extra` slot here, that machinery is catalogue-only (drops rows
   * are always catalogue rows, never plain actions).
   */
  const renderPlainOptionsCell = (action: ConfigAction) => {
    const modifier = action.keyModifier ?? action.secondaryKeyModifier
    const layer = modifier ? layerNameForModifier(draft.layers ?? [], modifier) : undefined
    const conflictOwner =
      findSlotConflictOwner(conflictIndex, layers, action.key, action.keyModifier, action.name) ??
      findSlotConflictOwner(
        conflictIndex,
        layers,
        action.secondaryKey,
        action.secondaryKeyModifier,
        action.name,
      )
    const conflict = conflictOwner ? { owner: conflictOwner } : null
    return <ControlsOptionsCell layer={layer} conflict={conflict} />
  }

  /**
   * A plain `ConfigAction` row: a custom category's own entry, or a legacy free-form action
   * living inside a catalogue category ("Other actions", decision 5). Both get the full move/
   * edit/rename/remove treatment D3's placeholder already offered every action - the neighbour
   * index is `actionsForCategory`'s (every action sharing this `categoryId`, catalogue-bound or
   * not), matching `moveEntryWithinCategory`'s own neighbour walk exactly.
   */
  const renderActionRow = (action: ConfigAction, odd: boolean) => {
    const index = actionsForCategory.findIndex((candidate) => candidate.id === action.id)
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
        primarySlot={inertSlots ? <BindSlotPlaceholder /> : renderPlainSlot(action, 'primary')}
        secondarySlot={inertSlots ? <BindSlotPlaceholder /> : renderPlainSlot(action, 'secondary')}
        optionsCell={
          // Story 028 D1: no `flex-wrap`, and gap-0.5 — the 150px Options track fits the five
          // 28px icon buttons only at 2px gaps (5x28 + 4x2 = 148px). With wrap enabled the
          // buttons spilled onto extra lines outside the 40px row. The options text yields
          // entirely (`min-w-0` + `overflow-hidden` lets it collapse below its content width);
          // conflict/layer state stays visible on the slots themselves and the header badge.
          <div className="flex w-full items-center justify-end gap-0.5">
            {!inertSlots && (
              <div className="min-w-0 overflow-hidden">{renderPlainOptionsCell(action)}</div>
            )}
            <IconButton
              label={t('config.controls.actions.moveUp')}
              size="sm"
              disabled={index === 0}
              onClick={() => handleMoveAction(action.id, 'up')}
            >
              <ArrowUp className="size-3.5" />
            </IconButton>
            <IconButton
              label={t('config.controls.actions.moveDown')}
              size="sm"
              disabled={index === actionsForCategory.length - 1}
              onClick={() => handleMoveAction(action.id, 'down')}
            >
              <ArrowDown className="size-3.5" />
            </IconButton>
            <IconButton
              label={t('config.controls.actions.edit')}
              size="sm"
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
      />
    )
  }

  return (
    // Story 020 review fix: AC 2's ~1120px cap has to hold the whole tab body, not just the grid
    // - an ultrawide window otherwise stretches the category rail and toolbar full-width while the
    // grid caps underneath them, which reads as broken. `ControlsGrid`'s own `.ctrl-stage` still
    // caps the table itself (harmless redundancy, both centre on the same 1120px), but this outer
    // wrapper is what actually caps the category rail and the filter/restore-defaults toolbar.
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
          Story 020 D9: a single-row, horizontally scrollable rail (sprint decision) instead of
          the old `flex flex-wrap` strip - `.ctrl-category-rail` (controls-grid.css) adds
          `overflow-x-auto` and a themed scrollbar, and every chip carries `shrink-0` so the row
          scrolls instead of squeezing. "+ New category" moves into the rail as its own trailing
          item, matching the prototype's single-row `Movement | Weapons | ... | + New category`
          (a-column-grid.html) rather than living as a separate button above the strip - the
          create dialog it opens (`showCreateCategory`) is unchanged. The stale "Built-in" badge
          (story 019 removed `entryKind` from categories) is gone; `DUAL_BIND_CATEGORY_IDS` stays
          for `isDualBindCategory` below.
        */}
        <div className="ctrl-category-rail">
          {BUILT_IN_ACTION_CATEGORIES.map((category) => (
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
                  - the "+ New category" button and the rename/delete icon buttons sitting next to
                  a category button are not tabs, so a full ARIA tabs pattern does not fit this
                  rail's mixed content. Selection is already conveyed visually (`variant='primary'`)
                  and via `aria-pressed` below - no `role`/`aria-selected` claim that isn't backed
                  by real tab semantics (arrow-key roving tabindex, `aria-controls`). */}
              <Button
                aria-pressed={selectedCategoryId === category.id}
                variant={selectedCategoryId === category.id ? 'primary' : 'neutral'}
                size="sm"
                onClick={() => setSelectedCategoryId(category.id)}
              >
                {t(category.labelKey)}
              </Button>
            </div>
          ))}

          {categories.map((category) => {
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
                <Button
                  aria-pressed={selectedCategoryId === category.id}
                  variant={selectedCategoryId === category.id ? 'primary' : 'neutral'}
                  size="sm"
                  onClick={() => setSelectedCategoryId(category.id)}
                >
                  {category.name}
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
                      onClick={() => setPendingDeleteCategoryId(category.id)}
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
      </div>

      {/*
        Story 020 D3/D4: one grid for every category - `DualBindPanel`, `DropBindPanel` and the
        old bare `<ul>` collapse into `ControlsGrid`. movement/weapons/drops read `rowEntries` off
        the catalogue (lazy materialisation - an unbound catalogue row is still a real row); every
        other category keeps showing exactly its persisted actions. D5/D6 still own the real slot
        surface and Options-cell content respectively - `renderCatalogRow`/`renderActionRow` above
        wire today's `BindSlot`/CRUD affordances into D4's `ControlsRow` shell.
      */}
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
            <Button
              variant="neutral"
              size="sm"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => setShowRestoreDefaults(true)}
            >
              {t('config.controls.restoreDefaults.button')}
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
                : renderActionRow(entry.action, odd)
            }}
          />
        )}
      </div>

      {showRestoreDefaults && (
        <Modal
          open
          size="sm"
          title={t('config.controls.restoreDefaults.title')}
          onClose={() => setShowRestoreDefaults(false)}
          closeLabel={t('common.close')}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => setShowRestoreDefaults(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={saving}
                onClick={() => void handleRestoreDefaults()}
              >
                {t('config.controls.restoreDefaults.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-dim">{t('config.controls.restoreDefaults.body')}</p>
        </Modal>
      )}

      {showCreateCategory && (
        <CreateCategoryDialog
          onClose={() => setShowCreateCategory(false)}
          onSubmit={handleCreateCategory}
        />
      )}

      {renamingCategory && (
        <RenameCategoryDialog
          category={renamingCategory}
          onClose={() => setRenamingCategory(null)}
          onSubmit={(name) => handleRenameCategory(renamingCategory.id, name)}
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
          onClose={() => setEditingActionId(null)}
          onSave={(draft) =>
            void handleSaveAction({
              ...editingAction,
              commands: [
                { kind: 'message', channel: draft.channel as 'say' | 'say_team', text: draft.text },
              ],
              key: draft.key,
            })
          }
        />
      )}

      {editingAction && editingAction.kind !== 'message' && (
        <ActionEditor
          action={editingAction}
          actions={actions}
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
      {messageEditorRow && (
        <MessageEditor
          action={messageEditorSeed(messageEditorRow.row, messageEditorRow.label)}
          titleName={messageEditorRow.label}
          showKeyCapture={false}
          onClose={() => setMessageEditorRow(null)}
          onSave={(draft) => {
            handleCatalogActionsChange(
              applyMessage(
                actions,
                messageEditorRow.row,
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

/** Create-category form: name only - story 019 moved the entry kind onto the entry itself. */
function CreateCategoryDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: { name: string }) => Promise<boolean>
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

const ENTRY_KIND_OPTIONS: ActionEntryKind[] = ['bind', 'message', 'alias']

/** Create-action form: name plus the kind (story 019 D4 - the entry, not the category, carries
 * the kind). Debounced-saved by the caller, so this dialog does not wait on a network round trip
 * - it hands the trimmed name and chosen kind back and closes immediately. */
function CreateActionDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (name: string, kind: ActionEntryKind) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ActionEntryKind>('bind')

  const canSubmit = name.trim().length > 0

  const submit = (): void => {
    if (!canSubmit) return
    onSubmit(name.trim(), kind)
  }

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
        <Field label={t('config.controls.actions.createDialog.nameLabel')}>
          <Input
            value={name}
            autoFocus
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

/**
 * Renames one action. Mirrors `RenameProfileDialog`'s shape, plus - since story 039 - a second,
 * optional "own alias name" field and the rename-refusal check that field is the escape hatch for.
 *
 * `actions`/`binds`/`layers` are the profile's full reference sources (story 038's
 * `AliasReferenceSources` shape), needed for two independent reasons: `actions` (minus this one)
 * supplies `validateAliasName`'s duplicate-check `context`, and all three together are what
 * `findAliasReferrers` scans to decide whether changing the *display* name would leave a dangling
 * reference behind.
 */
function RenameActionDialog({
  action,
  actions,
  binds,
  layers,
  onClose,
  onSubmit,
}: {
  action: ConfigAction
  actions: ConfigAction[]
  binds: Record<string, string>
  layers: AltLayer[]
  onClose: () => void
  onSubmit: (input: { name: string; aliasName: string | undefined }) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(action.name)
  const [ownAliasName, setOwnAliasName] = useState(action.aliasName ?? '')
  const [submitting, setSubmitting] = useState(false)

  const placeholder = derivedAliasName(action)

  // The other entries' already-resolved alias names - `validateAliasName`'s duplicate check, same
  // shape D2's own doc comment describes (`alias-names.ts`).
  const otherAliasNames = useMemo(
    () => actions.filter((other) => other.id !== action.id).map((other) => aliasNameFor(other)),
    [actions, action.id],
  )

  const trimmedOwnAliasName = ownAliasName.trim()
  // An empty own-name field means "use the derived name" - not a candidate to validate at all
  // (design decision: clearing the field returns the entry to the derived name).
  const aliasValidation =
    trimmedOwnAliasName.length > 0 ? validateAliasName(trimmedOwnAliasName, otherAliasNames) : { ok: true as const }
  const aliasError = aliasValidation.ok
    ? undefined
    : t(
        `config.controls.actions.renameDialog.aliasName.error.${aliasValidation.reason}`,
        aliasValidation.params,
      )

  // Rename refusal (story 039, D9): only the entry's *current* alias name - resolved before any
  // edit in this dialog - and only while the display name is actually changing. Changing solely the
  // alias-name field is never refused; that field is the story's own escape hatch.
  //
  // Review fix: the escape hatch must also cover "pin a name, then rename" *in one save* - typing
  // an own name (whether it repeats the current resolved name to lock it in place, or replaces it
  // outright) decouples the resolved alias name from the display name from this submit onward, so
  // a display-name change alongside it can never move the name any referrer relies on. Only when
  // the dialog would still fall back to the *derived* name (own-name field left empty) does a
  // display-name change risk silently moving a referenced name - that is the one case this refusal
  // exists for.
  const referrers = useMemo(
    () => findAliasReferrers(action, { actions, binds, layers }),
    [action, actions, binds, layers],
  )
  const nameChanged = name.trim() !== action.name
  const renameRefused = nameChanged && trimmedOwnAliasName.length === 0 && referrers.length > 0

  const formatReferrer = (referrer: AliasReferrer): string => {
    switch (referrer.kind) {
      case 'action':
        return referrer.name
      case 'bind':
        return t('config.controls.actions.renameDialog.refusal.handTypedBind', { key: referrer.key })
      case 'override':
        return t('config.controls.actions.renameDialog.refusal.handTypedOverride', {
          key: referrer.key,
          layer: referrer.layerName,
        })
    }
  }

  const referrerLabels = renameRefused ? referrers.map(formatReferrer) : []
  const refusalMessage = renameRefused
    ? t('config.controls.actions.renameDialog.refusal.message', { names: referrerLabels.join(', ') })
    : undefined

  const canSubmit = name.trim().length > 0 && !submitting && aliasValidation.ok && !renameRefused

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    await onSubmit({
      name: name.trim(),
      aliasName: trimmedOwnAliasName.length > 0 ? trimmedOwnAliasName : undefined,
    })
    setSubmitting(false)
  }

  return (
    <Modal
      open
      size="sm"
      title={t('config.controls.actions.renameDialog.title')}
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
      <div className="space-y-4">
        <Field label={t('config.controls.actions.renameDialog.label')} error={refusalMessage}>
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
        <Field
          label={t('config.controls.actions.renameDialog.aliasName.label')}
          hint={aliasError ? undefined : t('config.controls.actions.renameDialog.aliasName.hint', { placeholder })}
          error={aliasError}
        >
          <Input
            value={ownAliasName}
            placeholder={placeholder}
            // Deliberately not `MAX_OWN_ALIAS_NAME_LENGTH`: an input-level `maxLength` at exactly
            // the budget would silently stop the keystroke instead of ever reaching
            // `validateAliasName`'s `tooLong` reason, so a name past the budget could never be
            // rejected *with a reason* (AC6) - only ever truncated without one. `120` mirrors the
            // display-name field above and is generous enough that a user typing past the real
            // budget still sees the `tooLong` error instead of a truncated string.
            maxLength={120}
            onChange={(event) => setOwnAliasName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) void submit()
            }}
          />
        </Field>
      </div>
    </Modal>
  )
}
