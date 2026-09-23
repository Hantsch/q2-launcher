import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { Job, UpdateState } from '@shared/types'
import type { UpdateCheckStoreData } from './store'
import { UPDATE_CHECK_TIMEOUT_MS, createUpdateService, type UpdateCheckOutcome } from './service'

/**
 * Story 097 D3 acceptance tests. Everything is injected - the checker (D4's seam), the store (D2),
 * `now` and the `isPackaged` flag - so not one of these tests loads Electron, `electron-updater`,
 * or touches the network or the filesystem. `store.test.ts` already proves the real file behaviour.
 */

const SERVICE_SOURCE = readFileSync(fileURLToPath(new URL('./service.ts', import.meta.url)), 'utf8')
/** The source with comments stripped - the prose below explains the rules the code must follow, so
 * a source-level assertion has to look at the code alone. */
const SERVICE_CODE = SERVICE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const NOW = new Date('2026-09-13T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString()
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const KNOWN_UPDATE = {
  version: '1.0.0-beta.2',
  notes: 'Fixed the thing.',
  releasedAt: '2026-09-12T10:00:00.000Z',
}

/** A minimal `UpdateCheckStore` stand-in: an in-memory box, same `load()`/`save()` shape. */
function fakeStore(initial: Partial<UpdateCheckStoreData> = {}) {
  let data: UpdateCheckStoreData = {
    update: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    ...initial,
  }
  return {
    load: vi.fn(async (): Promise<UpdateCheckStoreData> => ({ ...data })),
    save: vi.fn(async (next: UpdateCheckStoreData): Promise<void> => {
      data = { ...next }
    }),
    current: (): UpdateCheckStoreData => data,
  }
}

/**
 * Story 098's three new dependencies, none of which this (097) suite exercises: a backend that is
 * never asked to do anything, and two guards that always answer "nothing is going on". They are
 * required options rather than optional ones deliberately - a guard that defaults to "no game is
 * running" is a guard that silently is not there - so every construction has to name them.
 */
function unusedActionDeps() {
  return {
    backend: {
      autoInstallOnAppQuit: false,
      download: vi.fn(async () => ({ ok: true as const })),
      cancelDownload: vi.fn(),
      quitAndInstall: vi.fn(),
    },
    isGameRunning: (): boolean => false,
    listJobs: (): Job[] => [],
  }
}

function build(parts: {
  check: () => Promise<UpdateCheckOutcome>
  store?: ReturnType<typeof fakeStore>
  isPackaged?: boolean
  currentVersion?: string
  now?: () => Date
}) {
  const store = parts.store ?? fakeStore()
  const states: UpdateState[] = []
  const onStateChange = vi.fn((state: UpdateState) => {
    states.push(state)
  })
  const service = createUpdateService({
    ...unusedActionDeps(),
    isPackaged: parts.isPackaged ?? true,
    currentVersion: parts.currentVersion ?? '0.0.1',
    check: parts.check,
    store,
    onStateChange,
    now: parts.now ?? ((): Date => NOW),
  })
  return { service, store, states, onStateChange }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Drains everything currently queued, via one real macrotask. Not usable under fake timers. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Drains pending microtasks only - the fake-timer-safe variant of `settle()`. */
async function flushMicrotasks(ticks = 20): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve()
}

const available = async (): Promise<UpdateCheckOutcome> => ({
  ok: true,
  available: true,
  update: KNOWN_UPDATE,
})
const upToDate = async (): Promise<UpdateCheckOutcome> => ({ ok: true, available: false })
const failing =
  (reason: 'network' | 'http' | 'notConfigured' | 'unknown') =>
  async (): Promise<UpdateCheckOutcome> => ({ ok: false, reason })

describe('update service source', () => {
  it('carries no toast, no retry timer and no version comparison of its own', () => {
    // AC3's "never toasts and never retries" and the Decision "the semver comparison is
    // electron-updater's", asserted against the code so a later edit cannot reintroduce either.
    expect(SERVICE_CODE).not.toMatch(/toast/i)
    expect(SERVICE_CODE).not.toMatch(/setInterval\s*\(/)
    expect(SERVICE_CODE).not.toMatch(/semver/i)
    // The one file that may import electron-updater is checker.ts (D4).
    expect(SERVICE_CODE).not.toMatch(/electron-updater/)
  })
})

describe('update service: AC8 - the last known result survives a restart', () => {
  it('a cold start restores the last known result before any check runs', async () => {
    const store = fakeStore({
      update: KNOWN_UPDATE,
      lastCheckedAt: ago(2 * HOUR),
      lastSuccessAt: ago(2 * HOUR),
    })
    const check = vi.fn(available)
    const { service, onStateChange } = build({ check, store })

    const state = await service.getState()

    expect(check).not.toHaveBeenCalled()
    expect(state).toEqual({
      status: 'available',
      phase: 'available',
      update: KNOWN_UPDATE,
      error: null,
      progress: null,
      dismissed: false,
      lastCheckedAt: ago(2 * HOUR),
      lastSuccessAt: ago(2 * HOUR),
      supported: true,
    })
    expect(onStateChange).toHaveBeenCalledWith(state)
  })

  it('a restored record with a past success but nothing available reads as up to date', async () => {
    const store = fakeStore({ lastCheckedAt: ago(2 * HOUR), lastSuccessAt: ago(2 * HOUR) })
    const { service } = build({ check: vi.fn(available), store })

    expect((await service.getState()).status).toBe('upToDate')
  })

  it('a restored release that is the running version is dropped and the window reopens', async () => {
    // The record the previous build wrote before "Restart and install" still offers the release
    // that is now running; offering it again would lead to a download that can only fail.
    const store = fakeStore({
      update: KNOWN_UPDATE,
      lastCheckedAt: ago(2 * HOUR),
      lastSuccessAt: ago(2 * HOUR),
    })
    const check = vi.fn(upToDate)
    const { service } = build({ check, store, currentVersion: KNOWN_UPDATE.version })

    const restored = await service.getState()
    expect(restored.update).toBeNull()
    expect(restored.phase).toBe('idle')

    service.scheduleStartupCheck()
    await vi.waitFor(() => {
      expect(check).toHaveBeenCalledTimes(1)
    })
  })

  it('an empty store reads as idle, with nothing known', async () => {
    const { service, onStateChange } = build({ check: vi.fn(available) })

    expect(await service.getState()).toEqual({
      status: 'idle',
      phase: 'idle',
      update: null,
      error: null,
      progress: null,
      dismissed: false,
      lastCheckedAt: null,
      lastSuccessAt: null,
      supported: true,
    })
    // Nothing changed, so nothing was announced.
    expect(onStateChange).not.toHaveBeenCalled()
  })

  it('a store that cannot be read degrades to nothing known instead of throwing', async () => {
    const store = fakeStore()
    store.load.mockRejectedValueOnce(new Error('disk on fire'))
    const { service } = build({ check: vi.fn(available), store })

    expect((await service.getState()).status).toBe('idle')
  })
})

describe('update service: AC1 - at most one check per 24 hours', () => {
  it('a start inside 24 hours of the last successful check reuses the last result instead of checking', async () => {
    const store = fakeStore({
      update: KNOWN_UPDATE,
      lastCheckedAt: ago(HOUR),
      lastSuccessAt: ago(HOUR),
    })
    const check = vi.fn(available)
    const { service } = build({ check, store })

    service.scheduleStartupCheck()
    await settle()

    expect(check).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
    expect(await service.getState()).toEqual({
      status: 'available',
      phase: 'available',
      update: KNOWN_UPDATE,
      error: null,
      progress: null,
      dismissed: false,
      lastCheckedAt: ago(HOUR),
      lastSuccessAt: ago(HOUR),
      supported: true,
    })
  })

  it('a start after the window has passed checks again', async () => {
    const store = fakeStore({ lastCheckedAt: ago(DAY + HOUR), lastSuccessAt: ago(DAY + HOUR) })
    const check = vi.fn(available)
    const { service } = build({ check, store })

    service.scheduleStartupCheck()
    await settle()

    expect(check).toHaveBeenCalledTimes(1)
    expect((await service.getState()).lastSuccessAt).toBe(NOW_ISO)
  })

  it('a last success in the future does not close the window forever', async () => {
    // A clock that was wrong once and then corrected must not silence the check until 2049.
    const store = fakeStore({ lastSuccessAt: new Date(NOW.getTime() + 900 * DAY).toISOString() })
    const check = vi.fn(available)
    const { service } = build({ check, store })

    service.scheduleStartupCheck()
    await settle()

    expect(check).toHaveBeenCalledTimes(1)
  })
})

describe('update service: AC2 - the checker decides newer, the service relays it', () => {
  it('a newer published release becomes an available state carrying version and notes, an older or equal one becomes up to date', async () => {
    const newer = build({ check: vi.fn(available) })
    const state = await newer.service.checkNow()

    expect(state).toEqual({
      status: 'available',
      phase: 'available',
      update: KNOWN_UPDATE,
      error: null,
      progress: null,
      dismissed: false,
      lastCheckedAt: NOW_ISO,
      lastSuccessAt: NOW_ISO,
      supported: true,
    })

    // Not newer: a *successful* up-to-date answer is the one thing that clears a known update.
    const older = build({
      check: vi.fn(upToDate),
      store: fakeStore({ update: KNOWN_UPDATE, lastCheckedAt: ago(DAY), lastSuccessAt: ago(DAY) }),
    })
    const next = await older.service.checkNow()

    expect(next.status).toBe('upToDate')
    expect(next.update).toBeNull()
    expect(next.lastSuccessAt).toBe(NOW_ISO)
  })

  it('a completed attempt is persisted, so the next session starts from it', async () => {
    const { service, store } = build({ check: vi.fn(available) })

    await service.checkNow()

    expect(store.save).toHaveBeenCalledWith({
      update: KNOWN_UPDATE,
      lastCheckedAt: NOW_ISO,
      lastSuccessAt: NOW_ISO,
    })
    expect(store.current()).toEqual({
      update: KNOWN_UPDATE,
      lastCheckedAt: NOW_ISO,
      lastSuccessAt: NOW_ISO,
    })
  })

  it('every state change is announced, checking first and then the outcome', async () => {
    const { service, states } = build({ check: vi.fn(available) })

    await service.checkNow()

    expect(states.map((state) => state.status)).toEqual(['checking', 'available'])
  })
})

describe('update service: AC3 - a failure is quiet, kept, and not retried', () => {
  it('a failed check keeps the reason, never throws, never toasts and never retries', async () => {
    const check = vi.fn(failing('network'))
    const { service } = build({ check })

    const state = await service.checkNow()

    expect(state.status).toBe('error')
    expect(state.error).toEqual({ key: 'update.error.network' })
    expect(state.lastCheckedAt).toBe(NOW_ISO)
    // One attempt, one call: no retry storm inside the session.
    expect(check).toHaveBeenCalledTimes(1)
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('distinct failure causes keep distinct error keys', async () => {
    for (const reason of ['network', 'http', 'notConfigured', 'unknown'] as const) {
      const { service } = build({ check: vi.fn(failing(reason)) })
      expect((await service.checkNow()).error).toEqual({ key: `update.error.${reason}` })
    }
  })

  it('a checker that throws resolves as an unknown failure instead of rejecting', async () => {
    const check = vi.fn(async (): Promise<UpdateCheckOutcome> => {
      throw new Error('getaddrinfo ENOTFOUND github.com')
    })
    const { service } = build({ check })

    const state = await service.checkNow()

    expect(state.status).toBe('error')
    expect(state.error).toEqual({ key: 'update.error.unknown' })
  })

  it('a failed check never erases a previously known update', async () => {
    const store = fakeStore({
      update: KNOWN_UPDATE,
      lastCheckedAt: ago(2 * DAY),
      lastSuccessAt: ago(2 * DAY),
    })
    const { service } = build({ check: vi.fn(failing('network')), store })

    const state = await service.checkNow()

    expect(state.status).toBe('error')
    expect(state.update).toEqual(KNOWN_UPDATE)
    expect(store.current().update).toEqual(KNOWN_UPDATE)
  })

  it('scheduleStartupCheck returns before the check settles', async () => {
    const gate = deferred<UpdateCheckOutcome>()
    const check = vi.fn(() => gate.promise)
    const { service } = build({ check })

    const returned = service.scheduleStartupCheck()

    // Returned synchronously, before the checker has even been reached - AC3's "does not block
    // startup" by construction.
    expect(returned).toBeUndefined()
    expect(check).not.toHaveBeenCalled()

    await settle()
    expect(check).toHaveBeenCalledTimes(1)
    expect((await service.getState()).status).toBe('checking')

    gate.resolve({ ok: true, available: true, update: KNOWN_UPDATE })
    await settle()
    expect((await service.getState()).status).toBe('available')
  })

  it('a listener that throws cannot break a check', async () => {
    const store = fakeStore()
    const service = createUpdateService({
      ...unusedActionDeps(),
      isPackaged: true,
      currentVersion: '0.0.1',
      check: vi.fn(available),
      store,
      onStateChange: () => {
        throw new Error('the broadcaster is having a day')
      },
      now: () => NOW,
    })

    expect((await service.checkNow()).status).toBe('available')
  })
})

describe('update service: AC4 - a failure does not burn the daily window', () => {
  it('a failed check does not start the 24-hour window', async () => {
    const check = vi.fn(failing('network'))
    const { service, store } = build({ check })

    const state = await service.checkNow()

    expect(state.lastCheckedAt).toBe(NOW_ISO)
    expect(state.lastSuccessAt).toBeNull()
    expect(store.save).toHaveBeenCalledWith({
      update: null,
      lastCheckedAt: NOW_ISO,
      lastSuccessAt: null,
    })

    // The very next start still checks, rather than waiting 24h on a result that never arrived.
    service.scheduleStartupCheck()
    await settle()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('a failed check leaves an earlier success timestamp untouched', async () => {
    const store = fakeStore({ lastCheckedAt: ago(DAY + HOUR), lastSuccessAt: ago(DAY + HOUR) })
    const { service } = build({ check: vi.fn(failing('http')), store })

    const state = await service.checkNow()

    expect(state.lastSuccessAt).toBe(ago(DAY + HOUR))
    expect(store.current().lastSuccessAt).toBe(ago(DAY + HOUR))
  })
})

describe('update service: AC5 - an unpackaged build stays out of it', () => {
  it('an unpackaged build never checks and reports supported: false', async () => {
    const check = vi.fn(available)
    const store = fakeStore({ update: KNOWN_UPDATE, lastSuccessAt: ago(2 * DAY) })
    const { service, onStateChange } = build({ check, store, isPackaged: false })

    service.scheduleStartupCheck()
    const manual = await service.checkNow()
    await settle()

    expect(check).not.toHaveBeenCalled()
    expect(store.load).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
    expect(onStateChange).not.toHaveBeenCalled()
    expect(manual).toEqual({
      status: 'idle',
      phase: 'idle',
      update: null,
      error: null,
      progress: null,
      dismissed: false,
      lastCheckedAt: null,
      lastSuccessAt: null,
      supported: false,
    })
    expect(await service.getState()).toEqual(manual)
  })
})

describe('update service: AC7 - the manual check ignores the window', () => {
  it('a manual check runs regardless of the 24-hour window and reports its failure reason', async () => {
    const store = fakeStore({ lastCheckedAt: ago(MINUTE), lastSuccessAt: ago(MINUTE) })
    const check = vi.fn(failing('http'))
    const { service } = build({ check, store })

    const state = await service.checkNow()

    expect(check).toHaveBeenCalledTimes(1)
    expect(state.status).toBe('error')
    expect(state.error).toEqual({ key: 'update.error.http' })
    expect(state.lastCheckedAt).toBe(NOW_ISO)
    expect(state.lastSuccessAt).toBe(ago(MINUTE))
  })

  it('a manual check inside the window reports its success too', async () => {
    const store = fakeStore({ lastCheckedAt: ago(MINUTE), lastSuccessAt: ago(MINUTE) })
    const { service } = build({ check: vi.fn(available), store })

    expect((await service.checkNow()).status).toBe('available')
  })
})

describe('update service: one check at a time', () => {
  it('a second check while one is in flight joins it instead of starting another', async () => {
    const gate = deferred<UpdateCheckOutcome>()
    const check = vi.fn(() => gate.promise)
    const { service } = build({ check })

    const first = service.checkNow()
    const second = service.checkNow()
    await settle()

    expect(check).toHaveBeenCalledTimes(1)

    gate.resolve({ ok: true, available: true, update: KNOWN_UPDATE })
    const [a, b] = await Promise.all([first, second])

    expect(a).toBe(b)
    expect(a.status).toBe('available')
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('a manual check joins a running startup check', async () => {
    const gate = deferred<UpdateCheckOutcome>()
    const check = vi.fn(() => gate.promise)
    const { service } = build({ check })

    service.scheduleStartupCheck()
    const manual = service.checkNow()
    await settle()

    expect(check).toHaveBeenCalledTimes(1)

    gate.resolve({ ok: true, available: false })
    expect((await manual).status).toBe('upToDate')
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('a settled check releases the slot, so the next one runs', async () => {
    const check = vi.fn(available)
    const { service } = build({ check })

    await service.checkNow()
    await service.checkNow()

    expect(check).toHaveBeenCalledTimes(2)
  })
})

describe('update service: the timeout guard', () => {
  it('a hung check fails out after the timeout instead of staying in checking', async () => {
    vi.useFakeTimers()
    try {
      const store = fakeStore({
        update: KNOWN_UPDATE,
        lastCheckedAt: ago(2 * DAY),
        lastSuccessAt: ago(2 * DAY),
      })
      const check = vi.fn(() => new Promise<UpdateCheckOutcome>(() => {}))
      const { service } = build({ check, store })

      const pending = service.checkNow()
      await flushMicrotasks()
      expect(check).toHaveBeenCalledTimes(1)
      expect((await service.getState()).status).toBe('checking')

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS - 1)
      expect((await service.getState()).status).toBe('checking')

      await vi.advanceTimersByTimeAsync(1)
      const state = await pending

      expect(state.status).toBe('error')
      expect(state.error).toEqual({ key: 'update.error.timeout' })
      // The two things a timeout must not do: burn the window, or forget the known update.
      expect(state.lastSuccessAt).toBe(ago(2 * DAY))
      expect(state.update).toEqual(KNOWN_UPDATE)
      expect(state.lastCheckedAt).toBe(NOW_ISO)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a timed-out check does not block the next one', async () => {
    vi.useFakeTimers()
    try {
      let impl = (): Promise<UpdateCheckOutcome> => new Promise<UpdateCheckOutcome>(() => {})
      const check = vi.fn(() => impl())
      const { service } = build({ check })

      const pending = service.checkNow()
      await flushMicrotasks()
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS)
      expect((await pending).status).toBe('error')

      impl = available
      const second = service.checkNow()
      await flushMicrotasks()

      expect(check).toHaveBeenCalledTimes(2)
      expect((await second).status).toBe('available')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a check that answers in time never fires the timeout', async () => {
    vi.useFakeTimers()
    try {
      const { service } = build({ check: vi.fn(available) })

      const state = await service.checkNow()
      expect(state.status).toBe('available')

      // Nothing is left on the timer queue that could still move the state afterwards.
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(10 * UPDATE_CHECK_TIMEOUT_MS)
      expect((await service.getState()).status).toBe('available')
    } finally {
      vi.useRealTimers()
    }
  })
})
