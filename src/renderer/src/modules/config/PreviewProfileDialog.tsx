import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile, PreviewProfileResult } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { previewConfigProfile } from './client'

/**
 * Read-only preview of the exact files a `write` would put on one
 * installation's disk for a profile, without writing them. Module-local,
 * like the rest of this module's dialogs: props-based, no shell store.
 *
 * Content is rendered verbatim - this is a byte-for-byte preview of what is
 * (or would be) on disk, so no trimming, no reformatting, no markdown.
 */
export function PreviewProfileDialog({
  profile,
  installationId,
  onClose,
}: {
  profile: ConfigProfile
  installationId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const installations = useLauncher((state) => state.installations)
  const installation = installations.find((entry) => entry.id === installationId)

  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<Outcome<PreviewProfileResult> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setResult(null)
    void previewConfigProfile({ profileId: profile.id, installationId }).then((outcome) => {
      if (cancelled) return
      setResult(outcome)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [profile.id, installationId])

  return (
    <Modal
      open
      size="lg"
      title={t('config.previewDialog.title', {
        installation: installation?.name ?? installationId,
      })}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      {loading && (
        <div className="flex items-center justify-center py-10">
          <Spinner />
        </div>
      )}

      {!loading && result && !result.ok && (
        <p className="text-sm leading-relaxed text-danger">
          {t(result.error.key, result.error.params)}
        </p>
      )}

      {!loading && result && result.ok && (
        <div className="space-y-4">
          {result.value.files.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('config.previewDialog.empty')}</p>
          ) : (
            result.value.files.map((file) => (
              <div key={file.path} className="space-y-1.5">
                <p className="numeric truncate text-xs text-ink-dim" title={file.path}>
                  {file.path}
                </p>
                <pre className="numeric max-h-64 overflow-auto rounded-sm border border-line bg-void p-3 text-[11px] whitespace-pre text-ink-muted">
                  {file.content}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  )
}
