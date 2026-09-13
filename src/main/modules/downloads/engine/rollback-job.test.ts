import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BASE_GAME_DIR } from '@shared/constants'
import {
  IDLE_LAUNCH_STATE,
  type Installation,
  type Job,
  type LaunchState,
  type LauncherSettings,
} from '@shared/types'
import { InstallationsService } from '../../../services/installations'
import { JobsService } from '../../../services/jobs'
import type { StateStore } from '../../../services/state'
import { InstallationWriteGuard, type LaunchHost } from '../../../services/write-guard'
import { readEngineState } from './installation-state'
import { ENGINE_BACKUP_DIR_NAME } from './update-job'
import { ENGINE_ROLLBACK_JOB_KIND, startEngineRollback, type EngineRollbackDeps } from './rollback-job'

/**
 * Story 092 D6. Mirrors `update-job.test.ts`'s own approach: a real `InstallationsService`, a real
 * inspector and real files on a temp disk, and a real write guard driven by a fake `LaunchHost` - the
 * assertions here are statements about actual bytes, not about calls a mock recorded. There is
 * nothing to fake for the restore itself (no download, no manifest, no extractor), which is the
 * point of this job being this small.
 */

/** What the backup slot holds - the build a rollback restores. */
const BACKED_UP_FILES: Record<string, string> = {
  'q2pro.exe': 'old engine binary',
  [`${BASE_GAME_DIR}/gamex86_64.dll`]: 'old game module',
  [`${BASE_GAME_DIR}/q2pro.menu`]: 'old menu',
}

/** What is currently installed - the build a rollback replaces. */
const CURRENT_FILES: Record<string, string> = {
  'q2pro.exe': 'new engine binary 2.0',
  [`${BASE_GAME_DIR}/gamex86_64.dll`]: 'new game module 2.0',
  [`${BASE_GAME_DIR}/q2pro.menu`]: 'new menu 2.0',
}

/** Files a rollback may never touch - game data and the user's own leftovers. */
const UNRELATED_FILES: Record<string, string> = {
  [`${BASE_GAME_DIR}/pak0.pak`]: 'game data',
  [`${BASE_GAME_DIR}/config.cfg`]: 'bind w +forward',
  'q2launcher-marker.txt': 'do not touch me',
}

let dir: string
let installRoot: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-engine-rollback-')))
  installRoot = join(dir, 'Quake II')
})

afterEach(async () => {
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

interface Harness {
  deps: EngineRollbackDeps
  jobs: JobsService
  launch: ReturnType<typeof fakeLaunch>
  installations: InstallationsService
  installation: Installation
  validateCalls: string[]
}

async function harness(options: { withBackup?: boolean } = {}): Promise<Harness> {
  const withBackup = options.withBackup ?? true

  await writeTree(installRoot, { ...CURRENT_FILES, ...UNRELATED_FILES })
  if (withBackup) {
    await writeTree(join(installRoot, ENGINE_BACKUP_DIR_NAME), BACKED_UP_FILES)
  }

  const jobs = new JobsService(() => {})
  const service = new InstallationsService({
    state: fakeState(),
    onChange: () => {},
    onSettingsChange: () => {},
  })

  const added = await service.addExisting({ rootPath: installRoot, source: 'manual' })
  if (!added.ok) throw new Error(`fixture installation was rejected: ${added.error.key}`)

  const recorded = service.setEngineState(added.value.id, {
    version: '2.0',
    packageId: 'q2pro-2.0',
    ...(withBackup
      ? { backup: { version: '1.0', packageId: 'q2pro-1.0', createdAt: Date.now() } }
      : {}),
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

  const launch = fakeLaunch()
  const guard = new InstallationWriteGuard({ launch: launch.host, jobs })

  return {
    deps: {
      jobs,
      installations,
      writeGuard: {
        runWrite: (installationId, jobId, signal, fn) =>
          guard.runWrite(installationId, jobId, signal, fn),
      },
    },
    jobs,
    launch,
    installations: service,
    installation: recorded.value,
    validateCalls,
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

describe('the engine rollback job', () => {
  it('restores the backed-up build byte for byte, with no fetch/network call made', async () => {
    const test = await harness()
    const before = await snapshotTree(installRoot)

    const started = await startEngineRollback(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await expect(started.value.settled).resolves.toMatchObject({
      status: 'succeeded',
      version: '1.0',
    })

    // The backed-up bytes are back in place...
    for (const [relativePath, content] of Object.entries(BACKED_UP_FILES)) {
      expect(await contentsOf(installRoot, relativePath)).toBe(content)
    }
    // ...the backup slot is gone...
    expect(existsSync(join(installRoot, ENGINE_BACKUP_DIR_NAME))).toBe(false)
    // ...and nothing outside the engine files moved.
    for (const [relativePath, content] of Object.entries(UNRELATED_FILES)) {
      expect(await contentsOf(installRoot, relativePath)).toBe(content)
    }
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([
      `${BASE_GAME_DIR}/gamex86_64.dll`,
      `${BASE_GAME_DIR}/q2pro.menu`,
      'q2pro.exe',
      `removed:${ENGINE_BACKUP_DIR_NAME}/${BASE_GAME_DIR}/gamex86_64.dll`,
      `removed:${ENGINE_BACKUP_DIR_NAME}/${BASE_GAME_DIR}/q2pro.menu`,
      `removed:${ENGINE_BACKUP_DIR_NAME}/q2pro.exe`,
    ])

    expect(test.validateCalls).toEqual([test.installation.id])
    const job = test.jobs.list().find((entry) => entry.id === started.value.jobId)
    expect(job).toMatchObject({
      moduleId: 'downloads',
      kind: ENGINE_ROLLBACK_JOB_KIND,
      installationId: test.installation.id,
      cancellable: true,
      status: 'succeeded',
      writeLock: false,
    })
  })

  it('refuses with engineNoBackup when there is no recorded backup, before any job exists', async () => {
    const test = await harness({ withBackup: false })
    const before = await snapshotTree(installRoot)

    const started = await startEngineRollback(test.deps, { installationId: test.installation.id })

    expect(started).toEqual({ ok: false, error: { key: 'downloads.error.engineNoBackup' } })
    expect(test.jobs.list()).toEqual([])
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
  })

  it('refuses an installation the library no longer holds', async () => {
    const test = await harness()

    const started = await startEngineRollback(test.deps, { installationId: 'gone' })

    expect(started).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
    expect(test.jobs.list()).toEqual([])
  })

  it('the recorded version afterwards is the backed-up one', async () => {
    const test = await harness()

    const started = await startEngineRollback(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await started.value.settled

    const stored = test.installations.find(test.installation.id)
    expect(stored?.detectedVersion).toBe('1.0')
    const state = readEngineState(stored?.moduleData)
    expect(state.version).toBe('1.0')
    expect(state.packageId).toBe('q2pro-1.0')
    expect(state.backup).toBeUndefined()
  })

  it('the rollback waits while the game is running and continues once it exits', async () => {
    const test = await harness()
    test.launch.set({ phase: 'running', installationId: test.installation.id, pid: 4242 })
    const before = await snapshotTree(installRoot)

    const started = await startEngineRollback(test.deps, { installationId: test.installation.id })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const job = (): Job => test.jobs.list().find((entry) => entry.id === started.value.jobId)!
    await waitFor(() => job().status === 'waiting', 'the job to enter the waiting state')

    // Nothing has moved yet - the write is still deferred.
    expect(job().waitingReason).toEqual({ key: 'jobs.waiting.gameRunning' })
    expect(changedPaths(before, await snapshotTree(installRoot))).toEqual([])
    expect(existsSync(join(installRoot, ENGINE_BACKUP_DIR_NAME))).toBe(true)

    // The game exits and the job resumes by itself - no user action anywhere in this test.
    test.launch.set({ phase: 'exited', installationId: test.installation.id, exitCode: 0 })
    await expect(started.value.settled).resolves.toMatchObject({ status: 'succeeded' })
    expect(await contentsOf(installRoot, 'q2pro.exe')).toBe(BACKED_UP_FILES['q2pro.exe'])
  })
})
