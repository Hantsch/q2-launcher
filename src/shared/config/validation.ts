/**
 * The finding model shared by every validation rule module (D3's
 * `validate-structure.ts`, D4's `validate-cvars.ts`, and D5's aggregation).
 *
 * Ported in spirit from the external q2-config-manager project
 * (`src/core/validator.ts`'s `Finding`/`summarise()`), generalized to this
 * launcher's ten-way `EngineKind`. Message text is never a literal English
 * sentence here — `messageKey`/`fixKey` are i18n keys the renderer resolves,
 * the same rule `cvar-facts.ts` and `cvar-catalog.ts` follow for engine
 * facts. `source` is the one exception, a literal citation string (story 003
 * precedent, e.g. `EngineOverride.source`).
 *
 * `summarize` is the American spelling of upstream's `summarise()`, to match
 * this codebase's existing spelling (see `cvar-facts.ts`, `alt-layers.ts`).
 */

import type { EngineKind } from '../types/engine'

/** What a finding is about, so the UI can link back to the offending row. */
export interface FindingSubject {
  kind: 'cvar' | 'bind' | 'alias' | 'file' | 'profile' | 'action'
  /**
   * Cvar name, bind key, alias name, file name, profile id, or (story 019 D8)
   * an entry's own display name - whatever `kind` implies. `'action'` is used
   * when a finding is about a `ConfigAction` itself (e.g. a binding calling an
   * undefined alias) rather than about the rendered `bind`/`alias` line it
   * would produce - the entry may not even render a line at all yet.
   */
  id: string
}

/**
 * One validation result.
 *
 * `level` reuses `EngineValueNote.level` from `cvar-facts.ts` (`'info' |
 * 'warning' | 'error'`) - a per-finding severity, not the installations
 * module's per-installation `CheckSeverity` (`'ok' | 'warn' | 'error'`).
 */
export interface Finding {
  /** Stable within one validation run - callers may use it as a React key. */
  id: string
  level: 'info' | 'warning' | 'error'
  /** Which engine this finding was raised against; the same profile can raise different findings per engine. */
  engine: EngineKind
  /** i18n key for the finding's message. Never literal prose. */
  messageKey: string
  /** Values interpolated into the message, e.g. `{ name: 'r_maxfps', limit: 32 }`. */
  params?: Record<string, string | number>
  /** i18n key describing a suggested fix, when one exists. */
  fixKey?: string
  subject: FindingSubject
  /**
   * Literal engine source citation (file/line), same precedent as
   * `EngineOverride.source` in `cvar-facts.ts` - not translated, not prose.
   */
  source?: string
}

export interface FindingSummary {
  errors: number
  warnings: number
  infos: number
}

/** Tally a set of findings by level. Mirrors upstream's `summarise()`. */
export function summarize(findings: Finding[]): FindingSummary {
  const summary: FindingSummary = { errors: 0, warnings: 0, infos: 0 }
  for (const finding of findings) {
    if (finding.level === 'error') summary.errors++
    else if (finding.level === 'warning') summary.warnings++
    else summary.infos++
  }
  return summary
}
