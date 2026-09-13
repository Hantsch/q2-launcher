import { describe, expect, it, vi } from 'vitest'
import type { Job, UpdateDownloadProgress, UpdateState } from '@shared/types'
import type { UpdateCheckStoreData } from './store'
import {
  APP_UPDATE_ERROR_KEYS,
  createUpdateService,
  type UpdateBackend,
  type UpdateCheckOutcome,
  type UpdateDownloadOutcome,
} from './service'
// A static import, not a runtime `fs.readFile`: mirrors `src/shared/config/comment-labels.test.ts`
// (story 040 D1) - `tsconfig.node.json` lists this one renderer data file explicitly so `tsc`
// accepts the cross-project import here too (see the comment there).
import en from '../../../renderer/src/i18n/locales/en.json'

/**
 * Story 098 D1 acceptance tests: the staged actions and the restart guard. Split from
 * `service.test.ts` (097's check suite) because these drive a different half of the same service -
 * the acceptance list in `docs/requirements/098-i-update-when-i-choose-to.md` calls this file
 * `app-update.test.ts`; the code it tests is 097's `update/service.ts` (the story's own Decision:
 * "the new channels extend 097's update domain, service and state type rather than adding a
 * second one"), so the test sits next to it under that file's name.
 *
 * Everything is injected: the checker, the backend, the store, `now`, and the two guard inputs.
 * Nothing here loads Electron, `electron-updater` or the network - but every assertion goes through
 * the *real* service methods, so a guard that stops working fails these tests.
 */

const KNOWN_UPDATE = {
  version: '1.1.0',
  notes: 'Fixed the thing.',
  releasedAt: '2026-09-12T10:00:00.000Z',
}

const available = async (): Promise<UpdateCheckOutcome> => ({
  ok: true,
  available: true,
  update: KNOWN_UPDATE,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Drains everything currently queued, via one real macrotask. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * A backend whose download is driven by the test: `report()` pushes progress, `finish()` ends it.
 * It records `quitAndInstall` and `cancelDownload` rather than doing anything, which is what lets
 * a test prove that *nothing* was installed.
 */
function fakeBackend() {
  let pending: ReturnType<typeof deferred<UpdateDownloadOutcome>> | undefined
  let onProgress: ((progress: UpdateDownloadProgress) => void) | undefined

  const backend = {
    autoInstallOnAppQuit: true, // electron-updater's default; the service must turn this off.
    download: vi.fn((progressCallback: (progress: UpdateDownloadProgress) => void) => {
      onProgress = progressCallback
      pending = deferred<UpdateDownloadOutcome>()
      return pending.promise
    }),
    cancelDownload: vi.fn(),
    quitAndInstall: vi.fn(),
  } satisfies UpdateBackend

  return {
    backend,
    report(progress: UpdateDownloadProgress): void {
      onProgress?.(progress)
    },
    finish(outcome: UpdateDownloadOutcome): void {
      pending?.resolve(outcome)
    },
  }
}

function runningJob(): Job {
  return {
    id: 'job-1',
    moduleId: 'downloads',
    kind: 'download-game',
    labelKey: 'jobs.label.download',
    status: 'running',
    progress: { ratio: 0.4 },
    cancellable: true,
    startedAt: '2026-09-13T11:00:00.000Z',
  }
}

function build(
  parts: {
    isGameRunning?: () => boolean
    listJobs?: () => Job[]
    check?: () => Promise<UpdateCheckOutcome>
  } = {},
) {
  const fake = fakeBackend()
  const states: UpdateState[] = []
  const service = createUpdateService({
    isPackaged: true,
    check: parts.check ?? available,
    backend: fake.backend,
    isGameRunning: parts.isGameRunning ?? ((): boolean => false),
    listJobs: parts.listJobs ?? ((): Job[] => []),
    store: {
      load: vi.fn(async () => ({ update: null, lastCheckedAt: null, lastSuccessAt: null })),
      save: vi.fn(async () => undefined),
    },
    onStateChange: (state) => states.push(state),
    log: { warn: () => undefined },
  })
  return { service, states, ...fake }
}

/** Takes a service from nothing to `phase: 'downloaded'` through the real check + download path. */
async function downloaded(parts: Parameters<typeof build>[0] = {}) {
  const harness = build(parts)
  await harness.service.checkNow()
  await harness.service.startDownload()
  harness.finish({ ok: true })
  await settle()
  expect((await harness.service.getState()).phase).toBe('downloaded')
  return harness
}

describe('AC3/AC4 - the state machine: available -> downloading -> downloaded, and no further', () => {
  it('walks available -> downloading -> downloaded, publishing progress on the way', async () => {
    const { service, states, report, finish } = build()

    expect((await service.checkNow()).phase).toBe('available')

    const started = await service.startDownload()
    expect(started.ok).toBe(true)
    // The call returns as soon as the download *starts* (AC3) - the launcher stays usable.
    expect((await service.getState()).phase).toBe('downloading')

    report({ ratio: 0.5, bytesDone: 500, bytesTotal: 1000, bytesPerSecond: 100 })
    expect((await service.getState()).progress).toEqual({
      ratio: 0.5,
      bytesDone: 500,
      bytesTotal: 1000,
      bytesPerSecond: 100,
    })

    finish({ ok: true })
    await settle()

    const done = await service.getState()
    expect(done.phase).toBe('downloaded')
    // Progress belongs to a running download only.
    expect(done.progress).toBeNull()
    expect(states.map((state) => state.phase)).toContain('downloading')
  })

  it('installAndRestart refuses before the download is downloaded', async () => {
    const { service, backend } = build()

    // Nothing known at all.
    expect(await service.installAndRestart()).toEqual({
      ok: false,
      error: { key: 'appUpdate.error.notReady' },
    })

    // A known, un-downloaded release is still not something to restart into.
    await service.checkNow()
    expect((await service.getState()).phase).toBe('available')
    expect(await service.installAndRestart()).toEqual({
      ok: false,
      error: { key: 'appUpdate.error.notReady' },
    })

    // Mid-download is not either.
    await service.startDownload()
    expect(await service.installAndRestart()).toEqual({
      ok: false,
      error: { key: 'appUpdate.error.notReady' },
    })

    expect(backend.quitAndInstall).not.toHaveBeenCalled()
  })

  it('a downloaded update does not install itself on quit', async () => {
    const { service, backend } = await downloaded()

    // AC4: `electron-updater` arms an install-on-quit handler when a download completes unless this
    // flag is off. It starts `true` on the fake, exactly as the real default does.
    expect(backend.autoInstallOnAppQuit).toBe(false)
    // And the finished download on its own installed nothing: only the second confirmation does.
    expect(backend.quitAndInstall).not.toHaveBeenCalled()

    expect((await service.installAndRestart()).ok).toBe(true)
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})

describe('AC6 - the restart guard refuses and cancels nothing', () => {
  it('refuses while a game started by this launcher is running, and does not stop it', async () => {
    const launch = { isRunning: vi.fn(() => true), cancel: vi.fn() }
    const { service, backend } = await downloaded({ isGameRunning: () => launch.isRunning() })

    const result = await service.installAndRestart()

    expect(result).toEqual({ ok: false, error: { key: 'appUpdate.error.gameRunning' } })
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    // It *read* the launch state and touched nothing else - the game survives the refusal.
    expect(launch.isRunning).toHaveBeenCalled()
    expect(launch.cancel).not.toHaveBeenCalled()
    // The staged update is still staged, so the user can come back to it once the game exits.
    expect((await service.getState()).phase).toBe('downloaded')
  })

  it('refuses while a job is in flight, and does not cancel the job', async () => {
    const jobs = { list: vi.fn(() => [runningJob()]), cancel: vi.fn() }
    const { service, backend } = await downloaded({ listJobs: () => jobs.list() })

    const result = await service.installAndRestart()

    expect(result).toEqual({ ok: false, error: { key: 'appUpdate.error.jobActive' } })
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    expect(jobs.cancel).not.toHaveBeenCalled()
    expect((await service.getState()).phase).toBe('downloaded')
  })

  it('a finished job does not block the restart - only an active one does', async () => {
    const finished: Job = {
      ...runningJob(),
      status: 'succeeded',
      finishedAt: '2026-09-13T11:30:00.000Z',
    }
    const { service, backend } = await downloaded({ listJobs: () => [finished] })

    expect((await service.installAndRestart()).ok).toBe(true)
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('asks the guards again on every attempt, so a refusal lifts when the game exits', async () => {
    let running = true
    const { service, backend } = await downloaded({ isGameRunning: () => running })

    expect((await service.installAndRestart()).ok).toBe(false)
    running = false
    expect((await service.installAndRestart()).ok).toBe(true)
    expect(backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })
})

describe('AC7 - a failed download falls back to available with its reason', () => {
  it.each([
    ['offline', 'appUpdate.error.offline'],
    ['checksum', 'appUpdate.error.checksum'],
    ['cancelled', 'appUpdate.error.cancelled'],
  ] as const)('a %s failure leaves the update offerable', async (reason, key) => {
    const { service, backend, finish } = build()
    await service.checkNow()
    await service.startDownload()

    finish({ ok: false, reason })
    await settle()

    const state = await service.getState()
    // Back where it started: the release is still known and still offerable...
    expect(state.phase).toBe('available')
    expect(state.update).toEqual(KNOWN_UPDATE)
    // ...it says why...
    expect(state.error).toEqual({ key })
    expect(state.progress).toBeNull()
    // ...and nothing on disk changed.
    expect(backend.quitAndInstall).not.toHaveBeenCalled()
    expect(await service.installAndRestart()).toEqual({
      ok: false,
      error: { key: 'appUpdate.error.notReady' },
    })

    // Still offerable in the literal sense: a second attempt starts a second download.
    expect((await service.startDownload()).ok).toBe(true)
    expect((await service.getState()).phase).toBe('downloading')
    expect(backend.download).toHaveBeenCalledTimes(2)
  })

  it('a backend that throws is a failed download, not a crashed service', async () => {
    const { service, backend } = build()
    backend.download.mockImplementation(() => {
      throw new Error('boom')
    })

    await service.checkNow()
    await service.startDownload()
    await settle()

    const state = await service.getState()
    expect(state.phase).toBe('available')
    expect(state.error).toEqual({ key: 'appUpdate.error.downloadFailed' })
  })

  it('cancelling asks the backend to stop and reports the cancelled reason, whatever the backend says', async () => {
    const { service, backend, finish } = build()
    await service.checkNow()
    await service.startDownload()

    expect(service.cancelDownload().ok).toBe(true)
    expect(backend.cancelDownload).toHaveBeenCalledTimes(1)

    // The backend reports its own reason for stopping; the user asked for it, so that is what they
    // are told.
    finish({ ok: false, reason: 'unknown' })
    await settle()

    const state = await service.getState()
    expect(state.phase).toBe('available')
    expect(state.error).toEqual({ key: 'appUpdate.error.cancelled' })
  })

  it('cancelling when nothing is downloading changes nothing', async () => {
    const { service, backend } = build()
    await service.checkNow()

    expect(service.cancelDownload().ok).toBe(true)
    expect(backend.cancelDownload).not.toHaveBeenCalled()
    expect((await service.getState()).phase).toBe('available')
  })

  it('a late progress callback from a superseded download is ignored', async () => {
    const { service, report, finish } = build()
    await service.checkNow()
    await service.startDownload()
    service.cancelDownload()
    finish({ ok: false, reason: 'cancelled' })
    await settle()

    report({ ratio: 0.9, bytesDone: 900, bytesTotal: 1000, bytesPerSecond: 10 })

    const state = await service.getState()
    expect(state.phase).toBe('available')
    expect(state.progress).toBeNull()
  })
})

describe('the download refuses when there is nothing to download', () => {
  it('fails with notAvailable when no release is known', async () => {
    const { service, backend } = build()

    expect(await service.startDownload()).toEqual({
      ok: false,
      error: { key: 'appUpdate.error.notAvailable' },
    })
    expect(backend.download).not.toHaveBeenCalled()
  })

  it('fails with notAvailable in an unpackaged build, even if a release were known', async () => {
    const fake = fakeBackend()
    const service = createUpdateService({
      isPackaged: false,
      check: available,
      backend: fake.backend,
      isGameRunning: () => false,
      listJobs: () => [],
      onStateChange: () => undefined,
      log: { warn: () => undefined },
    })

    await service.checkNow()
    expect(await service.startDownload()).toEqual({
      ok: false,
      error: { key: 'appUpdate.error.notAvailable' },
    })
    expect(fake.backend.download).not.toHaveBeenCalled()
  })

  it('a second download call while one runs does not start a second fetch', async () => {
    const { service, backend } = build()
    await service.checkNow()
    await service.startDownload()

    expect((await service.startDownload()).ok).toBe(true)
    expect(backend.download).toHaveBeenCalledTimes(1)
  })
})

describe('AC5 - dismissal', () => {
  it('marks the state dismissed without touching the update, and is never persisted', async () => {
    const fake = fakeBackend()
    const save = vi.fn(async (_next: UpdateCheckStoreData): Promise<void> => undefined)
    const service = createUpdateService({
      isPackaged: true,
      check: available,
      backend: fake.backend,
      isGameRunning: () => false,
      listJobs: () => [],
      store: {
        load: vi.fn(async () => ({ update: null, lastCheckedAt: null, lastSuccessAt: null })),
        save,
      },
      onStateChange: () => undefined,
      log: { warn: () => undefined },
    })

    await service.checkNow()
    expect((await service.getState()).dismissed).toBe(false)

    const result = service.dismiss()

    expect(result.ok).toBe(true)
    const state = await service.getState()
    expect(state.dismissed).toBe(true)
    // The offer itself is untouched - only the attention marker went.
    expect(state.phase).toBe('available')
    expect(state.update).toEqual(KNOWN_UPDATE)
    // Nothing about the dismissal reaches the store: `save` only ever sees the check record.
    for (const [record] of save.mock.calls) {
      expect(Object.keys(record)).toEqual(['update', 'lastCheckedAt', 'lastSuccessAt'])
    }
  })

  it('a newer release un-dismisses and un-stages an older downloaded one', async () => {
    let current = KNOWN_UPDATE
    const { service, finish } = build({
      check: async () => ({ ok: true, available: true, update: current }),
    })

    await service.checkNow()
    await service.startDownload()
    finish({ ok: true })
    await settle()
    service.dismiss()
    expect((await service.getState()).phase).toBe('downloaded')

    current = { ...KNOWN_UPDATE, version: '1.2.0' }
    await service.checkNow()

    const state = await service.getState()
    expect(state.dismissed).toBe(false)
    expect(state.update?.version).toBe('1.2.0')
    // "Restart and install" must never be offered for a build that was never fetched.
    expect(state.phase).toBe('available')
  })
})

describe('appUpdate.error.* i18n coverage', () => {
  // `notAvailable`/`notReady`/`downloadFailed`/`installFailed` reach the renderer only through a
  // refusal or a rare backend failure, so nothing else in this suite (or `UpdatePopover.test.tsx`,
  // or the e2e flow) renders their translated text the way it renders `gameRunning`/`jobActive`/
  // `offline`/`checksum`/`cancelled` - a typo in one of the four would otherwise only surface as a
  // raw key in the popover. This asserts every key `APP_UPDATE_ERROR_KEYS` can produce resolves to
  // a real, non-empty string in `en.json`.
  it('every key installAndRestart/startDownload can refuse or fail with exists in en.json', () => {
    for (const key of APP_UPDATE_ERROR_KEYS) {
      const value: unknown = key
        .split('.')
        .reduce<unknown>(
          (node, segment) =>
            node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined,
          en,
        )
      expect(typeof value, `${key} should be a string in en.json`).toBe('string')
      expect((value as string).length, `${key} should not be empty`).toBeGreaterThan(0)
    }
  })
})
