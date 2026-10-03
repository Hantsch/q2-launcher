import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp } from 'lucide-react'
import {
  DEMO_SORT_COLUMNS,
  type DemoListSort,
  type DemoSortColumn,
} from '@shared/replays/list-sort'
import { cn } from '../../../lib/cn'
import { DEMO_LIST_GRID } from '../list-grid'

export interface DemoListHeaderProps {
  sort: DemoListSort | null
  onSort: (column: DemoSortColumn) => void
}

/**
 * The demos list's sticky column header - one sort button per data column on the same
 * `DEMO_LIST_GRID` template as every `DemoRow`, so each label sits over its column. Mirrors
 * `../../servers/ServerListHeader.tsx`'s shape: `name` stays a plain unsortable label, every other
 * cell is a button carrying `aria-pressed` and an asc/desc arrow (never colour-only) on the active
 * column. Story 152 D3: turns the previously-static header (150/151) sortable.
 */
export function DemoListHeader({ sort, onSort }: DemoListHeaderProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        DEMO_LIST_GRID,
        'sticky top-0 z-10 h-9 border-b border-l-transparent border-b-line bg-panel',
      )}
    >
      <span className="stencil flex h-9 items-center justify-start">
        {t('common.label.demo')}
      </span>
      {DEMO_SORT_COLUMNS.map((column) => {
        const isActive = sort?.column === column
        return (
          <button
            key={column}
            type="button"
            onClick={() => onSort(column)}
            aria-pressed={isActive}
            data-testid={`replays-sort-${column}`}
            className={cn(
              'stencil flex h-9 items-center justify-end gap-1 text-right transition-colors duration-[--dur-fast] hover:text-ink',
              isActive && 'text-flame-300',
            )}
          >
            {t(`replays.sort.column.${column}`)}
            {isActive && sort && (
              <>
                {sort.direction === 'asc' ? (
                  <ArrowUp className="size-3" aria-hidden="true" />
                ) : (
                  <ArrowDown className="size-3" aria-hidden="true" />
                )}
                <span className="sr-only" data-testid="replays-sort-direction">
                  {t(`replays.sort.direction.${sort.direction}`)}
                </span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
