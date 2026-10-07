import { useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import { actionKeySlots } from '@shared/config/catalog/action-slots'
import { dropStateFor } from '@shared/config/aliases/drop-entries'
import type {
  ActionEntryKind,
  ConfigAction,
  ConfigActionCategory,
  ConfigProfile,
} from '@shared/modules/config'
import { updateProfileActions } from '../client'
import {
  applyAmmo,
  applyDropAmmo,
  applyDropMessage,
  applyMessage,
  applySlot,
  withCatalogBody,
  type CatalogRow,
} from './catalog-binds'
import {
  moveCategory,
  moveEntryToCategory,
  moveEntryToDropTarget,
  moveEntryToSubcategory,
  moveSubcategory,
  swapEntries,
  type EntryDropTarget,
  type EntryPlacementOption,
} from './entry-order'
import type { UseProfileDraftResult } from './useProfileDraft'
import type { UseProfileSaveResult } from './useProfileSave'

export interface MessageEditorRow {
  row?: CatalogRow
  actionId: string
  label: string
}

export interface UseControlsEntryActionsInput {
  profileId: string
  categories: ConfigActionCategory[]
  actions: ConfigAction[]
  patch: UseProfileDraftResult['patch']
  save: Pick<UseProfileSaveResult<ConfigProfile[]>, 'saveNow' | 'schedule'>
  selectedCategoryId: string
  selectedCategory: ConfigActionCategory | null
  /** The entry list the grid is drawing: `actions`, or the provisional spring-load view of it. */
  viewActions: ConfigAction[]
  springCategoryId: string | null
  selectCategory: (categoryId: string) => void
  setShowCreateAction: Dispatch<SetStateAction<boolean>>
  setRenamingAction: Dispatch<SetStateAction<ConfigAction | null>>
  setEditingActionId: Dispatch<SetStateAction<string | null>>
  setMovingEntry: Dispatch<SetStateAction<{ actionId: string; label: string } | null>>
  setMessageEditorRow: Dispatch<SetStateAction<MessageEditorRow | null>>
  setRevealedMessageRows: Dispatch<SetStateAction<ReadonlySet<string>>>
}

type Handlers = Record<string, (...args: never[]) => unknown>

/** An identity-stable object whose methods forward to the handlers of the latest render. */
function useLatestHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers)
  useLayoutEffect(() => {
    latest.current = handlers
  })
  return useMemo(() => {
    const stable: Handlers = {}
    for (const name of Object.keys(handlers)) {
      stable[name] = (...args: never[]) => (latest.current[name] as Handlers[string])(...args)
    }
    return stable as T
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the handler names are fixed for the hook's lifetime; only their bodies change per render.
  }, [])
}

/**
 * Every mutation the Controls tab applies to the draft's categories and actions. The handlers close
 * over the render they were built in; the returned object is identity-stable and always forwards to
 * the latest build, so rows memoised on it do not re-render when an unrelated draft edit lands.
 */
export function useControlsEntryActions(input: UseControlsEntryActionsInput) {
  const {
    profileId,
    categories,
    actions,
    patch,
    save,
    selectedCategoryId,
    selectedCategory,
    viewActions,
    springCategoryId,
    selectCategory,
  } = input

  // Cancels a debounced action save still pending: its payload was captured at schedule time, so
  // letting it fire after this write would revert whatever this write persists. Nothing is lost -
  // the debounced edit already patched the draft, only its round trip was delayed.
  const persistCategoriesAndActions = async (
    nextCategories: ConfigActionCategory[],
    nextActions: ConfigAction[],
  ): Promise<boolean> => {
    const ok = await save.saveNow({
      run: () =>
        updateProfileActions({ profileId, categories: nextCategories, actions: nextActions }),
    })
    if (ok) patch({ categories: nextCategories, actions: nextActions })
    return ok
  }

  const persistActions = (nextActions: ConfigAction[]): void => {
    void persistCategoriesAndActions(categories, nextActions)
  }

  const scheduleActionsSave = (nextActions: ConfigAction[]): void => {
    const before = actions
    save.schedule({
      apply: () => patch({ actions: nextActions }),
      // The shared draft survives a tab switch, so a refused save must not leave a phantom action in it.
      revert: () => patch({ actions: before }),
      run: () => updateProfileActions({ profileId, categories, actions: nextActions }),
    })
  }

  const renameAction = async (
    actionId: string,
    next: { name: string; aliasName: string | undefined },
  ): Promise<boolean> => {
    const ok = await persistCategoriesAndActions(
      categories,
      actions.map((action) =>
        action.id === actionId ? { ...action, name: next.name, aliasName: next.aliasName } : action,
      ),
    )
    if (ok) input.setRenamingAction(null)
    return ok
  }

  /** `commands` stays `[]`: a suggestion is unbound until a key is assigned (`withCatalogBody` fills the body then). */
  const createAction = (name: string, kind: ActionEntryKind, catalogId?: string): void => {
    const action: ConfigAction = {
      id: crypto.randomUUID(),
      categoryId: selectedCategoryId,
      name,
      kind,
      commands: [],
      ...(catalogId ? { catalogId } : {}),
      // Both payload schemas require exactly two parts for these kinds, so a fresh entry must seed them.
      ...(kind === 'toggle' || kind === 'press-release'
        ? { parts: [{ commands: [] }, { commands: [] }] }
        : {}),
    }
    scheduleActionsSave([...actions, action])
    input.setShowCreateAction(false)
  }

  const removeAction = (actionId: string): void => {
    scheduleActionsSave(actions.filter((action) => action.id !== actionId))
  }

  // The swap partner is named by the caller from the rendered groups: a neighbour picked out of the
  // raw array could sit in another catalogue group, a real mutation with nothing visibly moving.
  const moveAction = (actionId: string, targetId: string): void => {
    persistActions(swapEntries(actions, actionId, targetId))
  }

  /** The editors hand back the finished action; the tab stays the single owner of the save path. */
  const saveAction = async (next: ConfigAction): Promise<void> => {
    const ok = await persistCategoriesAndActions(
      categories,
      actions.map((action) => (action.id === next.id ? next : action)),
    )
    if (ok) input.setEditingActionId(null)
  }

  /**
   * Turning the toggle on only reveals the inline message row: an empty message is never stored, so
   * the "just turned on" state lives in `revealedMessageRows`. Turning it off clears the stored one.
   */
  const toggleDropMessage = (action: ConfigAction, next: boolean): void => {
    input.setRevealedMessageRows((current) => {
      const updated = new Set(current)
      if (next) updated.add(action.id)
      else updated.delete(action.id)
      return updated
    })
    if (next) return
    if ((dropStateFor(action).message ?? '').trim().length > 0) {
      persistActions(applyDropMessage(actions, action.id, false))
    }
  }

  // A catalogue row with no body yet has no `drop <item>` command for the surgical transform to
  // splice around, so it builds the body from the catalogue instead.
  const toggleDropAmmo = (action: ConfigAction, next: boolean, row?: CatalogRow): void => {
    if (row && action.commands.length === 0) {
      persistActions(applyAmmo(actions, action.id, row, next))
      return
    }
    persistActions(applyDropAmmo(actions, action.id, next))
  }

  // Clearing compacts the slot list, so clearing index 0 once per slot empties it without skipping.
  const resetAction = (actionId: string): void => {
    const action = actions.find((candidate) => candidate.id === actionId)
    const slotCount = action ? actionKeySlots(action).length : 0
    let nextActions = actions
    for (let i = 0; i < slotCount; i += 1) {
      nextActions = applySlot(nextActions, actionId, 0, undefined)
    }
    persistActions(nextActions)
  }

  const moveSubcategoryByStep = (subcategoryId: string, direction: 'up' | 'down'): void => {
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
    void persistCategoriesAndActions(
      categories.map((category) =>
        category.id === selectedCategory.id
          ? { ...category, subcategories: nextSubcategories }
          : category,
      ),
      actions,
    )
  }

  // The entries stay in the parent category; the id is omitted rather than set to `undefined` so no
  // dangling reference is left in the data.
  const deleteSubcategory = (subcategoryId: string): void => {
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

  // Applied to `viewActions` so a drop that follows a spring-load persists the category change and
  // the exact position in one save.
  const reorderRow = (drop: EntryDropTarget): void => {
    const nextActions = moveEntryToDropTarget(viewActions, drop)
    // Nothing resolved (a stale drop target) and no provisional category change to commit.
    if (nextActions === viewActions && viewActions === actions) return
    if (springCategoryId) selectCategory(springCategoryId)
    persistActions(nextActions)
  }

  // The tab deliberately does not follow the row: the user stays where they were working.
  const dropOnCategory = (actionId: string, targetCategoryId: string): void => {
    const action = actions.find((candidate) => candidate.id === actionId)
    if (!action || action.categoryId === targetCategoryId) return
    persistActions(moveEntryToCategory(viewActions, actionId, targetCategoryId))
  }

  const reorderSubcategory = (subcategoryId: string, toIndex: number): void => {
    if (!selectedCategory) return
    const nextCategory = moveSubcategory(selectedCategory, subcategoryId, toIndex)
    if (nextCategory === selectedCategory) return
    void persistCategoriesAndActions(
      categories.map((category) => (category.id === nextCategory.id ? nextCategory : category)),
      actions,
    )
  }

  const reorderCategory = (categoryId: string, toIndex: number): void => {
    const nextCategories = moveCategory(categories, categoryId, toIndex)
    if (nextCategories === categories) return
    void persistCategoriesAndActions(nextCategories, actions)
  }

  // The category move appends the entry to its new category's run; the sub-category move then
  // re-homes it in place (`before` names what follows it), so only `subcategoryId` changes.
  const moveEntryTo = async (actionId: string, target: EntryPlacementOption): Promise<boolean> => {
    const withCategory = moveEntryToCategory(actions, actionId, target.categoryId)
    const index = withCategory.findIndex((action) => action.id === actionId)
    if (index === -1) return false
    const nextActions =
      target.subcategoryId === undefined
        ? withCategory
        : moveEntryToSubcategory(
            withCategory,
            actionId,
            target.subcategoryId,
            withCategory[index + 1]?.id ?? 'end',
          )
    const ok = await persistCategoriesAndActions(categories, nextActions)
    if (ok) input.setMovingEntry(null)
    return ok
  }

  // An entry that already has a body is edited surgically so the message keeps its place in it;
  // only a body-less catalogue row gets its body minted from the catalogue, message appended.
  const saveDropMessage = (
    target: ConfigAction,
    editorRow: MessageEditorRow,
    next: { channel: string; text: string },
  ): void => {
    const bodyless = target.commands.length === 0
    const hasText = next.text.trim().length > 0
    const base =
      hasText && editorRow.row ? withCatalogBody(actions, target.id, editorRow.row) : actions
    const channel = next.channel as 'say' | 'say_team'
    persistActions(
      bodyless && editorRow.row
        ? applyMessage(base, target.id, next.text, channel)
        : hasText
          ? applyDropMessage(base, target.id, true, next.text, channel)
          : applyDropMessage(base, target.id, false),
    )
    input.setMessageEditorRow(null)
  }

  return useLatestHandlers({
    persistCategoriesAndActions,
    persistActions,
    renameAction,
    createAction,
    removeAction,
    moveAction,
    saveAction,
    toggleDropMessage,
    toggleDropAmmo,
    resetAction,
    moveSubcategoryByStep,
    deleteSubcategory,
    reorderRow,
    dropOnCategory,
    reorderSubcategory,
    reorderCategory,
    moveEntryTo,
    saveDropMessage,
  })
}
