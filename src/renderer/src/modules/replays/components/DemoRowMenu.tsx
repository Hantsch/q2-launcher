import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow } from '@shared/modules/replays'
import type { FolderEntry } from '@shared/replays/demo-folders'
import { Menu, type MenuItem } from '../../../components/ui/Menu'
import { toastOutcomeError, toastRefusal } from '../../../lib/toast'
import { useLauncher } from '../../../store/useLauncher'
import { copyDemoPath, revealDemo } from '../client'
import type { MenuPoint } from '../row-menu'

/** What the menu is about: one demo, the selection it belongs to, or a folder row. */
export type RowMenuTarget =
  | { kind: 'demo'; demo: DemoRow; selection: readonly DemoRow[] }
  | { kind: 'folder'; folder: FolderEntry }

export interface RowMenuActions {
  onRename: (demo: DemoRow) => void
  onMove: (ids: string[]) => void
  onDelete: (ids: string[]) => void
  onTag: (ids: string[]) => void
  onRenameFolder: (folder: FolderEntry) => void
  onDeleteFolder: (folder: FolderEntry) => void
}

export interface DemoRowMenuProps {
  at: MenuPoint
  target: RowMenuTarget
  actions: RowMenuActions
  onClose: () => void
}

function OpenOnMount({ toggle }: { toggle: () => void }) {
  const toggleRef = useRef(toggle)
  useEffect(() => toggleRef.current(), [])
  return null
}

/**
 * The context menu of a demo-list row, opened at a point through the `Menu` primitive with an
 * invisible one-pixel trigger there. Items that cannot work stay listed, disabled, with the reason
 * as visible text.
 */
export function DemoRowMenu({ at, target, actions, onClose }: DemoRowMenuProps) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const returnFocusTo = useRef<Element | null>(document.activeElement)

  const items = useMemo((): MenuItem[] => {
    if (target.kind === 'folder') {
      const { folder } = target
      const isRoot = folder.ref.path.length === 0
      const locked = isRoot || folder.archive
      const hintFor = (rootKey: string): { hint: string } | Record<string, never> =>
        isRoot
          ? { hint: t(rootKey) }
          : folder.archive
            ? { hint: t('replays.folder.error.archive') }
            : {}
      return [
        {
          id: 'rename-folder',
          label: t('replays.folder.rename'),
          disabled: locked,
          ...hintFor('replays.folder.error.root'),
          onSelect: () => actions.onRenameFolder(folder),
        },
        {
          id: 'delete-folder',
          label: t('replays.folder.delete.action'),
          disabled: locked,
          ...hintFor('replays.folder.error.isRoot'),
          onSelect: () => actions.onDeleteFolder(folder),
        },
      ]
    }

    const { demo, selection } = target
    if (selection.length > 1) {
      const ids = selection.filter((row) => row.archiveEntry === null).map((row) => row.id)
      const zipCount = selection.length - ids.length
      const none = ids.length === 0
      const hint = none ? t('replays.bulk.zipSkipped', { count: zipCount }) : undefined
      const extra = hint === undefined ? {} : { hint }
      return [
        {
          id: 'delete',
          label: t('replays.bulk.action.deleteMenu', { count: selection.length }),
          disabled: none,
          ...extra,
          onSelect: () => actions.onDelete(selection.map((row) => row.id)),
        },
        {
          id: 'tag',
          label: t('replays.bulk.action.tag'),
          disabled: none,
          onSelect: () => actions.onTag(selection.map((row) => row.id)),
        },
        {
          id: 'move',
          label: t('replays.bulk.action.moveMenu', { count: selection.length }),
          disabled: none,
          onSelect: () => actions.onMove(selection.map((row) => row.id)),
        },
      ]
    }

    const archived = demo.archiveEntry !== null
    const readOnly = archived ? { hint: t('replays.archive.readOnly.change') } : {}
    return [
      {
        id: 'reveal',
        label: t('replays.fileActions.reveal'),
        onSelect: () => {
          void revealDemo(demo.id).then((result) => {
            if (!result.ok) toastOutcomeError(pushToast, result)
            else if (!result.value.ok) toastRefusal(pushToast, result.value)
          })
        },
      },
      {
        id: 'copy-path',
        label: t('replays.fileActions.copyPath'),
        onSelect: () => {
          void copyDemoPath(demo.id).then((result) => {
            if (!result.ok) toastOutcomeError(pushToast, result)
            else if (!result.value.ok) toastRefusal(pushToast, result.value)
            else {
              pushToast({
                level: 'success',
                messageKey: 'replays.fileActions.pathCopied',
                timeoutMs: 4000,
              })
            }
          })
        },
      },
      {
        id: 'rename',
        label: t('replays.rename.title'),
        disabled: archived,
        ...(archived ? { hint: t('replays.archive.readOnly.rename') } : {}),
        onSelect: () => actions.onRename(demo),
      },
      {
        id: 'move',
        label: t('replays.fileActions.move'),
        disabled: archived,
        ...readOnly,
        onSelect: () => actions.onMove([demo.id]),
      },
      {
        id: 'delete',
        label: t('common.action.deleteEllipsis'),
        disabled: archived,
        ...readOnly,
        onSelect: () => actions.onDelete([demo.id]),
      },
    ]
  }, [target, actions, t, pushToast])

  function handleClose(): void {
    onClose()
    const previous = returnFocusTo.current
    // Focus returns to the row only if the action did not move it somewhere else (a dialog).
    window.setTimeout(() => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        if (document.activeElement === document.body) previous.focus()
      }
    }, 0)
  }

  return (
    <Menu
      items={items}
      label={t('replays.rowMenu.label')}
      side="below"
      focusOnOpen
      onClose={handleClose}
    >
      {({ toggle }) => (
        <>
          <span
            aria-hidden="true"
            style={{ position: 'fixed', left: at.x, top: at.y, width: 1, height: 1 }}
          />
          <OpenOnMount toggle={toggle} />
        </>
      )}
    </Menu>
  )
}
