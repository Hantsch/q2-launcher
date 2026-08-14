import { useEffect, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigProfile } from '@shared/modules/config'
import type { EngineKind } from '@shared/types/engine'
import { engineLabel } from '@shared/types/engine'
import { Select } from '../../../components/ui/controls'
import { useLauncher } from '../../../store/useLauncher'
import { defaultScopeEngine, engineScope } from '../lib/engine-scope'

export interface EngineScopeSelectProps {
  profile: ConfigProfile
  /** The engine currently in scope, or `null` when none could be selected. */
  value: EngineKind | null
  /**
   * Reports the engine the rows below should resolve their facts against.
   * `null` is a real answer, not a missing one: it means the profile has no
   * assigned engine the catalog has facts for, and the caller must render that
   * as "no facts" rather than picking an engine of its own.
   */
  onChange: (engine: EngineKind | null) => void
}

/**
 * Picks which engine's defaults, clamps and value warnings the settings rows
 * show (AC 4).
 *
 * The candidates are derived here, in the renderer, from the profile's
 * assignments crossed with the mirrored installation list - there is no second
 * main-process handler for it (see the story's Decisions). Reading the
 * installations straight from the store mirrors `ProfileAssignmentsPanel`; the
 * derivation itself lives in `lib/engine-scope.ts` so this component and
 * `SettingsTab` cannot drift apart on it.
 *
 * Both empty cases get their own sentence and neither one falls back to r1q2.
 */
export function EngineScopeSelect({ profile, value, onChange }: EngineScopeSelectProps) {
  const { t } = useTranslation()
  const selectId = useId()
  const installations = useLauncher((state) => state.installations)
  const scope = useMemo(() => engineScope(profile, installations), [profile, installations])

  // Keep the selection valid as assignments and installations change: an
  // engine that is no longer assigned (or a `null` where something is now
  // selectable) is replaced by the default - r1q2 when assigned, otherwise the
  // first assigned engine with facts, otherwise `null`. Same repair idiom as
  // `ConfigView`'s `selectedId` effect.
  useEffect(() => {
    if (value !== null && scope.selectable.includes(value)) return
    const fallback = defaultScopeEngine(scope.selectable)
    if (fallback === value) return
    onChange(fallback)
  }, [scope, value, onChange])

  const names = (kinds: EngineKind[]): string => kinds.map(engineLabel).join(', ')

  if (scope.status !== 'ok') {
    return (
      <div className="rounded-sm border border-line px-3 py-2.5">
        <p className="stencil">{t('config.engineScope.label')}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {scope.status === 'unassigned' && t('config.engineScope.unassigned')}
          {scope.status === 'unresolved' && t('config.engineScope.unresolved')}
          {scope.status === 'noFacts' &&
            t('config.engineScope.noFacts', { engines: names(scope.assigned) })}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 rounded-sm border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <label className="stencil block" htmlFor={selectId}>
            {t('config.engineScope.label')}
          </label>
          <p className="text-xs leading-relaxed text-ink-muted">{t('config.engineScope.hint')}</p>
        </div>
        <div className="w-full sm:w-56">
          <Select
            id={selectId}
            options={scope.selectable.map((kind) => ({ value: kind, label: engineLabel(kind) }))}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value as EngineKind)}
          />
        </div>
      </div>

      {scope.omitted.length > 0 && (
        <p className="text-xs leading-relaxed text-ink-muted">
          {t('config.engineScope.omitted', { engines: names(scope.omitted) })}
        </p>
      )}
    </div>
  )
}
