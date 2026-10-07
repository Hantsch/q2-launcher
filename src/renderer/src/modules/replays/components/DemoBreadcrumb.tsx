import { useTranslation } from 'react-i18next'
import { useDroppable } from '@dnd-kit/core'
import type { FolderCrumb, FolderRef } from '@shared/replays/demo-folders'
import { Button } from '../../../components/ui/Button'
import { cn } from '../../../lib/cn'
import type { FolderDropData } from './DemoDragZone'

export interface DemoBreadcrumbProps {
  crumbs: FolderCrumb[]
  onOpen: (ref: FolderRef | null) => void
  onNewFolder: () => void
  /** i18n key of why a new folder can't be made here; shown as text next to the disabled button. */
  newFolderDisabledKey?: string
}

interface CrumbButtonProps {
  crumb: FolderCrumb
  last: boolean
  /** Only a crumb strictly between "All demos" and the current folder takes a dropped demo. */
  droppable: boolean
  onOpen: (ref: FolderRef | null) => void
}

function CrumbButton({ crumb, last, droppable, onOpen }: CrumbButtonProps) {
  const { t } = useTranslation()
  const ref = crumb.ref
  const dropData: FolderDropData | undefined = ref === null ? undefined : { ref }
  const { setNodeRef, isOver } = useDroppable({
    id: `crumb:${ref?.sourceKey ?? ''}:${ref?.path.join('/') ?? ''}`,
    ...(dropData ? { data: dropData } : {}),
    disabled: !droppable || ref === null,
  })
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid="replays-crumb"
      data-drop-over={isOver ? 'true' : undefined}
      aria-current={last ? 'page' : undefined}
      onClick={() => onOpen(ref)}
      className={cn(
        'min-h-6 rounded px-1.5 text-ink-dim hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-flame-500 aria-[current=page]:text-ink',
        isOver && 'bg-flame-900/20 text-ink outline-2 outline-flame-500',
      )}
    >
      {crumb.label ?? t('replays.folder.allDemos')}
      {isOver && <span className="ml-1.5 text-flame-500">{t('replays.folder.dropHere')}</span>}
    </button>
  )
}

/** The path of the open folder (first crumb the top level, last the current place) and the
 * New folder control; at the top level there is no path to show, only the control. */
export function DemoBreadcrumb({
  crumbs,
  onOpen,
  onNewFolder,
  newFolderDisabledKey,
}: DemoBreadcrumbProps) {
  const { t } = useTranslation()
  return (
    <div className="mb-2 flex items-center gap-2 text-xs">
      {crumbs.length > 1 && (
        <nav
          aria-label={t('replays.folder.breadcrumb')}
          data-testid="replays-breadcrumb"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
        >
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <span key={index} className="flex items-center gap-1">
                {index > 0 && (
                  <span aria-hidden="true" className="text-ink-muted">
                    ›
                  </span>
                )}
                <CrumbButton
                  crumb={crumb}
                  last={last}
                  droppable={index > 0 && !last}
                  onOpen={onOpen}
                />
              </span>
            )
          })}
        </nav>
      )}
      <span className="ml-auto flex items-center gap-2">
        {newFolderDisabledKey !== undefined && (
          <span className="text-ink-muted" data-testid="replays-folder-new-reason">
            {t(newFolderDisabledKey)}
          </span>
        )}
        <Button
          variant="neutral"
          size="sm"
          disabled={newFolderDisabledKey !== undefined}
          onClick={onNewFolder}
          data-testid="replays-folder-new"
        >
          {t('replays.folder.newFolder')}
        </Button>
      </span>
    </div>
  )
}
