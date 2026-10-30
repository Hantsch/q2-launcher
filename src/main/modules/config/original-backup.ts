import { readFile, rm, unlink } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { isLauncherOwnedFile } from '@shared/config/render/file-ownership'
import { pathKey, writeFileAtomic } from '../../lib/fs-utils'
import { BACKUP_SUFFIX } from './backup'
import { isSafeGameDirName, readExisting } from './writer'

/**
 * The configs an installation had before the launcher first wrote over them, kept under
 * `<rootPath>/q2launcher-original-configs/` so they can be put back (story 254).
 *
 * - **First original wins.** A path already in the manifest is never copied again: by then the
 *   file on disk is our own output (or a later edit of it), not what the user started with.
 * - **The manifest is untrusted input.** It sits in the user's game folder and steers copies and
 *   deletes on restore, so every entry must be `<game dir>/<bare .cfg name>` directly under the
 *   root; one bad entry makes the whole manifest `invalid` and nothing is touched.
 * - The folder only ever holds `.cfg` copies and the manifest - no pak or dll - so the
 *   installation scan never mistakes it for a game directory.
 */
export const ORIGINAL_CONFIGS_DIR_NAME = 'q2launcher-original-configs'

const MANIFEST_FILE_NAME = 'manifest.json'

/**
 * The bytes of a cfg are carried as latin1 strings: latin1 maps every byte to exactly one char
 * and back, so a copy made through `readExisting`/`writeFileAtomic` is byte-identical.
 */
const BYTE_ENCODING: BufferEncoding = 'latin1'

const manifestSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.object({ path: z.string(), kind: z.enum(['copied', 'created']) })),
})

/** `copied`: the original's bytes are in the folder. `created`: there was no user original. */
export type OriginalKind = 'copied' | 'created'

export interface OriginalEntry {
  /** Game directory under the root, e.g. `baseq2`. */
  dir: string
  /** Bare `.cfg` file name inside `dir`. */
  name: string
  kind: OriginalKind
}

export type ManifestReadResult =
  { status: 'missing' } | { status: 'invalid' } | { status: 'ok'; entries: OriginalEntry[] }

export type RestoreOriginalsResult =
  | { status: 'restored' }
  | { status: 'missing' }
  | { status: 'invalid' }
  /** Root-relative paths (`baseq2/autoexec.cfg`) that could not be restored; the folder is kept. */
  | { status: 'failed'; failedPaths: string[] }

function backupDir(rootPath: string): string {
  return join(rootPath, ORIGINAL_CONFIGS_DIR_NAME)
}

function manifestPath(rootPath: string): string {
  return join(backupDir(rootPath), MANIFEST_FILE_NAME)
}

function targetPath(rootPath: string, entry: Pick<OriginalEntry, 'dir' | 'name'>): string {
  return join(rootPath, entry.dir, entry.name)
}

function copyPath(rootPath: string, entry: Pick<OriginalEntry, 'dir' | 'name'>): string {
  return join(backupDir(rootPath), entry.dir, entry.name)
}

function manifestEntryPath(entry: Pick<OriginalEntry, 'dir' | 'name'>): string {
  return `${entry.dir}/${entry.name}`
}

function isBareCfgName(name: string): boolean {
  return (
    name.length > '.cfg'.length && !/[/\\:\0]/.test(name) && name.toLowerCase().endsWith('.cfg')
  )
}

/**
 * The `dir`/`name` pair for a root-relative `<dir>/<name>` path, or null when it is anything
 * else. The final pathKey comparison is redundant given the two token checks, and kept on
 * purpose: whatever slips past them must still land directly under the root.
 */
function parseEntryPath(
  rootPath: string,
  path: string,
): Pick<OriginalEntry, 'dir' | 'name'> | null {
  const parts = path.split('/')
  if (parts.length !== 2) return null
  const [dir, name] = parts as [string, string]
  if (!isSafeGameDirName(dir) || dir.toLowerCase() === ORIGINAL_CONFIGS_DIR_NAME) return null
  if (!isBareCfgName(name)) return null
  if (pathKey(dirname(dirname(join(rootPath, dir, name)))) !== pathKey(rootPath)) return null
  return { dir, name }
}

/**
 * The installation's backup manifest, validated. A manifest that does not parse, has the wrong
 * shape, lists a path twice or carries any path that is not `<game dir>/<bare .cfg name>` is
 * `invalid` as a whole. Read errors other than "not there" propagate.
 */
export async function readManifest(rootPath: string): Promise<ManifestReadResult> {
  let text: string
  try {
    text = await readFile(manifestPath(rootPath), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    throw error
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    // a manifest that is not valid JSON is reported as invalid
    return { status: 'invalid' }
  }
  const parsed = manifestSchema.safeParse(json)
  if (!parsed.success) return { status: 'invalid' }

  const entries: OriginalEntry[] = []
  const seen = new Set<string>()
  for (const raw of parsed.data.entries) {
    const location = parseEntryPath(rootPath, raw.path)
    if (location === null) return { status: 'invalid' }
    const key = pathKey(targetPath(rootPath, location))
    if (seen.has(key)) return { status: 'invalid' }
    seen.add(key)
    entries.push({ ...location, kind: raw.kind })
  }
  return { status: 'ok', entries }
}

/** True when the installation has a valid original-config backup to restore. */
export async function hasOriginalBackup(rootPath: string): Promise<boolean> {
  return (await readManifest(rootPath)).status === 'ok'
}

/**
 * The original of one target, copied into the folder: the file itself when it is the user's,
 * the legacy `<file>.q2l-backup` sibling an older launcher kept when the file is already our own
 * output. Our own output is never an original - with no sibling there was nothing of the user's.
 */
async function preserveOriginal(
  rootPath: string,
  location: Pick<OriginalEntry, 'dir' | 'name'>,
): Promise<OriginalKind> {
  const path = targetPath(rootPath, location)
  const current = await readExisting(path)
  if (current === null) return 'created'

  let original = current
  if (isLauncherOwnedFile(current)) {
    const legacy = await readExisting(`${path}${BACKUP_SUFFIX}`)
    if (legacy === null) return 'created'
    original = legacy
  }
  await writeFileAtomic(copyPath(rootPath, location), original, BYTE_ENCODING)
  return 'copied'
}

const tails = new Map<string, Promise<void>>()

/**
 * Runs `task` after every earlier task on the same root has settled. The manifest is a
 * read-modify-write, so two overlapping backups would each start from the same manifest and the
 * later write would drop the other's entries. A failed task does not block the ones behind it.
 */
function serializedPerRoot<T>(rootPath: string, task: () => Promise<T>): Promise<T> {
  const key = pathKey(rootPath)
  const run = (tails.get(key) ?? Promise.resolve()).then(task)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  tails.set(key, tail)
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })
  return run
}

/**
 * Records the original of every target not yet in the manifest, before the caller writes any of
 * them. The copies land first and the manifest last, so a failure halfway leaves no entry
 * pointing at a missing copy; the caller must not write when this throws.
 *
 * Throws on an invalid manifest rather than starting over: a fresh manifest would re-copy files
 * that are by now our output or a later edit, replacing the originals it already holds.
 */
export function backupOriginals(
  rootPath: string,
  absTargetPaths: readonly string[],
): Promise<void> {
  return serializedPerRoot(rootPath, () => backupUnserialized(rootPath, absTargetPaths))
}

async function backupUnserialized(
  rootPath: string,
  absTargetPaths: readonly string[],
): Promise<void> {
  const manifest = await readManifest(rootPath)
  if (manifest.status === 'invalid') {
    throw new Error(`refusing to back up configs: ${ORIGINAL_CONFIGS_DIR_NAME} manifest is invalid`)
  }
  const entries = manifest.status === 'ok' ? [...manifest.entries] : []
  const known = new Set(entries.map((entry) => pathKey(targetPath(rootPath, entry))))
  let added = false

  for (const absPath of absTargetPaths) {
    const location = parseEntryPath(rootPath, relative(rootPath, absPath).split(sep).join('/'))
    if (location === null) {
      throw new Error(`refusing to back up a target outside <game dir>/<name>.cfg: ${absPath}`)
    }
    const key = pathKey(targetPath(rootPath, location))
    if (known.has(key)) continue
    known.add(key)
    entries.push({ ...location, kind: await preserveOriginal(rootPath, location) })
    added = true
  }

  if (!added) return
  const json = {
    version: 1,
    entries: entries.map((entry) => ({ path: manifestEntryPath(entry), kind: entry.kind })),
  }
  await writeFileAtomic(manifestPath(rootPath), `${JSON.stringify(json, null, 2)}\n`, 'utf8')
}

async function restoreEntry(rootPath: string, entry: OriginalEntry): Promise<void> {
  const path = targetPath(rootPath, entry)
  if (entry.kind === 'copied') {
    const original = await readFile(copyPath(rootPath, entry), BYTE_ENCODING)
    await writeFileAtomic(path, original, BYTE_ENCODING)
    return
  }
  // A created path the user has since replaced with a file of their own is theirs now.
  const current = await readExisting(path)
  if (current !== null && isLauncherOwnedFile(current)) await unlink(path)
}

/**
 * Puts every original back and removes what the launcher created. The folder is removed only
 * when every entry succeeded, so a partial restore can be retried; an invalid manifest touches
 * nothing at all.
 */
export function restoreOriginals(rootPath: string): Promise<RestoreOriginalsResult> {
  return serializedPerRoot(rootPath, () => restoreUnserialized(rootPath))
}

async function restoreUnserialized(rootPath: string): Promise<RestoreOriginalsResult> {
  let manifest: ManifestReadResult
  try {
    manifest = await readManifest(rootPath)
  } catch {
    // an unreadable manifest (I/O error) is reported as a failed restore
    return { status: 'failed', failedPaths: [] }
  }
  if (manifest.status !== 'ok') return manifest

  const failedPaths: string[] = []
  for (const entry of manifest.entries) {
    try {
      await restoreEntry(rootPath, entry)
    } catch {
      // a single entry that cannot be restored is collected into failedPaths
      failedPaths.push(manifestEntryPath(entry))
    }
  }
  if (failedPaths.length > 0) return { status: 'failed', failedPaths }

  try {
    await rm(backupDir(rootPath), { recursive: true, force: true })
  } catch {
    // the backup directory cannot be removed (locked or permission denied), reported as failed
    return { status: 'failed', failedPaths: [] }
  }
  return { status: 'restored' }
}
