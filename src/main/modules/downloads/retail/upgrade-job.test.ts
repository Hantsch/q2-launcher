import { mkdir, mkdtemp, readdir, realpath, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BASE_GAME_DIR, RETAIL_PAK_SIZES } from '@shared/constants'
import type { DetectedRetailSource, RetailSourceInspection } from '@shared/modules/downloads'
import {
  IDLE_LAUNCH_STATE,
  type Installation,
  type Job,
  type LaunchState,
  type LauncherSettings,
} from '@shared/types'
import { InstallationsService } from '../../../services/installations'
import { inspectInstallation } from '../../../services/inspector'
import { JobsService } from '../../../services/jobs'
import type { StateStore } from '../../../services/state'
import { InstallationWriteGuard, type LaunchHost } from '../../../services/write-guard'
import type { AssembleInstallationResult } from '../bootstrap/assemble'
import {
  RETAIL_UPGRADE_JOB_KIND,
  startRetailUpgrade,
  type RetailGameDataCopy,
  type RetailUpgradeDeps,
} from './upgrade-job'

/**
 * Story 090 D2. The job's correctness is a *sequencing and blast-radius* property, so this suite
 * drives the real `JobsService`, the real `InstallationsService` (over an in-memory `StateStore`
 * stand-in) and the real `inspectInstallation`, and fakes exactly the three things the deliverable
 * names: the launch service, the retail-source inspection and [[088]]'s copy routine. The split
 * mirrors `bootstrap/job.test.ts`'s and is deliberate -
 *
 * Story 091 D4 adds a fourth real thing: the write guard. `InstallationWriteGuard` is the *real*
 * one here, driven by a fake `LaunchHost` (a real `LaunchService` would need a child process), for
 * the same reason the installations service is real - what this deliverable has to get right is how
 * the job behaves around `runWrite`'s waiting, resuming and aborting, and a stubbed guard that
 * simply called its callback would keep the suite green with the cancel wiring missing entirely.
 *
 *  - **real installations + real inspector**, because AC5 is "the status is re-derived from the
 *    inspector, never hand-set". A faked installations service would let the job hand-set a status
 *    and this suite would happily agree; with the real one, the status assertions below are
 *    statements about the actual files on disk, re-derived independently by the test.
 *  - **fake retail sources**, because "does this folder verify as retail" is [[088]]'s check and
 *    already has its own tests - and because faking it is what lets the *source* side of a run be a
 *    path rather than 197 MB of fixture.
 *  - **fake copy routine**, for the same reason: what this job has to get right is not the copying
 *    (that is `assemble.ts`'s, tested there) but what it does with the result - which files it
 *    promotes, where, and what it leaves alone.
 *
 * The one thing that *is* life-size here is `pak0.pak`: the demo marker the whole story exists to
 * clear is a size check (`RETAIL_PAK_SIZES`), so the fake copy stages a file of the exact retail
 * length with `truncate` - instant, and enough for every stat-based check in the inspector.
 */

const RETAIL_PAK0_BYTES = RETAIL_PAK_SIZES['pak0.pak']
const RETAIL_PAK1_BYTES = RETAIL_PAK_SIZES['pak1.pak']
/** Not the retail length - what a demo installation's own `pak0.pak` looks like to the inspector. */
const DEMO_PAK0_BYTES = 4096

let dir: string
let installRoot: string
let sourceRoot: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-retail-upgrade-')))
  installRoot = join(dir, 'Quake II Demo')
  sourceRoot = join(dir, 'Steam', 'Quake 2')
  await mkdir(sourceRoot, { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/**
 * A demo installation as the library holds one: an engine binary the inspector can identify, a
 * `baseq2` whose `pak0.pak` is the wrong length for retail (which is exactly what
 * `validation.pak0NotRetail` reports), and a handful of files that have nothing to do with game
 * data and must survive the upgrade untouched (AC4).
 */
async function createDemoInstallation(baseDirName = BASE_GAME_DIR): Promise<void> {
  const baseDir = join(installRoot, baseDirName)
  await mkdir(join(baseDir, 'players', 'male'), { recursive: true })
  await mkdir(join(installRoot, 'xatrix'), { recursive: true })
  await writeFile(join(installRoot, 'r1q2.exe'), 'engine')
  await writeFile(join(installRoot, 'q2launcher-marker.txt'), 'do not touch me')
  await writeFile(join(baseDir, 'pak0.pak'), Buffer.alloc(DEMO_PAK0_BYTES))
  await writeFile(join(baseDir, 'config.cfg'), 'bind w +forward')
  await writeFile(join(baseDir, 'players', 'male', 'tris.md2'), 'player model')
  await writeFile(join(installRoot, 'xatrix', 'pak0.pak'), 'mission pack data')
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

/** A verified store source, as `listDetectedRetailSources` would report one. */
function detectedSource(
  rootPath: string,
  inspection: Partial<RetailSourceInspection> = {},
): DetectedRetailSource {
  const retailPak = { exists: true, sizeBytes: RETAIL_PAK0_BYTES, matchesRetailSize: true }
  return {
    source: 'steam',
    rootPath,
    inspection: {
      rootPath,
      pak0: retailPak,
      pak1: { ...retailPak, sizeBytes: RETAIL_PAK1_BYTES },
      pak2: { exists: false, sizeBytes: null, matchesRetailSize: false },
      verified: true,
      hasVideo: true,
      hasPlayers: true,
      ...inspection,
    } as RetailSourceInspection,
  }
}

interface CopyCall {
  sourceRoot: string
  targetRoot: string
  includeVideoAndPlayers: boolean
}

/**
 * Stands in for `copyRetailGameData`. Writes what [[088]]'s allowlist would produce for a
 * `store-copy` run into whatever `targetRoot` it is handed - **including `pak2.pak`**, on purpose:
 * this story's scope is paks-only-minus-pak2 (Decisions (Sprint)), and a fixture that only ever
 * stages the two files the job is allowed to promote could not tell "the job promotes exactly
 * pak0+pak1" from "the job promotes whatever it finds".
 */
function fakeCopy(
  calls: CopyCall[],
  options: { before?: () => Promise<void>; stage?: string[] } = {},
): RetailGameDataCopy {
  const stage = options.stage ?? ['pak0.pak', 'pak1.pak', 'pak2.pak']
  const sizes: Record<string, number> = {
    'pak0.pak': RETAIL_PAK0_BYTES,
    'pak1.pak': RETAIL_PAK1_BYTES,
    'pak2.pak': 8192,
  }
  return async (input): Promise<AssembleInstallationResult> => {
    calls.push(input)
    if (options.before) await options.before()
    const baseDir = join(input.targetRoot, BASE_GAME_DIR)
    await mkdir(baseDir, { recursive: true })
    for (const name of stage) {
      await writeFile(join(baseDir, name), '')
      await truncate(join(baseDir, name), sizes[name] ?? 1024)
    }
    return {
      copiedFiles: stage.map((name) => `${BASE_GAME_DIR}/${name}`),
      missingRequired: [],
      entries: [],
    }
  }
}

/**
 * Story 091 D4: the `LaunchHost` surface the real `InstallationWriteGuard` reads, with a setter the
 * test drives - "the game starts" and "the game exits" are `set(...)` calls that notify the guard's
 * observer exactly as `LaunchService.onStateChange` would.
 *
 * Mirrors `services/write-guard.test.ts`'s own `fakeLaunch`.
 */
function fakeLaunch(): { host: LaunchHost; set: (next: LaunchState) => void } {
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

/** Mirrors `pipeline.test.ts`'s helper - a job that waits has no promise to await. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

interface Harness {
  deps: RetailUpgradeDeps
  jobs: JobsService
  /** The launch state the write guard reads; `set()` is "the game started"/"the game exited". */
  launch: ReturnType<typeof fakeLaunch>
  installations: InstallationsService
  installation: Installation
  copyCalls: CopyCall[]
  snapshots: Job[][]
  /** How often the job asked main for its own detected-source list. */
  sourceListCalls: { count: number }
  validateCalls: string[]
}

async function harness(
  options: {
    sources?: DetectedRetailSource[]
    copy?: RetailGameDataCopy
    copyCalls?: CopyCall[]
    baseDirName?: string
  } = {},
): Promise<Harness> {
  await createDemoInstallation(options.baseDirName)

  const snapshots: Job[][] = []
  const jobs = new JobsService((list) => snapshots.push(list))
  const service = new InstallationsService({
    state: fakeState(),
    onChange: () => {},
    onSettingsChange: () => {},
  })

  const added = await service.addExisting({ rootPath: installRoot, source: 'manual' })
  if (!added.ok) throw new Error(`fixture installation was rejected: ${added.error.key}`)

  const validateCalls: string[] = []
  const installations = {
    find: (id: string) => service.find(id),
    validate: (id: string) => {
      validateCalls.push(id)
      return service.validate(id)
    },
  }

  const copyCalls = options.copyCalls ?? []
  const sourceListCalls = { count: 0 }
  const sources = options.sources ?? [detectedSource(sourceRoot)]

  const launch = fakeLaunch()

  return {
    deps: {
      jobs,
      installations,
      writeGuard: new InstallationWriteGuard({ launch: launch.host, jobs }),
      retailSources: () => {
        sourceListCalls.count += 1
        return Promise.resolve(sources)
      },
      copyGameData: options.copy ?? fakeCopy(copyCalls),
    },
    jobs,
    launch,
    installations: service,
    installation: added.value,
    copyCalls,
    snapshots,
    sourceListCalls,
    validateCalls,
  }
}

/** Every file under `root`, as `<relative path> -> <size>:<mtime>`. The comparison AC4 needs. */
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

describe('the retail upgrade job', () => {
  /**
   * Story 091 AC5's retrofit, and the one test that replaces [[090]]'s "refuses to start while that
   * installation is running". That refusal is gone on purpose (091's Decisions (Sprint)): one job
   * kind rejecting the user's action while every other job waits is the inconsistency 091 removes,
   * and 090's AC7 - "rather than overwriting files out from under a running game" - is satisfied
   * strictly better by a job that copies as soon as the game is closed.
   *
   * The three things that made the old refusal safe are still asserted here, just later: no copy is
   * started, no byte of the installation changes, and the user can see why.
   */
  it('the upgrade job waits instead of refusing, and holds the write lock while copying', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const copyCalls: CopyCall[] = []
    const test = await harness({ copyCalls, copy: fakeCopy(copyCalls, { before: () => gate }) })
    test.launch.set({ phase: 'running', installationId: test.installation.id, pid: 4242 })

    const before = await snapshotTree(installRoot)
    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })

    // There *is* a job now, where [[090]] answered a failed `Outcome` and created nothing.
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const job = (): Job => test.jobs.list().find((entry) => entry.id === started.value.jobId)!
    await waitFor(() => job().status === 'waiting', 'the job to enter the waiting state')

    // AC1/AC2: it names the reason, and nothing has been written or even copied.
    expect(job().waitingReason).toEqual({ key: 'jobs.waiting.gameRunning' })
    expect(job().writeLock).not.toBe(true)
    expect(test.copyCalls).toEqual([])
    expect(test.validateCalls).toEqual([])
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])

    // AC3: the game exits and the job resumes by itself - no user action anywhere in this test.
    test.launch.set({ phase: 'exited', installationId: test.installation.id, exitCode: 0 })
    await waitFor(() => test.copyCalls.length === 1, 'the copy to start once the game has exited')

    // AC5: while it copies it holds the write lock, which is what disables Play on the renderer.
    expect(job()).toMatchObject({ status: 'running', writeLock: true })
    expect(job().waitingReason).toBeUndefined()

    release()
    await expect(started.value.settled).resolves.toMatchObject({ status: 'succeeded' })

    // And it promoted exactly what it promotes without the guard - the retrofit changed when the
    // copy happens, not what it does.
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([
      'baseq2/pak0.pak',
      'baseq2/pak1.pak',
    ])
    expect(job()).toMatchObject({ status: 'succeeded', writeLock: false })
  })

  it('a game that is merely starting defers the write just as a running one does', async () => {
    const test = await harness()
    test.launch.set({ phase: 'starting', installationId: test.installation.id })

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    await waitFor(
      () => test.jobs.list()[0]?.status === 'waiting',
      'the job to wait on the starting game',
    )
    expect(test.copyCalls).toEqual([])

    // The source *was* re-listed on the way here: verification is a read, and reads are never
    // gated (AC4) - only the write into the installation's own folder waits.
    expect(test.sourceListCalls.count).toBe(1)

    test.launch.set(IDLE_LAUNCH_STATE)
    await expect(started.value.settled).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('runs while a different installation is running', async () => {
    const test = await harness()
    test.launch.set({ phase: 'running', installationId: 'some-other-installation' })

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('a source whose paks fail the retail check is rejected before anything is copied', async () => {
    const test = await harness({
      sources: [
        detectedSource(sourceRoot, {
          verified: false,
          unverifiedReason: 'bootstrap.retailSource.pak0SizeMismatch',
        }),
      ],
    })

    const before = await snapshotTree(installRoot)
    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })

    expect(started).toEqual({
      ok: false,
      error: {
        key: 'downloads.error.retailSourceUnverified',
        params: { reason: 'bootstrap.retailSource.pak0SizeMismatch' },
      },
    })
    expect(test.copyCalls).toEqual([])
    expect(test.jobs.list()).toEqual([])
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
  })

  it('a source main itself did not detect is rejected before anything is copied', async () => {
    const test = await harness({ sources: [detectedSource(join(dir, 'GOG', 'Quake 2'))] })

    const before = await snapshotTree(installRoot)
    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      // A path the renderer could name and main's own fresh list does not hold.
      sourceRootPath: sourceRoot,
    })

    expect(started).toEqual({
      ok: false,
      error: { key: 'downloads.error.retailSourceUnverified', params: { reason: 'notDetected' } },
    })
    expect(test.copyCalls).toEqual([])
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
  })

  it('refuses a source that is the installation being upgraded', async () => {
    const test = await harness({ sources: [detectedSource(installRoot)] })

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: installRoot,
    })

    expect(started).toEqual({
      ok: false,
      error: { key: 'downloads.error.retailSourceUnverified', params: { reason: 'targetOverlap' } },
    })
    expect(test.copyCalls).toEqual([])
  })

  it('only pak0.pak and pak1.pak are written, every other file in the installation is untouched', async () => {
    const test = await harness()
    const before = await snapshotTree(installRoot)

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({ status: 'succeeded' })

    const after = await snapshotTree(installRoot)
    expect(changedPaths(before, after)).toEqual(['baseq2/pak0.pak', 'baseq2/pak1.pak'])

    // The two paks are the real retail ones now, and they were replaced rather than appended to.
    expect((await stat(join(installRoot, BASE_GAME_DIR, 'pak0.pak'))).size).toBe(RETAIL_PAK0_BYTES)
    expect((await stat(join(installRoot, BASE_GAME_DIR, 'pak1.pak'))).size).toBe(RETAIL_PAK1_BYTES)

    // `pak2.pak` was staged by the copy and deliberately not promoted (Decisions (Sprint): paks
    // only, and only these two), and the extras were never even asked for.
    expect(after.has('baseq2/pak2.pak')).toBe(false)
    expect(test.copyCalls).toHaveLength(1)
    expect(test.copyCalls[0].sourceRoot).toBe(sourceRoot)
    expect(test.copyCalls[0].includeVideoAndPlayers).toBe(false)

    // The staging directory the copy was pointed at is inside the base dir and is gone again.
    expect(test.copyCalls[0].targetRoot.startsWith(join(installRoot, BASE_GAME_DIR))).toBe(true)
    const baseEntries = await readdir(join(installRoot, BASE_GAME_DIR))
    expect(baseEntries.filter((name) => name.startsWith('.q2launcher-upgrade'))).toEqual([])
  })

  it('writes into the base directory the inspector resolved, whatever its spelling', async () => {
    const test = await harness({ baseDirName: 'BASEQ2' })

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({ status: 'succeeded' })

    // No second, lowercase `baseq2` was created next to the real one, and the demo pak was
    // replaced in place under its own spelling rather than beside it.
    const rootEntries = await readdir(installRoot)
    expect(rootEntries.filter((name) => name.toLowerCase() === BASE_GAME_DIR)).toEqual(['BASEQ2'])
    expect((await stat(join(installRoot, 'BASEQ2', 'pak0.pak'))).size).toBe(RETAIL_PAK0_BYTES)
  })

  it('the status comes from InstallationsService.validate(), never hand-set', async () => {
    const test = await harness()

    // Before: the library agrees with the inspector that this is demo data.
    expect(test.installation.status).toBe('ok')
    expect(test.installation.checks.map((check) => check.messageKey)).toContain(
      'validation.pak0NotRetail',
    )

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    // The job re-derived the verdict exactly once, through the service.
    expect(test.validateCalls).toEqual([test.installation.id])

    // Re-inspected independently here: what the library now holds has to be what the inspector
    // says about the folder as it now is - not a status this job chose. The distinction is
    // visible rather than theoretical: the fixture has no `pak2.pak`, so the honest verdict is
    // `warning`/`retailPaksMissing`, which no hand-set "the upgrade worked" status would produce.
    const fresh = await inspectInstallation(installRoot)
    const stored = test.installations.find(test.installation.id)
    expect(stored?.status).toBe(fresh.status)
    expect(stored?.checks.map((check) => check.messageKey)).toEqual(
      fresh.checks.map((check) => check.messageKey),
    )
    expect(stored?.status).toBe('warning')
    expect(stored?.checks.map((check) => check.messageKey)).toContain(
      'validation.retailPaksMissing',
    )
    // AC5's own wording: the demo check is gone because the files changed, not because anything
    // cleared a flag.
    expect(stored?.checks.map((check) => check.messageKey)).not.toContain(
      'validation.pak0NotRetail',
    )
    expect(outcome).toEqual({ status: 'succeeded', installationStatus: 'warning' })
    // `Installation.source` is nobody's business here (Decisions (Refine): "no new state").
    expect(stored?.source).toBe('manual')
  })

  it('runs as a cancellable downloads job scoped to that installation', async () => {
    const test = await harness()

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await started.value.settled

    const job = test.jobs.list().find((entry) => entry.id === started.value.jobId)
    expect(job).toMatchObject({
      moduleId: 'downloads',
      kind: RETAIL_UPGRADE_JOB_KIND,
      labelKey: 'downloads.job.retailUpgrade',
      labelParams: { name: test.installation.name },
      installationId: test.installation.id,
      cancellable: true,
      status: 'succeeded',
    })
    expect(job?.progress.ratio).toBe(1)
  })

  it('a cancel before the rename leaves the installation exactly as it was', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const copyCalls: CopyCall[] = []
    const test = await harness({
      copyCalls,
      copy: fakeCopy(copyCalls, { before: () => gate }),
    })
    const before = await snapshotTree(installRoot)

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(test.jobs.cancel(started.value.jobId).ok).toBe(true)
    release()
    await expect(started.value.settled).resolves.toEqual({ status: 'cancelled' })

    // The demo files are untouched, the staged copy is gone, and no status was re-derived for a
    // folder that never changed.
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    expect(test.validateCalls).toEqual([])
    expect(test.jobs.list()[0].status).toBe('cancelled')
  })

  /**
   * Story 091 AC6, written as a deliberate structural sibling of the mid-copy cancel above: the
   * same `jobs.cancel()`, the same `settled` outcome, the same three assertions about the disk and
   * the job. That is the point - waiting is not a special case for cancel, so the test for it may
   * not need a special case either.
   *
   * The two extra assertions at the end are the failure mode this deliverable exists to rule out: a
   * cancel that only reached the checkpoints and not the guard's wait would leave the job parked in
   * `runWrite` forever, and the *next* launch-state change would then start copying 197 MB into an
   * installation whose job the user cancelled minutes ago.
   */
  it('cancelling while waiting runs the same cleanup as cancelling mid-copy', async () => {
    const copyCalls: CopyCall[] = []
    const test = await harness({ copyCalls })
    test.launch.set({ phase: 'running', installationId: test.installation.id, pid: 4242 })
    const before = await snapshotTree(installRoot)

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await waitFor(() => test.jobs.list()[0]?.status === 'waiting', 'the job to enter waiting')

    expect(test.jobs.cancel(started.value.jobId).ok).toBe(true)
    await expect(started.value.settled).resolves.toEqual({ status: 'cancelled' })

    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    expect(test.validateCalls).toEqual([])
    expect(test.jobs.list()[0].status).toBe('cancelled')

    // The staging directory is the one thing `changedPaths` cannot see (it compares files, and an
    // abandoned staging root can be empty), so it is checked directly - this is exactly what the
    // shared `finally` is for, and it ran even though the write never started.
    const baseEntries = await readdir(join(installRoot, BASE_GAME_DIR))
    expect(baseEntries.filter((name) => name.startsWith('.q2launcher-upgrade'))).toEqual([])

    // And the cancelled job is really gone from the guard: the game exiting resumes nothing.
    test.launch.set(IDLE_LAUNCH_STATE)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(test.copyCalls).toEqual([])
    expect(test.jobs.list()[0].status).toBe('cancelled')
  })

  it('fails the job when the copy no longer produces the required paks', async () => {
    const copyCalls: CopyCall[] = []
    const test = await harness({ copyCalls, copy: fakeCopy(copyCalls, { stage: ['pak0.pak'] }) })
    const before = await snapshotTree(installRoot)

    const started = await startRetailUpgrade(test.deps, {
      installationId: test.installation.id,
      sourceRootPath: sourceRoot,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toEqual({
      status: 'failed',
      key: 'downloads.error.retailCopyIncomplete',
    })

    // Nothing is promoted unless *both* paks are staged - a half-applied upgrade is the state this
    // job exists to make impossible.
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    expect(test.jobs.list()[0]).toMatchObject({
      status: 'failed',
      error: { key: 'downloads.error.retailCopyIncomplete' },
    })
  })

  it('refuses an installation the library no longer holds', async () => {
    const test = await harness()

    const started = await startRetailUpgrade(test.deps, {
      installationId: 'gone',
      sourceRootPath: sourceRoot,
    })

    expect(started).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
    expect(test.jobs.list()).toEqual([])
    expect(test.sourceListCalls.count).toBe(0)
  })
})
