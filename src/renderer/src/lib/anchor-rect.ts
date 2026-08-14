/**
 * Rect of a floating element's anchor.
 *
 * A wrapper with `display: contents` generates no box at all, so
 * `getBoundingClientRect()` on it returns zeros and anything positioned from it
 * lands in the top-left corner. When that happens, fall back to the first real
 * child - which is laid out normally and is the element the user actually sees.
 */
export function anchorRect(element: HTMLElement | null): DOMRect | null {
  if (!element) return null

  const own = element.getBoundingClientRect()
  if (own.width > 0 || own.height > 0) return own

  const child = element.firstElementChild
  return child ? child.getBoundingClientRect() : null
}
