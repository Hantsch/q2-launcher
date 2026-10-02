import type { ModInstallFile, ModInstallRecord } from '@shared/modules/mods'

/**
 * What an update does to a game directory - pure planning over game-dir-relative paths, no I/O.
 * The caller hashes the recorded files on disk (see `stateOf` in `remove.ts`) and passes the result in.
 *
 * `changed` = recorded (old) files whose disk hash differs from the record's hash. A recorded file that
 * is missing on disk is NOT changed: there is no user edit to protect, so the update simply writes it
 * again (or has nothing to delete). A file in neither record is the user's own and is never listed.
 */
export type ModUpdatePolicy = 'overwrite' | 'keep'

export interface ModUpdatePlan {
  /** Files to write: every new file, except changed files kept under `keep`. */
  write: string[]
  /** Old-record files absent from the new record, except changed files kept under `keep`. */
  deleteObsolete: string[]
  /** Recorded files the user changed since install. */
  changed: string[]
  /** Changed files left alone because the policy is `keep`. */
  keptUntouched: string[]
}

/** `diskHashes`: sha256 per path; a path absent from the map is missing on disk. */
export function planModUpdate(
  oldRecord: Pick<ModInstallRecord, 'files'>,
  newFiles: readonly Pick<ModInstallFile, 'path'>[],
  diskHashes: ReadonlyMap<string, string>,
  policy: ModUpdatePolicy,
): ModUpdatePlan {
  const changed = oldRecord.files
    .filter((file) => {
      const actual = diskHashes.get(file.path)
      return actual !== undefined && actual.toLowerCase() !== file.sha256.toLowerCase()
    })
    .map((file) => file.path)
  const kept = policy === 'keep' ? new Set(changed) : new Set<string>()
  const newPaths = new Set(newFiles.map((file) => file.path))

  return {
    write: [...newPaths].filter((path) => !kept.has(path)),
    deleteObsolete: oldRecord.files
      .map((file) => file.path)
      .filter((path) => !newPaths.has(path) && !kept.has(path)),
    changed,
    keptUntouched: changed.filter((path) => kept.has(path)),
  }
}
