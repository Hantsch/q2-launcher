import { useTranslation } from 'react-i18next'
import { applyAutorecord, readAutorecord } from '@shared/config/catalog/autorecord'
import { engineLabel, type EngineKind } from '@shared/types/engine'
import { Switch } from '../../../components/ui/controls'
import type { EngineScopeStatus } from '../lib/engine-scope'

/**
 * Story 168 D2: the "record every map automatically" switch. The recipes live in
 * `@shared/config/catalog/autorecord`; this only reads the state, renders it and hands the caller the next
 * cvar map. When the recipe cannot apply the switch stays visible and disabled, with the reason as
 * visible text (platform/engine parity rule), never only a tooltip.
 */
export function AutorecordSetting({
  cvars,
  engine,
  scopeStatus,
  disabled,
  onChange,
}: {
  cvars: Record<string, string>
  engine: EngineKind | null
  scopeStatus: EngineScopeStatus
  disabled?: boolean
  onChange: (next: Record<string, string>) => void
}) {
  const { t } = useTranslation()
  const state = readAutorecord(cvars, engine)

  let reason = ''
  if (engine === null) reason = t('config.settings.autorecord.reasonNoEngine')
  else if (state.kind === 'unavailable')
    reason = t('config.settings.autorecord.reasonEngine', { engine: engineLabel(engine) })
  else if (scopeStatus !== 'ok') reason = t('config.settings.autorecord.reasonNoEngine')

  const available = state.kind === 'available' && reason === ''

  return (
    <div className="rounded-sm border border-line bg-raised/60 px-3 py-1">
      <Switch
        testId="config-autorecord-switch"
        checked={state.kind === 'available' && state.on}
        onChange={(on) => onChange(applyAutorecord(cvars, engine, on))}
        label={t('config.settings.autorecord.label')}
        hint={t('config.settings.autorecord.hint')}
        disabled={!available || disabled}
      />
      {available && state.kind === 'available' ? (
        <p data-testid="config-autorecord-caveat" className="pb-2 text-xs text-ink-muted">
          {state.engine === 'r1q2'
            ? t('config.settings.autorecord.caveatR1q2')
            : t('config.settings.autorecord.caveatQ2pro')}
        </p>
      ) : (
        <p data-testid="config-autorecord-reason" className="pb-2 text-xs text-ink-muted">
          {reason}
        </p>
      )}
    </div>
  )
}
