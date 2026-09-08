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
import { buildBootstrapSummary, PLAYABLE_AT_RATIO, startBootstrap, type BootstrapDeps } from './job'
import type { Extractor, GameDataRole, ManifestSource, PackageFetcher } from './ports'

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
}

/**
 * A harness with working fakes. `onFetch` is the seam the cancel test uses to stop the world in the
 * middle of the second package; the fake extractor always writes that package's fixture tree.
 */
function harness(
  options: {
    manifest?: ManifestSource
    /** Called before each fake fetch resolves; may await, cancel, or both. */
    onFetch?: (source: PackageSource, fetchOptions: DownloadPackageOptions) => Promise<void>
    /** Overrides the fixture contents a package's extraction produces. */
    contents?: Record<string, string[]>
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
        url: source.url,
        attempts: [{ url: source.url, requests: 1, outcome: 'verified' }],
      }
    },
  }

  const extractor: Extractor = {
    extract: (input: ExtractArchiveInput): ExtractorHandle => {
      const packageId = input.extractDir.split(/[\\/]/).pop() ?? ''
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

  return {
    jobs,
    installations,
    snapshots,
    fetched,
    deps: {
      jobs,
      installations,
      manifest: options.manifest ?? fakeManifest(),
      fetcher,
      extractor,
      userDataPath,
      resolveExtractor: () => ({ path: join(dir, '7za.exe'), exists: true }),
    },
  }
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
