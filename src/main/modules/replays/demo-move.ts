import { stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { demoSourceKey, type DiscoveredDemo } from '@shared/modules/replays'
import { samePath, type FolderRef } from '@shared/replays/demo-folders'
import { sidecarFileName } from '@shared/replays/sidecar'
import { fail, ok, type Outcome } from '@shared/types/common'
import { canonicalizePath, isDirectory, isInside, moveFile, pathKey } from '../../lib/fs-utils'
import { demoIdForPath } from './discovery'
import { relocateDemo, type RelocateFs } from './demo-relocate'
import { errnoCode } from './fs-steps'
import type { PlaybackSessions } from './playback-sessions'
import type { ReplaysScanService } from './scan-service'

/**
 * Moves one loose demo - and its sidecar, if it has one - into another folder of a demo
 * source (story 242), addressed by id and a folder ref. The renderer never sends a path: the id resolves to the
 * real file (`scan.resolveFile`) and the ref to a folder of the last scan's tree.
 *
 * Symlinks are followed for reading, but a write only happens where the target folder's real path
 * lies inside the source root's real path - a link inside the tree pointing out of it is not a
 * place demos get moved to. The target may be on another device; `moveFile` copies then.
 */

export interface CreateDemoMoveOptions {
  scan: Pick<
    ReplaysScanService,
    'resolveFile' | 'resolveFolder' | 'read' | 'readFolders' | 'applyRelocate' | 'isScanning'
  >
  sessions: PlaybackSessions
  fs?: RelocateFs
}

export interface DemoMoveService {
  move(id: string, target: FolderRef): Promise<Outcome<{ demo: DiscoveredDemo }>>
}

const defaultFs: RelocateFs = {
  stat: (path) => stat(path),
  rename: (from, to) => moveFile(from, to),
}

export function createDemoMove(options: CreateDemoMoveOptions): DemoMoveService {
  const { scan, sessions } = options
  const fs = options.fs ?? defaultFs

  async function moveDemo(
    id: string,
    target: FolderRef,
  ): Promise<Outcome<{ demo: DiscoveredDemo }>> {
    const resolved = scan.resolveFile(id)
    if (resolved === undefined) return fail('replays.move.error.unknownDemo')
    if (resolved.archiveEntry !== null) return fail('replays.move.error.archiveEntry')
    if (sessions.isPlaying(id)) return fail('replays.move.error.playing')
    if (scan.isScanning()) return fail('replays.move.error.scanning')

    const oldPath = resolved.absolutePath
    const row = (await scan.read()).find((r) => r.id === id)
    if (row === undefined) return fail('replays.move.error.unknownDemo')

    const known = (await scan.readFolders()).find(
      (f) => f.sourceKey === target.sourceKey && samePath(f.path, target.path),
    )
    if (known === undefined) return fail('replays.move.error.unknownFolder')
    if (known.archive) return fail('replays.move.error.archiveFolder')

    const folder = await scan.resolveFolder(target, id)
    if (folder === undefined) return fail('replays.move.error.unknownFolder')
    if (!(await isDirectory(folder.absolutePath))) return fail('replays.move.error.unknownFolder')
    if (
      !isInside(
        await canonicalizePath(folder.rootPath),
        await canonicalizePath(folder.absolutePath),
      )
    ) {
      return fail('replays.move.error.outsideSource')
    }

    const fileName = basename(oldPath)
    const newPath = join(folder.absolutePath, fileName)
    if (pathKey(newPath) === pathKey(oldPath)) return ok({ demo: row })

    try {
      await fs.stat(oldPath)
    } catch {
      return fail('replays.move.error.demoMissing')
    }

    const moved = await relocateDemo(fs, oldPath, newPath)
    if (!moved.ok) {
      switch (moved.kind) {
        case 'exists':
          return fail('replays.move.error.exists', { name: fileName })
        case 'sidecarExists':
          return fail('replays.move.error.sidecarExists', { name: sidecarFileName(fileName) })
        case 'stuck':
          return fail('replays.move.error.rollbackFailed', {
            demo: newPath,
            sidecar: `${oldPath}.json`,
          })
        case 'failed': {
          const code = errnoCode(moved.error)
          if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
            return fail('replays.move.error.notWritable', { folder: folder.absolutePath })
          }
          return fail('replays.move.error.moveFailed', { code: code ?? 'unknown' })
        }
      }
    }

    const sourceChanged = demoSourceKey(row.source) !== target.sourceKey
    const demo = await scan.applyRelocate(
      id,
      newPath,
      target.path,
      sourceChanged ? folder.source : undefined,
    )
    if (demo !== undefined) return ok({ demo })
    // A scan swapped the snapshot after the `isScanning` guard: the files ARE moved, so answer with
    // a best-effort row; the next scan corrects it.
    return ok({
      demo: {
        ...row,
        id: demoIdForPath(newPath),
        folder: target.path,
        ...(sourceChanged ? { source: folder.source } : {}),
      },
    })
  }

  return { move: moveDemo }
}
