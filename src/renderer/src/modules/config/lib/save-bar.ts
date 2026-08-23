import type { ConfigProfile, SaveProfileConflict, SaveProfileResult } from '@shared/modules/config'
import type { Outcome } from '@shared/types'

/**
 * The pure decision logic behind `ProfileSaveBar` (story 043 D6), split out the same way
 * `auto-write.ts` split the write-trigger rule out of `useProfileAutoWrite.ts`: no React, no
 * `./client` - so it is unit-testable under this repo's plain `.test.ts` convention (`vitest.config.ts`
 * runs `environment: 'node'` with no jsdom/`@testing-library` in this project), without rendering
 * anything.
 */

/**
 * `profile.dirty` straight off the server profile, never a second renderer-local tracker - `dirty`
 * is additive-optional (story 043 D2), so a profile predating this story has no field at all and
 * reads as "nothing to save", same as an explicit `false`.
 */
export function isProfileDirty(profile: Pick<ConfigProfile, 'dirty'>): boolean {
  return profile.dirty === true
}

/** What `ProfileSaveBar` should do once a `saveConfigProfile` call settles. */
export type SaveBarAction =
  | { type: 'saved'; profile: ConfigProfile }
  | { type: 'toast'; messageKey: string; params?: Record<string, string | number> }
  /**
   * Story 043 D8: the file changed underneath the launcher, so nothing was written. Carries the
   * whole-file conflict payload so `ProfileSaveBar` can open `ConfigConflictDialog` with it -
   * replaces the plain-toast stub D6 left here (`config.save.conflict` is no longer reached).
   */
  | { type: 'conflict'; conflict: SaveProfileConflict }

/**
 * Turns a `saveConfigProfile` outcome into exactly one action.
 *
 * - The transport-level `Outcome` failing (e.g. `config.error.profileNotFound`) and
 *   `SaveProfileResult`'s `'unreadable'` status resolve to a plain toast, never a crash and never a
 *   silent edit loss - `dirty` is left exactly as it was on every one of these, since nothing here
 *   calls `onSaved`.
 * - `'conflict'` (story 043 D8) resolves to its own action carrying the conflict payload, so the
 *   caller can open `ConfigConflictDialog` with both whole-file versions instead of only being told
 *   something happened.
 * - `'unreadable'` picks between the two reason-specific i18n keys and always carries `message` as
 *   an interpolation param, whether or not the reason has a `line` (`readError` has none).
 */
export function resolveSaveOutcome(outcome: Outcome<SaveProfileResult>): SaveBarAction {
  if (!outcome.ok) {
    return {
      type: 'toast',
      messageKey: outcome.error.key,
      ...(outcome.error.params ? { params: outcome.error.params } : {}),
    }
  }

  const result = outcome.value
  if (result.status === 'saved') {
    return { type: 'saved', profile: result.profile }
  }

  if (result.status === 'conflict') {
    return { type: 'conflict', conflict: result }
  }

  // result.status === 'unreadable'
  return {
    type: 'toast',
    messageKey:
      result.reason === 'unparseable'
        ? 'config.save.unreadableUnparseable'
        : 'config.save.unreadableReadError',
    params: { message: result.message },
  }
}
