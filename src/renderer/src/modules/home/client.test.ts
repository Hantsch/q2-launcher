// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsFeed } from '@shared/modules/home'
import type { ModuleEvent } from '@shared/types'

/**
 * Story 082 D7. Same module-scope-bridge stubbing as `moduleClient.test.ts`: the client under
 * test imports `moduleClient.ts`, which reaches `window.q2` through `lib/bridge.ts` at import
 * time.
 */
type Listener = (payload: unknown) => void

let onListener: Listener | undefined

const invokeMock = vi.fn()
const onMock = vi.fn((_channel: string, listener: Listener) => {
  onListener = listener
  return () => {
    onListener = undefined
  }
})

;(globalThis as unknown as { q2: unknown }).q2 = { invoke: invokeMock, on: onMock }

const { getNews, refreshNews, onNewsChanged } = await import('./client')

const FEED: NewsFeed = {
  slides: [],
  retrievedAt: '2026-01-01T00:00:00.000Z',
  schemaAhead: false,
  lastRefreshFailed: false,
}

function emit(event: ModuleEvent): void {
  onListener?.(event)
}

beforeEach(() => {
  invokeMock.mockReset()
  onMock.mockClear()
  onListener = undefined
})

describe('home client', () => {
  it('getNews calls through to news.get on the home module', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: FEED })

    const result = await getNews()

    expect(invokeMock).toHaveBeenCalledWith('module:invoke', { moduleId: 'home', type: 'news.get' })
    expect(result).toEqual({ ok: true, value: FEED })
  })

  it('refreshNews calls through to news.refresh on the home module', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: FEED })

    const result = await refreshNews()

    expect(invokeMock).toHaveBeenCalledWith('module:invoke', {
      moduleId: 'home',
      type: 'news.refresh',
    })
    expect(result).toEqual({ ok: true, value: FEED })
  })

  it('onNewsChanged is notified only for the home module’s news.changed push', () => {
    const listener = vi.fn()
    const unsubscribe = onNewsChanged(listener)

    emit({ moduleId: 'library', type: 'news.changed', payload: FEED })
    expect(listener).not.toHaveBeenCalled()

    emit({ moduleId: 'home', type: 'news.changed', payload: FEED })
    expect(listener).toHaveBeenCalledWith(FEED)

    unsubscribe()
    listener.mockClear()
    emit({ moduleId: 'home', type: 'news.changed', payload: FEED })
    expect(listener).not.toHaveBeenCalled()
  })
})
