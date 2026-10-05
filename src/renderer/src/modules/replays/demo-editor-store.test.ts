import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addTagChange, setFields } from '@shared/replays/sidecar-draft'
import { mockClient } from '../../test-support/mock-client'

const sidecarRead = vi.fn()
const sidecarWrite = vi.fn()
const scanStart = vi.fn()
const indexRead = vi.fn()
const pushToast = vi.fn()

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal, {
    sidecarRead: (...args: unknown[]) => sidecarRead(...args),
    sidecarWrite: (...args: unknown[]) => sidecarWrite(...args),
    scanStart: (...args: unknown[]) => scanStart(...args),
    indexRead: (...args: unknown[]) => indexRead(...args),
  }),
)

vi.mock('../../store/useLauncher', () => ({
  useLauncher: { getState: () => ({ pushToast: (...args: unknown[]) => pushToast(...args) }) },
}))

const { effectiveQuickValues, findRowReplaceId, useDemoEditorStore } =
  await import('./demo-editor-store')

const A = 'aaaaaaaaaaaaaaaa'
const B = 'bbbbbbbbbbbbbbbb'

function store() {
  return useDemoEditorStore.getState()
}

beforeEach(() => {
  sidecarRead.mockReset()
  sidecarWrite.mockReset()
  scanStart.mockReset()
  indexRead.mockReset()
  pushToast.mockReset()
  useDemoEditorStore.setState({
    selectedId: null,
    drafts: {},
    quickPending: {},
  })
})

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * A fake on-disk sidecar. Reads answer at once with what is on disk; every write waits until the test
 * releases it and only then lands on disk - so two writes that were not serialized would both have
 * read the same, older file. `broken` makes an unconfirmed write answer `needsConfirmation`.
 */
function fakeSidecar(initial: Record<string, unknown>, options: { broken?: boolean } = {}) {
  const disk = { values: { ...initial }, broken: options.broken ?? false }
  const waiting: Array<() => void> = []
  sidecarRead.mockImplementation(async () => ({
    ok: true,
    value: { state: { state: 'ok' }, values: structuredClone(disk.values) },
  }))
  sidecarWrite.mockImplementation(
    (_id: string, fields: Record<string, unknown>, fingerprint?: string) =>
      new Promise((resolve) => {
        waiting.push(() => {
          if (disk.broken && fingerprint === undefined) {
            resolve({
              ok: true,
              value: {
                status: 'needsConfirmation',
                fileName: 'a.dm2.json',
                issues: [],
                fingerprint: 'f1',
              },
            })
            return
          }
          disk.broken = false
          disk.values = structuredClone(fields)
          resolve({ ok: true, value: { status: 'saved', state: 'written' } })
        })
      }),
  )
  /** Releases waiting writes one at a time until `promise` has settled. */
  async function settle(promise: Promise<unknown>): Promise<void> {
    let done = false
    void promise.then(
      () => (done = true),
      () => (done = true),
    )
    for (let guard = 0; guard < 50; guard++) {
      await flush()
      if (done) break
      waiting.shift()?.()
    }
    expect(done).toBe(true)
  }
  return { disk, waiting, settle }
}

describe('quick edits never lose a write (story 179)', () => {
  it('a favourite toggle and a rating pick fired back-to-back both reach the sidecar', async () => {
    const sidecar = fakeSidecar({ name: 'x' })
    const favourite = store().quickEdit(A, { favourite: true }, vi.fn())
    const rating = store().quickEdit(A, { rating: 7 }, vi.fn())

    await sidecar.settle(Promise.all([favourite, rating]))

    expect(sidecar.disk.values).toEqual({ name: 'x', favourite: true, rating: 7 })
  })

  it('quick edits during a pending replace confirmation are merged into the retry', async () => {
    const sidecar = fakeSidecar({}, { broken: true })
    await sidecar.settle(store().quickEdit(A, { favourite: true }, vi.fn()))
    expect(store().drafts[A]?.replace).toBeDefined()

    // The dialog is open: this click must not write (and must not be lost).
    await sidecar.settle(store().quickEdit(A, { rating: 3 }, vi.fn()))
    expect(sidecarWrite).toHaveBeenCalledTimes(1)
    expect(sidecar.disk.values).toEqual({})

    const onRowPatched = vi.fn()
    await sidecar.settle(store().confirmQuickEdit(A, onRowPatched))

    expect(sidecarWrite).toHaveBeenLastCalledWith(A, { favourite: true, rating: 3 }, 'f1')
    expect(sidecar.disk.values).toEqual({ favourite: true, rating: 3 })
    expect(onRowPatched).toHaveBeenCalledWith(A, {
      state: { state: 'ok' },
      values: { favourite: true, rating: 3 },
    })
    expect(store().drafts[A]?.replace).toBeUndefined()
  })

  it('the optimistic overlay shows the patch at once and is cleared when the queue drains, also on failure', async () => {
    const sidecar = fakeSidecar({ rating: 5 })
    const row = { rating: 5 }
    const favourite = store().quickEdit(A, { favourite: true }, vi.fn())
    expect(effectiveQuickValues(store().quickPending[A], row)).toEqual({
      favourite: true,
      rating: 5,
    })
    const cleared = store().quickEdit(A, { rating: null }, vi.fn())
    // `null` is a cleared rating, not "no overlay".
    expect(effectiveQuickValues(store().quickPending[A], row)).toEqual({
      favourite: true,
      rating: null,
    })

    await sidecar.settle(favourite)
    expect(store().quickPending[A]).toBeDefined() // the rating pick is still queued
    await sidecar.settle(cleared)
    expect(store().quickPending[A]).toBeUndefined()
    expect(sidecar.disk.values).toEqual({ favourite: true })

    // A failed write drops the overlay too, so the row falls back to what is on disk.
    sidecarWrite.mockResolvedValueOnce({ ok: false, error: { key: 'replays.sidecar.error.write' } })
    const failing = store().quickEdit(A, { favourite: false }, vi.fn())
    expect(effectiveQuickValues(store().quickPending[A], { favourite: true }).favourite).toBe(false)
    await failing
    expect(store().quickPending[A]).toBeUndefined()
    expect(effectiveQuickValues(store().quickPending[A], { favourite: true }).favourite).toBe(true)
  })

  it('the overlay stays until the patched row has been handed to the view, and a newer edit keeps it', async () => {
    const sidecar = fakeSidecar({})
    const onRowPatched = vi.fn()
    const first = store().quickEdit(A, { rating: 7 }, onRowPatched)
    for (let guard = 0; guard < 20 && onRowPatched.mock.calls.length === 0; guard++) {
      await flush()
      sidecar.waiting.shift()?.()
    }
    expect(onRowPatched).toHaveBeenCalledTimes(1)
    // Microtasks only - React has not had a macrotask to commit the row yet: the overlay must hold.
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(store().quickPending[A]).toEqual({ rating: 7 })

    // A newer edit arriving during the deferral must not have its overlay cleared by the older write.
    const second = store().quickEdit(A, { favourite: true }, vi.fn())
    await flush()
    expect(store().quickPending[A]).toEqual({ rating: 7, favourite: true })
    await sidecar.settle(Promise.all([first, second]))
    expect(store().quickPending[A]).toBeUndefined()
    expect(sidecar.disk.values).toEqual({ rating: 7, favourite: true })
  })

  it('a failed confirmed replace drops quick edits merged for the dialog, so a retry cannot carry them', async () => {
    const sidecar = fakeSidecar({}, { broken: true })
    await sidecar.settle(store().quickEdit(A, { favourite: true }, vi.fn()))
    expect(store().drafts[A]?.pendingChange).toBeDefined()
    expect(store().drafts[A]?.replace).toBeDefined()

    sidecarWrite.mockReset()
    sidecarWrite.mockResolvedValueOnce({ ok: false, error: { key: 'replays.sidecar.error.write' } })
    await store().confirmEdit(A, vi.fn())
    expect(store().drafts[A]?.pendingChange).toBeUndefined()
  })
})

describe('one queued write path for every detail edit', () => {
  /** Releases every write the fake holds back, letting queued turns run in between. */
  async function drain(sidecar: ReturnType<typeof fakeSidecar>): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await flush()
      sidecar.waiting.shift()?.()
    }
  }

  it('quick successive edits to one demo never overwrite each other', async () => {
    const sidecar = fakeSidecar({ map: 'q2dm1' })
    const name = store().edit(A, setFields({ name: 'Final' }), vi.fn())
    const tag = store().edit(A, addTagChange('ctf'), vi.fn())
    const favourite = store().quickEdit(A, { favourite: true }, vi.fn())

    await sidecar.settle(Promise.all([name, tag, favourite]))

    expect(await name).toBe('saved')
    expect(await tag).toBe('saved')
    const all = { map: 'q2dm1', name: 'Final', tags: ['ctf'], favourite: true }
    expect(sidecarWrite).toHaveBeenLastCalledWith(A, all)
    expect(sidecar.disk.values).toEqual(all)
  })

  it('an unreadable sidecar parks the edit until the replace is confirmed', async () => {
    const sidecar = fakeSidecar({}, { broken: true })
    const onRowPatched = vi.fn()
    let nameResult: string | undefined
    const name = store().edit(A, setFields({ name: 'Mine' }), onRowPatched)
    void name.then((result) => (nameResult = result))
    await drain(sidecar)
    expect(store().drafts[A]?.replace).toBeDefined()

    // The dialog is open: a second edit joins the parked one instead of writing.
    const tag = store().edit(A, addTagChange('duel'), onRowPatched)
    await drain(sidecar)
    expect(nameResult).toBeUndefined()
    expect(sidecarWrite).toHaveBeenCalledTimes(1)

    await sidecar.settle(Promise.all([store().confirmEdit(A, onRowPatched), name, tag]))

    expect(await name).toBe('saved')
    expect(await tag).toBe('saved')
    expect(sidecarWrite).toHaveBeenLastCalledWith(A, { name: 'Mine', tags: ['duel'] }, 'f1')
    expect(sidecar.disk.values).toEqual({ name: 'Mine', tags: ['duel'] })
    expect(onRowPatched).toHaveBeenCalledTimes(1)
    expect(store().drafts[A]?.replace).toBeUndefined()
  })

  it('cancelling the replace writes nothing and resolves cancelled', async () => {
    const sidecar = fakeSidecar({}, { broken: true })
    const name = store().edit(A, setFields({ name: 'Mine' }), vi.fn())
    await drain(sidecar)

    store().cancelEdit(A)

    expect(await name).toBe('cancelled')
    expect(store().drafts[A]?.replace).toBeUndefined()
    expect(store().drafts[A]?.pendingChange).toBeUndefined()
    await store().confirmEdit(A, vi.fn())
    // Only the write that was answered with the replace question ever reached main.
    expect(sidecarWrite).toHaveBeenCalledTimes(1)
    expect(sidecar.disk.values).toEqual({})
  })

  it('a failed write toasts and resolves failed', async () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: {} } })
    const error = { key: 'replays.sidecar.error.write', params: { reason: 'EACCES' } }
    sidecarWrite.mockResolvedValue({ ok: false, error })
    const onRowPatched = vi.fn()

    expect(await store().edit(A, setFields({ name: 'x' }), onRowPatched)).toBe('failed')

    expect(pushToast).toHaveBeenCalledWith({
      level: 'error',
      messageKey: 'replays.sidecar.error.write',
      timeoutMs: 0,
      params: { reason: 'EACCES' },
    })
    expect(onRowPatched).not.toHaveBeenCalled()
  })

})

describe('demo-editor-store', () => {
  it('an edit patches the row from sidecar.read without a scan', async () => {
    sidecarRead.mockResolvedValueOnce({
      ok: true,
      value: { state: { state: 'ok' }, values: { rating: 8 } },
    })
    sidecarWrite.mockResolvedValue({ ok: true, value: { status: 'saved', state: 'written' } })
    // What is on disk differs from what was sent - the store must reflect disk.
    const onDisk = { name: 'Final (disk)', rating: 8 }
    sidecarRead.mockResolvedValueOnce({
      ok: true,
      value: { state: { state: 'ok' }, values: onDisk },
    })
    const onRowPatched = vi.fn()

    expect(await store().edit(A, setFields({ name: 'Final' }), onRowPatched)).toBe('saved')

    expect(sidecarWrite).toHaveBeenCalledTimes(1)
    expect(sidecarWrite).toHaveBeenCalledWith(A, { name: 'Final', rating: 8 })
    expect(onRowPatched).toHaveBeenCalledWith(A, { state: { state: 'ok' }, values: onDisk })
    expect(scanStart).not.toHaveBeenCalled()
    expect(indexRead).not.toHaveBeenCalled()
    expect(store().drafts[A]).toBeUndefined()
  })

  it('an edit over a broken sidecar asks before replacing it, and confirm writes with the fingerprint', async () => {
    const issues = [
      {
        kind: 'invalidJson',
        key: 'replays.sidecar.issue.invalidJson',
        params: { line: 1, column: 2 },
      },
    ]
    sidecarRead.mockResolvedValue({
      ok: true,
      value: { state: { state: 'ok' }, values: { name: 'Mine' } },
    })
    sidecarWrite.mockResolvedValueOnce({
      ok: true,
      value: { status: 'needsConfirmation', fileName: 'x.dm2.json', issues, fingerprint: 'f1' },
    })
    const onRowPatched = vi.fn()

    const result = store().edit(A, setFields({ name: 'Mine' }), onRowPatched)
    await flush()
    await flush()
    expect(store().drafts[A]!.replace).toEqual({ fileName: 'x.dm2.json', issues })
    expect(onRowPatched).not.toHaveBeenCalled()

    sidecarWrite.mockResolvedValueOnce({ ok: true, value: { status: 'saved', state: 'written' } })
    await store().confirmEdit(A, onRowPatched)
    expect(await result).toBe('saved')
    expect(sidecarWrite).toHaveBeenLastCalledWith(A, { name: 'Mine' }, 'f1')
    expect(store().drafts[A]!.replace).toBeUndefined()
    expect(store().drafts[A]!.fingerprint).toBeUndefined()
  })

  it('selecting or closing switches directly', () => {
    store().select(A)
    store().select(B)
    expect(store().selectedId).toBe(B)
    store().close()
    expect(store().selectedId).toBeNull()
  })

  it('a quick edit re-reads and keeps the other notes', async () => {
    sidecarRead.mockResolvedValue({
      ok: true,
      value: { state: { state: 'ok' }, values: { name: 'x', tags: ['a'] } },
    })
    sidecarWrite.mockResolvedValue({ ok: true, value: { status: 'saved', state: 'written' } })
    const onRowPatched = vi.fn()

    await store().quickEdit(A, { favourite: true }, onRowPatched)

    expect(sidecarRead).toHaveBeenCalledWith(A)
    expect(sidecarWrite).toHaveBeenCalledWith(A, { name: 'x', tags: ['a'], favourite: true })
    expect(scanStart).not.toHaveBeenCalled()
    expect(indexRead).not.toHaveBeenCalled()
    expect(onRowPatched).toHaveBeenCalledWith(A, {
      state: { state: 'ok' },
      values: { name: 'x', tags: ['a'] },
    })
  })
})

describe('replace confirmation', () => {
  it("a demo's replace confirmation shows in the view whether or not its panel is open", async () => {
    const issues = [
      {
        kind: 'invalidJson',
        key: 'replays.sidecar.issue.invalidJson',
        params: { line: 1, column: 2 },
      },
    ]
    sidecarRead.mockResolvedValue({
      ok: true,
      value: { state: { state: 'error', issues }, values: {} },
    })
    sidecarWrite.mockResolvedValue({
      ok: true,
      value: { status: 'needsConfirmation', fileName: 'a.dm2.json', issues, fingerprint: 'f1' },
    })
    store().select(A)
    await store().quickEdit(A, { favourite: true }, vi.fn())
    expect(store().drafts[A]!.replace).toBeDefined()

    expect(findRowReplaceId(store().drafts)).toBe(A)
    store().close()
    expect(findRowReplaceId(store().drafts)).toBe(A)
  })
})
