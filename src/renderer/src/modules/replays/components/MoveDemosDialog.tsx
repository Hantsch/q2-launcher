import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder } from 'lucide-react'
import { isInArchive, type DiscoveredFolder, type FolderRef } from '@shared/replays/demo-folders'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { cn } from '../../../lib/cn'

export type MoveTarget = { kind: 'folder'; folderId: FolderRef } | { kind: 'pick' }

interface FolderOption {
  ref: FolderRef
  label: string
  depth: number
  isCurrent: boolean
}

const refKey = (ref: FolderRef): string => `${ref.sourceKey}|${ref.path.join('/')}`

/** Every writable folder, source by source in the order the scan reported its roots, each source's
 * folders in tree order (a parent right before its children). */
function folderOptions(folders: readonly DiscoveredFolder[], current: FolderRef | null) {
  const all = [...folders]
  const writable = all.filter((folder) => !isInArchive(folder, all))
  const sources = [...new Set(writable.map((folder) => folder.sourceKey))]
  const options: FolderOption[] = []
  for (const sourceKey of sources) {
    const own = writable
      .filter((folder) => folder.sourceKey === sourceKey)
      .sort((a, b) => a.path.join('/').localeCompare(b.path.join('/')))
    for (const folder of own) {
      const ref = { sourceKey, path: folder.path }
      options.push({
        ref,
        label: folder.path.length === 0 ? (folder.source ?? sourceKey) : folder.path.at(-1)!,
        depth: folder.path.length,
        isCurrent: current !== null && refKey(current) === refKey(ref),
      })
    }
  }
  return options
}

export interface MoveDemosDialogProps {
  /** Every scanned demo folder, roots labelled for display in `source`. */
  folders: readonly DiscoveredFolder[]
  /** The folder the list shows now; marked in the tree. */
  current: FolderRef | null
  count: number
  onMove: (target: MoveTarget) => void
  onClose: () => void
}

/** Chooses where the demos go: one of the scanned folders, or any folder through the OS dialog. */
export function MoveDemosDialog({
  folders,
  current,
  count,
  onMove,
  onClose,
}: MoveDemosDialogProps) {
  const { t } = useTranslation()
  const options = useMemo(() => folderOptions(folders, current), [folders, current])
  return (
    <Modal
      open
      size="md"
      title={t('replays.bulk.move.title', { count })}
      onClose={onClose}
      closeLabel={t('common.action.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-testid="replays-bulk-move-cancel">
            {t('common.action.cancel')}
          </Button>
          <Button onClick={() => onMove({ kind: 'pick' })} data-testid="replays-bulk-move-pick">
            {t('replays.bulk.move.pick')}
          </Button>
        </>
      }
    >
      <ul className="max-h-80 space-y-0.5 overflow-y-auto" data-testid="replays-bulk-move-folders">
        {options.map((option) => (
          <li key={refKey(option.ref)}>
            <button
              type="button"
              aria-current={option.isCurrent ? 'true' : undefined}
              style={{ paddingLeft: `${0.5 + option.depth}rem` }}
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-sm pr-2 text-left text-sm text-ink',
                'hover:bg-hover focus-visible:outline-2 focus-visible:outline-flame-600',
                option.isCurrent && 'bg-active',
              )}
              onClick={() => onMove({ kind: 'folder', folderId: option.ref })}
              data-testid="replays-bulk-move-folder"
              data-path={option.ref.path.join('/')}
            >
              <Folder className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="truncate">{option.label}</span>
              {option.isCurrent && (
                <span className="ml-auto text-xs text-ink-muted">
                  {t('replays.bulk.move.current')}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
