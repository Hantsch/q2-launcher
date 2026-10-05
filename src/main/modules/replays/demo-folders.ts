import { mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { demoSourceKey, type ReplaysFolderRenameResult } from '@shared/modules/replays'
import {
  isPrefix,
  validateFolderName,
  type DiscoveredFolder,
  type FolderRef,
} from '@shared/replays/demo-folders'
import { fail, ok, type Outcome } from '@shared/types/common'
import { canonicalizePath, isDirectory, isInside, pathExists, pathKey } from '../../lib/fs-utils'
import type { PlaybackSessions } from './playback-sessions'
import type { ReplaysScanService } from './scan-service'

/**
 * Creates and renames folders of a demo source, addressed by folder ref (story 242) - the renderer
 * never sends a path. The ref resolves to a folder of the last scan's tree and its root's recorded
 * directory (`scan.resolveFolder`); a write only happens where the folder's real path lies inside
 * the root's real path, so a link inside the tree pointing out of it is never changed.
 *
 * A rename moves the directory in one `rename` - every demo and sidecar below it goes along - and
 * then re-keys the index in place (`scan.applyFolderRelocate`), so nothing is re-parsed.
 */

export interface DemoFoldersFs {
  mkdir: (path: string) => Promise<void>
  rename: (oldPath: string, newPath: string) => Promise<void>
}

export interface CreateDemoFoldersOptions {
  scan: Pick<
    ReplaysScanService,
    'read' | 'readFolders' | 'resolveFolder' | 'addFolder' | 'applyFolderRelocate' | 'isScanning'
  >
  sessions: PlaybackSessions
  fs?: DemoFoldersFs
}

export interface DemoFoldersService {
  create(parent: FolderRef, name: string): Promise<Outcome<{ folder: FolderRef }>>
  rename(folder: FolderRef, name: string): Promise<Outcome<ReplaysFolderRenameResult>>
}

const defaultFs: DemoFoldersFs = {
  mkdir: async (path) => {
    await mkdir(path)
  },
  rename: (oldPath, newPath) => rename(oldPath, newPath),
}

function writeFailure(err: unknown, name: string, folder: string): Outcome<never> {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'EEXIST' || code === 'ENOTEMPTY')
    return fail('replays.folder.error.exists', { name })
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return fail('replays.folder.error.notWritable', { folder })
  }
  return fail('replays.folder.error.failed', { code: typeof code === 'string' ? code : 'unknown' })
}

export function createDemoFolders(options: CreateDemoFoldersOptions): DemoFoldersService {
  const { scan, sessions } = options
  const fs = options.fs ?? defaultFs

  /** The scanned, non-archive folder `ref` names and its directory, contained in its root. */
  async function locate(
    ref: FolderRef,
  ): Promise<Outcome<{ known: DiscoveredFolder; absolutePath: string }>> {
    if (scan.isScanning()) return fail('replays.folder.error.scanning')
    const known = (await scan.readFolders()).find(
      (f) =>
        f.sourceKey === ref.sourceKey &&
        f.path.length === ref.path.length &&
        isPrefix(f.path, ref.path),
    )
    if (known === undefined) return fail('replays.folder.error.unknownFolder')
    if (known.archive) return fail('replays.folder.error.archive')
    const resolved = await scan.resolveFolder(ref)
    if (resolved === undefined || !(await isDirectory(resolved.absolutePath))) {
      return fail('replays.folder.error.unknownFolder')
    }
    if (
      !isInside(
        await canonicalizePath(resolved.rootPath),
        await canonicalizePath(resolved.absolutePath),
      )
    ) {
      return fail('replays.folder.error.outsideSource')
    }
    return ok({ known, absolutePath: resolved.absolutePath })
  }

  async function create(parent: FolderRef, name: string): Promise<Outcome<{ folder: FolderRef }>> {
    const checked = validateFolderName(name)
    if (!checked.ok) return fail(checked.reasonKey, checked.params)
    const located = await locate(parent)
    if (!located.ok) return located
    const { known, absolutePath } = located.value

    try {
      await fs.mkdir(join(absolutePath, checked.name))
    } catch (err) {
      return writeFailure(err, checked.name, absolutePath)
    }
    const folder: FolderRef = { sourceKey: parent.sourceKey, path: [...parent.path, checked.name] }
    await scan.addFolder({
      ...folder,
      ...(known.source !== undefined ? { source: known.source } : {}),
      archive: false,
    })
    return ok({ folder })
  }

  async function renameFolder(
    folder: FolderRef,
    name: string,
  ): Promise<Outcome<ReplaysFolderRenameResult>> {
    if (folder.path.length === 0) return fail('replays.folder.error.root')
    const checked = validateFolderName(name)
    if (!checked.ok) return fail(checked.reasonKey, checked.params)
    const located = await locate(folder)
    if (!located.ok) return located
    const oldDir = located.value.absolutePath
    if (checked.name === folder.path[folder.path.length - 1]) return ok({ ids: [] })

    const playing = (await scan.read()).some(
      (row) =>
        demoSourceKey(row.source) === folder.sourceKey &&
        isPrefix(folder.path, row.folder) &&
        sessions.isPlaying(row.id),
    )
    if (playing) return fail('replays.folder.error.playing')

    const parentDir = dirname(oldDir)
    const newDir = join(parentDir, checked.name)
    // A case-only rename on a case-insensitive filesystem names the very same directory.
    if (pathKey(newDir) !== pathKey(oldDir) && (await pathExists(newDir))) {
      return fail('replays.folder.error.exists', { name: checked.name })
    }
    try {
      await fs.rename(oldDir, newDir)
    } catch (err) {
      return writeFailure(err, checked.name, parentDir)
    }
    return ok({ ids: await scan.applyFolderRelocate(oldDir, newDir) })
  }

  return { create, rename: renameFolder }
}
