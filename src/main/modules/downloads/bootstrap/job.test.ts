import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManifestPackage, PackageSource } from '@shared/modules/downloads'
import type { Installation, Job, LauncherSettings } from '@shared/types'
import { InstallationsService } from '../../../services/installations'
import { inspectInstallation } from '../../../services/inspector'
import { JobsService } from '../../../services/jobs'
import type { StateStore } from '../../../services/state'
import type { ExtractArchiveInput, ExtractorHandle } from '../extractor'
import type { DownloadPackageOptions, DownloadPackageResult } from '../fetcher'
import { createDiagnosticsCollector, diagnosticsFor } from '../diagnostics'
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
} from './ports'

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

/** What each package's archive "contains", written into its extract dir by the fake extractor. */
const FIXTURE_CONTENTS: Record<string, string[]> = {
  [ENGINE_PACKAGE.id]: ['q2pro.exe'],
  [DEMO_PACKAGE.id]: ['baseq2/pak0.pak'],
  // `ctf/pak0.pak` is what the real 3.20 archive also ships and what AC8 forbids in the target -
  // included here so this suite would notice the wired-up job dragging it in.
  [POINT_RELEASE_PACKAGE.id]: [
    'baseq2/pak2.pak',
    'video/ntro.cin',
    'players/male/tris.md2',
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

  return {
    jobs,
    installations,
    snapshots,
    fetched,
    logLines,
    deps: {
      jobs,
      installations,
      manifest: options.manifest ?? fakeManifest(),
      fetcher,
      extractor,
      userDataPath,
      resolveExtractor: () => ({ path: join(dir, '7za.exe'), exists: true }),
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
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
    expect(await exists(join(userDataPath, 'cache', 'downloads', 'extract', started.value.jobId)))
      .toBe(false)
    expect(await readdir(join(userDataPath, 'cache', 'downloads'))).toContain(
      'q2-314-demo-x86.exe',
    )
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
    expect(await exists(join(targetPath, 'players', 'male', 'tris.md2'))).toBe(true)
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
    // An extraction that produces nothing: everything "downloads" and "extracts", the allowlist
    // finds no file to copy, and the inspector's verdict on the empty skeleton is the only thing
    // that can notice - which is exactly what must decide the job's fate here.
    const box = harness({ contents: {} })
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
    // A failed job leaves neither the half-built folder nor the library entry.
    expect(await exists(targetPath)).toBe(false)
    expect(box.installations.list()).toEqual([])
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
    expect(await exists(join(userDataPath, 'cache', 'downloads', 'extract', started.value.jobId)))
      .toBe(false)
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
    // The 2026-09-08 run in miniature: all three packages download and extract, and the assembled
    // folder is still not a usable installation. The demo came off a mirror.
    const box = harness({
      contents: {},
      servingUrl: (source) =>
        source.fileName === 'q2-314-demo-x86.exe' ? DEMO_MIRROR : source.url,
    })

    const { jobId, outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.installationNotPlayable' })
    expect(record?.jobId).toBe(jobId)
    expect(record?.kind).toBe(BOOTSTRAP_JOB_KIND)
    expect(record?.errorKey).toBe('downloads.error.installationNotPlayable')
    // Every package, in processing order, with the URL that actually served it - the mirror for
    // the demo, not the manifest's primary.
    expect(record?.packages).toEqual([
      {
        id: ENGINE_PACKAGE.id,
        url: ENGINE_PACKAGE.url,
        sizeBytes: 1000,
        verified: true,
        extracted: true,
      },
      { id: DEMO_PACKAGE.id, url: DEMO_MIRROR, sizeBytes: 2000, verified: true, extracted: true },
      {
        id: POINT_RELEASE_PACKAGE.id,
        url: POINT_RELEASE_PACKAGE.url,
        sizeBytes: 4000,
        verified: true,
        extracted: true,
      },
    ])
  })

  it('a not-playable verdict records the target path, the verdict and the failing checks', async () => {
    const box = harness({ contents: {} })

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
    // 076's real bug). Nothing about the demo row itself looks wrong - pairing it with the
    // target's `base-paks`/`pak0Missing` check is what names the package that brought nothing.
    const box = harness({
      contents: {
        [ENGINE_PACKAGE.id]: ['q2pro.exe'],
        [DEMO_PACKAGE.id]: [],
        [POINT_RELEASE_PACKAGE.id]: ['video/ntro.cin'],
      },
    })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.installationNotPlayable' })
    expect(record?.packages.map((pkg) => pkg.id)).toEqual([
      ENGINE_PACKAGE.id,
      DEMO_PACKAGE.id,
      POINT_RELEASE_PACKAGE.id,
    ])
    expect(record?.packages.every((pkg) => pkg.verified && pkg.extracted)).toBe(true)
    expect(record?.target?.missingChecks).toContainEqual({
      id: 'base-paks',
      messageKey: 'validation.pak0Missing',
    })
  })

  it('a run that fails while downloading still records the packages it got to', async () => {
    const box = harness({
      failFetchFor: 'q2-314-demo-x86.exe',
      servingUrl: (source) =>
        source.fileName === 'q2-314-demo-x86.exe' ? DEMO_MIRROR : source.url,
    })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.network' })
    // Partial, not nothing: the engine as it really went, the demo as far as it got (the URL last
    // tried), and no row at all for the package that was never reached.
    expect(record?.packages).toEqual([
      {
        id: ENGINE_PACKAGE.id,
        url: ENGINE_PACKAGE.url,
        sizeBytes: 1000,
        verified: true,
        extracted: true,
      },
      { id: DEMO_PACKAGE.id, url: DEMO_MIRROR, sizeBytes: 2000, verified: false, extracted: false },
    ])
    // No target verdict exists yet - the run never reached the install target stage.
    expect(record?.target).toBeUndefined()
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
      },
      {
        id: DEMO_PACKAGE.id,
        url: DEMO_PACKAGE.url,
        sizeBytes: 2000,
        verified: true,
        extracted: false,
      },
    ])
    expect(record?.target).toBeUndefined()
  })

  it("captures the job's own log lines and redacts paths at capture time", async () => {
    // `homeDir` set to the suite's temp root, so every path the job logs or records sits inside it.
    const box = harness({ contents: {}, homeDir: dir })

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
      key: 'downloads.error.installationNotPlayable',
    })
    expect(await exists(targetPath)).toBe(false)
    expect(withCollector.installations.list()).toEqual([])
    expect(instrumented.record).toBeDefined()

    const plain = harness({ contents: {} })
    delete plain.deps.diagnostics
    const bare = await run(plain)

    expect(bare.outcome).toEqual(instrumented.outcome)
    expect(await exists(targetPath)).toBe(false)
    expect(plain.installations.list()).toEqual([])
    expect(await exists(join(userDataPath, 'cache', 'downloads', 'extract', bare.jobId))).toBe(
      false,
    )
    // Nothing was recorded for an uninstrumented job, and nothing broke for the want of it.
    expect(bare.record).toBeUndefined()
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
