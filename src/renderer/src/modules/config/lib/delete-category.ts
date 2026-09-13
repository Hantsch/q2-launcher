/**
 * What deleting a category does to `profile.categories`/`profile.actions` (story 052 D9).
 *
 * The category itself is always removed. Its entries either go with it (`choice: 'delete'`) or are
 * refiled under `targetCategoryId` (`choice: 'move'`, the story's own decision: "offer both delete
 * and move in the confirm dialog, default 'move'"). Pure, like every other `lib/*.ts` helper in this
 * module - `DeleteCategoryDialog` only decides *which* choice and target, `ControlsTab` (the single
 * owner of the draft, `persistCategoriesAndActions`) is the one that calls this and saves the result.
 */

import type { ConfigAction, ConfigActionCategory } from '@shared/modules/config'

export type DeleteCategoryChoice = 'delete' | 'move'

export function applyCategoryDeletion(
  categories: ConfigActionCategory[],
  actions: ConfigAction[],
  categoryId: string,
  choice: DeleteCategoryChoice,
  targetCategoryId?: string,
): { categories: ConfigActionCategory[]; actions: ConfigAction[] } {
  const nextCategories = categories.filter((category) => category.id !== categoryId)

  // Defensive fallback, not a real UI path: `DeleteCategoryDialog` only offers 'move' when at least
  // one other category exists to move into, so a 'move' with no target here would mean a caller
  // skipped that dialog's own guard - treat it like 'delete' rather than silently dropping the
  // category id off every one of its entries.
  if (choice === 'delete' || !targetCategoryId) {
    return {
      categories: nextCategories,
      actions: actions.filter((action) => action.categoryId !== categoryId),
    }
  }

  return {
    categories: nextCategories,
    actions: actions.map((action) =>
      action.categoryId === categoryId ? { ...action, categoryId: targetCategoryId } : action,
    ),
  }
}
