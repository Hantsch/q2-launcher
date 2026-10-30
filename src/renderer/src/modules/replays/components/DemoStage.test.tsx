// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../../test-support/mock-client'
import { EMPTY_DEMO_LIST_FILTER, type DemoListFilter } from '@shared/replays/list-filter'
import type { DemoListSort } from '@shared/replays/list-sort'
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
    setListSort: async (sort: DemoListSort | null) => ({ ok: true as const, value: sort }),
    getListFilter: async () => ({ ok: true, value: EMPTY_DEMO_LIST_FILTER }),
    setListFilter: async (filter: DemoListFilter) => ({ ok: true as const, value: filter }),
    sidecarRead: async () => ({ ok: true, value: { state: { state: 'none' }, values: {} } }),
    playbackTimeline: vi.fn(),
    sendStageRect: vi.fn(async () => ({ ok: true as const, value: undefined })),
    onPlaybackPosition: () => () => {},
    onPlaybackState: () => () => {},
    onPlaybackDisplay: () => () => {},
    playbackDisplayRead: () => new Promise(() => {}),
    readPlaybackMode: () => new Promise(() => {}),
  }),
)

vi.mock('../integrated/engine-loader', () => {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('data-testid', 'replays-engine-canvas')
  const host = { canvas, resize() {}, pauseLoop() {}, resumeLoop() {}, disconnect() {} }
  return { engineLoader: { load: async () => host, discard() {} } }
})

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

describe('DemoStage', () => {
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

  it('in integrated mode the stage holds the engine canvas instead of the placeholder', async () => {
    vi.mocked(client.sendStageRect).mockClear()
    act(() =>
      usePlaybackStore.getState().beginSession('d.dm2', null, {
        id: 'd',
        archived: false,
        kind: 'integrated',
      }),
    )
    render(<DemoStage mode="integrated" />)
    await act(async () => {})
    const picture = screen.getByTestId('replays-stage-picture')
    expect(picture.contains(screen.getByTestId('replays-engine-canvas'))).toBe(true)
    expect(picture.textContent).not.toContain('The demo plays here')
    expect(client.sendStageRect).not.toHaveBeenCalled()
  })

  it('the stage shows the loading text while an integrated demo loads', async () => {
    act(() => {
      const store = usePlaybackStore.getState()
      store.beginSession('d.dm2', null, { id: 'd', archived: false, kind: 'integrated' })
      store.setIntegratedPhase('loading')
    })
    render(<DemoStage mode="integrated" />)
    await act(async () => {})
    const loading = screen.getByTestId('replays-integrated-loading')
    expect(loading.getAttribute('role')).toBe('status')
    expect(loading.textContent).toBe('Loading demo…')

    act(() => usePlaybackStore.getState().setIntegratedPhase('playing'))
    expect(screen.queryByTestId('replays-integrated-loading')).toBeNull()
  })

  it('a refused integrated play offers playing in engine mode', async () => {
    const onPlayInEngineMode = vi.fn()
    act(() => {
      const store = usePlaybackStore.getState()
      store.beginSession('d.dm2', null, { id: 'd', archived: false, kind: 'integrated' })
      store.setStageReason(
        { key: 'replays.integrated.error.dataTooLarge', params: { sizeMb: 612 } },
        true,
      )
    })
    render(<DemoStage mode="integrated" onPlayInEngineMode={onPlayInEngineMode} />)
    await act(async () => {})
    expect(screen.getByTestId('replays-stage-reason').textContent).toBe(
      'This demo needs 612 MB of game data, more than integrated playback can hold. Play it in engine mode.',
    )
    const button = screen.getByTestId('replays-stage-play-engine')
    expect(button.textContent).toBe('Play in engine mode')
    act(() => button.click())
    expect(onPlayInEngineMode).toHaveBeenCalledTimes(1)
  })

  it('in engine mode the stage keeps the placeholder and reports its rect', () => {
    vi.mocked(client.sendStageRect).mockClear()
    act(() => usePlaybackStore.getState().beginSession('d.dm2', null))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 5,
      y: 6,
      width: 640,
      height: 480,
      top: 6,
      left: 5,
      right: 645,
      bottom: 486,
      toJSON: () => ({}),
    } as DOMRect)
    render(<DemoStage mode="engine" />)
    expect(screen.getByTestId('replays-stage-picture').textContent).toBe('The demo plays here')
    expect(screen.queryByTestId('replays-engine-canvas')).toBeNull()
    expect(client.sendStageRect).toHaveBeenCalledWith({ x: 5, y: 6, width: 640, height: 480 })
  })

  describe('live rect updates', () => {
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
