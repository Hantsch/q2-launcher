import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ARCHIVE_CACHE_BUDGET_CHOICES_GB,
  MAX_CONCURRENT_DOWNLOAD_JOBS,
  MIN_CONCURRENT_DOWNLOAD_JOBS,
  type ArchiveCacheBudgetGB,
  type ArchiveCacheStatus,
  type ClearArchiveCacheResult,
  type DownloadsSettings,
} from '@shared/modules/downloads'
import { Button } from '../../components/ui/Button'
import { Select, Switch } from '../../components/ui/controls'
import { Modal } from '../../components/ui/Modal'
import { formatBytes } from '../../lib/format'
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
 * Story 072 D5: the downloads module's Settings section - inner content only, the shell
 * (`SettingsView.tsx`, D1) already wraps every contributed section in its own `Panel` +
 * `SectionLabel` chrome.
 *
 * Renders the three settings (AC2) and the live archive cache size (AC3); "Clear cache" opens a
 * `Modal` confirm that states the current size/count before `clearArchiveCache` is ever called
 * (AC4) - mirrors `config/CleanupPanel.tsx`'s scan-then-confirm-then-apply discipline.
 */
export function DownloadsSettingsSection() {
  const { t } = useTranslation()

  const [settings, setSettings] = useState<DownloadsSettings | null>(null)
  const [cacheStatus, setCacheStatus] = useState<ArchiveCacheStatus | null>(null)
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

  useEffect(() => {
    let cancelled = false
    void getDownloadsSettings().then((result) => {
      if (!cancelled && result.ok) setSettings(result.value)
    })
    void getArchiveCacheStatus().then((result) => {
      if (!cancelled && result.ok) setCacheStatus(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [])

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
      // The confirm dialog's stated size/count and the actual deletion must never disagree (AC4) -
      // use what was actually removed, not an assumed "everything is now gone".
      setLastClearResult(result.value)
      await refreshCacheStatus()
    }
  }

  return (
    <>
      <div className="space-y-3">
        <label className="space-y-1.5 block" data-testid="downloads-settings-concurrency">
          <span className="stencil block">{t('module.downloads.settings.concurrency.label')}</span>
          <Select
            value={settings ? String(settings.concurrentJobs) : ''}
            disabled={!settings}
            onChange={(event) => void applyPatch({ concurrentJobs: Number(event.target.value) })}
            options={CONCURRENCY_CHOICES.map((value) => ({
              value: String(value),
              label: String(value),
            }))}
          />
        </label>

        <label className="space-y-1.5 block" data-testid="downloads-settings-cache-budget">
          <span className="stencil block">{t('module.downloads.settings.cacheBudget.label')}</span>
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

        <div data-testid="downloads-settings-while-playing">
          <Switch
            label={t('module.downloads.settings.whilePlaying.label')}
            checked={settings?.downloadWhilePlayingAllowed ?? false}
            disabled={!settings}
            onChange={(downloadWhilePlayingAllowed) =>
              void applyPatch({ downloadWhilePlayingAllowed })
            }
          />
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
            {t('module.downloads.settings.clearCache.button')}
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
        <Modal
          open
          size="sm"
          title={t('module.downloads.settings.clearCache.confirmTitle')}
          onClose={() => setConfirmOpen(false)}
          closeLabel={t('common.close')}
          preventClose={clearing}
          footer={
            <>
              <Button variant="ghost" disabled={clearing} onClick={() => setConfirmOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={clearing}
                onClick={() => void handleConfirmClear()}
                data-testid="downloads-settings-clear-cache-confirm-button"
              >
                {t('module.downloads.settings.clearCache.confirm')}
              </Button>
            </>
          }
        >
          <p
            className="text-sm leading-relaxed text-ink-dim"
            data-testid="downloads-settings-clear-cache-confirm"
          >
            {t('module.downloads.settings.clearCache.confirmBody', {
              size: formatBytes(cacheStatus.totalBytes),
              count: cacheStatus.itemCount,
            })}
          </p>
        </Modal>
      )}
    </>
  )
}
