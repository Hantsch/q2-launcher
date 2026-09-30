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
  pendingQuickEdit?: { favourite?: boolean; rating?: number | null }
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
  updateDraft(id: string, patch: Partial<SidecarDraft> | ((draft: SidecarDraft) => SidecarDraft)): void
  /** The editor's Cancel: back to the baseline, the entry itself stays. */
  cancelDraft(id: string): void
  discardDraft(id: string): void
  keepEditing(): void
  discardAndLeave(): void
  save(id: string, onRowPatched: RowPatcher): Promise<void>
  /** The replace dialog's Cancel: closes it and forgets the fingerprint, so the next Save asks again. */
  cancelReplace(id: string): void
  /** Story 155 D6: a favourite/rating toggle from the row itself, without opening the panel. Always
   * re-reads the sidecar fresh (never trusts the row's own possibly-stale values), merges just the
   * patch via `withQuickEdit`, and writes it back - reusing `sidecarWrite`'s `needsConfirmation`
   * flow (surfaced through the same `entry.replace`/`ReplaceSidecarDialog` the full editor uses) and
   * `onRowPatched` for the post-save row patch. If a draft for this demo is already open, its
   * `baseline`/`draft` are refreshed too, so a later Save from the open editor can't write back
   * stale values. Never calls `select`, `scanStart` or `indexRead`. */
  quickEdit(
    id: string,
    patch: { favourite?: boolean; rating?: number | null },
    onRowPatched: RowPatcher,
  ): Promise<void>
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

  const leave = (request: PendingLeave): void => {
    const { selectedId, editingId, drafts } = get()
    if (selectedId !== null && editingId === selectedId && isEntryDirty(drafts[selectedId])) {
      set({ pendingLeave: request })
      return
    }
    const left = selectedId === null ? undefined : drafts[selectedId]
    if (selectedId !== null && left !== undefined && !isEntryDirty(left) && !left.saving && left.replace === undefined) {
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
    cancelReplace: (id) =>
      patchEntry(id, { replace: undefined, fingerprint: undefined, pendingQuickEdit: undefined }),
    save: async (id, onRowPatched) => {
      const entry = get().drafts[id]
      if (entry === undefined || entry.saving) return
      const converted = draftToFields(entry.draft)
      // Invalid rating/date: the editor already shows the inline errors - no IPC at all.
      if (!converted.ok) return

      const fingerprint = entry.fingerprint
      patchEntry(id, { saving: true, saveError: undefined, replace: undefined })
      const outcome =
        fingerprint === undefined
          ? await sidecarWrite(id, converted.fields)
          : await sidecarWrite(id, converted.fields, fingerprint)

      if (!outcome.ok) {
        patchEntry(id, { saving: false, saveError: outcome.error, fingerprint: undefined })
        return
      }
      if (outcome.value.status === 'needsConfirmation') {
        const { fileName, issues } = outcome.value
        patchEntry(id, { saving: false, fingerprint: outcome.value.fingerprint, replace: { fileName, issues } })
        return
      }

      // Written: reflect what is actually on disk now, not what was sent.
      const fresh = await sidecarRead(id)
      if (!fresh.ok) {
        patchEntry(id, { saving: false, saveError: fresh.error, fingerprint: undefined })
        return
      }
      const baseline = draftFromSidecar(fresh.value.values)
      set({
        drafts: { ...get().drafts, [id]: { draft: baseline, baseline } },
        ...(get().editingId === id ? { editingId: null } : {}),
      })
      onRowPatched(id, fresh.value)
    },
    quickEdit: async (id, patch, onRowPatched) => {
      const existing = get().drafts[id]
      if (existing?.saving) return
      const fingerprint = existing?.fingerprint

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
          { fingerprint: outcome.value.fingerprint, replace: { fileName, issues }, pendingQuickEdit: patch },
          () => ({ draft, baseline: draft }),
        )
        return
      }

      // Written: reflect what is actually on disk now - same as `save`.
      const after = await sidecarRead(id)
      if (!after.ok) return
      onRowPatched(id, after.value)

      // A panel already open for this demo must never be left holding pre-quick-edit values.
      const openEntry = get().drafts[id]
      if (openEntry !== undefined) {
        const baseline = draftFromSidecar(after.value.values)
        patchEntry(id, {
          draft: baseline,
          baseline,
          replace: undefined,
          fingerprint: undefined,
          pendingQuickEdit: undefined,
        })
      }
    },
  }
})
