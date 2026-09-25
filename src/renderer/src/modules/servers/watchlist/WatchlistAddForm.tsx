import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Outcome } from '@shared/types'
import { WATCHLIST_NAME_MAX, type WatchlistMatchMode } from '@shared/modules/servers'
import { Button } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/controls'
import type { WatchlistMutationResult } from '../client'

const MODE_OPTIONS: { value: WatchlistMatchMode; labelKey: string }[] = [
  { value: 'exact', labelKey: 'servers.watchlist.mode.exact' },
  { value: 'substring', labelKey: 'servers.watchlist.mode.substring' },
  { value: 'regex', labelKey: 'servers.watchlist.mode.regex' },
]

export interface WatchlistAddFormProps {
  add: (input: { name: string; mode: WatchlistMatchMode }) => Promise<Outcome<WatchlistMutationResult>>
}

/**
 * Story 132 D2: the watchlist's own add-a-name form, mirroring `ServersSettingsSection.tsx`'s
 * add-a-source form shape (type select + address input + submit, inline refusal rendered next to
 * the input) - here name + mode instead of type + address.
 */
export function WatchlistAddForm({ add }: WatchlistAddFormProps) {
  const { t } = useTranslation()
  const modeOptions = MODE_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))

  const [name, setName] = useState('')
  const [mode, setMode] = useState<WatchlistMatchMode>('exact')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return

    setSubmitting(true)
    const result = await add({ name, mode })
    setSubmitting(false)

    if (!result.ok) {
      setErrorKey(result.error.key)
      return
    }
    if (!result.value.ok) {
      setErrorKey(result.value.reasonKey)
      return
    }
    setErrorKey(null)
    setName('')
  }

  return (
    <div className="flex items-end gap-2">
      <label className="min-w-0 flex-1 space-y-1.5">
        <span className="stencil block text-xs">{t('servers.watchlist.add.name.label')}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('servers.watchlist.add.name.placeholder')}
          maxLength={WATCHLIST_NAME_MAX}
          className="h-9 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 text-sm text-ink"
          data-testid="servers-watchlist-add-name"
        />
      </label>
      <label className="space-y-1.5">
        <span className="stencil block text-xs">{t('servers.watchlist.add.mode.label')}</span>
        <Select
          value={mode}
          onChange={(event) => setMode(event.target.value as WatchlistMatchMode)}
          options={modeOptions}
          className="w-32"
          data-testid="servers-watchlist-add-mode"
        />
      </label>
      <Button
        variant="neutral"
        onClick={() => void handleSubmit()}
        disabled={submitting || name.trim().length === 0}
        data-testid="servers-watchlist-add-submit"
      >
        {t('servers.watchlist.add.submit')}
      </Button>

      {errorKey && (
        <p role="alert" className="text-xs text-danger" data-testid="servers-watchlist-add-error">
          {t(errorKey)}
        </p>
      )}
    </div>
  )
}
