import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  resolveEffectiveValues,
  type ResolveEffectiveValuesInputs,
} from '@shared/demos/effective-values'
import type { DiscoveredDemo } from '@shared/modules/replays'
import { validateDemoRename } from '@shared/replays/demo-rename'
import type { NameFacts } from '@shared/replays/name-template'
import { sidecarFileName, type SidecarFields } from '@shared/replays/sidecar'
import { fail, ok, type Outcome } from '@shared/types/common'
import { pathKey } from '../../lib/fs-utils'
import { demoIdForPath } from './discovery'
import type { PlaybackSessions } from './playback-sessions'
import type { ReplaysNameMatcher, ReplaysScanService } from './scan-service'
import type { SidecarStore } from './sidecar-store'

/**
 * Story 157: renames a demo - and its sidecar, if it has one - to a new stem, addressed by id. The
 * renderer sends an id and a name STEM, never a path: the id is resolved to the real file here
 * (`scan.resolveFile`) and the stem is validated here (`validateDemoRename`), dialog or not.
 *
 * Up to three fallible disk steps, each undone in reverse order when a later one fails:
 *
 * 1. (only when facts would be lost) the sidecar gains the name-derived facts the old file name
 *    supplied and the new one no longer does - written through the sidecar store, after the file's
 *    raw bytes (or its absence) were snapshotted;
 * 2. the demo file is renamed;
 * 3. (only when a sidecar exists at the old path) the sidecar is renamed alongside it.
 *
 * An undo that itself fails is reported as `rollbackFailed` naming where the files are now, so the
 * user can look at the folder themselves - the one outcome where demo and notes may be separated.
 */

export interface DemoRenameFs {
  /** Only needs to reject when the path does not exist; the result is unused. */
  stat: (path: string) => Promise<{ size: number }>
  rename: (oldPath: string, newPath: string) => Promise<void>
  readFile: (path: string) => Promise<Buffer>
  writeFile: (path: string, data: Buffer | string) => Promise<void>
  rm: (path: string, opts?: { force?: boolean }) => Promise<void>
}

export interface CreateDemoRenameOptions {
  scan: Pick<ReplaysScanService, 'resolveFile' | 'read' | 'applyRename' | 'isScanning'>
  sidecars: SidecarStore
  sessions: PlaybackSessions
  nameMatcher: () => ReplaysNameMatcher
  fs?: DemoRenameFs
}

export interface DemoRenameService {
  rename(id: string, name: string): Promise<Outcome<{ demo: DiscoveredDemo }>>
}

const defaultFs: DemoRenameFs = {
  stat: (path) => stat(path),
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  readFile: (path) => readFile(path),
  writeFile: (path, data) => writeFile(path, data),
  rm: (path, opts) => rm(path, opts),
}

/** Same header shape `demo-rows.ts`'s `headerFromRow` builds for `index.read` - kept in step with
 * it so "what the row shows" and "what a rename would lose" are resolved identically. */
function headerFromRow(row: DiscoveredDemo): ResolveEffectiveValuesInputs['header'] {
  if (!row.readable || row.gameDir === null) return null
  return {
    ok: true,
    gameDir: row.gameDir,
    map: row.map,
    pov: row.pov,
    players: row.players,
  } as ResolveEffectiveValuesInputs['header']
}

async function exists(fs: DemoRenameFs, path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

function errnoCode(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : undefined
}

export function createDemoRename(options: CreateDemoRenameOptions): DemoRenameService {
  const { scan, sidecars, sessions, nameMatcher } = options
  const fs = options.fs ?? defaultFs

  async function renameDemo(id: string, name: string): Promise<Outcome<{ demo: DiscoveredDemo }>> {
    const resolved = scan.resolveFile(id)
    if (resolved === undefined) return fail('replays.rename.error.unknownDemo')
    if (resolved.archiveEntry !== null) return fail('replays.rename.error.archiveEntry')
    if (sessions.isPlaying(id)) return fail('replays.rename.error.playing')
    if (scan.isScanning()) return fail('replays.rename.error.scanning')

    const oldPath = resolved.absolutePath
    if (!(await exists(fs, oldPath))) return fail('replays.rename.error.demoMissing')

    const row = (await scan.read()).find((r) => r.id === id)
    if (row === undefined) return fail('replays.rename.error.unknownDemo')

    const validated = validateDemoRename(name, row.fileName)
    if (!validated.ok) return fail(`replays.rename.error.${validated.reason}`, validated.params)
    const newFileName = validated.fileName
    if (newFileName === row.fileName) return ok({ demo: row })

    const dir = dirname(oldPath)
    const newPath = join(dir, newFileName)
    // Built from the resolved path exactly the way the sidecar store builds it, so step 1's write
    // and step 3's rename can never address two different files.
    const oldSidecarPath = `${oldPath}.json`
    const newSidecarPath = `${newPath}.json`

    // A case-only rename on a case-insensitive filesystem names the very same file and sidecar -
    // not a collision.
    if (pathKey(newPath) !== pathKey(oldPath)) {
      if (await exists(fs, newPath))
        return fail('replays.rename.error.exists', { name: newFileName })
      if (await exists(fs, newSidecarPath)) {
        return fail('replays.rename.error.sidecarExists', { name: sidecarFileName(newFileName) })
      }
    }

    // Facts the old name supplied that the new one no longer would: carried into the sidecar so a
    // rename never silently changes what the row shows.
    const sidecarRead = await sidecars.read(id)
    const { state, values } = sidecarRead.ok
      ? sidecarRead.value
      : { state: { state: 'none' as const }, values: {} }
    const header = headerFromRow(row)
    const oldEffective = resolveEffectiveValues({
      fileName: row.fileName,
      sidecar: values,
      header,
      nameFacts: row.nameFacts,
      fileTime: row.fileTime,
    })
    const newNameFacts = (nameMatcher().match(newFileName) ?? null) as NameFacts | null
    const newEffective = resolveEffectiveValues({
      fileName: newFileName,
      sidecar: values,
      header,
      nameFacts: newNameFacts,
      fileTime: row.fileTime,
    })

    const preserved: Partial<SidecarFields> = {}
    if (
      oldEffective.date.source === 'name' &&
      oldEffective.date.value !== newEffective.date.value
    ) {
      preserved.date = new Date(oldEffective.date.value).toISOString()
    }
    if (
      oldEffective.sides.source === 'name' &&
      JSON.stringify(oldEffective.sides.value) !== JSON.stringify(newEffective.sides.value)
    ) {
      preserved.sides = oldEffective.sides.value
    }
    if (oldEffective.map.source === 'name' && oldEffective.map.value !== newEffective.map.value) {
      preserved.map = oldEffective.map.value
    }
    if (
      oldEffective.gamemode.source === 'name' &&
      oldEffective.gamemode.value !== newEffective.gamemode.value
    ) {
      preserved.gamemode = oldEffective.gamemode.value
    }
    const mustPreserve = Object.keys(preserved).length > 0
    // A broken sidecar is never written to - not even to merge facts in - and the rename must not
    // silently drop those facts instead.
    if (mustPreserve && state.state === 'error') return fail('replays.rename.error.sidecarBroken')

    // Rollback bookkeeping: exactly what has been done so far, undone in reverse on failure.
    let sidecarWritten = false
    let originalSidecarBytes: Buffer | null = null

    /** Undoes step 1: the original sidecar bytes back, or the file step 1 created removed. */
    const undoSidecarWrite = async (): Promise<void> => {
      if (!sidecarWritten) return
      if (originalSidecarBytes !== null) await fs.writeFile(oldSidecarPath, originalSidecarBytes)
      else await fs.rm(oldSidecarPath, { force: true })
    }

    const classify = (err: unknown): Outcome<never> => {
      const code = errnoCode(err)
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        return fail('replays.rename.error.notWritable', { folder: dir })
      }
      return fail('replays.rename.error.renameFailed', { code: code ?? 'unknown' })
    }

    // Step 1: merge the facts into the sidecar (still at the old path).
    if (mustPreserve) {
      try {
        originalSidecarBytes = await fs.readFile(oldSidecarPath)
      } catch (err) {
        // Only a real absence means "no sidecar" - a transient error (EBUSY/EPERM from an
        // antivirus or sync client) on a file that may well exist must not leave the snapshot
        // `null`, or a later undo would `rm` the user's real sidecar. Abort before touching disk.
        const code = errnoCode(err)
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
          return fail('replays.rename.error.renameFailed', { code: code ?? 'unknown' })
        }
        originalSidecarBytes = null
      }
      const writeOutcome = await sidecars.write(id, { ...values, ...preserved })
      if (!writeOutcome.ok) return writeOutcome
      // `needsConfirmation` would mean the broken-sidecar guard above missed something - nothing
      // has been written or renamed yet, so refuse the same way.
      if (writeOutcome.value.status !== 'saved') return fail('replays.rename.error.sidecarBroken')
      sidecarWritten = true
    }

    // Whether a sidecar sits at the old path now - there before, or just created by step 1.
    const hasSidecar = sidecarWritten || (await exists(fs, oldSidecarPath))

    // Step 2: the demo itself.
    try {
      await fs.rename(oldPath, newPath)
    } catch (err) {
      try {
        await undoSidecarWrite()
      } catch {
        return fail('replays.rename.error.rollbackFailed', {
          demo: row.fileName,
          sidecar: sidecarFileName(row.fileName),
        })
      }
      return classify(err)
    }

    // Step 3: the sidecar alongside it.
    if (hasSidecar) {
      try {
        await fs.rename(oldSidecarPath, newSidecarPath)
      } catch (err) {
        try {
          await fs.rename(newPath, oldPath)
        } catch {
          // The demo is stuck at its new name, the sidecar still at its old one.
          return fail('replays.rename.error.rollbackFailed', {
            demo: newFileName,
            sidecar: sidecarFileName(row.fileName),
          })
        }
        try {
          await undoSidecarWrite()
        } catch {
          return fail('replays.rename.error.rollbackFailed', {
            demo: row.fileName,
            sidecar: sidecarFileName(row.fileName),
          })
        }
        return classify(err)
      }
    }

    const demo = await scan.applyRename(id, newPath, newFileName)
    if (demo !== undefined) return ok({ demo })
    // A scan swapped the snapshot after the `isScanning` guard, so the index no longer has the old
    // row. The files ARE renamed on disk - nothing to undo, and "failed" would be a lie - so answer
    // with a best-effort row. Its `nameFacts` still reflect the OLD name (not re-matched): an
    // accepted degradation for this narrow race; the next scan corrects it.
    return ok({ demo: { ...row, id: demoIdForPath(newPath), fileName: newFileName } })
  }

  return { rename: renameDemo }
}
