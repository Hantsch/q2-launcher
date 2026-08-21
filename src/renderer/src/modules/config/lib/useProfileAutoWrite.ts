import { useEffect, useRef } from 'react'
import type { ConfigProfile } from '@shared/modules/config'
import { writeConfigProfile } from '../client'
import { shouldTriggerAutoWrite } from './auto-write'

/**
 * Fires the automatic write-on-change whenever the open profile is really
 * saved - story 023 D3.
 *
 * Mounted by `ConfigView`'s detail screen, NOT by a tab. That placement is the
 * point of this hook: the trigger used to live in `WriteTargets`, so it only
 * ever fired while that one tab happened to be mounted, which is why the tab
 * the user edits in (Settings, Controls) never triggered anything. It now runs
 * for as long as a profile is open, whichever tab is showing, and survives the
 * deletion of `WriteTargets` in D7.
 *
 * Belt and braces rather than the only line of defence: since story 022 every
 * mutating config handler in main already awaits a full sync before it returns
 * (022 decision 8), so by the time `updatedAt` changes here the bytes are
 * already on disk. This call therefore normally finds nothing to do, and
 * `writer.ts`'s diff-skip (`writer.ts:153`) makes that case a genuine no-op -
 * no rewrite and no backup churn - so the redundancy costs a comparison, not a
 * pair of writes. What it buys is that the guarantee no longer depends on
 * every future mutating handler remembering to sync.
 *
 * The result is deliberately not consumed: what actually ended up on disk is
 * reported by `syncState`, which the surfaces that care re-read on an
 * `updatedAt` bump anyway. Inventing a second, hook-local error channel here
 * would just be a place for two views to disagree.
 */
export function useProfileAutoWrite(profile: ConfigProfile | null): void {
  /**
   * The last `updatedAt` seen per profile id. A ref, not state, because it must
   * not itself cause a render, and a `Map` keyed by id rather than a single
   * value because it has to outlive profile switches - see
   * `shouldTriggerAutoWrite`'s doc comment for why an entry is never reset.
   */
  const lastSeenUpdatedAt = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (!profile) return
    const previouslySeen = lastSeenUpdatedAt.current.get(profile.id)
    lastSeenUpdatedAt.current.set(profile.id, profile.updatedAt)
    if (!shouldTriggerAutoWrite(previouslySeen, profile.updatedAt)) return
    void writeConfigProfile({ profileId: profile.id })
    // Keyed on the two primitives the rule actually reads, not on `profile`:
    // the object identity changes on every unrelated list refresh, and an
    // extra run of the *rule* would be harmless but an extra run of the effect
    // is an extra IPC round trip for nothing. Same narrow-deps idiom as
    // `WriteTargets`' own refetch effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.updatedAt])
}
