/**
 * Multi-engine validation aggregation — story 009 D5.
 *
 * Runs D3's `validateStructure` and D4's `validateCvars` once per distinct
 * engine the profile is actually reachable through (`engineScope()`, story
 * 003), never merging or ranking across engines: every assigned engine is an
 * equally-weighted error surface (the story's own framing), so the result is
 * a flat array of independent per-engine runs, not one combined list.
 *
 * The two checks run against the SAME rendered text `render.ts` (story 004's
 * write pipeline, moved to `shared` in this story's D2) would put on disk —
 * never against `profile.cvars`/`.binds`/`.layers`/`.actions` directly for
 * the structural half, so a validated byte and a written byte can never
 * disagree about what they mean. `validateCvars` is the one exception: it
 * reads `profile.cvars` directly rather than the rendered text, because its
 * whole job is per-engine *meaning* of a value (story 003's resolver), which
 * has nothing to do with how the line renders.
 */

import type { ConfigProfile } from '@shared/modules/config'
import type { Installation } from '@shared/types/installation'
import type { EngineKind } from '@shared/types/engine'
import type { Finding, FindingSummary } from '@shared/config/validation'
import { summarize } from '@shared/config/validation'
import { validateStructure, type StructureFile } from '@shared/config/validate-structure'
import { validateCvars } from '@shared/config/validate-cvars'
import { profileFileName, renderLoaderFile, renderProfileFile } from '@shared/config/render'
import { engineScope, type EngineScopeStatus } from './engine-scope'

/** One engine's independent validation run — never merged with another engine's. */
export interface EngineValidation {
  engine: EngineKind
  findings: Finding[]
  summary: FindingSummary
}

export interface ProfileValidation {
  /** Same states `engineScope()` already defines for the Settings tab — the identical state
   * machine answers AC 3 here too, rather than a second derivation of "is there anything to
   * validate against". */
  status: EngineScopeStatus
  /** One entry per distinct, source-cited engine the profile is assigned to, in assignment order. */
  byEngine: EngineValidation[]
  /** Assigned engines the catalog has no facts for — named, never silently dropped or merged in as r1q2. */
  omitted: EngineKind[]
}

/** The exact two files `render.ts` would put on disk for `profile`, D3's own `StructureFile` shape. */
function renderedFiles(profile: ConfigProfile): StructureFile[] {
  return [
    { name: profileFileName(profile.id), content: renderProfileFile(profile) },
    // The loader carries no switch-bind chain here: that chain is per-installation (story 007),
    // and this function validates the profile once per *engine*, not once per installation. A
    // missing chain can only ever make the loader file smaller than what actually ships, never
    // larger, so it never hides a real over-budget finding.
    { name: 'autoexec.cfg', content: renderLoaderFile(profile) },
  ]
}

/**
 * `profile` validated against every distinct engine reached through its
 * assignments (`installations`), each run independently through D3+D4.
 *
 * Never falls back to r1q2 when `status !== 'ok'`: `byEngine` is simply empty
 * in that case, and the caller (`ValidationPanel`) is expected to render
 * `status`/`omitted` as an explicit empty state rather than inventing
 * findings for an engine nothing is actually assigned to.
 */
export function validateProfileForEngines(
  profile: ConfigProfile,
  installations: Installation[],
): ProfileValidation {
  const scope = engineScope(profile, installations)
  const files = renderedFiles(profile)

  const byEngine: EngineValidation[] = scope.selectable.map((engine) => {
    const findings = [...validateStructure(files, engine), ...validateCvars(profile.cvars, engine)]
    return { engine, findings, summary: summarize(findings) }
  })

  return { status: scope.status, byEngine, omitted: scope.omitted }
}

/** Error/warning counts across every engine's run, combined — for the Validation tab's own badge. */
export function totalCounts(result: ProfileValidation): { errors: number; warnings: number } {
  return result.byEngine.reduce(
    (acc, entry) => ({
      errors: acc.errors + entry.summary.errors,
      warnings: acc.warnings + entry.summary.warnings,
    }),
    { errors: 0, warnings: 0 },
  )
}
