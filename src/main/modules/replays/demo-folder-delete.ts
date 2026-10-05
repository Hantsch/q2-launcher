import { demoSourceKey } from '@shared/modules/replays'
import { isPrefix, type FolderRef } from '@shared/replays/demo-folders'
import { fail, ok, type Outcome } from '@shared/types/common'
import { locateDemoFolder } from './demo-folders'
import type { PlaybackSessions } from './playback-sessions'
import type { ReplaysScanService } from './scan-service'

/**
 * Deletes a whole folder of a demo source, addressed by folder ref - the renderer never
 * sends a path. The directory is resolved and contained in its root exactly as folder create/rename
 * do (`locateDemoFolder`). A demo root itself is never deleted.
 *
 * The folder goes to the OS trash in one step and only there: a refused trash is reported, never
 * retried as a permanent removal. The index learns about every row below it afterwards (story 244).
 */

export interface CreateDemoFolderDeleteOptions {
  scan: Pick<
    ReplaysScanService,
    'read' | 'readFolders' | 'resolveFolder' | 'applyMoves' | 'removeFolder' | 'isScanning'
  >
  sessions: Pick<PlaybackSessions, 'isPlaying'>
  os: { trashItem: (path: string) => Promise<void> }
}

export interface DemoFolderDeleteService {
  deleteFolder(folder: FolderRef): Promise<Outcome<{ demoCount: number }>>
}

export function createDemoFolderDelete(
  options: CreateDemoFolderDeleteOptions,
): DemoFolderDeleteService {
  const { scan, sessions, os } = options

  async function deleteFolder(folder: FolderRef): Promise<Outcome<{ demoCount: number }>> {
    if (folder.path.length === 0) return fail('replays.folder.error.isRoot')
    const located = await locateDemoFolder(scan, folder)
    if (!located.ok) return located

    const rows = (await scan.read()).filter(
      (row) => demoSourceKey(row.source) === folder.sourceKey && isPrefix(folder.path, row.folder),
    )
    if (rows.some((row) => sessions.isPlaying(row.id))) return fail('replays.folder.error.playing')

    try {
      await os.trashItem(located.value.absolutePath)
    } catch {
      return fail('replays.folder.error.trashFailed')
    }
    await scan.applyMoves(rows.map((row) => ({ id: row.id, newPath: null })))
    await scan.removeFolder(folder)
    return ok({ demoCount: rows.length })
  }

  return { deleteFolder }
}
