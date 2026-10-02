import { copyFile, mkdir, readdir, rename, rm, lstat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { DiscoveredDemo } from '@shared/modules/replays'
import { fail, ok, type Outcome } from '@shared/types/common'
import { listZipEntries, readZipEntry, type ZipDeps } from '../../lib/zip-entries'

/**
 * Story 160 D1: Q2PRO's `demo` only loads from the Quake FS, so a demo that lives elsewhere gets a
 * temporary copy in `<gamedir>/demos/_launcher/`. The original is never opened for writing and a
 * `.gz` is never decompressed here.
 */

export const LAUNCHER_DIR_NAME = '_launcher'

const DEMO_EXTENSION = /\.(?:dm2|mvd2)(?:\.gz)?$/i

/** `<demo.id>` plus the original's (or, for a zip entry, the entry's) lower-cased extension. */
export function stagedFileName(
  demo: Pick<DiscoveredDemo, 'id' | 'fileName' | 'archiveEntry'>,
): string {
  const name = demo.archiveEntry ? basename(demo.archiveEntry.entryPath) : demo.fileName
  const ext = DEMO_EXTENSION.exec(name)?.[0] ?? extname(name)
  return `${demo.id}${ext.toLowerCase()}`
}

export interface StageDemoInput {
  demo: DiscoveredDemo
  /** Main-only path; for a zip entry, the archive. */
  absolutePath: string
  /** Candidate `.../<gamedir>/demos` dirs, in priority order. */
  targetDemosDirs: string[]
  zipDeps: ZipDeps
}

export async function stageDemo(
  input: StageDemoInput,
): Promise<Outcome<{ copyPath: string; relativePath: string }>> {
  const { demo, absolutePath, targetDemosDirs, zipDeps } = input
  const name = stagedFileName(demo)

  let bytes: Uint8Array | null = null
  if (demo.archiveEntry) {
    const { entryPath } = demo.archiveEntry
    const listing = await listZipEntries(absolutePath, zipDeps)
    if (!listing.ok) return fail('replays.play.error.archiveEntry', { code: listing.code })
    const entry = listing.entries.find((e) => !e.isFolder && e.path === entryPath)
    if (!entry || entry.size === null) {
      return fail('replays.play.error.archiveEntry', { code: 'unreadable' })
    }
    const read = await readZipEntry(absolutePath, entryPath, entry.size, zipDeps)
    if (!read.ok) return fail('replays.play.error.archiveEntry', { code: read.code })
    bytes = read.bytes
  }

  for (const demosDir of targetDemosDirs) {
    const launcherDir = join(demosDir, LAUNCHER_DIR_NAME)
    const copyPath = join(launcherDir, name)
    try {
      await mkdir(launcherDir, { recursive: true })
      if (bytes) {
        const tmpPath = `${copyPath}.tmp`
        try {
          await writeFile(tmpPath, bytes)
          await rename(tmpPath, copyPath)
        } catch (error) {
          await rm(tmpPath, { force: true }).catch(() => undefined)
          throw error
        }
      } else {
        await copyFile(absolutePath, copyPath)
      }
      return ok({ copyPath, relativePath: `${LAUNCHER_DIR_NAME}/${name}` })
    } catch {
      // Not writable here - try the next candidate.
    }
  }

  return fail('replays.play.error.copyDirNotWritable', {
    path: join(targetDemosDirs[0] ?? '', LAUNCHER_DIR_NAME),
  })
}

/** Deletes a staged copy, only if its parent folder is `_launcher`. Never throws. */
export async function removeStagedCopy(copyPath: string): Promise<void> {
  try {
    if (basename(dirname(copyPath)) !== LAUNCHER_DIR_NAME) return
    await rm(copyPath, { force: true })
  } catch {
    // Best effort.
  }
}

/** Structurally satisfied by `Logger` (`src/main/lib/logger.ts`). */
export interface DemoStagingLog {
  warn(message: string): void
}

/** Deletes every regular file directly inside `<dir>/_launcher/`. Never recursive. */
export async function sweepLauncherDirs(demosDirs: string[], log: DemoStagingLog): Promise<void> {
  for (const demosDir of demosDirs) {
    const launcherDir = join(demosDir, LAUNCHER_DIR_NAME)
    let names: string[]
    try {
      names = await readdir(launcherDir)
    } catch {
      continue
    }
    for (const fileName of names) {
      const filePath = join(launcherDir, fileName)
      try {
        const info = await lstat(filePath)
        if (info.isFile()) await rm(filePath, { force: true })
      } catch (error) {
        log.warn(`demo staging sweep: could not remove ${filePath}: ${String(error)}`)
      }
    }
  }
}
