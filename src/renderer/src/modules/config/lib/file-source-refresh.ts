import type {
  ConfigProfile,
  RefreshFromFilesInput,
  RefreshFromFilesResult,
  RefreshedProfileResult,
} from '@shared/modules/config'
import type { Outcome, ToastMessage } from '@shared/types'

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
 * list update - never a silent swap for `adopted` (AC3), which since the story-050 review also
 * covers the one way an adopt can silently drop content rather than swap it: an alias name the file
 * defines twice (`droppedAliases`). The `unparseable`/`readError`
 * diagnostic carries exactly what `readFileState` reported so the profile detail can show it
 * without disabling the profile (AC4). `unchanged` and `missing` have nothing to surface here: the
 * `missing` banner is driven off `ConfigProfile.fileState` directly, which `applyRefreshedProfile`
 * above already patched.
 */
export type FileSourceNotice =
  | {
      kind: 'reloaded'
      /**
       * Alias names the reloaded file defined more than once - `RefreshedProfileResult.droppedAliases`
       * passed straight through, `[]` for a clean reload. Carried on the notice rather than left for
       * `ConfigView` to dig out of the result, so the "what should the user be told" decision stays
       * in this one pure, testable function like every other branch's does.
       */
      droppedAliases: readonly string[]
    }
  | { kind: 'conflict' }
  | { kind: 'diagnostic'; file?: string; line?: number; message: string }

export function noticeForRefreshedProfile(result: RefreshedProfileResult): FileSourceNotice | null {
  switch (result.outcome) {
    case 'adopted':
      return { kind: 'reloaded', droppedAliases: result.droppedAliases }
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

/** What `useLauncher`'s `pushToast` takes - the store mints the `id` itself. */
export type FileSourceToast = Omit<ToastMessage, 'id'>

/**
 * The dropped-aliases warning for an adopted reload, or `null` when the adopt lost nothing.
 *
 * One definition for all three adopt paths (story-050 review, finding 1, third round). It is
 * `warning` level with no auto-dismiss on purpose: the reload itself succeeded, and this is content
 * loss the user has to be able to read after the fact rather than inside a six-second window.
 */
export function droppedAliasWarning(droppedAliases: readonly string[]): FileSourceToast | null {
  if (droppedAliases.length === 0) return null
  return {
    level: 'warning',
    messageKey: 'config.fileSource.aliasDropped',
    params: { count: droppedAliases.length, names: droppedAliases.join(', ') },
    timeoutMs: 0,
  }
}

/**
 * What one `adoptProfileFromFile` call did, for the caller's own follow-up.
 *
 * - `adopted` - the disk version is now the cached profile; `profile` is it. Every toast this call
 *   owes the user (today: the dropped-aliases warning) has already been pushed.
 * - `failed` - the IPC call itself failed. Its error toast has already been pushed, so the caller
 *   must not report a second thing.
 * - `notAdopted` - the call worked but nothing was adopted (the file moved again in the moment
 *   between the button rendering and the click: `unchanged`/`missing`/`unparseable`/`readError`/
 *   `conflict`, or no result for this profile at all). Nothing was pushed; how to phrase this is the
 *   caller's, since the two call sites word it differently.
 */
export type AdoptFileResult =
  | { kind: 'adopted'; profile: ConfigProfile }
  | { kind: 'failed' }
  | { kind: 'notAdopted' }

/**
 * "Adopt whatever is on disk right now for this one profile" - the shared body of **every**
 * user-triggered take-the-file action: Care -> Sync -> **Reload** (`CareSyncSection.tsx`) and the
 * conflict dialog's **Take the file** (`ConfigConflictDialog.tsx`).
 *
 * Story-050 review, finding 1 (third round): both of those read `entry.outcome === 'adopted'` and
 * used only `entry.profile`, dropping the `droppedAliases` the same result carries - so a user who
 * hand-edited their `.cfg` into a same-name alias collision and then reloaded (or resolved a
 * conflict by taking the file) got the adopt with no warning at all, while the *automatic* triggers
 * in `ConfigView`/`useFileSourceRefresh` warned about the identical file. The decision of what an
 * adopt owes the user cannot live in each button; it lives here, once, and a new take-the-file
 * button gets it by construction.
 *
 * `refresh`/`pushToast` are injected rather than imported so this module stays free of `./client`
 * and `store/useLauncher` - see this file's own doc comment for why that matters, and it is also
 * what lets a plain `.test.ts` drive the real handler (there is no DOM environment here to render
 * the two `.tsx` callers in).
 */
export async function adoptProfileFromFile(deps: {
  profileId: string
  /** Story 043 D8's "take the file" flag - set by the conflict dialog, never by Care's Reload
   * (which is only offered when the profile is not dirty, so there is nothing to discard). */
  discardLocalEdits?: boolean
  refresh: (input: RefreshFromFilesInput) => Promise<Outcome<RefreshFromFilesResult>>
  pushToast: (toast: FileSourceToast) => void
}): Promise<AdoptFileResult> {
  const outcome = await deps.refresh({
    profileId: deps.profileId,
    ...(deps.discardLocalEdits ? { discardLocalEdits: true } : {}),
  })

  if (!outcome.ok) {
    deps.pushToast({
      level: 'error',
      messageKey: outcome.error.key,
      timeoutMs: 0,
      ...(outcome.error.params ? { params: outcome.error.params } : {}),
    })
    return { kind: 'failed' }
  }

  const entry = outcome.value.find((result) => result.profileId === deps.profileId)
  if (entry?.outcome !== 'adopted') return { kind: 'notAdopted' }

  const warning = droppedAliasWarning(entry.droppedAliases)
  if (warning) deps.pushToast(warning)

  return { kind: 'adopted', profile: entry.profile }
}
