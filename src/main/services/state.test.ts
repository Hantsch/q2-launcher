import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

import { STATE_SCHEMA_VERSION } from '@shared/constants'
import { DEFAULT_SETTINGS, type Installation } from '@shared/types'
import { rename } from 'node:fs/promises'
import { StateStore, type StateSectionSpec } from './state'
import { installTempDir } from '../../test-support/temp-dir'

/** The top-level keys a fresh store writes; anything else in a file came from the file. */
const STATE_KEYS = ['schemaVersion', 'settings', 'installations']

describe('StateStore persistence', () => {
  let filePath: string
  const renameSpy = vi.mocked(rename)
  const jobsSpec: StateSectionSpec<{ concurrentJobs: number }> = {
    key: 'jobs',
    parse: (raw) => ({ concurrentJobs: (raw as { concurrentJobs?: number })?.concurrentJobs ?? 3 }),
    defaults: () => ({ concurrentJobs: 3 }),
  }
  const jobs = (state: StateStore) => state.section(jobsSpec)
  const downloads = (concurrentJobs: number) => ({ concurrentJobs })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renameSpy.mockClear()
    filePath = join(tmpdir(), `q2-launcher-state-persist-${randomUUID()}.json`)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('a burst of ten updates produces one write', async () => {
    const state = new StateStore(filePath)
    await state.load()
    for (let i = 1; i <= 10; i += 1) jobs(state).update(() => downloads(i))

    await vi.advanceTimersByTimeAsync(1000)
    await state.settle()

    expect(renameSpy).toHaveBeenCalledTimes(1)
  })

  it('settle() forces a pending debounced write to disk at once', async () => {
    const state = new StateStore(filePath)
    await state.load()
    jobs(state).update(() => downloads(4))
    expect(renameSpy).not.toHaveBeenCalled()

    const result = await state.settle()

    expect(result).toEqual({ ok: true })
    const reloaded = new StateStore(filePath)
    await reloaded.load()
    expect(jobs(reloaded).get().concurrentJobs).toBe(4)
  })

  it('a persist failure is forwarded to onPersistError once per session', async () => {
    // Real timers: the retry delay is armed only after real file I/O, so a fake clock advanced
    // up front would never reach it.
    vi.useRealTimers()
    const onPersistError = vi.fn()
    const state = new StateStore(filePath, { onPersistError })
    await state.load()
    renameSpy.mockRejectedValue(new Error('disk full'))

    for (const count of [2, 3]) {
      jobs(state).update(() => downloads(count))
      expect(await state.settle()).toEqual({ ok: false })
    }

    expect(onPersistError).toHaveBeenCalledTimes(1)
  })
})

describe('StateStore updateSlice', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-update-slice-${randomUUID()}.json`)
    state = new StateStore(filePath)
    await state.load()
    await state.settle()
    vi.mocked(rename).mockClear()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('updateSlice hands the callback the live value and keeps sibling keys', () => {
    const seen: unknown[] = []
    const first = [{ id: 'a' }] as unknown as Installation[]
    const second = [{ id: 'a' }, { id: 'b' }] as unknown as Installation[]
    state.updateSlice('installations', (live) => {
      seen.push(live)
      return first
    })
    state.updateSlice('installations', (live) => {
      seen.push(live)
      return second
    })

    expect(seen[0]).toEqual([])
    expect(seen[1]).toBe(first)
    expect(state.installations()).toBe(second)
    expect(state.settings()).toEqual(DEFAULT_SETTINGS)
  })

  it('updateSlice schedules no write when the callback returns the same reference', async () => {
    const returned = state.updateSlice('installations', (live) => live)
    await state.settle()

    expect(returned).toBe(state.installations())
    expect(rename).not.toHaveBeenCalled()
  })
})

describe('StateStore sections', () => {
  const dir = installTempDir('q2l-state-section-')
  let filePath: string

  interface Notes {
    items: string[]
  }
  const notesSpec = (): StateSectionSpec<Notes> => ({
    key: 'notes',
    parse: (raw) => {
      const items = (raw as { items?: unknown } | null)?.items
      return { items: Array.isArray(items) ? items.filter((i) => typeof i === 'string') : [] }
    },
    defaults: () => ({ items: ['default'] }),
  })

  const writeState = (doc: Record<string, unknown>, path = filePath) =>
    writeFile(path, JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, ...doc }))
  const readState = async (path = filePath) =>
    JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>

  beforeEach(() => {
    filePath = join(dir(), 'state.json')
    // Back to the real rename: an earlier suite leaves a rejecting implementation behind.
    vi.mocked(rename).mockReset()
  })

  it('a registered section parses its key and update writes it', async () => {
    await writeState({ notes: { items: ['a', 42] } })
    const state = new StateStore(filePath)
    await state.load()
    const notes = state.section(notesSpec())

    expect(notes.get()).toEqual({ items: ['a'] })
    const written = notes.update((live) => ({ items: [...live.items, 'b'] }))
    await state.settle()

    expect(written).toEqual({ items: ['a', 'b'] })
    expect(notes.get()).toBe(written)
    expect((await readState())['notes']).toEqual({ items: ['a', 'b'] })
  })

  it('a parsed section is written in its parsed form by the next save, even when unchanged', async () => {
    await writeState({ notes: { items: ['a', 42] } })
    const state = new StateStore(filePath)
    await state.load()
    state.section(notesSpec()).get()
    await state.settle()
    expect(rename).not.toHaveBeenCalled()

    state.patchSettings({})
    await state.settle()

    expect((await readState())['notes']).toEqual({ items: ['a'] })
  })

  it('an absent key reads as the spec defaults, without parsing', async () => {
    await writeState({})
    const state = new StateStore(filePath)
    await state.load()
    const parse = vi.fn(notesSpec().parse)

    expect(state.section({ ...notesSpec(), parse }).get()).toEqual({ items: ['default'] })
    expect(parse).not.toHaveBeenCalled()
  })

  it('a section registered before load reads the loaded value', async () => {
    await writeState({ notes: { items: ['on disk'] } })
    const state = new StateStore(filePath)
    const notes = state.section(notesSpec())
    await state.load()

    expect(notes.get()).toEqual({ items: ['on disk'] })
  })

  it('an unknown top-level key survives load and save verbatim', async () => {
    const future = { nested: { list: [1, 'two', null], flag: true }, other: 'x' }
    await writeState({ futureModule: future, notes: { items: ['a', 42] } })
    const state = new StateStore(filePath)
    await state.load()

    state.patchSettings({})
    await state.settle()

    const written = await readState()
    expect(written['futureModule']).toEqual(future)
    expect(written['notes']).toEqual({ items: ['a', 42] })
    expect(written['settings']).toEqual(state.settings())
  })

  it('a section registered after a save still parses the raw value that save kept', async () => {
    await writeState({ notes: { items: ['kept'] } })
    const state = new StateStore(filePath)
    await state.load()
    state.patchSettings({})
    await state.settle()

    expect(state.section(notesSpec()).get()).toEqual({ items: ['kept'] })
  })

  it('update returning the same reference schedules no write', async () => {
    await writeState({ notes: { items: ['a'] } })
    const state = new StateStore(filePath)
    await state.load()
    const notes = state.section(notesSpec())

    const returned = notes.update((live) => live)
    await state.settle()

    expect(returned).toBe(notes.get())
    expect(rename).not.toHaveBeenCalled()
  })

  it('registering a second spec for a key throws', async () => {
    const state = new StateStore(filePath)
    await state.load()
    const spec = notesSpec()
    const notes = state.section(spec)

    expect(state.section(spec)).toBe(notes)
    expect(() => state.section(notesSpec())).toThrow(/notes/)
  })

  it('a key the store owns itself cannot be registered as a section', async () => {
    const state = new StateStore(filePath)
    await state.load()

    for (const key of ['schemaVersion', 'settings', 'installations']) {
      expect(() => state.section({ ...notesSpec(), key }), key).toThrow(new RegExp(key))
    }
  })

  it('recovering from the backup keeps its unknown keys verbatim', async () => {
    await writeState({ futureModule: { from: 'backup' } }, `${filePath}.bak`)
    await writeFile(filePath, '{ truncated')
    const state = new StateStore(filePath)
    await state.load()

    expect(state.recoveredFrom).toBe('backup')
    expect((await readState())['futureModule']).toEqual({ from: 'backup' })
    expect(state.section({ ...notesSpec(), key: 'futureModule' }).get()).toEqual({ items: [] })
  })

  it('recovering to defaults invents no unknown keys', async () => {
    await writeFile(filePath, '{ truncated "futureModule": {} ')
    const state = new StateStore(filePath)
    await state.load()
    state.patchSettings({})
    await state.settle()

    expect(state.recoveredFrom).toBe('defaults')
    const written = await readState()
    expect(Object.keys(written).filter((key) => !STATE_KEYS.includes(key))).toEqual([])
    expect(state.section(notesSpec()).get()).toEqual({ items: ['default'] })
  })
})

describe('architecture doc', () => {
  it('ARCHITECTURE.md states the slice-mutator rule', async () => {
    const doc = await readFile(join(__dirname, '../../../docs/ARCHITECTURE.md'), 'utf8')
    const section = doc.split(/^## /m).find((s) => s.startsWith('State and persistence')) ?? ''

    expect(section).toContain('updateSlice')
    expect(section).toMatch(/Never read\s+->\s+spread\s+->\s+set/)
  })
})
