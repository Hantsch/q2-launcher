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

const { useDemoEditorStore } = await import('./demo-editor-store')

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
  useDemoEditorStore.setState({ selectedId: null, drafts: {}, pendingLeave: null })
})

describe('demo-editor-store', () => {
  it('a save patches the row from sidecar.read without a scan', async () => {
    store().openDraft(A, {})
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
    store().openDraft(A, {})
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
    store().openDraft(A, { name: 'Old' })

    // Clean: switching is immediate.
    store().select(B)
    expect(store().selectedId).toBe(B)
    expect(store().pendingLeave).toBeNull()

    store().select(A)
    store().updateDraft(A, { name: 'Edited' })

    store().select(B)
    expect(store().selectedId).toBe(A)
    expect(store().pendingLeave).toEqual({ kind: 'select', targetId: B })

    store().keepEditing()
    expect(store().selectedId).toBe(A)
    expect(store().pendingLeave).toBeNull()
    expect(store().drafts[A]!.draft.name).toBe('Edited')

    // A re-open from the row's values never clobbers a dirty draft.
    store().openDraft(A, { name: 'Old' })
    expect(store().drafts[A]!.draft.name).toBe('Edited')

    store().close()
    expect(store().pendingLeave).toEqual({ kind: 'close', targetId: null })
    store().discardAndLeave()
    expect(store().selectedId).toBeNull()
    expect(store().drafts[A]).toBeUndefined()

    // Cancel resets to the baseline and makes leaving free again.
    store().select(A)
    store().openDraft(A, { name: 'Old' })
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
