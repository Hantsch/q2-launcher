import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AssignProfileInput,
  CommitProfileCvarsInput,
  ConfigProfile,
  ProfileFileSyncStatus,
  ProfileInstallationSync,
  ProfileSyncState,
  RawFilesInput,
  RawFilesResult,
  RawInstallationTarget,
  RawProfileFile,
  RefreshedProfileResult,
  RefreshFromFilesInput,
  RefreshFromFilesResult,
  SaveProfileInput,
  SaveProfileResult,
  SaveRawTextInput,
  SaveRawTextResult,
  SetDefaultProfileInput,
  SetSwitchBindInput,
  SyncProfileStateInput,
  TidyUpApplyInput,
  TidyUpApplyResult,
  UnassignProfileInput,
  WriteProfileInput,
  WriteTargetResult,
} from '@shared/modules/config'
import { applyTidyUpOps } from '@shared/config/tidy-up'
import { isLatin1Text } from '@shared/config/q2-charset'
import { restoredToProfileFields } from '@shared/config/profile-restore-input'
import type { RestoreWarning } from '@shared/config/profile-restore'
import { resolveProfileFileNames } from '@shared/config/profile-files'
import { renderLoaderFile, renderProfileFile } from '@shared/config/render'
import { fail, ok, type Installation, type LaunchState, type Outcome } from '@shared/types'
import type { Logger } from '../../lib/logger'
import { reconcileAssignments } from './assignments'
import { readCanonicalOwnership, removeCanonicalProfileFile } from './canonical'
import { corruptContentDiagnostic, hashCanonicalFileContent, readFileState } from './file-source'
import type { configState } from './persisted'
import type { ProfilesStore } from './profiles'
import { detectSectionHeaderStyle, detectWriteUnbindall, recoverProfileName } from './rebuild'
import { installationCopySource, syncProfile } from './sync'
import { mergeWriteFailureChanges } from './write-failures'
import { assignedProfilesFor, defaultProfileFor } from './write-plan'
import {
  BASE_GAME_DIR,
  ownedProfileIdFromContent,
  readExisting,
  writeInstallationFiles,
  writeTargetFile,
} from './writer'

/**
 * Everything the profile write path reads or writes, injected so the service runs on a temp dir and
 * a real `StateStore` without booting the module (story 210). Every accessor is a function or a
 * live store, never a snapshot: the write guards below must see the state as it stands at the
 * moment they run, not as it stood when the service was built.
 */
export interface ProfileWritesDeps {
  profiles: ProfilesStore
  installations: {
    list(): Installation[]
    find(id: string): Installation | undefined
  }
  launchState: () => LaunchState
  config: ReturnType<typeof configState>
  /** The canonical profile directory (`<userData>` in production). */
  canonicalBaseDir: () => string
  readFileState: typeof readFileState
  /** Reads a whole file as latin-1, the config file encoding; rejects like `fs.readFile`. */
  readText: (path: string) => Promise<string>
  writeTargetFile: typeof writeTargetFile
  writeInstallationFiles: typeof writeInstallationFiles
  log: Logger
}

/** The production file IO for `ProfileWritesDeps`. */
export const profileWritesFileIo: Pick<
  ProfileWritesDeps,
  'readFileState' | 'readText' | 'writeTargetFile' | 'writeInstallationFiles'
> = {
  readFileState,
  readText: (path) => readFile(path, 'latin1'),
  writeTargetFile,
  writeInstallationFiles,
}

export interface SyncAndPersistOptions {
  overwriteProfileId?: string
  refuseCanonicalWriteFor?: string
  /** Story 079 D8: restricts this run to one installation - see `sync.ts#SyncProfileDeps`. */
  targetInstallationId?: string
}

/** A sync problem's last recorded failure for one file - see `readSyncFileStatus`. */
type FileWriteFailure = { messageKey: string; at: string } | undefined

export interface ProfileWrites {
  syncAndPersist(
    profile: ConfigProfile,
    allProfiles: ConfigProfile[],
    options?: SyncAndPersistOptions,
  ): Promise<ProfileSyncState | null>
  authoriseContentWrite(profile: ConfigProfile): Promise<boolean>
  canonicalFileNameFor(profile: ConfigProfile): Promise<string | null>
  readSyncFileStatus(
    path: string,
    expectedContent: string | null,
    failure: FileWriteFailure,
  ): Promise<{ status: ProfileFileSyncStatus; messageKey?: string }>
  droppedAliasNames(
    warnings: readonly RestoreWarning[],
    profileId: string,
    context: string,
  ): string[]
  save(input: SaveProfileInput): Promise<Outcome<SaveProfileResult>>
  saveRawText(input: SaveRawTextInput): Promise<Outcome<SaveRawTextResult>>
  refreshFromFiles(input: RefreshFromFilesInput): Promise<Outcome<RefreshFromFilesResult>>
  /** Syncs the profile a store call just appended (the last of `list`); answers `list`. */
  syncAppended(list: ConfigProfile[]): Promise<Outcome<ConfigProfile[]>>
  /** Best-effort cleanup after the store dropped a profile: its canonical file and write bookkeeping. */
  cleanupRemoved(profileId: string): Promise<void>
  commitCvars(input: CommitProfileCvarsInput): Promise<Outcome<ConfigProfile>>
  assign(input: AssignProfileInput): Promise<Outcome<ConfigProfile[]>>
  unassign(input: UnassignProfileInput): Promise<Outcome<ConfigProfile[]>>
  setDefault(input: SetDefaultProfileInput): Promise<Outcome<ConfigProfile[]>>
  write(input: WriteProfileInput): Promise<Outcome<WriteTargetResult[]>>
  setSwitchBind(input: SetSwitchBindInput): Promise<Outcome<Record<string, string>>>
  tidyUpApply(input: TidyUpApplyInput): Promise<Outcome<TidyUpApplyResult>>
  syncState(input: SyncProfileStateInput): Promise<Outcome<ProfileSyncState>>
  rawFiles(input: RawFilesInput): Promise<Outcome<RawFilesResult>>
}

/** The profile write path as a service: a plain object of functions over `deps`. */
export function createProfileWrites(deps: ProfileWritesDeps): ProfileWrites {
  return {
    syncAndPersist: (profile, allProfiles, options) =>
      syncAndPersist(deps, profile, allProfiles, options),
    authoriseContentWrite: (profile) => authoriseContentWrite(deps, profile),
    canonicalFileNameFor: (profile) => canonicalFileNameFor(deps, profile),
    readSyncFileStatus: (path, expectedContent, failure) =>
      readSyncFileStatus(deps, path, expectedContent, failure),
    droppedAliasNames: (warnings, profileId, context) =>
      droppedAliasNames(deps, warnings, profileId, context),
    save: (input) => save(deps, input),
    saveRawText: (input) => saveRawText(deps, input),
    refreshFromFiles: (input) => refreshFromFiles(deps, input),
    syncAppended: (list) => syncAppended(deps, list),
    cleanupRemoved: (profileId) => cleanupRemoved(deps, profileId),
    commitCvars: (input) => commitCvars(deps, input),
    assign: (input) => assign(deps, input),
    unassign: (input) => unassign(deps, input),
    setDefault: (input) => setDefault(deps, input),
    write: (input) => write(deps, input),
    setSwitchBind: (input) => setSwitchBind(deps, input),
    tidyUpApply: (input) => tidyUpApply(deps, input),
    syncState: (input) => syncState(deps, input),
    rawFiles: (input) => rawFiles(deps, input),
  }
}

/**
 * The live assignment view every handler returns: assignments to installations no longer
 * registered are filtered out on read (see `configModule.setup()`'s own `withLiveAssignments`).
 */
function withLiveAssignments(deps: ProfileWritesDeps, list: ConfigProfile[]): ConfigProfile[] {
  return reconcileAssignments(
    list,
    deps.installations.list().map((installation) => installation.id),
  )
}

/**
 * Story 022 D7: the one place every write-triggering handler funnels through to get `profile`'s
 * files onto disk - its canonical `<userData>` copy plus every installation it is assigned to - and
 * to persist the resulting pending-write/write-failure bookkeeping.
 *
 * Deliberately returns `void` and never throws: a sync problem is reported
 * through `configWriteFailures` (which `syncState` below and the `write`
 * channel surface), never by turning a successful CRUD operation into a failed
 * IPC response. `syncProfile` already catches its own write failures
 * internally, so the try/catch here is a defensive backstop for the
 * genuinely-unexpected - not the normal error path.
 *
 * Story 043 D4 adds the one rule that inverts story 022 decision 8, and it is applied here rather
 * than at each call site so no call site can forget it: **a profile carrying unsaved edits
 * (`dirty`) is never written to disk by anything but `save`**. It holds for every profile a run
 * touches, not just the one that triggered it - the mutated profile, a sibling displaced by a
 * rename, another profile assigned to the same installation - which is why it is handed to
 * `syncProfile` as a per-profile predicate. `assign`/`unassign`/`setDefault`/`write` still call this
 * function and still sync immediately (they change assignment relationships, not profile *content*),
 * and this predicate is what keeps them from carrying a dirty profile's unsaved edits onto disk
 * through that side door.
 *
 * Story 043 D10 adds the second half of that rule, for the case `dirty` alone cannot cover: **a
 * canonical file whose current bytes the launcher has never read is not ours to overwrite either**,
 * however clean the profile is. `dirty` only says "the cache is ahead of the file"; it says nothing
 * about the file having moved underneath us, and every write path that is not a save
 * (`assign`/`unassign`/`setDefault`, a rename cascade, `write`'s retry, and above all the startup
 * retry sweep, which runs before the renderer exists and therefore before any focus re-read can
 * have happened) used to render straight over such a file. That is precisely the hand-edit
 * clobbering AC5 forbids, so the decision is made from what the file actually says: the write is
 * allowed when there is no file, when the file already holds exactly what we would write anyway
 * (`renderProfileFile(candidate)` - a genuine no-op), or when the user explicitly asked for this
 * profile to be overwritten (`overwriteProfileId` - `save`'s `force`, i.e. the conflict dialog's
 * "overwrite with my version"). Otherwise the file is left alone, no `writeFailures` entry is
 * recorded (nothing failed), and the canonical row reports `outOfSync`, which is what invites the
 * user to Reload/Compare (story D9).
 *
 * Story 079: the bytes hashing to the profile's own cached `fileHash` alone is deliberately NOT
 * enough to allow the write, even though it proves the launcher itself read or wrote exactly these
 * bytes (so nothing external happened). A raw save (057) keeps hand-typed, possibly non-render-
 * fixed-point bytes as that very confirmed baseline on purpose - `fileHash` matching the disk is
 * exactly what a hand-formatted canonical file looks like right after being saved. Allowing the
 * write there would silently replace the user's typed formatting with `renderProfileFile(candidate)`
 * on the very next retry trigger (`write`'s "Sync now", `assign`, `setDefault`, ...), which is the
 * reformat 057 promises never happens - and, as a side effect, would turn every OTHER installation's
 * already-correct copy into fresh drift. Nothing is lost by refusing: `sync.ts`'s
 * `installationCopySource` already publishes those same hash-matched bytes to every installation
 * regardless of whether the canonical file itself gets rewritten.
 *
 * What that refusal must NOT also block is the file's *name* (story 079 review, finding 1), which
 * is why `canonicalMoveAllowed` is a second, wider predicate: hash-matched bytes may not be
 * re-rendered, but the file they sit in is still ours to move to the name the profile resolves to
 * now. Conflating the two stranded a clean, hand-formatted profile on a file name another profile's
 * rename had made it give up - and `writeCanonicalProfileFile` refuses to overwrite a live
 * profile's canonical file, so that other profile's save failed on every retry instead.
 *
 * A profile with no `fileHash` at all keeps the pre-043 behaviour deliberately: there is no baseline
 * to compare against, and by the time a profile has one - which AC8's migration seeds for every
 * pre-existing profile on the first start, and `create`/`save`/`adopt`/rebuild seed for every other
 * - this rule applies to it.
 *
 * The mirror image of all of it is the `canonicalHashes` loop below: whenever a run confirmed a
 * profile's canonical file byte-for-byte, that hash becomes the profile's `fileHash` baseline, so
 * the launcher's own write is never later mistaken for an external edit (story D2's contract, here
 * for every profile a cascade confirmed, not only the triggering one).
 */
async function syncAndPersist(
  deps: ProfileWritesDeps,
  profile: ConfigProfile,
  allProfiles: ConfigProfile[],
  options: SyncAndPersistOptions = {},
): Promise<ProfileSyncState | null> {
  const { log, profiles } = deps
  try {
    // The run is async: another run may change the slice while this one awaits, so only this
    // run's own delta against what it started from is applied afterwards.
    const before = deps.config.writeFailures.get()
    const outcome = await syncProfile({
      profile,
      allProfiles,
      installations: deps.installations,
      launchState: deps.launchState(),
      playedModsFor: (installationId) => deps.config.playedMods.get()[installationId] ?? [],
      switchBindFor: (installationId) => deps.config.switchBinds.get()[installationId],
      canonicalBaseDir: deps.canonicalBaseDir(),
      writeFailures: before,
      targetInstallationId: options.targetInstallationId,
      canonicalWriteAllowed: (candidate, onDisk) => {
        // Story 079 D3: the cascade after a raw save (`saveRawText`) or an adopted external edit
        // (`refreshFromFiles`) must never re-render the canonical file it just adopted - the typed/
        // adopted bytes are not necessarily a render fixed point (hand formatting, a foreign tool's
        // output), and the ordinary rule below would allow the write anyway (the just-adopted
        // `fileHash` matches the disk by construction). This check runs first, and only for the one
        // profile the caller names, so a sibling assigned to the same installation still follows the
        // ordinary rule below (a dirty sibling still refuses; a clean one still writes).
        if (candidate.id === options.refuseCanonicalWriteFor) return false
        // Story 175 D1: this is the only rule keeping a dirty profile's file untouched here - the one
        // deliberate writer of a dirty profile's canonical file is `commitCvars`, which writes it
        // itself (baseline bytes plus the committed cvars only, never the pending edits) and then
        // passes `refuseCanonicalWriteFor` so this cascade cannot re-render it either way.
        if (candidate.dirty === true) return false
        if (candidate.id === options.overwriteProfileId) return true
        if (onDisk.content === null) return true
        if (typeof candidate.fileHash !== 'string') return true
        // Deliberately NOT `onDisk.hash === candidate.fileHash` alone (see the file doc comment
        // above `syncAndPersist`): that only proves these are bytes the launcher itself produced,
        // not that they are `renderProfileFile`'s output - a raw save keeps hand-typed, non-fixed-
        // point bytes as exactly that confirmed baseline, and writing here would silently reformat
        // them on the next retry trigger.
        if (onDisk.content === renderProfileFile(candidate)) return true
        log.warn(
          `leaving canonical file for profile ${candidate.id} alone: it holds bytes the launcher ` +
            `has not read (an external edit), and only an explicit save may overwrite those`,
        )
        return false
      },
      canonicalMoveAllowed: (candidate, onDisk) => {
        // Story 079 (review finding 1): the file's LOCATION, asked only where the rule above said
        // "not ours to re-render". Moving preserves every byte, so the reformat risk that makes
        // the write rule refuse hash-matched bytes simply does not exist here - while refusing the
        // move does real damage: a clean, hand-formatted profile displaced by another profile's
        // rename would sit on the name that profile now claims, and `writeCanonicalProfileFile`
        // refuses (throws) rather than destroy a live profile's file, so that save could never
        // succeed on any retry.
        //
        // A `dirty` profile is still excluded: story 043 has a rename only mark the profile dirty
        // and leave the canonical file under its old name until the user actually saves, and
        // `sync.ts` reads that profile's bytes from the old name accordingly.
        if (candidate.dirty === true) return false
        // Nothing on disk to move.
        if (onDisk.content === null) return false
        if (typeof candidate.fileHash !== 'string') return true
        // Bytes the launcher itself read or wrote (the raw-save/adopt baseline), or bytes that
        // already are our render. An external edit nobody has read is neither, and stays put -
        // moving it would be just as surprising as overwriting it.
        return onDisk.hash === candidate.fileHash || onDisk.content === renderProfileFile(candidate)
      },
      log,
    })
    deps.config.writeFailures.update((live) =>
      mergeWriteFailureChanges(live, before, outcome.writeFailures),
    )
    const now = Date.now()
    for (const [profileId, fileHash] of Object.entries(outcome.canonicalHashes)) {
      // A profile that vanished mid-run (removed by another handler while this one awaited) is
      // simply skipped - seeding a cache entry for it has nothing to be a cache of. So is one whose
      // baseline already IS this hash: re-confirming the same bytes (which every retry sweep and
      // every assign of an unchanged profile does) has nothing new to record, and committing the
      // whole profile list for it would be pure churn.
      const cached = profiles.find(profileId)
      if (
        cached &&
        (cached.fileHash !== fileHash ||
          cached.fileState !== 'unchanged' ||
          // Story 049 D1: `markFileSeen` also seeds the last-saved baseline, so a record that has
          // none yet - every profile persisted before this story - has something new to record even
          // when its hash is already right, and gets its baseline on the first sync that confirms
          // its file instead of waiting for the next content change. Safe for a `dirty` profile
          // too: an id only appears in `canonicalHashes` when the file was read back byte-identical
          // to this profile's own render (`sync.ts`), so the snapshot describes the file either way.
          cached.baseline === undefined)
      ) {
        profiles.markFileSeen(profileId, fileHash, now)
      }
    }
    return outcome.state
  } catch (error) {
    log.error(`unexpected error syncing config profile ${profile.id}`, error)
    return null
  }
}

/**
 * Story 079 review (finding 1): the read-before-write guard a CONTENT-mutating handler must pass
 * before it is allowed to pass `overwriteProfileId` to `syncAndPersist` for the profile it just
 * mutated - i.e. before it is allowed to license `canonicalWriteAllowed` to re-render the canonical
 * file. `save` (below) inlines this same check because its own conflict/unreadable result shapes
 * come out of it directly; this is the same rule extracted for callers, like `tidyUpApply`, that
 * mutate profile content without a `dirty` flag and without a conflict shape to report through.
 *
 * Answers a single question against `profile` AS IT STOOD BEFORE the mutation: is the canonical
 * file still what was last read from it (`unchanged`), or is there nothing there yet to conflict
 * with (`missing`)? Either means the write is ours to make. `changedOnDisk` (a hand-edit that
 * landed since), `unparseable`/`readError` (a file we cannot trust the shape of), or a canonical
 * directory that could not even be surveyed all mean it is NOT ours to make - the caller must not
 * pass `overwriteProfileId` in that case. What the caller does about a refusal is its own choice
 * (`save` returns a `conflict`/`unreadable` result and touches nothing; `tidyUpApply` has no such
 * shape, so it commits the tidy-up to `state.json` regardless - nothing the user just did is lost -
 * and leaves the canonical file alone, which is exactly what `canonicalWriteAllowed`'s own "holds
 * bytes the launcher has not read" refusal already logs).
 */
async function authoriseContentWrite(
  deps: ProfileWritesDeps,
  profile: ConfigProfile,
): Promise<boolean> {
  const fileName = await canonicalFileNameFor(deps, profile)
  if (fileName === null) return false
  const read = await deps.readFileState(deps.canonicalBaseDir(), fileName, profile.fileHash)
  return read.state === 'unchanged' || read.state === 'missing'
}

/**
 * The canonical file `profile` actually lives in: the one carrying its ownership sentinel
 * (`readCanonicalOwnership`), else the name it resolves to. The sentinel wins because a rename only
 * marks the profile dirty - its file stays under the old name until the user saves. `null` when the
 * profile resolves to no name or the canonical directory could not be surveyed (logged); a caller
 * about to write must then write nothing.
 */
async function canonicalFileNameFor(
  deps: ProfileWritesDeps,
  profile: ConfigProfile,
): Promise<string | null> {
  const resolvedName = resolveProfileFileNames(deps.profiles.list()).get(profile.id)
  if (!resolvedName) return null
  try {
    return (await readCanonicalOwnership(deps.canonicalBaseDir())).get(profile.id) ?? resolvedName
  } catch (error) {
    deps.log.error(`failed to survey the canonical directory before writing ${profile.id}`, error)
    return null
  }
}

/**
 * Read-only status of one on-disk file vs. what it should currently contain -
 * never writes. A persisted `configWriteFailures` entry for this exact key
 * always wins and is reported as `'error'` (the last attempted WRITE failed,
 * which matters even if the file on disk happens to look fine or absent for
 * some unrelated reason); otherwise the live file is read and compared.
 *
 * Latin1 to match `writer.ts`/`sync.ts`'s own encoding, so the comparison is a
 * true byte-for-byte one. `expectedContent: null` means there is nothing this file could be in
 * sync with (story 079 D2, see `sync.ts#installationCopySource`), so a readable file is
 * `outOfSync` whatever it holds - same reading as `sync.ts`'s own `liveFileStatus`.
 */
async function readSyncFileStatus(
  deps: ProfileWritesDeps,
  path: string,
  expectedContent: string | null,
  failure: FileWriteFailure,
): Promise<{ status: ProfileFileSyncStatus; messageKey?: string }> {
  if (failure) return { status: 'error', messageKey: failure.messageKey }
  try {
    const content = await deps.readText(path)
    return content === expectedContent ? { status: 'inSync' } : { status: 'outOfSync' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    return { status: 'error', messageKey: 'config.error.writeFailed' }
  }
}

/**
 * The alias names a file read lost, deduplicated, plus one log line per lost definition.
 *
 * Story-050 review (finding 4, second round): an `alias` name a file defines twice costs the read
 * one entry's commands before the profile is ever reconstructed (`file-source.ts#foldConfig`), and
 * the result looks exactly like a file that only ever had one such entry - so the only place the
 * loss is still visible is the warning list, and every path that adopts a file has to report it.
 * Extracted verbatim from `refreshFromFiles`' own fold when story 057 D4 added the second such path
 * (`saveRawText`): two copies of this would be two chances for one of them to stop reporting.
 * `context` is the caller's own prefix for the log line, the one thing the two differ in.
 */
function droppedAliasNames(
  deps: ProfileWritesDeps,
  warnings: readonly RestoreWarning[],
  profileId: string,
  context: string,
): string[] {
  const { log } = deps
  for (const warning of warnings) {
    if (warning.reason !== 'entry-alias-duplicate') continue
    log.warn(
      `${context}: alias "${warning.subject}" is defined more than once in ${warning.file}; ` +
        `the definition at line ${warning.line} was discarded (profile ${profileId})`,
    )
  }
  return [
    ...new Set(
      warnings
        .filter((warning) => warning.reason === 'entry-alias-duplicate')
        .map((warning) => warning.subject)
        .filter((subject): subject is string => subject !== undefined),
    ),
  ]
}

/**
 * Story 043 D4: the explicit save - the only thing in this module that writes profile
 * *content* to disk now, and the deliberate inversion of story 022 decision 8.
 *
 * Read before write, in this order, because the order IS the guarantee (AC5: "the launcher
 * never overwrites a hand-edit it has not read"):
 *
 * 1. Find the file that actually carries this profile's ownership sentinel
 *    (`readCanonicalOwnership`), not merely the name the profile *resolves* to. A rename now
 *    only marks the profile dirty, so a renamed-but-unsaved profile's file still sits under its
 *    old name - checking the resolved name would find nothing there, call that "missing" and
 *    write straight over a hand-edit of the old file. This lookup is what closes that hole.
 * 2. Classify it against the cached `fileHash` (`readFileState`, story D2). `unchanged` and
 *    `missing` are both "ours to write": nothing changed underneath us, or there is nothing
 *    there to conflict with (including the story's "rewrite it from cache" case for a file
 *    deleted outside the launcher - pressing Save *is* that instruction).
 * 3. `changedOnDisk` refuses and answers a conflict carrying both whole files, the decided
 *    whole-file granularity; the profile stays dirty and `state.json` is left exactly as it is,
 *    so nothing about the user's unsaved edits is lost by refusing.
 * 4. `unparseable`/`readError` also refuse: a file we cannot read is as much "a hand-edit we
 *    have not read" as a changed one. Reported, never written over.
 *
 * Only then is `dirty` cleared, and only so the ordinary sync run below is allowed to write the
 * canonical file at all (`syncAndPersist`'s per-profile rule) - the installation cascade itself
 * is completely unchanged, which is what keeps AC6 true: the copies come from the same
 * canonical content this save just put on disk. The write is then *verified* by reading it back
 * (`own.status`, the sync engine's own "trust the disk") before the profile is called saved; on
 * anything less the profile goes straight back to dirty rather than being remembered as saved
 * when it is not.
 *
 * Story 043 D8: `input.force` is the "overwrite with my version" resolution of
 * `ConfigConflictDialog` - it skips steps 2-4 above entirely (no re-read, no conflict, no
 * unreadable refusal) and goes straight to the write, since the user has already been shown
 * whatever is on disk and explicitly chosen to replace it regardless of what it now says.
 */
async function save(
  deps: ProfileWritesDeps,
  input: SaveProfileInput,
): Promise<Outcome<SaveProfileResult>> {
  const { log, profiles } = deps
  const profile = profiles.find(input.profileId)
  if (!profile) return fail('config.error.profileNotFound')

  const baseDir = deps.canonicalBaseDir()
  // `profile` came out of the list, so this lookup cannot miss.
  const resolvedName = resolveProfileFileNames(profiles.list()).get(profile.id)!

  let ownedName: string | undefined
  try {
    ownedName = (await readCanonicalOwnership(baseDir)).get(profile.id)
  } catch (error) {
    // The canonical directory itself could not be listed (a permissions problem, something
    // in the way of the directory). Nothing is written on a disk we cannot survey.
    log.error(`failed to survey the canonical directory before saving ${profile.id}`, error)
    return ok({
      status: 'unreadable',
      fileName: resolvedName,
      path: join(baseDir, resolvedName),
      reason: 'readError',
      message: error instanceof Error ? error.message : String(error),
    })
  }
  const fileName = ownedName ?? resolvedName
  const path = join(baseDir, fileName)

  if (input.force !== true) {
    const read = await deps.readFileState(baseDir, fileName, profile.fileHash)
    if (read.state === 'changedOnDisk') {
      return ok({
        status: 'conflict',
        fileName,
        path,
        diskContent: read.content,
        ourContent: renderProfileFile(profile),
      })
    }
    if (read.state === 'unparseable') {
      return ok({
        status: 'unreadable',
        fileName,
        path,
        reason: 'unparseable',
        line: read.line,
        message: read.message,
      })
    }
    if (read.state === 'readError') {
      return ok({
        status: 'unreadable',
        fileName,
        path,
        reason: 'readError',
        message: read.error instanceof Error ? read.error.message : String(read.error),
      })
    }
  }

  // `unchanged` or `missing`, or `force === true`: the file is ours to write.
  const list = withLiveAssignments(deps, profiles.setDirty(profile.id, false))
  // `setDirty` throws on an unknown id and cannot remove the profile, so this cannot miss.
  const target = list.find((p) => p.id === profile.id)!
  // `overwriteProfileId` is passed unconditionally here, not only on `force`: on EITHER path
  // this call has already established the write is authorized - `force` is the conflict
  // dialog's explicit "overwrite with my version" after being shown both whole files, and the
  // ordinary path already re-read the file above and confirmed it is `unchanged`/`missing`
  // (nothing external happened since we last read or wrote it). Story 079: it must be
  // unconditional, not merely the by-product of `syncAndPersist`'s general "the on-disk hash
  // matches the cached `fileHash`" rule, because that rule is deliberately no longer enough on
  // its own (see the file doc comment above `syncAndPersist`) - a raw save's hand-typed,
  // non-render-fixed-point bytes also satisfy it, and `save` is the one caller that must still
  // be able to publish genuinely new content (`renderProfileFile(target)`, reflecting the edits
  // just cleared from `dirty`) over such a file, while every other, non-save trigger
  // (`write`/`assign`/`setDefault`/a rename cascade/the startup retry sweep) must not.
  const state = await syncAndPersist(deps, target, list, {
    overwriteProfileId: profile.id,
  })
  if (!state || state.own.status !== 'inSync') {
    // The file on disk is not what this profile says, so the edits are still unsaved. Says so,
    // rather than reporting a save that did not happen - `configWriteFailures` already carries
    // the why, and the next save (or any retry trigger) will try again.
    profiles.setDirty(profile.id, true)
    return fail('config.error.writeFailed')
  }
  // Re-read the record: `syncAndPersist` seeded `fileHash`/`fileSeenAt` from the bytes it just
  // confirmed on disk, and the caller wants the profile as it now stands - through
  // `withLiveAssignments`, the same view of it every other handler returns.
  const saved =
    withLiveAssignments(deps, profiles.list()).find((p) => p.id === profile.id) ?? target
  return ok({ status: 'saved', profile: saved, sync: state })
}

/**
 * Story 057 D4: the Raw file tab's inline editor saving the text the user typed, byte for byte.
 *
 * `save` writes what the cached profile *renders to*; this writes what the user *typed*,
 * and then brings the profile in line with the file by reading it back. The direction is the
 * whole guarantee (AC: "the file on disk is exactly what I typed"), so nothing in this handler
 * ever renders the profile over these bytes - not before the write, not after the adopt, and not
 * through the installation cascade (see the note on that below).
 *
 * Same order as `save`, and for the same reasons - read before write, because the order IS the
 * guarantee:
 *
 * 1. Two pre-flights on the text itself, before anything is read or written, both of them things
 *    a user can genuinely produce in an editor rather than caller bugs (hence i18n keys and not
 *    a schema throw):
 *    - the ownership tag must still be there and still name THIS profile. It is what every guard
 *      in this module keys on (`save`'s own file lookup, `refreshFromFiles`, `openFile`,
 *      `removeCanonicalProfileFile`), so writing text that has lost it would orphan the file from
 *      its profile - the launcher would go looking for a canonical file and find none, while the
 *      user's config sits right there under its own name.
 *    - the text has to be storable as a Quake II config: latin-1 only (the file encoding - a
 *      higher code point cannot survive the round trip) and free of the control bytes
 *      `readFileState` classifies a file as `unparseable` for. Checked with the read side's own
 *      `corruptContentDiagnostic`, so the write side can never accept bytes the read side then
 *      refuses.
 * 2. The file that actually carries this profile's ownership stamp (`readCanonicalOwnership`),
 *    never merely the name the profile resolves to - identical to `save`'s step 1, and load
 *    bearing for the same reason (a renamed-but-unsaved profile's file still sits under its old
 *    name). Note the difference from `save`: this handler writes to wherever that file IS and
 *    never renames it. A raw save is an edit of a file's *content*; moving it would break the
 *    conflict baseline the very same call just established.
 * 3. The same `readFileState` conflict guard, answering `save`'s own `conflict`/`unreadable`
 *    shapes, with the same `force` bypass. The one nuance: `ourContent` is the typed text, since
 *    that is what this save would have written.
 * 4. The write, through `writer.ts#writeTargetFile` - the same diff-skip/backup-once/atomic write
 *    every other file in this module goes through, handed the text verbatim.
 * 5. The file-state record is refreshed from a re-read of the file, checked against the hash of
 *    the bytes we just wrote. That is what keeps the next conflict guard from reporting a phantom
 *    external edit, and it doubles as `save`'s "verify the write by reading it back" step: a
 *    read-back that is not `unchanged` means the bytes on disk are not ours, so nothing is
 *    adopted and the call fails honestly.
 * 6. The adopt, through `ProfilesStore.adoptFromFile` - the exact path `refreshFromFiles` uses
 *    for an external edit, given the same fields from the same read, because a raw save IS an
 *    external edit as far as the profile is concerned; it just happens to have come from our own
 *    editor.
 * 7. Story 079 D3: the installation cascade (`syncAndPersist`), same as every other content
 *    mutation - every assigned, not-running installation's copy is brought in line with the file
 *    that now sits on disk, same as after a structured save. `refuseCanonicalWriteFor` is passed
 *    so the cascade never re-renders the canonical file it just wrote: the profile is clean and
 *    its hash matches the disk after the adopt above, so the ordinary rule would allow the write,
 *    and `renderProfileFile(profile)` is not necessarily the same bytes as the text the user just
 *    typed (hand formatting is not a render fixed point). The installation copies are then
 *    written from those same on-disk bytes (`installationCopySource` in `sync.ts`), so they land
 *    byte-identical to what was typed - and a dirty sibling assigned to the same installation is
 *    untouched by the ordinary per-profile rule, exactly as it is after a structured save.
 */
async function saveRawText(
  deps: ProfileWritesDeps,
  input: SaveRawTextInput,
): Promise<Outcome<SaveRawTextResult>> {
  const { log, profiles } = deps
  const profile = profiles.find(input.profileId)
  if (!profile) return fail('config.error.profileNotFound')

  if (ownedProfileIdFromContent(input.text) !== profile.id) {
    log.warn(
      `refusing a raw save for profile ${profile.id}: the text no longer carries this ` +
        `profile's ownership stamp`,
    )
    return fail('config.error.rawTextNotOwned')
  }
  // `corruptContentDiagnostic`'s file/line/message describe a file being read; here only its
  // yes/no answer is used (the text is not a file yet, and the rejection is one message about
  // the whole payload), hence the empty file name.
  if (!isLatin1Text(input.text) || corruptContentDiagnostic('', input.text) !== null) {
    log.warn(
      `refusing a raw save for profile ${profile.id}: the text holds characters a config ` +
        `file cannot carry`,
    )
    return fail('config.error.rawTextNotLatin1')
  }

  const baseDir = deps.canonicalBaseDir()
  // `profile` came out of the list, so this lookup cannot miss.
  const resolvedName = resolveProfileFileNames(profiles.list()).get(profile.id)!

  let ownedName: string | undefined
  try {
    ownedName = (await readCanonicalOwnership(baseDir)).get(profile.id)
  } catch (error) {
    // Same refusal `save` makes: nothing is written on a disk we cannot survey.
    log.error(`failed to survey the canonical directory before a raw save of ${profile.id}`, error)
    return ok({
      status: 'unreadable',
      fileName: resolvedName,
      path: join(baseDir, resolvedName),
      reason: 'readError',
      message: error instanceof Error ? error.message : String(error),
    })
  }
  const fileName = ownedName ?? resolvedName
  const path = join(baseDir, fileName)

  if (input.force !== true) {
    const read = await deps.readFileState(baseDir, fileName, profile.fileHash)
    if (read.state === 'changedOnDisk') {
      return ok({
        status: 'conflict',
        fileName,
        path,
        diskContent: read.content,
        // What this save would have written - which, unlike `save`'s, is the typed text
        // itself. The dialog's "Overwrite" re-sends exactly this with `force: true`.
        ourContent: input.text,
      })
    }
    if (read.state === 'unparseable') {
      return ok({
        status: 'unreadable',
        fileName,
        path,
        reason: 'unparseable',
        line: read.line,
        message: read.message,
      })
    }
    if (read.state === 'readError') {
      return ok({
        status: 'unreadable',
        fileName,
        path,
        reason: 'readError',
        message: read.error instanceof Error ? read.error.message : String(read.error),
      })
    }
  }

  // `unchanged` or `missing`, or `force === true`: the file is ours to write.
  try {
    await deps.writeTargetFile(path, input.text)
  } catch (error) {
    log.error(`failed to write the raw config text for profile ${profile.id}`, error)
    return fail('config.error.writeFailed')
  }

  // The hash of the bytes we just handed the writer. `hashCanonicalFileContent` encodes latin1
  // exactly as `writeFileAtomic` does, so this IS the file's hash - and passing it as the
  // cached hash below turns the read-back into a verification: anything but `unchanged` means
  // what is on disk is not what we wrote.
  const written = hashCanonicalFileContent(input.text)
  const readBack = await deps.readFileState(baseDir, fileName, written)
  if (readBack.state !== 'unchanged') {
    log.error(
      `raw save for profile ${profile.id} did not land: reading ${fileName} back gave ` +
        `"${readBack.state}" instead of the bytes just written`,
    )
    return fail('config.error.writeFailed')
  }

  // The file is the source of truth and now says exactly what the user typed, so any structured
  // edit that was still unsaved has been superseded by it. The renderer keeps the two apart
  // (story 057's mutual exclusion: no raw draft while the profile is dirty), so this is the
  // belt to that braces - and it is explicit rather than left to `adoptFromFile`, which
  // deliberately never touches `dirty` (same step `refreshFromFiles`' `discardLocalEdits`
  // branch makes for the same reason).
  if (profile.dirty === true) {
    log.warn(
      `raw save for profile ${profile.id} replaced unsaved structured edits: the file the ` +
        `user typed is the profile now`,
    )
  }
  profiles.setDirty(profile.id, false)

  const list = withLiveAssignments(
    deps,
    profiles.adoptFromFile(
      profile.id,
      {
        name: recoverProfileName(readBack.content) ?? profile.name,
        ...restoredToProfileFields(
          readBack.profile.cvars,
          readBack.profile.binds,
          readBack.profile,
        ),
        writeUnbindall: detectWriteUnbindall(readBack.content),
        sectionHeaderStyle:
          detectSectionHeaderStyle(readBack.content) ?? profile.sectionHeaderStyle,
      },
      readBack.hash,
      Date.now(),
    ),
  )
  // `adoptFromFile` throws on an unknown id and cannot remove the profile, so this cannot miss.
  const adopted = list.find((p) => p.id === profile.id)!

  // Story 079 D3: cascade the typed bytes to every assigned, not-running installation - see
  // point 7 of the doc comment above for why the canonical write is refused for this profile.
  await syncAndPersist(deps, adopted, list, {
    refuseCanonicalWriteFor: adopted.id,
  })

  return ok({
    status: 'saved',
    fileName,
    path,
    profile: adopted,
    droppedAliases: droppedAliasNames(deps, readBack.profile.warnings, profile.id, 'raw save'),
    preservedLines: readBack.profile.preserved,
  })
}

/**
 * Story 043 D5: the re-read side of the story's "re-read on window focus, tab open, and before
 * write" decision. `input.profileId` scopes the check to that one profile (the story's own
 * "Decided during refine": window focus/tab open re-read only the selected profile, so focus
 * latency does not scale with the profile count); omitted, every profile is checked (a later
 * deliverable's startup call site).
 *
 * Never writes profile *content* other than the display-hint bookkeeping documented on
 * `ProfilesStore.setFileState`/`adoptFromFile` below, and never deletes a profile record - a
 * missing or unparseable file leaves the cache exactly as usable as it was a moment ago.
 */
async function refreshFromFiles(
  deps: ProfileWritesDeps,
  input: RefreshFromFilesInput,
): Promise<Outcome<RefreshFromFilesResult>> {
  const { log, profiles } = deps
  const allProfiles = profiles.list()
  if (input.profileId !== undefined && !allProfiles.some((p) => p.id === input.profileId)) {
    return fail('config.error.profileNotFound')
  }
  const targets = input.profileId
    ? allProfiles.filter((p) => p.id === input.profileId)
    : allProfiles
  const fileNames = resolveProfileFileNames(allProfiles)
  const baseDir = deps.canonicalBaseDir()

  // Story 043 D10: the file each profile's ownership sentinel actually sits in - the same
  // lookup `save` above does, and for the same reason. A rename only marks the profile dirty
  // (D4), so a renamed-but-unsaved profile's canonical file is still under its PREVIOUS name;
  // classifying the resolved name instead reported that profile as `missing`, which is how the
  // UI ends up offering "Remove profile" for a file that was never gone. A directory that
  // cannot be surveyed degrades to the resolved names rather than failing the whole refresh -
  // each per-profile read below still classifies its own file honestly.
  let ownership: ReadonlyMap<string, string>
  try {
    ownership = await readCanonicalOwnership(baseDir)
  } catch (error) {
    log.error('failed to survey the canonical directory before a file refresh', error)
    ownership = new Map()
  }

  const results: RefreshedProfileResult[] = []
  for (const profile of targets) {
    // `profile` came out of `allProfiles`, so the fallback lookup cannot miss.
    const fileName = ownership.get(profile.id) ?? fileNames.get(profile.id)!
    const read = await deps.readFileState(baseDir, fileName, profile.fileHash)

    if (read.state === 'unchanged') {
      // Nothing to do: the cached hash already matches the disk bytes, and the cached
      // `fileState` is already `'unchanged'` from whatever previous read/write/adopt got it
      // there. Calling `markFileSeen` again would be harmless but pointless churn.
      results.push({ profileId: profile.id, outcome: 'unchanged', fileState: 'unchanged' })
      continue
    }

    if (read.state === 'changedOnDisk') {
      // Story 043 D8: `discardLocalEdits` is the "take the file" resolution of
      // `ConfigConflictDialog` - the user has already been shown both whole-file versions
      // and chosen to throw their own edits away, so a dirty profile no longer refuses here.
      const discardingLocalEdits = profile.dirty === true && input.discardLocalEdits === true
      if (profile.dirty === true && !discardingLocalEdits) {
        // A genuine conflict: unsaved UI edits AND a disk change. Adopt nothing, touch
        // nothing about the cached profile - same whole-file shape `save` (D4) returns for
        // its own `changedOnDisk` refusal.
        results.push({
          profileId: profile.id,
          outcome: 'conflict',
          fileState: 'changedOnDisk',
          conflict: {
            status: 'conflict',
            fileName,
            path: join(baseDir, fileName),
            diskContent: read.content,
            ourContent: renderProfileFile(profile),
          },
        })
        continue
      }

      if (discardingLocalEdits) {
        // `adoptFromFile` below deliberately leaves `dirty` alone (its own doc comment: "the
        // caller only reaches this method when the profile was not dirty in the first
        // place") - true for the ordinary adopt path, not for this one, so `dirty` is cleared
        // explicitly here before the overlay.
        profiles.setDirty(profile.id, false)
      }

      // No unsaved edits (or edits just explicitly discarded): adopt the disk version into
      // the cache. The file-carried fields
      // (name, cvars/binds/actions/categories/layers, writeUnbindall, sectionHeaderStyle) are
      // recovered the same way `rebuild.ts`'s startup rebuild recovers them for a brand-new
      // record; unlike that path, a missing/undetected style falls back to the profile's
      // *current* value rather than being omitted, since there is an existing value here to
      // preserve rather than a fresh record's implicit default.
      const list = withLiveAssignments(
        deps,
        profiles.adoptFromFile(
          profile.id,
          {
            name: recoverProfileName(read.content) ?? profile.name,
            ...restoredToProfileFields(read.profile.cvars, read.profile.binds, read.profile),
            writeUnbindall: detectWriteUnbindall(read.content),
            sectionHeaderStyle:
              detectSectionHeaderStyle(read.content) ?? profile.sectionHeaderStyle,
          },
          read.hash,
          Date.now(),
        ),
      )
      // `adoptFromFile` throws on an unknown id and cannot remove the profile, so this
      // cannot miss.
      const adopted = list.find((p) => p.id === profile.id)!

      // Story 079 D3: cascade the adopted file to every assigned, not-running installation -
      // same reasoning as `saveRawText`'s own cascade above (point 7 of its doc comment): the
      // canonical write is refused for this profile so the run never re-renders the file it
      // just adopted (the on-disk bytes are not necessarily a render fixed point), and the
      // installation copies are then written from those same on-disk bytes. Covers both this
      // silent re-read's ordinary adopt and the "take the file" conflict resolution above -
      // both reach this same block.
      await syncAndPersist(deps, adopted, list, {
        refuseCanonicalWriteFor: adopted.id,
      })

      // Story-050 review (finding 4, second round): an `alias` name the file defined twice
      // cost the adopt one entry's commands before `readFileState` ever got to reconstruct the
      // profile - reported so the UI can say so, and logged so a support copy of the log says
      // it too. Deduplicated by name: the field names *which* alias collided, and one name
      // repeated three times is still one thing to tell the user about. Story 057 D4 moved the
      // fold itself into `droppedAliasNames` above, unchanged, so the raw-save adopt reports
      // the same loss the same way.
      const droppedAliases = droppedAliasNames(deps, read.profile.warnings, profile.id, 'refresh')
      results.push({
        profileId: profile.id,
        outcome: 'adopted',
        fileState: 'changedOnDisk',
        profile: adopted,
        droppedAliases,
      })
      continue
    }

    if (read.state === 'unparseable') {
      // The last good cache stays exactly as it is - only the display hint changes.
      profiles.setFileState(profile.id, 'unparseable')
      results.push({
        profileId: profile.id,
        outcome: 'unparseable',
        fileState: 'unparseable',
        file: read.file,
        line: read.line,
        message: read.message,
      })
      continue
    }

    if (read.state === 'missing') {
      // Never deletes the record - the story's own decision keeps it in the list, marked
      // "file missing", awaiting the user's "rewrite from cache" or "remove profile".
      profiles.setFileState(profile.id, 'missing')
      results.push({ profileId: profile.id, outcome: 'missing', fileState: 'missing' })
      continue
    }

    // `readError`: treated exactly as conservatively as `unparseable` - reported, nothing
    // else about the cached profile touched.
    profiles.setFileState(profile.id, 'readError')
    results.push({
      profileId: profile.id,
      outcome: 'readError',
      fileState: 'readError',
      message: read.error instanceof Error ? read.error.message : String(read.error),
    })
  }

  return ok(results)
}

/**
 * The sync tail of `create` and `importCommit`. The new profile is the LAST element of `list`:
 * the store appends it to the end of the array it commits, and every transform in between -
 * `commit()`'s `.map`, `reconcileAssignments`' `.map` - is order-preserving and never adds or drops
 * an entry.
 *
 * Still writes immediately, and deliberately so (story 043 D4): a brand-new profile has no canonical
 * file yet, and the file is what the profile *is* now - `state.json` being only a cache, a profile
 * whose file was never written would be lost by the very rebuild pass that makes the cache
 * disposable. It is not dirty at this point, so the write goes through. It has no assignments yet,
 * so this sync only writes its canonical file.
 */
async function syncAppended(
  deps: ProfileWritesDeps,
  list: ConfigProfile[],
): Promise<Outcome<ConfigProfile[]>> {
  await syncAndPersist(deps, list[list.length - 1]!, list)
  return ok(list)
}

/**
 * Nothing is left to sync for a removed profile, so instead of a sync run: delete its canonical file
 * and drop its now-stale bookkeeping. All of it best-effort - a failure here must never turn a
 * completed removal into a failed IPC response.
 *
 * Documented simplification: per-installation copies of the removed profile are NOT deleted here.
 * They are cleaned up by `reconcileOwnedProfileFiles` inside `syncProfile` the next time that
 * installation is synced for any other reason.
 */
async function cleanupRemoved(deps: ProfileWritesDeps, profileId: string): Promise<void> {
  const { log } = deps
  try {
    await removeCanonicalProfileFile(deps.canonicalBaseDir(), profileId)
  } catch (error) {
    log.error(`failed to remove canonical profile file for ${profileId}`, error)
  }
  try {
    deps.config.writeFailures.update((live) => {
      const kept = Object.fromEntries(
        Object.entries(live).filter(([key]) => !key.startsWith(`${profileId}|`)),
      )
      return Object.keys(kept).length === Object.keys(live).length ? live : kept
    })
  } catch (error) {
    log.error(`failed to drop stale sync bookkeeping for removed profile ${profileId}`, error)
  }
}

/**
 * Story 175 D1: writes the chosen cvars into the profile's canonical file WITHOUT saving
 * anything else - the one exception to "a dirty profile is only written by `save`" (see
 * `canonicalWriteAllowed` in `syncAndPersist`). Every other pending edit stays off disk and stays
 * unsaved:
 *
 * 1. A dirty profile without a baseline has no record of what its file says, so there is
 *    nothing to write the cvars on top of - refused (`commitNeedsSave`); the user saves instead.
 * 2. The same read-before-write guard every content write passes (`authoriseContentWrite`): a
 *    file changed on disk or unreadable is refused (`commitConflict`) and never forced - this is
 *    a background commit, not the user's explicit "overwrite".
 * 3. The bytes are rendered from the BASELINE (the file as last saved) plus the patch, never
 *    from the live record, which carries the pending edits. A pending rename therefore keeps the
 *    old name in the file, and the write goes to the file the sentinel says the profile still
 *    owns, never to the new name.
 * 4. A write failure changes nothing in the store. After a successful write the store patches
 *    both the live record and the baseline with the cvars (`commitSavedCvars`, not
 *    `markFileSeen`, which would absorb the pending edits into the baseline) and leaves `dirty`
 *    alone.
 * 5. The installation cascade runs with `refuseCanonicalWriteFor`, so the copies are brought in
 *    line with the bytes now on disk while the canonical file is not re-rendered from the live
 *    record.
 *
 * Known limitation: `writeCatalogDefaults` is a render-relevant field that `captureBaseline`
 * does not snapshot, so a pending catalog-defaults toggle is rendered from the live value and
 * would land on disk with the commit. Follow-up: add the field to `captureBaseline` in
 * `src/shared/config/profile-baseline.ts`.
 */
async function commitCvars(
  deps: ProfileWritesDeps,
  input: CommitProfileCvarsInput,
): Promise<Outcome<ConfigProfile>> {
  const { log, profiles } = deps
  const profile = profiles.find(input.profileId)
  if (!profile) return fail('config.error.profileNotFound')
  if (profile.dirty === true && !profile.baseline) return fail('config.error.commitNeedsSave')

  if (!(await authoriseContentWrite(deps, profile))) {
    log.warn(
      `refusing to commit cvars for profile ${profile.id}: its canonical file changed on disk ` +
        `or could not be read`,
    )
    return fail('config.error.commitConflict')
  }
  const fileName = await canonicalFileNameFor(deps, profile)
  if (fileName === null) return fail('config.error.commitConflict')

  const baseline = profile.baseline
  const view: ConfigProfile = {
    ...profile,
    ...(baseline ?? {}),
    cvars: { ...(baseline ?? profile).cvars, ...input.cvars },
  }
  const bytes = renderProfileFile(view)
  try {
    await deps.writeTargetFile(join(deps.canonicalBaseDir(), fileName), bytes)
  } catch (error) {
    log.error(`failed to commit cvars into the canonical file of profile ${profile.id}`, error)
    return fail('config.error.writeFailed')
  }

  // `hashCanonicalFileContent` encodes latin1 exactly as the writer does, so this IS the hash
  // `readFileState` will compare the next read against.
  const list = profiles.commitSavedCvars(
    profile.id,
    input.cvars,
    hashCanonicalFileContent(bytes),
    Date.now(),
  )
  const committed = list.find((p) => p.id === profile.id)!
  await syncAndPersist(deps, committed, list, { refuseCanonicalWriteFor: committed.id })

  return ok(withLiveAssignments(deps, profiles.list()).find((p) => p.id === profile.id)!)
}

async function assign(
  deps: ProfileWritesDeps,
  input: AssignProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  if (!deps.installations.find(input.installationId)) {
    return fail('config.error.installationNotFound')
  }
  let list: ConfigProfile[]
  try {
    list = withLiveAssignments(deps, deps.profiles.assign(input))
  } catch {
    // Nothing was mutated, so there is nothing to sync.
    return fail('config.error.profileNotFound')
  }
  await syncAndPersist(
    deps,
    list.find((p) => p.id === input.profileId)!,
    list,
  )
  return ok(list)
}

async function unassign(
  deps: ProfileWritesDeps,
  input: UnassignProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  if (!deps.installations.find(input.installationId)) {
    return fail('config.error.installationNotFound')
  }
  let list: ConfigProfile[]
  try {
    list = withLiveAssignments(deps, deps.profiles.unassign(input))
  } catch {
    return fail('config.error.profileNotFound')
  }
  // Covers the profile's own canonical file plus its remaining assignments.
  await syncAndPersist(
    deps,
    list.find((p) => p.id === input.profileId)!,
    list,
  )

  // The unassigned-from installation's own orphaned copy is only removed by
  // `reconcileOwnedProfileFiles`, which runs while syncing a profile that is
  // still assigned there - so sync its current default too.
  //
  // Documented simplification: when nothing is assigned to that
  // installation any more there is no such profile, and the orphaned file
  // is left for a future sync of that installation.
  const stillDefault = defaultProfileFor(list, input.installationId)
  if (stillDefault && stillDefault.id !== input.profileId) {
    await syncAndPersist(deps, stillDefault, list)
  }
  return ok(list)
}

async function setDefault(
  deps: ProfileWritesDeps,
  input: SetDefaultProfileInput,
): Promise<Outcome<ConfigProfile[]>> {
  if (!deps.installations.find(input.installationId)) {
    return fail('config.error.installationNotFound')
  }
  let list: ConfigProfile[]
  try {
    list = withLiveAssignments(deps, deps.profiles.setDefault(input))
  } catch (error) {
    // The thrown message is the only way to tell "unknown profile" apart
    // from "profile exists but isn't assigned to that installation" -
    // `assignments.ts` throws a plain `Error` in both cases (see
    // `requireProfile` vs the not-assigned check in `setDefault`).
    const notAssigned =
      error instanceof Error && error.message.includes('is not assigned to installation')
    return fail(notAssigned ? 'config.error.notAssigned' : 'config.error.profileNotFound')
  }
  // The profile that just became default is still assigned to this
  // installation, so syncing it rewrites every profile assigned there
  // (including the previous default) plus the loader - which is all a
  // default change can affect.
  await syncAndPersist(
    deps,
    list.find((p) => p.id === input.profileId)!,
    list,
  )
  return ok(list)
}

async function write(
  deps: ProfileWritesDeps,
  input: WriteProfileInput,
): Promise<Outcome<WriteTargetResult[]>> {
  const { profiles } = deps
  const profile = profiles.find(input.profileId)
  if (!profile) return fail('config.error.profileNotFound')

  // Story 079 D8: `installationId` is optional and, when present, never trusted as a bare
  // string - same "validate against the installations the launcher actually knows about"
  // rule `assign`/`unassign`/`setDefault` already apply to their own `installationId`.
  if (input.installationId && !deps.installations.find(input.installationId)) {
    return fail('config.error.installationNotFound')
  }

  // Story 022: `write` is one of the three retry triggers (decision 13), so
  // it goes through the same sync engine every mutation does now.
  //
  // Story 043 D4: still a retry trigger, and still not a *save*. A retry re-attempts the
  // installation copies from what the canonical file says; if the profile carries unsaved edits,
  // `syncAndPersist`'s per-profile rule leaves that file alone and the copies are written from
  // its on-disk bytes, so retrying can never publish an edit the user has not saved.
  //
  // Story 079 D8: `installationId`, when given, is "Sync now" (AC7) - the run is restricted to
  // that one installation (`targetInstallationId`, `sync.ts`), so its copy (and loader) is
  // rewritten from the canonical file and every other assigned installation is left untouched.
  const state = await syncAndPersist(deps, profile, profiles.list(), {
    targetInstallationId: input.installationId,
  })
  if (!state) return fail('config.error.writeFailed')

  const results: WriteTargetResult[] = state.installations.map((entry) => ({
    installationId: entry.installationId,
    // `inSync` is the only "this installation is now correctly set up" status a fresh sync
    // attempt can report, so it maps to `written` for this legacy shape's consumers;
    // `outOfSync`/`missing` right after an attempted write means something did not take effect
    // and is reported as an error rather than silently claiming success. Story 079 D4: `pending`
    // can no longer be among `entry.status` - a running installation is written exactly like a
    // stopped one - so this mapping no longer has a branch for it. `syncState` (story 022 D5/D7)
    // is the accurate, live source of truth going forward - this mapping only keeps `write`'s
    // existing contract alive.
    status: entry.status === 'inSync' ? 'written' : 'error',
    ...(entry.messageKey ? { messageKey: entry.messageKey } : {}),
  }))
  return ok(results)
}

/**
 * Story 007: which key (if any) cycles an installation's assigned profiles in-session.
 * Per-installation, not part of a profile (decision 1) - see `SetSwitchBindInput`'s doc comment.
 */
async function setSwitchBind(
  deps: ProfileWritesDeps,
  input: SetSwitchBindInput,
): Promise<Outcome<Record<string, string>>> {
  const { config, log, profiles } = deps
  const installation = deps.installations.find(input.installationId)
  if (!installation) return fail('config.error.installationNotFound')

  const next = { ...config.switchBinds.get() }
  if (input.key === null) delete next[installation.id]
  else next[installation.id] = input.key
  config.switchBinds.update(() => next)

  // Decision 12/13: write immediately for this one installation only,
  // through the unchanged story-004 pipeline (`writeInstallationFiles`);
  // this never touches `assignments`/`isDefault` on any profile - the
  // installation's default is only ever changed by `setDefault` above.
  //
  // Judgment call: this does not consult `isInstallationRunning` either (consistent with
  // story 079 D4's "a running game defers nothing" everywhere else now) - the write below is
  // safe while the game is running (loader files are not open for exclusive access), it just
  // means the running instance keeps whatever chain it already loaded until its next launch -
  // the same story-004 precedent AC3 relies on for the default profile itself.
  const allProfiles = profiles.list()
  const defaultProfile = defaultProfileFor(allProfiles, installation.id)
  if (defaultProfile) {
    const fileNames = resolveProfileFileNames(allProfiles)
    const assignedProfiles = assignedProfilesFor(allProfiles, installation.id).map((p) => ({
      ...p,
      // Every assigned profile comes from `allProfiles`, which
      // `fileNames` was resolved from above, so this lookup cannot miss.
      fileName: fileNames.get(p.id)!,
    }))
    const switchBindKey = next[installation.id]
    try {
      await deps.writeInstallationFiles({
        installation,
        // `defaultProfile` is drawn from `allProfiles` above, so this
        // lookup cannot miss.
        profileFileName: fileNames.get(defaultProfile.id)!,
        profileFileContent: renderProfileFile(defaultProfile),
        loaderFileContent: renderLoaderFile(
          defaultProfile,
          fileNames.get(defaultProfile.id)!,
          switchBindKey
            ? {
                key: switchBindKey,
                profiles: assignedProfiles,
                defaultProfileId: defaultProfile.id,
              }
            : undefined,
        ),
        playedMods: config.playedMods.get()[installation.id] ?? [],
      })
    } catch (error) {
      log.error(`failed to write switch bind for installation ${installation.id}`, error)
      return fail('config.error.writeFailed')
    }
  }
  return ok(next)
}

/**
 * Story 025 D3: one atomic tidy-up batch. The only mutating config operation that is not a
 * whole-field setter, for the reason decision 10 gives - a re-classify writes `unrecognized` plus
 * one of `cvars`/`binds`/`actions` in the same result, and two setter calls would bump `updatedAt`
 * twice and write two half-tidied files to every assigned installation.
 *
 * The shape it enforces:
 *
 * - `applyTidyUpOps` (pure, `@shared/config/tidy-up`) re-checks every op
 *   against the *current* profile and returns stale ones in `rejected`
 *   rather than throwing (decision 11) - so this has no per-op error
 *   path at all, only a payload-shape one.
 * - Exactly one `updatedAt`, one `replaceProfile` commit and one
 *   `syncAndPersist` run for the whole batch, however many ops applied.
 * - Nothing applied means nothing changed: no timestamp bump, no commit, no
 *   sync run, and the profile is returned as it stands (with live
 *   assignments, same as every other handler's view of it) alongside the
 *   rejects, so the caller can re-scan.
 */
async function tidyUpApply(
  deps: ProfileWritesDeps,
  input: TidyUpApplyInput,
): Promise<Outcome<TidyUpApplyResult>> {
  const { profiles } = deps
  const current = profiles.find(input.profileId)
  if (!current) return fail('config.error.profileNotFound')

  const outcome = applyTidyUpOps(current, input.ops)
  if (outcome.applied.length === 0) {
    const list = withLiveAssignments(deps, profiles.list())
    return ok({
      profile: list.find((p) => p.id === current.id) ?? current,
      applied: [],
      rejected: outcome.rejected,
    })
  }

  // Story 079 review (finding 1): `replaceProfile` below mutates profile CONTENT but, unlike
  // every other content setter in this module, does not go through `markUnsaved`/set `dirty` -
  // tidy-up commits its result immediately (one commit, one sync run). `canonicalWriteAllowed`'s
  // general rule (`syncAndPersist` above) therefore never licenses the canonical rewrite on its
  // own (a clean profile with a real `fileHash` fails its "already equals the render" check, since
  // the render is now the TIDIED content) - it needs `overwriteProfileId`, exactly like `save`,
  // and exactly as deliberately gated: checked here, against the profile as it stood before the
  // tidy-up, before that profile is committed.
  const authorised = await authoriseContentWrite(deps, current)

  const list = withLiveAssignments(
    deps,
    profiles.replaceProfile({ ...outcome.profile, updatedAt: new Date().toISOString() }),
  )
  const updated = list.find((p) => p.id === current.id)!
  // `authorised === false` means the canonical file moved underneath us since it was last read
  // (or could not be surveyed) - the tidy-up still commits to `state.json` above (nothing the
  // user just did is silently lost), but the canonical file itself is left alone rather than
  // overwritten with content adopted from a hand-edit nobody has read; `canonicalWriteAllowed`
  // logs that refusal, and the canonical row reports `outOfSync` (Reload/Compare, story D9).
  await syncAndPersist(deps, updated, list, {
    overwriteProfileId: authorised ? updated.id : undefined,
  })
  return ok({ profile: updated, applied: outcome.applied, rejected: outcome.rejected })
}

/**
 * Story 022 D7: read-only report of where every copy of this profile stands.
 *
 * Deliberately NOT built on `syncProfile`, which writes: the story names
 * exactly three retry triggers (a profile mutation, `setup()` at start, and
 * the `write` channel) and this is not one of them. Merely looking at a
 * profile's sync state must never touch disk.
 */
async function syncState(
  deps: ProfileWritesDeps,
  input: SyncProfileStateInput,
): Promise<Outcome<ProfileSyncState>> {
  const { profiles } = deps
  const profile = profiles.find(input.profileId)
  if (!profile) return fail('config.error.profileNotFound')

  const allProfiles = profiles.list()
  const fileNames = resolveProfileFileNames(allProfiles)
  // `profile` came out of `allProfiles`, so this lookup cannot miss.
  const fileName = fileNames.get(profile.id)!
  const failures = deps.config.writeFailures.get()
  const expectedContent = renderProfileFile(profile)

  const ownPath = join(deps.canonicalBaseDir(), fileName)
  const own = await readSyncFileStatus(
    deps,
    ownPath,
    expectedContent,
    failures[`${profile.id}|own`],
  )

  // Story 043 D4 / 079 D2: an installation copy is generated output of the CANONICAL FILE (043
  // AC6), so it is judged against that file's BYTES - exactly what `sync.ts` writes there, for
  // a clean profile and a dirty one alike (`installationCopySource` is the shared rule).
  // Comparing it against the render instead would disagree with the status the sync run itself
  // just reported for the same file, and - for a dirty profile - would report every
  // installation as `outOfSync` with a Retry that could never clear it. The canonical row is
  // the one that shows unsaved edits and external edits, and still does: `own` above is
  // deliberately still compared against the render (story 043's "no sixth state").
  //
  // `null` (the file moved underneath the launcher - bytes nobody has read, which are not
  // published either - or a dirty profile without a file, including a renamed-but-unsaved one
  // whose file still sits under its previous name) makes every readable copy `outOfSync`.
  // Unreadable-but-present (not ENOENT) is "no authoritative content", the same reading
  // `sync.ts` gives it; merely looking at the sync state must not throw over it.
  const canonicalContent = await readExisting(ownPath).catch(() => null)
  const expectedCopyContent = installationCopySource(
    profile,
    {
      content: canonicalContent,
      hash: canonicalContent === null ? null : hashCanonicalFileContent(canonicalContent),
    },
    profile.dirty !== true,
  )

  // Story 079 D4: a running installation is judged exactly like a stopped one - the Care row
  // reads `inSync` right after a save whether or not the game is running, since the write
  // itself is no longer deferred for it either (see `sync.ts`'s write loop).
  const installations: ProfileInstallationSync[] = []
  for (const assignment of profile.assignments) {
    const installation = deps.installations.find(assignment.installationId)
    // An assignment pointing at an installation that no longer exists is
    // reconciled away elsewhere, not reported as a sync problem here.
    if (!installation) continue
    const path = join(installation.rootPath, BASE_GAME_DIR, fileName)
    const result = await readSyncFileStatus(
      deps,
      path,
      expectedCopyContent,
      failures[`${profile.id}|${installation.id}`],
    )
    installations.push({ installationId: installation.id, path, fileName, ...result })
  }

  return ok({ own: { path: ownPath, fileName, ...own }, installations })
}

/**
 * Story 023 D1: read-only report of the profile's own canonical file plus one entry per live
 * assignment, for the Raw File tab. Same never-writes contract as `syncState` above.
 *
 * `readExisting` (`writer.ts`) is the same ENOENT-only-swallowed read the write pipeline itself
 * uses, so a missing file is reported as `onDisk: false` rather than thrown, and `matches` reuses
 * the write pipeline's own byte-for-byte comparison instead of a second one that could drift from it.
 */
async function rawFiles(
  deps: ProfileWritesDeps,
  input: RawFilesInput,
): Promise<Outcome<RawFilesResult>> {
  const { profiles } = deps
  const profile = profiles.find(input.profileId)
  if (!profile) return fail('config.error.profileNotFound')

  const fileNames = resolveProfileFileNames(profiles.list())
  // `profile` came out of the list, so this lookup cannot miss.
  const fileName = fileNames.get(profile.id)!

  const canonicalPath = join(deps.canonicalBaseDir(), fileName)
  const canonicalContent = await readExisting(canonicalPath)
  const canonical: RawProfileFile = {
    path: canonicalPath,
    // A freshly created, unassigned profile has no canonical file yet - that
    // must still be a successful result (story 023 AC 3), not a thrown error.
    content: canonicalContent ?? '',
    onDisk: canonicalContent !== null,
  }

  // Story 043 D4 / 079 D2: the same rule the sync engine writes by and `syncState` judges by - an
  // installation copy is generated output of the canonical file's BYTES (`installationCopySource`),
  // never of the render. `null` (the file moved underneath the launcher, or a dirty profile without
  // one) matches nothing, since nothing may be published from it.
  const expectedContent = installationCopySource(
    profile,
    {
      content: canonicalContent,
      hash: canonicalContent === null ? null : hashCanonicalFileContent(canonicalContent),
    },
    profile.dirty !== true,
  )
  const installationTargets: RawInstallationTarget[] = []
  for (const assignment of profile.assignments) {
    const installation = deps.installations.find(assignment.installationId)
    // An assignment pointing at an installation that no longer exists is
    // reconciled away elsewhere, not reported here - same as `syncState`.
    if (!installation) continue

    const path = join(installation.rootPath, BASE_GAME_DIR, fileName)
    const content = await readExisting(path)
    installationTargets.push({
      installationId: installation.id,
      path,
      onDisk: content !== null,
      matches: content !== null && content === expectedContent,
      playedMods: deps.config.playedMods.get()[installation.id] ?? [],
    })
  }

  return ok({ canonical, installations: installationTargets })
}
