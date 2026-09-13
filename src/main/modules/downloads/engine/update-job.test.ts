import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BASE_GAME_DIR } from '@shared/constants'
import type { EngineBackupInfo, ManifestPackage } from '@shared/modules/downloads'
import {
  IDLE_LAUNCH_STATE,
  ok,
  type Installation,
  type Job,
  type LaunchState,
  type LauncherSettings,
} from '@shared/types'
import { InstallationsService } from '../../../services/installations'
import { JobsService } from '../../../services/jobs'
import type { StateStore } from '../../../services/state'
import { InstallationWriteGuard, type LaunchHost } from '../../../services/write-guard'
import type { Extractor, ManifestSource } from '../bootstrap/ports'
import type { ExtractorHandle } from '../extractor'
import { readEngineState } from './installation-state'
import {
  ENGINE_BACKUP_DIR_NAME,
  ENGINE_UPDATE_JOB_KIND,
  startEngineUpdate,
  type EngineArchiveDownload,
  type EngineUpdateDeps,
} from './update-job'

/**
 * Story 092 D5. What this job has to get right is a *file-move ordering* on a real, playable
 * installation (AC8), so this suite is deliberately life-size where that ordering lives and faked
 * only outside it:
 *
 *  - **real installations service, real inspector, real files on disk.** Every assertion below about
 *    "the installation is untouched" / "the old files are in the backup" is a statement about actual
 *    bytes in a temp directory, not about calls a mock recorded.
 *  - **real write guard** (`InstallationWriteGuard`, driven by a fake `LaunchHost`), for the reason
 *    `retail/upgrade-job.test.ts` gives: a stubbed guard that simply called its callback would keep
 *    this suite green with the AC6 wiring missing entirely.
 *  - **fake download and fake extractor**, because "does the archive verify" is `verify.ts`'s job and
 *    "does 7za unpack" is `extractor.ts`'s - both already tested there, and neither is what a
 *    half-replaced installation would come from.
 *
 * The `beforeWrite` hook on the harness is how the copy-phase failure (AC8's second half) is
 * provoked: it runs *inside* `runWrite`, before the job's own swap, which is the only moment at
 * which the staging tree can be sabotaged after the completeness check has already passed.
 *
 * Two of the failures below happen *between* two of the job's own file operations, where no hook
 * can reach: a move-back that fails during the restore, and a slot that cannot be recreated after
 * the previous one has already been deleted. Those are injected at the filesystem itself
 * (`fsFailures` below) rather than faked one level up, so everything around the injected call -
 * including which files really are left on disk afterwards - stays the real thing.
 */

/**
 * Paths whose `rename`/`mkdir` must fail with `EPERM`, the shape Windows reports for a file an
 * antivirus scanner or a running process still holds. Empty by default, so every other test in this
 * file goes to the real filesystem untouched.
 */
const fsFailures = vi.hoisted(() => ({ rename: new Set<string>(), mkdir: new Set<string>() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const denied = (operation: string, path: string): NodeJS.ErrnoException => {
    const error = new Error(
      `EPERM: operation not permitted, ${operation} '${path}'`,
    ) as NodeJS.ErrnoException
    error.code = 'EPERM'
    return error
  }
  const patched = {
    ...actual,
    rename: (async (from: unknown, to: unknown) => {
      if (fsFailures.rename.has(String(from))) throw denied('rename', String(from))
      return actual.rename(from as string, to as string)
    }) as unknown as typeof actual.rename,
    mkdir: (async (path: unknown, options: unknown) => {
      if (fsFailures.mkdir.has(String(path))) throw denied('mkdir', String(path))
      return actual.mkdir(path as string, options as { recursive: true })
    }) as unknown as typeof actual.mkdir,
  }
  return { ...patched, default: patched }
})

/** What the fixture installation has on disk before the update. */
const OLD_FILES: Record<string, string> = {
  'q2pro.exe': 'old engine binary',
  [`${BASE_GAME_DIR}/gamex86_64.dll`]: 'old game module',
  [`${BASE_GAME_DIR}/q2pro.menu`]: 'old menu',
}

/** What the fake extractor stages, i.e. what the update is supposed to install. */
const NEW_FILES: Record<string, string> = {
  'q2pro.exe': 'new engine binary 2.0',
  [`${BASE_GAME_DIR}/gamex86_64.dll`]: 'new game module 2.0',
  [`${BASE_GAME_DIR}/q2pro.menu`]: 'new menu 2.0',
}

/** Files the update may never touch - game data and the user's own leftovers. */
const UNRELATED_FILES: Record<string, string> = {
  [`${BASE_GAME_DIR}/pak0.pak`]: 'game data',
  [`${BASE_GAME_DIR}/config.cfg`]: 'bind w +forward',
  'q2launcher-marker.txt': 'do not touch me',
}

const PINNED_PACKAGE: ManifestPackage = {
  kind: 'engine',
  engine: 'q2pro',
  id: 'q2pro-2.0',
  version: '2.0',
  sizeBytes: 4096,
  sha256: 'a'.repeat(64),
  url: 'https://content.example.test/engines/q2pro-2.0.zip',
  mirrors: [],
  contents: [],
}

let dir: string
let installRoot: string
let userDataPath: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-engine-update-')))
  installRoot = join(dir, 'Quake II')
  userDataPath = join(dir, 'userData')
  await mkdir(userDataPath, { recursive: true })
})

afterEach(async () => {
  fsFailures.rename.clear()
  fsFailures.mkdir.clear()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
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

/** Mirrors `services/write-guard.test.ts`'s own `fakeLaunch`. */
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

/** A download that produces nothing but a path - the archive itself is the extractor fake's fiction. */
function fakeDownload(): EngineArchiveDownload {
  return async ({ userDataPath: cache, target }) => {
    const path = join(cache, target.fileName)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'archive')
    return { ok: true, path }
  }
}

/** Writes `staged` into the extract dir, exactly as 7za would have unpacked the real archive. */
function fakeExtractor(staged: Record<string, string>): Extractor {
  return {
    extract: ({ extractDir }): ExtractorHandle => ({
      result: (async () => {
        await writeTree(extractDir, staged)
        return ok(undefined)
      })(),
      kill: () => {},
    }),
  }
}

interface Harness {
  deps: EngineUpdateDeps
  jobs: JobsService
  launch: ReturnType<typeof fakeLaunch>
  installations: InstallationsService
  installation: Installation
  validateCalls: string[]
  /** The staging directory the job extracted into, captured for the sabotage hook. */
  extractDirs: string[]
}

async function harness(
  options: {
    staged?: Record<string, string>
    download?: EngineArchiveDownload
    /** Runs inside `runWrite`, before the job's own swap - see the suite comment. */
    beforeWrite?: (extractDir: string) => Promise<void>
    /** The version the installation has on record before the update; `undefined` means none. */
    recordedVersion?: string
    /** A backup this installation already carries - both the recorded pointer and a real slot on
     * disk, so a test can prove what a failed run does to *both* of them. */
    recordedBackup?: EngineBackupInfo
  } = {},
): Promise<Harness> {
  await writeTree(installRoot, { ...OLD_FILES, ...UNRELATED_FILES })

  const jobs = new JobsService(() => {})
  const service = new InstallationsService({
    state: fakeState(),
    onChange: () => {},
    onSettingsChange: () => {},
  })

  const added = await service.addExisting({ rootPath: installRoot, source: 'manual' })
  if (!added.ok) throw new Error(`fixture installation was rejected: ${added.error.key}`)
  if (added.value.engineKind !== 'q2pro') {
    throw new Error(`fixture installation was detected as ${added.value.engineKind}`)
  }

  if (options.recordedBackup) {
    await writeTree(join(installRoot, ENGINE_BACKUP_DIR_NAME), {
      'q2pro.exe': `engine ${options.recordedBackup.version}`,
    })
  }
  const recordedVersion = options.recordedVersion ?? '1.0'
  const recorded = service.setEngineState(added.value.id, {
    version: recordedVersion,
    packageId: `q2pro-${recordedVersion}`,
    ...(options.recordedBackup ? { backup: options.recordedBackup } : {}),
  })
  if (!recorded.ok) throw new Error('the fixture engine state could not be recorded')

  const validateCalls: string[] = []
  const installations = {
    find: (id: string) => service.find(id),
    validate: (id: string) => {
      validateCalls.push(id)
      return service.validate(id)
    },
    setEngineState: (id: string, patch: Parameters<InstallationsService['setEngineState']>[1]) =>
      service.setEngineState(id, patch),
  }

  const manifest: ManifestSource = {
    resolveEnginePackage: (engine) =>
      Promise.resolve(engine === 'q2pro' ? PINNED_PACKAGE : undefined),
    resolveGameDataPackage: () => Promise.resolve(undefined),
  }

  const launch = fakeLaunch()
  const guard = new InstallationWriteGuard({ launch: launch.host, jobs })
  const extractDirs: string[] = []
  const inner = fakeExtractor(options.staged ?? NEW_FILES)

  return {
    deps: {
      jobs,
      installations,
      writeGuard: {
        runWrite: (installationId, jobId, signal, fn) =>
          guard.runWrite(installationId, jobId, signal, async () => {
            if (options.beforeWrite) await options.beforeWrite(extractDirs[0])
            await fn()
          }),
      },
      manifest,
      extractor: {
        extract: (input) => {
          extractDirs.push(input.extractDir)
          return inner.extract(input)
        },
      },
      userDataPath,
      resolveExtractor: () => ({ path: join(dir, '7za.exe'), exists: true }),
      download: options.download ?? fakeDownload(),
    },
    jobs,
    launch,
    installations: service,
    installation: recorded.value,
    validateCalls,
    extractDirs,
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

async function contentsOf(root: string, relativePath: string): Promise<string> {
  return readFile(join(root, relativePath), 'utf8')
}

describe('the engine update job', () => {
  it('a successful update replaces the engine files and keeps the previous ones in the backup', async () => {
    const test = await harness()
    const before = await snapshotTree(installRoot)

    const started = await startEngineUpdate(test.deps, {
      installationId: test.installation.id,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({
      status: 'succeeded',
      version: '2.0',
    })

    // AC2: the new bytes are in place, under the allowlisted paths and nowhere else.
    for (const [relativePath, content] of Object.entries(NEW_FILES)) {
      expect(await contentsOf(installRoot, relativePath)).toBe(content)
    }
    // ...and the previous ones are in the one backup slot, byte for byte.
    for (const [relativePath, content] of Object.entries(OLD_FILES)) {
      expect(await contentsOf(installRoot, join(ENGINE_BACKUP_DIR_NAME, relativePath))).toBe(content)
    }
    // Nothing outside the engine allowlist moved - not the game data, not the user's own files.
    for (const [relativePath, content] of Object.entries(UNRELATED_FILES)) {
      expect(await contentsOf(installRoot, relativePath)).toBe(content)
    }
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([
      `${ENGINE_BACKUP_DIR_NAME}/${BASE_GAME_DIR}/gamex86_64.dll`,
      `${ENGINE_BACKUP_DIR_NAME}/${BASE_GAME_DIR}/q2pro.menu`,
      `${ENGINE_BACKUP_DIR_NAME}/q2pro.exe`,
      `${BASE_GAME_DIR}/gamex86_64.dll`,
      `${BASE_GAME_DIR}/q2pro.menu`,
      'q2pro.exe',
    ])

    // The staging tree is gone, and it never lived inside the installation to begin with.
    expect(test.extractDirs).toHaveLength(1)
    expect(test.extractDirs[0].startsWith(installRoot)).toBe(false)
    expect(existsSync(test.extractDirs[0])).toBe(false)

    // The status is the inspector's, asked for exactly once.
    expect(test.validateCalls).toEqual([test.installation.id])
    const job = test.jobs.list().find((entry) => entry.id === started.value.jobId)
    expect(job).toMatchObject({
      moduleId: 'downloads',
      kind: ENGINE_UPDATE_JOB_KIND,
      installationId: test.installation.id,
      cancellable: true,
      status: 'succeeded',
      writeLock: false,
    })
  })

  it('the recorded engine version afterwards is the one written to disk', async () => {
    const test = await harness()

    const started = await startEngineUpdate(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await started.value.settled

    // AC7: `moduleData` and the mirrored `detectedVersion` both say 2.0, and the backup slot is
    // advertised as holding exactly the version that was replaced.
    const stored = test.installations.find(test.installation.id)
    expect(stored?.detectedVersion).toBe('2.0')
    const state = readEngineState(stored?.moduleData)
    expect(state.version).toBe('2.0')
    expect(state.packageId).toBe('q2pro-2.0')
    expect(state.backup).toMatchObject({ version: '1.0', packageId: 'q2pro-1.0' })
    expect(typeof state.backup?.createdAt).toBe('number')
  })

  it('a verification failure leaves every engine file untouched and creates no backup', async () => {
    const failingDownload: EngineArchiveDownload = () =>
      Promise.resolve({
        ok: false,
        key: 'downloads.error.verificationFailed',
        reason: 'sha256: expected a..., got b...',
        cancelled: false,
      })
    const test = await harness({ download: failingDownload })
    const before = await snapshotTree(installRoot)

    const started = await startEngineUpdate(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toEqual({
      status: 'failed',
      key: 'downloads.error.verificationFailed',
    })

    // AC8: nothing inside the installation was touched before verification passed - which includes
    // the backup directory never coming into existence.
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    expect(existsSync(join(installRoot, ENGINE_BACKUP_DIR_NAME))).toBe(false)
    expect(readEngineState(test.installations.find(test.installation.id)?.moduleData).version).toBe(
      '1.0',
    )
    expect(test.validateCalls).toEqual([])
  })

  it('a failure during the copy restores the backup, leaving a complete previous engine', async () => {
    // Sabotage after the completeness check has passed and inside the write phase: the second
    // engine file disappears from staging, so its `cp` fails once the first one has already been
    // backed up *and* overwritten - exactly the half-replaced state AC8 forbids.
    const test = await harness({
      beforeWrite: async (extractDir) => {
        await rm(join(extractDir, BASE_GAME_DIR, 'gamex86_64.dll'), { force: true })
      },
    })
    const before = await snapshotTree(installRoot)

    const started = await startEngineUpdate(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toEqual({
      status: 'failed',
      key: 'downloads.error.engineReplaceFailed',
    })

    // Every engine file is the previous one again, and the emptied slot is gone with its pointer -
    // an installation that is complete and consistent, not a mix of 1.0 and 2.0.
    for (const [relativePath, content] of Object.entries(OLD_FILES)) {
      expect(await contentsOf(installRoot, relativePath)).toBe(content)
    }
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    expect(existsSync(join(installRoot, ENGINE_BACKUP_DIR_NAME))).toBe(false)

    const state = readEngineState(test.installations.find(test.installation.id)?.moduleData)
    expect(state.version).toBe('1.0')
    expect(state.backup).toBeUndefined()
  })

  it('the write phase waits while the game is running and continues once it exits', async () => {
    const test = await harness()
    test.launch.set({ phase: 'running', installationId: test.installation.id, pid: 4242 })
    const before = await snapshotTree(installRoot)

    const started = await startEngineUpdate(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const job = (): Job => test.jobs.list().find((entry) => entry.id === started.value.jobId)!
    await waitFor(() => job().status === 'waiting', 'the job to enter the waiting state')

    // AC6: the download and the extraction happened - reads are never gated - but not one byte of
    // the installation has changed, and there is no backup slot yet.
    expect(job().waitingReason).toEqual({ key: 'jobs.waiting.gameRunning' })
    expect(test.extractDirs).toHaveLength(1)
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    expect(existsSync(join(installRoot, ENGINE_BACKUP_DIR_NAME))).toBe(false)

    // The game exits and the job resumes by itself - no user action anywhere in this test.
    test.launch.set({ phase: 'exited', installationId: test.installation.id, exitCode: 0 })
    await expect(started.value.settled).resolves.toMatchObject({ status: 'succeeded' })
    expect(await contentsOf(installRoot, 'q2pro.exe')).toBe(NEW_FILES['q2pro.exe'])
  })

  it('refuses an installation that is already on the pinned version, before any job exists', async () => {
    const test = await harness({ recordedVersion: '2.0' })

    const started = await startEngineUpdate(test.deps, { installationId: test.installation.id })

    expect(started).toEqual({
      ok: false,
      error: { key: 'downloads.error.engineUpdateUnavailable' },
    })
    expect(test.jobs.list()).toEqual([])
    expect(existsSync(join(installRoot, ENGINE_BACKUP_DIR_NAME))).toBe(false)
  })

  it('refuses an installation the library no longer holds', async () => {
    const test = await harness()

    const started = await startEngineUpdate(test.deps, { installationId: 'gone' })

    expect(started).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
    expect(test.jobs.list()).toEqual([])
  })

  /**
   * The half-restored case: the copy fails (as in the test above), but this time one of the
   * move-backs fails too. Deleting the slot here would take the *only* remaining copy of that file
   * with it - the installation would be missing it and so would the backup, which is strictly worse
   * than the half-replaced state AC8 forbids.
   */
  it('a restore that cannot put a file back keeps the backup rather than deleting the only copy left', async () => {
    const test = await harness({
      beforeWrite: async (extractDir) => {
        await rm(join(extractDir, BASE_GAME_DIR, 'gamex86_64.dll'), { force: true })
      },
    })
    // The move-back of the first (already replaced) file is refused, the way a locked binary would.
    fsFailures.rename.add(join(installRoot, ENGINE_BACKUP_DIR_NAME, 'q2pro.exe'))

    const started = await startEngineUpdate(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toEqual({
      status: 'failed',
      key: 'downloads.error.engineReplaceFailed',
    })

    // The file that could not go back is still in the backup, byte for byte - nothing was destroyed.
    expect(await contentsOf(installRoot, join(ENGINE_BACKUP_DIR_NAME, 'q2pro.exe'))).toBe(
      OLD_FILES['q2pro.exe'],
    )
    // The two that could go back did, and are gone from the slot.
    for (const relativePath of [`${BASE_GAME_DIR}/gamex86_64.dll`, `${BASE_GAME_DIR}/q2pro.menu`]) {
      expect(await contentsOf(installRoot, relativePath)).toBe(OLD_FILES[relativePath])
      expect(existsSync(join(installRoot, ENGINE_BACKUP_DIR_NAME, relativePath))).toBe(false)
    }

    // The slot is partial, so it is not advertised as a rollback target: a later rollback answers
    // `engineNoBackup` instead of restoring half a version over the installation.
    const state = readEngineState(test.installations.find(test.installation.id)?.moduleData)
    expect(state.version).toBe('1.0')
    expect(state.backup).toBeUndefined()
  })

  /**
   * AC7/AC8: the recorded pointer may never describe a slot that is no longer there. The failure
   * injected here is the one that hits between the two - the previous slot has already been deleted
   * when creating the new one is refused - so the pointer has to have been cleared beforehand.
   */
  it('a failure right after the previous backup slot is emptied leaves no stale backup pointer', async () => {
    const test = await harness({ recordedBackup: { version: '0.9', createdAt: 1 } })
    const backupDir = join(installRoot, ENGINE_BACKUP_DIR_NAME)
    fsFailures.mkdir.add(backupDir)

    const started = await startEngineUpdate(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toEqual({
      status: 'failed',
      key: 'downloads.error.engineReplaceFailed',
    })

    // The old slot is gone (that is the whole point of the injected failure) and the record says so.
    expect(existsSync(backupDir)).toBe(false)
    const state = readEngineState(test.installations.find(test.installation.id)?.moduleData)
    expect(state.backup).toBeUndefined()
    expect(state.version).toBe('1.0')
    // And no engine file moved: the run failed before the first backup move.
    for (const [relativePath, content] of Object.entries(OLD_FILES)) {
      expect(await contentsOf(installRoot, relativePath)).toBe(content)
    }
  })

  /**
   * `buildAssemblePlan` marks `baseq2/q2pro.menu` `required: false`, and the backup set is what the
   * archive actually staged - so an archive that does not ship the optional file must leave the
   * installation's own copy exactly where it is, rather than moving it into the backup (which would
   * make an update silently *delete* a file it cannot replace).
   */
  it('an archive without the optional menu file leaves the installation copy in place', async () => {
    const test = await harness({
      staged: {
        'q2pro.exe': NEW_FILES['q2pro.exe'],
        [`${BASE_GAME_DIR}/gamex86_64.dll`]: NEW_FILES[`${BASE_GAME_DIR}/gamex86_64.dll`],
      },
    })

    const started = await startEngineUpdate(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({ status: 'succeeded' })

    // The optional file is untouched - still the installation's own, and not in the backup either.
    const menu = `${BASE_GAME_DIR}/q2pro.menu`
    expect(await contentsOf(installRoot, menu)).toBe(OLD_FILES[menu])
    expect(existsSync(join(installRoot, ENGINE_BACKUP_DIR_NAME, menu))).toBe(false)
    // The two files the archive does ship were replaced and backed up as usual.
    expect(await contentsOf(installRoot, 'q2pro.exe')).toBe(NEW_FILES['q2pro.exe'])
    expect(await contentsOf(installRoot, join(ENGINE_BACKUP_DIR_NAME, 'q2pro.exe'))).toBe(
      OLD_FILES['q2pro.exe'],
    )
  })

  it('a required engine file missing from the archive fails before anything is backed up', async () => {
    const test = await harness({
      staged: { 'q2pro.exe': NEW_FILES['q2pro.exe'] },
    })
    const before = await snapshotTree(installRoot)

    const started = await startEngineUpdate(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toEqual({
      status: 'failed',
      key: 'downloads.error.packageIncomplete',
    })

    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    expect(existsSync(join(installRoot, ENGINE_BACKUP_DIR_NAME))).toBe(false)
  })
})
