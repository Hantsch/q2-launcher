/**
 * Cvar fact types and the per-engine resolver.
 *
 * Ported from the external q2-config-manager project
 * (`src/core/settings.ts`), generalized to this launcher's ten-way
 * `EngineKind` instead of upstream's three-way `EngineId`. Every number,
 * range and `source:` citation in `cvar-catalog.ts` was read out of engine
 * source and copied verbatim from upstream — that is the only way this data
 * stays trustworthy. Upstream's free-text prose (`label`, `description`,
 * `note`, `warning`, value-note `meaning`, choice `label`) is replaced here
 * by i18n key fields; the English text lives in
 * `src/renderer/src/i18n/locales/en.json` under `config.cvar.*`.
 *
 * `byEngine` is where engines are allowed to disagree. A cvar can be absent,
 * start from a different engine default, clamp to a different range, or —
 * the nastiest case — accept the same value and do something completely
 * different with it. `r_maxfps 0` means "unlimited" on Q2PRO and "5 FPS" on
 * R1Q2.
 */

import type { EngineKind } from '../types/engine'

export type CvarKind = 'text' | 'number' | 'slider' | 'toggle' | 'choice'

export interface CvarChoice {
  value: string
  labelKey: string
}

/**
 * A value whose effect is not what the control's range suggests.
 *
 * This exists for exactly the class of bug that a min/max cannot express: a
 * magic value inside (or just outside) the normal range that the engine
 * treats specially. `level` is how bad it is on *this* engine.
 */
export interface EngineValueNote {
  /** Exact cvar value this applies to, compared as a number when both parse. */
  value: string
  /** i18n key for what the engine actually does with it, in full sentences. */
  messageKey: string
  level: 'info' | 'warning' | 'error'
}

export interface EngineOverride {
  /** The engine never registers this cvar; setting it does nothing. */
  absent?: boolean
  /** Value the engine itself registers the cvar with. */
  engineDefault?: string
  /** Lower bound the engine enforces. */
  min?: number
  /** Upper bound the engine enforces. */
  max?: number
  /**
   * True when out-of-range values are silently clamped rather than
   * rejected. Worth distinguishing: a clamped value looks like it was
   * accepted.
   */
  clamps?: boolean
  valueNotes?: EngineValueNote[]
  /** Values only this engine understands, offered in addition to `choices`. */
  extraChoices?: CvarChoice[]
  /** i18n key for anything else about this cvar on this engine, shown in the UI. */
  noteKey?: string
  /**
   * Engine source file, symbol and line the facts above were read from.
   * Kept as a literal, untranslated string — same precedent as
   * `EngineDefinition.label`.
   */
  source?: string
}

export interface CvarDef {
  name: string
  labelKey: string
  kind: CvarKind
  group: 'player' | 'graphics' | 'sound' | 'network'
  descriptionKey: string
  /** What this app recommends, independent of what the engine starts with. */
  default: string
  /** Widest range across all engines; per-engine bounds live in `byEngine`. */
  min?: number
  max?: number
  step?: number
  choices?: CvarChoice[]
  /** i18n key for a caution shown in the UI regardless of engine. */
  warningKey?: string
  /** Surfaced in the simple view; the rest live behind "Show all options". */
  common?: boolean
  byEngine?: Partial<Record<EngineKind, EngineOverride>>
}

export interface ResolvedCvar {
  def: CvarDef
  engine: EngineKind
  /** The engine does not know this cvar; writing it has no effect. */
  absent: boolean
  /** Effective bounds on this engine, narrowed from the def where known. */
  min?: number
  max?: number
  clamps: boolean
  engineDefault?: string
  /** Base choices plus anything only this engine accepts. */
  choices: CvarChoice[]
  valueNotes: EngineValueNote[]
  noteKey?: string
  source?: string
}

/**
 * Fixed group order the whole app agrees on (story 040 D1): the Settings tab's own
 * `GROUP_ORDER`/`GROUP_LABEL_KEY` (`SettingsTab.tsx`, `cvar-rows.ts`) now import this rather than
 * keeping a second copy, and the config-file writer (`render.ts`, D2) sections cvars by it too -
 * one order, not two that could drift apart.
 */
export const CVAR_GROUP_ORDER: readonly CvarDef['group'][] = ['player', 'network', 'graphics', 'sound']

/**
 * Plain ASCII English label per cvar group (story 040 D1). The renderer keeps resolving its own
 * group headers through i18n (`config.settings.groups.*`) unchanged - this is for the config-file
 * writer, which runs in main too and can never import i18n (see that story's Decisions). Pinned
 * against the matching `en.json` strings by `comment-labels.test.ts`.
 */
export const CVAR_GROUP_LABELS: Readonly<Record<CvarDef['group'], string>> = {
  player: 'Player',
  network: 'Network',
  graphics: 'Graphics',
  sound: 'Sound',
}

/** The three engines the catalog carries source-cited facts for. */
const ENGINE_KINDS_WITH_FACTS: readonly EngineKind[] = ['r1q2', 'q2pro', 'vanilla']

/** `true` only for the engines the catalog has facts for; `false` for every other `EngineKind`. */
export function hasEngineFacts(kind: EngineKind): boolean {
  return ENGINE_KINDS_WITH_FACTS.includes(kind)
}

export function resolveCvar(def: CvarDef, engine: EngineKind): ResolvedCvar {
  const override = def.byEngine?.[engine]
  const min = override?.min ?? def.min
  const max = override?.max ?? def.max

  return {
    def,
    engine,
    absent: override?.absent === true,
    clamps: override?.clamps === true,
    choices: [...(def.choices ?? []), ...(override?.extraChoices ?? [])],
    valueNotes: override?.valueNotes ?? [],
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(override?.engineDefault !== undefined ? { engineDefault: override.engineDefault } : {}),
    ...(override?.noteKey !== undefined ? { noteKey: override.noteKey } : {}),
    ...(override?.source !== undefined ? { source: override.source } : {}),
  }
}

export function isCvarSupported(def: CvarDef, engine: EngineKind): boolean {
  return def.byEngine?.[engine]?.absent !== true
}

/** Compare two cvar values the way the engine would: numerically if possible. */
function sameValue(a: string, b: string): boolean {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The note that applies to `value` on `engine`, if the engine has one. */
export function noteForValue(def: CvarDef, engine: EngineKind, value: string): EngineValueNote | undefined {
  return def.byEngine?.[engine]?.valueNotes?.find((n) => sameValue(n.value, value))
}

/**
 * Whether `engine` accepts `value` for a choice-style cvar.
 *
 * Only meaningful for cvars whose accepted values the engine parses by name
 * (gl_texturemode being the one that matters): an unknown name is not an
 * error there, the engine just keeps its previous setting.
 */
export function isChoiceAccepted(def: CvarDef, engine: EngineKind, value: string): boolean {
  if (def.kind !== 'choice' || !def.choices) return true
  return resolveCvar(def, engine).choices.some((c) => sameValue(c.value, value))
}

/** Engines (among those the catalog has facts for) whose value list contains `value`. */
export function enginesAcceptingChoice(def: CvarDef, value: string): EngineKind[] {
  if (def.kind !== 'choice' || !def.choices) return []
  return ENGINE_KINDS_WITH_FACTS.filter(
    (engine) => isCvarSupported(def, engine) && isChoiceAccepted(def, engine, value),
  )
}

export interface ForeignValueNote {
  engine: EngineKind
  note: EngineValueNote
}

/**
 * Notes that other engines attach to this value.
 *
 * Configs get handed to team mates, so a value that is harmless on the
 * engine the profile targets and destructive on another is worth saying out
 * loud. The caller can turn `engine` into a display label via `engineLabel()`
 * in `src/shared/types/engine.ts`.
 */
export function foreignNotesForValue(def: CvarDef, engine: EngineKind, value: string): ForeignValueNote[] {
  const out: ForeignValueNote[] = []
  for (const other of Object.keys(def.byEngine ?? {}) as EngineKind[]) {
    if (other === engine) continue
    const note = noteForValue(def, other, value)
    if (note && note.level !== 'info') {
      out.push({ engine: other, note })
    }
  }
  return out
}

/** What a second engine does differently with the same cvar and the same value. */
export interface EngineDisagreement {
  /** The other engine, i.e. not the one currently in scope. */
  engine: EngineKind
  /** The other engine does not know this cvar at all. */
  absent: boolean
  /** Both engines register the cvar, with different values. */
  defaultDiffers: boolean
  /** The effective clamp range is not the same on both engines. */
  rangeDiffers: boolean
  /**
   * The two engines do not say the same thing about *this* value - one
   * documents it specially and the other does not, or both do but differently.
   * `r_maxfps 0` is the case this exists for: an error on R1Q2 ("5 FPS"), a
   * perfectly normal "unlimited" on Q2PRO.
   */
  valueMeaningDiffers: boolean
  /** A warning/error the other engine attaches to exactly this value. */
  note?: EngineValueNote
}

/**
 * Whether `other` disagrees with `engine` about `def` at `value`.
 *
 * The value-note half is `foreignNotesForValue` narrowed to one engine (same
 * "info notes don't count" rule); the structural half is the comparison that
 * function cannot make - a differing engine default or clamp range is a
 * disagreement even when the current value happens to be unremarkable on both
 * engines.
 *
 * Returns `undefined` - "no claim" rather than "they agree" - when either side
 * has no source-cited facts, when both sides are the same engine, or when the
 * cvar is already absent on the engine in scope (that row says so itself).
 * Engine defaults are only compared when *both* engines record one: comparing
 * a known default against an unrecorded one would report a difference the
 * catalog never established.
 */
export function engineDisagreement(
  def: CvarDef,
  engine: EngineKind,
  other: EngineKind,
  value: string,
): EngineDisagreement | undefined {
  if (other === engine) return undefined
  if (!hasEngineFacts(engine) || !hasEngineFacts(other)) return undefined

  const here = resolveCvar(def, engine)
  if (here.absent) return undefined

  const there = resolveCvar(def, other)
  if (there.absent) {
    return {
      engine: other,
      absent: true,
      defaultDiffers: false,
      rangeDiffers: false,
      valueMeaningDiffers: false,
    }
  }

  const defaultDiffers =
    here.engineDefault !== undefined &&
    there.engineDefault !== undefined &&
    !sameValue(here.engineDefault, there.engineDefault)
  const rangeDiffers = here.min !== there.min || here.max !== there.max
  const valueMeaningDiffers =
    noteForValue(def, engine, value)?.messageKey !== noteForValue(def, other, value)?.messageKey
  // Only non-info notes travel: `foreignNotesForValue` is the one place that
  // rule lives, and an "unlimited on Q2PRO" info note is already covered by
  // `valueMeaningDiffers` without dressing the badge up as a warning.
  const note = foreignNotesForValue(def, engine, value).find((f) => f.engine === other)?.note

  if (!defaultDiffers && !rangeDiffers && !valueMeaningDiffers && !note) return undefined

  return {
    engine: other,
    absent: false,
    defaultDiffers,
    rangeDiffers,
    valueMeaningDiffers,
    ...(note !== undefined ? { note } : {}),
  }
}
