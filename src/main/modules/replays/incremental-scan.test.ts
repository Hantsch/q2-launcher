import { describe, expect, it, vi } from 'vitest'
import type { CachedDemo } from './index-cache'
import {
  LIVE_WRITE_WINDOW_MS,
  runIncrementalScan,
  type IncrementalScanFile,
  type RunIncrementalScanInput,
} from './incremental-scan'

interface TestFile extends IncrementalScanFile {
  path: string
}

const NOW = 1_000_000

function file(id: string, size: number, mtimeMs: number): TestFile {
  return { id, size, mtimeMs, path: `/demos/${id}.dm2` }
}

function baseInput(
  overrides: Partial<RunIncrementalScanInput<TestFile>> = {},
): RunIncrementalScanInput<TestFile> {
  return {
    sources: [],
    cache: new Map<string, CachedDemo>(),
    patternFingerprint: 'fp-1',
    parse: vi.fn(async (f: TestFile) => ({ parsedFor: f.id })),
    matchName: vi.fn((f: TestFile) => ({ nameFor: f.id })),
    now: NOW,
    isGameRunning: false,
    onProgress: vi.fn(),
    yieldNow: async () => {},
    ...overrides,
  }
}

describe('runIncrementalScan', () => {
  it('an unchanged file is not parsed again', async () => {
    const f = file('a', 100, 5000)
    const parse = vi.fn(async () => ({ parsed: true }))
    const input = baseInput({
      sources: [{ sourceKey: 's1', files: [f] }],
      parse,
    })

    const first = await runIncrementalScan(input)
    expect(parse).toHaveBeenCalledTimes(1)

    const second = await runIncrementalScan({ ...input, cache: first.nextCache })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(second.entries).toEqual(first.entries)
  })

  it('a file with changed size is re-parsed only for that file', async () => {
    const a = file('a', 100, 5000)
    const b = file('b', 200, 6000)
    const parse = vi.fn(async (f: TestFile) => ({ parsedFor: f.id }))
    const input = baseInput({ sources: [{ sourceKey: 's1', files: [a, b] }], parse })
    const first = await runIncrementalScan(input)

    const aChanged = file('a', 999, 5000)
    parse.mockClear()
    const second = await runIncrementalScan({
      ...input,
      sources: [{ sourceKey: 's1', files: [aChanged, b] }],
      cache: first.nextCache,
    })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledWith(aChanged)
    expect(second.entries.get('a')?.size).toBe(999)
  })

  it('a file with changed mtime is re-parsed only for that file', async () => {
    const a = file('a', 100, 5000)
    const b = file('b', 200, 6000)
    const parse = vi.fn(async (f: TestFile) => ({ parsedFor: f.id }))
    const input = baseInput({ sources: [{ sourceKey: 's1', files: [a, b] }], parse })
    const first = await runIncrementalScan(input)

    const aChanged = file('a', 100, 5001)
    parse.mockClear()
    const second = await runIncrementalScan({
      ...input,
      sources: [{ sourceKey: 's1', files: [aChanged, b] }],
      cache: first.nextCache,
    })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledWith(aChanged)
    expect(second.entries.get('a')?.mtimeMs).toBe(5001)
  })

  it('a new file is parsed and added', async () => {
    const a = file('a', 100, 5000)
    const parse = vi.fn(async (f: TestFile) => ({ parsedFor: f.id }))
    const input = baseInput({ sources: [{ sourceKey: 's1', files: [a] }], parse })

    const result = await runIncrementalScan(input)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(result.entries.has('a')).toBe(true)
    expect(result.nextCache.has('a')).toBe(true)
  })

  it('a deleted file disappears from entries and from the next cache', async () => {
    const a = file('a', 100, 5000)
    const b = file('b', 200, 6000)
    const input = baseInput({ sources: [{ sourceKey: 's1', files: [a, b] }] })
    const first = await runIncrementalScan(input)
    expect(first.entries.has('b')).toBe(true)

    const second = await runIncrementalScan({
      ...input,
      sources: [{ sourceKey: 's1', files: [a] }],
      cache: first.nextCache,
    })
    expect(second.entries.has('b')).toBe(false)
    expect(second.nextCache.has('b')).toBe(false)
  })

  it('a pattern change re-runs only the name matcher', async () => {
    const a = file('a', 100, 5000)
    const parse = vi.fn(async () => ({ parsed: true }))
    const matchName = vi.fn(() => ({ name: 'v1' }))
    const input = baseInput({
      sources: [{ sourceKey: 's1', files: [a] }],
      patternFingerprint: 'fp-1',
      parse,
      matchName,
    })
    const first = await runIncrementalScan(input)
    expect(matchName).toHaveBeenCalledTimes(1)

    parse.mockClear()
    matchName.mockClear()
    matchName.mockReturnValue({ name: 'v2' })
    const second = await runIncrementalScan({
      ...input,
      patternFingerprint: 'fp-2',
      cache: first.nextCache,
    })

    expect(parse).not.toHaveBeenCalled()
    expect(matchName).toHaveBeenCalledTimes(1)
    expect(second.entries.get('a')?.name).toEqual({ name: 'v2' })
    expect(second.entries.get('a')?.patternFingerprint).toBe('fp-2')
    expect(second.nextCache.get('a')?.patternFingerprint).toBe('fp-2')
    expect(second.nextCache.get('a')?.name).toEqual({ name: 'v2' })
  })

  it('while a game runs, a cache-miss file modified under 30s ago is skipped and picked up once it is quiet', async () => {
    const recent = file('a', 100, NOW - 5000)
    const parse = vi.fn(async () => ({ parsed: true }))
    const input = baseInput({
      sources: [{ sourceKey: 's1', files: [recent] }],
      isGameRunning: true,
      parse,
    })

    const skipped = await runIncrementalScan(input)
    expect(parse).not.toHaveBeenCalled()
    expect(skipped.entries.has('a')).toBe(false)
    expect(skipped.nextCache.has('a')).toBe(false)
    expect(skipped.skippedLive).toBe(1)

    const quiet = file('a', 100, NOW - 60_000)
    const result = await runIncrementalScan({
      ...input,
      sources: [{ sourceKey: 's1', files: [quiet] }],
      cache: skipped.nextCache,
      parse,
    })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(result.entries.has('a')).toBe(true)
    expect(result.nextCache.has('a')).toBe(true)
  })

  it('with no game running, a fresh file is parsed normally', async () => {
    const recent = file('a', 100, NOW - 1000)
    const parse = vi.fn(async () => ({ parsed: true }))
    const input = baseInput({
      sources: [{ sourceKey: 's1', files: [recent] }],
      isGameRunning: false,
      parse,
    })

    const result = await runIncrementalScan(input)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(result.entries.has('a')).toBe(true)
    expect(result.skippedLive).toBe(0)
  })

  it('a live-looking file that is a cache hit is still reused', async () => {
    const a = file('a', 100, NOW - 5000)
    const parse = vi.fn(async () => ({ parsed: true }))
    const cache = new Map<string, CachedDemo>([
      [
        'a',
        {
          size: 100,
          mtimeMs: NOW - 5000,
          patternFingerprint: 'fp-1',
          parsed: { p: 1 },
          name: { n: 1 },
        },
      ],
    ])
    const input = baseInput({
      sources: [{ sourceKey: 's1', files: [a] }],
      isGameRunning: true,
      cache,
      parse,
    })

    const result = await runIncrementalScan(input)
    expect(parse).not.toHaveBeenCalled()
    expect(result.skippedLive).toBe(0)
    expect(result.entries.has('a')).toBe(true)
    expect(result.nextCache.has('a')).toBe(true)
  })

  it('progress is reported per source as scanned / total', async () => {
    const makeFiles = (prefix: string, count: number): TestFile[] =>
      Array.from({ length: count }, (_, i) => file(`${prefix}-${i}`, 1, 1))

    const onProgress = vi.fn()
    const input = baseInput({
      sources: [
        { sourceKey: 's-small', files: makeFiles('small', 3) },
        { sourceKey: 's-big', files: makeFiles('big', 60) },
        { sourceKey: 's-other', files: makeFiles('other', 10) },
      ],
      onProgress,
    })

    await runIncrementalScan(input)

    const calls = onProgress.mock.calls
    expect(calls).toContainEqual(['s-big', 25, 60])
    expect(calls).toContainEqual(['s-big', 50, 60])
    expect(calls).toContainEqual(['s-big', 60, 60])
    expect(calls).toContainEqual(['s-small', 3, 3])
    expect(calls).toContainEqual(['s-other', 10, 10])
  })

  it('exposes the live-write window constant', () => {
    expect(LIVE_WRITE_WINDOW_MS).toBe(30_000)
  })
})
