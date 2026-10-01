import { useCallback, useState, type ReactNode } from 'react'
import type { ModUpdatePreview } from '@shared/modules/mods'
import type { LocalizedMessage } from '@shared/types'
import { previewUpdate, updateMod } from './client'
import { UpdateModDialog } from './components/UpdateModDialog'

/**
 * Story 194 D4: the Update click. Asks main what the update would touch; with nothing changed it
 * starts straight away (overwrite), otherwise it opens the changed-files dialog. A refusal from
 * either call goes to `onFailed`, so it shows as visible text next to the mod.
 */
export function useModUpdate(
  installationId: string | null,
  onStarted: (catalogId: string, jobId: string) => void,
  onFailed: (catalogId: string, error: LocalizedMessage) => void,
): { requestUpdate: (catalogId: string) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<{ catalogId: string; preview: ModUpdatePreview } | null>(
    null,
  )
  const requestUpdate = useCallback(
    (catalogId: string): void => {
      if (!installationId) return
      void (async () => {
        const preview = await previewUpdate(installationId, catalogId)
        if (!preview.ok) return onFailed(catalogId, preview.error)
        if (preview.value.changedFiles.length > 0) {
          setPending({ catalogId, preview: preview.value })
          return
        }
        const started = await updateMod(installationId, catalogId, 'overwrite')
        if (started.ok) onStarted(catalogId, started.value.jobId)
        else onFailed(catalogId, started.error)
      })()
    },
    [installationId, onStarted, onFailed],
  )
  const dialog =
    pending && installationId ? (
      <UpdateModDialog
        installationId={installationId}
        catalogId={pending.catalogId}
        preview={pending.preview}
        onClose={() => setPending(null)}
        onStarted={(jobId) => onStarted(pending.catalogId, jobId)}
      />
    ) : null
  return { requestUpdate, dialog }
}
