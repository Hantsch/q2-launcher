import { create } from 'zustand'
import type { SidecarIssue, SidecarState } from '@shared/modules/replays'
import type { SidecarFields } from '@shared/replays/sidecar'
import {
  draftFromSidecar,
  draftToFields,
  isDraftDirty,
  withQuickEdit,
  type SidecarDraft,
} from '@shared/replays/sidecar-draft'
import type { LocalizedMessage } from '@shared/types/common'
import { sidecarRead, sidecarWrite } from './client'

/** What a save hands back to the view so it can patch that one row's `sidecar` part in place -
 * straight from a fresh `sidecar.read`, never from the fields that were just sent. */
export interface SidecarReadResult {
  state: SidecarState
  values: Partial<SidecarFields>
}
export type RowPatcher = (demoId: string, sidecar: SidecarReadResult) => void

/** A row-level favourite/rating toggle. `rating: null` clears the rating. */
export interface QuickPatch {
  favourite?: boolean
  rating?: number | null
}

/**
 * Story 179: what a row shows for favourite/rating - the optimistic overlay (`quickPending[id]`)
 * where a quick edit is still queued or running, the row's own sidecar values otherwise. A
 * `rating: null` in the overlay means "cleared", not "no overlay".
 */
export function effectiveQuickValues(
  pending: QuickPatch | undefined,
  values: Partial<SidecarFields>,
): { favourite: boolean; rating: number | null } {
  return {
    favourite: pending?.favourite ?? values.favourite ?? false,
    rating:
      pending !== undefined && 'rating' in pending
        ? (pending.rating ?? null)
        : (values.rating ?? null),
  }
}

/** Story 179: one promise tail per demo. Every sidecar write (quick edit or save) runs strictly after
 * the previous one for the same demo, so a read-merge-write always reads what the last write left. */
const queues = new Map<string, Promise<void>>()

/** One demo's open draft. `baseline` is what is on disk as far as the editor knows; `fingerprint`
 * is only ever set by a `needsConfirmation` answer and only ever sent back after the user confirmed
 * the replace dialog (`replace` is that dialog's content while it is open). */
export interface DemoDraftEntry {
  draft: SidecarDraft
  baseline: SidecarDraft
  fingerprint?: string
  replace?: { fileName: string; issues: SidecarIssue[] }
  saving?: boolean
  saveError?: LocalizedMessage
  /** Set only while a quick edit (row-level favourite/rating toggle) is waiting on a
   * `needsConfirmation` reply - the patch to retry once the replace dialog is confirmed. Never set
   * by the full editor's own `save`. */
  pendingQuickEdit?: QuickPatch
}

export interface PendingLeave {
  kind: 'select' | 'close'
  targetId: string | null
}

/**
 * Story 155: which demo's detail panel is open, plus every demo's notes draft. Module-level (a
 * zustand store survives `ReplaysView` unmount/remount), so switching module never loses a draft -
 * nothing here is cleared on unmount.
 *
 * Leaving a demo with a dirty draft (`select` another / `close`) never happens directly: it parks
 * the request in `pendingLeave` for the discard dialog, which either `keepEditing()`s or
 * `discardAndLeave()`s.
 */
export interface DemoEditorState {
  selectedId: string | null
  /** The demo whose details are in edit mode (story 178). Survives unmount like `drafts`. */
  editingId: string | null
  drafts: Record<string, DemoDraftEntry>
  /** Story 179: the optimistic favourite/rating overlay per demo - set the moment a quick edit is
   * clicked, dropped when that demo's write queue drains (success or failure). Read it through
   * `effectiveQuickValues`. */
  quickPending: Record<string, QuickPatch>
  pendingLeave: PendingLeave | null
  select(id: string): void
  close(): void
  /** Clears the selection if it no longer names a row in `ids` - the "row vanished on a re-read or
   * a filter change" guard. Not guarded by the dirty check: the draft itself stays in `drafts`. */
  deselectIfMissing(ids: readonly string[]): void
  /** Enters edit mode for a demo: a fresh draft from its sidecar values (a dirty or saving entry is kept). */
  startEdit(id: string, values: Partial<SidecarFields>): void
  /** Leaves edit mode without writing: drops the draft (unless a save is running). */
  cancelEdit(id: string): void
  updateDraft(
    id: string,
    patch: Partial<SidecarDraft> | ((draft: SidecarDraft) => SidecarDraft),
  ): void
  /** The editor's Cancel: back to the baseline, the entry itself stays. */
  cancelDraft(id: string): void
  discardDraft(id: string): void
  keepEditing(): void
  discardAndLeave(): void
  save(id: string, onRowPatched: RowPatcher): Promise<void>
  /** The replace dialog's Cancel: closes it and forgets the fingerprint, so the next Save asks again. */
  cancelReplace(id: string): void
  /** Story 155 / 179: a favourite/rating toggle from the row itself, without opening the panel.
   * The patch lands in `quickPending` at once; the write itself is queued behind any running or
   * queued write (quick edit or `save`) for the same demo - never dropped. When it runs it re-reads
   * the sidecar fresh, merges just the patch via `withQuickEdit` and writes it back, reusing
   * `sidecarWrite`'s `needsConfirmation` flow (`entry.replace`/`ReplaceSidecarDialog`) and
   * `onRowPatched` for the row. While a replace dialog is open for the demo the patch is merged into
   * `pendingQuickEdit` instead of written - `confirmQuickEdit` (or the editor's `save`) writes it.
   * An open draft gets only its `favourite`/`rating` refreshed (draft and baseline), so unsaved
   * edit-mode changes survive. Never calls `select`, `scanStart` or `indexRead`. The promise
   * resolves when this edit's turn in the queue is over. */
  quickEdit(id: string, patch: QuickPatch, onRowPatched: RowPatcher): Promise<void>
  /** The row-level replace dialog's Confirm: writes every quick edit merged into `pendingQuickEdit`
   * with the fingerprint the dialog was opened for. */
  confirmQuickEdit(id: string, onRowPatched: RowPatcher): Promise<void>
}

/**
 * Story 178: which demo's pending `replace` (a row-level quick edit that needs confirmation) the view
 * itself has to show. The only entry left out is the one whose editor is actually on screen - the
 * selected demo while it is in edit mode - since `DemoDetailEditor` renders that dialog itself. A
 * selected demo outside edit mode (or a stale `editingId` that no longer names the selection) still
 * gets its dialog here.
 */
export function findRowReplaceId(
  drafts: Record<string, DemoDraftEntry>,
  selectedId: string | null,
  editingId: string | null,
): string | undefined {
  const onScreen = editingId !== null && editingId === selectedId ? editingId : null
  return Object.keys(drafts).find((id) => id !== onScreen && drafts[id]?.replace !== undefined)
}

function isEntryDirty(entry: DemoDraftEntry | undefined): boolean {
  return entry !== undefined && isDraftDirty(entry.draft, entry.baseline)
}

export const useDemoEditorStore = create<DemoEditorState>((set, get) => {
  const patchEntry = (id: string, patch: Partial<DemoDraftEntry>): void => {
    const entry = get().drafts[id]
    if (entry === undefined) return
    set({ drafts: { ...get().drafts, [id]: { ...entry, ...patch } } })
  }

  /** Like `patchEntry`, but creates the entry from `fallback` when none is open yet - the quick-edit
   * "needs confirmation" case has to remember a fingerprint/replace dialog even with no panel open. */
  const upsertEntry = (
    id: string,
    patch: Partial<DemoDraftEntry>,
    fallback: () => Pick<DemoDraftEntry, 'draft' | 'baseline'>,
  ): void => {
    const entry = get().drafts[id] ?? fallback()
    set({ drafts: { ...get().drafts, [id]: { ...entry, ...patch } } })
  }

  /** Runs `task` after the demo's current tail. The last task of a queue removes the tail and the
   * demo's `quickPending` overlay before its own promise settles - on success and on failure. */
  const enqueue = (id: string, task: () => Promise<void>): Promise<void> => {
    const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
      try {
        await task()
      } finally {
        if (queues.get(id) === tail) {
          // `onRowPatched` is a React setState called outside an event: its re-render is scheduled
          // (a macrotask), while this store's `set` re-renders subscribers synchronously. Clearing
          // the overlay now would show the stale row for a frame (and a click in that window would
          // compute from it). Two macrotasks let React commit first; the task is still part of
          // this write's promise, so a write queued meanwhile chains behind it and, since it
          // replaces the tail, makes the re-check below skip - the newest write clears instead.
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        if (queues.get(id) === tail) {
          queues.delete(id)
          const { quickPending } = get()
          if (quickPending[id] !== undefined) {
            const rest = { ...quickPending }
            delete rest[id]
            set({ quickPending: rest })
          }
        }
      }
    })
    // The tail never rejects, so one failed write never poisons the writes queued after it.
    const tail = run.catch(() => undefined)
    queues.set(id, tail)
    return run
  }

  /** One quick write. `fingerprint` is set only for a confirmed replace - captured when the user
   * confirmed, never picked up from whatever the entry holds by the time the task runs. */
  const quickWrite = async (
    id: string,
    patch: QuickPatch,
    onRowPatched: RowPatcher,
    fingerprint: string | undefined,
  ): Promise<void> => {
    const entry = get().drafts[id]
    // A replace dialog is open (possibly opened by the write queued just before this one): the
    // user has not confirmed overwriting the file yet, so remember the click for the retry.
    if (fingerprint === undefined && entry?.replace !== undefined) {
      patchEntry(id, { pendingQuickEdit: { ...entry.pendingQuickEdit, ...patch } })
      return
    }

    // Never trust the row's own (possibly stale) values - always re-read the sidecar fresh.
    const fresh = await sidecarRead(id)
    if (!fresh.ok) return
    const fields = withQuickEdit(fresh.value.values, patch)

    const outcome =
      fingerprint === undefined
        ? await sidecarWrite(id, fields)
        : await sidecarWrite(id, fields, fingerprint)
    if (!outcome.ok) return

    if (outcome.value.status === 'needsConfirmation') {
      const { fileName, issues } = outcome.value
      const draft = draftFromSidecar(fresh.value.values)
      upsertEntry(
        id,
        {
          fingerprint: outcome.value.fingerprint,
          replace: { fileName, issues },
          pendingQuickEdit: { ...get().drafts[id]?.pendingQuickEdit, ...patch },
        },
        () => ({ draft, baseline: draft }),
      )
      return
    }

    // Written: reflect what is actually on disk now - same as `save`.
    const after = await sidecarRead(id)
    if (!after.ok) return
    onRowPatched(id, after.value)

    // An open draft must never be left holding pre-quick-edit favourite/rating - but only those two
    // fields are refreshed, so unsaved edit-mode changes to the rest survive.
    const open = get().drafts[id]
    if (open !== undefined) {
      const { favourite, rating } = draftFromSidecar(after.value.values)
      patchEntry(id, {
        draft: { ...open.draft, favourite, rating },
        baseline: { ...open.baseline, favourite, rating },
        replace: undefined,
        fingerprint: undefined,
        pendingQuickEdit: undefined,
      })
    }
  }

  const startQuick = (
    id: string,
    patch: QuickPatch,
    onRowPatched: RowPatcher,
    fingerprint: string | undefined,
  ): Promise<void> => {
    set({ quickPending: { ...get().quickPending, [id]: { ...get().quickPending[id], ...patch } } })
    return enqueue(id, () => quickWrite(id, patch, onRowPatched, fingerprint))
  }

  /** `save`'s queued part. Reads the draft only now, so a quick edit queued ahead of it (which
   * refreshes the draft's favourite/rating) is carried along instead of written back over. */
  const saveWrite = async (
    id: string,
    fingerprint: string | undefined,
    onRowPatched: RowPatcher,
  ): Promise<void> => {
    const entry = get().drafts[id]
    if (entry === undefined) return
    const converted = draftToFields(entry.draft)
    if (!converted.ok) {
      patchEntry(id, { saving: false })
      return
    }
    // Quick edits merged while a replace dialog was open ride along with the confirmed save.
    const fields =
      entry.pendingQuickEdit === undefined
        ? converted.fields
        : withQuickEdit(converted.fields, entry.pendingQuickEdit)
    const outcome =
      fingerprint === undefined
        ? await sidecarWrite(id, fields)
        : await sidecarWrite(id, fields, fingerprint)

    if (!outcome.ok) {
      // The merged quick edits were part of this failed write: drop them so a retry can't carry stale ones.
      patchEntry(id, {
        saving: false,
        saveError: outcome.error,
        fingerprint: undefined,
        pendingQuickEdit: undefined,
      })
      return
    }
    if (outcome.value.status === 'needsConfirmation') {
      const { fileName, issues } = outcome.value
      patchEntry(id, {
        saving: false,
        fingerprint: outcome.value.fingerprint,
        replace: { fileName, issues },
      })
      return
    }

    // Written: reflect what is actually on disk now, not what was sent.
    const fresh = await sidecarRead(id)
    if (!fresh.ok) {
      patchEntry(id, {
        saving: false,
        saveError: fresh.error,
        fingerprint: undefined,
        pendingQuickEdit: undefined,
      })
      return
    }
    const baseline = draftFromSidecar(fresh.value.values)
    set({
      drafts: { ...get().drafts, [id]: { draft: baseline, baseline } },
      ...(get().editingId === id ? { editingId: null } : {}),
    })
    onRowPatched(id, fresh.value)
  }

  const leave = (request: PendingLeave): void => {
    const { selectedId, editingId, drafts } = get()
    if (selectedId !== null && editingId === selectedId && isEntryDirty(drafts[selectedId])) {
      set({ pendingLeave: request })
      return
    }
    const left = selectedId === null ? undefined : drafts[selectedId]
    if (
      selectedId !== null &&
      left !== undefined &&
      !isEntryDirty(left) &&
      !left.saving &&
      left.replace === undefined
    ) {
      const rest = { ...drafts }
      delete rest[selectedId]
      set({ drafts: rest })
    }
    set({ selectedId: request.targetId, editingId: null, pendingLeave: null })
  }

  return {
    selectedId: null,
    editingId: null,
    drafts: {},
    quickPending: {},
    pendingLeave: null,
    select: (id) => {
      if (get().selectedId === id) return
      leave({ kind: 'select', targetId: id })
    },
    close: () => leave({ kind: 'close', targetId: null }),
    deselectIfMissing: (ids) => {
      const current = get().selectedId
      if (current === null) return
      if (!ids.includes(current)) set({ selectedId: null, pendingLeave: null })
    },
    startEdit: (id, values) => {
      const existing = get().drafts[id]
      if (isEntryDirty(existing) || existing?.saving) {
        set({ editingId: id })
        return
      }
      const draft = draftFromSidecar(values)
      set({ drafts: { ...get().drafts, [id]: { draft, baseline: draft } }, editingId: id })
    },
    cancelEdit: (id) => {
      if (get().drafts[id]?.saving) return
      const rest = { ...get().drafts }
      delete rest[id]
      set({ drafts: rest, ...(get().editingId === id ? { editingId: null } : {}) })
    },
    updateDraft: (id, patch) => {
      const entry = get().drafts[id]
      if (entry === undefined || entry.saving) return
      const draft = typeof patch === 'function' ? patch(entry.draft) : { ...entry.draft, ...patch }
      patchEntry(id, { draft, saveError: undefined })
    },
    cancelDraft: (id) => {
      const entry = get().drafts[id]
      if (entry === undefined || entry.saving) return
      patchEntry(id, { draft: entry.baseline, saveError: undefined })
    },
    discardDraft: (id) => {
      const rest = { ...get().drafts }
      delete rest[id]
      set({ drafts: rest })
    },
    keepEditing: () => set({ pendingLeave: null }),
    discardAndLeave: () => {
      const { pendingLeave, selectedId } = get()
      if (pendingLeave === null) return
      if (selectedId !== null) get().discardDraft(selectedId)
      set({ selectedId: pendingLeave.targetId, editingId: null, pendingLeave: null })
    },
    save: (id, onRowPatched) => {
      const entry = get().drafts[id]
      if (entry === undefined || entry.saving) return Promise.resolve()
      // Invalid rating/date: the editor already shows the inline errors - no IPC at all.
      if (!draftToFields(entry.draft).ok) return Promise.resolve()

      // The fingerprint the user confirmed (if any) - taken now, not from whatever a quick edit
      // queued ahead of this save leaves in the entry.
      const fingerprint = entry.fingerprint
      patchEntry(id, { saving: true, saveError: undefined, replace: undefined })
      return enqueue(id, () => saveWrite(id, fingerprint, onRowPatched))
    },
    cancelReplace: (id) =>
      patchEntry(id, { replace: undefined, fingerprint: undefined, pendingQuickEdit: undefined }),
    quickEdit: (id, patch, onRowPatched) => startQuick(id, patch, onRowPatched, undefined),
    confirmQuickEdit: (id, onRowPatched) => {
      const entry = get().drafts[id]
      if (entry?.replace === undefined) return Promise.resolve()
      const patch = entry.pendingQuickEdit ?? {}
      const fingerprint = entry.fingerprint
      patchEntry(id, { replace: undefined, pendingQuickEdit: undefined })
      return startQuick(id, patch, onRowPatched, fingerprint)
    },
  }
})
