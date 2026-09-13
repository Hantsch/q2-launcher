import { useTranslation } from 'react-i18next'
import { Copy, FolderOpen, RotateCcw, X } from 'lucide-react'
import { DOWNLOADS_ERROR_KEYS, type DownloadFailure } from '@shared/modules/downloads'
import type { AppInfo } from '@shared/types/common'
import { useInstallationById, useLauncher } from '../../../store/useLauncher'
import { formatRelativeTime } from '../../../lib/format'
import { invoke } from '../../../lib/bridge'
import { IconButton } from '../../../components/ui/Button'
import { Badge, Panel } from '../../../components/ui/primitives'
import { buildFailureReport } from '../report'
import { FailureCauseDetail } from './FailureCauseDetail'

/**
 * Story 073 D4 (AC2): one entry in the Downloads tab's failure log - either an always-visible
 * undismissed entry (with a Dismiss action) or one shown inside the collapsed "dismissed"
 * disclosure (with a Restore action instead). Mirrors `JobRow`'s layout and primitive
 * conventions (`Panel`, `Badge`, `IconButton`) so the two lists read as one system.
 *
 * Story 075 D6 adds the failure's two diagnostic actions: copy (only rendered when the failure
 * carries `diagnostics` - AC6's pre-story entries offer no copy action at all, not a disabled
 * stub) and reveal-log (disabled until `appInfo` has loaded, mirroring `SettingsView.tsx`'s
 * existing reveal-log-path pattern exactly - AC5).
 *
 * Story 078 D6 mounts the shared `FailureCauseDetail` below the header row and demotes
 * reveal-log out of the always-visible action cluster into the detail's footer slot - a closed
 * card now offers copy (the primary reporting action) and dismiss/restore only; reveal-log is
 * reachable after expanding. An entry with no `diagnostics` renders no detail at all (AC6), so it
 * genuinely has no way to reveal the log anymore - the intentional consequence of (User) Q1/AC5.
 */
export interface FailureLogEntryProps {
  failure: DownloadFailure
  /** True when rendered inside the collapsed "dismissed" disclosure - flips the action to Restore. */
  dismissed: boolean
  onDismiss: (id: string) => void
  onRestore: (id: string) => void
  /** `null` until the store's bootstrap fetch resolves - gates the reveal-log action (AC5). */
  appInfo: AppInfo | null
}

const KNOWN_ERROR_KEYS = new Set<string>(DOWNLOADS_ERROR_KEYS)

export function FailureLogEntry({
  failure,
  dismissed,
  onDismiss,
  onRestore,
  appInfo,
}: FailureLogEntryProps) {
  const { t } = useTranslation()
  const installation = useInstallationById(failure.installationId ?? null)
  const pushToast = useLauncher((state) => state.pushToast)
  const errorKey = KNOWN_ERROR_KEYS.has(failure.error.key) ? failure.error.key : 'downloads.error.unknown'
  const timestamp = formatRelativeTime(new Date(failure.createdAt).toISOString())

  function handleCopyReport() {
    if (!appInfo) return
    const report = buildFailureReport({ failure, appInfo, t })
    void invoke('app:copyText', report).then((result) => {
      if (result.ok) {
        pushToast({
          level: 'success',
          messageKey: 'downloads.failures.copyReportSuccess',
          timeoutMs: 4000,
        })
        return
      }
      // A rejected `app:copyText` (an over-length report, say) must not look like a silent
      // success - the user would paste stale clipboard content into an issue. Same
      // error-toast pattern the config module uses for a failed IPC call (`CareTab.tsx`),
      // sticky (`timeoutMs: 0`) because there is nothing else on screen that says so.
      pushToast({
        level: 'error',
        messageKey: 'downloads.failures.copyReportError',
        timeoutMs: 0,
      })
    })
  }

  function handleRevealLog() {
    if (appInfo) void invoke('app:revealPath', appInfo.logPath)
  }

  const revealLogButton = (
    <IconButton
      label={t('downloads.failures.revealLog')}
      size="sm"
      onClick={handleRevealLog}
      disabled={!appInfo}
      data-testid={`downloads-failure-reveal-${failure.id}`}
    >
      <FolderOpen className="size-3.5" />
    </IconButton>
  )

  return (
    <Panel className="space-y-2 p-3" data-testid={`downloads-failure-${failure.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-sm tracking-[0.04em] text-ink">
              {t(failure.labelKey, failure.labelParams ?? {})}
            </span>
            <Badge tone="danger">{t('jobs.status.failed')}</Badge>
          </div>
          <p className="text-xs text-ink-dim">{t(errorKey, failure.error.params ?? {})}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
            {installation && (
              <span>{t('downloads.failures.installation', { name: installation.name })}</span>
            )}
            {timestamp && <span>{timestamp}</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {failure.diagnostics && (
            <IconButton
              label={t('downloads.failures.copyReport')}
              size="sm"
              onClick={handleCopyReport}
              disabled={!appInfo}
              data-testid={`downloads-failure-copy-${failure.id}`}
            >
              <Copy className="size-3.5" />
            </IconButton>
          )}
          {dismissed ? (
            <IconButton
              label={t('downloads.failures.restore')}
              size="sm"
              onClick={() => onRestore(failure.id)}
              data-testid={`downloads-failure-restore-${failure.id}`}
            >
              <RotateCcw className="size-3.5" />
            </IconButton>
          ) : (
            <IconButton
              label={t('downloads.failures.dismiss')}
              size="sm"
              onClick={() => onDismiss(failure.id)}
              data-testid={`downloads-failure-dismiss-${failure.id}`}
            >
              <X className="size-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      <FailureCauseDetail diagnostics={failure.diagnostics} footer={revealLogButton} />
    </Panel>
  )
}
