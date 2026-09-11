import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import {
  DEFAULT_BOOTSTRAP_INSTALLATION_NAME,
  type DetectedRetailSource,
  type ManifestPackage,
  type PackageSource,
  type RetailSourceInspection,
} from '@shared/modules/downloads'
import { fail, type Installation, type Job, type LauncherSettings } from '@shared/types'
import { InstallationsService } from '../../../services/installations'
import { inspectInstallation } from '../../../services/inspector'
import { JobsService } from '../../../services/jobs'
import type { StateStore } from '../../../services/state'
import type { ExtractArchiveInput, ExtractorHandle } from '../extractor'
import type { DownloadPackageOptions, DownloadPackageResult } from '../fetcher'
import { createDiagnosticsCollector, diagnosticsFor, EXTRACTION_LISTING_CAP } from '../diagnostics'
import {
  BOOTSTRAP_JOB_KIND,
  buildBootstrapSummary,
  PLAYABLE_AT_RATIO,
  startBootstrap,
  type BootstrapDeps,
} from './job'
import type {
  BootstrapLog,
  Extractor,
  GameDataRole,
  ManifestSource,
  PackageFetcher,
  R1q2SetupPort,
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

const ENGINE_PACKAGE: ManifestPackage = {
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

const DEMO_PACKAGE: ManifestPackage = {
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
const R1Q2_ENGINE_PACKAGE: ManifestPackage = {
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

const POINT_RELEASE_PACKAGE: ManifestPackage = {
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

/**
 * What each package's archive "contains", written into its extract dir by the fake extractor.
 *
 * Story 076: every entry `assemble.ts` marks `required` is present here, because a fixture that is
 * missing one now fails the whole run with `downloads.error.packageIncomplete` (D3) rather than
 * quietly copying less - which is the point of D3, and the reason this constant carries the
 * engine's `baseq2/gamex86_64.dll` and the point release's `baseq2/pak1.pak`. The extras sit under
 * `baseq2/video` and `baseq2/players`, the source layout D1 measured on the real archives (AC4).
 */
const FIXTURE_CONTENTS: Record<string, string[]> = {
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

function fakeManifest(
  packages: ManifestPackage[] = [ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE],
): ManifestSource {
  return {
    resolveEnginePackage: (engine) =>
      Promise.resolve(packages.find((pkg) => pkg.kind === 'engine' && pkg.engine === engine)),
    resolveGameDataPackage: (role: GameDataRole) =>
      Promise.resolve(packages.find((pkg) => pkg.kind === 'gamedata' && pkg.role === role)),
  }
}

/** In-memory stand-in for the four `StateStore` methods `InstallationsService` reaches for. */
function fakeState(): StateStore {
  let installations: Installation[] = []
  let settings = { activeInstallationId: null } as LauncherSettings
  return {
    installations: () => installations,
    setInstallations: (next: Installation[]) => {
      installations = next
    },
    settings: () => settings,
    patchSettings: (patch: Partial<LauncherSettings>) => {
      settings = { ...settings, ...patch }
      return settings
    },
  } as unknown as StateStore
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let dir: string
let userDataPath: string
let targetPath: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-bootstrap-')))
  userDataPath = join(dir, 'userData')
  targetPath = join(dir, 'target')
  await mkdir(userDataPath, { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

interface Harness {
  deps: BootstrapDeps
  jobs: JobsService
  installations: InstallationsService
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
function harness(
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
  } = {},
): Harness {
  const snapshots: Job[][] = []
  const jobs = new JobsService((list) => snapshots.push(list))
  const installations = new InstallationsService({
    state: fakeState(),
    onChange: () => {},
    onSettingsChange: () => {},
  })
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
  const baseManifest = options.manifest ?? fakeManifest()
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
    snapshots,
    fetched,
    logLines,
    gameDataRequests,
    retailSourceCalls,
    deps: {
      jobs,
      installations,
      manifest,
      retailSources: () => {
        retailSourceCalls.count += 1
        return Promise.resolve(options.retailSources ?? [])
      },
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
function recordFor(box: Harness, jobId: string): ReturnType<typeof diagnosticsFor> {
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
function breakTargetBeforeValidate(box: Harness, root = targetPath): void {
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
function breakTargetOnSecondValidate(box: Harness): { auxCopiedBeforeSecondValidate: boolean } {
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

async function exists(path: string): Promise<boolean> {
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
async function makeStoreInstallation(name: string, extras = false): Promise<string> {
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
function detectedSource(
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
function observeValidateOrder(box: Harness): boolean[] {
  const pakAtValidate: boolean[] = []
  const validate = box.installations.validate.bind(box.installations)
  vi.spyOn(box.installations, 'validate').mockImplementation(async (id) => {
    pakAtValidate.push(existsSync(join(targetPath, 'baseq2', 'pak0.pak')))
    return validate(id)
  })
  return pakAtValidate
}

describe('startBootstrap', () => {
  it('fetches, extracts and assembles baseq2, and the job succeeds', async () => {
    const box = harness()

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome.status).toBe('succeeded')
    // All three packages, in the documented order: engine, demo, point release.
    expect(box.fetched).toEqual([
      'q2pro-1.0.0.zip',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
    // The allowlisted files landed where an installation expects them.
    expect(await exists(join(targetPath, 'q2pro.exe'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'pak0.pak'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'pak2.pak'))).toBe(true)
    // AC8's negative: the 3.20 archive's `ctf/` payload is not part of the allowlist.
    expect(await readdir(targetPath)).not.toContain('ctf')
    // No extras were asked for, so none were copied.
    expect(await exists(join(targetPath, 'baseq2', 'video'))).toBe(false)
    expect(await exists(join(targetPath, 'players'))).toBe(false)

    const job = box.jobs.list().find((entry) => entry.id === started.value.jobId)
    expect(job?.status).toBe('succeeded')
    expect(job?.installationId).toBe(started.value.installationId)
    // The extracted trees are gone; the verified archives stay in the cache for a cheap retry.
    expect(
      await exists(join(userDataPath, 'cache', 'downloads', 'extract', started.value.jobId)),
    ).toBe(false)
    expect(await readdir(join(userDataPath, 'cache', 'downloads'))).toContain('q2-314-demo-x86.exe')
  })

  it('copies the extras only after the installation is already playable', async () => {
    const box = harness()
    // What the disk looked like at the moment the marker was recorded - the point of AC6 is that
    // the marker precedes the optional extras rather than waiting for the whole job.
    const atMark = { core: false, extras: false }
    const record = box.jobs.markPlayable.bind(box.jobs)
    vi.spyOn(box.jobs, 'markPlayable').mockImplementation((id, ratio) => {
      // `existsSync`, not the async probe: the observation has to be of the disk at exactly this
      // moment, and this method is synchronous.
      atMark.core = existsSync(join(targetPath, 'baseq2', 'pak0.pak'))
      atMark.extras = existsSync(join(targetPath, 'baseq2', 'video', 'ntro.cin'))
      record(id, ratio)
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(atMark.core).toBe(true)
    expect(atMark.extras).toBe(false)
    expect(await exists(join(targetPath, 'baseq2', 'video', 'ntro.cin'))).toBe(true)
    // Story 076 D1 (AC4): sourced from `baseq2/players/`, landing at `baseq2/players/` - not at a
    // bare `players/` in the target root, which is where 074's guessed layout put it.
    expect(await exists(join(targetPath, 'baseq2', 'players', 'male', 'tris.md2'))).toBe(true)
  })

  it('takes the installation status from inspectInstallation and records playableAtRatio once', async () => {
    const box = harness()
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await started.value.settled

    // Recorded exactly once, at the documented ratio, even though two revalidations ran.
    expect(markPlayable).toHaveBeenCalledTimes(1)
    expect(markPlayable).toHaveBeenCalledWith(started.value.jobId, PLAYABLE_AT_RATIO)
    expect(box.jobs.list()[0]?.playableAtRatio).toBe(PLAYABLE_AT_RATIO)

    // The stored status is exactly what the inspector says about that folder, re-derived here
    // independently - so it cannot have been hand-set to a literal "ok" anywhere in the job.
    const installation = box.installations.find(started.value.installationId)
    const inspected = await inspectInstallation(targetPath)
    expect(installation?.status).toBe(inspected.status)
    expect(installation?.status).not.toBe('invalid')
    expect(installation?.engineKind).toBe('q2pro')
  })

  it('fails and cleans up when the assembled folder is still not a usable installation', async () => {
    // Every package contributes every required file, so story 076 D3's missing-required check has
    // nothing to say - and the folder is still not usable when the inspector looks at it. The
    // verdict is the only thing that can notice, which is exactly what must decide the job's fate.
    const box = harness()
    breakTargetBeforeValidate(box)
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({
      status: 'failed',
      key: 'downloads.error.installationNotPlayable',
    })
    expect(markPlayable).not.toHaveBeenCalled()
    expect(box.jobs.list()[0]?.status).toBe('failed')
    expect(box.jobs.list()[0]?.error).toEqual({ key: 'downloads.error.installationNotPlayable' })
    // Story 077 D2: the half-built files are gone (the target root is empty again), and the library
    // entry the user made in the wizard is not - see the AC1/AC2 suite below.
    expect(await readdir(targetPath)).toEqual([])
    expect(box.installations.list()).toHaveLength(1)
  })

  it('cleans up baseq2/players fully when the run fails after the extras pass (F1 regression)', async () => {
    // Story 076 review finding F1: `PRUNABLE_TARGET_DIRS` still named the pre-076 root-level
    // `players` (074 D8's guessed layout), not `baseq2/players` where 076 D1's allowlist actually
    // lands it. `removeAssembled()`'s per-file loop deletes the copied leaf files/dirs, but the now-
    // empty `baseq2/players` directory itself only gets pruned by `PRUNABLE_TARGET_DIRS` - a stale
    // entry there means that directory (and, transitively, `baseq2` and the target root, since
    // `rmdir` refuses a non-empty directory) survives a failed cleanup instead of the target
    // disappearing like every other failure path.
    const box = harness()
    const observed = breakTargetOnSecondValidate(box)

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({
      status: 'failed',
      key: 'downloads.error.installationNotPlayable',
    })
    // The regression only exists once `baseq2/players/...` was actually copied by the extras pass
    // before the late failure - otherwise this test would pass even with the stale path.
    expect(observed.auxCopiedBeforeSecondValidate).toBe(true)
    // Everything inside the target, `baseq2/players` included, must be gone - not just the files,
    // leaving an empty directory tree behind. Since story 077 D2 the target root itself survives a
    // failure, so an empty root is what the stale-path bug would still fail: `rmdir` refuses a
    // non-empty directory, so an unpruned `baseq2/players` would leave `baseq2` here.
    expect(await readdir(targetPath)).toEqual([])
  })

  it('a package that contributes no required file fails the job naming that package', async () => {
    // The 2026-09-08 failure in miniature (AC5): the demo archive downloads, verifies and extracts
    // without a hitch, and holds neither of the two paths the allowlist accepts for
    // `baseq2/pak0.pak`. The other two packages are complete, so the demo is unambiguously the one
    // that came up empty.
    const box = harness({ contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: [] } })
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.packageIncomplete' })
    // The package id, not the role, and as `params` rather than prose - so `en.json`'s sentence
    // can name the archive.
    expect(box.jobs.list()[0]?.error).toEqual({
      key: 'downloads.error.packageIncomplete',
      params: { packageId: DEMO_PACKAGE.id },
    })
    // It failed before the verdict, so the run never got as far as calling anything playable.
    expect(markPlayable).not.toHaveBeenCalled()

    // The reason names every candidate path that was looked for, and story 075's diagnostics ring
    // carries that same line into a copied failure report.
    const failureLine = box.logLines.find((line) => line.includes('packageIncomplete'))
    expect(failureLine).toContain('baseq2/pak0.pak')
    expect(failureLine).toContain('Install/Data/baseq2/pak0.pak')
    const record = recordFor(box, started.value.jobId)
    expect(record?.errorKey).toBe('downloads.error.packageIncomplete')
    expect(record?.logTail.some((line) => line.includes('Install/Data/baseq2/pak0.pak'))).toBe(true)

    // Cleanup is what every other failure path does: no half-built files, and (story 077 D2) the
    // library entry kept, carrying this exit's own key.
    expect(await readdir(targetPath)).toEqual([])
    expect(box.installations.list()[0]?.lastFailure?.errorKey).toBe(
      'downloads.error.packageIncomplete',
    )
  })

  it('a cancel mid-job leaves no files and no registered installation', async () => {
    const reachedSecond = deferred()
    const held = deferred()
    const box = harness({
      onFetch: async (source) => {
        if (source.fileName !== 'q2-314-demo-x86.exe') return
        reachedSecond.resolve()
        // Sit inside the second package's download until the test has cancelled the job.
        await held.promise
      },
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    // The installation is registered from the first moment, before anything is downloaded.
    expect(box.installations.list().map((entry) => entry.id)).toEqual([
      started.value.installationId,
    ])
    expect(await exists(join(targetPath, 'baseq2'))).toBe(true)

    await reachedSecond.promise
    expect(box.jobs.cancel(started.value.jobId).ok).toBe(true)
    held.resolve()

    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'cancelled' })
    // The third package was never requested.
    expect(box.fetched).toEqual(['q2pro-1.0.0.zip', 'q2-314-demo-x86.exe'])
    expect(await exists(targetPath)).toBe(false)
    expect(box.installations.list()).toEqual([])
    expect(box.jobs.list()[0]?.status).toBe('cancelled')
    expect(box.jobs.list()[0]?.playableAtRatio).toBeUndefined()
    // The job's extract directory went with it.
    expect(
      await exists(join(userDataPath, 'cache', 'downloads', 'extract', started.value.jobId)),
    ).toBe(false)
  })

  it('never leaves a target folder the user already had', async () => {
    // D2's verdict treats a non-empty target as a warning, not a blocker - so a cancel must undo
    // only what the job itself wrote.
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'notes.txt'), 'mine')

    const reachedSecond = deferred()
    const held = deferred()
    const box = harness({
      onFetch: async (source) => {
        if (source.fileName !== 'q2-314-demo-x86.exe') return
        reachedSecond.resolve()
        await held.promise
      },
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await reachedSecond.promise
    box.jobs.cancel(started.value.jobId)
    held.resolve()
    expect((await started.value.settled).status).toBe('cancelled')

    // The user's own file survived, and the empty skeleton the job created did not.
    expect(await readdir(targetPath)).toEqual(['notes.txt'])
  })

  it('fails before creating anything when a required package is missing', async () => {
    const box = harness({ manifest: fakeManifest([ENGINE_PACKAGE, DEMO_PACKAGE]) })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })

    expect(started.ok).toBe(false)
    if (!started.ok) expect(started.error.key).toBe('downloads.error.packageUnavailable')
    // No job, no library entry, no folder: nothing existed yet to clean up.
    expect(box.jobs.list()).toEqual([])
    expect(box.installations.list()).toEqual([])
    expect(await exists(targetPath)).toBe(false)
  })

  it('persists a picked write-dir remedy path onto the created installation (AC2)', async () => {
    const box = harness()
    const remedyDir = join(dir, 'remedy-write-dir')
    await mkdir(remedyDir, { recursive: true })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
      writeDirPath: remedyDir,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    const installation = box.installations.find(started.value.installationId)
    expect(installation?.writeDirPath).toBe(await realpath(remedyDir))
  })

  it('assigns the default shipped icon to a freshly bootstrapped installation', async () => {
    const box = harness()

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    const installation = box.installations.find(started.value.installationId)
    expect(installation?.icon).toEqual({ kind: 'shipped', id: 'q2pro-logo' })
  })

  it('never removes a pre-existing empty target folder on cancel', async () => {
    // Distinct from "never leaves a target folder the user already had" above: that folder was
    // non-empty and its own file survived. This one is empty, so the old (pre-fix) code path would
    // have happily `rmdir`ed it - the fix is to know the difference between "the job created this
    // directory" and "the user already had it, just empty".
    await mkdir(targetPath, { recursive: true })

    const reachedSecond = deferred()
    const held = deferred()
    const box = harness({
      onFetch: async (source) => {
        if (source.fileName !== 'q2-314-demo-x86.exe') return
        reachedSecond.resolve()
        await held.promise
      },
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await reachedSecond.promise
    box.jobs.cancel(started.value.jobId)
    held.resolve()
    expect((await started.value.settled).status).toBe('cancelled')

    // The pre-existing (now empty again) directory itself survives, unlike the job-created case.
    expect(await exists(targetPath)).toBe(true)
    expect(await readdir(targetPath)).toEqual([])
  })

  it('refuses a target the verdict blocks, whatever the renderer sent', async () => {
    // A folder the inspector already recognises as a Quake II installation - `blocked`, so the
    // job may not start even though the wizard's own target step should have caught it.
    await mkdir(join(targetPath, 'baseq2'), { recursive: true })
    await writeFile(join(targetPath, 'baseq2', 'pak0.pak'), 'paks')
    await writeFile(join(targetPath, 'q2pro.exe'), 'engine')
    const box = harness()

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })

    expect(started.ok).toBe(false)
    if (!started.ok) {
      expect(started.error.key).toBe('downloads.error.bootstrapTargetBlocked')
      expect(started.error.params).toEqual({ reason: 'alreadyInstalled' })
    }
    expect(box.jobs.list()).toEqual([])
    expect(box.installations.list()).toEqual([])
    // Untouched.
    expect((await readdir(targetPath)).sort()).toEqual(['baseq2', 'q2pro.exe'])
  })

  /**
   * Story 080 D2 (AC1/AC3/AC5/AC7): starting a bootstrap with `engine: 'r1q2'` resolves R1Q2's own
   * pinned package (not Q2PRO's), and assembles only R1Q2's three required files - never
   * `dedicated.exe` (present in the fixture archive, AC3's exclusion) and never a Q2PRO-only path.
   */
  it('assembles only the r1q2 required files when the wizard picks R1Q2', async () => {
    const box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
    })

    const started = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome.status).toBe('succeeded')
    expect(box.fetched).toEqual([
      'R1Q2-b8012-msvs2022.7z',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
    expect(await exists(join(targetPath, 'r1q2.exe'))).toBe(true)
    expect(await exists(join(targetPath, 'ref_r1gl.dll'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'gamex86.dll'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'pak0.pak'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'pak2.pak'))).toBe(true)
    // AC3's exclusions: never dedicated.exe (shipped in the same fixture archive) and never a
    // Q2PRO-only path.
    expect(await exists(join(targetPath, 'dedicated.exe'))).toBe(false)
    expect(await exists(join(targetPath, 'q2pro.exe'))).toBe(false)
    expect(await exists(join(targetPath, 'baseq2', 'gamex86_64.dll'))).toBe(false)

    const installation = box.installations.find(started.value.installationId)
    expect(installation?.engineKind).toBe('r1q2')
  })

  /**
   * Story 080 D3 (AC5): a machine without the x86 VC++ runtime gets an actionable failure instead
   * of a playable verdict, even though every required file assembled without a hitch - the runtime
   * gate fires strictly after `missingRequired` and before the first revalidation.
   */
  it('fails with downloads.error.missingRuntime when the x86 runtime is absent', async () => {
    const box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
      r1q2RuntimePresent: false,
    })

    const started = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.missingRuntime' })
    // The gate fires after assembly, not instead of it: the files themselves are untouched by the
    // check (`failed()`'s own cleanup removes them afterwards, same as every other failure).
    expect(box.fetched).toEqual([
      'R1Q2-b8012-msvs2022.7z',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
  })

  /**
   * Story 080 D3 (AC4). `seedR1glConfig` forces `vid_ref "r1gl"` into a fresh install so R1Q2 finds
   * its renderer on the very first launch. Its own "never overwrite an existing file" guarantee is
   * proven directly in `r1q2-setup.test.ts`; what this job-level test proves is the surrounding
   * wiring - the seeded file is tracked by this job's own cleanup (`copied`) exactly like every
   * other assembled file, so a failed run leaves `baseq2` genuinely empty again (never a stray file
   * that would make `computeTargetVerdict` call the folder `alreadyInstalled` and permanently block
   * the very retry story 077 D3 built adoption for) - and the adopted retry then seeds the file
   * again from scratch, correctly, rather than leaving it absent or wrongly reusing the failed run's
   * copy.
   */
  it('seeds baseq2/autoexec.cfg with the r1gl line, and an adopted retry can still seed it after a failure', async () => {
    const box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
    })
    const cfgPath = join(targetPath, 'baseq2', 'autoexec.cfg')

    // First pass: the config is seeded, then the run fails at the inspector verdict (same fixture
    // as story 077 D3's own adoption tests). The failure's cleanup removes the seeded file along
    // with everything else this job assembled, leaving `baseq2` empty again.
    breakTargetBeforeValidate(box)
    const first = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      name: 'My R1Q2',
      includeVideoAndPlayers: false,
    })
    if (!first.ok) throw new Error(`the first run refused to start: ${first.error.key}`)
    expect((await first.value.settled).status).toBe('failed')
    vi.restoreAllMocks()

    const retried = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      name: 'My R1Q2 (retry)',
      includeVideoAndPlayers: false,
    })
    if (!retried.ok) throw new Error(`retry refused: ${JSON.stringify(retried.error)}`)
    expect((await retried.value.settled).status).toBe('succeeded')
    // The same installation adopted, not a duplicate refusal - the whole point of tracking the
    // seeded file in `copied`.
    expect(retried.value.installationId).toBe(first.value.installationId)
    expect(await readFile(cfgPath, 'utf8')).toBe('set vid_ref "r1gl"\n')
  })

  /**
   * Story 080 D3/D2 (AC6/AC7): the icon a bootstrap sets is engine-aware - R1Q2 gets its own
   * shipped icon, and an unaffected Q2PRO bootstrap keeps the existing default.
   */
  it('sets the r1q2-logo icon for R1Q2 and keeps q2pro-logo for Q2PRO', async () => {
    const r1q2Box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
    })
    const r1q2Started = await startBootstrap(r1q2Box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(r1q2Started.ok).toBe(true)
    if (!r1q2Started.ok) return
    expect((await r1q2Started.value.settled).status).toBe('succeeded')
    expect(r1q2Box.installations.find(r1q2Started.value.installationId)?.icon).toEqual({
      kind: 'shipped',
      id: 'r1q2-logo',
    })

    const q2proTargetPath = join(targetPath, '..', 'target-q2pro')
    const q2proBox = harness()
    const q2proStarted = await startBootstrap(q2proBox.deps, {
      engine: 'q2pro',
      targetPath: q2proTargetPath,
      includeVideoAndPlayers: false,
    })
    expect(q2proStarted.ok).toBe(true)
    if (!q2proStarted.ok) return
    expect((await q2proStarted.value.settled).status).toBe('succeeded')
    expect(q2proBox.installations.find(q2proStarted.value.installationId)?.icon).toEqual({
      kind: 'shipped',
      id: 'q2pro-logo',
    })
  })

  /**
   * Story 080 Acceptance Tests, AC5: "missing R1GL fails before playable" - a job-level proof, not
   * just `assemble.ts`'s unit-level one. The R1Q2 engine fixture's fake extraction is missing
   * `ref_r1gl.dll` entirely (present in `FIXTURE_CONTENTS` for every other test), so the run must
   * fail with `downloads.error.packageIncomplete` rather than ever reaching a playable verdict -
   * mirroring the Q2PRO-equivalent "a package that contributes no required file fails the job
   * naming that package" test above.
   */
  it('missing R1GL fails before playable', async () => {
    const box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
      contents: {
        ...FIXTURE_CONTENTS,
        [R1Q2_ENGINE_PACKAGE.id]: ['r1q2.exe', 'baseq2/gamex86.dll', 'dedicated.exe'],
      },
    })
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.packageIncomplete' })
    expect(box.jobs.list()[0]?.error).toEqual({
      key: 'downloads.error.packageIncomplete',
      params: { packageId: R1Q2_ENGINE_PACKAGE.id },
    })
    expect(markPlayable).not.toHaveBeenCalled()
    expect(await readdir(targetPath)).toEqual([])
    expect(box.installations.list()[0]?.lastFailure?.errorKey).toBe(
      'downloads.error.packageIncomplete',
    )
  })

  /**
   * Story 080 Acceptance Tests, AC5: "point-release DLL cannot replace missing R1Q2 game module" -
   * the cross-role hardening `assemble.ts` enforces, proven here at the job level. The point
   * release's fake extraction happens to contain a file at `baseq2/gamex86.dll` (the same
   * relative path R1Q2's own required engine DLL uses), while the R1Q2 engine's own extraction
   * genuinely lacks it. The job must still fail - a later-searched, wrong-role source is never
   * allowed to satisfy an earlier role's required entry.
   */
  it('point-release DLL cannot replace missing R1Q2 game module', async () => {
    const box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
      contents: {
        ...FIXTURE_CONTENTS,
        [R1Q2_ENGINE_PACKAGE.id]: ['r1q2.exe', 'ref_r1gl.dll', 'dedicated.exe'],
        [POINT_RELEASE_PACKAGE.id]: [...FIXTURE_CONTENTS[POINT_RELEASE_PACKAGE.id]!, 'baseq2/gamex86.dll'],
      },
    })
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.packageIncomplete' })
    expect(box.jobs.list()[0]?.error).toEqual({
      key: 'downloads.error.packageIncomplete',
      params: { packageId: R1Q2_ENGINE_PACKAGE.id },
    })
    expect(markPlayable).not.toHaveBeenCalled()
    // Never installed via the wrong-role source: the target ends up empty, not holding the point
    // release's gamex86.dll under the guise of R1Q2's own required file.
    expect(await readdir(targetPath)).toEqual([])
  })
})

/**
 * Story 077 D2. The one destructive path in this file now behaves differently for its two callers,
 * and both halves of that difference are silent when wrong - a cancel that spares a registration is
 * a library full of ghosts, a failure that deletes one is the 2026-09-08 bug this story exists for.
 * So the two are asserted against each other, from the same seams the rest of this suite uses.
 */
describe('startBootstrap failure and cancel (story 077 D2)', () => {
  const WIZARD_NAME = 'My Quake II'

  /**
   * Every exit that reaches `failed()`, each through a seam this suite already had. The list is the
   * story's own ("`packageUnavailable`/`allMirrorsFailed`, verification, extraction, disk write,
   * `installationNotPlayable`") minus `packageUnavailable`, which fails in `startBootstrap` itself
   * before any installation is registered - there is nothing there for a failure to keep, and the
   * existing "fails before creating anything when a required package is missing" test still owns it.
   */
  const FAILING_EXITS: Array<{ what: string; key: string; make: (root: string) => Harness }> = [
    {
      what: 'the download (transport, all mirrors exhausted)',
      key: 'downloads.error.network',
      make: () => harness({ failFetchFor: 'q2-314-demo-x86.exe' }),
    },
    {
      what: 'the extraction',
      key: 'downloads.error.extractionFailed',
      make: () => harness({ failExtractFor: DEMO_PACKAGE.id }),
    },
    {
      what: 'a package that contributed no required file',
      key: 'downloads.error.packageIncomplete',
      make: () => harness({ contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: [] } }),
    },
    {
      what: 'a local operation (the disk-write catch-all)',
      key: 'downloads.error.diskWrite',
      make: () => {
        const box = harness()
        // The job's own `LOCAL_FAILURE` exit, reached the one way this suite can reach it without
        // a real disk error: the first revalidation answers a failed `Outcome`. The *second* one -
        // the failure path's own, after cleanup - falls through to the real implementation, which
        // is what re-derives the surviving installation's status.
        vi.spyOn(box.installations, 'validate').mockImplementationOnce(async () =>
          fail('installations.error.notFound'),
        )
        return box
      },
    },
    {
      what: 'the inspector verdict',
      key: 'downloads.error.installationNotPlayable',
      make: (root) => {
        const box = harness()
        breakTargetBeforeValidate(box, root)
        return box
      },
    },
  ]

  const startFailing = async (
    box: Harness,
    root: string,
  ): Promise<{ jobId: string; installationId: string; key: string }> => {
    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath: root,
      name: WIZARD_NAME,
      includeVideoAndPlayers: false,
    })
    if (!started.ok) throw new Error(`bootstrap refused to start: ${started.error.key}`)
    const outcome = await started.value.settled
    if (outcome.status !== 'failed') throw new Error(`expected a failed run, got ${outcome.status}`)
    return {
      jobId: started.value.jobId,
      installationId: started.value.installationId,
      key: outcome.key,
    }
  }

  it("AC1: a failed run leaves the installation registered with the wizard's name, root path and engine", async () => {
    // Each exit gets its own target folder (and its own harness, so its own library), because the
    // point is that *every* one of them keeps what the user chose - not just the one a single
    // representative test happens to take.
    for (const [index, exit] of FAILING_EXITS.entries()) {
      const root = join(dir, `target-${index}`)
      const box = exit.make(root)

      const { installationId, key } = await startFailing(box, root)

      expect(`${exit.what}: ${key}`).toBe(`${exit.what}: ${exit.key}`)
      const list = box.installations.list()
      expect(list).toHaveLength(1)
      expect(list[0]?.id).toBe(installationId)
      expect(list[0]?.name).toBe(WIZARD_NAME)
      expect(list[0]?.rootPath).toBe(await realpath(root))
      // `applyInspection` re-derives `engineKind` on every `validate()` for anything but a `custom`
      // kind ([installations.ts:433](../../../../services/installations.ts)), and an emptied folder
      // classifies as `unknown` - but it keeps a previously-known engine kind rather than clobbering
      // it with `unknown`, so the wizard's choice survives the failure path.
      expect(list[0]?.engineKind).toBe('q2pro')
      // The folder the user picked is still there for the retry to point at - empty, not half-built.
      expect(await exists(root)).toBe(true)
      vi.restoreAllMocks()
    }
  })

  it('AC2: a cancelled run still removes the installation and its files', async () => {
    // The regression guard on the half of the split that did *not* change: cancel is still the
    // user's explicit "never mind", and still takes both the entry and the job-created folder.
    const reachedSecond = deferred()
    const held = deferred()
    const box = harness({
      onFetch: async (source) => {
        if (source.fileName !== 'q2-314-demo-x86.exe') return
        reachedSecond.resolve()
        await held.promise
      },
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: WIZARD_NAME,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await reachedSecond.promise
    expect(box.jobs.cancel(started.value.jobId).ok).toBe(true)
    held.resolve()

    expect((await started.value.settled).status).toBe('cancelled')
    expect(box.installations.list()).toEqual([])
    expect(await exists(targetPath)).toBe(false)
    expect(
      await exists(join(userDataPath, 'cache', 'downloads', 'extract', started.value.jobId)),
    ).toBe(false)
  })

  it('AC2: a failed run removes the files but not the registration', async () => {
    // The other half, from an exit that has genuinely copied files into the target first: the
    // engine binary and `baseq2/gamex86_64.dll` are on disk when the verdict fails the run.
    const box = harness()
    breakTargetBeforeValidate(box)

    const { installationId, jobId } = await startFailing(box, targetPath)

    // Assembled files gone, and the directories the job made with them - but the root the user
    // picked survives, so the surviving installation points at something that exists.
    expect(await exists(targetPath)).toBe(true)
    expect(await readdir(targetPath)).toEqual([])
    // The extract cache is gone too; the verified archives stay for a cheap retry.
    expect(await exists(join(userDataPath, 'cache', 'downloads', 'extract', jobId))).toBe(false)
    expect(await readdir(join(userDataPath, 'cache', 'downloads'))).toContain('q2-314-demo-x86.exe')
    expect(box.installations.list().map((entry) => entry.id)).toEqual([installationId])
  })

  it('AC3: the surviving installation carries the error key, the timestamp and the job id', async () => {
    const box = harness({ failFetchFor: 'q2-314-demo-x86.exe' })
    const before = Date.now()

    const { installationId, jobId, key } = await startFailing(box, targetPath)

    const failure = box.installations.find(installationId)?.lastFailure
    // The same key the job ended with - one failure, one key, in both places it is written.
    expect(failure?.errorKey).toBe(key)
    expect(failure?.errorKey).toBe('downloads.error.network')
    expect(failure?.jobId).toBe(jobId)
    expect(failure?.at).toBeGreaterThanOrEqual(before)
    expect(failure?.at).toBeLessThanOrEqual(Date.now())
    // The Downloads tab's own failure log is untouched by this: `Job.error` still carries the key.
    expect(box.jobs.list().find((job) => job.id === jobId)?.error).toEqual({
      key: 'downloads.error.network',
    })
    // A key whose sentence needs no interpolation records none - the record stays exactly the three
    // fields story 077 D1 defined.
    expect(failure?.params).toBeUndefined()
  })

  it('AC3 (finding fix): a templated error key records the params its sentence interpolates', async () => {
    // `downloads.error.packageIncomplete`'s `en.json` sentence reads `{{packageId}}`. Without the
    // params on the record, the library card renders that placeholder literally - so the record has
    // to carry the *same* values this exit already hands the Downloads tab's failure log.
    const box = harness({ contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: [] } })

    const { installationId, jobId, key } = await startFailing(box, targetPath)

    expect(key).toBe('downloads.error.packageIncomplete')
    const failure = box.installations.find(installationId)?.lastFailure
    expect(failure?.errorKey).toBe('downloads.error.packageIncomplete')
    expect(failure?.params).toEqual({ packageId: DEMO_PACKAGE.id })
    // One failure, one key *and* one set of params, in both places it is written: the library card
    // and the Downloads tab cannot render a differently-worded sentence.
    const jobError = box.jobs.list().find((job) => job.id === jobId)?.error
    expect(jobError).toEqual({
      key: 'downloads.error.packageIncomplete',
      params: { packageId: DEMO_PACKAGE.id },
    })
    expect(failure?.params).toEqual(jobError?.params)
  })

  it("AC6: the surviving installation's status comes from inspectInstallation and is not playable", async () => {
    const box = harness()
    breakTargetBeforeValidate(box)

    const { installationId } = await startFailing(box, targetPath)

    const installation = box.installations.find(installationId)
    expect(installation).toBeDefined()
    // Re-derived here, independently, from the folder as the failure left it - so the stored status
    // cannot have been hand-set anywhere in the job.
    const inspected = await inspectInstallation(installation?.rootPath ?? targetPath)
    expect(installation?.status).toBe(inspected.status)
    expect(['invalid', 'missing']).toContain(installation?.status)
    // AC4's negative: a verdict that is not playable keeps the record rather than clearing it.
    expect(installation?.lastFailure?.errorKey).toBe('downloads.error.installationNotPlayable')
  })
})

/**
 * Story 077 D3. Adoption is the one place this job is allowed past `create()`'s duplicate guard, so
 * what these tests are really about is the *predicate*: the same folder and a `lastFailure`, both
 * required. A too-wide match would be invisible here unless the negative is a genuine minimal pair -
 * hence "a duplicate without a lastFailure" below reuses the very installation the adoption test
 * adopts and changes nothing but that one field.
 */
describe('startBootstrap retry adoption (story 077 D3)', () => {
  const WIZARD_NAME = 'My Quake II'
  const RETRY_NAME = 'My Quake II (second try)'

  /**
   * A first run that fails at the inspector verdict, leaving exactly what a retry has to deal with:
   * one registered installation at `targetPath`, carrying a `lastFailure`, pointing at an emptied
   * folder. The `validate` spy stays in place afterwards - a caller that wants the retry to succeed
   * restores it, and the one that wants a second failure simply does not.
   */
  const runFailingFirstPass = async (
    box: Harness,
  ): Promise<{ installationId: string; jobId: string }> => {
    breakTargetBeforeValidate(box)
    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: WIZARD_NAME,
      includeVideoAndPlayers: false,
    })
    if (!started.ok) throw new Error(`the first run refused to start: ${started.error.key}`)
    const outcome = await started.value.settled
    if (outcome.status !== 'failed')
      throw new Error(`expected a failed first run: ${outcome.status}`)
    return { installationId: started.value.installationId, jobId: started.value.jobId }
  }

  it("AC7: a retry on a failed installation's folder adopts it instead of failing with installations.error.duplicate", async () => {
    const box = harness()
    const first = await runFailingFirstPass(box)
    expect(box.installations.find(first.installationId)?.lastFailure).toBeDefined()
    vi.restoreAllMocks()

    // `create()` is what would answer `installations.error.duplicate` here; adoption must not reach
    // it at all, rather than reach it and recover from its refusal.
    const createSpy = vi.spyOn(box.installations, 'create')
    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })
    if (!retry.ok) throw new Error(`the retry was refused with ${retry.error.key}`)

    expect(createSpy).not.toHaveBeenCalled()
    // The same installation, from the very first moment - not a second one, and not a new id.
    expect(retry.value.installationId).toBe(first.installationId)
    expect((await retry.value.settled).status).toBe('succeeded')

    const list = box.installations.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(first.installationId)
    expect(list[0]?.rootPath).toBe(await realpath(targetPath))
    // The wizard's new name went in; the engine kind and the id the library already showed did not
    // change (Decisions (Refine): "Adoption updates the name from the wizard, not the engine").
    expect(list[0]?.name).toBe(RETRY_NAME)
    expect(list[0]?.engineKind).toBe('q2pro')
    expect(list[0]?.lastFailure).toBeUndefined()
  })

  it('AC7: a duplicate without a lastFailure is still refused', async () => {
    const box = harness()
    const first = await runFailingFirstPass(box)
    vi.restoreAllMocks()
    // The minimal pair against the test above: same folder, same registration, same everything -
    // only the one field the adoption predicate reads is gone, which is what an ordinary duplicate
    // (a working or in-progress installation the user owns) looks like from here.
    expect(box.installations.setLastFailure(first.installationId, null).ok).toBe(true)

    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })

    expect(retry.ok).toBe(false)
    if (retry.ok) return
    expect(retry.error.key).toBe('installations.error.duplicate')
    // Nothing was started and nothing was taken over: the first run's job is the only one, and the
    // installation still carries the name its owner gave it.
    expect(box.jobs.list()).toHaveLength(1)
    const list = box.installations.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(first.installationId)
    expect(list[0]?.name).toBe(WIZARD_NAME)
  })

  it('AC4: an adopted retry clears the previous failure when it starts', async () => {
    // The retry parks inside its first download, so what is asserted below is the state *while the
    // job is running* - "cleared when it starts", not "cleared because it succeeded".
    let holdRetry: Deferred | undefined
    const box = harness({
      onFetch: async () => {
        if (holdRetry) await holdRetry.promise
      },
    })

    const first = await runFailingFirstPass(box)
    expect(box.installations.find(first.installationId)?.lastFailure?.jobId).toBe(first.jobId)
    vi.restoreAllMocks()

    holdRetry = deferred()
    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })
    if (!retry.ok) throw new Error(`the retry was refused with ${retry.error.key}`)

    expect(box.jobs.list().find((job) => job.id === retry.value.jobId)?.status).toBe('running')
    expect(box.installations.find(first.installationId)?.lastFailure).toBeUndefined()

    holdRetry.resolve()
    expect((await retry.value.settled).status).toBe('succeeded')
    expect(box.installations.find(first.installationId)?.lastFailure).toBeUndefined()
  })

  it('AC3: an adopted retry that fails again records a new failure on the same installation', async () => {
    // The `validate` spy from the first pass is deliberately left in place, so the adopted run takes
    // the same failure exit - D2's `failed()` now operating on an id it did not create.
    const box = harness()
    const first = await runFailingFirstPass(box)

    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })
    if (!retry.ok) throw new Error(`the retry was refused with ${retry.error.key}`)
    expect(retry.value.installationId).toBe(first.installationId)
    expect((await retry.value.settled).status).toBe('failed')

    const failure = box.installations.find(first.installationId)?.lastFailure
    expect(failure?.errorKey).toBe('downloads.error.installationNotPlayable')
    // A *new* record, naming the retry's own job - not the one the first run left behind.
    expect(failure?.jobId).toBe(retry.value.jobId)
    expect(failure?.jobId).not.toBe(first.jobId)
    expect(box.installations.list()).toHaveLength(1)
  })

  it('finding fix: cancelling an adopted retry keeps the installation registered', async () => {
    // The gap this test guards: install fails (survives, per this story) -> retry adopts it ->
    // user cancels the retry. Cancel is "never mind about the run I just started", not "delete an
    // installation that already existed before I clicked retry" - so unlike a cancelled fresh
    // create, the registration must survive here.
    let holdRetry: Deferred | undefined
    const box = harness({
      onFetch: async () => {
        if (holdRetry) await holdRetry.promise
      },
    })

    const first = await runFailingFirstPass(box)
    const firstFailure = box.installations.find(first.installationId)?.lastFailure
    // Guards the assertion below from passing vacuously (undefined === undefined) if the first pass
    // ever stopped recording a failure.
    expect(firstFailure).toBeDefined()
    vi.restoreAllMocks()

    holdRetry = deferred()
    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })
    if (!retry.ok) throw new Error(`the retry was refused with ${retry.error.key}`)
    expect(retry.value.installationId).toBe(first.installationId)
    // Adoption cleared it the moment the retry started (D3, AC4) - the baseline this test cancels
    // away from.
    expect(box.installations.find(first.installationId)?.lastFailure).toBeUndefined()

    expect(box.jobs.cancel(retry.value.jobId).ok).toBe(true)
    holdRetry.resolve()

    expect((await retry.value.settled).status).toBe('cancelled')

    // Still registered - the whole point of the fix - and still the same installation.
    const list = box.installations.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(first.installationId)
    // Files/root cleaned exactly like an ordinary cancel: the target pre-existed (it is the
    // surviving folder from the first failed run), so `removeRoot` stays false and only the
    // (here: none yet copied) files go, matching `removeAssembled`'s cancel behaviour elsewhere.
    expect(await exists(targetPath)).toBe(true)
    expect(await readdir(targetPath)).toEqual([])
    // Finding fix (F2): a cancel is the user's "never mind" about *this run*, not a verdict that the
    // installation is now failure-free - so the failure D3 cleared when the retry started is put
    // back, restoring exactly the state the installation was in before the user clicked retry (same
    // badge, same sentence). Leaving it cleared instead would pass the adoption predicate's
    // `lastFailure` check and dead-end every later retry on this folder at
    // `installations.error.duplicate` - the empty-library problem again, one door along.
    expect(list[0]?.lastFailure).toEqual(firstFailure)
  })

  it('finding fix: cancelling an ordinary (non-adopted) run is unchanged - still fully unregistered', async () => {
    // The regression guard: this fix must not widen past the adopted case. Mirrors the existing
    // "AC2: a cancelled run still removes the installation and its files" test in the D2 suite
    // above, kept here too so the D3 (adoption) and finding-fix tests sit side by side.
    const reachedSecond = deferred()
    const held = deferred()
    const box = harness({
      onFetch: async (source) => {
        if (source.fileName !== 'q2-314-demo-x86.exe') return
        reachedSecond.resolve()
        await held.promise
      },
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: WIZARD_NAME,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await reachedSecond.promise
    expect(box.jobs.cancel(started.value.jobId).ok).toBe(true)
    held.resolve()

    expect((await started.value.settled).status).toBe('cancelled')
    // Unregistered, and the job-created root removed entirely - byte-for-byte the pre-fix behaviour.
    expect(box.installations.list()).toEqual([])
    expect(await exists(targetPath)).toBe(false)
  })
})

/**
 * Story 075 D3. The collector itself (redaction, the ring, the registry) is D2's suite; what is
 * proved here is that *this* job hands it the right values at the right moments - and, just as
 * importantly, that handing them over changed nothing about what the job does.
 */
describe('startBootstrap diagnostics', () => {
  /** Stands in for a `mirrors` entry that fired: not the URL the manifest names. */
  const DEMO_MIRROR = 'https://mirror.example.net/q2/q2-314-demo-x86.exe'

  const run = async (box: Harness, includeVideoAndPlayers = false) => {
    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error(`bootstrap refused to start: ${started.error.key}`)
    const outcome = await started.value.settled
    return { jobId: started.value.jobId, outcome, record: recordFor(box, started.value.jobId) }
  }

  it('a failed run records every package it touched with its serving URL, size, verify and extract result', async () => {
    // The 2026-09-08 run in miniature: all three packages download and extract, and not one of
    // them contributes a required file. The demo came off a mirror. Since story 076 D3 that run
    // fails naming a package rather than only reporting the end-of-run verdict - what is asserted
    // here is unchanged either way: every package it touched is in the record.
    const box = harness({
      contents: {},
      servingUrl: (source) =>
        source.fileName === 'q2-314-demo-x86.exe' ? DEMO_MIRROR : source.url,
    })

    const { jobId, outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.packageIncomplete' })
    expect(record?.jobId).toBe(jobId)
    expect(record?.kind).toBe(BOOTSTRAP_JOB_KIND)
    expect(record?.errorKey).toBe('downloads.error.packageIncomplete')
    // Every package, in processing order, with the URL that actually served it - the mirror for
    // the demo, not the manifest's primary. Story 078 D3: each also carries what its extraction
    // produced (here: nothing - these archives really were empty) and whether it went on to serve
    // an assembled file (here: none of them did).
    expect(record?.packages).toEqual([
      {
        id: ENGINE_PACKAGE.id,
        url: ENGINE_PACKAGE.url,
        sizeBytes: 1000,
        verified: true,
        extracted: true,
        contents: [],
        contributed: false,
      },
      {
        id: DEMO_PACKAGE.id,
        url: DEMO_MIRROR,
        sizeBytes: 2000,
        verified: true,
        extracted: true,
        contents: [],
        contributed: false,
      },
      {
        id: POINT_RELEASE_PACKAGE.id,
        url: POINT_RELEASE_PACKAGE.url,
        sizeBytes: 4000,
        verified: true,
        extracted: true,
        contents: [],
        contributed: false,
      },
    ])
  })

  it('a not-playable verdict records the target path, the verdict and the failing checks', async () => {
    // A complete package set, so the run reaches the verdict at all (story 076 D3 fails an
    // incomplete one earlier, before there is a target to record).
    const box = harness()
    breakTargetBeforeValidate(box)

    const { record } = await run(box)

    expect(record?.target?.targetPath).toBe(targetPath)
    expect(record?.target?.verdict).toBe('invalid')
    expect(record?.target?.missingChecks.map((check) => check.id)).toContain('base-paks')
    // i18n keys, never prose (AC7) - a sentence would have spaces in it.
    for (const check of record?.target?.missingChecks ?? []) {
      expect(check.messageKey).toMatch(/^[a-z][\w.]*$/)
    }
  })

  it('a package that extracted nothing is identifiable in the diagnostics', async () => {
    // The demo archive "extracts" perfectly and still contributes no `baseq2/pak0.pak` (story
    // 076's real bug). Nothing about the demo's own row looks wrong - verified, extracted, off the
    // expected URL - so what names the package that brought nothing is the recorded error key and
    // the log tail's candidate paths, which is exactly what D3 added.
    const box = harness({ contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: [] } })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.packageIncomplete' })
    expect(record?.packages.map((pkg) => pkg.id)).toEqual([
      ENGINE_PACKAGE.id,
      DEMO_PACKAGE.id,
      POINT_RELEASE_PACKAGE.id,
    ])
    expect(record?.packages.every((pkg) => pkg.verified && pkg.extracted)).toBe(true)
    expect(record?.errorKey).toBe('downloads.error.packageIncomplete')
    expect(record?.logTail.some((line) => line.includes('Install/Data/baseq2/pak0.pak'))).toBe(true)
  })

  it('a run that fails while downloading still records the packages it got to', async () => {
    const box = harness({
      failFetchFor: 'q2-314-demo-x86.exe',
      servingUrl: (source) =>
        source.fileName === 'q2-314-demo-x86.exe' ? DEMO_MIRROR : source.url,
    })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.network' })
    // Partial, not nothing: the engine as it really went (with its extraction's top level), the
    // demo as far as it got (the URL last tried, and - story 078 D3 - no `contents` at all, since
    // it never extracted), and no row at all for the package that was never reached.
    expect(record?.packages).toEqual([
      {
        id: ENGINE_PACKAGE.id,
        url: ENGINE_PACKAGE.url,
        sizeBytes: 1000,
        verified: true,
        extracted: true,
        contents: ['baseq2', 'q2pro.exe'],
      },
      { id: DEMO_PACKAGE.id, url: DEMO_MIRROR, sizeBytes: 2000, verified: false, extracted: false },
    ])
    // No target verdict exists yet - the run never reached the install target stage.
    expect(record?.target).toBeUndefined()
    // Story 078 D3: and no assembly record either - the run failed before the first assemble pass,
    // so there is nothing to say about what assembly looked for.
    expect(record?.assembly).toBeUndefined()
  })

  it('a run that fails while extracting records that package as verified but not extracted', async () => {
    const box = harness({ failExtractFor: DEMO_PACKAGE.id })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.extractionFailed' })
    expect(record?.packages).toEqual([
      {
        id: ENGINE_PACKAGE.id,
        url: ENGINE_PACKAGE.url,
        sizeBytes: 1000,
        verified: true,
        extracted: true,
        contents: ['baseq2', 'q2pro.exe'],
      },
      // Story 078 D3 (AC8): a package whose extraction *failed* carries no `contents` key at all -
      // not an empty array, which would read as "the archive was empty". `toEqual` is what asserts
      // that here: an extra `contents: []` on this row would fail it.
      {
        id: DEMO_PACKAGE.id,
        url: DEMO_PACKAGE.url,
        sizeBytes: 2000,
        verified: true,
        extracted: false,
      },
    ])
    expect(record?.target).toBeUndefined()
    expect(record?.assembly).toBeUndefined()
  })

  it("captures the job's own log lines and redacts paths at capture time", async () => {
    // `homeDir` set to the suite's temp root, so every path the job logs or records sits inside it.
    const box = harness({ homeDir: dir })
    breakTargetBeforeValidate(box)

    const { record } = await run(box)

    expect(record?.target?.targetPath).toBe(join('<home>', 'target'))
    // Teed, not swallowed: the wrapped logger still saw the failure line...
    const failureLine = box.logLines.find((line) => line.includes('failed with'))
    expect(failureLine).toContain('downloads.error.installationNotPlayable')
    // ...and the ring holds it too, with the temp root redacted out of it.
    expect(record?.logTail.some((line) => line.includes('installationNotPlayable'))).toBe(true)
    expect(record?.logTail.join('\n')).not.toContain(dir)
  })

  it('the happy path is unchanged and records the target it succeeded with', async () => {
    const box = harness()

    const { jobId, outcome, record } = await run(box, true)

    expect(outcome.status).toBe('succeeded')
    expect(box.jobs.list().find((job) => job.id === jobId)?.status).toBe('succeeded')
    expect(await exists(join(targetPath, 'baseq2', 'pak0.pak'))).toBe(true)
    expect(box.installations.list()).toHaveLength(1)
    // Recorded before the verdict was branched on, so success and failure record the same thing.
    expect(record?.packages).toHaveLength(3)
    expect(record?.target?.targetPath).toBe(targetPath)
    expect(record?.target?.verdict).not.toBe('invalid')
  })

  it('cleans up exactly the same whether or not a collector is attached', async () => {
    // The capture calls sit before the `failed()` that runs `cleanUp()`, so the observable
    // outcome of a failed run must be byte-for-byte the same without one.
    const withCollector = harness({ contents: {} })
    const instrumented = await run(withCollector)

    expect(instrumented.outcome).toEqual({
      status: 'failed',
      key: 'downloads.error.packageIncomplete',
    })
    expect(await readdir(targetPath)).toEqual([])
    expect(withCollector.installations.list()).toHaveLength(1)
    expect(instrumented.record).toBeDefined()

    // The second run re-uses the same (now empty, cleaned) target folder, which is exactly the
    // state story 077 D2 leaves behind - and `computeTargetVerdict` must still let a run start
    // there, since that is what a retry does.
    const plain = harness({ contents: {} })
    delete plain.deps.diagnostics
    const bare = await run(plain)

    expect(bare.outcome).toEqual(instrumented.outcome)
    expect(await readdir(targetPath)).toEqual([])
    expect(plain.installations.list()).toHaveLength(1)
    expect(await exists(join(userDataPath, 'cache', 'downloads', 'extract', bare.jobId))).toBe(
      false,
    )
    // Nothing was recorded for an uninstrumented job, and nothing broke for the want of it.
    expect(bare.record).toBeUndefined()
  })

  /**
   * Story 078 D3. The two records that were missing on 2026-09-08: what assembly looked for and
   * what served it (AC7/AC1), and what each extraction actually produced (AC8). Same harness, same
   * `run` helper - what changes is only what the finished record is asked about.
   */

  it('a run that assembles nothing marks every package as not contributed', async () => {
    // Literally the 2026-09-08 run: three packages that download, verify and extract, and an
    // assembly that finds none of the files it is looking for. Before this deliverable the record
    // ended at "still invalid after assembly"; now it says so entry by entry.
    const box = harness({ contents: {} })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.packageIncomplete' })
    // One entry per allowlist entry, each reporting the candidate it looked for and that nothing
    // served it - and no entry claiming a source.
    expect(record?.assembly?.length).toBeGreaterThan(0)
    expect(record?.assembly?.every((entry) => entry.found === false)).toBe(true)
    expect(record?.assembly?.every((entry) => entry.sourcePackageId === undefined)).toBe(true)
    // Story 078 review finding M3: both entries have more than one candidate, so a not-found row
    // records every candidate that was tried (joined by ` | `), not just the first.
    expect(record?.assembly).toContainEqual({
      from: 'baseq2/pak0.pak | Install/Data/baseq2/pak0.pak',
      to: 'baseq2/pak0.pak',
      found: false,
    })
    expect(record?.assembly).toContainEqual({
      from: 'q2pro.exe | q2pro64.exe',
      to: 'q2pro.exe',
      found: false,
    })
    // AC1: and the same fact said per package, which is what the card renders - every one of them
    // downloaded, none of them contributed.
    expect(record?.packages.map((pkg) => [pkg.id, pkg.verified, pkg.extracted, pkg.contributed])).toEqual([
      [ENGINE_PACKAGE.id, true, true, false],
      [DEMO_PACKAGE.id, true, true, false],
      [POINT_RELEASE_PACKAGE.id, true, true, false],
    ])
  })

  it('the assembly record reaches the diagnostics', async () => {
    // The healthy counterpart (post-076): every entry the fixture archives can satisfy is found,
    // and names the package whose extraction served it. The extras are on, so this also covers the
    // second assemble pass being concatenated after the first rather than replacing it.
    const box = harness()

    const { outcome, record } = await run(box, true)

    expect(outcome.status).toBe('succeeded')
    expect(record?.assembly).toContainEqual({
      from: 'baseq2/pak0.pak',
      to: 'baseq2/pak0.pak',
      found: true,
      sourcePackageId: DEMO_PACKAGE.id,
    })
    expect(record?.assembly).toContainEqual({
      from: 'q2pro.exe',
      to: 'q2pro.exe',
      found: true,
      sourcePackageId: ENGINE_PACKAGE.id,
    })
    expect(record?.assembly).toContainEqual({
      from: 'baseq2/pak2.pak',
      to: 'baseq2/pak2.pak',
      found: true,
      sourcePackageId: POINT_RELEASE_PACKAGE.id,
    })
    // An optional entry no archive carries is reported as looked-for-and-missing rather than
    // omitted - "we looked here and it wasn't there" is the half that makes the table useful.
    expect(record?.assembly).toContainEqual({
      from: 'baseq2/q2pro.menu',
      to: 'baseq2/q2pro.menu',
      found: false,
    })
    // Core pass first, extras last: the two glob dirs only exist in the second pass, and they sit
    // at the end of the one concatenated table.
    const globs = record?.assembly?.slice(-2)
    expect(globs).toEqual([
      {
        from: 'baseq2/players',
        to: 'baseq2/players',
        found: true,
        sourcePackageId: POINT_RELEASE_PACKAGE.id,
      },
      {
        from: 'baseq2/video',
        to: 'baseq2/video',
        found: true,
        sourcePackageId: POINT_RELEASE_PACKAGE.id,
      },
    ])
    // Every package served something, so every one of them says so.
    expect(record?.packages.every((pkg) => pkg.contributed === true)).toBe(true)
  })

  it("each package records its extraction's top-level entries, capped and sorted", async () => {
    // The point release gets more top-level entries than the cap allows, so both halves of AC8 are
    // exercised in one run: the ordinary packages' full listings and the capped one's flag.
    const extras = Array.from({ length: 25 }, (_, index) => `extra-${String(index).padStart(2, '0')}.txt`)
    const box = harness({
      contents: {
        ...FIXTURE_CONTENTS,
        [POINT_RELEASE_PACKAGE.id]: [...FIXTURE_CONTENTS[POINT_RELEASE_PACKAGE.id]!, ...extras],
      },
    })

    const { outcome, record } = await run(box)

    expect(outcome.status).toBe('succeeded')
    const byId = new Map(record?.packages.map((pkg) => [pkg.id, pkg]))
    // Top-level names only: `baseq2/gamex86_64.dll` shows up as `baseq2`, and sorted.
    expect(byId.get(ENGINE_PACKAGE.id)?.contents).toEqual(['baseq2', 'q2pro.exe'])
    expect(byId.get(ENGINE_PACKAGE.id)?.contentsTruncated).toBeUndefined()
    expect(byId.get(DEMO_PACKAGE.id)?.contents).toEqual(['baseq2'])

    const capped = byId.get(POINT_RELEASE_PACKAGE.id)
    // 27 top-level entries (`baseq2`, `ctf`, 25 extras) trimmed to the cap, in sorted order, and
    // saying that it was trimmed.
    expect(capped?.contents).toHaveLength(EXTRACTION_LISTING_CAP)
    expect(capped?.contentsTruncated).toBe(true)
    expect(capped?.contents?.slice(0, 3)).toEqual(['baseq2', 'ctf', 'extra-00.txt'])
    expect(capped?.contents).toEqual([...(capped?.contents ?? [])].sort())
  })

  it('a wrapper-nested archive is visible in its listing', async () => {
    // Story 076's real-world shape: the demo's payload sits under an `Install/Data/` wrapper. The
    // listing is top-level only, so what it shows is the wrapper itself - which is exactly the clue
    // that was missing from the 2026-09-08 report, and it is one line rather than a file tree.
    const box = harness({
      contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: ['Install/Data/baseq2/pak0.pak'] },
    })

    const { outcome, record } = await run(box)

    expect(outcome.status).toBe('succeeded')
    const demo = record?.packages.find((pkg) => pkg.id === DEMO_PACKAGE.id)
    expect(demo?.contents).toEqual(['Install'])
    expect(demo?.contentsTruncated).toBeUndefined()
    // And the assembly table says which candidate that wrapper finally satisfied.
    expect(record?.assembly).toContainEqual({
      from: 'Install/Data/baseq2/pak0.pak',
      to: 'baseq2/pak0.pak',
      found: true,
      sourcePackageId: DEMO_PACKAGE.id,
    })
    expect(demo?.contributed).toBe(true)
  })
})

/**
 * Story 088 D4. The second data source rewires a job that mutates a registered installation
 * mid-run, so what is asserted here is the *order and the gate*, not just the end state: the copy
 * lands before the first playability revalidation, the renderer's source path is re-resolved against
 * main's own fresh list before anything is registered, and the free-download path comes out of it
 * byte-for-byte unchanged (the last test).
 */
describe('startBootstrap from a detected retail source (story 088 D4)', () => {
  const startCopy = (
    box: Harness,
    copySourcePath: string,
    overrides: { name?: string; includeVideoAndPlayers?: boolean } = {},
  ) =>
    startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: overrides.includeVideoAndPlayers ?? false,
      dataSource: 'store-copy',
      copySourcePath,
      ...(overrides.name ? { name: overrides.name } : {}),
    })

  it('a store-copy run resolves the engine package only', async () => {
    const sourceRoot = await makeStoreInstallation('store-steam')
    const box = harness({ retailSources: [detectedSource(sourceRoot)] })

    const started = await startCopy(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    // AC4: the engine build is downloaded and verified exactly as [[074]] does - and it is the only
    // thing downloaded. The demo and the point release are not even resolved.
    expect(box.fetched).toEqual(['q2pro-1.0.0.zip'])
    expect(box.gameDataRequests).toEqual([])
    // The paks are real copies of the source's bytes, and the engine came from the archive.
    expect(await readFile(join(targetPath, 'baseq2', 'pak0.pak'), 'utf8')).toBe(
      await readFile(join(sourceRoot, 'baseq2', 'pak0.pak'), 'utf8'),
    )
    expect(await readFile(join(targetPath, 'baseq2', 'pak1.pak'), 'utf8')).toBe(
      await readFile(join(sourceRoot, 'baseq2', 'pak1.pak'), 'utf8'),
    )
    expect(await exists(join(targetPath, 'q2pro.exe'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'gamex86_64.dll'))).toBe(true)
    // AC7: the source's `ctf/` is not on the allowlist, so it cannot arrive.
    expect(await readdir(targetPath)).not.toContain('ctf')
    // Main re-listed its own sources for this run, exactly once.
    expect(box.retailSourceCalls.count).toBe(1)
  })

  it('the copy happens before the first playability revalidation', async () => {
    // The deliverable's named risk: a copy that landed *after* the first `validate()` would leave
    // the installation registered as unplayable at the moment the marker is decided - and the run
    // would then fail on a verdict about a folder the job had not finished filling.
    const sourceRoot = await makeStoreInstallation('store-steam')
    const box = harness({ retailSources: [detectedSource(sourceRoot)] })
    const pakAtValidate = observeValidateOrder(box)

    const started = await startCopy(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(pakAtValidate.length).toBeGreaterThan(0)
    expect(pakAtValidate[0]).toBe(true)
    expect(box.jobs.list()[0]?.playableAtRatio).toBe(PLAYABLE_AT_RATIO)
  })

  it('the status always comes from inspectInstallation and the default name is not the demo name', async () => {
    const sourceRoot = await makeStoreInstallation('store-steam')
    const box = harness({ retailSources: [detectedSource(sourceRoot)] })

    // No `name`, so the default applies - AC6/Decisions (Sprint): the engine's own label, since
    // this installation's base data is retail and "Q2PRO Demo" would outlive the missing badge.
    const started = await startCopy(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled
    expect(outcome.status).toBe('succeeded')

    const installation = box.installations.find(started.value.installationId)
    expect(installation?.name).toBe('Q2PRO')
    expect(installation?.name).not.toBe(DEFAULT_BOOTSTRAP_INSTALLATION_NAME)
    // Re-derived here, independently, from the folder the run produced - so no status in this run
    // can have been hand-set or derived from "this was a retail copy" anywhere in the job.
    const inspected = await inspectInstallation(targetPath)
    expect(installation?.status).toBe(inspected.status)
    expect(installation?.status).not.toBe('invalid')
    if (outcome.status === 'succeeded') {
      expect(outcome.installationStatus).toBe(inspected.status)
    }
  })

  it('the extras come from the retail source when the toggle is on', async () => {
    const sourceRoot = await makeStoreInstallation('store-steam', true)
    const box = harness({
      retailSources: [detectedSource(sourceRoot, { hasVideo: true, hasPlayers: true })],
    })

    const started = await startCopy(box, sourceRoot, { includeVideoAndPlayers: true })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(await exists(join(targetPath, 'baseq2', 'video', 'ntro.cin'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'players', 'male', 'tris.md2'))).toBe(true)
    expect(await readdir(targetPath)).not.toContain('ctf')
  })

  it('a copySourcePath that is not among the freshly listed detected sources registers nothing', async () => {
    // The wizard may well have offered this very folder a minute ago; what decides is main's own
    // list *now* (Decisions (Sprint): "the picker list is a UI convenience, not an authorisation").
    const sourceRoot = await makeStoreInstallation('store-steam')
    const detectedElsewhere = await makeStoreInstallation('store-elsewhere')
    const box = harness({ retailSources: [detectedSource(detectedElsewhere)] })

    const started = await startCopy(box, sourceRoot)

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.error.key).toBe('downloads.error.retailSourceUnverified')
    expect(started.error.params).toEqual({ reason: 'notDetected' })
    // Nothing was created, on disk or in the library, and nothing was downloaded.
    expect(box.installations.list()).toEqual([])
    expect(box.jobs.list()).toEqual([])
    expect(box.fetched).toEqual([])
    expect(await exists(targetPath)).toBe(false)
    // The source itself was not touched either.
    expect((await readdir(join(sourceRoot, 'baseq2'))).sort()).toEqual(['pak0.pak', 'pak1.pak'])
  })

  it('a store-copy run whose source comes up empty at copy time fails with its own key, never packageIncomplete naming "retail" (review F1)', async () => {
    // Verified at the D4 pre-check (the fabricated `retailSources` answer below), but the folder
    // itself has no `baseq2` at all by the time the actual copy runs - the store installation was
    // moved or deleted in between. `PACKAGE_INCOMPLETE` would fall back to the literal string
    // `'retail'` as its `packageId` (there is no manifest package behind a `store-copy` run's
    // `'retail'` role - see `resolvePackages`), producing a nonsensical "the download \"retail\"
    // arrived intact" message for a run that downloaded nothing.
    const sourceRoot = join(dir, 'store-vanished')
    await mkdir(sourceRoot, { recursive: true })
    const box = harness({ retailSources: [detectedSource(sourceRoot)] })

    const started = await startCopy(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.retailCopyIncomplete' })
    // Never `packageIncomplete` falling back to the literal role name as its `packageId`.
    const jobError = box.jobs.list().find((job) => job.id === started.value.jobId)?.error
    expect(jobError).toEqual({ key: 'downloads.error.retailCopyIncomplete' })
    expect(box.installations.find(started.value.installationId)?.lastFailure?.errorKey).toBe(
      'downloads.error.retailCopyIncomplete',
    )
  })

  it('a detected source that no longer verifies registers nothing', async () => {
    // Listed, but its fresh inspection says the paks are not retail - the same refusal, carrying
    // the inspector's own reason key rather than a second opinion about why.
    const sourceRoot = await makeStoreInstallation('store-steam')
    const box = harness({
      retailSources: [
        detectedSource(sourceRoot, {
          verified: false,
          unverifiedReason: 'bootstrap.retailSource.pak0SizeMismatch',
        }),
      ],
    })

    const started = await startCopy(box, sourceRoot)

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.error.key).toBe('downloads.error.retailSourceUnverified')
    expect(started.error.params).toEqual({ reason: 'bootstrap.retailSource.pak0SizeMismatch' })
    expect(box.installations.list()).toEqual([])
    expect(box.jobs.list()).toEqual([])
    expect(box.fetched).toEqual([])
    expect(await exists(targetPath)).toBe(false)
  })

  it('a store-copy run with no source path at all is refused, never silently downloaded', async () => {
    // The schema refuses this payload over IPC; this is the in-process caller's equivalent, and the
    // one failure mode that would otherwise be invisible - a run falling back to the free download
    // would succeed, with demo data, under a retail run's name.
    const box = harness({ retailSources: [] })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
      dataSource: 'store-copy',
    })

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.error.key).toBe('downloads.error.retailSourceUnverified')
    expect(started.error.params).toEqual({ reason: 'pathMissing' })
    expect(box.installations.list()).toEqual([])
    expect(box.fetched).toEqual([])
  })

  it('regression: the free-download path is untouched by this deliverable', async () => {
    // Same harness, a detected source available and deliberately ignored: a run that does not ask
    // for `store-copy` resolves and downloads all three packages, never consults the retail list,
    // assembles before the first revalidation and keeps [[074]]'s default name.
    const ignored = detectedSource(await makeStoreInstallation('store-steam'))
    const box = harness({ retailSources: [ignored] })
    const pakAtValidate = observeValidateOrder(box)

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(box.fetched).toEqual([
      'q2pro-1.0.0.zip',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
    expect(box.gameDataRequests).toEqual(['demo', 'point-release'])
    expect(box.retailSourceCalls.count).toBe(0)
    expect(pakAtValidate[0]).toBe(true)
    expect(box.installations.find(started.value.installationId)?.name).toBe(
      DEFAULT_BOOTSTRAP_INSTALLATION_NAME,
    )
  })
})

describe('buildBootstrapSummary', () => {
  it('sums the package sizes', async () => {
    const summary = await buildBootstrapSummary(
      { manifest: fakeManifest() },
      { engine: 'q2pro', targetPath, includeVideoAndPlayers: true },
    )

    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.value.packages).toEqual([
      { id: 'q2pro-1.0.0', version: '1.0.0', sizeBytes: 1000, role: 'engine' },
      { id: 'q2-demo-3.14', version: '3.14', sizeBytes: 2000, role: 'demo' },
      { id: 'q2-point-3.20', version: '3.20', sizeBytes: 4000, role: 'point-release' },
    ])
    expect(summary.value.totalSizeBytes).toBe(7000)
    expect(summary.value.targetPath).toBe(targetPath)
    expect(summary.value.includeVideoAndPlayers).toBe(true)
    // Story 088 D4: unchanged for the source that predates it, and saying so explicitly.
    expect(summary.value.dataSource).toBe('free-download')
    expect(summary.value.copySource).toBeUndefined()
  })

  it('the summary names the copy source and sums the engine package only', async () => {
    const sourceRoot = await makeStoreInstallation('store-gog')
    const summary = await buildBootstrapSummary(
      {
        manifest: fakeManifest(),
        retailSources: () => Promise.resolve([detectedSource(sourceRoot, {}, 'gog')]),
      },
      {
        engine: 'q2pro',
        targetPath,
        includeVideoAndPlayers: false,
        dataSource: 'store-copy',
        copySourcePath: sourceRoot,
      },
    )

    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    // AC5: what is still downloaded (the engine only) and how large it is...
    expect(summary.value.packages).toEqual([
      { id: 'q2pro-1.0.0', version: '1.0.0', sizeBytes: 1000, role: 'engine' },
    ])
    expect(summary.value.totalSizeBytes).toBe(1000)
    // ...the copy source, by store and path, taken from main's own list, not from the caller...
    expect(summary.value.dataSource).toBe('store-copy')
    expect(summary.value.copySource).toEqual({ path: sourceRoot, store: 'gog' })
    // ...and the target.
    expect(summary.value.targetPath).toBe(targetPath)
  })

  it('a copy source main no longer lists is still named, without a store', async () => {
    // The summary reports; refusing the run is `startBootstrap`'s job (and it does - see the D4
    // suite above). A confirm step with no line at all about the source would be the worse answer.
    const sourceRoot = await makeStoreInstallation('store-gone')
    const summary = await buildBootstrapSummary(
      { manifest: fakeManifest(), retailSources: () => Promise.resolve([]) },
      {
        engine: 'q2pro',
        targetPath,
        includeVideoAndPlayers: false,
        dataSource: 'store-copy',
        copySourcePath: sourceRoot,
      },
    )

    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.value.copySource).toEqual({ path: sourceRoot })
  })

  it('fails when the manifest cannot produce all three packages', async () => {
    const summary = await buildBootstrapSummary(
      { manifest: fakeManifest([DEMO_PACKAGE, POINT_RELEASE_PACKAGE]) },
      { engine: 'q2pro', targetPath, includeVideoAndPlayers: false },
    )

    expect(summary.ok).toBe(false)
    if (!summary.ok) {
      expect(summary.error.key).toBe('downloads.error.packageUnavailable')
      expect(summary.error.params).toEqual({ role: 'engine' })
    }
  })
})
