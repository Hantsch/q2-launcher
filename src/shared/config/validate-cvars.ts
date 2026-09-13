/**
 * Cvar checks — story 009 D4.
 *
 * Runs a profile's raw `cvars` map (never a rendered file, that is D3's job)
 * through story 003's resolver (`cvar-facts.ts`) for every `CvarDef` in the
 * catalog (`cvar-catalog.ts`): a cvar the engine does not know, a value the
 * engine treats specially, a numeric value outside the engine's clamp range,
 * and a choice value only another engine's parser accepts.
 *
 * Ported in spirit from the external q2-config-manager project
 * (`src/core/validator.ts`'s cvar block), adapted to this codebase's
 * `CvarDef`/`ResolvedCvar` shapes instead of upstream's `Setting`/`Profile`.
 * Two things upstream has that this deliverable deliberately drops (story
 * decision D5): the "foreign engine notes" / portability block (info-level
 * findings about what *other* assigned engines think of this value — D5 runs
 * this function once per assigned engine instead, so each engine's own run
 * already covers that ground) and the r1q2-specific `cl_async`/`r_maxfps`/
 * `cl_maxfps` mirroring special case.
 *
 * ## Info-level notes are not their own finding
 *
 * `noteForValue` can return an `'info'` note — see `r_maxfps` on Q2PRO: `0`
 * means "unlimited" there, which the catalog documents but which is not a
 * problem worth surfacing as a validation finding on its own. A present note
 * still does its other job of explaining the value (so the range check below
 * is skipped for it, same as for a warning/error note — a magic value is not
 * reported twice), it just does not itself turn into a `Finding`. Only
 * `'warning'`/`'error'` notes do. This is what keeps `r_maxfps 0` silent on
 * Q2PRO (its info note explains the value AND 0 is below Q2PRO's min of 10,
 * so without the note the range check would otherwise fire) while the same
 * value is a loud error on R1Q2, whose note for it is `'error'`.
 */

import { engineLabel, type EngineKind } from '../types/engine'
import { GRAPHICS_CVARS, PLAYER_CVARS } from './cvar-catalog'
import { enginesAcceptingChoice, isChoiceAccepted, noteForValue, resolveCvar } from './cvar-facts'
import type { Finding } from './validation'

const CATALOG = [...PLAYER_CVARS, ...GRAPHICS_CVARS]

/**
 * Cvar findings for `cvars` (a profile's cvar map, e.g. `profile.cvars`)
 * against `engine`. Only cvars actually present in `cvars` are checked — a
 * profile simply not setting a cvar is not itself a finding.
 */
export function validateCvars(cvars: Record<string, string>, engine: EngineKind): Finding[] {
  const findings: Finding[] = []

  for (const def of CATALOG) {
    const value = cvars[def.name]
    if (value === undefined) continue

    const resolved = resolveCvar(def, engine)
    const engineName = engineLabel(engine)

    if (resolved.absent) {
      findings.push({
        id: `cvar-absent-${def.name}`,
        level: 'error',
        engine,
        messageKey: 'config.validation.cvar.absent',
        params: { name: def.name, engine: engineName },
        fixKey: 'config.validation.cvar.absentFix',
        subject: { kind: 'cvar', id: def.name },
        ...(resolved.source !== undefined ? { source: resolved.source } : {}),
      })
      continue
    }

    const note = noteForValue(def, engine, value)
    if (note) {
      // See the file-level doc comment: an info note still explains the
      // value (no range check below) but is not reported as its own finding.
      if (note.level !== 'info') {
        const params: Record<string, string | number> = { name: def.name, value, engine: engineName }
        findings.push({
          id: `cvar-note-${def.name}`,
          level: note.level,
          engine,
          // The note's OWN message key, not a generic wrapper: `cvar-facts.ts`
          // documents `EngineValueNote.messageKey` as "what the engine
          // actually does with it, in full sentences" (e.g. the exact
          // "R1Q2 does not read 0 as unlimited..." text) - a review finding
          // caught an earlier version of this file discarding that specific
          // explanation in favour of generic prose that pointed at a note
          // the Validation tab never renders (that note is `CvarRow`'s own,
          // Settings-tab-only badge). The cvar/key/value are still visible on
          // the finding via `subject`, so nothing is lost by not restating
          // the name here too.
          messageKey: note.messageKey,
          params,
          ...(note.level === 'error'
            ? {
                fixKey: 'config.validation.cvar.noteErrorFix',
              }
            : {}),
          subject: { kind: 'cvar', id: def.name },
          ...(resolved.source !== undefined ? { source: resolved.source } : {}),
        })
      }
    } else {
      const numeric = Number(value)
      if (Number.isFinite(numeric) && value.trim() !== '') {
        const below = resolved.min !== undefined && numeric < resolved.min
        const above = resolved.max !== undefined && numeric > resolved.max
        if (below || above) {
          const bound = below ? resolved.min! : resolved.max!
          const params: Record<string, string | number> = { name: def.name, value, engine: engineName, bound }
          if (resolved.min !== undefined) params.min = resolved.min
          if (resolved.max !== undefined) params.max = resolved.max

          findings.push({
            id: `cvar-range-${def.name}`,
            level: 'warning',
            engine,
            messageKey: resolved.clamps
              ? 'config.validation.cvar.outOfRangeClamped'
              : 'config.validation.cvar.outOfRange',
            params,
            fixKey: 'config.validation.cvar.outOfRangeFix',
            subject: { kind: 'cvar', id: def.name },
            ...(resolved.source !== undefined ? { source: resolved.source } : {}),
          })
        }
      }
    }

    if (!isChoiceAccepted(def, engine, value)) {
      const accepted = enginesAcceptingChoice(def, value)
      if (accepted.length > 0) {
        findings.push({
          id: `cvar-choice-${def.name}`,
          level: 'warning',
          engine,
          messageKey: 'config.validation.cvar.choiceRejected',
          params: {
            name: def.name,
            value,
            engine: engineName,
            accepted: accepted.map(engineLabel).join(', '),
          },
          subject: { kind: 'cvar', id: def.name },
          ...(resolved.source !== undefined ? { source: resolved.source } : {}),
        })
      }
    }
  }

  return findings
}
