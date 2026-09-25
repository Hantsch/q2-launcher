// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServersScanState } from '@shared/modules/servers'
import type { ModuleEvent } from '@shared/types'

/**
 * Story 114 D7. Same module-scope-bridge stubbing as `home/client.test.ts`: the client under test
 * imports `moduleClient.ts`, which reaches `window.q2` through `lib/bridge.ts` at import time.
 *
 * Unlike `home/client.test.ts` (one subscription per test), the cross-filtering assertions here
 * need two subscriptions registered *at the same time* (`onScanChanged` and `onScanServer` both
 * live), so the stub keeps every registered listener in a list rather than a single overwritten
 * slot, and `emit` fans an event out to all of them - exactly like the real `module:event` channel
 * fanning one push out to every module's `onModuleEvent` subscriber.
 */
type Listener = (payload: unknown) => void

let listeners: Listener[] = []

const invokeMock = vi.fn()
const onMock = vi.fn((_channel: string, listener: Listener) => {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
})

;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: onMock }

const { startScan, readScan, onScanChanged, onScanServer } = await import('./client')

const SCAN_STATE: ServersScanState = {
  running: true,
  phase: 'stage1',
  stage1Done: 1,
  stage1Total: 10,
  stage2Done: 0,
  stage2Total: 0,
  sourceFailures: [],
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  blockedReason: null,
  scope: null,
}

const SCAN_ROW = {
  stage: 'stage1' as const,
  target: {
    address: '127.0.0.1:27910',
    origins: ['favourite' as const],
  },
  result: { ok: false as const, reason: 'no-reply' as const },
}

function emit(event: ModuleEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

beforeEach(() => {
  invokeMock.mockReset()
  onMock.mockClear()
  listeners = []
})

describe('servers client - scan transport (story 114 D7)', () => {
  it('startScan calls scan.start with the scope and the selected address when present', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: { ok: true } })

    const result = await startScan({ kind: 'all' }, '127.0.0.1:27910')

    expect(invokeMock).toHaveBeenCalledWith('module:invoke', {
      moduleId: 'servers',
      type: 'scan.start',
      payload: { scope: { kind: 'all' }, selectedAddress: '127.0.0.1:27910' },
    })
    expect(result).toEqual({ ok: true, value: { ok: true } })
  })

  it('startScan calls scan.start with just the scope when no address is selected', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: { ok: true } })

    await startScan({ kind: 'all' })

    expect(invokeMock).toHaveBeenCalledWith('module:invoke', {
      moduleId: 'servers',
      type: 'scan.start',
      payload: { scope: { kind: 'all' } },
    })
  })

  it('readScan calls through to scan.read on the servers module', async () => {
    const snapshot = { state: SCAN_STATE, entries: [] }
    invokeMock.mockResolvedValue({ ok: true, value: snapshot })

    const result = await readScan()

    expect(invokeMock).toHaveBeenCalledWith('module:invoke', {
      moduleId: 'servers',
      type: 'scan.read',
    })
    expect(result).toEqual({ ok: true, value: snapshot })
  })

  it('onScanChanged receives only scan.changed pushes - never a scan.server one on the same subscription', () => {
    const changedListener = vi.fn()
    const unsubscribe = onScanChanged(changedListener)

    // Wrong module: filtered out.
    emit({ moduleId: 'home', type: 'scan.changed', payload: SCAN_STATE })
    expect(changedListener).not.toHaveBeenCalled()

    // Right module, wrong event type: must never reach the scan.changed listener.
    emit({ moduleId: 'servers', type: 'scan.server', payload: SCAN_ROW })
    expect(changedListener).not.toHaveBeenCalled()

    // Its own event: delivered.
    emit({ moduleId: 'servers', type: 'scan.changed', payload: SCAN_STATE })
    expect(changedListener).toHaveBeenCalledTimes(1)
    expect(changedListener).toHaveBeenCalledWith(SCAN_STATE)

    unsubscribe()
    changedListener.mockClear()
    emit({ moduleId: 'servers', type: 'scan.changed', payload: SCAN_STATE })
    expect(changedListener).not.toHaveBeenCalled()
  })

  it('onScanServer receives only scan.server pushes - never a scan.changed one on the same subscription', () => {
    const serverListener = vi.fn()
    const unsubscribe = onScanServer(serverListener)

    emit({ moduleId: 'home', type: 'scan.server', payload: SCAN_ROW })
    expect(serverListener).not.toHaveBeenCalled()

    emit({ moduleId: 'servers', type: 'scan.changed', payload: SCAN_STATE })
    expect(serverListener).not.toHaveBeenCalled()

    emit({ moduleId: 'servers', type: 'scan.server', payload: SCAN_ROW })
    expect(serverListener).toHaveBeenCalledTimes(1)
    expect(serverListener).toHaveBeenCalledWith(SCAN_ROW)

    unsubscribe()
    serverListener.mockClear()
    emit({ moduleId: 'servers', type: 'scan.server', payload: SCAN_ROW })
    expect(serverListener).not.toHaveBeenCalled()
  })

  it('both subscriptions can be live at once and each only ever hears its own event type', () => {
    const changedListener = vi.fn()
    const serverListener = vi.fn()
    onScanChanged(changedListener)
    onScanServer(serverListener)

    emit({ moduleId: 'servers', type: 'scan.changed', payload: SCAN_STATE })
    emit({ moduleId: 'servers', type: 'scan.server', payload: SCAN_ROW })

    expect(changedListener).toHaveBeenCalledTimes(1)
    expect(changedListener).toHaveBeenCalledWith(SCAN_STATE)
    expect(serverListener).toHaveBeenCalledTimes(1)
    expect(serverListener).toHaveBeenCalledWith(SCAN_ROW)
  })

  it('never polls scan.read on a timer: no setInterval/setTimeout fires from subscribing or calling', () => {
    // This client module (`./client.ts`) exports only plain functions - no top-level side effect,
    // no interval/timeout scheduled at import time or from calling any of its exports. Faking
    // timers and asserting nothing was ever scheduled makes AC5's renderer half ("nothing in the
    // renderer polls for progress") a real, checked assertion rather than a comment.
    vi.useFakeTimers()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const unsubscribeChanged = onScanChanged(vi.fn())
    const unsubscribeServer = onScanServer(vi.fn())
    void readScan()
    void startScan({ kind: 'all' })
    vi.advanceTimersByTime(60_000)

    expect(setIntervalSpy).not.toHaveBeenCalled()
    expect(setTimeoutSpy).not.toHaveBeenCalled()

    unsubscribeChanged()
    unsubscribeServer()
    vi.useRealTimers()
  })
})
