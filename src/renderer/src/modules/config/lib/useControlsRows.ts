import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { actionKeySlots } from '@shared/config/catalog/action-slots'
import type { ConfigAction, ConfigActionSubcategory } from '@shared/modules/config'
import { deriveRowState, type RowState } from './catalog-binds'
import {
  buildControlsRowEntries,
  rawCommandText,
  type ControlsRowEntry,
} from './controls-row-entries'
import { groupControlsRowEntries } from './controls-row-groups'
import { buildMoveTargets } from './entry-order'

export interface ControlsRows {
  /** The category's rows before the filter - the catalogue the row state is derived over. */
  entries: ControlsRowEntry[]
  filteredCount: number
  groups: ReturnType<typeof groupControlsRowEntries>
  moveTargets: ReturnType<typeof buildMoveTargets>
  /** Bound rows among the filtered ones; follows the filter, unlike a profile-wide scan. */
  boundCount: number
  /** Keyed by action id; present for catalogue entries only. */
  rowState: Map<string, RowState>
}

const NO_SUBCATEGORIES: ConfigActionSubcategory[] = []

/** A hit on either the name or the command text surfaces the row, within the category only. */
function matchesFilter(
  entry: ControlsRowEntry,
  query: string,
  t: (key: string) => string,
): boolean {
  const name = entry.kind === 'catalog' ? t(entry.labelKey) : entry.action.name
  const command =
    entry.kind === 'catalog' ? entry.row.commands.join(', ') : (rawCommandText(entry.action) ?? '')
  return name.toLowerCase().includes(query) || command.toLowerCase().includes(query)
}

/** Everything the Controls grid derives from the profile's actions, in one memoised pass. */
export function useControlsRows(
  categoryId: string,
  actions: ConfigAction[],
  subcategories: ConfigActionSubcategory[] | undefined,
  filterText: string,
): ControlsRows {
  const { t } = useTranslation()
  return useMemo(() => {
    const subs = subcategories ?? NO_SUBCATEGORIES
    const entries = buildControlsRowEntries(categoryId, actions)
    const rowState = new Map<string, RowState>()
    for (const entry of entries) {
      if (entry.kind === 'catalog')
        rowState.set(entry.action.id, deriveRowState(entry.action, entry.row))
    }
    const query = filterText.trim().toLowerCase()
    const filtered = query ? entries.filter((entry) => matchesFilter(entry, query, t)) : entries
    const groups = groupControlsRowEntries(filtered, subs)
    const boundCount = filtered.filter((entry) =>
      entry.kind === 'catalog'
        ? (rowState.get(entry.action.id)?.keys.some((slot) => Boolean(slot.key)) ?? false)
        : actionKeySlots(entry.action).some((slot) => slot.key.trim().length > 0),
    ).length
    return {
      entries,
      filteredCount: filtered.length,
      groups,
      moveTargets: buildMoveTargets(groups),
      boundCount,
      rowState,
    }
  }, [categoryId, actions, subcategories, filterText, t])
}
