/** The demos list's multi-selection: the chosen ids plus the anchor a Shift-click range grows from.
 * Pure - the editor store holds the one live value. */
export interface Selection {
  ids: readonly string[]
  /** The last row chosen by a plain click or a toggle; `null` when nothing is chosen. */
  anchor: string | null
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null }

/** A plain click: just this demo, and it becomes the anchor. */
export function only(id: string): Selection {
  return { ids: [id], anchor: id }
}

/** Ctrl/Cmd-click or the row checkbox: flips one demo and moves the anchor to it. */
export function toggle(selection: Selection, id: string): Selection {
  const ids = selection.ids.includes(id)
    ? selection.ids.filter((current) => current !== id)
    : [...selection.ids, id]
  return { ids, anchor: id }
}

/** Shift-click: every demo between the anchor and `id` in `visibleOrder`, replacing the selection.
 * The anchor stays put so a second Shift-click re-ranges from the same row. Without a usable anchor
 * it behaves like a plain click. */
export function range(
  selection: Selection,
  id: string,
  visibleOrder: readonly string[],
): Selection {
  const target = visibleOrder.indexOf(id)
  const from = selection.anchor === null ? -1 : visibleOrder.indexOf(selection.anchor)
  if (target === -1 || from === -1) return only(id)
  const [low, high] = from <= target ? [from, target] : [target, from]
  return { ids: visibleOrder.slice(low, high + 1), anchor: selection.anchor }
}

/** Ctrl+A: every row of the current view, not only the rendered window. */
export function all(visibleOrder: readonly string[], anchor: string | null = null): Selection {
  return {
    ids: [...visibleOrder],
    anchor: anchor !== null && visibleOrder.includes(anchor) ? anchor : (visibleOrder[0] ?? null),
  }
}

export function clear(): Selection {
  return EMPTY_SELECTION
}

/** Drops every id that is no longer in `visible`; returns the same object when nothing changed. */
export function prune(selection: Selection, visible: readonly string[]): Selection {
  const present = new Set(visible)
  const ids = selection.ids.filter((id) => present.has(id))
  const anchor =
    selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null
  if (ids.length === selection.ids.length && anchor === selection.anchor) return selection
  return { ids, anchor }
}

/** The one demo the detail panel shows: only when exactly one is selected. */
export function single(selection: Selection): string | null {
  return selection.ids.length === 1 ? (selection.ids[0] ?? null) : null
}
