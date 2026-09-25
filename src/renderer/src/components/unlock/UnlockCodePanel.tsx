import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import type { RedeemResult, UnlockState } from '@shared/types'
import { invoke } from '../../lib/bridge'
import { Button, IconButton } from '../ui/Button'

/**
 * Story 129 D2: the Settings panel that lets a user see their installation id, send a code
 * through `unlock:redeem`, and see what they already have. Mirrors `ServersSettingsSection.tsx`'s
 * load-on-mount pattern and `FailureLogEntry.tsx`'s copy + transient confirmation pattern.
 *
 * Deliberately dense and single-surface - no wizard, no multi-step flow. A rejection renders one of
 * five distinct i18n keys (never a generic fallback), an acceptance lists what it unlocked and
 * when it stops, and the stored-codes list always reflects main's truth after a successful redeem.
 */
export function UnlockCodePanel() {
  const { t, i18n } = useTranslation()

  const [state, setState] = useState<UnlockState | null>(null)
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<RedeemResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('unlock:getState').then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function handleCopy() {
    if (!state || state.installationId === '') return
    void invoke('app:copyText', state.installationId).then((outcome) => {
      if (!outcome.ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleSubmit() {
    const value = code.trim()
    if (value === '' || submitting) return
    setSubmitting(true)
    setResult(null)
    void invoke('unlock:redeem', value).then((outcome) => {
      setSubmitting(false)
      if (!outcome.ok) return
      setResult(outcome.value)
      if (outcome.value.ok) {
        setCode('')
        void invoke('unlock:getState').then((next) => setState(next))
      }
    })
  }

  function formatExpiry(featureExpiry: number | null): string {
    if (featureExpiry === null) return t('settings.unlock.noExpiry')
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(featureExpiry)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="stencil text-xs">{t('settings.unlock.installationId.label')}</span>
          <code
            className="rounded-sm border border-line-strong bg-void/60 px-2 py-0.5 font-mono text-xs text-ink"
            data-testid="unlock-installation-id"
          >
            {state?.installationId ?? ''}
          </code>
          <IconButton
            label={
              copied ? t('settings.unlock.installationId.copied') : t('settings.unlock.installationId.copy')
            }
            size="sm"
            onClick={handleCopy}
            disabled={!state || state.installationId === ''}
            data-testid="unlock-copy-id"
          >
            <Copy className="size-3.5" />
          </IconButton>
          {copied && (
            <span className="text-xs text-ink-muted">{t('settings.unlock.installationId.copied')}</span>
          )}
        </div>
        <p className="text-xs text-ink-muted">{t('settings.unlock.installationId.hint')}</p>
      </div>

      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1.5">
          <span className="stencil block text-xs">{t('settings.unlock.code.label')}</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSubmit()
            }}
            placeholder={t('settings.unlock.code.placeholder')}
            className="h-9 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 text-sm text-ink"
            data-testid="unlock-code-input"
          />
        </label>
        <Button
          variant="neutral"
          onClick={handleSubmit}
          disabled={submitting || code.trim().length === 0}
          data-testid="unlock-code-submit"
        >
          {t('settings.unlock.code.submit')}
        </Button>
      </div>

      {result && !result.ok && (
        <p className="text-xs text-danger" role="alert" data-testid="unlock-result-rejected">
          {t(`settings.unlock.reject.${result.reason}`)}
        </p>
      )}

      {result && result.ok && (
        <div className="space-y-1 text-xs text-ink" role="status" data-testid="unlock-result-accepted">
          <ul className="list-disc pl-4">
            {result.code.features.map((feature) => (
              <li key={feature}>{t(`unlock.feature.${feature}`, { defaultValue: feature })}</li>
            ))}
          </ul>
          <p className="text-ink-muted">{formatExpiry(result.code.featureExpiry)}</p>
          <p className="text-ink-muted">{t('settings.unlock.takesEffectNextStart')}</p>
        </div>
      )}

      {state && state.codes.length > 0 && (
        <ul className="space-y-1.5" data-testid="unlock-codes">
          {state.codes.map((entry, index) => (
            <li
              key={index}
              className="space-y-0.5 rounded-sm border border-line-strong bg-void/40 p-2 text-xs"
              data-testid="unlock-code-row"
            >
              <div className="flex flex-wrap items-center gap-1.5 text-ink">
                {entry.label && <span className="font-medium">{entry.label}</span>}
                <span>
                  {entry.features
                    .map((feature) => t(`unlock.feature.${feature}`, { defaultValue: feature }))
                    .join(', ')}
                </span>
              </div>
              {entry.status === 'expired' ? (
                <p className="text-ink-muted">
                  {t('settings.unlock.expired', { date: formatExpiry(entry.featureExpiry) })}
                </p>
              ) : (
                <p className="text-ink-muted">{formatExpiry(entry.featureExpiry)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
