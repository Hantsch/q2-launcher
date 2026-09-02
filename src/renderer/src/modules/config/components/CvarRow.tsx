import { useId } from 'react'
import { useTranslation } from 'react-i18next'
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
import { effectiveDefaultFor, isChanged, normalizeCvarValue } from '../lib/cvar-rows'
import { cn } from '../../../lib/cn'
import { Input, Select } from '../../../components/ui/controls'
import { Badge, type BadgeTone } from '../../../components/ui/primitives'

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

/**
 * `NUMERIC_FIELD` with `w-full` swapped for a fixed `w-16` - the slider's numeric companion field
 * needs a narrow, non-growing width so the `<input type="range">` next to it can actually claim the
 * remaining flex space. `cn` (`lib/cn.ts`) is plain clsx with no tailwind-merge dedup, so appending
 * `w-16` after `NUMERIC_FIELD`'s own `w-full` in a className string does not override it - both
 * classes survive in the compiled CSS and `w-full` wins by stylesheet position, collapsing the range
 * input to 0px (review finding). Built from `NUMERIC_FIELD` via substring replace rather than a
 * hand-copied second literal, so the two constants cannot drift on the non-width styling.
 */
const SLIDER_NUMERIC_FIELD = NUMERIC_FIELD.replace('w-full', 'w-16 shrink-0')

const NOTE_TONE: Record<'info' | 'warning' | 'error', BadgeTone> = {
  info: 'flame',
  warning: 'warning',
  error: 'danger',
}

/** Badge word per note level - the tone carries the same information in colour, never alone. */
const NOTE_BADGE: Record<'info' | 'warning' | 'error', string> = {
  info: 'config.cvar.flag.note',
  warning: 'config.cvar.flag.caution',
  error: 'config.cvar.flag.problem',
}

/** One inline caveat: a badge word plus one sentence, spanning the whole row (story 021 D3). */
interface RowFlag {
  key: string
  tone: BadgeTone
  badge: string
  text: string
}

/** Fixed dense-row grid: label · control · value (story 021 D2; the reset column was removed in
 * story 048 D5). */
const ROW_GRID = 'grid-cols-[minmax(0,1fr)_250px_108px]'

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
  /**
   * Story 048 D6: whether this row's value differs from `useProfileDraft`'s saved-cvars baseline -
   * "edited and unsaved," not "differs from the catalogue default" (that stays `isChanged`, used
   * below only for the default-value text). Computed by the caller (`SettingsTab`'s
   * `buildCvarGroups` call), not here, so the filter/counters/this border always read the exact
   * same predicate rather than three separate re-implementations of it.
   */
  edited: boolean
  onChange: (value: string) => void
  /**
   * The other engines this profile is assigned to. Each one that disagrees
   * about this cvar earns a badge naming it (AC 4). Entries without facts, and
   * the scoped engine itself, are ignored by `engineDisagreement`.
   */
  otherAssignedEngines?: EngineKind[]
}

/**
 * One dense grid row for a single cvar: label + mono name + one-line
 * description, the kind-specific control and a two-line value/default cell
 * (story 021 D2 - prototype `docs/prototypes/settings/a-dense-rows.html`; the
 * per-row reset button was removed in story 048 D5, the default-value text
 * stays).
 *
 * Engine caveats (story 021 D3) are full-width flag sub-rows below the three
 * columns - badge word plus one sentence, one row per caveat: the def's own
 * engine-independent caution, what the engine in scope says about this exact
 * value, an out-of-range/clamp breach, and one row per other assigned engine
 * that disagrees, naming that engine and its numbers. A cvar the engine in
 * scope does not have gets no flag at all: the row is dimmed, the control is
 * disabled and the value cell reads "not on <engine>", which says it more
 * plainly than a badge would.
 *
 * The honesty rule from story 009 is what shapes all of it: every
 * engine-specific line here is gated on an engine that is in scope *and*
 * source-cited (`factEngine`), and the numbers printed come from that engine's
 * own `byEngine` entry - never from `def.min`/`def.max`/`def.default`, which
 * are the launcher's recommendation and belong to no engine. With no engine in
 * scope the only flag that can appear is `def.warningKey`, and the explicit
 * "no engine in scope" note lives once above the list in `EngineScopeSelect`
 * rather than being repeated on all 30 rows.
 */
export function CvarRow({ def, engine, value, edited, onChange, otherAssignedEngines }: CvarRowProps) {
  const { t } = useTranslation()
  const controlId = useId()
  const labelId = useId()
  // Only an engine the catalog has facts for may drive defaults, ranges,
  // notes and the unsupported state. Any other engine (and `null`) resolves
  // against the def alone - which is what `resolveCvar` does for an engine
  // with no `byEngine` entry anyway, only here it is labelled as such instead
  // of passing the launcher's recommendation off as an engine default.
  const factEngine = engine !== null && hasEngineFacts(engine) ? engine : null
  const resolved = resolveCvar(def, engine ?? 'unknown')
  // The engine this cvar is absent on, or `null` - kept as the engine rather
  // than a boolean so the value cell can name it ("not on r1q2") without
  // re-narrowing `factEngine`.
  const absentOn: EngineKind | null =
    factEngine !== null && !isCvarSupported(def, factEngine) ? factEngine : null
  const disabled = absentOn !== null
  const effectiveDefault = effectiveDefaultFor(def, engine)
  const currentValue = value !== '' ? value : effectiveDefault
  const changed = isChanged(def, engine, value)
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

  /**
   * The clamp bounds `factEngine` itself enforces, read from its own
   * `byEngine` entry instead of from `resolved.min`/`resolved.max`.
   *
   * Those two fall back to `def.min`/`def.max` when the engine has no override
   * (`resolveCvar`), and `def.min`/`def.max` are documented as the widest range
   * across all engines - the launcher's own recommendation, not a number any
   * engine was read to enforce. Printing them as "<engine> clamps <cvar> to
   * ..." would be exactly the attribution story 009's honesty rule forbids, so
   * an out-of-range flag is only raised against bounds the catalog actually
   * cites for this engine.
   */
  const engineBounds = factEngine !== null ? def.byEngine?.[factEngine] : undefined
  // A value note already explains what the engine does with this exact value,
  // so the range check is skipped for it - the same "not reported twice" rule
  // `validate-cvars.ts` (story 009 D4) applies on the Validation tab.
  const breach =
    !disabled && note === undefined && engineBounds !== undefined
      ? boundBreach(engineBounds.min, engineBounds.max, currentValue)
      : undefined

  /**
   * One sentence per way `entry`'s engine disagrees, naming that engine and its
   * own numbers. Same override-only rule as `engineBounds` above: the other
   * engine's range and default come from *its* `byEngine` entry, never from the
   * def-level fallbacks `resolveCvar` would fill in for an engine the catalog
   * records nothing about.
   */
  const disagreementText = (entry: EngineDisagreement): string => {
    const other = engineLabel(entry.engine)
    if (entry.absent) return t('config.cvar.flag.otherAbsent', { engine: other, name: def.name })

    const override = def.byEngine?.[entry.engine]
    const sentences: string[] = []

    if (entry.defaultDiffers && override?.engineDefault !== undefined) {
      sentences.push(
        t('config.cvar.flag.otherDefault', { engine: other, value: override.engineDefault }),
      )
    }
    if (entry.rangeDiffers) {
      sentences.push(
        override?.min !== undefined || override?.max !== undefined
          ? t('config.cvar.flag.otherRange', {
              engine: other,
              range: formatRange(override?.min, override?.max),
            })
          : t('config.cvar.flag.otherNoRange', { engine: other, name: def.name }),
      )
    }
    if (entry.valueMeaningDiffers) {
      // Includes the other engine's `info` notes, which `EngineDisagreement.note`
      // deliberately drops (`foreignNotesForValue`'s "info notes don't travel"
      // rule): "0 means unlimited on Q2PRO" is the whole point of the flag when
      // the same 0 is an error on the engine in scope.
      const otherNote = noteForValue(def, entry.engine, currentValue)
      sentences.push(
        otherNote
          ? t('config.cvar.flag.otherNote', { engine: other, message: t(otherNote.messageKey) })
          : t('config.cvar.flag.otherPlainValue', { engine: other, value: currentValue }),
      )
    }
    return sentences.join(' ')
  }

  // Order: the engine-independent caution first, then what the engine in scope
  // says about this value, then what the other assigned engines say. Every
  // engine-specific entry below is gated on `factEngine`/`!disabled`, so a
  // profile with no engine in scope can only ever show `def.warningKey` - which
  // claims nothing about any engine.
  const flags: RowFlag[] = []

  if (def.warningKey && !disabled) {
    flags.push({
      key: 'caution',
      tone: 'warning',
      badge: t('config.cvar.flag.caution'),
      text: t(def.warningKey),
    })
  }
  if (note) {
    flags.push({
      key: 'note',
      tone: NOTE_TONE[note.level],
      badge: t(NOTE_BADGE[note.level]),
      text: t(note.messageKey),
    })
  }
  if (breach !== undefined && factEngine !== null) {
    const params = {
      engine: engineLabel(factEngine),
      name: def.name,
      value: currentValue,
      range: formatRange(engineBounds?.min, engineBounds?.max),
      bound: breach,
    }
    flags.push({
      key: 'range',
      tone: 'warning',
      badge: t('config.cvar.flag.outOfRangeBadge'),
      text: resolved.clamps
        ? t('config.cvar.flag.clamped', params)
        : t('config.cvar.flag.outOfRange', params),
    })
  }
  for (const entry of disagreements) {
    const text = disagreementText(entry)
    if (text === '') continue
    flags.push({
      key: `engine-${entry.engine}`,
      tone: disagreementTone(entry),
      badge: t('config.cvar.flag.enginesBadge'),
      text,
    })
  }

  /**
   * Whether the numbers `valueDetail` is about to print for this cvar came from `factEngine`'s own
   * `byEngine` entry, as opposed to `def.min`/`def.max` (the catalog's widest-range recommendation,
   * attributed to no engine). `resolved.min`/`resolved.max` (used below) fall back to the def-level
   * numbers whenever `byEngine` has none, so printing them next to the engine's name unconditionally
   * would risk reading as an engine claim the catalog never made for this specific cvar (review
   * finding) - `engineBounds` is already the override-only lookup that avoids exactly that mistake
   * elsewhere in this file.
   */
  const hasCvarEngineFacts = engineBounds !== undefined
  const valueDetailLabel =
    factEngine !== null && hasRange
      ? hasCvarEngineFacts
        ? t('config.cvar.engineDefault')
        : t('config.cvar.recommendedDefault')
      : undefined

  const valueDetail = changed
    ? hasRange
      ? `${effectiveDefault} · ${formatRange(resolved.min, resolved.max)}`
      : effectiveDefault
    : t('config.cvar.equalsDefault')

  const valueDetailTitle = valueDetailLabel ? `${valueDetailLabel}: ${valueDetail}` : valueDetail

  const absentLabel =
    absentOn !== null ? t('config.cvar.notOnEngine', { engine: engineLabel(absentOn) }) : ''

  return (
    <div
      className={cn(
        'grid items-center gap-3.5 border-b border-line border-l-2 px-3 py-1.5',
        ROW_GRID,
        'min-h-11',
        edited ? 'border-l-flame-600' : 'border-l-transparent',
        disabled && 'opacity-50',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span id={labelId} className="truncate text-sm text-ink">
            {t(def.labelKey)}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-ink-faint">{def.name}</span>
        </div>
        {/*
          Written out in full rather than truncated-with-hover-expand: the row simply grows to fit
          (each row sizes itself independently, no shared grid track), so a long description does
          not require a hover interaction that used to jump the layout.
        */}
        <p className="text-xs leading-snug text-ink-muted">{t(def.descriptionKey)}</p>
      </div>

      <div className="min-w-0">
        {isToggle ? (
          <ToggleControl
            checked={normalizeCvarValue(def, currentValue) === '1'}
            onChange={(next) => onChange(next ? '1' : '0')}
            disabled={disabled}
            labelledBy={labelId}
          />
        ) : (
          <CvarControl
            def={def}
            resolved={resolved}
            controlId={controlId}
            labelledBy={labelId}
            value={value}
            effectiveDefault={effectiveDefault}
            disabled={disabled}
            onChange={onChange}
          />
        )}
      </div>

      <div className="min-w-0 text-right text-xs leading-tight">
        {absentOn !== null ? (
          // No effective value and no default: the engine in scope never
          // registers this cvar, so there is nothing here it would apply.
          <div className="truncate text-ink-faint" title={absentLabel}>
            {absentLabel}
          </div>
        ) : (
          <>
            <div className="numeric truncate text-ink" title={currentValue} data-selectable>
              {currentValue}
            </div>
            <div className="numeric truncate text-ink-faint" title={valueDetailTitle}>
              {valueDetail}
            </div>
          </>
        )}
      </div>

      {flags.map((flag) => (
        <div key={flag.key} className="col-span-3 flex items-start gap-2 pt-0.5 pb-1">
          <Badge tone={flag.tone} className="mt-px shrink-0">
            {flag.badge}
          </Badge>
          <p className="min-w-0 text-[11.5px] leading-snug text-ink-dim">{flag.text}</p>
        </div>
      ))}
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

/**
 * The bound `value` breaks, or `undefined` when it is inside `min`/`max` (or is
 * not a number at all - a text value has no range to break).
 *
 * Mirrors the numeric half of `validate-cvars.ts`'s range check so the inline
 * flag and the Validation tab cannot disagree about what "out of range" means;
 * the caller supplies engine-cited bounds only (see `engineBounds`).
 */
function boundBreach(
  min: number | undefined,
  max: number | undefined,
  value: string,
): number | undefined {
  const numeric = Number(value)
  if (value.trim() === '' || !Number.isFinite(numeric)) return undefined
  if (min !== undefined && numeric < min) return min
  if (max !== undefined && numeric > max) return max
  return undefined
}

function formatRange(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return `${min}–${max}`
  if (min !== undefined) return `≥${min}`
  if (max !== undefined) return `≤${max}`
  return '-'
}

/**
 * A bare toggle switch with no built-in label - the shared `Switch`
 * (`components/ui/controls.tsx`) always renders its own label/hint row,
 * which would duplicate the row's label column here. Mirrors `Switch`'s
 * visual markup locally rather than editing the shell primitive for one
 * caller (same rationale as `NUMERIC_FIELD` above).
 */
function ToggleControl({
  checked,
  onChange,
  disabled,
  labelledBy,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  labelledBy: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-[--dur-fast]',
        checked ? 'border-flame-600 bg-flame-700' : 'border-line-strong bg-void',
        disabled && 'pointer-events-none opacity-45',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-3.5 rounded-full transition-[left] duration-[--dur-fast] ease-[--ease-out-quart]',
          checked ? 'left-4.5 bg-flame-200' : 'left-0.5 bg-ink-muted',
        )}
      />
    </button>
  )
}

/** The kind-specific editing control for every kind except `toggle` (handled via `ToggleControl`). */
function CvarControl({
  def,
  resolved,
  controlId,
  labelledBy,
  value,
  effectiveDefault,
  disabled,
  onChange,
}: {
  def: CvarDef
  resolved: ResolvedCvar
  controlId: string
  labelledBy: string
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
        aria-labelledby={labelledBy}
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
        <div className="flex items-center gap-2.5">
          <input
            id={controlId}
            aria-labelledby={labelledBy}
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number(displayValue) || min}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="h-1.5 min-w-0 flex-1 accent-flame-500 disabled:opacity-50"
          />
          <input
            aria-label={t('config.cvar.currentValue')}
            type="number"
            min={min}
            max={max}
            step={step}
            value={displayValue}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className={SLIDER_NUMERIC_FIELD}
          />
        </div>
      )
    }

    return (
      <input
        id={controlId}
        aria-labelledby={labelledBy}
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
      aria-labelledby={labelledBy}
      type="text"
      value={displayValue}
      placeholder={effectiveDefault}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
