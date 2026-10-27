import { useTranslation } from 'react-i18next'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { ConfigProfile } from '@shared/modules/config'
import { Button } from '../../../components/ui/Button'
import { ProfileBanner } from './ProfileBanner'

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
        <ProfileBanner
          tone="danger"
          title={t('config.fileSource.missingBanner.title')}
          body={t('config.fileSource.missingBanner.body')}
        >
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
        </ProfileBanner>
      )}

      {diagnostic && diagnostic.profileId === profile.id && (
        <ProfileBanner
          tone="warning"
          title={
            diagnostic.file !== undefined && diagnostic.line !== undefined
              ? t('config.fileSource.diagnostic.titleWithLine', {
                  file: diagnostic.file,
                  line: diagnostic.line,
                })
              : t('config.fileSource.diagnostic.title')
          }
          body={diagnostic.message}
          hint={t('config.fileSource.diagnostic.hint')}
        />
      )}
    </>
  )
}
