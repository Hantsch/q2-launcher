import { z } from 'zod'
import type { EngineBackupInfo } from '@shared/modules/downloads'

/**
 * Story 092 D2: the recorded engine version an installation carries, persisted in
 * `Installation.moduleData['downloads']` (Decisions (Sprint): "that is the slot the concept §4
 * reserves for per-installation module data"). `version` pins the update check (D3) against the
 * manifest's pinned build, `packageId` is what a future update/rollback job records having
 * installed, `bleedingEdge` is the per-installation opt-in (AC4/AC5, not read by this deliverable),
 * and `backup` is the single backup slot's metadata (AC3/D5/D6 populate it; D2 only reserves the
 * field so `setEngineState` can write it).
 *
 * Every field is optional: an installation that has never had its engine version recorded (every
 * installation bootstrapped before this story, and any installation whose `moduleData` failed to
 * parse) is simply `{}`, which is exactly "unknown" - never a thrown error.
 */
export interface InstallationEngineState {
  version?: string
  packageId?: string
  bleedingEdge?: boolean
  backup?: EngineBackupInfo
}

/**
 * Defensive, forgiving parse of one `EngineBackupInfo` - same "strict on the fields that make the
 * record meaningful, catch everything else to absent" convention `main/lib/schemas.ts` uses
 * throughout. A backup record missing its `version` or `createdAt` is not a usable backup, so the
 * whole field degrades to absent (via the `.optional().catch(undefined)` wrapper at the call site
 * below) rather than reporting a backup with holes in it.
 */
const engineBackupInfoSchema = z.object({
  version: z.string().min(1),
  packageId: z.string().min(1).optional().catch(undefined),
  createdAt: z.number().finite(),
})

/**
 * Every field is independently forgiving (`.catch(undefined)`), the same per-field convention
 * `installationSchema`'s `lastFailure` uses in `main/lib/schemas.ts`: a garbage `bleedingEdge`
 * value costs only that field, not the whole record, and the record itself never throws - a
 * `moduleData['downloads']` that is not even an object degrades to `{}` at the `safeParse` call
 * site in `readEngineState` below.
 */
const engineStateSchema = z.object({
  version: z.string().min(1).optional().catch(undefined),
  packageId: z.string().min(1).optional().catch(undefined),
  bleedingEdge: z.boolean().optional().catch(undefined),
  backup: engineBackupInfoSchema.optional().catch(undefined),
})

/** The "nothing recorded yet" answer - a single shared, empty instance, never mutated. */
const UNKNOWN_ENGINE_STATE: InstallationEngineState = {}

/**
 * Reads the recorded engine state out of an installation's `moduleData`, defensively: an absent
 * `moduleData`, an absent `downloads` key, or a `downloads` value that fails validation in any way
 * (wrong types, an unexpected shape, not even an object) all answer `UNKNOWN_ENGINE_STATE` rather
 * than throwing - "an installation with no recorded engine version counts as 'differs'" (Decisions
 * (Sprint)) starts from this function never blowing up on garbage.
 */
export function readEngineState(moduleData: Record<string, unknown> | undefined): InstallationEngineState {
  if (!moduleData) return UNKNOWN_ENGINE_STATE
  const result = engineStateSchema.safeParse(moduleData['downloads'])
  return result.success ? result.data : UNKNOWN_ENGINE_STATE
}

/**
 * Applies a partial patch to the recorded engine state and returns the `moduleData` object it
 * should be persisted under - every other module's key in `moduleData` is preserved untouched,
 * only the `'downloads'` key is replaced wholesale with the merged state.
 *
 * The patch is shallow-merged over whatever `readEngineState` could make of the existing value, so
 * a caller updating just `version`/`packageId` (the bootstrap job's own call, D2) never has to read
 * back the current `bleedingEdge`/`backup` first.
 */
export function writeEngineState(
  moduleData: Record<string, unknown> | undefined,
  patch: Partial<InstallationEngineState>,
): Record<string, unknown> {
  const next: InstallationEngineState = { ...readEngineState(moduleData), ...patch }
  return { ...(moduleData ?? {}), downloads: next }
}
