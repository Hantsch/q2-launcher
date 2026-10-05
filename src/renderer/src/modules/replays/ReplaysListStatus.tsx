import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReplaysScanProgress, ReplaysSourceError } from '@shared/modules/replays'
import { scopeSourceErrors, type DemoListScope } from '@shared/replays/list-scope'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/primitives'
import { useModuleQuery } from '../../lib/useModuleQuery'
import { demoFoldersRead } from './client'
import { describeReplaysScanProgress, type ReplaysListState } from './list-state'

const SOURCE_ERROR_REASON_KEYS: Record<ReplaysSourceError['reason'], string> = {
  missing: 'replays.list.sourceErrorReason.missing',
  notAFolder: 'replays.list.sourceErrorReason.notAFolder',
  permissionDenied: 'replays.list.sourceErrorReason.permissionDenied',
  unreadable: 'replays.list.sourceErrorReason.unreadable',
  'extractor-missing': 'replays.list.sourceErrorReason.extractor-missing',
  'archive-unreadable': 'replays.list.sourceErrorReason.archive-unreadable',
  'archive-too-large': 'replays.list.sourceErrorReason.archive-too-large',
}

/** Labels a `ReplaysSourceError`'s source: an installation's game dir the same way `DemoRow`'s
 * source cell does (`replays.list.source`), an extra folder via the existing
 * `replays.source.extraFolder` key. */
function sourceLabel(
  t: (key: string, params?: Record<string, unknown>) => string,
  error: ReplaysSourceError,
): string {
  return error.source.kind === 'installation'
    ? t('replays.list.source', {
        installation: error.source.installationName,
        gameDir: error.source.gameDir,
      })
    : t('replays.source.extraFolder', { path: error.source.path })
}

/** The folders an empty installation looks in, named so an empty list never reads as a failure -
 * neutral text, no warning icon. Mounted only while that state is shown, so the read happens then. */
function EmptyInstallation({
  installationId,
  installationName,
  onOpenSettings,
}: {
  installationId: string
  installationName: string
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const query = useModuleQuery(() => demoFoldersRead(installationId), { deps: [installationId] })
  return (
    <div
      data-testid="replays-list-empty-installation"
      className="flex flex-wrap items-start justify-between gap-2 text-xs text-ink-muted"
    >
      <div className="space-y-1">
        <p>{t('replays.scope.emptyFor', { name: installationName })}</p>
        {query.data?.folders.map((folder) => (
          <p key={folder} data-testid="replays-list-empty-folder" className="font-mono">
            {folder}
          </p>
        ))}
      </div>
      <Button variant="neutral" onClick={onOpenSettings} data-testid="replays-list-empty-settings">
        {t('replays.list.openSettings')}
      </Button>
    </div>
  )
}

/**
 * Story 151: the status strip that sits above the demo rows - what `deriveReplaysListState`/
 * `describeReplaysScanProgress` (`list-state.ts`) say, turned into real text. Mirrors
 * `ServersListStatus.tsx`: renders at most one of the loading/empty blocks (mutually exclusive,
 * driven by `listState`), plus an independent source-errors block that can co-occur with either.
 * Renders nothing at all once rows are populated and nothing failed, so the list sits directly
 * under the header. Icon + text always together - never colour-only status (design-tokens rule).
 */
export function ReplaysListStatus({
  listState,
  progress,
  scope,
  installationName,
  onOpenSettings,
}: {
  listState: ReplaysListState
  progress: ReplaysScanProgress
  scope: DemoListScope
  installationName: string | null
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const sourceErrors = scopeSourceErrors(progress.sourceErrors, scope)

  if (listState === 'populated' && sourceErrors.length === 0) return null

  return (
    <div className="space-y-2 border-b border-line bg-void/30 px-5 py-2.5">
      {listState === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          data-testid="replays-list-loading"
          data-scanned={progress.sources.reduce((sum, source) => sum + source.scanned, 0)}
          data-total={progress.sources.reduce((sum, source) => sum + source.total, 0)}
          className="flex items-center gap-2 text-xs text-ink-dim"
        >
          <Spinner className="text-strogg-500" />
          {(() => {
            const line = describeReplaysScanProgress(progress)
            return <p>{t(line.key, line.params)}</p>
          })()}
        </div>
      )}

      {listState === 'empty' && (
        <div
          data-testid="replays-list-empty"
          className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted"
        >
          <p>{t('replays.list.empty')}</p>
          <Button
            variant="neutral"
            onClick={onOpenSettings}
            data-testid="replays-list-empty-settings"
          >
            {t('replays.list.openSettings')}
          </Button>
        </div>
      )}

      {listState === 'noInstallation' && (
        <p data-testid="replays-list-no-installation" className="text-xs text-ink-muted">
          {t('replays.scope.noInstallation')}
        </p>
      )}

      {listState === 'noneSelected' && (
        <p data-testid="replays-list-none-selected" className="text-xs text-ink-muted">
          {t('replays.scope.noneSelected')}
        </p>
      )}

      {listState === 'emptyForInstallation' &&
        scope.kind === 'installation' &&
        installationName !== null && (
          <EmptyInstallation
            installationId={scope.installationId}
            installationName={installationName}
            onOpenSettings={onOpenSettings}
          />
        )}

      {sourceErrors.length > 0 && (
        <div className="space-y-1" data-testid="replays-list-source-errors">
          {sourceErrors.map((error, index) => {
            const source = sourceLabel(t, error)
            const reason = t(SOURCE_ERROR_REASON_KEYS[error.reason])
            const label =
              error.archiveName !== null
                ? t('replays.list.sourceErrorArchive', { base: source, archive: error.archiveName })
                : source
            return (
              <p
                key={`${source}:${error.archiveName ?? ''}:${error.reason}:${index}`}
                data-testid="replays-list-source-error"
                data-reason={error.reason}
                className="flex items-center gap-1.5 text-xs text-warning"
              >
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{t('replays.list.sourceError', { source: label, reason })}</span>
              </p>
            )
          })}
        </div>
      )}
    </div>
  )
}
