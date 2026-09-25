import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { LocalizedMessage, Outcome } from '@shared/types'
import {
  SCAN_AUTO_REFRESH_INTERVAL_CHOICES_MS,
  SCAN_CONCURRENCY_CHOICES,
  SCAN_MIN_SPACING_CHOICES_MS,
  SCAN_RETRIES_CHOICES,
  SCAN_TIMEOUT_CHOICES_MS,
  type MasterSource,
  type MasterSourcesResult,
  type MasterSourceType,
  type ServersScanSettings,
} from '@shared/modules/servers'
import { SortableList } from '../../components/dnd'
import { Button } from '../../components/ui/Button'
import { Select, Switch } from '../../components/ui/controls'
import { SectionLabel } from '../../components/ui/primitives'
import {
  addMasterSource,
  getScanSettings,
  listMasterSources,
  patchScanSettings,
  removeMasterSource,
  reorderMasterSources,
  setMasterSourceEnabled,
  updateMasterSourceAddress,
} from './client'
import { MasterSourceRow } from './MasterSourceRow'

/**
 * Story 115 D4: formats one millisecond choice as a short human label for the timeout/min-spacing/
 * auto-refresh-interval `<Select>`s (Decisions: "durations are stored in ms but rendered in
 * seconds/minutes in the UI"). `0` and anything under a second render in ms/seconds via the same
 * bucket, a whole multiple of a minute renders in minutes, everything else in seconds (which may
 * carry a fractional part, e.g. 1500ms -> "1.5 s") - every string comes from an i18n key
 * (`module.servers.settings.scan.duration.*`), never inline English text.
 */
function formatMsChoice(t: TFunction, ms: number): string {
  if (ms > 0 && ms < 1000) return t('module.servers.settings.scan.duration.ms', { value: ms })
  if (ms >= 60_000 && ms % 60_000 === 0) {
    return t('module.servers.settings.scan.duration.minutes', { value: ms / 60_000 })
  }
  return t('module.servers.settings.scan.duration.seconds', { value: ms / 1000 })
}

const TYPE_OPTIONS: { value: MasterSourceType; labelKey: string }[] = [
  { value: 'udp-master', labelKey: 'module.servers.settings.type.udp-master' },
  { value: 'http-list', labelKey: 'module.servers.settings.type.http-list' },
]

/**
 * Story 111 D4: the master-source list a user actually edits - replaces story 106 D3's
 * placeholder. Inner content only, the shell (`SettingsView.tsx`) already wraps every contributed
 * section in its own `Panel` + `SectionLabel` chrome, same as `downloads/DownloadsSettingsSection.tsx`.
 *
 * Every mutating action re-renders from the handler's returned full list (story's Decisions: "every
 * mutating handler resolves to the full new list, so the section renders from main's truth") - there
 * is no optimistic local copy anywhere below.
 */
export function ServersSettingsSection() {
  const { t } = useTranslation()
  const typeOptions = TYPE_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))

  const [sources, setSources] = useState<MasterSource[] | null>(null)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [saving, setSaving] = useState(false)

  const [addType, setAddType] = useState<MasterSourceType>('udp-master')
  const [addAddress, setAddAddress] = useState('')

  const [scanSettings, setScanSettings] = useState<ServersScanSettings | null>(null)
  const [scanError, setScanError] = useState<LocalizedMessage | null>(null)

  useEffect(() => {
    let cancelled = false
    void listMasterSources().then((result) => {
      if (cancelled) return
      if (result.ok) setSources(result.value)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getScanSettings().then((result) => {
      if (cancelled) return
      if (result.ok) setScanSettings(result.value)
      else setScanError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** Every `sources.*` mutation goes through here: clears the previous error, runs the action, and
   * either applies main's returned full list (success) or renders the refusal's reason - transport
   * failure (`result.ok === false`) and domain refusal (`result.value.ok === false`) are two
   * different shapes but both become the same `error` state, never raw prose (CLAUDE.md). */
  const mutate = async (action: () => Promise<Outcome<MasterSourcesResult>>): Promise<void> => {
    setError(null)
    setSaving(true)
    const result = await action()
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const domain = result.value
    if (!domain.ok) {
      setError({ key: `servers.sources.reject.${domain.reason}` })
      return
    }
    setSources(domain.sources)
  }

  const handleAdd = (): void => {
    if (addAddress.trim().length === 0) return
    void mutate(() => addMasterSource({ type: addType, address: addAddress })).then(() => {
      setAddAddress('')
    })
  }

  const handleToggle = (id: string, enabled: boolean): void => {
    void mutate(() => setMasterSourceEnabled(id, enabled))
  }

  const handleRemove = (id: string): void => {
    void mutate(() => removeMasterSource(id))
  }

  const handleSaveAddress = (id: string, type: MasterSourceType, address: string): void => {
    void mutate(() => updateMasterSourceAddress({ id, type, address }))
  }

  const handleReorder = (nextSources: MasterSource[]): void => {
    void mutate(() => reorderMasterSources(nextSources.map((source) => source.id)))
  }

  /** Every scan-settings change goes through here: main's returned, merged+persisted settings
   * replace the whole local `scanSettings` state - never a locally-merged patch (this story's own
   * Decisions: "the section renders from main's truth"), same discipline as `mutate` above. */
  const applyScanPatch = async (patch: Partial<ServersScanSettings>): Promise<void> => {
    setScanError(null)
    const result = await patchScanSettings(patch)
    if (!result.ok) {
      setScanError(result.error)
      return
    }
    setScanSettings(result.value)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <label className="space-y-1.5">
          <span className="stencil block text-xs">
            {t('module.servers.settings.add.type.label')}
          </span>
          <Select
            value={addType}
            onChange={(event) => setAddType(event.target.value as MasterSourceType)}
            options={typeOptions}
            className="w-32"
            data-testid="servers-source-add-type"
          />
        </label>
        <label className="min-w-0 flex-1 space-y-1.5">
          <span className="stencil block text-xs">
            {t('module.servers.settings.add.address.label')}
          </span>
          <input
            value={addAddress}
            onChange={(event) => setAddAddress(event.target.value)}
            placeholder={t('module.servers.settings.add.address.placeholder')}
            className="h-9 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 text-sm text-ink"
            data-testid="servers-source-add-address"
          />
        </label>
        <Button
          variant="neutral"
          onClick={handleAdd}
          disabled={saving || addAddress.trim().length === 0}
          data-testid="servers-source-add-submit"
        >
          {t('module.servers.settings.add.submit')}
        </Button>
      </div>

      {error && (
        <p className="text-xs text-danger" data-testid="servers-source-error">
          {t(error.key, error.params)}
        </p>
      )}

      {sources && (
        <div data-testid="servers-sources-list">
          <SortableList
            items={sources}
            getItemId={(source) => source.id}
            onReorder={handleReorder}
            disabled={saving}
            className="space-y-1.5"
            aria-label={t('module.servers.settings.list.label')}
            renderItem={(source, dragState) => (
              <MasterSourceRow
                key={source.id}
                source={source}
                dragState={dragState}
                saving={saving}
                onToggle={handleToggle}
                onRemove={handleRemove}
                onSaveAddress={handleSaveAddress}
              />
            )}
          />
        </div>
      )}

      <div className="space-y-3 border-t border-line pt-3">
        <SectionLabel>{t('module.servers.settings.scan.heading')}</SectionLabel>

        {scanError && (
          <p className="text-xs text-danger" data-testid="servers-scan-settings-error">
            {t(scanError.key, scanError.params)}
          </p>
        )}

        <div data-testid="servers-scan-settings-auto-scan-on-open">
          <Switch
            label={t('module.servers.settings.scan.autoScanOnOpen.label')}
            checked={scanSettings?.autoScanOnOpen ?? false}
            disabled={!scanSettings}
            onChange={(autoScanOnOpen) => void applyScanPatch({ autoScanOnOpen })}
          />
        </div>

        <div data-testid="servers-scan-settings-auto-refresh-enabled">
          <Switch
            label={t('module.servers.settings.scan.autoRefreshEnabled.label')}
            checked={scanSettings?.autoRefreshEnabled ?? false}
            disabled={!scanSettings}
            onChange={(autoRefreshEnabled) => void applyScanPatch({ autoRefreshEnabled })}
          />
        </div>

        <label
          className="space-y-1.5 block"
          data-testid="servers-scan-settings-auto-refresh-interval"
        >
          <span className="stencil block text-xs">
            {t('module.servers.settings.scan.autoRefreshInterval.label')}
          </span>
          <Select
            value={scanSettings ? String(scanSettings.autoRefreshIntervalMs) : ''}
            disabled={!scanSettings || !scanSettings.autoRefreshEnabled}
            onChange={(event) =>
              void applyScanPatch({ autoRefreshIntervalMs: Number(event.target.value) })
            }
            options={SCAN_AUTO_REFRESH_INTERVAL_CHOICES_MS.map((value) => ({
              value: String(value),
              label: formatMsChoice(t, value),
            }))}
          />
        </label>

        <label className="space-y-1.5 block" data-testid="servers-scan-settings-concurrency">
          <span className="stencil block text-xs">
            {t('module.servers.settings.scan.concurrency.label')}
          </span>
          <Select
            value={scanSettings ? String(scanSettings.concurrency) : ''}
            disabled={!scanSettings}
            onChange={(event) => void applyScanPatch({ concurrency: Number(event.target.value) })}
            options={SCAN_CONCURRENCY_CHOICES.map((value) => ({
              value: String(value),
              label: String(value),
            }))}
          />
        </label>

        <label className="space-y-1.5 block" data-testid="servers-scan-settings-timeout">
          <span className="stencil block text-xs">
            {t('module.servers.settings.scan.timeout.label')}
          </span>
          <Select
            value={scanSettings ? String(scanSettings.timeoutMs) : ''}
            disabled={!scanSettings}
            onChange={(event) => void applyScanPatch({ timeoutMs: Number(event.target.value) })}
            options={SCAN_TIMEOUT_CHOICES_MS.map((value) => ({
              value: String(value),
              label: formatMsChoice(t, value),
            }))}
          />
        </label>

        <label className="space-y-1.5 block" data-testid="servers-scan-settings-retries">
          <span className="stencil block text-xs">
            {t('module.servers.settings.scan.retries.label')}
          </span>
          <Select
            value={scanSettings ? String(scanSettings.retries) : ''}
            disabled={!scanSettings}
            onChange={(event) => void applyScanPatch({ retries: Number(event.target.value) })}
            options={SCAN_RETRIES_CHOICES.map((value) => ({
              value: String(value),
              label: String(value),
            }))}
          />
        </label>

        <label className="space-y-1.5 block" data-testid="servers-scan-settings-min-spacing">
          <span className="stencil block text-xs">
            {t('module.servers.settings.scan.minSpacing.label')}
          </span>
          <Select
            value={scanSettings ? String(scanSettings.minSpacingMs) : ''}
            disabled={!scanSettings}
            onChange={(event) => void applyScanPatch({ minSpacingMs: Number(event.target.value) })}
            options={SCAN_MIN_SPACING_CHOICES_MS.map((value) => ({
              value: String(value),
              label: formatMsChoice(t, value),
            }))}
          />
        </label>
      </div>
    </div>
  )
}
