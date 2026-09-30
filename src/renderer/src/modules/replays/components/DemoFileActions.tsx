import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DemoRow } from '@shared/modules/replays'
import type { LocalizedMessage } from '@shared/types'
import { useLauncher } from '../../../store/useLauncher'
import { Copy, FilePen, FolderOpen } from 'lucide-react'
import { IconButton } from '../../../components/ui/Button'
import { copyDemoPath, revealDemo } from '../client'
import { RenameDemoDialog } from '../RenameDemoDialog'

export interface DemoFileActionsProps {
  demo: DemoRow
  onRenamed: (oldId: string, newRow: DemoRow) => void
}

/** One failed file action's message: either one of this module's own two i18n keys (a domain
 * refusal - `fileMissing`/`unknownDemo`), or a transport-level `LocalizedMessage` rendered
 * verbatim, same convention as `ReplaysSettingsSection.tsx`'s `error` state. */
type FileActionError = { kind: 'domain'; key: string } | { kind: 'transport'; message: LocalizedMessage }

/**
 * Story 156 D2 / 178 D2: "Reveal in file manager" / "Copy path" / "Rename" for one demo as icon
 * buttons, mounted into `DemoDetailPanel`'s header (the rename button's archive reason is rendered
 * by the panel, not here). Both buttons call the `demos.reveal`/`demos.copyPath` handlers by this demo's
 * id - the actual path never crosses IPC in either direction (CLAUDE.md: "paths from the renderer
 * are never trusted"). A successful copy shows a toast (mirrors `ServerRow.tsx`'s
 * `handleCopyAddress`); any failure - transport-level or a domain refusal - shows a persistent
 * inline alert instead, which stays until a new action is taken or `demoId` changes.
 */
export function DemoFileActions({ demo, onRenamed }: DemoFileActionsProps) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const [error, setError] = useState<FileActionError | null>(null)
  const [renaming, setRenaming] = useState(false)
  const demoId = demo.id

  useEffect(() => {
    setError(null)
  }, [demoId])

  async function handleReveal(): Promise<void> {
    setError(null)
    const result = await revealDemo(demoId)
    if (!result.ok) {
      setError({ kind: 'transport', message: result.error })
      return
    }
    if (!result.value.ok) {
      setError({ kind: 'domain', key: `replays.fileActions.${result.value.reason}` })
    }
  }

  async function handleCopyPath(): Promise<void> {
    setError(null)
    const result = await copyDemoPath(demoId)
    if (!result.ok) {
      setError({ kind: 'transport', message: result.error })
      return
    }
    if (!result.value.ok) {
      setError({ kind: 'domain', key: `replays.fileActions.${result.value.reason}` })
      return
    }
    pushToast({ level: 'success', messageKey: 'replays.fileActions.pathCopied', timeoutMs: 4000 })
  }

  const archived = demo.archiveEntry !== null

  return (
    <>
      <div className="flex items-center gap-1" data-testid="replays-detail-file-actions">
        <IconButton
          label={t('replays.fileActions.reveal')}
          size="sm"
          onClick={() => void handleReveal()}
          data-testid="replays-demo-reveal"
        >
          <FolderOpen className="size-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton
          label={t('replays.fileActions.copyPath')}
          size="sm"
          onClick={() => void handleCopyPath()}
          data-testid="replays-demo-copy-path"
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton
          label={t('replays.rename.title')}
          size="sm"
          onClick={() => setRenaming(true)}
          disabled={archived}
          aria-describedby={archived ? 'replays-archive-readonly-rename' : undefined}
          data-testid="demo-rename"
        >
          <FilePen className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>
      {error && (
        <p
          className="order-last basis-full text-xs text-danger"
          role="alert"
          data-testid="replays-demo-file-action-error"
        >
          {error.kind === 'domain' ? t(error.key) : t(error.message.key, error.message.params)}
        </p>
      )}
      {renaming && (
        <RenameDemoDialog demo={demo} onClose={() => setRenaming(false)} onRenamed={onRenamed} />
      )}
    </>
  )
}
