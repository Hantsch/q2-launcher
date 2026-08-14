/**
 * Which engines a config profile's cvars actually land on.
 *
 * A profile carries assignments (story 002), and an assignment carries an
 * installation id - never an engine. The engine only exists on the
 * installation, so the scope has to be re-derived from the mirrored
 * installation list every time. That cross-reference lives here, in one pure
 * function, because both `EngineScopeSelect` (which offers the engines) and
 * `SettingsTab` (which tells every row about the *other* assigned engines)
 * need the same answer, and two hand-rolled copies of it are exactly how the
 * two would drift apart.
 *
 * Deliberately not defaulting to anything: an unassigned profile, or one
 * assigned only to engines the catalog has no source-cited facts for, has *no*
 * engine in scope. Falling back to r1q2 there would put r1q2's defaults,
 * ranges and warnings on screen under someone else's engine - the one failure
 * mode this whole story exists to prevent.
 */

import type { EngineKind } from '@shared/types/engine'
import type { Installation } from '@shared/types/installation'
import type { ConfigProfile } from '@shared/modules/config'
import { hasEngineFacts } from '@shared/config/cvar-facts'

/**
 * Why there is (or is not) an engine to show facts for.
 *
 * The three non-`ok` cases are told apart on purpose: they need different
 * sentences, and collapsing them would mean telling a user their profile is
 * unassigned when it is in fact assigned to a Yamagi install.
 */
export type EngineScopeStatus =
  /** At least one assigned installation runs an engine with facts. */
  | 'ok'
  /** The profile has no assignments at all. */
  | 'unassigned'
  /** It has assignments, but none of them resolve to a registered installation. */
  | 'unresolved'
  /** It is assigned, but to engines the catalog carries no facts for. */
  | 'noFacts'

export interface EngineScope {
  status: EngineScopeStatus
  /** Distinct engines of the assigned installations, in assignment order. */
  assigned: EngineKind[]
  /** The subset of `assigned` the catalog has facts for - the selectable ones. */
  selectable: EngineKind[]
  /** The rest of `assigned`: named in the UI, never silently treated as r1q2. */
  omitted: EngineKind[]
}

/**
 * Distinct `EngineKind`s of the installations `profile` is assigned to.
 *
 * Assignments pointing at an installation that is no longer registered are
 * skipped rather than guessed at. Order follows `profile.assignments`, which
 * is what makes "the first assigned engine with facts" a stable answer.
 */
export function assignedEngineKinds(
  profile: ConfigProfile,
  installations: Installation[],
): EngineKind[] {
  const out: EngineKind[] = []
  for (const assignment of profile.assignments) {
    const installation = installations.find((entry) => entry.id === assignment.installationId)
    if (!installation) continue
    if (!out.includes(installation.engineKind)) out.push(installation.engineKind)
  }
  return out
}

export function engineScope(profile: ConfigProfile, installations: Installation[]): EngineScope {
  const assigned = assignedEngineKinds(profile, installations)
  const selectable = assigned.filter((kind) => hasEngineFacts(kind))
  const omitted = assigned.filter((kind) => !hasEngineFacts(kind))

  const status: EngineScopeStatus =
    selectable.length > 0
      ? 'ok'
      : profile.assignments.length === 0
        ? 'unassigned'
        : assigned.length === 0
          ? 'unresolved'
          : 'noFacts'

  return { status, assigned, selectable, omitted }
}

/**
 * The engine to show first: r1q2 when it is among the assigned engines,
 * otherwise the first assigned engine that has facts - and `null` when there
 * is none, which the caller must render as an empty state rather than
 * substituting an engine of its own.
 */
export function defaultScopeEngine(selectable: EngineKind[]): EngineKind | null {
  if (selectable.includes('r1q2')) return 'r1q2'
  return selectable[0] ?? null
}
