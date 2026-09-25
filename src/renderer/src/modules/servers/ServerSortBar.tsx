import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp } from 'lucide-react'
import {
  SERVER_SORT_COLUMNS,
  type ServerListSort,
  type ServerSortColumn,
} from '@shared/servers/list-sort'
import { Button } from '../../components/ui/Button'

export interface ServerSortBarProps {
  sort: ServerListSort | undefined
  onSort: (column: ServerSortColumn) => void
}

/**
 * Story 119 D3: the servers list's sort controls - one button per `SERVER_SORT_COLUMNS` entry,
 * plus a visible "current sort" line (never colour-only: the active column also carries an
 * asc/desc arrow icon). `sortServerRows`/`nextSort` (`@shared/servers/list-sort`) do the actual
 * ordering/cycling - this component only renders the current state and reports a click.
 */
export function ServerSortBar({ sort, onSort }: ServerSortBarProps) {
  const { t } = useTranslation()

  const currentLine =
    sort === undefined
      ? t('servers.sort.current.default')
      : t('servers.sort.current.column', {
          column: t(`servers.sort.column.${sort.column}`),
          direction: t(`servers.sort.direction.${sort.direction}`),
        })

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {SERVER_SORT_COLUMNS.map((column) => {
          const isActive = sort?.column === column
          return (
            <Button
              key={column}
              variant="neutral"
              onClick={() => onSort(column)}
              aria-pressed={isActive}
              data-testid={`servers-sort-${column}`}
            >
              {t(`servers.sort.column.${column}`)}
              {isActive &&
                (sort?.direction === 'asc' ? (
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                ) : (
                  <ArrowDown className="size-3.5" aria-hidden="true" />
                ))}
            </Button>
          )
        })}
      </div>
      <span className="text-xs text-ink-muted" data-testid="servers-sort-current">
        {currentLine}
      </span>
    </div>
  )
}
