import type { EngineUpdateChannel, EngineUpdateStatus } from '@shared/modules/downloads'
import type { EngineKind } from '@shared/types/engine'
import type { InstallationEngineState } from './installation-state'

/**
 * Story 092 D3 (AC1): the update-check half of `EngineUpdateStatus` - pure comparison, no I/O.
 *
 * Deliberately takes an already-resolved `target` (version + channel) rather than a `ManifestService`
 * or a `ManifestSnapshot`: D4's bleeding-edge comparison needs a different source for "what would we
 * update to" (a probed upstream build, not the manifest's pin), and this seam lets that later
 * deliverable swap the *caller*'s resolution without touching this function at all. `engineUpdateStatus`
 * (`index.ts`) is what resolves `target` for D3 - always `{ channel: 'pinned', version:
 * manifestService.pinnedEnginePackage(engine)?.version }` this deliverable, since bleeding-edge tracking
 * itself is D4's job (Decisions (Sprint)).
 *
 * "An installation with no recorded engine version counts as 'differs'" (Decisions): `current`
 * undefined always reports `updateAvailable: true`, even though `current`/`target` are trivially
 * unequal by construction - stated explicitly here rather than left to fall out of the `!==` check, so
 * the "unknown version" case reads as a deliberate decision, not an accident of the comparison.
 *
 * "An engine with no manifest pin should not throw - report no update available": `target.version`
 * undefined always reports `updateAvailable: false` - there is nothing to update *to*, known current
 * version or not.
 */
export function computeEngineUpdateStatus(
  installationId: string,
  engine: EngineKind,
  recorded: InstallationEngineState,
  target: { channel: EngineUpdateChannel; version: string | undefined },
): EngineUpdateStatus {
  const current = recorded.version
  const updateAvailable = target.version !== undefined && (current === undefined || current !== target.version)

  return {
    installationId,
    engine,
    ...(current !== undefined ? { current } : {}),
    ...(target.version !== undefined ? { target: target.version } : {}),
    updateAvailable,
    channel: target.channel,
    ...(recorded.backup ? { backup: recorded.backup } : {}),
  }
}
