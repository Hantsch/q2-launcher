import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import type { EngineKind } from '@shared/types/engine'
import { engineLabel } from '@shared/types/engine'
import type { CvarDef, EngineDisagreement, ResolvedCvar } from '@shared/config/cvar-facts'
import {
  engineDisagreement,
  hasEngineFacts,
  isCvarSupported,
  noteForValue,
  resolveCvar,
} from '@shared/config/cvar-facts'
import { cn } from '../../../lib/cn'
import { IconButton } from '../../../components/ui/Button'
import { Input, Select, Switch } from '../../../components/ui/controls'
import { Badge, type BadgeTone, KeyValue } from '../../../components/ui/primitives'

/**
 * Mirrors `FIELD_BASE` from `controls.tsx`. Kept local rather than exported
 * from there: `controls.tsx` is shared-component surface, and a numeric/
 * slider control is this module's own (see CLAUDE.md - a feature is a
 * module, never an edit to the shell).
 */
const NUMERIC_FIELD =
  'h-9 w-full rounded-sm border border-line-strong bg-void/60 px-2.5 text-sm text-ink numeric ' +
  'placeholder:text-ink-faint focus:border-flame-600 focus:outline-none ' +
  'transition-colors duration-[--dur-fast] disabled:opacity-50'

const NOTE_TONE: Record<'info' | 'warning' | 'error', BadgeTone> = {
  info: 'flame',
  warning: 'warning',
  error: 'danger',
}

export interface CvarRowProps {
  def: CvarDef
  /**
   * The engine currently in scope, or `null` when the profile has none the
   * catalog carries facts for (unassigned, or assigned only to out-of-scope
   * engines). `null` is rendered as an explicit "no engine facts" row - the
   * cvar stays listed and editable (AC 3) but no default, range or warning is
   * claimed, because substituting r1q2's numbers there would be a lie.
   */
  engine: EngineKind | null
  /** Current value, empty string for "unset" - falls back to the engine/catalog default for display. */
  value: string
  onChange: (value: string) => void
  /**
   * The other engines this profile is assigned to. Each one that disagrees
   * about this cvar earns a badge naming it (AC 4). Entries without facts, and
   * the scoped engine itself, are ignored by `engineDisagreement`.
   */
  otherAssignedEngines?: EngineKind[]
}

/** One editable row for a single cvar: label, description, control, engine facts and a reset action. */
export function CvarRow({ def, engine, value, onChange, otherAssignedEngines }: CvarRowProps) {
  const { t } = useTranslation()
  const controlId = useId()
  // Only an engine the catalog has facts for may drive defaults, ranges,
  // notes and the unsupported state. Any other engine (and `null`) resolves
  // against the def alone - which is what `resolveCvar` does for an engine
  // with no `byEngine` entry anyway, only here it is labelled as such instead
  // of passing the launcher's recommendation off as an engine default.
  const factEngine = engine !== null && hasEngineFacts(engine) ? engine : null
  const resolved = resolveCvar(def, engine ?? 'unknown')
  const disabled = factEngine !== null && !isCvarSupported(def, factEngine)
  const effectiveDefault = resolved.engineDefault ?? def.default
  const currentValue = value !== '' ? value : effectiveDefault
  const note =
    factEngine !== null && !disabled ? noteForValue(def, factEngine, currentValue) : undefined
  const hasRange = factEngine !== null && (resolved.min !== undefined || resolved.max !== undefined)
  const isToggle = def.kind === 'toggle'

  const disagreements: EngineDisagreement[] =
    factEngine !== null && !disabled
      ? (otherAssignedEngines ?? [])
          .map((other) => engineDisagreement(def, factEngine, other, currentValue))
          .filter((entry): entry is EngineDisagreement => entry !== undefined)
      : []

  const reset = (): void => onChange(effectiveDefault)

  const actions = (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {factEngine === null && <Badge tone="neutral">{t('config.cvar.noEngineFacts')}</Badge>}
      {disabled && <Badge tone="neutral">{t('config.cvar.notOnEngine')}</Badge>}
      {note && <Badge tone={NOTE_TONE[note.level]}>{t(note.messageKey)}</Badge>}
      {disagreements.map((entry) => (
        <Badge key={entry.engine} tone={disagreementTone(entry)}>
          {entry.absent
            ? t('config.cvar.absentOnEngine', { engine: engineLabel(entry.engine) })
            : t('config.cvar.differsOnEngine', { engine: engineLabel(entry.engine) })}
        </Badge>
      ))}
      <IconButton
        label={t('config.cvar.resetToDefault')}
        size="sm"
        onClick={reset}
        disabled={disabled}
      >
        <RotateCcw className="size-3.5" />
      </IconButton>
    </div>
  )

  return (
    <div
      className={cn(
        'space-y-2.5 rounded-sm border border-line px-3 py-2.5',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {isToggle ? (
          <div className="min-w-0 flex-1">
            <Switch
              checked={currentValue === '1' || currentValue.trim().toLowerCase() === 'true'}
              onChange={(next) => onChange(next ? '1' : '0')}
              label={t(def.labelKey)}
              hint={t(def.descriptionKey)}
              disabled={disabled}
            />
          </div>
        ) : (
          <div className="min-w-0 space-y-0.5">
            <label htmlFor={controlId} className="block text-sm text-ink">
              {t(def.labelKey)}
            </label>
            <p className="text-xs leading-relaxed text-ink-muted">{t(def.descriptionKey)}</p>
          </div>
        )}
        {actions}
      </div>

      {def.warningKey && !disabled && <p className="text-xs text-warning">{t(def.warningKey)}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        {isToggle ? (
          <div />
        ) : (
          <CvarControl
            def={def}
            resolved={resolved}
            controlId={controlId}
            value={value}
            effectiveDefault={effectiveDefault}
            disabled={disabled}
            onChange={onChange}
          />
        )}

        <div className="flex flex-col justify-center gap-1 sm:min-w-[168px]">
          <KeyValue label={t('config.cvar.currentValue')} mono>
            {currentValue}
          </KeyValue>
          <KeyValue
            label={
              factEngine !== null
                ? t('config.cvar.engineDefault')
                : t('config.cvar.recommendedDefault')
            }
            mono
          >
            {effectiveDefault}
          </KeyValue>
          {hasRange && (
            <KeyValue label={t('config.cvar.range')} mono>
              {formatRange(resolved.min, resolved.max)}
            </KeyValue>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * How loud a cross-engine disagreement is: a value the other engine actively
 * warns or errors about carries that engine's severity, while a merely
 * different default, range or a cvar the other engine does not have is
 * information, not a problem with the current value.
 */
function disagreementTone(entry: EngineDisagreement): BadgeTone {
  if (entry.note) return NOTE_TONE[entry.note.level]
  return 'neutral'
}

function formatRange(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return `${min}–${max}`
  if (min !== undefined) return `≥${min}`
  if (max !== undefined) return `≤${max}`
  return '-'
}

/** The kind-specific editing control for every kind except `toggle` (handled inline via `Switch`). */
function CvarControl({
  def,
  resolved,
  controlId,
  value,
  effectiveDefault,
  disabled,
  onChange,
}: {
  def: CvarDef
  resolved: ResolvedCvar
  controlId: string
  value: string
  effectiveDefault: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const displayValue = value !== '' ? value : effectiveDefault

  if (def.kind === 'choice') {
    const options = resolved.choices.map((choice) => ({ value: choice.value, label: t(choice.labelKey) }))
    return (
      <Select
        id={controlId}
        options={options}
        value={displayValue}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  if (def.kind === 'number' || def.kind === 'slider') {
    const min = resolved.min ?? def.min
    const max = resolved.max ?? def.max
    const step = def.step

    if (def.kind === 'slider' && min !== undefined && max !== undefined) {
      return (
        <div className="flex items-center gap-3">
          <input
            id={controlId}
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number(displayValue) || min}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="h-1.5 w-full flex-1 accent-flame-500 disabled:opacity-50"
          />
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={displayValue}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className={cn(NUMERIC_FIELD, 'w-24 shrink-0')}
          />
        </div>
      )
    }

    return (
      <input
        id={controlId}
        type="number"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={NUMERIC_FIELD}
      />
    )
  }

  return (
    <Input
      id={controlId}
      type="text"
      value={displayValue}
      placeholder={effectiveDefault}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
