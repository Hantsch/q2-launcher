import { useEffect, type RefObject } from 'react'
import { create } from 'zustand'

/** A rect in viewport pixels, same shape the stage report uses. */
export interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
}

export interface OverlayEntry {
  /** The overlay's box; may be null for `always` entries that cover the whole window. */
  element: Element | null
  /** True when the overlay hides the stage wherever it sits (a modal scrim, a native select popup). */
  always?: boolean
}

interface OverlayRegistryState {
  entries: Record<string, OverlayEntry>
  register: (id: string, entry: OverlayEntry) => void
  unregister: (id: string) => void
  /** Does any open overlay cover any part of `rect`? */
  occludes: (rect: OverlayRect) => boolean
}

/**
 * Story 171 D4: the game window is a native window and paints above every DOM overlay, so the
 * stage follower asks this registry whether something is open over the stage and parks the game
 * while it is. Overlays register while open (`useOverlayRegistration`).
 */
export const useOverlayRegistry = create<OverlayRegistryState>((set, get) => ({
  entries: {},
  register: (id, entry) => set((s) => ({ entries: { ...s.entries, [id]: entry } })),
  unregister: (id) =>
    set((s) => {
      if (!(id in s.entries)) return s
      const { [id]: _gone, ...rest } = s.entries
      return { entries: rest }
    }),
  occludes: (rect) =>
    Object.values(get().entries).some((entry) => {
      if (entry.always) return true
      if (!entry.element) return false
      const b = entry.element.getBoundingClientRect()
      if (b.width <= 0 || b.height <= 0) return false
      return (
        b.left < rect.x + rect.width &&
        b.right > rect.x &&
        b.top < rect.y + rect.height &&
        b.bottom > rect.y
      )
    }),
}))

let nextId = 0

/** Registers `ref`'s element (or just `always`) while `open`; unregisters on close/unmount. */
export function useOverlayRegistration(
  open: boolean,
  ref: RefObject<Element | null>,
  always = false,
): void {
  useEffect(() => {
    if (!open) return undefined
    const id = `overlay-${nextId++}`
    useOverlayRegistry.getState().register(id, { element: ref.current, always })
    return () => useOverlayRegistry.getState().unregister(id)
  }, [open, ref, always])
}
