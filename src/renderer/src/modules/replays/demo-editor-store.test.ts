import { beforeEach, describe, expect, it, vi } from 'vitest'

const sidecarRead = vi.fn()
const sidecarWrite = vi.fn()
const scanStart = vi.fn()
const indexRead = vi.fn()

vi.mock('./client', () => ({
  sidecarRead: (...args: unknown[]) => sidecarRead(...args),
  sidecarWrite: (...args: unknown[]) => sidecarWrite(...args),
  scanStart: (...args: unknown[]) => scanStart(...args),
  indexRead: (...args: unknown[]) => indexRead(...args),
}))

const { effectiveQuickValues, findRowReplaceId, useDemoEditorStore } = await import('./demo-editor-store')

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
  useDemoEditorStore.setState({ selectedId: null, editingId: null, drafts: {}, quickPending: {}, pendingLeave: null })
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
            resolve({ ok: true, value: { status: 'needsConfirmation', fileName: 'a.dm2.json', issues: [], fingerprint: 'f1' } })
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

  it('a quick edit during an edit-mode save waits for it and is not dropped', async () => {
    const sidecar = fakeSidecar({ name: 'Old' })
    store().select(A)
    store().startEdit(A, { name: 'Old' })
    store().updateDraft(A, { name: 'New' })

    const save = store().save(A, vi.fn())
    const quick = store().quickEdit(A, { favourite: true }, vi.fn())
    await sidecar.settle(Promise.all([save, quick]))

    expect(sidecar.disk.values).toEqual({ name: 'New', favourite: true })
    expect(store().drafts[A]?.saving).toBeFalsy()
  })

  it('a quick edit keeps an open draft\'s unsaved changes and patches only favourite and rating', async () => {
    const sidecar = fakeSidecar({ name: 'Old' })
    store().select(A)
    store().startEdit(A, { name: 'Old' })
    store().updateDraft(A, { name: 'Unsaved' })

    await sidecar.settle(store().quickEdit(A, { favourite: true, rating: 5 }, vi.fn()))

    const entry = store().drafts[A]!
    expect(entry.draft).toMatchObject({ name: 'Unsaved', favourite: true, rating: '5' })
    expect(entry.baseline).toMatchObject({ name: 'Old', favourite: true, rating: '5' })
    expect(store().editingId).toBe(A)

    // The edit-mode save afterwards writes the unsaved change without undoing the quick edit.
    await sidecar.settle(store().save(A, vi.fn()))
    expect(sidecar.disk.values).toEqual({ name: 'Unsaved', favourite: true, rating: 5 })
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
    expect(onRowPatched).toHaveBeenCalledWith(A, { state: { state: 'ok' }, values: { favourite: true, rating: 3 } })
    expect(store().drafts[A]?.replace).toBeUndefined()
  })

  it('the optimistic overlay shows the patch at once and is cleared when the queue drains, also on failure', async () => {
    const sidecar = fakeSidecar({ rating: 5 })
    const row = { rating: 5 }
    const favourite = store().quickEdit(A, { favourite: true }, vi.fn())
    expect(effectiveQuickValues(store().quickPending[A], row)).toEqual({ favourite: true, rating: 5 })
    const cleared = store().quickEdit(A, { rating: null }, vi.fn())
    // `null` is a cleared rating, not "no overlay".
    expect(effectiveQuickValues(store().quickPending[A], row)).toEqual({ favourite: true, rating: null })

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

  it('a failed save drops quick edits merged for the replace dialog, so a retry cannot carry them', async () => {
    const sidecar = fakeSidecar({}, { broken: true })
    await sidecar.settle(store().quickEdit(A, { favourite: true }, vi.fn()))
    expect(store().drafts[A]?.pendingQuickEdit).toEqual({ favourite: true })

    // Dialog still open: the pending patch stays.
    expect(store().drafts[A]?.replace).toBeDefined()

    sidecarWrite.mockReset()
    sidecarWrite.mockResolvedValueOnce({ ok: false, error: { key: 'replays.sidecar.error.write' } })
    await store().save(A, vi.fn())
    expect(store().drafts[A]?.pendingQuickEdit).toBeUndefined()
  })
})

describe('demo-editor-store', () => {
  it('a save patches the row from sidecar.read without a scan', async () => {
    store().startEdit(A, {})
    store().updateDraft(A, { name: '  Final  ', rating: '8' })
    sidecarWrite.mockResolvedValue({ ok: true, value: { status: 'saved', state: 'written' } })
    // What is on disk differs from what was sent - the store must reflect disk, not the draft.
    const onDisk = { name: 'Final (disk)', rating: 8 }
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: onDisk } })
    const onRowPatched = vi.fn()

    await store().save(A, onRowPatched)

    expect(sidecarWrite).toHaveBeenCalledTimes(1)
    expect(sidecarWrite).toHaveBeenCalledWith(A, { name: 'Final', rating: 8 })
    expect(sidecarRead).toHaveBeenCalledWith(A)
    expect(onRowPatched).toHaveBeenCalledWith(A, { state: { state: 'ok' }, values: onDisk })
    expect(scanStart).not.toHaveBeenCalled()
    expect(indexRead).not.toHaveBeenCalled()
    const entry = store().drafts[A]!
    expect(entry.draft.name).toBe('Final (disk)')
    expect(entry.baseline).toEqual(entry.draft)
    expect(entry.fingerprint).toBeUndefined()

    // An invalid draft makes no IPC call at all.
    store().updateDraft(A, { rating: '11' })
    await store().save(A, onRowPatched)
    expect(sidecarWrite).toHaveBeenCalledTimes(1)
  })

  it('a save over a broken sidecar asks before replacing it', async () => {
    store().startEdit(A, {})
    store().updateDraft(A, { name: 'Mine' })
    const issues = [{ kind: 'invalidJson', key: 'replays.sidecar.issue.invalidJson', params: { line: 1, column: 2 } }]
    sidecarWrite.mockResolvedValueOnce({
      ok: true,
      value: { status: 'needsConfirmation', fileName: 'x.dm2.json', issues, fingerprint: 'f1' },
    })
    const onRowPatched = vi.fn()

    await store().save(A, onRowPatched)
    expect(sidecarWrite).toHaveBeenLastCalledWith(A, { name: 'Mine' })
    expect(store().drafts[A]!.replace).toEqual({ fileName: 'x.dm2.json', issues })
    expect(sidecarRead).not.toHaveBeenCalled()
    expect(onRowPatched).not.toHaveBeenCalled()

    // Cancel closes the dialog and forgets the fingerprint - the next save asks again.
    store().cancelReplace(A)
    expect(store().drafts[A]!.replace).toBeUndefined()
    sidecarWrite.mockResolvedValueOnce({
      ok: true,
      value: { status: 'needsConfirmation', fileName: 'x.dm2.json', issues, fingerprint: 'f2' },
    })
    await store().save(A, onRowPatched)
    expect(sidecarWrite).toHaveBeenLastCalledWith(A, { name: 'Mine' })
    expect(sidecarWrite).toHaveBeenCalledTimes(2)

    // Confirm re-saves with the fingerprint from the latest round.
    sidecarWrite.mockResolvedValueOnce({ ok: true, value: { status: 'saved', state: 'written' } })
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: { name: 'Mine' } } })
    await store().save(A, onRowPatched)
    expect(sidecarWrite).toHaveBeenLastCalledWith(A, { name: 'Mine' }, 'f2')
    expect(onRowPatched).toHaveBeenCalledTimes(1)
    expect(store().drafts[A]!.replace).toBeUndefined()
    expect(store().drafts[A]!.fingerprint).toBeUndefined()
  })

  it('leaving a dirty draft asks, a clean one does not', () => {
    store().select(A)
    store().startEdit(A, { name: 'Old' })

    // Clean: switching is immediate.
    store().select(B)
    expect(store().selectedId).toBe(B)
    expect(store().pendingLeave).toBeNull()

    store().select(A)
    store().startEdit(A, { name: 'Old' })
    store().updateDraft(A, { name: 'Edited' })

    store().select(B)
    expect(store().selectedId).toBe(A)
    expect(store().pendingLeave).toEqual({ kind: 'select', targetId: B })

    store().keepEditing()
    expect(store().selectedId).toBe(A)
    expect(store().pendingLeave).toBeNull()
    expect(store().drafts[A]!.draft.name).toBe('Edited')

    // A re-open from the row's values never clobbers a dirty draft.
    store().startEdit(A, { name: 'Old' })
    expect(store().drafts[A]!.draft.name).toBe('Edited')

    store().close()
    expect(store().pendingLeave).toEqual({ kind: 'close', targetId: null })
    store().discardAndLeave()
    expect(store().selectedId).toBeNull()
    expect(store().drafts[A]).toBeUndefined()

    // Cancel resets to the baseline and makes leaving free again.
    store().select(A)
    store().startEdit(A, { name: 'Old' })
    store().updateDraft(A, { name: 'Again' })
    store().cancelDraft(A)
    expect(store().drafts[A]!.draft.name).toBe('Old')
    store().close()
    expect(store().selectedId).toBeNull()
  })

  it('a quick edit re-reads and keeps the other notes', async () => {
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: { name: 'x', tags: ['a'] } } })
    sidecarWrite.mockResolvedValue({ ok: true, value: { status: 'saved', state: 'written' } })
    const onRowPatched = vi.fn()

    await store().quickEdit(A, { favourite: true }, onRowPatched)

    expect(sidecarRead).toHaveBeenCalledWith(A)
    expect(sidecarWrite).toHaveBeenCalledWith(A, { name: 'x', tags: ['a'], favourite: true })
    expect(scanStart).not.toHaveBeenCalled()
    expect(indexRead).not.toHaveBeenCalled()
    expect(onRowPatched).toHaveBeenCalledWith(A, { state: { state: 'ok' }, values: { name: 'x', tags: ['a'] } })
  })
})

describe('edit mode', () => {
  it('startEdit opens a draft and sets editingId', () => {
    store().select(A)
    store().startEdit(A, { name: 'Old' })
    expect(store().editingId).toBe(A)
    expect(store().drafts[A]!.draft.name).toBe('Old')
    expect(store().drafts[A]!.baseline).toEqual(store().drafts[A]!.draft)
  })

  it('cancelEdit drops the draft and writes nothing', () => {
    store().select(A)
    store().startEdit(A, { name: 'Old' })
    store().updateDraft(A, { name: 'Edited' })
    store().cancelEdit(A)
    expect(store().editingId).toBeNull()
    expect(store().drafts[A]).toBeUndefined()
    expect(sidecarWrite).not.toHaveBeenCalled()
  })

  it('a successful save ends edit mode', async () => {
    store().select(A)
    store().startEdit(A, {})
    store().updateDraft(A, { name: 'New' })
    sidecarWrite.mockResolvedValue({ ok: true, value: { status: 'saved', state: 'written' } })
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'ok' }, values: { name: 'New' } } })
    await store().save(A, vi.fn())
    expect(store().editingId).toBeNull()
  })

  it('leaving a dirty edit parks pendingLeave', () => {
    store().select(A)
    store().startEdit(A, { name: 'Old' })
    store().updateDraft(A, { name: 'Edited' })
    store().select(B)
    expect(store().selectedId).toBe(A)
    expect(store().editingId).toBe(A)
    expect(store().pendingLeave).toEqual({ kind: 'select', targetId: B })
  })

  it('leaving a clean edit leaves and ends edit mode', () => {
    store().select(A)
    store().startEdit(A, { name: 'Old' })
    store().select(B)
    expect(store().selectedId).toBe(B)
    expect(store().editingId).toBeNull()
    expect(store().pendingLeave).toBeNull()
    expect(store().drafts[A]).toBeUndefined()
  })

  it('discardAndLeave ends edit mode', () => {
    store().select(A)
    store().startEdit(A, { name: 'Old' })
    store().updateDraft(A, { name: 'Edited' })
    store().close()
    store().discardAndLeave()
    expect(store().selectedId).toBeNull()
    expect(store().editingId).toBeNull()
    expect(store().drafts[A]).toBeUndefined()
  })

  it('editingId survives a simulated remount', () => {
    store().select(A)
    store().startEdit(A, { name: 'Old' })
    store().updateDraft(A, { name: 'Edited' })
    // Remount: nothing clears the store; a fresh read sees the same state.
    const again = useDemoEditorStore.getState()
    expect(again.editingId).toBe(A)
    expect(again.selectedId).toBe(A)
    expect(again.drafts[A]!.draft.name).toBe('Edited')
  })

  it("a selected row's quick-edit confirmation shows outside edit mode", async () => {
    const issues = [{ kind: 'invalidJson', key: 'replays.sidecar.issue.invalidJson', params: { line: 1, column: 2 } }]
    sidecarRead.mockResolvedValue({ ok: true, value: { state: { state: 'error', issues }, values: {} } })
    sidecarWrite.mockResolvedValue({
      ok: true,
      value: { status: 'needsConfirmation', fileName: 'a.dm2.json', issues, fingerprint: 'f1' },
    })
    store().select(A)
    await store().quickEdit(A, { favourite: true }, vi.fn())
    expect(store().drafts[A]!.replace).toBeDefined()

    // Selected but reading: the view shows the dialog - no editor is on screen to do it.
    expect(findRowReplaceId(store().drafts, store().selectedId, store().editingId)).toBe(A)
    // In edit mode the open editor shows it itself, so the view must not show a second one.
    useDemoEditorStore.setState({ editingId: A })
    expect(findRowReplaceId(store().drafts, store().selectedId, store().editingId)).toBeUndefined()
    // A stale edit flag for a demo that is no longer selected hides nothing.
    useDemoEditorStore.setState({ selectedId: B })
    expect(findRowReplaceId(store().drafts, store().selectedId, store().editingId)).toBe(A)
  })
})
