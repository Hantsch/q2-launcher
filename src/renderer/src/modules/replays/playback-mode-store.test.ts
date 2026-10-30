import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../test-support/mock-client'

const readPlaybackMode = vi.fn()
const setPlaybackMode = vi.fn()
vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    readPlaybackMode: (...args: unknown[]) => readPlaybackMode(...args),
    setPlaybackMode: (...args: unknown[]) => setPlaybackMode(...args),
  }),
)

import { usePlaybackModeStore } from './playback-mode-store'

beforeEach(() => {
  readPlaybackMode.mockReset()
  setPlaybackMode.mockReset()
  usePlaybackModeStore.setState({ mode: 'engine', loaded: false, busy: false, error: null })
})

describe('playback mode store', () => {
  it('load reads once and later calls are no-ops', async () => {
    readPlaybackMode.mockResolvedValue({ ok: true, value: 'integrated' })
    await Promise.all([
      usePlaybackModeStore.getState().load(),
      usePlaybackModeStore.getState().load(),
    ])
    await usePlaybackModeStore.getState().load()
    expect(readPlaybackMode).toHaveBeenCalledTimes(1)
    expect(usePlaybackModeStore.getState()).toMatchObject({ mode: 'integrated', loaded: true })
  })

  it("set takes main's returned mode and a refusal keeps the old one", async () => {
    setPlaybackMode.mockResolvedValueOnce({ ok: true, value: 'integrated' })
    await usePlaybackModeStore.getState().set('integrated')
    expect(usePlaybackModeStore.getState().mode).toBe('integrated')

    setPlaybackMode.mockResolvedValueOnce({
      ok: false,
      error: { key: 'replays.play.error.fileMissing' },
    })
    await usePlaybackModeStore.getState().set('engine')
    expect(usePlaybackModeStore.getState().mode).toBe('integrated')
    expect(usePlaybackModeStore.getState().error).toEqual({ key: 'replays.play.error.fileMissing' })
    expect(usePlaybackModeStore.getState().busy).toBe(false)
  })
})
