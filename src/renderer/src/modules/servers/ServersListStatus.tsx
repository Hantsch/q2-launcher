import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ServersScanState } from '@shared/modules/servers'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/primitives'
import { describeScanProgress, type ServersListState } from './list-state'

/**
 * Story 121 D1: the status strip that sits above the server rows - what `deriveListState`/
 * `describeScanProgress` (`list-state.ts`) say, turned into real text. Renders at most one of the
 * loading/empty/idle blocks (mutually exclusive, driven by `listState`), plus an independent
 * source-failures block that can co-occur with any of them. Renders nothing at all once rows are
 * populated and nothing failed, so the list sits directly under the toolbar. Icon + text always
 * together - never colour-only status (design-tokens rule).
 */
export function ServersListStatus({
  listState,
  scanState,
  sourceLabels,
  onOpenSourceSettings,
}: {
  listState: ServersListState
  scanState: ServersScanState
  sourceLabels: Record<string, string>
  onOpenSourceSettings: () => void
}) {
  const { t } = useTranslation()
  const pending = scanState.stage1Total - scanState.stage1Done

  if (listState === 'populated' && scanState.sourceFailures.length === 0) return null

  return (
    <div className="space-y-2 border-b border-line bg-void/30 px-5 py-2.5">
      {listState === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          data-testid="servers-list-loading"
          data-found={scanState.stage1Total}
          data-pending={pending}
          className="flex items-center gap-2 text-xs text-ink-dim"
        >
          <Spinner className="text-strogg-500" />
          <div className="flex flex-wrap gap-x-3">
            {describeScanProgress(scanState).map((line) => (
              <p key={line.key}>{t(line.key, line.params)}</p>
            ))}
          </div>
        </div>
      )}

      {listState === 'empty' && (
        <div
          data-testid="servers-list-empty"
          className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted"
        >
          <p>{t('servers.list.empty')}</p>
          <Button
            variant="neutral"
            size="sm"
            onClick={onOpenSourceSettings}
            data-testid="servers-list-empty-settings"
          >
            {t('servers.list.openSourceSettings')}
          </Button>
        </div>
      )}

      {listState === 'idle' && (
        <p className="text-xs text-ink-muted" data-testid="servers-list-idle">
          {t('servers.list.idle')}
        </p>
      )}

      {scanState.sourceFailures.length > 0 && (
        <div className="space-y-1" data-testid="servers-list-source-failures">
          {scanState.sourceFailures.map((failure) => {
            const source = sourceLabels[failure.sourceId] ?? failure.sourceId
            const reason = t(failure.reasonKey)
            return (
              <p
                key={failure.sourceId}
                data-testid={`servers-list-source-failure-${failure.sourceId}`}
                className="flex items-center gap-1.5 text-xs text-warning"
              >
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>{t('servers.list.sourceFailed', { source, reason })}</span>
              </p>
            )
          })}
        </div>
      )}
    </div>
  )
}
