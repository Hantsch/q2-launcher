import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE_GAME_DIR } from '@shared/constants'
import { listDir } from '../../lib/fs-utils'
import type { CandidatePath } from './providers'

/**
 * The optional, user-triggered pass over whole drives.
 *
 * A full-disk walk is unacceptable in a launcher, so this is bounded on three
 * axes: depth, number of directories visited, and a skip list of folders that
 * cannot plausibly contain a Quake II install but are huge. It yields control
 * regularly so the main process stays responsive, and checks the cancellation
 * token between directories.
 */

const MAX_DEPTH = 5
const MAX_DIRECTORIES = 60_000

/** Folder names never worth descending into. Matched case-insensitively. */
const SKIP_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  'windows',
  'winnt',
  'perflogs',
  'recovery',
  'msocache',
  'node_modules',
  '.git',
  'appdata',
  'temp',
  'tmp',
  'cache',
  'onedrive',
  'onedrivetemp',
  'documents and settings',
  'programdata',
  'application data',
  // Microsoft Store installs live here and are read-only; a copy has to be
  // made before anything can use them, so they are not usable installs.
  'windowsapps',
  'library',
  'dosdevices',
  '.cache',
  '.local',
])

export interface DeepScanOptions {
  drives: string[]
  isCancelled: () => boolean
  onProgress: (info: { currentPath: string; visited: number }) => void
}

export async function deepScan(options: DeepScanOptions): Promise<CandidatePath[]> {
  const found: CandidatePath[] = []
  const seen = new Set<string>()
  let visited = 0

  for (const drive of options.drives) {
    if (options.isCancelled()) break

    // Breadth-first: real installs sit near the top of a drive, so the useful
    // hits arrive long before the budget runs out.
    let frontier: Array<{ path: string; depth: number }> = [{ path: drive, depth: 0 }]

    while (frontier.length > 0 && visited < MAX_DIRECTORIES) {
      if (options.isCancelled()) return found

      const next: Array<{ path: string; depth: number }> = []
      for (const entry of frontier) {
        if (options.isCancelled()) return found
        if (visited >= MAX_DIRECTORIES) break

        const key = entry.path.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)

        visited += 1
        if (visited % 200 === 0) {
          options.onProgress({ currentPath: entry.path, visited })
          // Hand the event loop back so IPC and window painting keep working.
          await new Promise((resolve) => setImmediate(resolve))
        }

        const listing = await listDir(entry.path)

        if (listing.byLowerName.has(BASE_GAME_DIR)) {
          found.push({ path: entry.path, source: 'retail' })
          // A folder containing baseq2 is a leaf for our purposes.
          continue
        }

        if (entry.depth >= MAX_DEPTH) continue

        for (const dir of listing.dirs) {
          if (SKIP_DIRS.has(dir.toLowerCase())) continue
          if (dir.startsWith('$')) continue
          next.push({ path: join(entry.path, dir), depth: entry.depth + 1 })
        }
      }
      frontier = next
    }
  }

  options.onProgress({ currentPath: '', visited })
  return found
}

/**
 * Drive roots that currently exist. Probing A-Z is faster and more reliable than
 * spawning `wmic` (removed on recent Windows) or PowerShell.
 */
export async function listDrives(): Promise<string[]> {
  if (process.platform !== 'win32') return ['/']

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const results = await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:\\`
      try {
        await access(root)
        return root
      } catch {
        return null
      }
    }),
  )
  return results.filter((drive): drive is string => drive !== null)
}
