// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../../test-support/mock-client'
import { initI18n } from '../../../i18n'
import type { DemoRow } from '@shared/modules/replays'
import type { SidecarComment } from '@shared/replays/sidecar'

/** Story 165 D3. Stubbed client, real store - same idiom as `DemoPlayAction.test.tsx`. */
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: vi.fn(), on: vi.fn(() => () => {}) }
})

const playbackTimeline = vi.fn()
const playbackStop = vi.fn()
const playbackCinema = vi.fn()
vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, {
    playbackTimeline: (...args: unknown[]) => playbackTimeline(...args),
    playbackStop: (...args: unknown[]) => playbackStop(...args),
    playbackCinema: (...args: unknown[]) => playbackCinema(...args),
    playbackDisplayRead: () => new Promise(() => {}),
    onPlaybackPosition: () => () => {},
    onPlaybackState: () => () => {},
    onPlaybackDisplay: () => () => {},
  }),
)

let DemoTimeline: typeof import('./DemoTimeline').DemoTimeline
let usePlaybackStore: typeof import('../playback-store').usePlaybackStore
let useDemoEditorStore: typeof import('../demo-editor-store').useDemoEditorStore

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoTimeline } = await import('./DemoTimeline'))
  ;({ usePlaybackStore } = await import('../playback-store'))
  ;({ useDemoEditorStore } = await import('../demo-editor-store'))
})

beforeEach(() => {
  playbackTimeline.mockResolvedValue({ ok: true, value: undefined })
})

afterEach(() => {
  cleanup()
  usePlaybackStore.getState().endSession()
  playbackTimeline.mockReset()
  playbackCinema.mockReset()
})

function begin(durationMs: number | null, positionMs?: number): void {
  act(() => {
    usePlaybackStore.getState().beginSession('a.dm2', durationMs)
    if (positionMs !== undefined) usePlaybackStore.getState().applyPosition(positionMs, null)
  })
}

const testid = (id: string): HTMLElement => screen.getByTestId(`replays-timeline-${id}`)

describe('DemoTimeline (story 165 D3)', () => {
  it('is absent without a session', () => {
    render(createElement(DemoTimeline))
    expect(screen.queryByTestId('replays-timeline')).toBeNull()
  })

  it('shows name, position and duration text and the slider values', () => {
    begin(125_000, 65_000)
    render(createElement(DemoTimeline))
    expect(screen.getByTestId('replays-timeline').textContent).toContain('a.dm2')
    expect(testid('position').textContent).toBe('1:05')
    expect(testid('duration').textContent).toBe('2:05')
    const seek = testid('seek')
    expect(seek.getAttribute('role')).toBe('slider')
    expect(seek.getAttribute('tabindex')).toBe('0')
    expect(seek.getAttribute('aria-valuemin')).toBe('0')
    expect(seek.getAttribute('aria-valuemax')).toBe('125')
    expect(seek.getAttribute('aria-valuenow')).toBe('65')
    expect(seek.getAttribute('aria-valuetext')).toBe('1:05 of 2:05')
    expect(screen.queryByTestId('replays-timeline-seek-reason')).toBeNull()
  })

  it('the transport buttons send toggle, back and forward', () => {
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    fireEvent.click(testid('toggle'))
    fireEvent.click(testid('back'))
    fireEvent.click(testid('forward'))
    expect(playbackTimeline.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'togglePause' },
      { kind: 'jump', deltaS: -10 },
      { kind: 'jump', deltaS: 10 },
    ])
  })

  it('the stop button calls stop without a confirmation', () => {
    playbackStop.mockResolvedValue({ ok: true, value: undefined })
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    expect(testid('stop').getAttribute('aria-label')).toBe('Stop demo')
    fireEvent.click(testid('stop'))
    expect(playbackStop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('while stopping the stop button is disabled and says Stopping…', async () => {
    playbackStop.mockReturnValue(new Promise(() => {}))
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    fireEvent.click(testid('stop'))
    await act(async () => {})
    const stop = testid('stop') as HTMLButtonElement
    expect(stop.disabled).toBe(true)
    expect(stop.getAttribute('aria-label')).toBe('Stopping…')
  })

  it('the toggle label flips with the inferred paused state', () => {
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    expect(testid('toggle').getAttribute('aria-label')).toBe('Pause')
    expect(testid('state').textContent).toBe('Playing')
    act(() => usePlaybackStore.getState().applyPosition(1000, null))
    expect(testid('toggle').getAttribute('aria-label')).toBe('Pause')
    act(() => usePlaybackStore.getState().applyPosition(1000, null))
    expect(testid('toggle').getAttribute('aria-label')).toBe('Play')
    expect(testid('state').textContent).toBe('Paused')
  })

  it('a click on the seek bar seeks to the matching second', () => {
    begin(100_000, 0)
    render(createElement(DemoTimeline))
    const seek = testid('seek')
    seek.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
    fireEvent.click(seek, { clientX: 50 })
    expect(playbackTimeline).toHaveBeenCalledWith({ kind: 'seekTo', seconds: 25 })
  })

  it('slider keys jump, page and seek to the ends', () => {
    begin(100_000, 0)
    render(createElement(DemoTimeline))
    const seek = testid('seek')
    for (const key of ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']) {
      fireEvent.keyDown(seek, { key })
    }
    expect(playbackTimeline.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'jump', deltaS: -10 },
      { kind: 'jump', deltaS: 10 },
      { kind: 'jump', deltaS: 60 },
      { kind: 'jump', deltaS: -60 },
      { kind: 'seekTo', seconds: 0 },
      { kind: 'seekTo', seconds: 100 },
    ])
  })

  it('the speed select shows the current step and sends the chosen one', () => {
    begin(60_000)
    render(createElement(DemoTimeline))
    const speed = testid('speed') as HTMLSelectElement
    expect(speed.value).toBe('1')
    expect(Array.from(speed.options).map((o) => o.value)).toEqual(['0.25', '0.5', '1', '2', '4'])
    fireEvent.change(speed, { target: { value: '2' } })
    expect(playbackTimeline).toHaveBeenCalledWith({ kind: 'speed', value: 2 })
    expect((testid('speed') as HTMLSelectElement).value).toBe('2')
  })

  it('without a duration the seek bar is disabled and says why', () => {
    begin(null, 0)
    render(createElement(DemoTimeline))
    const seek = testid('seek')
    expect(seek.getAttribute('aria-disabled')).toBe('true')
    expect(testid('seek-reason').textContent).toBe("Seeking by click needs the demo's length")
    seek.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
    fireEvent.click(seek, { clientX: 50 })
    fireEvent.keyDown(seek, { key: 'ArrowRight' })
    expect(playbackTimeline).not.toHaveBeenCalled()
  })

  it('a refusal or a rejected call shows an inline alert and does not throw', async () => {
    begin(60_000, 0)
    render(createElement(DemoTimeline))
    playbackTimeline.mockResolvedValueOnce({
      ok: false,
      error: { key: 'replays.timeline.error' },
    })
    fireEvent.click(testid('toggle'))
    expect((await screen.findByTestId('replays-timeline-error')).textContent).toContain('could not')
    playbackTimeline.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(testid('back'))
    await vi.waitFor(() => expect(screen.getByTestId('replays-timeline-error')).toBeTruthy())
  })

  it('the fullscreen button resumes a paused demo, then enters fullscreen', async () => {
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    act(() => usePlaybackStore.getState().applyPosition(1000, null))
    act(() => usePlaybackStore.getState().applyPosition(1000, null))
    expect(testid('state').textContent).toBe('Paused')
    fireEvent.click(testid('fullscreen'))
    await vi.waitFor(() => expect(playbackTimeline).toHaveBeenCalledTimes(2))
    expect(playbackTimeline.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'togglePause' },
      { kind: 'fullscreen' },
    ])
  })

  it('the fullscreen button enters fullscreen directly while playing and shows a refusal', async () => {
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    playbackTimeline.mockResolvedValueOnce({
      ok: false,
      error: { key: 'replays.playback.error.fullscreen' },
    })
    fireEvent.click(testid('fullscreen'))
    expect((await screen.findByTestId('replays-timeline-error')).textContent).toBeTruthy()
    expect(playbackTimeline.mock.calls.map((c) => c[0])).toEqual([{ kind: 'fullscreen' }])
  })

  it('in fullscreen the timeline shows the keys text and disables its controls', () => {
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    act(() => usePlaybackStore.getState().applyDisplay({ fullscreen: true }))
    expect(testid('keys').textContent).toContain('Back to window')
    for (const id of ['toggle', 'back', 'forward', 'speed']) {
      expect((testid(id) as HTMLButtonElement).disabled).toBe(true)
    }
    // No view buttons once fullscreen: the game's own "Back to window" key is the way back.
    expect(screen.queryByTestId('replays-timeline-cinema')).toBeNull()
    expect(screen.queryByTestId('replays-timeline-fullscreen')).toBeNull()
    expect(testid('seek').getAttribute('aria-disabled')).toBe('true')
    expect(screen.queryByTestId('replays-timeline-position')).toBeNull()
    expect(screen.queryByTestId('replays-timeline-duration')).toBeNull()
    act(() => usePlaybackStore.getState().applyDisplay({ fullscreen: false }))
    expect(screen.queryByTestId('replays-timeline-keys')).toBeNull()
    expect((testid('toggle') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('DemoTimeline (story 184 D3)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('the toggle shows the expected state before any readback', () => {
    playbackTimeline.mockReturnValue(new Promise(() => {}))
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    expect(testid('toggle').getAttribute('aria-label')).toBe('Pause')
    fireEvent.click(testid('toggle'))
    expect(testid('toggle').getAttribute('aria-label')).toBe('Play')
    expect(testid('state').textContent).toBe('Paused')
  })

  it('the waiting text names the affected control', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    playbackTimeline.mockReturnValue(new Promise(() => {}))
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    fireEvent.click(testid('forward'))
    expect(screen.queryByTestId('replays-timeline-waiting')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1100)
    })
    const waiting = testid('waiting')
    expect(waiting.textContent).toBe('Waiting for the game… (seek)')
    const forward = testid('forward')
    expect(forward.getAttribute('aria-busy')).toBe('true')
    expect(forward.getAttribute('aria-describedby')).toBe(waiting.id)
    expect(testid('back').getAttribute('aria-busy')).toBe('true')
    expect(testid('seek').getAttribute('aria-busy')).toBe('true')
    expect(testid('toggle').getAttribute('aria-busy')).toBeNull()
    expect(testid('toggle').getAttribute('aria-describedby')).toBeNull()
  })
})

describe('DemoTimeline (story 187 D6)', () => {
  it('offers cinema and fullscreen buttons, and exit cinema while in cinema', async () => {
    playbackCinema.mockResolvedValue({ ok: true, value: undefined })
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(testid('cinema').getAttribute('aria-label')).toBe('Cinema mode')
    expect(testid('fullscreen').getAttribute('aria-label')).toBe('Fullscreen')
    fireEvent.click(testid('cinema'))
    expect(playbackCinema).toHaveBeenCalledWith(true)
    act(() => usePlaybackStore.getState().applyDisplay({ fullscreen: false, cinema: true }))
    expect(testid('cinema').getAttribute('aria-label')).toBe('Exit cinema mode')
    expect(testid('cinema').getAttribute('data-mode')).toBe('cinema')
    fireEvent.click(testid('cinema'))
    await vi.waitFor(() => expect(playbackCinema).toHaveBeenLastCalledWith(false))
    fireEvent.click(testid('fullscreen'))
    await vi.waitFor(() => expect(playbackTimeline).toHaveBeenCalledWith({ kind: 'fullscreen' }))
  })

  it('cinema is disabled with its reason as visible text', () => {
    begin(60_000, 1000)
    render(createElement(DemoTimeline))
    act(() =>
      usePlaybackStore.getState().applyDisplay({
        fullscreen: false,
        cinema: false,
        cinemaAvailability: {
          available: false,
          reason: { key: 'replays.cinema.unavailable.notPrimaryDisplay' },
        },
      }),
    )
    const cinema = testid('cinema')
    expect(cinema.getAttribute('aria-disabled')).toBe('true')
    expect(cinema.getAttribute('aria-describedby')).toBe(testid('cinema-reason').id)
    expect(testid('cinema-reason').textContent).toContain('not on the primary display')
    fireEvent.click(cinema)
    expect(playbackCinema).not.toHaveBeenCalled()
  })
})

describe('DemoTimeline comments', () => {
  const DEMO_ID = 'd1'
  const commentEdit = vi.fn()
  const onRowPatched = vi.fn()

  function demoRow(comments: SidecarComment[]): DemoRow {
    return {
      id: DEMO_ID,
      archiveEntry: null,
      sidecar: { state: 'ok', values: { comments } },
    } as unknown as DemoRow
  }

  function playDemo(comments: SidecarComment[], positionMs = 65_000): void {
    useDemoEditorStore.setState({ commentEdit } as never)
    commentEdit.mockResolvedValue({ status: 'saved' })
    act(() => {
      usePlaybackStore.getState().beginSession('a.dm2', 125_000, { id: DEMO_ID, archived: false })
      usePlaybackStore.getState().applyPosition(positionMs, null, false)
    })
    render(createElement(DemoTimeline, { demo: demoRow(comments), onRowPatched }))
  }

  afterEach(() => {
    commentEdit.mockReset()
  })

  it('add comment while playing pauses first and pins the clicked position', async () => {
    playDemo([])
    const clickedMs = Number(testid('seek').getAttribute('data-position-ms'))

    await act(async () => {
      fireEvent.click(testid('add-comment'))
    })
    expect(playbackTimeline).toHaveBeenCalledTimes(1)
    expect(playbackTimeline).toHaveBeenCalledWith({ kind: 'togglePause' })
    // The pause lands later and further on; the comment stays where the click was.
    act(() => usePlaybackStore.getState().applyPosition(70_000, null, true))

    expect(testid('comment-form').textContent).toContain('Comment at 1:05')
    const field = testid('comment-field') as HTMLInputElement
    expect(field.maxLength).toBe(500)
    fireEvent.change(field, { target: { value: 'flag grab' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })

    expect(commentEdit).toHaveBeenCalledTimes(1)
    const [id, op, patcher] = commentEdit.mock.calls[0]!
    expect(id).toBe(DEMO_ID)
    expect(patcher).toBe(onRowPatched)
    expect(op).toMatchObject({ kind: 'add', text: 'flag grab' })
    expect(op.atMs).toBeGreaterThanOrEqual(clickedMs)
    expect(op.atMs).toBeLessThan(66_000)
    expect(screen.queryByTestId('replays-timeline-comment-field')).toBeNull()
  })

  it('a refused pause opens no comment field', async () => {
    playbackTimeline.mockResolvedValue({ ok: false, error: { key: 'replays.timeline.error' } })
    playDemo([])

    await act(async () => {
      fireEvent.click(testid('add-comment'))
    })

    expect(screen.queryByTestId('replays-timeline-comment-field')).toBeNull()
    expect(testid('error')).toBeTruthy()
  })

  it('Escape closes the field without saving', async () => {
    playDemo([])
    act(() => usePlaybackStore.getState().applyPosition(65_000, null, true))
    await act(async () => {
      fireEvent.click(testid('add-comment'))
    })
    expect(playbackTimeline).not.toHaveBeenCalled()

    fireEvent.keyDown(testid('comment-field'), { key: 'Escape' })

    expect(screen.queryByTestId('replays-timeline-comment-field')).toBeNull()
    expect(commentEdit).not.toHaveBeenCalled()
  })

  it('each comment is a mark beside the slider that shows its text and seeks to its time', () => {
    playDemo([{ atMs: 62_900, text: 'flag grab' }])

    const mark = testid('comment-mark')
    expect(testid('seek').contains(mark)).toBe(false)
    expect(mark.style.left).toBe(`${(62_900 / 125_000) * 100}%`)
    expect(mark.getAttribute('aria-label')).toBe('Comment at 1:02: flag grab')
    expect(mark.getAttribute('data-at-ms')).toBe('62900')

    fireEvent.mouseEnter(mark)
    expect(testid('comment-bubble').textContent).toContain('flag grab')
    fireEvent.mouseLeave(mark)
    expect(screen.queryByTestId('replays-timeline-comment-bubble')).toBeNull()
    fireEvent.focus(mark)
    expect(testid('comment-bubble').textContent).toContain('flag grab')

    fireEvent.click(mark)
    expect(playbackTimeline).toHaveBeenCalledTimes(1)
    expect(playbackTimeline).toHaveBeenCalledWith({ kind: 'seekTo', seconds: 62 })
  })

  it('at 200 comments Add comment is disabled and says why', () => {
    playDemo(Array.from({ length: 200 }, (_, i) => ({ atMs: i * 100, text: `c${i}` })))

    expect(testid('add-comment').getAttribute('aria-disabled')).toBe('true')
    expect(testid('comment-reason').textContent).toBe('A demo holds at most 200 comments.')
  })

  it("a zip demo's Add comment is disabled, focusable and says why", async () => {
    useDemoEditorStore.setState({ commentEdit } as never)
    act(() => {
      usePlaybackStore.getState().beginSession('a.dm2', 125_000, { id: DEMO_ID, archived: true })
    })
    render(createElement(DemoTimeline, { demo: demoRow([]), onRowPatched }))

    const add = testid('add-comment') as HTMLButtonElement
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(add.disabled).toBe(false)
    expect(add.getAttribute('aria-describedby')).toBe(testid('comment-reason').id)
    expect(testid('comment-reason').textContent).toContain('zip')
    await act(async () => {
      fireEvent.click(add)
    })
    expect(screen.queryByTestId('replays-timeline-comment-field')).toBeNull()
    expect(playbackTimeline).not.toHaveBeenCalled()
  })

  it('fullscreen shows no marks and disables Add comment', () => {
    playDemo([{ atMs: 10_000, text: 'x' }])
    act(() => usePlaybackStore.getState().applyDisplay({ fullscreen: true }))

    expect(screen.queryByTestId('replays-timeline-comment-mark')).toBeNull()
    expect((testid('add-comment') as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers no comments for a session without its demo row', () => {
    begin(125_000, 1000)
    render(createElement(DemoTimeline))

    expect(screen.queryByTestId('replays-timeline-add-comment')).toBeNull()
  })
})
