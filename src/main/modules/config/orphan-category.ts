import type { ConfigAction, ConfigProfile } from '@shared/modules/config'

type ConfigCategory = NonNullable<ConfigProfile['categories']>[number]

/**
 * True when a save would introduce an action whose category the profile does not have.
 *
 * An action already stored under the same id and the same `categoryId` is grandfathered: restore
 * and import produce such "Other" entries, and a profile with `categories: []` must stay saveable.
 * Moving an action into a missing category, or adding one there, is what is refused.
 */
export function introducesOrphanCategory(
  stored: readonly ConfigAction[],
  actions: readonly ConfigAction[],
  categories: readonly ConfigCategory[],
): boolean {
  const known = new Set(categories.map((category) => category.id))
  return actions.some(
    (action) =>
      !known.has(action.categoryId) &&
      !stored.some((s) => s.id === action.id && s.categoryId === action.categoryId),
  )
}
