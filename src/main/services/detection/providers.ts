import { readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import type { InstallationSource } from '@shared/types'
import { isDirectory, listDir } from '../../lib/fs-utils'
import { regQuery, regReadValue } from '../../lib/win-registry'
import { scopedLogger } from '../../lib/logger'

const log = scopedLogger('detect')

export interface CandidatePath {
  path: string
  source: InstallationSource
}

/** Folder names that plausibly hold a Quake II install. */
const QUAKE2_FOLDER = /quake\s*(2|ii)|^q2$|r1q2|q2pro|yquake2|kmquake2/i

function looksLikeQuake2Folder(name: string): boolean {
  return QUAKE2_FOLDER.test(name)
}

// ---------------------------------------------------------------------------
// Steam
// ---------------------------------------------------------------------------

async function findSteamRoot(): Promise<string | null> {
  // HKCU is the per-user install and stores forward slashes; HKLM is the fallback.
  const candidates = [
    await regReadValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    await regReadValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    await regReadValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
  ]
  for (const candidate of candidates) {
    if (candidate && (await isDirectory(normalize(candidate)))) return normalize(candidate)
  }
  return null
}

/**
 * Steam library roots. `libraryfolders.vdf` is a small text format; rather than
 * pulling in a VDF parser we take every `"path" "<value>"` pair, which is stable
 * across the format revisions Steam has shipped.
 */
async function steamLibraryRoots(steamRoot: string): Promise<string[]> {
  const roots = new Set<string>([steamRoot])
  for (const relative of ['steamapps/libraryfolders.vdf', 'config/libraryfolders.vdf']) {
    try {
      const text = await readFile(join(steamRoot, relative), 'utf8')
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) {
        roots.add(normalize(match[1].replace(/\\\\/g, '\\')))
      }
    } catch {
      // Missing file just means "no extra libraries".
    }
  }
  return [...roots]
}

async function steamCandidates(): Promise<CandidatePath[]> {
  const steamRoot = await findSteamRoot()
  if (!steamRoot) return []

  const found: CandidatePath[] = []
  for (const library of await steamLibraryRoots(steamRoot)) {
    const commonDir = join(library, 'steamapps', 'common')
    const listing = await listDir(commonDir)
    for (const dir of listing.dirs) {
      // Steam's appid 2320 installs as `steamapps\common\Quake 2`; the fuzzy
      // match also covers GOG-style folder names inside a Steam library.
      if (looksLikeQuake2Folder(dir)) {
        found.push({ path: join(commonDir, dir), source: 'steam' })
      }
    }
  }
  log.debug(`steam: ${found.length} candidate(s)`)
  return found
}

// ---------------------------------------------------------------------------
// GOG
// ---------------------------------------------------------------------------

async function gogCandidates(): Promise<CandidatePath[]> {
  const values = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', {
    recursive: true,
    timeoutMs: 8_000,
  })

  // Group values back into per-game records so `gameName` and `path` stay paired.
  const games = new Map<string, { name?: string; path?: string }>()
  for (const value of values) {
    const entry = games.get(value.key) ?? {}
    if (value.name.toLowerCase() === 'gamename') entry.name = value.value
    if (value.name.toLowerCase() === 'path') entry.path = value.value
    games.set(value.key, entry)
  }

  const found: CandidatePath[] = []
  for (const game of games.values()) {
    if (!game.path) continue
    if (looksLikeQuake2Folder(game.name ?? '') || looksLikeQuake2Folder(game.path)) {
      found.push({ path: normalize(game.path), source: 'gog' })
    }
  }
  log.debug(`gog: ${found.length} candidate(s)`)
  return found
}

// ---------------------------------------------------------------------------
// Epic Games Store
// ---------------------------------------------------------------------------

interface EpicManifest {
  DisplayName?: string
  InstallLocation?: string
}

async function epicCandidates(): Promise<CandidatePath[]> {
  if (process.platform !== 'win32') return []
  const manifestDir = join(
    process.env['PROGRAMDATA'] ?? 'C:\\ProgramData',
    'Epic',
    'EpicGamesLauncher',
    'Data',
    'Manifests',
  )

  const listing = await listDir(manifestDir)
  const found: CandidatePath[] = []
  for (const file of listing.files) {
    if (!file.toLowerCase().endsWith('.item')) continue
    try {
      const manifest = JSON.parse(await readFile(join(manifestDir, file), 'utf8')) as EpicManifest
      if (!manifest.InstallLocation) continue
      if (
        looksLikeQuake2Folder(manifest.DisplayName ?? '') ||
        looksLikeQuake2Folder(manifest.InstallLocation)
      ) {
        found.push({ path: normalize(manifest.InstallLocation), source: 'epic' })
      }
    } catch {
      // A malformed manifest is Epic's problem, not ours.
    }
  }
  log.debug(`epic: ${found.length} candidate(s)`)
  return found
}

// ---------------------------------------------------------------------------
// Retail / hand-installed
// ---------------------------------------------------------------------------

/**
 * Classic install locations. Quake II predates the conventions modern installers
 * follow, so hand-made folders directly on the system drive are the norm.
 */
function commonPathCandidates(): CandidatePath[] {
  if (process.platform !== 'win32') {
    const home = process.env['HOME'] ?? ''
    return [
      { path: '/usr/share/games/quake2', source: 'retail' },
      { path: '/opt/quake2', source: 'retail' },
      ...(home
        ? [
            { path: join(home, 'quake2'), source: 'retail' as InstallationSource },
            { path: join(home, '.yq2'), source: 'retail' as InstallationSource },
          ]
        : []),
    ]
  }

  const systemDrive = process.env['SystemDrive'] ?? 'C:'
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const userProfile = process.env['USERPROFILE'] ?? ''

  const relativeNames = [
    'QUAKE2',
    'Quake2',
    'Quake II',
    'Games\\Quake2',
    'Games\\Quake II',
    'Games\\r1q2',
    'r1q2',
    'q2',
    'id Software\\Quake II',
    // GOG's "Quake II: Quad Damage" installs here by default.
    'GOG Games\\Quake 2',
    'GOG Games\\Quake II',
  ]

  const bases = [`${systemDrive}\\`, `${programFiles}\\`, `${programFilesX86}\\`]
  if (userProfile) bases.push(`${userProfile}\\`, join(userProfile, 'Documents') + '\\')

  const candidates: CandidatePath[] = []
  for (const base of bases) {
    for (const name of relativeNames) {
      candidates.push({ path: normalize(join(base, name)), source: 'retail' })
    }
  }
  return candidates
}

/**
 * Every fast source: registry-backed stores plus the classic paths. Returns raw
 * candidates - validating and de-duplicating them is the caller's job.
 */
export async function collectFastCandidates(): Promise<CandidatePath[]> {
  const groups = await Promise.all([
    steamCandidates().catch(() => []),
    gogCandidates().catch(() => []),
    epicCandidates().catch(() => []),
  ])
  return [...groups.flat(), ...commonPathCandidates()]
}
