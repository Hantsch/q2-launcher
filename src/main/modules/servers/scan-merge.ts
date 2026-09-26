import { RTT_HISTORY_LIMIT, type RttSample, type ScanTarget, type ServerListEntry } from '@shared/modules/servers'

/**
 * Story 124 D1: appends one `RttSample` to a server's session history, capped at
 * `RTT_HISTORY_LIMIT` (oldest dropped first). Pure - returns a new array, never mutates `history`.
 */
export function appendRttSample(history: RttSample[] | undefined, sample: RttSample): RttSample[] {
  const next = [...(history ?? []), sample]
  return next.length > RTT_HISTORY_LIMIT ? next.slice(next.length - RTT_HISTORY_LIMIT) : next
}

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
 *
 * Story S25 D2: a target with no previous entry and no reply this round used to always get no row -
 * that is still true for a source-only target, but a favourite/manual target now gets a field-less
 * stale placeholder instead (`{ address, origins, status: 'stale', lastSeenAt: null }`). Both a
 * favourite and a manual server can go silent from their very first scan (e.g. added while the
 * network is unreachable), and origin, not history, is what tells the row apart from a plain
 * master/list address nobody ever asked for a reason to remember.
 */
export function mergeStaleRound(
  entries: Map<string, ServerListEntry>,
  targets: ScanTarget[],
  answeredOnline: ReadonlySet<string>,
  aborted: boolean,
  now: string,
): Map<string, ServerListEntry> {
  if (aborted) return entries

  const next = new Map(entries)
  for (const target of targets) {
    if (answeredOnline.has(target.address)) continue
    const existing = next.get(target.address)
    if (existing !== undefined) {
      // Story 124 D1: a stale flip is itself a "round with no answer" - recorded in the history the
      // same way a successful reply records its measured value, just with `rttMs: null`. Only for a
      // target that already has an entry - a fabricated field-less placeholder (below) never gets one.
      next.set(target.address, {
        ...existing,
        status: 'stale',
        rttHistory: appendRttSample(existing.rttHistory, { at: now, rttMs: null }),
      })
    } else if (target.origins.includes('favourite') || target.origins.includes('manual')) {
      next.set(target.address, {
        address: target.address,
        origins: target.origins,
        status: 'stale',
        lastSeenAt: null,
      })
    }
  }
  return next
}
