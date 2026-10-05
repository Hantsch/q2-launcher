// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DemoRow } from '@shared/modules/replays'
import type { SidecarComment } from '@shared/replays/sidecar'
import { initI18n } from '../../../i18n'

const invokeMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, value: null })))
vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: vi.fn(() => () => {}) }
})

const commentEdit = vi.fn()

const demoPlay = vi.hoisted(() => ({
  play: vi.fn(async () => {}),
  eligibility: { ok: true } as Record<string, unknown>,
}))
vi.mock('../useDemoPlay', () => ({
  useDemoPlay: () => ({
    eligibility: demoPlay.eligibility,
    busy: false,
    error: null,
    play: demoPlay.play,
  }),
}))

let DemoCommentsList: typeof import('./DemoCommentsList').DemoCommentsList
let useDemoEditorStore: typeof import('../demo-editor-store').useDemoEditorStore
let usePlaybackStore: typeof import('../playback-store').usePlaybackStore

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoCommentsList } = await import('./DemoCommentsList'))
  ;({ useDemoEditorStore } = await import('../demo-editor-store'))
  ;({ usePlaybackStore } = await import('../playback-store'))
})

afterEach(() => {
  cleanup()
  commentEdit.mockReset()
  demoPlay.play.mockClear()
  demoPlay.eligibility = { ok: true }
  usePlaybackStore.setState({ session: null })
})

const ID = '0123456789abcdef'

function rowWith(comments: SidecarComment[], archived = false): DemoRow {
  return {
    id: ID,
    archiveEntry: archived ? { archivePath: '/demos/a.zip', entryPath: 'x.dm2' } : null,
    sidecar: { state: 'ok', values: { comments } },
  } as unknown as DemoRow
}

function renderList(row: DemoRow) {
  useDemoEditorStore.setState({ commentEdit } as never)
  render(createElement(DemoCommentsList, { row, onRowPatched: vi.fn() }))
}

const COMMENTS: SidecarComment[] = [
  { atMs: 125_000, text: 'late' },
  { atMs: 41_000, text: 'flag grab' },
]

function startEditing(index: number): HTMLInputElement {
  fireEvent.click(screen.getAllByTestId('replays-comment-edit')[index]!)
  return screen.getByTestId('replays-comment-input') as HTMLInputElement
}

describe('DemoCommentsList', () => {
  it('lists comments sorted by time, each with its time', () => {
    renderList(rowWith(COMMENTS))

    const items = screen.getAllByTestId('replays-detail-comment')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('0:41')
    expect(items[0]?.textContent).toContain('flag grab')
    expect(items[0]?.getAttribute('data-at-ms')).toBe('41000')
    expect(items[1]?.textContent).toContain('2:05')
  })

  it('says so when a demo has no comments', () => {
    renderList(rowWith([]))
    expect(screen.getByTestId('replays-detail-comments-empty').textContent).toBe('No comments yet.')
  })

  it('Enter saves an edited comment', async () => {
    commentEdit.mockResolvedValue({ status: 'saved' })
    renderList(rowWith(COMMENTS))

    const input = startEditing(0)
    expect(input.maxLength).toBe(500)
    fireEvent.change(input, { target: { value: 'flag taken' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(commentEdit).toHaveBeenCalledWith(
        ID,
        { kind: 'edit', atMs: 41_000, text: 'flag grab', newText: 'flag taken' },
        expect.any(Function),
      ),
    )
    await waitFor(() => expect(screen.queryByTestId('replays-comment-input')).toBeNull())
  })

  it('editing one of two identical comments opens only that one', () => {
    renderList(rowWith([...COMMENTS, { atMs: 41_000, text: 'flag grab' }]))

    startEditing(1)

    expect(screen.getAllByTestId('replays-comment-input')).toHaveLength(1)
    expect(screen.getAllByTestId('replays-comment-text')).toHaveLength(2)
  })

  it('Escape reverts an edit without saving', () => {
    renderList(rowWith(COMMENTS))

    const input = startEditing(0)
    fireEvent.change(input, { target: { value: 'other' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByTestId('replays-comment-input')).toBeNull()
    expect(screen.getAllByTestId('replays-comment-text')[0]?.textContent).toBe('flag grab')
    expect(commentEdit).not.toHaveBeenCalled()
  })

  it('a blank comment is refused with a visible reason and the field stays open', () => {
    renderList(rowWith(COMMENTS))

    const input = startEditing(0)
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByTestId('replays-detail-comments-error').textContent).toBe(
      'A comment cannot be empty.',
    )
    expect(commentEdit).not.toHaveBeenCalled()
    expect((screen.getByTestId('replays-comment-input') as HTMLInputElement).value).toBe('   ')
  })

  it('a refused save keeps the typed text and shows the reason', async () => {
    commentEdit.mockResolvedValue({ status: 'refused', key: 'replays.comments.error.notFound' })
    renderList(rowWith(COMMENTS))

    const input = startEditing(0)
    fireEvent.change(input, { target: { value: 'typed' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByTestId('replays-detail-comments-error')).toBeTruthy())
    expect((screen.getByTestId('replays-comment-input') as HTMLInputElement).value).toBe('typed')
  })

  it('the delete button removes the comment at once', async () => {
    commentEdit.mockResolvedValue({ status: 'saved' })
    renderList(rowWith(COMMENTS))

    fireEvent.click(screen.getAllByTestId('replays-comment-delete')[1]!)

    await waitFor(() =>
      expect(commentEdit).toHaveBeenCalledWith(
        ID,
        { kind: 'remove', atMs: 125_000, text: 'late' },
        expect.any(Function),
      ),
    )
  })

  it('an archive entry lists comments read-only with the visible reason', () => {
    renderList(rowWith(COMMENTS, true))

    expect(screen.getAllByTestId('replays-detail-comment')).toHaveLength(2)
    expect(screen.queryByTestId('replays-comment-edit')).toBeNull()
    expect(screen.queryByTestId('replays-comment-delete')).toBeNull()
    expect(screen.getByTestId('replays-detail-comments-readonly').textContent).toBe(
      'Demos inside a zip cannot carry comments',
    )
  })
})

describe('Play from here', () => {
  const playButtons = (): HTMLElement[] => screen.getAllByTestId('replays-detail-comment-play')

  it('starts the demo at the comment when it is not playing', () => {
    renderList(rowWith(COMMENTS))

    // Sorted by time: index 0 is the comment at 0:41.
    expect(playButtons()[0]!.getAttribute('aria-label')).toBe('Play from 0:41')
    fireEvent.click(playButtons()[0]!)

    expect(demoPlay.play).toHaveBeenCalledWith(false, 41)
  })

  it('seeks the running session when this demo is already playing', async () => {
    const sendTimeline = vi.fn(async () => null)
    usePlaybackStore.setState({ session: { demoId: ID } as never, sendTimeline })
    renderList(rowWith(COMMENTS))

    fireEvent.click(playButtons()[1]!)

    await waitFor(() => expect(sendTimeline).toHaveBeenCalledWith({ kind: 'seekTo', seconds: 125 }))
    expect(demoPlay.play).not.toHaveBeenCalled()
  })

  it('is disabled with the visible reason when the demo cannot be played', () => {
    demoPlay.eligibility = { ok: false, reasonKey: 'replays.play.unavailable.gameRunning' }
    renderList(rowWith(COMMENTS))

    for (const button of playButtons()) expect((button as HTMLButtonElement).disabled).toBe(true)
    const reason = screen.getByTestId('replays-detail-comment-play-reason')
    expect(reason.textContent).not.toBe('')
    expect(reason.textContent).not.toContain('replays.play')
  })
})
