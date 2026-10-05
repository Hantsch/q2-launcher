import { useId, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useDroppable } from '@dnd-kit/core'
import type { FolderEntry } from '@shared/replays/demo-folders'
import { cn } from '../../../lib/cn'
import { DEMO_ROW_HEIGHT } from '../list-grid'
import type { FolderDropData } from './DemoDragZone'

export interface DemoFolderRowProps {
  folder: FolderEntry
  onOpen: (folder: FolderEntry) => void
  /** Absent on roots: a source's own folder can't be renamed. */
  onRename?: (folder: FolderEntry) => void
}

function FolderGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5 shrink-0 text-ink-dim"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    >
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.5h8.8A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  )
}

function RenameGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    </svg>
  )
}

/** One folder of the list: single click only focuses, Enter or double-click opens it. */
export function DemoFolderRow({ folder, onOpen, onRename }: DemoFolderRowProps) {
  const { t } = useTranslation()
  const reasonId = useId()
  const dropData: FolderDropData = { ref: folder.ref }
  const { setNodeRef, isOver } = useDroppable({
    id: `folder:${folder.ref.sourceKey}:${folder.ref.path.join('/')}`,
    data: dropData,
    disabled: folder.archive,
  })

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(folder)
    }
  }

  return (
    <div
      ref={setNodeRef}
      data-testid="replays-folder-row"
      data-drop-over={isOver ? 'true' : undefined}
      onDoubleClick={() => onOpen(folder)}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex w-full cursor-default items-center gap-3 border-b border-l-2 border-b-line/60 border-l-transparent pr-4 pl-3 text-xs text-ink-dim transition-colors duration-[--dur-fast] hover:bg-hover',
        isOver && 'bg-flame-900/20 outline-2 -outline-offset-2 outline-flame-500',
      )}
      style={{ height: DEMO_ROW_HEIGHT }}
    >
      {/* The focusable open area is a sibling of the rename button: a button inside a role="button"
          fails axe nested-interactive. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={folder.name}
        data-testid="replays-folder-open"
        className="flex h-full min-w-0 flex-1 items-center gap-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-flame-500"
      >
        <FolderGlyph />
        <span className="min-w-0 flex-1 truncate text-ink" data-testid="replays-folder-name">
          {folder.name}
        </span>
        {isOver && (
          <span className="shrink-0 text-flame-500" data-testid="replays-folder-drop-hint">
            {t('replays.folder.dropHere')}
          </span>
        )}
        {folder.archive && (
          <span
            id={reasonId}
            className="shrink-0 text-ink-muted"
            data-testid="replays-folder-archive"
          >
            {t('replays.folder.archive')}
          </span>
        )}
        <span className="shrink-0 tabular-nums" data-testid="replays-folder-count">
          {t('replays.folder.demoCount', { count: folder.demoCount })}
        </span>
      </div>
      {onRename !== undefined && folder.ref.path.length > 0 && (
        <button
          type="button"
          disabled={folder.archive}
          aria-label={t('replays.folder.rename')}
          aria-describedby={folder.archive ? reasonId : undefined}
          title={t('replays.folder.rename')}
          data-testid="replays-folder-rename"
          onClick={() => onRename(folder)}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className="flex size-6 shrink-0 items-center justify-center rounded text-ink-dim hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-flame-500 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <RenameGlyph />
        </button>
      )}
    </div>
  )
}
