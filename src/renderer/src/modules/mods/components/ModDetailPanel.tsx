import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FolderOpen, X } from 'lucide-react'
import type { LocalizedMessage } from '@shared/types'
import { Button, IconButton } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/primitives'
import { invoke } from '../../../lib/bridge'
import { revealMod } from '../client'
import type { ModTileModel } from '../merge-mod-tiles'

/**
 * The docked detail of one selected mod tile: the catalog facts (licence, links, versions) when
 * the gamedir is in the catalog, and the folder, reveal action and origin when it is on disk.
 */
export function ModDetailPanel({
  installationId,
  mod,
  onClose,
}: {
  installationId: string
  mod: ModTileModel
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { local, catalog } = mod
  const [error, setError] = useState<LocalizedMessage | null>(null)

  // A failure belongs to the directory it happened on.
  useEffect(() => {
    setError(null)
  }, [mod.gameDir, installationId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const reveal = async (): Promise<void> => {
    const outcome = await revealMod(installationId, mod.gameDir)
    setError(outcome.ok ? null : outcome.error)
  }

  return (
    <aside
      aria-labelledby="mods-detail-name"
      data-testid="mods-detail-panel"
      className="w-80 shrink-0 overflow-y-auto border-l border-line bg-panel"
    >
      <div className="sticky top-0 z-10 flex min-h-8 items-center gap-2 border-b border-line bg-panel px-4 py-2">
        <h2
          id="mods-detail-name"
          data-testid="mods-detail-name"
          className="min-w-0 flex-1 truncate text-lg font-semibold text-ink"
        >
          {mod.gameDir}
        </h2>
        <IconButton
          label={t('mods.detail.close')}
          onClick={onClose}
          data-testid="mods-detail-close"
        >
          <X className="size-3.5" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="space-y-4 p-4">
        {catalog && (
          <>
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">{t('mods.detail.license')}</p>
              <p className="text-sm text-ink select-text" data-testid="mods-detail-license">
                {catalog.license}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<ExternalLink className="size-3.5" aria-hidden="true" />}
                onClick={() => void invoke('app:openExternal', catalog.projectUrl)}
                data-testid="mods-detail-project-link"
              >
                {t('mods.detail.projectPage')}
              </Button>
              <Button
                icon={<ExternalLink className="size-3.5" aria-hidden="true" />}
                onClick={() => void invoke('app:openExternal', catalog.sourceUrl)}
                data-testid="mods-detail-source-link"
              >
                {t('mods.detail.source')}
              </Button>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">{t('mods.detail.versions')}</p>
              <ul className="space-y-1" data-testid="mods-detail-versions">
                {catalog.versions.map((entry) => (
                  <li key={entry.version} className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    <span className="select-text">{entry.version}</span>
                    {entry.version === catalog.pinned && (
                      <Badge tone="success">{t('mods.detail.defaultVersion')}</Badge>
                    )}
                    {entry.prerelease && (
                      <Badge tone="warning">{t('mods.detail.prerelease')}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        {local && (
          <>
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">{t('mods.detail.path')}</p>
              <p className="text-sm break-all text-ink select-text" data-testid="mods-detail-path">
                {local.folderPath}
              </p>
            </div>
            <Button
              icon={<FolderOpen className="size-3.5" aria-hidden="true" />}
              onClick={() => void reveal()}
              data-testid="mods-detail-reveal"
            >
              {t('mods.detail.reveal')}
            </Button>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger" data-testid="mods-detail-error">
            {t(error.key, error.params)}
          </p>
        )}
        {local?.origin === 'manual' && (
          <p className="text-xs text-ink-dim" data-testid="mods-detail-manual-note">
            {t('mods.detail.manualNote')}
          </p>
        )}
      </div>
    </aside>
  )
}
