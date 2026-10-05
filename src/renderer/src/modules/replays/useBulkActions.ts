import { useCallback, useRef, useState } from 'react'
import type { BulkItemOutcome, BulkOutcome } from '@shared/replays/bulk'
import type { DemoRow } from '@shared/modules/replays'
import type { Outcome } from '@shared/types'
import { toastOutcomeError } from '../../lib/toast'
import { useLauncher } from '../../store/useLauncher'
import { useDemoEditorStore } from './demo-editor-store'

export type BulkKind = 'delete' | 'tag' | 'move'

/** A bulk call's answer; `cancelled` is a dismissed folder dialog, which changes nothing. */
export type BulkCallResult = BulkOutcome | { cancelled: true }

/** A demo the action did not act on, named from the list as it was when the action started. */
export interface BulkOutcomeEntry extends BulkItemOutcome {
  name: string
}

export interface BulkOutcomeView {
  kind: BulkKind
  done: number
  failed: number
  skipped: number
  /** Failed and skipped demos only, in request order. */
  entries: BulkOutcomeEntry[]
}

interface Shown {
  view: BulkOutcomeView
  /** The `selectedIds` array the outcome was set against; any other array is a selection change. */
  shownFor: readonly string[]
}

export interface BulkActions {
  busy: BulkKind | null
  /** The last action's outcome, until the selection next changes. */
  outcome: BulkOutcomeView | null
  /** Runs `call` over `ids`, re-reads the lists, leaves the demos that were not acted on selected
   * and shows the outcome. A whole-call refusal toasts and changes nothing. */
  /** Hides the shown outcome without touching the selection. */
  dismiss(): void
  run(
    kind: BulkKind,
    ids: readonly string[],
    call: (ids: string[]) => Promise<Outcome<BulkCallResult>>,
  ): Promise<void>
}

function summarize(
  kind: BulkKind,
  items: readonly BulkItemOutcome[],
  names: ReadonlyMap<string, string>,
): BulkOutcomeView {
  const entries = items
    .filter((item) => item.status !== 'done')
    .map((item): BulkOutcomeEntry => ({ ...item, name: names.get(item.demoId) ?? item.demoId }))
  const failed = entries.filter((entry) => entry.status === 'failed').length
  return {
    kind,
    done: items.length - entries.length,
    failed,
    skipped: entries.length - failed,
    entries,
  }
}

/** The one pipeline of every bulk action on the demos list: call, outcome, re-read, selection. */
export function useBulkActions(options: {
  rows: readonly DemoRow[]
  reread: () => Promise<void>
}): BulkActions {
  const { rows, reread } = options
  const pushToast = useLauncher((state) => state.pushToast)
  const selectedIds = useDemoEditorStore((state) => state.selectedIds)
  const [busy, setBusy] = useState<BulkKind | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const busyRef = useRef(false)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const run = useCallback<BulkActions['run']>(
    async (kind, ids, call) => {
      if (busyRef.current || ids.length === 0) return
      busyRef.current = true
      setBusy(kind)
      try {
        const names = new Map(rowsRef.current.map((row) => [row.id, row.fileName]))
        const result = await call([...ids])
        if (!result.ok) {
          toastOutcomeError(pushToast, result)
          return
        }
        if ('cancelled' in result.value) return
        const view = summarize(kind, result.value.items, names)
        await reread()
        const store = useDemoEditorStore.getState()
        store.selectAll(view.entries.map((entry) => entry.demoId))
        setShown({ view, shownFor: useDemoEditorStore.getState().selectedIds })
      } finally {
        busyRef.current = false
        setBusy(null)
      }
    },
    [pushToast, reread],
  )

  return {
    busy,
    outcome: shown !== null && shown.shownFor === selectedIds ? shown.view : null,
    run,
    dismiss: () => setShown(null),
  }
}
