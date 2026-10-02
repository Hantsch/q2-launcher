import { existsSync } from 'node:fs'
import { chmod, mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, expect, vi } from 'vitest'
import { useTempDir } from '../../../../test-support/temp-dir'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import {
  type DetectedRetailSource,
  type GameDataSourceVerdict,
  type ManifestPackage,
  type PackageSource,
  type RetailSourceInspection,
} from '@shared/modules/downloads'
import type { Job } from '@shared/types'
import { InstallationsService } from '../../../services/installations'
import { withEngineState } from '../engine/record-engine-state'
import { JobsService } from '../../../services/jobs'
import { InstallationWriteGuard } from '../../../services/write-guard'
import { fakeLaunch, fakeManifest, fakeState } from '../test-support'
import { type ExtractArchiveInput, type ExtractorHandle } from '../extractor'
import { type DownloadPackageOptions, type DownloadPackageResult } from '../fetcher'
import { createDiagnosticsCollector, diagnosticsFor } from '../diagnostics'
import { type BootstrapDeps } from './job'
import {
  type BootstrapLog,
  type Extractor,
  type GameDataRole,
  type ManifestSource,
  type PackageFetcher,
  type R1q2SetupPort,
} from './ports'
import { installR1q2Notices, seedR1glConfig } from './r1q2-setup'

/**
 * Story 074 D4. The job's correctness is a *sequencing* property, so this suite drives the real
 * `JobsService`, the real `InstallationsService` (over an in-memory state stand-in) and the real
 * `inspectInstallation`, and fakes only the three ports (`ports.ts`): the manifest, the network and
 * the extractor. That split is deliberate -
 *
 *  - **real installations + real inspector**, because AC6 is "the status always comes from
 *    `inspectInstallation`". A faked installations service would let the job hand-set a status and
 *    this suite would happily agree; with the real one, every status assertion below is a statement
 *    about the actual files on disk, re-derived independently in the test.
 *  - **fake fetcher/extractor**, because a real 190 MB download and a real `7za.exe` would prove
 *    nothing extra about the order of create/assemble/revalidate/`playableAtRatio` - the fake
 *    extractor writes a fixture tree that stands in for a real archive's contents.
 */

export const ENGINE_PACKAGE: ManifestPackage = {
  kind: 'engine',
  engine: 'q2pro',
  id: 'q2pro-1.0.0',
  version: '1.0.0',
  sizeBytes: 1000,
  sha256: 'a'.repeat(64),
  url: 'https://example.com/dl/q2pro-1.0.0.zip',
  mirrors: [],
  contents: [{ from: 'q2pro.exe', to: 'root' }],
}

export const DEMO_PACKAGE: ManifestPackage = {
  kind: 'gamedata',
  role: 'demo',
  id: 'q2-demo-3.14',
  version: '3.14',
  sizeBytes: 2000,
  sha256: 'b'.repeat(64),
  url: 'https://example.com/dl/q2-314-demo-x86.exe',
  mirrors: [],
  contents: [{ from: 'baseq2/pak0.pak', to: 'baseq2' }],
}

/** Story 080 D2: the pinned R1Q2 engine package, standing in for `r1q2-b8012-msvs2022-win32`. */
export const R1Q2_ENGINE_PACKAGE: ManifestPackage = {
  kind: 'engine',
  engine: 'r1q2',
  id: 'r1q2-b8012-msvs2022-win32',
  version: 'b8012-msvs2022',
  sizeBytes: 751580,
  sha256: 'd'.repeat(64),
  url: 'https://example.com/dl/R1Q2-b8012-msvs2022.7z',
  mirrors: [],
  contents: [{ from: 'r1q2.exe', to: 'root' }],
}

export const POINT_RELEASE_PACKAGE: ManifestPackage = {
  kind: 'gamedata',
  role: 'point-release',
  id: 'q2-point-3.20',
  version: '3.20',
  sizeBytes: 4000,
  sha256: 'c'.repeat(64),
  url: 'https://example.com/dl/q2-3.20-x86-full-ctf.exe',
  mirrors: [],
  contents: [{ from: 'baseq2/pak2.pak', to: 'baseq2' }],
}

export const DEFAULT_PACKAGES: ManifestPackage[] = [
  ENGINE_PACKAGE,
  DEMO_PACKAGE,
  POINT_RELEASE_PACKAGE,
]

/**
 * What each package's archive "contains", written into its extract dir by the fake extractor.
 *
 * Story 076: every entry `assemble.ts` marks `required` is present here, because a fixture that is
 * missing one now fails the whole run with `downloads.error.packageIncomplete` (D3) rather than
 * quietly copying less - which is the point of D3, and the reason this constant carries the
 * engine's `baseq2/gamex86_64.dll` and the point release's `baseq2/pak1.pak`. The extras sit under
 * `baseq2/video` and `baseq2/players`, the source layout D1 measured on the real archives (AC4).
 */
export const FIXTURE_CONTENTS: Record<string, string[]> = {
  [ENGINE_PACKAGE.id]: ['q2pro.exe', 'baseq2/gamex86_64.dll'],
  // Story 080 D2: the R1Q2 package's own three required files, plus `dedicated.exe` (AC3's
  // exclusion) - this suite would notice the wired-up job dragging that in.
  [R1Q2_ENGINE_PACKAGE.id]: ['r1q2.exe', 'ref_r1gl.dll', 'baseq2/gamex86.dll', 'dedicated.exe'],
  [DEMO_PACKAGE.id]: ['baseq2/pak0.pak'],
  // `ctf/pak0.pak` is what the real 3.20 archive also ships and what AC8 forbids in the target -
  // included here so this suite would notice the wired-up job dragging it in.
  [POINT_RELEASE_PACKAGE.id]: [
    'baseq2/pak1.pak',
    'baseq2/pak2.pak',
    'baseq2/video/ntro.cin',
    'baseq2/players/male/tris.md2',
    'ctf/pak0.pak',
  ],
}

/** Mirrors `upgrade-job.test.ts`'s helper - a job that waits has no promise to await. */
export async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

export interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

export function deferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export let dir: string
export let userDataPath: string
export let targetPath: string

/** Registers the per-test temp directory hooks; call once at the top of each suite file. */
export function useBootstrapTempDirs(): void {
  const tempDir = useTempDir('q2-launcher-bootstrap-')
  beforeEach(async () => {
    dir = await realpath(tempDir())
    userDataPath = join(dir, 'userData')
    targetPath = join(dir, 'target')
    await mkdir(userDataPath, { recursive: true })
  })
}

export interface Harness {
  deps: BootstrapDeps
  jobs: JobsService
  installations: InstallationsService
  /** Story 091 D6: the launch state the write guard reads; `set()` is "the game
   * started"/"the game exited". */
  launch: ReturnType<typeof fakeLaunch>
  snapshots: Job[][]
  fetched: string[]
  /** Story 075 D3: every line the job's `BootstrapLog` was handed, in order. */
  logLines: string[]
  /** Story 088 D4: the game-data roles the manifest was asked to resolve, in order. Empty for a
   * `store-copy` run, which downloads the engine build and nothing else (AC4). */
  gameDataRequests: GameDataRole[]
  /** Story 088 D4: how often the job re-listed main's own detected retail sources. */
  retailSourceCalls: { count: number }
}

/**
 * A harness with working fakes. `onFetch` is the seam the cancel test uses to stop the world in the
 * middle of the second package; the fake extractor always writes that package's fixture tree.
 *
 * Story 075 D3 added the last four seams: a serving URL that differs from the manifest's (a mirror
 * stand-in), a fetch and an extraction that fail for one named package, and a fixed `homeDir` for
 * the diagnostics collector - which is wired in for every run, since the whole point of D3 is that
 * capture is not a special mode the job is put into.
 */
export function harness(
  options: {
    manifest?: ManifestSource
    /** Called before each fake fetch resolves; may await, cancel, or both. */
    onFetch?: (source: PackageSource, fetchOptions: DownloadPackageOptions) => Promise<void>
    /** Overrides the fixture contents a package's extraction produces. */
    contents?: Record<string, string[]>
    /** The URL that "actually served" a package - a mirror, when it differs from `source.url`. */
    servingUrl?: (source: PackageSource) => string
    /** `PackageSource.fileName` whose download fails (transport), instead of resolving verified. */
    failFetchFor?: string
    /** `ManifestPackage.id` whose extraction fails, instead of writing its fixture tree. */
    failExtractFor?: string
    /**
     * Home directory the diagnostics collector redacts against. Defaults to a path that matches
     * nothing under this suite's temp dir, so recorded paths come back verbatim and the
     * assertions can be exact; the redaction case overrides it with one that does match.
     */
    homeDir?: string
    /**
     * Story 080 D3: whether `deps.r1q2Setup.probeX86Runtime()` reports the x86 VC++ runtime
     * present. Defaults to `true` so every test written before this port existed keeps passing
     * unmodified; only the runtime-gate tests override it. `seedR1glConfig`/`installR1q2Notices`
     * are always the real implementations (real file I/O against this suite's own temp dirs, the
     * same convention `assemble.test.ts` uses) - only the runtime probe is faked, since that is
     * the one seam this suite cannot exercise for real.
     */
    r1q2RuntimePresent?: boolean
    /**
     * Story 088 D4: what `deps.retailSources()` - main's *own* freshly listed detected retail
     * sources - answers this run. Defaults to none detected, so a `store-copy` run that does not
     * set this is refused, which is exactly what the negative tests are about.
     */
    retailSources?: DetectedRetailSource[]
    /**
     * Story 089 D3: substitutes the verdict `deps.inspectGameDataSource` answers for the picked
     * folder. Left unset, the job uses its production default - the *real* `inspectGameDataSource`
     * against the real fixture folder - which is what the refusal tests below want. It is only
     * overridden where a test needs a `retail` verdict, for the same reason `detectedSource()`
     * above fabricates one: a retail-sized `pak0.pak` is 184 MB, and whether a folder's paks
     * measure up is `game-data-source.test.ts`'s subject, not this suite's.
     */
    gameDataSource?: (rootPath: string) => GameDataSourceVerdict
  } = {},
): Harness {
  const snapshots: Job[][] = []
  const jobs = new JobsService((list) => snapshots.push(list))
  const installations = new InstallationsService({
    state: fakeState(),
    onChange: () => {},
    onSettingsChange: () => {},
  })
  // Story 091 D6: the real `InstallationWriteGuard` over a fake launch host, idle by default - so
  // every test written before this story keeps running its assemble passes immediately, exactly as
  // it did without a guard. Only the new AC4 test below moves the launch state to `running`.
  const launch = fakeLaunch()
  const writeGuard = new InstallationWriteGuard({ launch: launch.host, jobs })
  const fetched: string[] = []
  const contents = options.contents ?? FIXTURE_CONTENTS

  const fetcher: PackageFetcher = {
    fetch: async (
      source: PackageSource,
      fetchOptions: DownloadPackageOptions,
    ): Promise<DownloadPackageResult> => {
      fetched.push(source.fileName)
      await options.onFetch?.(source, fetchOptions)
      if (fetchOptions.signal?.aborted === true) {
        return {
          ok: false,
          key: 'downloads.error.network',
          reason: 'the download was cancelled',
          cancelled: true,
          attempts: [],
        }
      }
      // Which URL finally served (or was last tried for) this package - `source.url` unless the
      // test is standing in a mirror.
      const servingUrl = options.servingUrl?.(source) ?? source.url
      if (options.failFetchFor === source.fileName) {
        return {
          ok: false,
          key: 'downloads.error.network',
          reason: 'the mirror hung up',
          cancelled: false,
          attempts: [{ url: servingUrl, requests: 1, outcome: 'transport-failed' }],
        }
      }
      // A verified archive in the cache. Its bytes are never read: the fake extractor below
      // produces the fixture tree, which is what stands in for "the archive's contents".
      const path = join(userDataPath, 'cache', 'downloads', source.fileName)
      await mkdir(join(userDataPath, 'cache', 'downloads'), { recursive: true })
      await writeFile(path, 'archive')
      return {
        ok: true,
        path,
        sizeBytes: source.sizeBytes,
        sha256: source.sha256,
        url: servingUrl,
        attempts: [{ url: servingUrl, requests: 1, outcome: 'verified' }],
      }
    },
  }

  const extractor: Extractor = {
    extract: (input: ExtractArchiveInput): ExtractorHandle => {
      const packageId = input.extractDir.split(/[\\/]/).pop() ?? ''
      if (options.failExtractFor === packageId) {
        return {
          result: Promise.resolve({
            ok: false as const,
            error: { key: 'downloads.error.extractionFailed' },
          }),
          kill: () => {},
        }
      }
      const files = contents[packageId] ?? []
      const result = (async () => {
        for (const relative of files) {
          const absolute = join(input.extractDir, relative)
          await mkdir(join(absolute, '..'), { recursive: true })
          await writeFile(absolute, `contents of ${relative}`)
          // A real archive preserves the exec bit on its client binary; this fixture tree stands
          // in for that (see the suite comment above) and the real `inspectInstallation` this suite
          // drives needs it too - on non-Windows, `looksExecutable` (fs-utils.ts) checks the mode
          // bit rather than a `.exe` extension, so a plain `writeFile` alone leaves every package's
          // binary looking non-executable and the installation reads back as 'invalid'.
          if (process.platform !== 'win32') await chmod(absolute, 0o755)
        }
        return { ok: true as const, value: undefined }
      })()
      return { result, kill: () => {} }
    },
  }

  /**
   * Story 088 D4: the manifest the deps get is the test's own, wrapped so every *game-data*
   * resolution is recorded. "A store-copy run resolves the engine package only" is a statement
   * about what the job asks the manifest for, not only about what it ends up downloading - a run
   * that resolved the demo and then never fetched it would still be wrong.
   */
  const gameDataRequests: GameDataRole[] = []
  const baseManifest = options.manifest ?? fakeManifest(DEFAULT_PACKAGES)
  const manifest: ManifestSource = {
    resolveEnginePackage: (engine) => baseManifest.resolveEnginePackage(engine),
    resolveGameDataPackage: (role) => {
      gameDataRequests.push(role)
      return baseManifest.resolveGameDataPackage(role)
    },
  }

  /** Story 088 D4: main's own detected-source list, and how often the job asked for it. */
  const retailSourceCalls = { count: 0 }

  const logLines: string[] = []
  const log: BootstrapLog = {
    info: (message) => {
      logLines.push(message)
    },
    warn: (message) => {
      logLines.push(message)
    },
  }
  const homeDir = options.homeDir ?? join(dir, 'no-such-home')

  // `installR1q2Notices` is the real implementation throughout - the nonexistent license path
  // below (matching production's `resolveR1q2LicensePath`, now threaded via `BootstrapDeps`
  // rather than defaulted inside `installR1q2Notices` itself) keeps it a real, best-effort no-op
  // for every test that does not care about it: it logs a warning and never throws
  // (`r1q2-setup.test.ts` covers that path directly).
  const r1q2Setup: R1q2SetupPort = {
    probeX86Runtime: () => Promise.resolve(options.r1q2RuntimePresent ?? true),
    seedR1glConfig,
    installR1q2Notices,
  }

  return {
    jobs,
    installations,
    launch,
    snapshots,
    fetched,
    logLines,
    gameDataRequests,
    retailSourceCalls,
    deps: {
      jobs,
      installations: withEngineState(installations),
      writeGuard,
      manifest,
      retailSources: () => {
        retailSourceCalls.count += 1
        return Promise.resolve(options.retailSources ?? [])
      },
      // Absent unless a test fabricates a verdict - so every other run goes through the same
      // default production takes (`inspectGameDataSource` itself).
      ...(options.gameDataSource
        ? {
            inspectGameDataSource: (rootPath: string) =>
              Promise.resolve(options.gameDataSource!(rootPath)),
          }
        : {}),
      fetcher,
      extractor,
      r1q2Setup,
      userDataPath,
      resolveExtractor: () => ({ path: join(dir, '7za.exe'), exists: true }),
      resolveR1q2LicensePath: () => join(dir, 'no-such-license.txt'),
      diagnostics: (jobId, kind) => createDiagnosticsCollector(jobId, kind, homeDir),
      log,
    },
  }
}

/** The diagnostics record the finished job left in the registry, if any. */
export function recordFor(box: Harness, jobId: string): ReturnType<typeof diagnosticsFor> {
  const job = box.jobs.list().find((entry) => entry.id === jobId)
  expect(job).toBeDefined()
  return job ? diagnosticsFor(job) : undefined
}

/**
 * Makes the *inspector's* verdict the thing that fails a run, now that story 076 D3 fails a run
 * whose sources were missing a required file long before the verdict is taken. Every package here
 * still contributes everything the allowlist requires; the assembled paks are then removed from the
 * target immediately before each revalidation, so `inspectInstallation` genuinely reads a folder
 * that is not a usable installation (`base-paks`) and the job's fate is decided by that verdict
 * alone - which is what these tests are about.
 */
export function breakTargetBeforeValidate(box: Harness, root = targetPath): void {
  const validate = box.installations.validate.bind(box.installations)
  vi.spyOn(box.installations, 'validate').mockImplementation(async (id) => {
    // The paks only: the engine binary stays, so the verdict is `invalid` for a missing game, not
    // for a missing executable.
    for (const pak of ['pak0.pak', 'pak1.pak', 'pak2.pak']) {
      await rm(join(root, 'baseq2', pak), { force: true })
    }
    return validate(id)
  })
}

/**
 * Like `breakTargetBeforeValidate`, but only breaks the *second* revalidation (step 9, after the
 * optional extras pass) rather than every call - so the first revalidation (step 7) sees a real,
 * playable folder and the job goes on to run the auxiliary assemble pass before the late failure.
 * This is what the F1 regression needs: `baseq2/players/...` must actually have been copied before
 * cleanup runs, or `removeAssembled()`'s bug in pruning that directory is never exercised.
 */
export function breakTargetOnSecondValidate(box: Harness): {
  auxCopiedBeforeSecondValidate: boolean
} {
  const observed = { auxCopiedBeforeSecondValidate: false }
  const validate = box.installations.validate.bind(box.installations)
  let calls = 0
  vi.spyOn(box.installations, 'validate').mockImplementation(async (id) => {
    calls += 1
    // Exactly the second call, not "the second and every later one": story 077 D2's failure path
    // revalidates once more *after* its cleanup, and that third call must not overwrite what this
    // observation recorded about the disk before anything was deleted.
    if (calls === 2) {
      // Confirmed here, synchronously, before this call's own cleanup can remove it: the
      // auxiliary pass's `baseq2/players/...` file is already on disk by the time the job's final
      // revalidation runs.
      observed.auxCopiedBeforeSecondValidate = existsSync(
        join(targetPath, 'baseq2', 'players', 'male', 'tris.md2'),
      )
      for (const pak of ['pak0.pak', 'pak1.pak', 'pak2.pak']) {
        await rm(join(targetPath, 'baseq2', pak), { force: true })
      }
    }
    return validate(id)
  })
  return observed
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Story 088 D4: a fixture "store installation" to copy from - `baseq2/pak0.pak`+`pak1.pak`, plus the
 * `ctf/` payload a real Steam/GOG install also carries and AC7 forbids in the target. The paks hold
 * a few bytes rather than their real retail sizes: what makes a source copyable in this suite is the
 * *verdict* `deps.retailSources()` hands the job (fabricated below), and measuring real sizes is
 * `retail-source.test.ts`'s subject, not this one's.
 */
export async function makeStoreInstallation(name: string, extras = false): Promise<string> {
  const root = join(dir, name)
  await mkdir(join(root, 'baseq2'), { recursive: true })
  await writeFile(join(root, 'baseq2', 'pak0.pak'), `${name} pak0`)
  await writeFile(join(root, 'baseq2', 'pak1.pak'), `${name} pak1`)
  await mkdir(join(root, 'ctf'), { recursive: true })
  await writeFile(join(root, 'ctf', 'pak0.pak'), 'ctf')
  if (extras) {
    await mkdir(join(root, 'baseq2', 'video'), { recursive: true })
    await writeFile(join(root, 'baseq2', 'video', 'ntro.cin'), 'ntro')
    await mkdir(join(root, 'baseq2', 'players', 'male'), { recursive: true })
    await writeFile(join(root, 'baseq2', 'players', 'male', 'tris.md2'), 'tris')
  }
  return root
}

/** One entry of main's own detected-source list, verified unless `overrides` say otherwise. */
export function detectedSource(
  rootPath: string,
  overrides: Partial<RetailSourceInspection> = {},
  store: DetectedRetailSource['source'] = 'steam',
): DetectedRetailSource {
  const retailPak = (name: 'pak0.pak' | 'pak1.pak') => ({
    exists: true,
    sizeBytes: RETAIL_PAK_SIZES[name],
    matchesRetailSize: true,
  })
  return {
    source: store,
    rootPath,
    inspection: {
      rootPath,
      pak0: retailPak('pak0.pak'),
      pak1: retailPak('pak1.pak'),
      pak2: { exists: false, sizeBytes: null, matchesRetailSize: false },
      verified: true,
      hasVideo: false,
      hasPlayers: false,
      ...overrides,
    },
  }
}

/** Records, per `validate()` call, whether the copied/assembled `baseq2/pak0.pak` was already on
 * disk - the phase-order question both data sources are asserted on below. */
export function observeValidateOrder(box: Harness): boolean[] {
  const pakAtValidate: boolean[] = []
  const validate = box.installations.validate.bind(box.installations)
  vi.spyOn(box.installations, 'validate').mockImplementation(async (id) => {
    pakAtValidate.push(existsSync(join(targetPath, 'baseq2', 'pak0.pak')))
    return validate(id)
  })
  return pakAtValidate
}
