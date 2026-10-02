import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ModInstallFile, ModInstallRecord } from '@shared/modules/mods'
import { isSafeGameDirName } from '@shared/mods/gamedir'
import { pathKey } from '../../lib/fs-utils'
import { isSafeRecordedPath } from './install-records'

/**
 * Story 191 D1: removing a mod the launcher installed - filesystem only, no IPC, no job.
 *
 * Only the files story 190's install record lists are ever deleted. This deletes on a user's disk,
 * so every step is the conservative one:
 * - the whole record is checked before anything is touched: an unsafe game dir name, an unsafe
 *   recorded path, a game dir that is a link, or a recorded file whose *real* parent lies outside
 *   the *real* game dir refuses the removal outright ({@link RemovalRefusedError}), deleting nothing;
 * - the change check is re-run right before deleting (the plan the user saw is advisory);
 * - only a regular file is unlinked (`lstat`, never followed; a directory or link is kept);
 * - folders are pruned with non-recursive `rmdir`, deepest first, so a folder that still holds
 *   anything - the user's own files - stays. There is no `rm -r` here.
 */

export class RemovalRefusedError extends Error {
  /** `reason` is an i18n key; `detail` is for the log only. */
  constructor(
    readonly reason: 'mods.remove.refused.unsafePath',
    readonly detail: string,
  ) {
    super(reason)
    this.name = 'RemovalRefusedError'
  }
}

/** Anything carrying the record's file list - a full {@link ModInstallRecord} fits. */
export type RecordedFiles = Pick<ModInstallRecord, 'files'>

export interface RemovalPlan {
  /** Recorded paths whose bytes are no longer what the launcher installed. */
  changed: string[]
  /** Recorded paths that are already gone. */
  missing: string[]
}

export interface RemovalOptions {
  /** What to do with a recorded file the user has changed since it was installed. */
  changedFiles: 'delete' | 'keep'
}

export interface RemovalResult {
  deleted: string[]
  /** Changed files kept on `keep`, plus any recorded path that is no longer a regular file. */
  kept: string[]
  failed: { path: string; code: string }[]
  /** True when the game directory no longer exists afterwards (also when it never did). */
  folderRemoved: boolean
}

interface ResolvedEntry {
  file: ModInstallFile
  /** The file under its verified real parent; `null` when its parent folder no longer exists. */
  target: string | null
}

interface ResolvedRemoval {
  gameDirPath: string
  /** `null` when the game directory does not exist. */
  realGameDir: string | null
  entries: ResolvedEntry[]
}

type EntryState =
  | { kind: 'missing' }
  | { kind: 'notAFile' }
  | { kind: 'error'; code: string }
  | { kind: 'file'; changed: boolean }

function codeOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' ? code : 'UNKNOWN'
}

/** The path, or one of its parents, is not there. */
function isGone(error: unknown): boolean {
  const code = codeOf(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Same rule as `isInsideDir` in `downloads/bootstrap/target.ts`: `child` is `parent` or below it. */
function isInsideDir(child: string, parent: string): boolean {
  const childKey = pathKey(child)
  const parentKey = pathKey(parent)
  return (
    childKey === parentKey ||
    childKey.startsWith(parentKey.endsWith(sep) ? parentKey : parentKey + sep)
  )
}

function refuse(detail: string): never {
  throw new RemovalRefusedError('mods.remove.refused.unsafePath', detail)
}

/** `realpath` of `dir`, or of its nearest existing ancestor when `dir` itself is gone. */
async function realAncestor(dir: string): Promise<{ real: string; exists: boolean }> {
  let current = dir
  let exists = true
  for (;;) {
    try {
      return { real: await realpath(current), exists }
    } catch (error) {
      if (!isGone(error)) throw error
      const up = dirname(current)
      if (up === current) refuse(`no existing ancestor of ${dir}`)
      current = up
      exists = false
    }
  }
}

/** The containment check. Throws {@link RemovalRefusedError} before anything is touched. */
async function resolveRemoval(
  root: string,
  gameDir: string,
  record: RecordedFiles,
): Promise<ResolvedRemoval> {
  if (!isSafeGameDirName(gameDir)) refuse(`game dir ${JSON.stringify(gameDir)}`)
  for (const file of record.files) {
    if (!isSafeRecordedPath(file.path)) refuse(`recorded path ${JSON.stringify(file.path)}`)
  }
  const gameDirPath = join(root, gameDir)
  try {
    const stats = await lstat(gameDirPath)
    // A linked game dir would make "inside the game dir" mean somewhere else entirely.
    if (stats.isSymbolicLink() || !stats.isDirectory())
      refuse(`${gameDirPath} is not a plain directory`)
  } catch (error) {
    if (error instanceof RemovalRefusedError || !isGone(error)) throw error
    return {
      gameDirPath,
      realGameDir: null,
      entries: record.files.map((file) => ({ file, target: null })),
    }
  }
  const realGameDir = await realpath(gameDirPath)
  const entries: ResolvedEntry[] = []
  for (const file of record.files) {
    const lexical = join(realGameDir, ...file.path.split('/'))
    const parent = await realAncestor(dirname(lexical))
    if (!isInsideDir(parent.real, realGameDir)) refuse(`${file.path} resolves to ${parent.real}`)
    entries.push({ file, target: parent.exists ? join(parent.real, basename(lexical)) : null })
  }
  return { gameDirPath, realGameDir, entries }
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), async function* (source) {
    for await (const chunk of source as AsyncIterable<Buffer>) hash.update(chunk)
  })
  return hash.digest('hex')
}

/** Is this still the file the launcher wrote? Size first; the hash only when sizes match. */
async function stateOf(entry: ResolvedEntry): Promise<EntryState> {
  if (entry.target === null) return { kind: 'missing' }
  let stats
  try {
    stats = await lstat(entry.target)
  } catch (error) {
    return isGone(error) ? { kind: 'missing' } : { kind: 'error', code: codeOf(error) }
  }
  if (!stats.isFile()) return { kind: 'notAFile' }
  if (stats.size !== entry.file.sizeBytes) return { kind: 'file', changed: true }
  try {
    const actual = await sha256Of(entry.target)
    return { kind: 'file', changed: actual !== entry.file.sha256.toLowerCase() }
  } catch (error) {
    if (isGone(error)) return { kind: 'missing' }
    // Unreadable means unverifiable: treat it as changed, so `keep` keeps it.
    return { kind: 'file', changed: true }
  }
}

/** Which recorded files the user changed and which are already gone. Refuses like the removal does. */
export async function planRemoval(
  root: string,
  gameDir: string,
  record: RecordedFiles,
): Promise<RemovalPlan> {
  const resolved = await resolveRemoval(root, gameDir, record)
  const plan: RemovalPlan = { changed: [], missing: [] }
  for (const entry of resolved.entries) {
    const state = await stateOf(entry)
    if (state.kind === 'missing') plan.missing.push(entry.file.path)
    else if (state.kind !== 'file' || state.changed) plan.changed.push(entry.file.path)
  }
  return plan
}

/** Non-recursive and best-effort: a folder that is not empty, gone, a link or locked simply stays. */
async function rmdirIfEmpty(dir: string): Promise<void> {
  try {
    const stats = await lstat(dir)
    if (stats.isSymbolicLink() || !stats.isDirectory()) return
    await rmdir(dir)
  } catch {
    // ENOTEMPTY/EEXIST/ENOENT are the expected ones; anything else leaves the folder too.
  }
}

/** Every parent folder of a recorded file, deepest first, then the game dir itself. */
async function prune(realGameDir: string, record: RecordedFiles): Promise<void> {
  const dirs = new Map<string, string>()
  for (const file of record.files) {
    const segments = file.path.split('/').slice(0, -1)
    for (let depth = segments.length; depth > 0; depth--) {
      const dir = join(realGameDir, ...segments.slice(0, depth))
      dirs.set(pathKey(dir), dir)
    }
  }
  const deepestFirst = [...dirs.values()].sort((a, b) => b.split(sep).length - a.split(sep).length)
  for (const dir of deepestFirst) await rmdirIfEmpty(dir)
  await rmdirIfEmpty(realGameDir)
}

async function stillExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    return !isGone(error)
  }
}

/**
 * Deletes the recorded files of `gameDir` under `root`, then prunes the folders they leave empty.
 * A recorded file that is already gone is neither deleted nor failed; a failed delete is collected
 * and the rest still go.
 */
export async function removeRecordedFiles(
  root: string,
  gameDir: string,
  record: RecordedFiles,
  options: RemovalOptions,
): Promise<RemovalResult> {
  const resolved = await resolveRemoval(root, gameDir, record)
  const result: RemovalResult = { deleted: [], kept: [], failed: [], folderRemoved: false }
  for (const entry of resolved.entries) {
    const { path } = entry.file
    const state = await stateOf(entry)
    if (state.kind === 'missing') continue
    if (state.kind === 'error') {
      result.failed.push({ path, code: state.code })
      continue
    }
    if (state.kind === 'notAFile' || (state.changed && options.changedFiles === 'keep')) {
      result.kept.push(path)
      continue
    }
    try {
      // `unlink` removes a link itself, never its target; `target` sits under a verified real parent.
      await unlink(entry.target as string)
      result.deleted.push(path)
    } catch (error) {
      if (!isGone(error)) result.failed.push({ path, code: codeOf(error) })
    }
  }
  if (resolved.realGameDir !== null) await prune(resolved.realGameDir, record)
  result.folderRemoved = !(await stillExists(resolved.gameDirPath))
  return result
}
