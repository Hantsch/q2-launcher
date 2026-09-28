import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocalizedMessage } from '@shared/types'
import { useLauncher } from '../../../store/useLauncher'
import { Button } from '../../../components/ui/Button'
import { copyDemoPath, revealDemo } from '../client'

export interface DemoFileActionsProps {
  demoId: string
}

/** One failed file action's message: either one of this module's own two i18n keys (a domain
 * refusal - `fileMissing`/`unknownDemo`), or a transport-level `LocalizedMessage` rendered
 * verbatim, same convention as `ReplaysSettingsSection.tsx`'s `error` state. */
type FileActionError = { kind: 'domain'; key: string } | { kind: 'transport'; message: LocalizedMessage }

/**
 * Story 156 D2: "Reveal in file manager" / "Copy path" for one demo, mounted into
 * `DemoDetailPanel`. Both buttons call the `demos.reveal`/`demos.copyPath` handlers by this demo's
 * id - the actual path never crosses IPC in either direction (CLAUDE.md: "paths from the renderer
 * are never trusted"). A successful copy shows a toast (mirrors `ServerRow.tsx`'s
 * `handleCopyAddress`); any failure - transport-level or a domain refusal - shows a persistent
 * inline alert instead, which stays until a new action is taken or `demoId` changes.
 */
export function DemoFileActions({ demoId }: DemoFileActionsProps) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)
  const [error, setError] = useState<FileActionError | null>(null)

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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void handleReveal()} data-testid="replays-demo-reveal">
          {t('replays.fileActions.reveal')}
        </Button>
        <Button size="sm" onClick={() => void handleCopyPath()} data-testid="replays-demo-copy-path">
          {t('replays.fileActions.copyPath')}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert" data-testid="replays-demo-file-action-error">
          {error.kind === 'domain' ? t(error.key) : t(error.message.key, error.message.params)}
        </p>
      )}
    </div>
  )
}
