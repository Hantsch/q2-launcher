// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Outcome } from '@shared/types'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: async () => ({ ok: true, value: null }),
    on: () => () => {},
  }
})

let useProfileSave: typeof import('./useProfileSave').useProfileSave
let SAVE_DEBOUNCE_MS: number
let useLauncher: typeof import('../../../store/useLauncher').useLauncher

beforeAll(async () => {
  ;({ useProfileSave, SAVE_DEBOUNCE_MS } = await import('./useProfileSave'))
  ;({ useLauncher } = await import('../../../store/useLauncher'))
})

const REFUSED: Outcome<string> = { ok: false, error: { key: 'config.error.writeFailed' } }
const saved = (value: string): Outcome<string> => ({ ok: true, value })

let pushToast: ReturnType<typeof vi.fn>
let onChanged: ReturnType<typeof vi.fn<(value: string) => void>>

beforeEach(() => {
  vi.useFakeTimers()
  pushToast = vi.fn()
  onChanged = vi.fn<(value: string) => void>()
  useLauncher.setState({ pushToast } as never)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function hook(profileId = 'p1') {
  return renderHook(
    (props: { profileId: string }) =>
      useProfileSave<string>({ profileId: props.profileId, onChanged }),
    { initialProps: { profileId } },
  )
}

async function elapseDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
  })
}

function deferred<V>() {
  let resolve!: (value: V) => void
  const promise = new Promise<V>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useProfileSave', () => {
  it('coalesces edits inside the debounce window into one save', async () => {
    const { result } = hook()
    const runs = [vi.fn(async () => saved('a')), vi.fn(async () => saved('ab'))]
    const applies = [vi.fn(), vi.fn()]

    act(() => result.current.schedule({ apply: applies[0], revert: vi.fn(), run: runs[0] }))
    expect(applies[0]).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('saving')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1)
    })
    act(() => result.current.schedule({ apply: applies[1], revert: vi.fn(), run: runs[1] }))
    expect(applies[1]).toHaveBeenCalledTimes(1)
    await elapseDebounce()

    expect(runs[0]).not.toHaveBeenCalled()
    expect(runs[1]).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('ab')
    expect(result.current.status).toBe('saved')
  })

  it('saveNow cancels a pending debounced save', async () => {
    const { result } = hook()
    const debounced = vi.fn(async () => saved('typed'))
    act(() => result.current.schedule({ apply: vi.fn(), revert: vi.fn(), run: debounced }))

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveNow({ run: async () => saved('structural') })
    })
    await elapseDebounce()

    expect(ok).toBe(true)
    expect(debounced).not.toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('structural')
    expect(result.current.status).toBe('saved')
    expect(result.current.saving).toBe(false)
  })

  it('a refused debounced save reverts to the snapshot from the first edit', async () => {
    const { result } = hook()
    const firstRevert = vi.fn()
    const laterRevert = vi.fn()
    act(() => result.current.schedule({ apply: vi.fn(), revert: firstRevert, run: async () => REFUSED }))
    act(() => result.current.schedule({ apply: vi.fn(), revert: laterRevert, run: async () => REFUSED }))
    await elapseDebounce()

    expect(firstRevert).toHaveBeenCalledTimes(1)
    expect(laterRevert).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('a refused save pushes one error toast with the refusal key', async () => {
    const { result } = hook()
    act(() => result.current.schedule({ apply: vi.fn(), revert: vi.fn(), run: async () => REFUSED }))
    act(() => result.current.schedule({ apply: vi.fn(), revert: vi.fn(), run: async () => REFUSED }))
    await elapseDebounce()
    expect(pushToast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ level: 'error', messageKey: 'config.error.writeFailed' }),
    )

    pushToast.mockClear()
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveNow({ run: async () => REFUSED })
    })
    expect(ok).toBe(false)
    expect(pushToast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ level: 'error', messageKey: 'config.error.writeFailed' }),
    )
    expect(result.current.status).toBe('idle')
  })

  it('a profile switch drops the pending save', async () => {
    const { result, rerender } = hook('p1')
    const run = vi.fn(async () => saved('p1'))
    act(() => result.current.schedule({ apply: vi.fn(), revert: vi.fn(), run }))
    rerender({ profileId: 'p2' })
    await elapseDebounce()

    expect(run).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('ignores a save result that lands after a profile switch', async () => {
    const { result, rerender } = hook('p1')
    const late = deferred<Outcome<string>>()
    const revert = vi.fn()
    act(() => result.current.schedule({ apply: vi.fn(), revert, run: () => late.promise }))
    await elapseDebounce()
    rerender({ profileId: 'p2' })
    await act(async () => late.resolve(REFUSED))

    expect(revert).not.toHaveBeenCalled()
    expect(pushToast).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('ignores a save result that lands after unmount', async () => {
    const { result, unmount } = hook()
    const late = deferred<Outcome<string>>()
    const revert = vi.fn()
    act(() => result.current.schedule({ apply: vi.fn(), revert, run: () => late.promise }))
    await elapseDebounce()
    unmount()
    await act(async () => late.resolve(REFUSED))

    expect(revert).not.toHaveBeenCalled()
    expect(pushToast).not.toHaveBeenCalled()
  })

  it('a refused save that a newer edit superseded does not revert over that edit', async () => {
    const { result } = hook()
    const inFlight = deferred<Outcome<string>>()
    const olderRevert = vi.fn()
    act(() =>
      result.current.schedule({ apply: vi.fn(), revert: olderRevert, run: () => inFlight.promise }),
    )
    await elapseDebounce()
    act(() =>
      result.current.schedule({ apply: vi.fn(), revert: vi.fn(), run: async () => saved('newer') }),
    )
    await act(async () => inFlight.resolve(REFUSED))

    expect(olderRevert).not.toHaveBeenCalled()
    expect(result.current.status).toBe('saving')
    await elapseDebounce()
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('newer')
    expect(result.current.status).toBe('saved')
  })
})
