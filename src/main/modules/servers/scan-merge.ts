import type { ScanTarget, ServerListEntry } from '@shared/modules/servers'

/**
 * Story 116 D4: the end-of-round stale-flip, extracted from `scan-service.ts`'s `runSweep` (story
 * 114 D-K) into its own pure, unit-testable function. Every target this round's address set named
 * but that never produced a successful reply keeps its previous entry (if it has one at all) with
 * `status` flipped to `'stale'` - never replaced by a fresh/zeroed entry, never removed. A target
 * with no previous entry and no reply this round simply gets no row (nothing to flip).
 *
 * `aborted` (story 114's review fix, D-J's other half): an aborted sweep - dispose()/shutdown
 * mid-scan - never stale-flips anything it did not get to ask; "aborted" means "we didn't get to
 * ask", not "the server was silent". A genuinely SKIPPED round (116's guard refuses the round
 * before it starts) never calls this function at all, which is the other, simpler half of D-J.
 *
 * Pure: returns a new `Map` rather than mutating `entries` in place, mirroring `address-set.ts`'s
 * own list-in/list-out style for this module's pure helpers. The caller (`scan-service.ts`) copies
 * the result back into its own closure-held `entries` Map, since that Map is also mutated directly
 * elsewhere (the `onServer` callback) during the same sweep.
 */
export function mergeStaleRound(
  entries: Map<string, ServerListEntry>,
  targets: ScanTarget[],
  answeredOnline: ReadonlySet<string>,
  aborted: boolean,
): Map<string, ServerListEntry> {
  if (aborted) return entries

  const next = new Map(entries)
  for (const target of targets) {
    if (answeredOnline.has(target.address)) continue
    const existing = next.get(target.address)
    if (existing !== undefined) next.set(target.address, { ...existing, status: 'stale' })
  }
  return next
}
