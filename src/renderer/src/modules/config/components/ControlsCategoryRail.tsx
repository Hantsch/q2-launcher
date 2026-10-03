import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks, Plus } from 'lucide-react'
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import {
  STANDARD_TEMPLATE,
  TEMPLATE_ACTION_CATEGORIES,
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigActionSubcategory,
} from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/primitives'
import { DragHandle, SortableItem } from '../../../components/dnd'
import { applyCategoryDeletion, type DeleteCategoryChoice } from '../lib/delete-category'
import { CategoryDropTarget, categoryDragId } from './ControlsDragZone'
import { ControlsCategoryMenu } from './ControlsCategoryMenu'
import { CreateCategoryDialog } from './CreateCategoryDialog'
import { CreateSubcategoryDialog } from './CreateSubcategoryDialog'
import { DeleteCategoryDialog } from './DeleteCategoryDialog'
import { RenameCategoryDialog } from './RenameCategoryDialog'
import { RenameSubcategoryDialog } from './RenameSubcategoryDialog'

/** What the tab's toolbar and the grid's group headers can ask the rail to open. */
export interface ControlsCategoryRailHandle {
  createSubcategory: () => void
  renameSubcategory: (subcategory: ConfigActionSubcategory) => void
}

export interface ControlsCategoryRailProps {
  categories: ConfigActionCategory[]
  actions: ConfigAction[]
  selectedCategoryId: string
  /** The category the grid is showing right now - differs from the selection during a spring-load. */
  viewCategoryId: string
  /** The only way the selection changes, so the tab can reset its filter alongside. */
  selectCategory: (categoryId: string) => void
  persist: (nextCategories: ConfigActionCategory[], nextActions: ConfigAction[]) => Promise<boolean>
  saving: boolean
  dragDisabled: boolean
  onSpringLoad: ComponentProps<typeof CategoryDropTarget>['onSpringLoad']
  categoryDisplayName: (category: ConfigActionCategory) => string
  ref?: Ref<ControlsCategoryRailHandle>
}

/**
 * The category chip rail (or the empty state while the profile has no categories) and every dialog
 * that edits categories or the sub-categories of the viewed category. It renders inside the tab's
 * single `DndContext`: a row dragged from the grid has to land on a chip in the same context.
 */
export function ControlsCategoryRail({
  categories,
  actions,
  selectedCategoryId,
  viewCategoryId,
  selectCategory,
  persist,
  saving,
  dragDisabled,
  onSpringLoad,
  categoryDisplayName,
  ref,
}: ControlsCategoryRailProps) {
  const { t } = useTranslation()
  const categoryChipRefs = useRef(new Map<string, HTMLElement>())
  const [showCreateCategory, setShowCreateCategory] = useState(false)
  const [renamingCategory, setRenamingCategory] = useState<ConfigActionCategory | null>(null)
  const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<string | null>(null)
  // A category with entries asks delete-or-move; an empty one only needs the inline confirm.
  const [deletingCategory, setDeletingCategory] = useState<ConfigActionCategory | null>(null)
  const [showCreateSubcategory, setShowCreateSubcategory] = useState(false)
  const [renamingSubcategory, setRenamingSubcategory] = useState<ConfigActionSubcategory | null>(
    null,
  )

  useImperativeHandle(ref, () => ({
    createSubcategory: () => setShowCreateSubcategory(true),
    renameSubcategory: setRenamingSubcategory,
  }))

  // 'nearest' moves the rail only when the chip is outside the visible area.
  useEffect(() => {
    categoryChipRefs.current
      .get(selectedCategoryId)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedCategoryId])

  const viewedCategory = categories.find((category) => category.id === viewCategoryId) ?? null
  const categoryDragIds = categories.map((category) => categoryDragId(category.id))

  // A template category keeps the template's own id and nameKey so catalogue suggestions filed
  // under it line up with `row.categoryId`; the free-form path mints a fresh id.
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
    const ok = await persist([...categories, category], actions)
    if (ok) {
      setShowCreateCategory(false)
      selectCategory(category.id)
    }
    return ok
  }

  const handleRenameCategory = async (categoryId: string, name: string): Promise<boolean> => {
    // Rebuilt from id/name only: a rename drops the `nameKey` a template seed attached.
    const nextCategories = categories.map((category) =>
      category.id === categoryId ? { id: category.id, name } : category,
    )
    const ok = await persist(nextCategories, actions)
    if (ok) setRenamingCategory(null)
    return ok
  }

  const handleDeleteCategory = async (categoryId: string): Promise<void> => {
    const nextCategories = categories.filter((category) => category.id !== categoryId)
    const nextActions = actions.filter((action) => action.categoryId !== categoryId)
    const ok = await persist(nextCategories, nextActions)
    if (ok) {
      setPendingDeleteCategoryId(null)
      if (categoryId === selectedCategoryId) selectCategory(nextCategories[0]?.id ?? '')
    }
  }

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
    const ok = await persist(nextCategories, nextActions)
    if (ok) {
      setDeletingCategory(null)
      if (categoryId === selectedCategoryId) selectCategory(nextCategories[0]?.id ?? '')
    }
  }

  const handleMoveCategory = (categoryId: string, direction: 'up' | 'down'): void => {
    const index = categories.findIndex((category) => category.id === categoryId)
    if (index === -1) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= categories.length) return
    const nextCategories = [...categories]
    const moved = nextCategories[index]!
    nextCategories[index] = nextCategories[targetIndex]!
    nextCategories[targetIndex] = moved
    void persist(nextCategories, actions)
  }

  // Only offered while the profile has no categories, so the template's fixed ids cannot collide.
  const handleAddStandardTemplate = async (): Promise<void> => {
    const nextCategories = STANDARD_TEMPLATE.categories.map((category) => ({ ...category }))
    const nextActions = STANDARD_TEMPLATE.actions.map((action) => ({
      ...action,
      id: crypto.randomUUID(),
      commands: action.commands.map((command) => ({ ...command })),
    }))
    const ok = await persist(nextCategories, nextActions)
    if (ok) selectCategory(nextCategories[0]?.id ?? '')
  }

  const handleCreateSubcategory = async (name: string): Promise<boolean> => {
    if (!viewedCategory) return false
    const subcategory: ConfigActionSubcategory = { id: crypto.randomUUID(), name }
    const nextCategories = categories.map((category) =>
      category.id === viewedCategory.id
        ? { ...category, subcategories: [...(category.subcategories ?? []), subcategory] }
        : category,
    )
    const ok = await persist(nextCategories, actions)
    if (ok) setShowCreateSubcategory(false)
    return ok
  }

  const handleRenameSubcategory = async (subcategoryId: string, name: string): Promise<boolean> => {
    if (!viewedCategory) return false
    const nextCategories = categories.map((category) =>
      category.id === viewedCategory.id
        ? {
            ...category,
            subcategories: (category.subcategories ?? []).map((subcategory) =>
              subcategory.id === subcategoryId ? { ...subcategory, name } : subcategory,
            ),
          }
        : category,
    )
    const ok = await persist(nextCategories, actions)
    if (ok) setRenamingSubcategory(null)
    return ok
  }

  return (
    <>
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
        <div className="ctrl-category-rail">
          {/*
            The rail is its own horizontal sortable axis with its own id space (`categoryDragId`),
            so a chip drag never resolves to a row nor to the chip's drop id (a row dropped on it).
            It needs its own `SortableContext` because the enclosing one lists the grid's row ids.
            "+ New category" is a plain sibling, not a sortable item.
          */}
          <SortableContext items={categoryDragIds} strategy={horizontalListSortingStrategy}>
            {categories.map((category, index) => {
              const isPendingDelete = pendingDeleteCategoryId === category.id
              const categoryLabel = categoryDisplayName(category)
              const isSelected = selectedCategoryId === category.id
              return (
                <SortableItem
                  key={category.id}
                  id={categoryDragId(category.id)}
                  data={{ label: categoryLabel }}
                >
                  {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                    <CategoryDropTarget
                      categoryId={category.id}
                      label={categoryLabel}
                      style={style}
                      // One DOM node, three roles: the chip, the drop target for a dragged row and the
                      // sortable item the rail reorders; the scroll map keeps the same node.
                      elementRef={(el) => {
                        setNodeRef(el)
                        if (el) categoryChipRefs.current.set(category.id, el as HTMLElement)
                        else categoryChipRefs.current.delete(category.id)
                      }}
                      onSpringLoad={onSpringLoad}
                      // Nothing to spring-load to: this category's grid is already the one on screen.
                      springLoadDisabled={category.id === viewCategoryId}
                      selected={isSelected}
                      className={[
                        // Layout only: the chip's border/background and selected state are
                        // `.ctrl-category-chip`'s, so no utility here can grow a second box.
                        'ctrl-category-chip flex shrink-0 items-center gap-1.5 px-1.5 py-1',
                        isDragging && 'is-dragging',
                      ]
                        .filter((part): part is string => Boolean(part))
                        .join(' ')}
                    >
                      <DragHandle
                        className="ctrl-grip-handle"
                        attributes={attributes}
                        listeners={listeners}
                        disabled={dragDisabled}
                        disabledReason={t('config.controls.grid.gripFilterActive')}
                      />
                      {/* Not a `tablist`: the "+ New category" button and the kebab beside a chip
                          are not tabs (axe: aria-required-children). Selection is conveyed by
                          `aria-pressed`, the accent marker and the semibold label - a non-colour
                          channel, so it stays readable when the tint is not perceived. */}
                      {isSelected && <span aria-hidden="true" className="ctrl-chip-marker" />}
                      <Button
                        aria-pressed={isSelected}
                        variant="ghost"
                        size="sm"
                        onClick={() => selectCategory(category.id)}
                      >
                        {/* The weight sits on an inner span: `Button` already emits
                            `font-medium`/`text-ink-dim`, and conflicting utilities on one element
                            resolve by stylesheet order (no tailwind-merge here). */}
                        <span className={isSelected ? 'font-semibold text-ink' : undefined}>
                          {categoryLabel}
                        </span>
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
                            {t('common.action.cancel')}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={saving}
                            onClick={() => void handleDeleteCategory(category.id)}
                          >
                            {t('common.action.confirmDelete')}
                          </Button>
                        </>
                      ) : (
                        <ControlsCategoryMenu
                          className="ctrl-chip-kebab"
                          categoryName={categoryLabel}
                          canMoveUp={index !== 0}
                          canMoveDown={index !== categories.length - 1}
                          onMoveUp={() => handleMoveCategory(category.id, 'up')}
                          onMoveDown={() => handleMoveCategory(category.id, 'down')}
                          onRename={() => setRenamingCategory(category)}
                          onDelete={() => {
                            const hasEntries = actions.some(
                              (candidate) => candidate.categoryId === category.id,
                            )
                            if (hasEntries) setDeletingCategory(category)
                            else setPendingDeleteCategoryId(category.id)
                          }}
                        />
                      )}
                    </CategoryDropTarget>
                  )}
                </SortableItem>
              )
            })}
          </SortableContext>

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

      {showCreateSubcategory && viewedCategory && (
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
    </>
  )
}
