import { create } from 'zustand'
import type { SidecarIssue, SidecarState } from '@shared/modules/replays'
import type { SidecarFields } from '@shared/replays/sidecar'
import { composeChanges, quickChange, type SidecarChange } from '@shared/replays/sidecar-draft'
import type { LocalizedMessage } from '@shared/types/common'
import { toastOutcomeError } from '../../lib/toast'
import { useLauncher } from '../../store/useLauncher'
import { sidecarRead, sidecarWrite } from './client'
import * as selection from './selection'

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

/** How one `edit` ended. `cancelled` only ever comes from the replace dialog's Cancel. */
export type EditResult = 'saved' | 'failed' | 'cancelled'

/** Per demo, the settle functions of every `edit` parked behind the open replace dialog - all of
 * them are settled together by whatever finally writes (or drops) `pendingChange`. */
const parked = new Map<string, Array<(result: EditResult) => void>>()

function settleParked(id: string, result: EditResult): void {
  const waiting = parked.get(id)
  parked.delete(id)
  waiting?.forEach((settle) => settle(result))
}

/** One demo's pending replace confirmation. `fingerprint` is only ever set by a `needsConfirmation`
 * answer and only ever sent back after the user confirmed the replace dialog (`replace` is that
 * dialog's content while it is open). */
export interface DemoDraftEntry {
  fingerprint?: string
  replace?: { fileName: string; issues: SidecarIssue[] }
  /** Set only while a replace dialog is open: every `edit` for this demo that hit it, composed in
   * arrival order - written once with `fingerprint` on confirm, dropped on cancel (story 243). */
  pendingChange?: SidecarChange
  /** The favourite/rating part of `pendingChange`, so a confirm can restore the row's optimistic
   * overlay for the retry. */
  pendingOverlay?: QuickPatch
}

/**
 * Which demo's detail panel is open, plus every demo's pending replace confirmation. Module-level
 * (a zustand store survives `ReplaysView` unmount/remount), so switching module never loses an
 * open replace dialog - nothing here is cleared on unmount. Selecting or closing switches directly:
 * a field with unsaved text commits itself when it unmounts.
 */
export interface DemoEditorState {
  /** The one demo the detail panel shows: set only while exactly one demo is selected. */
  selectedId: string | null
  /** Every selected demo (the multi-selection); `selectedId` is derived from it. */
  selectedIds: readonly string[]
  /** The row a Shift-click range grows from. */
  anchor: string | null
  drafts: Record<string, DemoDraftEntry>
  /** Story 179: the optimistic favourite/rating overlay per demo - set the moment a quick edit is
   * clicked, dropped when that demo's write queue drains (success or failure). Read it through
   * `effectiveQuickValues`. */
  quickPending: Record<string, QuickPatch>
  select(id: string): void
  /** Ctrl/Cmd-click or the row checkbox. */
  toggleSelect(id: string): void
  /** Shift-click: the rows between the anchor and `id` in `visibleOrder`. */
  selectRange(id: string, visibleOrder: readonly string[]): void
  selectAll(visibleOrder: readonly string[]): void
  close(): void
  /** Drops every selected demo that is no longer in `ids` - the "row vanished on a re-read or
   * a filter change" guard. */
  deselectIfMissing(ids: readonly string[]): void
  /**
   * The one write path for every detail edit. Queued behind any running or queued write
   * for the same demo; when it runs it re-reads the sidecar fresh, applies `change` to what is on
   * disk, writes it and hands a second fresh read to `onRowPatched`. A failed read or write toasts
   * and resolves `failed`. A `needsConfirmation` answer - or a replace dialog already open for the
   * demo - parks the change in the entry (composed with any other parked one) and leaves the promise
   * pending until `confirmEdit` writes it (`saved`/`failed`) or `cancelEdit` drops it (`cancelled`).
   * (story 243)
   */
  edit(id: string, change: SidecarChange, onRowPatched: RowPatcher): Promise<EditResult>
  /** The replace dialog's Confirm: writes every parked change with the fingerprint the dialog was
   * opened for. Resolves when that write's turn in the queue is over. */
  confirmEdit(id: string, onRowPatched: RowPatcher): Promise<void>
  /** The replace dialog's Cancel: drops every parked change (each resolves `cancelled`) and the
   * fingerprint, so the next write asks again. */
  cancelEdit(id: string): void
  /** Story 155 / 179: a favourite/rating toggle from the row itself, without opening the panel - an
   * `edit` with `quickChange(patch)`. The patch lands in `quickPending` at once. Never calls
   * `select`, `scanStart` or `indexRead`. The promise resolves when this edit's turn in the queue is
   * over, not when a parked edit is finally confirmed. */
  quickEdit(id: string, patch: QuickPatch, onRowPatched: RowPatcher): Promise<void>
  confirmQuickEdit(id: string, onRowPatched: RowPatcher): Promise<void>
}

/** Which demo's pending `replace` the view shows - the view renders the only replace dialog. */
export function findRowReplaceId(drafts: Record<string, DemoDraftEntry>): string | undefined {
  return Object.keys(drafts).find((id) => drafts[id]?.replace !== undefined)
}

export const useDemoEditorStore = create<DemoEditorState>((set, get) => {
  const patchEntry = (id: string, patch: Partial<DemoDraftEntry>): void => {
    const entry = get().drafts[id]
    if (entry === undefined) return
    set({ drafts: { ...get().drafts, [id]: { ...entry, ...patch } } })
  }

  /** Like `patchEntry`, but creates the entry when none exists yet - a "needs confirmation" answer
   * has to remember its fingerprint/replace dialog even with no panel open. */
  const upsertEntry = (id: string, patch: Partial<DemoDraftEntry>): void => {
    const entry = get().drafts[id] ?? {}
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

  const showOverlay = (id: string, patch: QuickPatch): void =>
    set({ quickPending: { ...get().quickPending, [id]: { ...get().quickPending[id], ...patch } } })

  /** Parks `change` behind the open replace dialog. The entry exists: `replace` is set on it. */
  const park = (
    id: string,
    change: SidecarChange,
    overlay: QuickPatch | undefined,
    settle: (result: EditResult) => void,
  ): void => {
    const entry = get().drafts[id]
    patchEntry(id, {
      pendingChange:
        entry?.pendingChange === undefined ? change : composeChanges(entry.pendingChange, change),
      pendingOverlay:
        overlay === undefined ? entry?.pendingOverlay : { ...entry?.pendingOverlay, ...overlay },
    })
    parked.set(id, [...(parked.get(id) ?? []), settle])
  }

  const failEdit = (
    failure: { ok: false; error: LocalizedMessage },
    settle: (result: EditResult) => void,
  ): void => {
    toastOutcomeError(useLauncher.getState().pushToast, failure)
    settle('failed')
  }

  /** One queued edit write. `fingerprint` is set only for a confirmed replace - captured when the
   * user confirmed, never picked up from whatever the entry holds by the time the task runs. It
   * never waits on the dialog itself: a parked edit ends its turn at once, so the confirm's own
   * write can queue behind it. */
  const editWrite = async (
    id: string,
    change: SidecarChange,
    onRowPatched: RowPatcher,
    fingerprint: string | undefined,
    overlay: QuickPatch | undefined,
    settle: (result: EditResult) => void,
  ): Promise<void> => {
    // A replace dialog is open (possibly opened by the write queued just before this one): the
    // user has not confirmed overwriting the file yet, so keep the change for the retry.
    if (fingerprint === undefined && get().drafts[id]?.replace !== undefined) {
      park(id, change, overlay, settle)
      return
    }

    // Never trust the row's own (possibly stale) values - always re-read the sidecar fresh.
    const fresh = await sidecarRead(id)
    if (!fresh.ok) return failEdit(fresh, settle)
    const fields = change(fresh.value.values)

    const outcome =
      fingerprint === undefined
        ? await sidecarWrite(id, fields)
        : await sidecarWrite(id, fields, fingerprint)
    if (!outcome.ok) return failEdit(outcome, settle)

    if (outcome.value.status === 'needsConfirmation') {
      const { fileName, issues } = outcome.value
      upsertEntry(id, { fingerprint: outcome.value.fingerprint, replace: { fileName, issues } })
      park(id, change, overlay, settle)
      return
    }

    // Written: reflect what is actually on disk now, not what was sent.
    const after = await sidecarRead(id)
    if (!after.ok) return failEdit(after, settle)
    onRowPatched(id, after.value)

    settle('saved')
  }

  const queueEdit = (
    id: string,
    change: SidecarChange,
    onRowPatched: RowPatcher,
    fingerprint: string | undefined,
    overlay: QuickPatch | undefined,
    settle: (result: EditResult) => void,
  ): Promise<void> =>
    enqueue(id, async () => {
      try {
        await editWrite(id, change, onRowPatched, fingerprint, overlay, settle)
      } catch (error) {
        // A rejected IPC call must not leave the edit's promise pending forever.
        settle('failed')
        throw error
      }
    })

  /** Closes the replace dialog and settles every change parked behind it as `cancelled`. */
  const dropReplace = (id: string): void => {
    patchEntry(id, {
      replace: undefined,
      fingerprint: undefined,
      pendingChange: undefined,
      pendingOverlay: undefined,
    })
    settleParked(id, 'cancelled')
  }

  const currentSelection = (): selection.Selection => ({
    ids: get().selectedIds,
    anchor: get().anchor,
  })
  const setSelection = (next: selection.Selection): void =>
    set({ selectedIds: next.ids, anchor: next.anchor, selectedId: selection.single(next) })

  return {
    selectedId: null,
    selectedIds: [],
    anchor: null,
    drafts: {},
    quickPending: {},
    select: (id) => setSelection(selection.only(id)),
    toggleSelect: (id) => setSelection(selection.toggle(currentSelection(), id)),
    selectRange: (id, visibleOrder) =>
      setSelection(selection.range(currentSelection(), id, visibleOrder)),
    selectAll: (visibleOrder) =>
      setSelection(selection.all(visibleOrder, currentSelection().anchor)),
    close: () => setSelection(selection.clear()),
    deselectIfMissing: (ids) => {
      const current = currentSelection()
      const next = selection.prune(current, ids)
      if (next !== current) setSelection(next)
    },
    edit: (id, change, onRowPatched) =>
      new Promise<EditResult>((resolve) => {
        void queueEdit(id, change, onRowPatched, undefined, undefined, resolve).catch(
          () => undefined,
        )
      }),
    confirmEdit: (id, onRowPatched) => {
      const entry = get().drafts[id]
      if (entry?.replace === undefined) return Promise.resolve()
      const { fingerprint, pendingOverlay } = entry
      const change = entry.pendingChange ?? composeChanges()
      // Taken now: an edit arriving after this confirm queues behind the confirmed write instead.
      const waiting = parked.get(id) ?? []
      parked.delete(id)
      patchEntry(id, {
        replace: undefined,
        fingerprint: undefined,
        pendingChange: undefined,
        pendingOverlay: undefined,
      })
      if (pendingOverlay !== undefined) showOverlay(id, pendingOverlay)
      return queueEdit(id, change, onRowPatched, fingerprint, pendingOverlay, (result) =>
        waiting.forEach((settle) => settle(result)),
      )
    },
    cancelEdit: (id) => dropReplace(id),
    quickEdit: (id, patch, onRowPatched) => {
      showOverlay(id, patch)
      return queueEdit(id, quickChange(patch), onRowPatched, undefined, patch, () => undefined)
    },
    confirmQuickEdit: (id, onRowPatched) => get().confirmEdit(id, onRowPatched),
  }
})
