import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp } from 'lucide-react'
import {
  SERVER_SORT_COLUMNS,
  type ServerListSort,
  type ServerSortColumn,
} from '@shared/servers/list-sort'
import { cn } from '../../lib/cn'
import { SERVER_LIST_GRID } from './list-grid'

export interface ServerListHeaderProps {
  sort: ServerListSort | undefined
  onSort: (column: ServerSortColumn) => void
}

/**
 * The servers list's sticky column header - one sortable button per `SERVER_SORT_COLUMNS` entry,
 * laid out on the same `SERVER_LIST_GRID` template as every `ServerRow` so each label sits over
 * its column. The active column carries an asc/desc arrow (never colour-only). `nextSort`/
 * `sortServerRows` (`@shared/servers/list-sort`) do the actual cycling/ordering - this only renders
 * the current state and reports a click. The "current sort" caption (`servers-sort-current`) lives
 * in `ServersView`'s status line, next to the scan status it belongs with.
 */
export function ServerListHeader({ sort, onSort }: ServerListHeaderProps) {
  const { t } = useTranslation()

  return (
    <div
      role="row"
      className={cn(
        SERVER_LIST_GRID,
        'sticky top-0 z-10 h-9 border-b border-l-transparent border-b-line bg-panel',
      )}
    >
      {SERVER_SORT_COLUMNS.map((column, index) => {
        const isActive = sort?.column === column
        const button = (
          <button
            type="button"
            onClick={() => onSort(column)}
            aria-pressed={isActive}
            data-testid={`servers-sort-${column}`}
            className={cn(
              'stencil flex h-9 items-center gap-1 transition-colors duration-[--dur-fast] hover:text-ink',
              index === 0 ? 'justify-start' : 'justify-end',
              isActive && 'text-flame-300',
            )}
          >
            {t(`servers.list.column.${column}`)}
            {isActive &&
              (sort?.direction === 'asc' ? (
                <ArrowUp className="size-3" aria-hidden="true" />
              ) : (
                <ArrowDown className="size-3" aria-hidden="true" />
              ))}
          </button>
        )
        // The copy-address action column right after `name` has no sortable data of its own, so it
        // gets a blank header cell rather than a sort button.
        return index === 0 ? (
          <Fragment key={column}>
            {button}
            <span aria-hidden="true" />
          </Fragment>
        ) : (
          <Fragment key={column}>{button}</Fragment>
        )
      })}
    </div>
  )
}
