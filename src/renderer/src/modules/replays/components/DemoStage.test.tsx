// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../../test-support/mock-client'
import { EMPTY_DEMO_LIST_FILTER } from '@shared/replays/list-filter'
import { initI18n } from '../../../i18n'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})
vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, {
    indexRead: async () => ({ ok: true, value: [] }),
    scanStart: async () => ({ ok: true, value: { started: true } }),
    onScanProgress: () => () => {},
    getListSort: async () => ({ ok: true, value: null }),
    setListSort: async (sort: unknown) => ({ ok: true, value: sort }) as never,
    getListFilter: async () => ({ ok: true, value: EMPTY_DEMO_LIST_FILTER }),
    setListFilter: async (filter: unknown) => ({ ok: true, value: filter }) as never,
    sidecarRead: async () => ({ ok: true, value: { state: { state: 'none' }, values: {} } }),
    playbackTimeline: vi.fn(),
    sendStageRect: vi.fn(async () => ({
      ok: true,
      value: { ok: true, value: undefined },
    })) as never,
    onPlaybackPosition: () => () => {},
    onPlaybackState: () => () => {},
    onPlaybackDisplay: () => () => {},
    playbackDisplayRead: () => new Promise(() => {}),
  }),
)

import * as client from '../client'

let DemoStage: typeof import('./DemoStage').DemoStage
let ReplaysView: typeof import('../ReplaysView').ReplaysView
let usePlaybackStore: typeof import('../playback-store').usePlaybackStore

let observerCallback: ResizeObserverCallback | null = null

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoStage } = await import('./DemoStage'))
  ;({ ReplaysView } = await import('../ReplaysView'))
  ;({ usePlaybackStore } = await import('../playback-store'))
})

afterEach(() => {
  cleanup()
  usePlaybackStore.getState().endSession()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  observerCallback = null
})

describe('DemoStage (story 170 D4)', () => {
  it('stage mode hides list and detail but keeps them mounted', async () => {
    render(<ReplaysView />)
    await act(async () => {})
    expect(screen.queryByTestId('replays-stage')).toBeNull()
    expect(screen.getByTestId('replays-list-detail').className).not.toContain('hidden')

    act(() => usePlaybackStore.getState().armStage())
    expect(screen.getByTestId('replays-stage')).toBeTruthy()
    const body = screen.getByTestId('replays-list-detail')
    expect(body.className).toContain('hidden')
    expect(body.isConnected).toBe(true)
    expect(screen.getByRole('complementary', { hidden: true }).className).toContain('hidden')
    expect(screen.getByTestId('replays-timeline-slot').className).toContain('h-32')

    act(() => usePlaybackStore.getState().disarmStage())
    expect(screen.queryByTestId('replays-stage')).toBeNull()
    expect(screen.getByTestId('replays-list-detail').className).not.toContain('hidden')
  })

  it('label and reason come from i18n keys', () => {
    render(<DemoStage reason={{ key: 'replays.stage.unavailable.wayland' }} />)
    expect(screen.getByTestId('replays-stage-picture').textContent).toBe('The demo plays here')
    const reason = screen.getByTestId('replays-stage-reason')
    expect(reason.getAttribute('role')).toBe('status')
    expect(reason.textContent).toContain('Not available on Wayland')
  })

  it('writes the picture rect to stageRect', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          observerCallback = cb
        }
        observe(): void {}
        disconnect(): void {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10.4,
      y: 20.6,
      width: 800.2,
      height: 600,
      top: 20,
      left: 10,
      right: 810,
      bottom: 620,
      toJSON: () => ({}),
    } as DOMRect)
    render(<DemoStage />)
    act(() => {
      observerCallback?.(
        [{ contentRect: { width: 1000, height: 600 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      )
    })
    expect(usePlaybackStore.getState().stageRect).toEqual({ x: 10, y: 21, width: 800, height: 600 })
  })

  describe('live rect updates (D5)', () => {
    let current: { x: number; y: number; width: number; height: number }
    const frames: FrameRequestCallback[] = []

    function setup(): void {
      current = { x: 10, y: 20, width: 800, height: 600 }
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
      vi.stubGlobal('cancelAnimationFrame', () => {})
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
        () =>
          ({
            ...current,
            top: current.y,
            left: current.x,
            right: 0,
            bottom: 0,
            toJSON: () => ({}),
          }) as DOMRect,
      )
      vi.mocked(client.sendStageRect).mockClear()
      frames.length = 0
    }
    const tick = (): void => {
      const cb = frames.shift()
      act(() => cb?.(0))
    }
    const startSession = (): void =>
      act(() => usePlaybackStore.getState().beginSession('d.dm2', null))

    it('sends once when the box changes during a live session, not for an unchanged box or before one', () => {
      setup()
      render(<DemoStage />)
      current = { ...current, y: 40 }
      tick()
      expect(client.sendStageRect).not.toHaveBeenCalled()

      startSession()
      tick()
      expect(client.sendStageRect).not.toHaveBeenCalled()

      current = { ...current, y: 41 }
      tick()
      tick()
      expect(client.sendStageRect).toHaveBeenCalledTimes(1)
      expect(client.sendStageRect).toHaveBeenCalledWith({ x: 10, y: 41, width: 800, height: 600 })
    })

    it('reports null when unmounted during a live session, nothing when unmounted without one', () => {
      setup()
      const first = render(<DemoStage />)
      first.unmount()
      expect(client.sendStageRect).not.toHaveBeenCalled()

      startSession()
      const second = render(<DemoStage />)
      vi.mocked(client.sendStageRect).mockClear()
      second.unmount()
      expect(client.sendStageRect).toHaveBeenCalledTimes(1)
      expect(client.sendStageRect).toHaveBeenCalledWith(null)
    })

    it('reports the first real rect when mounted during a live session, one call per frame', () => {
      setup()
      startSession()
      render(<DemoStage />)
      expect(client.sendStageRect).toHaveBeenCalledTimes(1)
      expect(client.sendStageRect).toHaveBeenCalledWith({ x: 10, y: 20, width: 800, height: 600 })
      current = { ...current, y: 30 }
      current = { ...current, y: 31 }
      tick()
      expect(client.sendStageRect).toHaveBeenCalledTimes(2)
    })
  })
})
