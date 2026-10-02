import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { EngineKind, Installation, LauncherSettings, LaunchState } from '@shared/types'
import { IDLE_LAUNCH_STATE, ok } from '@shared/types'
import type { ManifestPackage } from '@shared/modules/downloads'
import type { StateStore } from '../../services/state'
import type { LaunchHost } from '../../services/write-guard'
import type { Extractor, ManifestSource, PackageFetcher } from './bootstrap/ports'
import type { ExtractorHandle } from './extractor'

/** In-memory stand-in for the `StateStore` methods `InstallationsService` reaches for. */
export function fakeState(): StateStore {
  let installations: Installation[] = []
  let settings = { activeInstallationId: null } as LauncherSettings
  return {
    installations: () => installations,
    setInstallations: (next: Installation[]) => {
      installations = next
    },
    updateSlice: (_key: 'installations', fn: (live: Installation[]) => Installation[]) => {
      const next = fn(installations)
      if (next !== installations) installations = next
      return installations
    },
    settings: () => settings,
    patchSettings: (patch: Partial<LauncherSettings>) => {
      settings = { ...settings, ...patch }
      return settings
    },
  } as unknown as StateStore
}

/**
 * The `LaunchHost` the real `InstallationWriteGuard` reads, with a setter the test drives - "the
 * game starts" and "the game exits" are `set(...)` calls that notify the guard's observer exactly
 * as `LaunchService.onStateChange` would.
 */
export function fakeLaunch(): { host: LaunchHost; set: (next: LaunchState) => void } {
  let state: LaunchState = IDLE_LAUNCH_STATE
  const listeners = new Set<(next: LaunchState) => void>()
  return {
    host: {
      getState: () => state,
      onStateChange: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    set: (next) => {
      state = next
      for (const listener of [...listeners]) listener(next)
    },
  }
}

/**
 * Writes the tree `files(extractDir)` names into the extract dir, as 7za would have unpacked the
 * real archive. Every file gets the exec bit on non-Windows: `looksExecutable` (fs-utils.ts) checks
 * the mode bit rather than a `.exe` extension, and the real `inspectInstallation` these suites
 * drive needs the client binary to look real.
 */
export function fakeExtractor(files: (extractDir: string) => Record<string, string>): Extractor {
  return {
    extract: ({ extractDir }): ExtractorHandle => ({
      result: (async () => {
        for (const [relativePath, content] of Object.entries(files(extractDir))) {
          const target = join(extractDir, relativePath)
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, content)
          if (process.platform !== 'win32') await chmod(target, 0o755)
        }
        return ok(undefined)
      })(),
      kill: () => {},
    }),
  }
}

export interface ManifestCalls {
  engine: EngineKind[]
  gameData: string[]
}

/** Answers from `packages` by engine / role; `calls`, when given, records every lookup. */
export function fakeManifest(packages: ManifestPackage[], calls?: ManifestCalls): ManifestSource {
  return {
    resolveEnginePackage: async (engine) => {
      calls?.engine.push(engine)
      return packages.find((pkg) => pkg.kind === 'engine' && pkg.engine === engine)
    },
    resolveGameDataPackage: async (role) => {
      calls?.gameData.push(role)
      return packages.find((pkg) => pkg.kind === 'gamedata' && pkg.role === role)
    },
  }
}

/** Never moves a byte: the archive path it answers is only ever handed to the fake extractor. */
export function fakeFetcher(
  userDataPath: string,
  calls: string[],
  options: { gate?: () => Promise<void> } = {},
): PackageFetcher {
  return {
    fetch: async (source) => {
      calls.push(source.fileName)
      if (options.gate) await options.gate()
      return {
        ok: true,
        path: join(userDataPath, 'cache', 'downloads', source.fileName),
        sizeBytes: source.sizeBytes,
        sha256: source.sha256,
        url: source.url,
        attempts: [],
      }
    },
  }
}
