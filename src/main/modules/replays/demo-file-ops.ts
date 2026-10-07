import { basename, dirname, join } from 'node:path'
import type { BulkItemOutcome, BulkOutcome } from '@shared/replays/bulk'
import { sidecarFileName } from '@shared/replays/sidecar'
import { fail, ok, type Outcome } from '@shared/types/common'
import { pathKey } from '../../lib/fs-utils'
import { relocateDemo, type RelocateFs } from './demo-relocate'
import {
  errnoCode,
  exists,
  moveNoOverwrite,
  nodeNoOverwriteFs,
  type NoOverwriteFs,
} from './fs-steps'
import type { PlaybackSessions } from './playback-sessions'
import type { ReplaysScanService } from './scan-service'

/**
 * Deletes or moves several demos - each with its `${path}.json` sidecar - addressed by id; an id is
 * resolved to its file here (`scan.resolveFile`), never taken as a path. Every demo is acted on, or
 * refused, on its own: one busy or clashing file never stops the rest, and the answer names each
 * demo's result. The index learns every change in one `applyMoves` afterwards (story 244)
 *
 * Delete only ever goes to the OS trash - a refused trash is reported, never retried as a permanent
 * removal. Move never replaces a file in the target (`moveNoOverwrite`), and puts the demo back
 * when its sidecar cannot follow.
 */

export interface CreateDemoFileOpsOptions {
  scan: Pick<ReplaysScanService, 'resolveFile' | 'applyMoves' | 'isScanning'>
  sessions: Pick<PlaybackSessions, 'isPlaying'>
  os: { trashItem: (path: string) => Promise<void> }
  fs?: NoOverwriteFs
}

export interface DemoFileOpsService {
  delete(ids: string[]): Promise<Outcome<BulkOutcome>>
  /** `targetDir` is an absolute directory main resolved itself - never a renderer-supplied path. */
  move(ids: string[], targetDir: string): Promise<Outcome<BulkOutcome>>
}

const reason = (key: string): string => `replays.bulk.reason.${key}`

function item(
  demoId: string,
  status: BulkItemOutcome['status'],
  key: string | null,
  params?: Record<string, string | number>,
): BulkItemOutcome {
  const reasonKey = key === null ? null : reason(key)
  return {
    demoId,
    status,
    reasonKey,
    ...(params ? { params } : {}),
  }
}

const IN_USE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

export function createDemoFileOps(options: CreateDemoFileOpsOptions): DemoFileOpsService {
  const { scan, sessions, os } = options
  const fs = options.fs ?? nodeNoOverwriteFs
  const relocateFs: RelocateFs = {
    stat: (path) => fs.stat(path),
    rename: (from, to) => moveNoOverwrite(fs, from, to),
  }

  /** The demo's path, or why it is not acted on. */
  function guard(id: string): { path: string } | BulkItemOutcome {
    const resolved = scan.resolveFile(id)
    if (resolved === undefined) return item(id, 'failed', 'unknownDemo')
    if (resolved.archiveEntry !== null) return item(id, 'skipped', 'archiveEntry')
    if (sessions.isPlaying(id)) return item(id, 'skipped', 'playing')
    return { path: resolved.absolutePath }
  }

  async function run(
    ids: string[],
    act: (
      id: string,
      path: string,
      moves: { id: string; newPath: string | null }[],
    ) => Promise<BulkItemOutcome>,
  ): Promise<Outcome<BulkOutcome>> {
    if (scan.isScanning()) return fail('replays.bulk.error.scanning')
    const items: BulkItemOutcome[] = []
    const moves: { id: string; newPath: string | null }[] = []
    for (const id of new Set(ids)) {
      const target = guard(id)
      items.push('demoId' in target ? target : await act(id, target.path, moves))
    }
    await scan.applyMoves(moves)
    return ok({ items })
  }

  async function trashOne(
    id: string,
    path: string,
    moves: { id: string; newPath: string | null }[],
  ): Promise<BulkItemOutcome> {
    try {
      await os.trashItem(path)
    } catch (error) {
      return item(id, 'failed', IN_USE_CODES.has(errnoCode(error) ?? '') ? 'inUse' : 'trashFailed')
    }
    // The demo is gone from its folder whatever happens to the sidecar, so its row goes too.
    moves.push({ id, newPath: null })
    const sidecar = `${path}.json`
    if (!(await exists(fs, sidecar))) return item(id, 'done', null)
    try {
      await os.trashItem(sidecar)
    } catch {
      return item(id, 'failed', 'sidecarTrashFailed', { name: sidecarFileName(basename(path)) })
    }
    return item(id, 'done', null)
  }

  async function moveOne(
    id: string,
    from: string,
    targetDir: string,
    moves: { id: string; newPath: string | null }[],
  ): Promise<BulkItemOutcome> {
    if (pathKey(dirname(from)) === pathKey(targetDir)) return item(id, 'skipped', 'alreadyThere')
    const fileName = basename(from)
    const to = join(targetDir, fileName)
    const moved = await relocateDemo(relocateFs, from, to)
    if (moved.ok) {
      moves.push({ id, newPath: to })
      return item(id, 'done', null)
    }
    switch (moved.kind) {
      case 'exists':
        return item(id, 'failed', 'exists', { name: fileName })
      case 'sidecarExists':
        return item(id, 'failed', 'sidecarExists', { name: sidecarFileName(fileName) })
      case 'stuck':
        // The demo did move, so the index follows it; only its notes stayed behind.
        moves.push({ id, newPath: to })
        return item(id, 'failed', 'rollbackFailed', { demo: to, sidecar: `${from}.json` })
      case 'failed': {
        const code = errnoCode(moved.error)
        // A clash that appeared after the pre-check: `moveNoOverwrite` refused to replace it.
        if (code === 'EEXIST') return item(id, 'failed', 'exists', { name: fileName })
        if (code === 'EBUSY') return item(id, 'failed', 'inUse')
        if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
          return item(id, 'failed', 'notWritable', { folder: targetDir })
        }
        return item(id, 'failed', 'moveFailed', { code: code ?? 'unknown' })
      }
    }
  }

  return {
    delete: (ids) => run(ids, trashOne),
    move: (ids, targetDir) => run(ids, (id, path, moves) => moveOne(id, path, targetDir, moves)),
  }
}
