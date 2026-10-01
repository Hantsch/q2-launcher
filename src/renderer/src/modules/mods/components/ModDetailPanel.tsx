import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FolderOpen, X } from 'lucide-react'
import type { Job, LocalizedMessage } from '@shared/types'
import { Button, IconButton } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/primitives'
import { invoke } from '../../../lib/bridge'
import { revealMod } from '../client'
import type { ModTileModel } from '../merge-mod-tiles'
import { ModInstallState } from './ModInstallState'

/**
 * The docked detail of one selected mod tile: the catalog facts (licence, links, versions) when
 * the gamedir is in the catalog, and the folder, reveal action and origin when it is on disk.
 */
export function ModDetailPanel({
  installationId,
  mod,
  onClose,
  job = null,
  failure = null,
  onInstall,
}: {
  installationId: string
  mod: ModTileModel
  onClose: () => void
  job?: Job | null
  failure?: LocalizedMessage | null
  /** Starts the install of the version picked here. */
  onInstall?: (catalogId: string, version: string) => void
}) {
  const { t } = useTranslation()
  const { local, catalog } = mod
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const chosenVersion = catalog
    ? catalog.versions.some((v) => v.version === version)
      ? (version as string)
      : catalog.pinned
    : null

  // A failure belongs to the directory it happened on.
  useEffect(() => {
    setError(null)
    setVersion(null)
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
            <div className="space-y-2">
              <ModInstallState
                mod={mod}
                job={job}
                failure={failure}
                onInstall={() => onInstall?.(catalog.id, chosenVersion ?? catalog.pinned)}
                installTestId={`mods-detail-install-${catalog.id}`}
              />
              {catalog.versions.length > 1 && !local && (
                <label className="flex items-center gap-2 text-sm text-ink-dim">
                  {t('mods.detail.installVersion')}
                  <select
                    value={chosenVersion ?? catalog.pinned}
                    onChange={(event) => setVersion(event.target.value)}
                    data-testid="mods-detail-version-select"
                    className="h-7 rounded-sm border border-line-strong bg-raised px-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-flame-500 focus-visible:outline-none"
                  >
                    {catalog.versions.map((entry) => (
                      <option key={entry.version} value={entry.version}>
                        {entry.version}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">{t('mods.detail.versions')}</p>
              <ul className="space-y-1" data-testid="mods-detail-versions">
                {catalog.versions.map((entry) => (
                  <li
                    key={entry.version}
                    className="flex flex-wrap items-center gap-2 text-sm text-ink"
                  >
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
