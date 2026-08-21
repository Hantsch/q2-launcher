import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen } from 'lucide-react'
import type { ConfigProfile, PreviewProfileResult } from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { invoke } from '../../lib/bridge'
import { IconButton } from '../../components/ui/Button'
import { Badge, Spinner } from '../../components/ui/primitives'
import { useLauncher } from '../../store/useLauncher'
import { ConfigCodeView } from './components/ConfigCodeView'
import { previewConfigProfile } from './client'

/**
 * Read-only preview of the exact files a `write` would put on one
 * installation's disk for a profile, without writing them. Module-local,
 * like the rest of this module's dialogs: props-based, no shell store.
 *
 * Content is rendered verbatim - this is a byte-for-byte preview of what is
 * (or would be) on disk, so no trimming, no reformatting, no markdown.
 *
 * Owns its own fetch rather than taking the preview as a prop, so any caller
 * (currently `RawFileTab`'s per-row expand) can mount it standalone.
 */
export function RawConfigPanel({
  profile,
  installationId,
}: {
  profile: ConfigProfile
  installationId: string
}) {
  const { t } = useTranslation()
  const pushToast = useLauncher((state) => state.pushToast)

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

  const reveal = async (path: string) => {
    const outcome = await invoke('app:revealPath', path)
    if (!outcome.ok) {
      pushToast({
        level: 'error',
        messageKey: outcome.error.key,
        timeoutMs: 0,
        ...(outcome.error.params ? { params: outcome.error.params } : {}),
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    )
  }

  if (result && !result.ok) {
    return (
      <p className="text-sm leading-relaxed text-danger">
        {t(result.error.key, result.error.params)}
      </p>
    )
  }

  if (!result) return null

  if (result.value.files.length === 0) {
    return <p className="text-sm text-ink-muted">{t('config.raw.previewEmpty')}</p>
  }

  return (
    <div className="space-y-4">
      {result.value.files.map((file) => (
        <div key={file.path} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <p
              className="numeric min-w-0 flex-1 truncate text-xs text-ink-dim"
              title={file.path}
              data-selectable
            >
              {file.path}
            </p>
            <Badge tone={file.onDisk ? 'success' : 'neutral'}>
              {file.onDisk ? t('config.raw.onDisk') : t('config.raw.notOnDisk')}
            </Badge>
            <IconButton
              label={t('config.raw.reveal')}
              size="sm"
              disabled={!file.onDisk}
              onClick={() => void reveal(file.path)}
            >
              <FolderOpen className="size-3.5" />
            </IconButton>
          </div>
          {!file.onDisk && <p className="text-xs text-ink-muted">{t('config.raw.notWritten')}</p>}
          <ConfigCodeView text={file.content} searchable />
        </div>
      ))}
    </div>
  )
}
