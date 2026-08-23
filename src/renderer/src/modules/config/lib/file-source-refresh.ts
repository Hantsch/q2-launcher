import type { ConfigProfile, RefreshedProfileResult } from '@shared/modules/config'

/**
 * The pure decision + merge logic behind `useFileSourceRefresh.ts` (story 043 D7), split out the
 * same way `lib/save-bar.ts` is split from `ProfileSaveBar.tsx`: no React, no `./client`, no
 * `store/useLauncher` - so it is unit-testable under this repo's plain `.test.ts` convention
 * (`vitest.config.ts` runs `environment: 'node'`, no jsdom/`@testing-library`), without rendering
 * anything. `useFileSourceRefresh.ts` itself imports `client.ts` (`refreshProfilesFromFiles`) and
 * `store/useLauncher.ts` (`useWindowFocused`), and `store/useLauncher.ts` transitively imports
 * `lib/bridge.ts`, which reads `window.q2` at module load - fine in the real renderer, fatal the
 * moment a plain-node test imports that module graph at all. Keeping this file free of both is
 * what keeps it importable from a test.
 */

/**
 * True exactly on a false -> true transition - never while already focused (no re-read on every
 * render) and never on a true -> false transition (losing focus has nothing to re-read for).
 */
export function didFocusResume(prevFocused: boolean, nextFocused: boolean): boolean {
  return nextFocused && !prevFocused
}

/**
 * Folds one `refreshFromFiles` result (D5) into the renderer's own profile list.
 *
 * - `unchanged`/`conflict`: main touched nothing about the cached record either - a conflict
 *   "adopt[s] nothing, touch[es] nothing about the cached profile" per D5's own handler comment -
 *   so the list comes back as-is.
 * - `adopted`: main already merged the disk content into the cache and reseeded its hash; this
 *   takes that full, fresh profile wholesale - the same single-profile-merge-by-id idiom as
 *   `ConfigView`'s own `handleProfileUpdated` (D6).
 * - `missing`/`unparseable`/`readError`: main only updated the display hint
 *   (`ProfilesStore.setFileState` - content, `dirty`, `fileHash` all left alone per its own doc
 *   comment), so only `fileState` is patched here too - the profile keeps working off its last good
 *   cache (AC4).
 */
export function applyRefreshedProfile(
  profiles: ConfigProfile[],
  result: RefreshedProfileResult,
): ConfigProfile[] {
  if (result.outcome === 'unchanged' || result.outcome === 'conflict') return profiles

  if (result.outcome === 'adopted') {
    return profiles.map((profile) => (profile.id === result.profileId ? result.profile : profile))
  }

  // 'missing' | 'unparseable' | 'readError'
  return profiles.map((profile) =>
    profile.id === result.profileId ? { ...profile, fileState: result.fileState } : profile,
  )
}

/**
 * What, if anything, `ConfigView` should surface for one result on top of `applyRefreshedProfile`'s
 * list update - never a silent swap for `adopted` (AC3), and the `unparseable`/`readError`
 * diagnostic carries exactly what `readFileState` reported so the profile detail can show it
 * without disabling the profile (AC4). `unchanged` and `missing` have nothing to surface here: the
 * `missing` banner is driven off `ConfigProfile.fileState` directly, which `applyRefreshedProfile`
 * above already patched.
 */
export type FileSourceNotice =
  | { kind: 'reloaded' }
  | { kind: 'conflict' }
  | { kind: 'diagnostic'; file?: string; line?: number; message: string }

export function noticeForRefreshedProfile(result: RefreshedProfileResult): FileSourceNotice | null {
  switch (result.outcome) {
    case 'adopted':
      return { kind: 'reloaded' }
    case 'conflict':
      return { kind: 'conflict' }
    case 'unparseable':
      return { kind: 'diagnostic', file: result.file, line: result.line, message: result.message }
    case 'readError':
      return { kind: 'diagnostic', message: result.message }
    case 'unchanged':
    case 'missing':
      return null
    default:
      return null
  }
}
