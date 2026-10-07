import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ARCHIVE_CACHE_BUDGET_CHOICES_GB,
  MAX_CONCURRENT_DOWNLOAD_JOBS,
  MIN_CONCURRENT_DOWNLOAD_JOBS,
  type ArchiveCacheBudgetGB,
  type ClearArchiveCacheResult,
  type DownloadsSettings,
} from '@shared/modules/downloads'
import { Button } from '../../components/ui/Button'
import { Select, Switch } from '../../components/ui/controls'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { formatBytes } from '../../lib/format'
import { useModuleQuery } from '../../lib/useModuleQuery'
import {
  clearArchiveCache,
  getArchiveCacheStatus,
  getDownloadsSettings,
  patchDownloadsSettings,
} from './client'

const CONCURRENCY_CHOICES = Array.from(
  { length: MAX_CONCURRENT_DOWNLOAD_JOBS - MIN_CONCURRENT_DOWNLOAD_JOBS + 1 },
  (_, index) => MIN_CONCURRENT_DOWNLOAD_JOBS + index,
)

/**
 * Story 072: the downloads module's Settings section - inner content only, the shell
 * (`SettingsView.tsx`) already wraps every contributed section in its own `Panel` +
 * `SectionLabel` chrome.
 *
 * Renders the three settings and the live archive cache size; "Clear cache" opens a
 * `ConfirmDialog` that states the current size/count before `clearArchiveCache` is ever called
 * - mirrors `config/CleanupPanel.tsx`'s scan-then-confirm-then-apply discipline.
 */
export function DownloadsSettingsSection() {
  const { t } = useTranslation()

  const settingsQuery = useModuleQuery(getDownloadsSettings)
  const cacheQuery = useModuleQuery(getArchiveCacheStatus)
  const settings = settingsQuery.data ?? null
  const cacheStatus = cacheQuery.data ?? null
  const { setData: setSettings } = settingsQuery
  const { setData: setCacheStatus } = cacheQuery
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [lastClearResult, setLastClearResult] = useState<ClearArchiveCacheResult | null>(null)

  // Shared by both call sites that can change what is actually on disk (a budget-lowering patch's
  // server-side eviction, and an explicit clear) - so the displayed size/count is always refetched
  // from main rather than guessed at from a stale or partial local value.
  const refreshCacheStatus = async (): Promise<void> => {
    const result = await getArchiveCacheStatus()
    if (result.ok) setCacheStatus(result.value)
  }

  const applyPatch = async (patch: Partial<DownloadsSettings>): Promise<void> => {
    const result = await patchDownloadsSettings(patch)
    // Re-syncs to the (possibly server-adjusted) returned value rather than the patch that was
    // sent - the settings persisted are whatever main actually accepted.
    if (result.ok) {
      setSettings(result.value)
      // A lowered budget evicts server-side (`index.ts`'s `patchSettings`); refetch so the
      // displayed cache size never stays at its pre-eviction value.
      await refreshCacheStatus()
    }
  }

  const openConfirm = (): void => setConfirmOpen(true)

  const handleConfirmClear = async (): Promise<void> => {
    setClearing(true)
    const result = await clearArchiveCache()
    setClearing(false)
    if (result.ok) {
      setConfirmOpen(false)
      // The confirm dialog's stated size/count and the actual deletion must never disagree -
      // use what was actually removed, not an assumed "everything is now gone".
      setLastClearResult(result.value)
      await refreshCacheStatus()
    }
  }

  return (
    <>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5" data-testid="downloads-settings-concurrency">
            <label className="block space-y-1.5">
              <span className="stencil block">
                {t('module.downloads.settings.concurrency.label')}
              </span>
              {/* Downloads run one at a time, so the persisted value is shown but cannot be
                  changed; main still validates and stores it. */}
              <Select
                value={settings ? String(settings.concurrentJobs) : ''}
                disabled
                aria-describedby="downloads-settings-concurrency-reason"
                options={CONCURRENCY_CHOICES.map((value) => ({
                  value: String(value),
                  label: String(value),
                }))}
              />
            </label>
            <p
              id="downloads-settings-concurrency-reason"
              className="text-xs text-ink-muted"
              data-testid="downloads-settings-concurrency-reason"
            >
              {t('module.downloads.settings.queueUnavailable')}
            </p>
          </div>

          <label className="space-y-1.5 block" data-testid="downloads-settings-cache-budget">
            <span className="stencil block">
              {t('module.downloads.settings.cacheBudget.label')}
            </span>
            <Select
              value={settings ? String(settings.archiveCacheBudgetGB) : ''}
              disabled={!settings}
              onChange={(event) =>
                void applyPatch({
                  archiveCacheBudgetGB: Number(event.target.value) as ArchiveCacheBudgetGB,
                })
              }
              options={ARCHIVE_CACHE_BUDGET_CHOICES_GB.map((value) => ({
                value: String(value),
                label: t('module.downloads.settings.cacheBudget.option', { gb: value }),
              }))}
            />
          </label>
        </div>

        <div data-testid="downloads-settings-while-playing">
          <Switch
            label={t('module.downloads.settings.whilePlaying.label')}
            checked={settings?.downloadWhilePlayingAllowed ?? false}
            disabled
            describedBy="downloads-settings-while-playing-reason"
            onChange={() => undefined}
          />
          <p
            id="downloads-settings-while-playing-reason"
            className="text-xs text-ink-muted"
            data-testid="downloads-settings-while-playing-reason"
          >
            {t('module.downloads.settings.queueUnavailable')}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-ink-muted" data-testid="downloads-settings-cache-size">
            {cacheStatus
              ? t('module.downloads.settings.cacheSize.value', {
                  size: formatBytes(cacheStatus.totalBytes),
                  count: cacheStatus.itemCount,
                })
              : '-'}
          </p>
          <Button
            variant="neutral"
            size="sm"
            disabled={!cacheStatus || cacheStatus.itemCount === 0}
            onClick={openConfirm}
            data-testid="downloads-settings-clear-cache"
          >
            {t('common.action.clearCache')}
          </Button>
        </div>

        {lastClearResult && (
          <p className="text-xs text-ink-muted" data-testid="downloads-settings-clear-cache-result">
            {t('module.downloads.settings.clearCache.result', {
              size: formatBytes(lastClearResult.removedBytes),
              count: lastClearResult.removedCount,
            })}
          </p>
        )}
      </div>

      {confirmOpen && cacheStatus && (
        <ConfirmDialog
          title={t('module.downloads.settings.clearCache.confirmTitle')}
          body={
            <p
              className="text-sm leading-relaxed text-ink-dim"
              data-testid="downloads-settings-clear-cache-confirm"
            >
              {t('module.downloads.settings.clearCache.confirmBody', {
                size: formatBytes(cacheStatus.totalBytes),
                count: cacheStatus.itemCount,
              })}
            </p>
          }
          confirmLabel={t('common.action.clearCache')}
          tone="danger"
          busy={clearing}
          onConfirm={() => void handleConfirmClear()}
          onClose={() => setConfirmOpen(false)}
          testIds={{ confirm: 'downloads-settings-clear-cache-confirm-button' }}
        />
      )}
    </>
  )
}
