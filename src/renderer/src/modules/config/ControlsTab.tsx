import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks, Plus, TriangleAlert } from 'lucide-react'
import { withKeySlot } from '@shared/config/catalog/action-slots'
import { type ConfigAction, type ConfigActionCategory } from '@shared/modules/config'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/controls'
import { EmptyState, SectionLabel } from '../../components/ui/primitives'
import { ActionEditor } from './components/ActionEditor'
import { demoActionUnavailableReason } from './lib/demo-action-availability'
import { assignedEngineKinds } from './lib/engine-scope'
import {
  ControlsCategoryRail,
  type ControlsCategoryRailHandle,
} from './components/ControlsCategoryRail'
import { useControlsDrag } from './lib/useControlsDrag'
import { ControlsDragZone } from './components/ControlsDragZone'
import { ControlsGrid } from './components/ControlsGrid'
import { ControlsEntryRow, type ControlsEntryRowContext } from './components/ControlsEntryRow'
import { CreateActionDialog } from './components/CreateActionDialog'
import { MessageEditor } from './components/MessageEditor'
import { MoveEntryDialog } from './components/MoveEntryDialog'
import { RenameActionDialog } from './components/RenameActionDialog'
import { useProfileChanges } from './lib/profile-changes'
import { findBindConflicts, indexBindConflicts } from './lib/bind-conflicts'
import { editorKeySlot, type CatalogRow } from './lib/catalog-binds'
import { useControlsRows } from './lib/useControlsRows'
import { useControlsEntryActions, type MessageEditorRow } from './lib/useControlsEntryActions'
import { categoryDisplayName as resolveCategoryDisplayName } from './lib/category-display'
import { entryPlacementOptions, moveEntryToCategory } from './lib/entry-order'

import { useProfileDraftContext } from './lib/ProfileDraftProvider'
import { useProfileSave } from './lib/useProfileSave'

export interface ControlsTabProps {
  /** The owning action's id, when the Aliases tab's owner link for a `generated` row
   * asked to land here - selects that action's own category and focuses its row. Handled once on
   * mount only (see the focus effect below): `ConfigView` only ever mounts this tab fresh when the
   * deep link fires, since the tab panel it lives in unmounts on every tab switch. */
  focusActionId?: string
}

/**
 * category management plus a bare action list. This is
 * deliberately not a full action editor - `ConfigAction.commands`/`.key`
 * are never touched here, they stay whatever they were (`[]` for a freshly
 * created action). Command/key and message editing extend
 * this file rather than replace it, which is why every action row is
 * rendered as a distinct, addressable list item even though nothing reacts
 * to clicking one yet.
 *
 * Category CRUD is a handful of discrete dialog submits, so it saves
 * immediately (`persistCategoriesAndActions`), same reasoning `LayersPanel`
 * uses for its own immediate `persist()`. The action list's add/remove goes
 * through a debounced save instead (`useProfileSave`, as in `SettingsTab`) - not because actions are typed
 * continuously, but so a burst of quick adds/removes does not fire one
 * `updateProfileActions` per click.
 */
const NO_CATEGORIES: ConfigActionCategory[] = []
const NO_ACTIONS: ConfigAction[] = []

export function ControlsTab({ focusActionId }: ControlsTabProps) {
  const { profile, draft, patch, installations, save } = useProfileDraftContext()
  const { t, i18n } = useTranslation()
  // the profile's pending change set, read once here so every
  // `ControlsEntryRow` can ask "is my action id in `keys.actions`" - same predicate the
  // save bar's badge and count use (`useProfileChanges`, `lib/profile-changes.tsx`).
  const changeSet = useProfileChanges()
  // the engines this profile is assigned to, which decide whether a demo-playback
  // row (`seek` / speed steps are Q2PRO verbs) can be bound at all - same read `SettingsTab` does.
  const assignedEngines = useMemo(
    () => assignedEngineKinds(profile, installations),
    [profile, installations],
  )
  /** i18n key naming why `row` cannot work on the assigned engine(s), or `undefined`. */
  const unavailableReasonKey = useCallback(
    (row: CatalogRow): string | undefined =>
      demoActionUnavailableReason(row.catalogId, assignedEngines),
    [assignedEngines],
  )

  // `draft.categories`/`draft.actions` are lifted
  // into `ConfigView` so the Validation tab sees an edit immediately, with no
  // debounce and no IPC round trip in between.
  const categories = draft.categories ?? NO_CATEGORIES
  const actions = draft.actions ?? NO_ACTIONS

  /**
   * the profile-wide conflict scan, computed once per relevant draft change (not
   * per category) - "the header conflict count is profile-wide, not per category" (sprint
   * decision). `indexBindConflicts` turns the flat scan result into an O(1) per-slot lookup so
   * every `ControlsEntryRow` slot and Options cell can ask "is my own key in here"
   * without re-scanning the whole profile per row.
   */
  const conflicts = useMemo(() => findBindConflicts(draft), [draft])
  const conflictIndex = useMemo(() => indexBindConflicts(conflicts), [conflicts])
  const layers = draft.layers ?? []
  // no category is special - the rail's initial selection is simply the
  // profile's first category (in its own order), or '' for a freshly-created, still-empty profile
  // (the empty state below offers the template instead of a selectable category).
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    () => (profile.categories ?? [])[0]?.id ?? '',
  )
  const { status, saving, schedule, saveNow } = useProfileSave({
    profileId: profile.id,
    onChanged: save,
  })
  /** One entry per rendered row that carries a real `ConfigAction` - keyed by that action's id, so the focus effect below can find a
   * cross-tab-focused row's element regardless of whether it rendered as a catalogue row or a plain
   * action row. */
  const focusRowRefs = useRef(new Map<string, HTMLDivElement>())
  const [pendingFocusActionId, setPendingFocusActionId] = useState<string | null>(null)
  const focusAppliedRef = useRef<string | null>(null)

  const railRef = useRef<ControlsCategoryRailHandle>(null)

  const [showCreateAction, setShowCreateAction] = useState(false)
  const [renamingAction, setRenamingAction] = useState<ConfigAction | null>(null)
  const [editingActionId, setEditingActionId] = useState<string | null>(null)
  /** local, not persisted - the filter is a view concern, not a draft edit. Reset
   * whenever the selected category changes so a filter typed in one category never silently hides
   * rows in the next one. */
  const [filterText, setFilterText] = useState('')
  // The one way the selection changes: a filter typed in one category must never silently hide rows
  // in the next one.
  const selectCategory = (categoryId: string): void => {
    setSelectedCategoryId(categoryId)
    setFilterText('')
  }
  /** which drop row's message `Modal` is open, or `null` for none.
   * The editor reads its initial channel/text off `actions` itself (looked up by the entry's id), so this only has to remember *which* row - plus the row's already-resolved i18n
   * label, because a `CatalogRow` carries no `labelKey` and the modal's title needs one.
   * `row` is `undefined` for a drop entry that is not a catalogue row at all (a
   * `drop_` alias imported outside the catalogue) - there is then no catalogue body to fill in via
   * `catalogWriteBase` on save, only the message command itself to write (see the `onSave` below). */
  const [messageEditorRow, setMessageEditorRow] = useState<MessageEditorRow | null>(null)
  /**
   * which drops rows have their inline message row revealed *without* a message
   * being stored yet. Local view state, not a draft edit - and deliberately not derived:
   * an empty message is never persisted (`applyMessage('')` removes the command), so a row the user
   * just checked has nothing in `actions` to read the checked state back from. The checkbox and the
   * sub-row are both rendered from "has a stored message OR is in this set", so the two can never
   * disagree . Keyed by the entry's id, not its `catalogId`: a row is
   * an entry, and two entries could name the same catalogue row.
   */
  const [revealedMessageRows, setRevealedMessageRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  /**
   * which rows' extra-key sub-rows are folded open, keyed by `action.id` - mirrors
   * `revealedMessageRows` exactly (local view state, tab-lifetime persistence per not a
   * draft edit). Default fold state is collapsed (the sprint decision), so this starts empty
   * rather than pre-populated: a row is "open" whenever its id is in the set (two-or-more-extras
   * case), or unconditionally when it has exactly one extra (the fold rule's "always visible"
   * case, which `ControlsEntryRow` computes without consulting this set at
   * all).
   */
  const [expandedKeyRows, setExpandedKeyRows] = useState<ReadonlySet<string>>(() => new Set())

  // The spring-loaded category is provisional view state, deliberately not `selectedCategoryId`:
  // nothing about a spring-load may survive a cancel, and only a drop that moved the row commits it.
  const {
    draggingRowId,
    springCategoryId,
    onDragStarted: handleDragStarted,
    onDragFinished: handleDragFinished,
    onSpringLoad: handleSpringLoad,
  } = useControlsDrag({ isRowId: (id) => actions.some((action) => action.id === id) })
  /** which row's "Move to…" picker is open - the entry's id plus its already-resolved
   * display label, since a catalogue row's label needs `t()` and the dialog only shows it. */
  const [movingEntry, setMovingEntry] = useState<{ actionId: string; label: string } | null>(null)

  const toggleExpandedKeyRow = useCallback((actionId: string): void => {
    setExpandedKeyRows((current) => {
      const updated = new Set(current)
      if (updated.has(actionId)) updated.delete(actionId)
      else updated.add(actionId)
      return updated
    })
  }, [])

  /**
   * a deep link from the Aliases tab's owner column for a `generated` row - the
   * owning action always exists (`AliasesTab`'s index is built from `draft.actions` itself), so this
   * only has to find it, select its category and queue it to be focused once its
   * row renders. Runs once on mount only - see `ControlsTabProps.focusActionId`'s own doc comment
   * for why a nonce/re-trigger guard is unnecessary here.
   */
  useEffect(() => {
    if (!focusActionId) return
    const action = (draft.actions ?? []).find((candidate) => candidate.id === focusActionId)
    if (!action) return
    selectCategory(action.categoryId)
    setPendingFocusActionId(action.id)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- fires on the focus request only; the rows are read as of that moment.
  }, [focusActionId])

  /**
   * Applies the real DOM focus queued by the focus effect above, once the target row has actually
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

  /** the renderer prefers a category's `nameKey` (a still-unrenamed template
   * seed) over its stored `name`; a category the user has renamed, or one they typed themselves,
   * carries no `nameKey` and shows its stored prose verbatim. The rule itself (including the
   * fallback for a `nameKey` this build does not know) is
   * `lib/category-display.ts`, so it can be tested without mounting the tab. */
  const categoryDisplayName = (category: ConfigActionCategory): string =>
    resolveCategoryDisplayName(category, {
      t: (key) => t(key),
      exists: (key) => i18n.exists(key),
    })

  /**
   * what the grid is showing *right now*, which is `selectedCategoryId` except while
   * a spring-load has provisionally carried the drag into another category.
   *
   * `viewActions` is the entry list that provisional view is rendered from: the real `actions` with
   * the dragged row already re-homed into the spring-loaded category (`moveEntryToCategory`, which
   * appends it to the end of that category's run - exactly where the story says a cross-category
   * move lands). Nothing is persisted and nothing is patched into the draft: this array exists only
   * for the duration of the drag, so an Escape cancel simply drops `springCategoryId` and the
   * previous view is back, byte for byte. A drop that lands is applied to *this* array rather than
   * to `actions`, so one gesture is one move - the category change and the exact position it was
   * dropped at persist together, in a single save.
   */
  const viewCategoryId = springCategoryId ?? selectedCategoryId
  const viewActions = useMemo(
    () =>
      springCategoryId && draggingRowId
        ? moveEntryToCategory(actions, draggingRowId, springCategoryId)
        : actions,
    [actions, springCategoryId, draggingRowId],
  )
  const selectedCategory = categories.find((category) => category.id === viewCategoryId) ?? null
  const selectedCategoryLabel = selectedCategory ? categoryDisplayName(selectedCategory) : ''

  const editingAction = editingActionId
    ? (actions.find((action) => action.id === editingActionId) ?? null)
    : null
  /** the category `editingAction` actually belongs to, looked up from `categories`
   * rather than assumed to be `selectedCategory` - a dangling `categoryId` (its category deleted
   * out from under it) falls back to a no-subcategories stand-in so `ActionEditor` still opens,
   * just without a sub-category control to offer. */
  const editingActionCategory: ConfigActionCategory = editingAction
    ? (categories.find((category) => category.id === editingAction.categoryId) ?? {
        id: editingAction.categoryId,
        name: '',
      })
    : { id: '', name: '' }
  /** the drops row whose message modal is open, resolved out of `actions` on every
   * render rather than captured into state - the editor then always opens on the entry as it is
   * now, and an entry that disappeared under it (its category deleted) closes the modal instead of
   * editing a stale copy. */
  const messageEditorAction = messageEditorRow
    ? (actions.find((action) => action.id === messageEditorRow.actionId) ?? null)
    : null

  // one rule for every category - a row is one of the profile's own entries, in the
  // profile's own order, and no row is rendered for an entry the profile does not have.
  // the catalogue does not add rows (no lazy materialisation); it only says what an entry the profile already carries means
  // (`controls-row-entries.ts`).
  // built from the *view* (see `viewActions` above), so a spring-loaded drag renders
  // the target category with the dragged row already in it - it has to stay a live sortable item,
  // or there would be no exact position in that category to drop it at.
  // The filter is scoped to the active category by construction (it runs over that category's
  // rows only); move targets read their neighbours off the drawn groups, not the raw order.
  const {
    entries: rowEntries,
    filteredCount,
    groups: rowGroups,
    moveTargets,
    boundCount,
    rowState,
  } = useControlsRows(viewCategoryId, viewActions, selectedCategory?.subcategories, filterText)
  const entryActions = useControlsEntryActions({
    profileId: profile.id,
    categories,
    actions,
    patch,
    save: { saveNow, schedule },
    selectedCategoryId,
    selectedCategory,
    viewActions,
    springCategoryId,
    selectCategory,
    setShowCreateAction,
    setRenamingAction,
    setEditingActionId,
    setMovingEntry,
    setMessageEditorRow,
    setRevealedMessageRows,
  })
  const filterQuery = filterText.trim().toLowerCase()

  /**
   * Decision: dragging is off while the Controls filter narrows the list - a drop
   * between two *visible* rows has no defined array position among the hidden ones, and order is
   * array position. Every grip stays rendered and focusable, disabled with an
   * explaining tooltip (`DragHandle`), and the row menu keeps offering move up/down/"Move to…".
   */
  const dragDisabled = filterQuery.length > 0

  /** the rail's own order - the id-space a chip drop resolves an index within, and
   * (namespaced through `categoryDragId`) the chips' `SortableContext` item list. Derived from
   * `categories` rather than from `rowGroups`, which only ever covers the visible category. */
  const categoryOrder = categories.map((category) => category.id)

  /** Stable for the tab's lifetime; a fresh callback ref per render would churn `focusRowRefs`. */
  const setRowElement = useCallback((actionId: string, el: HTMLDivElement | null): void => {
    if (el) focusRowRefs.current.set(actionId, el)
    else focusRowRefs.current.delete(actionId)
  }, [])

  const rowHandlers = useMemo(
    () => ({
      onActionsChange: entryActions.persistActions,
      onReset: entryActions.resetAction,
      onToggleDropAmmo: entryActions.toggleDropAmmo,
      onToggleDropMessage: entryActions.toggleDropMessage,
      onMove: entryActions.moveAction,
      onRemove: entryActions.removeAction,
      onToggleExpanded: toggleExpandedKeyRow,
      onEditMessage: setMessageEditorRow,
      onMoveTo: setMovingEntry,
      onEdit: setEditingActionId,
      onRename: setRenamingAction,
      setRowElement,
    }),
    [entryActions, toggleExpandedKeyRow, setRowElement],
  )
  const editedActionIds = changeSet.keys.actions
  const entryRowContext = useMemo<ControlsEntryRowContext>(
    () => ({
      draft,
      conflictIndex,
      rowState,
      moveTargets,
      editedActionIds,
      revealedMessageRows,
      expandedKeyRows,
      unavailableReasonKey,
      ...rowHandlers,
    }),
    [
      draft,
      conflictIndex,
      rowState,
      moveTargets,
      editedActionIds,
      revealedMessageRows,
      expandedKeyRows,
      unavailableReasonKey,
      rowHandlers,
    ],
  )

  return (
    // 's ~1120px cap has to hold the whole tab body, not just the grid
    // - an ultrawide window otherwise stretches the category rail and toolbar full-width while the
    // grid caps underneath them, which reads as broken. `ControlsGrid`'s own `.ctrl-stage` still
    // caps the table itself (harmless redundancy, both centre on the same 1120px), but this outer
    // wrapper is what actually caps the category rail and the filter toolbar.
    <div className="ctrl-stage space-y-6">
      {/*
        exactly one `DndContext` for the whole tab, spanning the category rail *and*
        the grid - a row has to be draggable from the grid onto a chip in the rail, and one drag
        operation may only ever live in one context. `ControlsDragZone` renders no DOM of its own
        (see `SortableZone`), so wrapping both blocks here changes nothing structurally: the rail's
        chips and the grid's rows stay exactly the DOM children of `.ctrl-stage` they were.

        What a drop *means* is resolved there (dnd-kit ids -> "this row, before that one" /
        "onto that category" / "that header to index n"); applying it to the profile and persisting
        it stays here, through the same `persistCategoriesAndActions` every other reorder uses.
      */}
      <ControlsDragZone
        groups={rowGroups}
        disabled={dragDisabled}
        onReorderRow={entryActions.reorderRow}
        onDropOnCategory={entryActions.dropOnCategory}
        onReorderSubcategory={entryActions.reorderSubcategory}
        categoryOrder={categoryOrder}
        onReorderCategory={entryActions.reorderCategory}
        onDragStarted={handleDragStarted}
        onDragFinished={handleDragFinished}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>{t('config.controls.label')}</SectionLabel>
            {status !== 'idle' && (
              <span className="text-xs text-ink-muted">
                {status === 'saving' ? t('common.action.saving') : t('common.label.saved')}
              </span>
            )}
          </div>

          <ControlsCategoryRail
            ref={railRef}
            categories={categories}
            actions={actions}
            selectedCategoryId={selectedCategoryId}
            viewCategoryId={viewCategoryId}
            selectCategory={selectCategory}
            persist={entryActions.persistCategoriesAndActions}
            saving={saving}
            dragDisabled={dragDisabled}
            onSpringLoad={handleSpringLoad}
            categoryDisplayName={categoryDisplayName}
          />
        </div>

        {/*
        one grid for every category - `DualBindPanel`, `DropBindPanel` and the
        old bare `<ul>` collapse into `ControlsGrid`. the row components own the real slot surface and
        Options-cell content respectively - `ControlsEntryRow` wires
        today's `BindSlot`/CRUD affordances into the `ControlsRow` shell.

        every category, catalogue-backed or not, shows exactly its persisted entries
        (`rowEntries`) - the catalogue no longer contributes rows of its own, only what a row of the
        profile's means.

        hidden entirely while the profile has no categories - the empty state above
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
                {/* put the profile-wide conflict count in the header,
                not the footer (mirrors the prototype's toolbar: filter, conflict badge, Restore
                defaults, in that order) - `ControlsGrid` no longer renders this itself. */}
                {conflicts.length > 0 && (
                  <span className="ctrl-conflict-badge" role="status">
                    <TriangleAlert className="size-3.5" aria-hidden="true" />
                    {t('config.controls.grid.conflictCount', { count: conflicts.length })}
                  </span>
                )}
                {/* create is the one sub-category operation that has no group header of
                its own to sit on yet - mirrors "New category" living in the rail rather than on a
                category chip. Scoped to `selectedCategory` (disabled instead of hidden while none
                is selected, matching every other button in this toolbar). */}
                <Button
                  variant="neutral"
                  size="sm"
                  icon={<Plus className="size-3.5" />}
                  disabled={!selectedCategory}
                  onClick={() => railRef.current?.createSubcategory()}
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
            ) : filteredCount === 0 ? (
              // A filter that matches nothing in this category still needs an
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
                rowCount={filteredCount}
                boundCount={boundCount}
                renderRow={(entry, index, grip) => (
                  // Parity runs across the whole filtered row list, not per group - see
                  // `ControlsRow`'s doc comment for why this replaces CSS `:nth-of-type`.
                  <ControlsEntryRow
                    entry={entry}
                    odd={index % 2 === 0}
                    grip={grip}
                    ctx={entryRowContext}
                  />
                )}
                onRenameSubcategory={(subcategory) =>
                  railRef.current?.renameSubcategory(subcategory)
                }
                onMoveSubcategory={entryActions.moveSubcategoryByStep}
                onDeleteSubcategory={entryActions.deleteSubcategory}
                dragDisabled={dragDisabled}
              />
            )}
          </div>
        )}
      </ControlsDragZone>

      {showCreateAction && (
        <CreateActionDialog
          onClose={() => setShowCreateAction(false)}
          onSubmit={entryActions.createAction}
        />
      )}

      {renamingAction && (
        <RenameActionDialog
          action={renamingAction}
          actions={actions}
          binds={draft.binds}
          layers={layers}
          onClose={() => setRenamingAction(null)}
          onSubmit={(input) => entryActions.renameAction(renamingAction.id, input)}
        />
      )}

      {/* the row menu's "Move to…" - the keyboard path for a cross-category or
          cross-sub-category move. Gated on the entry still existing (it can be removed from under
          an open dialog), same rule `messageEditorAction` above already applies. */}
      {movingEntry && actions.some((action) => action.id === movingEntry.actionId) && (
        <MoveEntryDialog
          entryName={movingEntry.label}
          targets={entryPlacementOptions(categories, categoryDisplayName)}
          onClose={() => setMovingEntry(null)}
          onSubmit={(target) => entryActions.moveEntryTo(movingEntry.actionId, target)}
        />
      )}

      {editingAction && editingAction.kind === 'message' && (
        <MessageEditor
          action={editingAction}
          cvars={draft.cvars}
          onClose={() => setEditingActionId(null)}
          onSave={(draft) =>
            void entryActions.saveAction(
              withKeySlot(
                {
                  ...editingAction,
                  commands: [
                    {
                      kind: 'message',
                      channel: draft.channel as 'say' | 'say_team',
                      text: draft.text,
                    },
                  ],
                },
                0,
                // This editor has no modifier capture: carry the slot's existing modifier over
                // rather than turn an `Alt+F1` binding into a plain `F1`.
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
          onSave={(next) => void entryActions.saveAction(next)}
        />
      )}

      {/* A drops row opens the same rich editor a "Team messages" entry does
          - channel, macro bar, symbol picker, live preview - with key capture hidden, because a
          catalogue row's key belongs to the grid's `BindSlot`s and their collision/replace flow
          (a second, collision-blind key field here would regress ). The save
          merges through the same two write paths the message toggle uses, so only the row's own
          message command is added/replaced/removed: the `drop <item>` and ammo raw commands are
          carried over untouched. */}
      {messageEditorAction && messageEditorRow && (
        <MessageEditor
          action={messageEditorAction}
          cvars={draft.cvars}
          titleName={messageEditorRow.label}
          showKeyCapture={false}
          onClose={() => setMessageEditorRow(null)}
          onSave={(draft) =>
            entryActions.saveDropMessage(messageEditorAction, messageEditorRow, draft)
          }
        />
      )}
    </div>
  )
}
