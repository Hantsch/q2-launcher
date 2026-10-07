// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Outcome } from '@shared/types/common'
import type { ScanSnapshot, ServersScanState } from '@shared/modules/servers'
import { mockClient } from '../../test-support/mock-client'

// `lib/bridge.ts` resolves `window.q2` at module scope, before any client mock applies.
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(() => Promise.resolve(undefined)),
    on: vi.fn(() => () => {}),
  }
})

const client = vi.hoisted(() => ({
  readScan: vi.fn(),
  setMode: vi.fn(async () => ({ ok: true as const, value: undefined })),
  setScanViewActive: vi.fn(async () => ({ ok: true as const, value: undefined })),
  onScanChanged: vi.fn(),
  onScanServer: vi.fn(),
  listMasterSources: vi.fn(async () => ({ ok: true as const, value: [] })),
}))

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, client),
)

const { useServerScan } = await import('./useServerScan')

const STATE: ServersScanState = {
  running: true,
  phase: 'stage1',
  stage1Done: 0,
  stage1Total: 1,
  stage2Done: 0,
  stage2Total: 0,
  sourceFailures: [],
  startedAt: 'x',
  finishedAt: null,
  blockedReason: null,
  scope: null,
  mode: 'online',
}

const SNAPSHOT: ScanSnapshot = {
  state: STATE,
  entries: [],
  mode: 'online',
  lan: { lastFinishedAt: null, failureKey: null },
}

const ok = (value: ScanSnapshot): Outcome<ScanSnapshot> => ({ ok: true, value })

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

/** Mounts the hook and returns the registered push listeners. */
async function mount() {
  client.readScan.mockResolvedValue(ok(SNAPSHOT))
  const unsubscribeChanged = vi.fn()
  const unsubscribeServer = vi.fn()
  client.onScanChanged.mockReturnValue(unsubscribeChanged)
  client.onScanServer.mockReturnValue(unsubscribeServer)
  const hook = renderHook(() => useServerScan())
  await flush()
  const pushState = client.onScanChanged.mock.calls[0]?.[0] as (state: ServersScanState) => void
  const pushServer = client.onScanServer.mock.calls[0]?.[0] as () => void
  return { hook, pushState, pushServer, unsubscribeChanged, unsubscribeServer }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useServerScan', () => {
  it('the mount resets to online before announcing the view open', async () => {
    type ModeResult = { ok: true; value: undefined }
    let resolveMode!: (value: ModeResult) => void
    client.setMode.mockImplementationOnce(
      () => new Promise<ModeResult>((resolve) => (resolveMode = resolve)),
    )
    await mount()
    expect(client.setMode).toHaveBeenCalledWith('online')
    expect(client.setScanViewActive).not.toHaveBeenCalled()
    expect(client.readScan).not.toHaveBeenCalled()
    resolveMode({ ok: true, value: undefined })
    await flush()
    expect(client.setScanViewActive).toHaveBeenCalledWith(true)
    expect(client.readScan).toHaveBeenCalled()
    const announcedAt = client.setScanViewActive.mock.invocationCallOrder[0]
    expect(announcedAt).toBeLessThan(client.readScan.mock.invocationCallOrder[0])
  })

  it('a burst of scan.server pushes queues at most one trailing read', async () => {
    const { pushServer } = await mount()
    const resolvers: Array<(value: Outcome<ScanSnapshot>) => void> = []
    client.readScan.mockClear()
    client.readScan.mockImplementation(
      () => new Promise<Outcome<ScanSnapshot>>((resolve) => resolvers.push(resolve)),
    )

    act(() => {
      for (let i = 0; i < 5; i++) pushServer()
    })
    expect(client.readScan).toHaveBeenCalledTimes(1)

    resolvers[0]?.(ok(SNAPSHOT))
    await flush()
    expect(client.readScan).toHaveBeenCalledTimes(2)

    resolvers[1]?.(ok(SNAPSHOT))
    await flush()
    expect(client.readScan).toHaveBeenCalledTimes(2)
  })

  it('LAN rows never stream into the online list', async () => {
    const { hook, pushState, pushServer } = await mount()
    client.readScan.mockClear()
    client.readScan.mockResolvedValue(
      ok({
        ...SNAPSHOT,
        state: { ...STATE, mode: 'lan' },
        mode: 'lan',
        entries: [
          {
            address: 'lan:1',
            origins: ['lan'],
            status: 'online',
            lastSeenAt: 'x',
            favourite: false,
          },
        ],
      }),
    )

    // The `scan.server` pushes land before React renders the `scan.changed` that preceded them.
    act(() => {
      pushState({ ...STATE, mode: 'lan' })
      pushServer()
      pushServer()
    })
    await flush()

    expect(client.readScan).not.toHaveBeenCalled()
    expect(hook.result.current.mode).toBe('online')
    expect(hook.result.current.entries).toEqual([])
  })

  it('unmount unsubscribes and marks the view inactive', async () => {
    const { hook, unsubscribeChanged, unsubscribeServer } = await mount()
    hook.unmount()
    expect(unsubscribeChanged).toHaveBeenCalledTimes(1)
    expect(unsubscribeServer).toHaveBeenCalledTimes(1)
    expect(client.setScanViewActive).toHaveBeenLastCalledWith(false)
  })
})
