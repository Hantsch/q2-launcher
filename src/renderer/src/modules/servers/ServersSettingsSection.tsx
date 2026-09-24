import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocalizedMessage, Outcome } from '@shared/types'
import type { MasterSource, MasterSourcesResult, MasterSourceType } from '@shared/modules/servers'
import { SortableList } from '../../components/dnd'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/controls'
import {
  addMasterSource,
  listMasterSources,
  removeMasterSource,
  reorderMasterSources,
  setMasterSourceEnabled,
  updateMasterSourceAddress,
} from './client'
import { MasterSourceRow } from './MasterSourceRow'

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
    </div>
  )
}
