import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Story 086 D3: measures an element's own content width via `ResizeObserver`, updating whenever it
 * resizes. `DashboardGrid` needs this to decide grid vs. single-column mode from the dashboard
 * container's own width, never `window.innerWidth` (Decisions (Sprint) - the 900px narrow
 * threshold is measured on the container so it is reachable at all: the window's own minimum is
 * 940px, `src/shared/constants.ts`).
 *
 * Kept inside the home module rather than promoted to `src/renderer/src/components/` - the story's
 * own Decisions defer that until a second consumer actually needs it.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined

    setWidth(node.getBoundingClientRect().width)

    // `ResizeObserver` does not exist under the plain jsdom environment `HomeView.test.tsx` renders
    // this component's tree in (no polyfill is registered globally, and none should be added just
    // for this) - falling back to the one-off measurement above rather than throwing keeps this
    // hook safe to mount anywhere a real `ResizeObserver` happens not to exist.
    if (typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
