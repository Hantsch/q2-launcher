import { useTranslation } from 'react-i18next'
import { RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'

/** A parse/read diagnostic for the selected profile. `refreshFromFiles` never persists the
 * message/line (only the display-hint `fileState`), and it is scoped to one profile id so a stale
 * diagnostic is never shown against a different profile. */
export interface FileDiagnostic {
  profileId: string
  file?: string
  line?: number
  message: string
}

/**
 * Persistent (never a toast) banners for a profile whose canonical file is gone or unreadable.
 * The missing-file actions are real: "Rewrite from cache" reuses the ordinary save, "Remove profile"
 * opens the same confirmation as the header's delete. The diagnostic never disables the profile -
 * the tabs below stay as reachable as for any other. (story 218)
 */
export function ProfileFileBanners({
  profile,
  diagnostic,
  rewriting,
  onRewrite,
  onDelete,
}: {
  profile: ConfigProfile
  diagnostic: FileDiagnostic | null
  rewriting: boolean
  onRewrite: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  return (
    <>
      {profile.fileState === 'missing' && (
        <div className="space-y-3 rounded-sm border border-danger/35 bg-danger/8 p-3">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-danger">
                {t('config.fileSource.missingBanner.title')}
              </p>
              <p className="text-xs leading-relaxed text-ink-dim">
                {t('config.fileSource.missingBanner.body')}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="neutral"
              size="sm"
              icon={<RotateCcw className="size-3.5" />}
              disabled={rewriting}
              onClick={onRewrite}
            >
              {t('config.fileSource.missingBanner.rewrite')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="size-3.5" />}
              onClick={onDelete}
            >
              {t('config.fileSource.missingBanner.remove')}
            </Button>
          </div>
        </div>
      )}

      {diagnostic && diagnostic.profileId === profile.id && (
        <div className="flex items-start gap-2 rounded-sm border border-warning/35 bg-warning/8 p-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-warning">
              {diagnostic.file !== undefined && diagnostic.line !== undefined
                ? t('config.fileSource.diagnostic.titleWithLine', {
                    file: diagnostic.file,
                    line: diagnostic.line,
                  })
                : t('config.fileSource.diagnostic.title')}
            </p>
            <p className="text-xs leading-relaxed text-ink-dim">{diagnostic.message}</p>
            <p className="text-xs text-ink-muted">{t('config.fileSource.diagnostic.hint')}</p>
          </div>
        </div>
      )}
    </>
  )
}
