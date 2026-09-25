// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WatchlistSnapshot } from '@shared/modules/servers'
import type { ModuleEvent } from '@shared/types'

/**
 * Story 132 D1. Same module-scope bridge stubbing as `../client.test.ts`: the hook under test
 * imports `client.ts`, which imports `moduleClient.ts`, which reaches `window.q2` through
 * `lib/bridge.ts` at import time - so `window.q2` must exist before that chain is imported.
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

const { useWatchlist } = await import('./useWatchlist')

function emit(event: ModuleEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}

const SNAPSHOT_A: WatchlistSnapshot = { asOf: '2026-01-01T00:00:00.000Z', entries: [] }
const SNAPSHOT_B: WatchlistSnapshot = {
  asOf: '2026-01-01T00:05:00.000Z',
  entries: [
    {
      entry: { id: '1', name: 'Alice', mode: 'exact' },
      state: 'offline',
      needsRecheck: false,
    } as unknown as WatchlistSnapshot['entries'][number],
  ],
}

function Probe({ onRender }: { onRender: (result: ReturnType<typeof useWatchlist>) => void }): null {
  const result = useWatchlist()
  onRender(result)
  return null
}

beforeEach(() => {
  invokeMock.mockReset()
  onMock.mockClear()
  listeners = []
})

describe('useWatchlist (story 132 D1)', () => {
  it('loads the snapshot and follows watchlist.changed', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: SNAPSHOT_A })

    let latest: ReturnType<typeof useWatchlist> | undefined
    render(<Probe onRender={(r) => (latest = r)} />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latest?.snapshot).toEqual(SNAPSHOT_A)

    act(() => {
      emit({ moduleId: 'servers', type: 'watchlist.changed', payload: SNAPSHOT_B })
    })

    expect(latest?.snapshot).toEqual(SNAPSHOT_B)
  })

  it('a refused add returns its reason and keeps the snapshot', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: SNAPSHOT_A })

    let latest: ReturnType<typeof useWatchlist> | undefined
    render(<Probe onRender={(r) => (latest = r)} />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latest?.snapshot).toEqual(SNAPSHOT_A)

    invokeMock.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, reasonKey: 'some.key' },
    })

    let addResult: unknown
    await act(async () => {
      addResult = await latest?.add({ name: 'Bob', mode: 'exact' })
    })

    expect(addResult).toEqual({ ok: true, value: { ok: false, reasonKey: 'some.key' } })
    expect(latest?.snapshot).toEqual(SNAPSHOT_A)
  })
})
