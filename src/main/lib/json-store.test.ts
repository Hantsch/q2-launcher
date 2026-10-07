import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fs = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  copyFile: vi.fn(),
  rename: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
}))

vi.mock('node:fs/promises', () => fs)

import { JsonStore } from './json-store'

function makeStore(onPersistError?: (error: unknown) => void): JsonStore<{ n: number }> {
  return new JsonStore({
    filePath: '/data/state.json',
    defaults: () => ({ n: 0 }),
    parse: (raw) => raw as { n: number },
    onPersistError,
  })
}

describe('JsonStore persistence failures', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fs.mkdir.mockResolvedValue(undefined)
    fs.writeFile.mockResolvedValue(undefined)
    fs.copyFile.mockResolvedValue(undefined)
    fs.rename.mockResolvedValue(undefined)
    fs.readFile.mockRejectedValue(new Error('ENOENT'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('a failed flush retries once after the delay and then succeeds silently', async () => {
    const onPersistError = vi.fn()
    const store = makeStore(onPersistError)
    await store.load()
    fs.writeFile.mockRejectedValueOnce(new Error('EBUSY'))

    store.set({ n: 1 })
    const settled = store.settle()
    await vi.advanceTimersByTimeAsync(500)

    await expect(settled).resolves.toEqual({ ok: true })
    expect(fs.writeFile).toHaveBeenCalledTimes(2)
    expect(onPersistError).not.toHaveBeenCalled()
  })

  it('a failed flush retries once, then reports through onPersistError and settle resolves { ok: false }', async () => {
    const onPersistError = vi.fn()
    const store = makeStore(onPersistError)
    await store.load()
    const failure = new Error('ENOSPC')
    fs.writeFile.mockRejectedValue(failure)

    store.set({ n: 1 })
    const settled = store.settle()
    await vi.advanceTimersByTimeAsync(500)

    await expect(settled).resolves.toEqual({ ok: false })
    expect(fs.writeFile).toHaveBeenCalledTimes(2)
    expect(onPersistError).toHaveBeenCalledTimes(1)
    expect(onPersistError).toHaveBeenCalledWith(failure)
  })

  it('a successful write after a failure makes settle resolve { ok: true } again', async () => {
    const store = makeStore()
    await store.load()
    fs.writeFile.mockRejectedValue(new Error('ENOSPC'))
    store.set({ n: 1 })
    const failed = store.settle()
    await vi.advanceTimersByTimeAsync(500)
    await expect(failed).resolves.toEqual({ ok: false })

    fs.writeFile.mockResolvedValue(undefined)
    store.set({ n: 2 })

    await expect(store.settle()).resolves.toEqual({ ok: true })
  })
})
