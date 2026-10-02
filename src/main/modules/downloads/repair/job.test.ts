import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BASE_GAME_DIR, RETAIL_PAK_SIZES } from '@shared/constants'
import type { ManifestPackage, RepairOfferKind } from '@shared/modules/downloads'
import type { EngineKind, Installation, Job } from '@shared/types'
import { InstallationsService } from '../../../services/installations'
import { inspectInstallation } from '../../../services/inspector'
import { makeJobRunner } from '../../../../test-support/job-runner'
import {
  fakeExtractor,
  fakeFetcher,
  fakeManifest,
  fakeState,
  type ManifestCalls,
} from '../test-support'
import { startRepair, type RepairDeps } from './job'
import { resolveRepairPlan } from './plan'

/**
 * Story 093 D4. The job's correctness is a *blast-radius and freshness* property, so this suite runs
 * the real `JobsService`, the real `InstallationsService` (over an in-memory `StateStore` stand-in),
 * the real `inspectInstallation`, the real `assembleInstallation` and the real
 * `InstallationWriteGuard` (through `makeJobRunner`) against real files in a temp directory, and fakes exactly the three
 * things that would otherwise need the network, 7za and a child process: the manifest, the package
 * fetcher and the extractor. The split mirrors `retail/upgrade-job.test.ts`'s -
 *
 *  - **real installations + real inspector**, because "the status is re-derived, never hand-set" and
 *    "the job acts on a fresh verdict" are both claims about what the inspector says about the disk.
 *    A faked installations service would let the job hand-set a status and this suite would agree.
 *  - **real assemble**, because "engine repair writes only engine-role files" and "pak2 repair
 *    writes only `baseq2/pak2.pak`" are properties of the allowlist plus D3's `restrictTo` filter. A
 *    fake assembler would only prove the job passes the arguments it passes; the fake *extractor*
 *    here therefore stages decoys (a `pak0.pak`, a `ctf/`, an `r1q2ded.exe`) that a wrongly scoped
 *    filter would copy, and the file-level assertions below are what catch it.
 *  - **real write guard**, driven by a fake `LaunchHost` (a real `LaunchService` would need a child
 *    process), because what this deliverable has to get right is how the job behaves around
 *    `runWrite`'s deferring and resuming.
 *
 * The one life-size thing is `pak0.pak`: retail-vs-demo is a size check (`RETAIL_PAK_SIZES`), so the
 * fixtures write a sparse file of the exact retail length with `truncate` - instant, and enough for
 * every stat-based check the inspector makes.
 */

const RETAIL_PAK0_BYTES = RETAIL_PAK_SIZES['pak0.pak']

const ENGINE_PACKAGE: ManifestPackage = {
  kind: 'engine',
  engine: 'r1q2',
  id: 'r1q2-b8012',
  version: 'b8012',
  sizeBytes: 4_000_000,
  sha256: 'a'.repeat(64),
  url: 'https://example.test/builds/r1q2-b8012.zip',
  mirrors: [],
  contents: [],
}

const POINT_RELEASE_PACKAGE: ManifestPackage = {
  kind: 'gamedata',
  role: 'point-release',
  id: 'q2-320-point-release',
  version: '3.20',
  sizeBytes: 30_000_000,
  sha256: 'b'.repeat(64),
  url: 'https://example.test/gamedata/q2-320-full.exe',
  mirrors: [],
  contents: [],
}

/** What each fake archive holds once "extracted" - decoys included, on purpose (see the header). */
const ARCHIVE_LAYOUTS: Record<string, string[]> = {
  [ENGINE_PACKAGE.id]: [
    'r1q2.exe',
    'ref_r1gl.dll',
    'baseq2/gamex86.dll',
    // Decoys: the dedicated server (AC3's exclusion from the engine allowlist), game data the
    // engine archive has no business installing, and a mission pack directory.
    'r1q2ded.exe',
    'baseq2/pak0.pak',
    'ctf/pak0.pak',
  ],
  [POINT_RELEASE_PACKAGE.id]: [
    'baseq2/pak2.pak',
    // Decoys: everything else the real 3.20 archive carries, none of which a pak2 repair may touch.
    'baseq2/pak1.pak',
    'baseq2/pak0.pak',
    'ctf/pak0.pak',
  ],
}

let dir: string
let installRoot: string
let userDataPath: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-repair-')))
  installRoot = join(dir, 'Quake II')
  userDataPath = join(dir, 'userData')
  await mkdir(installRoot, { recursive: true })
  await mkdir(userDataPath, { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function writeSized(path: string, bytes: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '')
  await truncate(path, bytes)
}

/**
 * An installation whose recorded client binary is gone - the realistic `reinstall-engine` case: the
 * launcher still recognises the engine (`r1q2ded.exe` is one of R1Q2's marker files), the game data
 * is complete, and the one thing missing is the executable the library has on record.
 */
async function createEngineMissingInstallation(): Promise<void> {
  await writeFile(join(installRoot, 'r1q2ded.exe'), 'dedicated server')
  // On non-Windows, `looksExecutable` (fs-utils.ts) checks the exec bit rather than a `.exe`
  // extension - a real installed binary would carry it, so the fixture needs to too.
  if (process.platform !== 'win32') await chmod(join(installRoot, 'r1q2ded.exe'), 0o755)
  await writeFile(join(installRoot, 'q2launcher-marker.txt'), 'do not touch me')
  await writeSized(join(installRoot, BASE_GAME_DIR, 'pak0.pak'), RETAIL_PAK0_BYTES)
  await writeSized(join(installRoot, BASE_GAME_DIR, 'pak1.pak'), 4096)
  await writeSized(join(installRoot, BASE_GAME_DIR, 'pak2.pak'), 4096)
  await writeFile(join(installRoot, BASE_GAME_DIR, 'config.cfg'), 'bind w +forward')
}

/**
 * A fully playable r1q2 installation - `r1q2.exe` is the *only* thing identifying the engine, no
 * marker file survives its removal (contrast `createEngineMissingInstallation`, which leaves
 * `r1q2ded.exe` behind). Used for the AC1 restart scenario: once `r1q2.exe` is gone, a fresh
 * inspection has nothing left to classify and reports `engineKind: 'unknown'`.
 */
async function createFullR1q2Installation(): Promise<void> {
  await writeFile(join(installRoot, 'r1q2.exe'), 'engine')
  if (process.platform !== 'win32') await chmod(join(installRoot, 'r1q2.exe'), 0o755)
  await writeSized(join(installRoot, BASE_GAME_DIR, 'pak0.pak'), RETAIL_PAK0_BYTES)
  await writeSized(join(installRoot, BASE_GAME_DIR, 'pak1.pak'), 4096)
  await writeSized(join(installRoot, BASE_GAME_DIR, 'pak2.pak'), 4096)
  await writeFile(join(installRoot, BASE_GAME_DIR, 'config.cfg'), 'bind w +forward')
}

/**
 * A playable installation missing only the 3.20 point release - `validation.pointReleaseMissing`,
 * the one finding `install-point-release` is offered for. `withPak2` builds the *repaired* shape,
 * which is what the "an offer that appeared since the dialog looked" test starts from.
 */
async function createPointReleaseMissingInstallation(withPak2 = false): Promise<void> {
  await writeFile(join(installRoot, 'r1q2.exe'), 'engine')
  if (process.platform !== 'win32') await chmod(join(installRoot, 'r1q2.exe'), 0o755)
  await writeFile(join(installRoot, 'q2launcher-marker.txt'), 'do not touch me')
  await writeSized(join(installRoot, BASE_GAME_DIR, 'pak0.pak'), RETAIL_PAK0_BYTES)
  await writeSized(join(installRoot, BASE_GAME_DIR, 'pak1.pak'), 4096)
  if (withPak2) await writeSized(join(installRoot, BASE_GAME_DIR, 'pak2.pak'), 4096)
  await writeFile(join(installRoot, BASE_GAME_DIR, 'config.cfg'), 'bind w +forward')
}

/** Mirrors `pipeline.test.ts`'s helper - a job that waits has no promise to await. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * Writes `ARCHIVE_LAYOUTS` for whichever package's archive it was handed - keyed off the extract
 * dir's own last segment, which the job builds from the manifest package id
 * (`getBootstrapExtractDir`); the archive's *file name* comes from its URL and need not resemble it.
 */
function archiveFiles(extractDir: string): Record<string, string> {
  const packageId = Object.keys(ARCHIVE_LAYOUTS).find((id) => extractDir.endsWith(id))
  return Object.fromEntries(
    (ARCHIVE_LAYOUTS[packageId ?? ''] ?? []).map((path) => [path, `${packageId}:${path}`]),
  )
}

interface Harness {
  deps: RepairDeps
  jobs: ReturnType<typeof makeJobRunner>['jobs']
  launch: ReturnType<typeof makeJobRunner>['launch']
  installations: InstallationsService
  installation: Installation
  fetchCalls: string[]
  manifestCalls: ManifestCalls
  validateCalls: string[]
  recordedEngineCalls: EngineKind[]
}

async function harness(
  options: {
    executablePath?: string
    manifest?: { engine?: ManifestPackage | undefined; pointRelease?: ManifestPackage | undefined }
    fetchGate?: () => Promise<void>
    /** What the fake archive of a package holds once extracted; defaults to `ARCHIVE_LAYOUTS`. */
    archive?: (extractDir: string) => Record<string, string>
  } = {},
): Promise<Harness> {
  const validateCalls: string[] = []
  const service = new InstallationsService({
    state: fakeState(),
    onChange: () => {},
    onSettingsChange: () => {},
  })

  const added = await service.addExisting({
    rootPath: installRoot,
    source: 'manual',
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  })
  if (!added.ok) throw new Error(`fixture installation was rejected: ${added.error.key}`)

  const harnessRunner = makeJobRunner({
    validate: (id) => {
      validateCalls.push(id)
      return service.validate(id)
    },
  })
  const recordedEngineCalls: EngineKind[] = []
  const installations = {
    find: (id: string) => service.find(id),
    validate: harnessRunner.installations.validate,
    setRecordedEngineKind: (id: string, engine: EngineKind) => {
      recordedEngineCalls.push(engine)
      return service.setRecordedEngineKind(id, engine)
    },
  }

  const fetchCalls: string[] = []
  const manifestCalls: ManifestCalls = { engine: [], gameData: [] }
  // An explicit `undefined` means "the manifest has no such package", not "use the default".
  const manifestOptions = options.manifest ?? {}
  const manifestPackages = [
    'engine' in manifestOptions ? manifestOptions.engine : ENGINE_PACKAGE,
    'pointRelease' in manifestOptions ? manifestOptions.pointRelease : POINT_RELEASE_PACKAGE,
  ].filter((pkg): pkg is ManifestPackage => pkg !== undefined)

  return {
    deps: {
      runner: harnessRunner.runner,
      installations,
      manifest: fakeManifest(manifestPackages, manifestCalls),
      fetcher: fakeFetcher(
        userDataPath,
        fetchCalls,
        options.fetchGate ? { gate: options.fetchGate } : {},
      ),
      extractor: fakeExtractor(options.archive ?? archiveFiles),
      userDataPath,
      resolveExtractor: () => ({ path: join(userDataPath, '7za.exe'), exists: true }),
    },
    jobs: harnessRunner.jobs,
    launch: harnessRunner.launch,
    installations: service,
    installation: added.value,
    fetchCalls,
    manifestCalls,
    validateCalls,
    recordedEngineCalls,
  }
}

/** Every file under `root`, as `<relative path> -> <size>:<mtime>`. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const info = await stat(full)
      files.set(relative(root, full).replace(/\\/g, '/'), `${info.size}:${info.mtimeMs}`)
    }
  }
  await walk(root)
  return files
}

function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = []
  for (const [path, stamp] of after) {
    if (before.get(path) !== stamp) changed.push(path)
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changed.push(`removed:${path}`)
  }
  return changed.sort()
}

/** The plan the dialog would have rendered a moment before the job was started. */
async function dialogPlan(installation: Installation): Promise<RepairOfferKind[]> {
  const plan = await resolveRepairPlan(
    {
      inspect: inspectInstallation,
      canSupplyEngine: async () => true,
    },
    {
      id: installation.id,
      rootPath: installation.rootPath,
      engineKind: installation.engineKind,
      ...(installation.recordedEngineKind
        ? { recordedEngineKind: installation.recordedEngineKind }
        : {}),
      ...(installation.executablePath ? { executablePath: installation.executablePath } : {}),
    },
  )
  return plan.offers.map((offer) => offer.kind)
}

describe('the repair job', () => {
  it('reinstalls the engine and writes nothing but the engine files', async () => {
    await createEngineMissingInstallation()
    const test = await harness({ executablePath: join(installRoot, 'r1q2.exe') })
    expect(await dialogPlan(test.installation)).toContain('reinstall-engine')

    const before = await snapshotTree(installRoot)
    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['reinstall-engine'],
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({
      status: 'succeeded',
      performed: ['reinstall-engine'],
    })

    // AC2: exactly R1Q2's three engine-role allowlist entries. The archive also held
    // `r1q2ded.exe`, a `baseq2/pak0.pak` and a `ctf/pak0.pak`, and none of them landed - the
    // 184 MB pak0 in particular is byte-identical to what was there before.
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([
      'baseq2/gamex86.dll',
      'r1q2.exe',
      'ref_r1gl.dll',
    ])
  })

  /**
   * Story 093 finding fix (AC1): the scenario the offer must survive an app restart for. `r1q2.exe`
   * disappears, then `validate()` runs (what `main/index.ts` does on every startup) - which clobbers
   * the live `engineKind` field to `'unknown'`, since r1q2's only marker is its own executable. Only
   * `recordedEngineKind` still says this is an r1q2 installation, and that is what the repair must
   * both offer against and actually act on.
   */
  it('reinstalls the engine from recordedEngineKind after a restart clobbers the live engineKind to unknown', async () => {
    await createFullR1q2Installation()
    const test = await harness()
    expect(test.installation.recordedEngineKind).toBe('r1q2')

    // The executable disappears...
    await rm(join(installRoot, 'r1q2.exe'))
    // ... and the app restarts: `validate()` re-inspects and finds nothing left to classify.
    const revalidated = await test.installations.validate(test.installation.id)
    if (!revalidated.ok) throw new Error(`revalidation was rejected: ${revalidated.error.key}`)
    expect(revalidated.value.engineKind).toBe('unknown')
    expect(revalidated.value.recordedEngineKind).toBe('r1q2')

    expect(await dialogPlan(revalidated.value)).toContain('reinstall-engine')

    const before = await snapshotTree(installRoot)
    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['reinstall-engine'],
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({
      status: 'succeeded',
      performed: ['reinstall-engine'],
    })

    expect(test.manifestCalls.engine).toContain('r1q2')
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([
      'baseq2/gamex86.dll',
      'r1q2.exe',
      'ref_r1gl.dll',
    ])

    // The repair confirmed the engine again - the one-way memory is refreshed, not left to guess.
    expect(test.recordedEngineCalls).toContain('r1q2')
    expect(test.installations.find(test.installation.id)?.recordedEngineKind).toBe('r1q2')
  })

  it('installs the point release and writes nothing but baseq2/pak2.pak', async () => {
    await createPointReleaseMissingInstallation()
    const test = await harness()
    expect(await dialogPlan(test.installation)).toEqual(['install-point-release'])

    const before = await snapshotTree(installRoot)
    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['install-point-release'],
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({
      status: 'succeeded',
      performed: ['install-point-release'],
    })

    // The staged archive also held `baseq2/pak1.pak`, `baseq2/pak0.pak` and `ctf/pak0.pak`.
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual(['baseq2/pak2.pak'])
  })

  /**
   * AC1, the half this story exists for: the dialog's plan is not evidence. Between it being
   * rendered and the job running, the missing executable came back (a restored backup, an antivirus
   * quarantine released) - and a job that acted on the dialog's word would now overwrite a working
   * engine with a downloaded one.
   */
  it('skips an offer the fresh inspection no longer justifies', async () => {
    await createEngineMissingInstallation()
    const test = await harness({ executablePath: join(installRoot, 'r1q2.exe') })
    expect(await dialogPlan(test.installation)).toContain('reinstall-engine')

    // ... and then the engine appears by other means, before the job runs.
    await writeFile(join(installRoot, 'r1q2.exe'), 'the engine the user got back')
    expect(await dialogPlan(test.installation)).not.toContain('reinstall-engine')

    const before = await snapshotTree(installRoot)
    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['reinstall-engine'],
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({
      status: 'succeeded',
      performed: [],
    })

    // Nothing was downloaded and nothing was written - not even the engine binary the caller asked
    // for, which is exactly the point.
    expect(test.fetchCalls).toEqual([])
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    // ... and the run still ended through the inspector, so the library reflects the new reality.
    expect(test.validateCalls).toEqual([test.installation.id])
  })

  /** The other direction of the same rule: a finding that appeared *after* the dialog looked. */
  it('honours an offer that has appeared since the dialog looked', async () => {
    await createPointReleaseMissingInstallation(true)
    const test = await harness()
    expect(await dialogPlan(test.installation)).toEqual([])

    await rm(join(installRoot, BASE_GAME_DIR, 'pak2.pak'))
    const before = await snapshotTree(installRoot)

    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['install-point-release'],
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({
      status: 'succeeded',
      performed: ['install-point-release'],
    })
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual(['baseq2/pak2.pak'])
  })

  it('fails with packageUnavailable, before any write, when the manifest has no point release', async () => {
    await createPointReleaseMissingInstallation()
    const test = await harness({ manifest: { pointRelease: undefined } })

    const before = await snapshotTree(installRoot)
    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['install-point-release'],
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toEqual({
      status: 'failed',
      key: 'downloads.error.packageUnavailable',
      params: { role: 'install-point-release' },
    })

    expect(test.fetchCalls).toEqual([])
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    expect(test.jobs.list()[0]).toMatchObject({
      status: 'failed',
      error: { key: 'downloads.error.packageUnavailable' },
    })
  })

  /**
   * The same for the engine, and the reason the job builds its plan with `canSupplyEngine: true`:
   * `buildRepairPlan`'s availability gate exists so a *dialog* never offers an impossible fix, and
   * letting it decide here would turn "the manifest has no build" into a run that reports success
   * with the engine still missing.
   */
  it('fails with packageUnavailable when the manifest has no build for this engine', async () => {
    await createEngineMissingInstallation()
    const test = await harness({
      executablePath: join(installRoot, 'r1q2.exe'),
      manifest: { engine: undefined },
    })

    const before = await snapshotTree(installRoot)
    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['reinstall-engine'],
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toEqual({
      status: 'failed',
      key: 'downloads.error.packageUnavailable',
      params: { role: 'reinstall-engine' },
    })
    expect(test.fetchCalls).toEqual([])
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
  })

  /**
   * AC7 ([[091]]'s guard, this story's first new consumer): the write waits for the game to exit -
   * it is not refused, and it is not forced through. Downloading and extracting are *not* gated,
   * which the fetch call below asserts while the job is still waiting.
   */
  it('waits for the running game before writing, and resumes when it exits', async () => {
    await createPointReleaseMissingInstallation()
    const test = await harness()
    test.launch.set({ phase: 'running', installationId: test.installation.id, pid: 4242 })

    const before = await snapshotTree(installRoot)
    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['install-point-release'],
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    const job = (): Job => test.jobs.list().find((entry) => entry.id === started.value.jobId)!
    await waitFor(() => job().status === 'waiting', 'the job to enter the waiting state')

    expect(job().waitingReason).toEqual({ key: 'jobs.waiting.gameRunning' })
    expect(job().writeLock).not.toBe(true)
    // The download happened anyway - only the write into the installation waits.
    expect(test.fetchCalls).toHaveLength(1)
    expect(test.validateCalls).toEqual([])
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])

    // The game exits and the job resumes by itself - no user action anywhere in this test.
    test.launch.set({ phase: 'exited', installationId: test.installation.id, exitCode: 0 })
    await expect(started.value.settled).resolves.toMatchObject({ status: 'succeeded' })

    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual(['baseq2/pak2.pak'])
    expect(job()).toMatchObject({ status: 'succeeded', writeLock: false })
  })

  /**
   * AC9. The assertion is deliberately not "the status is `'ok'`" alone: the point is *where* it
   * came from, so the test re-derives the verdict itself, straight from the inspector, and requires
   * the persisted record to match it check for check. A job that wrote a status by hand would have
   * to guess this exactly right to pass, and `RepairInstallationsHost` gives it no way to write one
   * at all.
   */
  it('lets the inspector have the last word on the status', async () => {
    await createEngineMissingInstallation()
    const test = await harness({ executablePath: join(installRoot, 'r1q2.exe') })
    expect(test.installation.status).toBe('warning')

    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['reinstall-engine'],
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({
      status: 'succeeded',
      installationStatus: 'ok',
    })

    expect(test.validateCalls).toEqual([test.installation.id])

    const independent = await inspectInstallation(installRoot, {
      executablePath: join(installRoot, 'r1q2.exe'),
    })
    const persisted = test.installations.find(test.installation.id)!
    expect(independent.status).toBe('ok')
    expect(persisted.status).toBe(independent.status)
    expect(persisted.checks).toEqual(independent.checks)
  })

  it('a repair whose write fails leaves the installation revalidated', async () => {
    await createEngineMissingInstallation()
    // The archive arrives intact but holds only one of the engine files, so the write is refused
    // after it has already copied that file in.
    const test = await harness({
      executablePath: join(installRoot, 'r1q2.exe'),
      archive: () => ({ 'baseq2/gamex86.dll': 'partial engine' }),
    })

    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['reinstall-engine'],
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toEqual({
      status: 'failed',
      key: 'downloads.error.packageIncomplete',
      params: { packageId: 'r1q2-b8012' },
    })

    // Files were written, so the library's record is re-derived from the disk even though the job failed.
    expect(test.validateCalls).toEqual([test.installation.id])
    expect(test.jobs.list()[0]).toMatchObject({
      status: 'failed',
      error: { key: 'downloads.error.packageIncomplete' },
    })
  })

  it('refuses a request naming no repair this job performs, before a job exists', async () => {
    await createPointReleaseMissingInstallation()
    const test = await harness()

    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['retail-copy', 'set-write-dir'],
    })

    expect(started).toEqual({
      ok: false,
      error: { key: 'downloads.error.repairNotApplicable' },
    })
    expect(test.jobs.list()).toEqual([])
    expect(test.fetchCalls).toEqual([])
  })

  it('the repair job is refused while another job targets the installation', async () => {
    await createPointReleaseMissingInstallation()
    const test = await harness()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const other = test.deps.runner.run(
      {
        moduleId: 'mods',
        kind: 'test-other',
        labelKey: 'jobs.simulatedWrite',
        installationId: test.installation.id,
      },
      async () => {
        await held
        return { status: 'succeeded' }
      },
    )
    if (!other.ok) throw new Error('the other job did not start')
    const jobsBefore = test.jobs.list().map((job) => job.id)

    const started = await startRepair(test.deps, {
      installationId: test.installation.id,
      offers: ['install-point-release'],
    })

    expect(started).toMatchObject({ ok: false, error: { key: 'jobs.error.installationBusy' } })
    expect(test.jobs.list().map((job) => job.id)).toEqual(jobsBefore)

    release()
    await other.value.settled
  })

  it('refuses an installation the library no longer holds', async () => {
    await createPointReleaseMissingInstallation()
    const test = await harness()

    const started = await startRepair(test.deps, {
      installationId: 'gone',
      offers: ['install-point-release'],
    })

    expect(started).toMatchObject({ ok: false, error: { key: 'installations.error.notFound' } })
    expect(test.jobs.list()).toEqual([])
  })
})
