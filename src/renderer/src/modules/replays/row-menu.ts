/** Where a row menu opens: viewport coordinates of the pointer, or of the focused row for the keyboard. */
export interface MenuPoint {
  x: number
  y: number
}

/** The menu point of a key-opened menu: on the focused row, a little in from its left edge. */
export function menuPointOf(element: HTMLElement): MenuPoint {
  const rect = element.getBoundingClientRect()
  return { x: rect.left + 24, y: rect.top + rect.height / 2 }
}

/** True for the two keys that ask for a context menu on the focused element. */
export function isContextMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}
