import type { ConfigActionCategory } from '@shared/modules/config'

/**
 * How a category is named on screen (story 052 D1/D7).
 *
 * `name` is the ground truth: real prose, written into the profile and into the user's file. A
 * template seed and the migration additionally attach `nameKey`, a *display hint* naming the
 * translated label to prefer while the category still carries its default name; a rename drops it
 * (`ControlsTab#handleRenameCategory`). Main therefore never has to send prose across IPC
 * (CLAUDE.md) and the file still carries a real name.
 *
 * Story 052 review (finding 9): the hint is only trusted when the renderer actually has that key.
 * The persisted/IPC schema validates `nameKey` as a non-empty string, not as a key this build
 * knows, so a hint from an older build or a hand-edited `state.json` reaches here as an unknown
 * key - and i18next's missing-key handler returns the key itself (`i18n/index.ts`), which would
 * put `config.controls.categories.movement` in the rail where a name belongs. An unresolvable hint
 * falls back to the stored prose, which is exactly what that field exists for.
 */
export interface CategoryNameResolver {
  /** `i18next.t`, or any equivalent. Only called for a key `exists` accepted. */
  t: (key: string) => string
  /** `i18next.exists` - does this build's bundle actually carry the key. */
  exists: (key: string) => boolean
}

export function categoryDisplayName(
  category: ConfigActionCategory,
  { t, exists }: CategoryNameResolver,
): string {
  if (category.nameKey && exists(category.nameKey)) return t(category.nameKey)
  return category.name
}
