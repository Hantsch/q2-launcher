import { useEffect } from 'react'
import { create } from 'zustand'
import type { LocalizedMessage } from '@shared/types'

/**
 * Story 180: the seam through which a module view contributes the action bar's primary
 * button for its own tab. The view publishes; the action bar applies it only while the
 * publisher's route is the active one, and only in place of the shell's final `play` case.
 */
export interface ContributedAction {
  /** Stable id; becomes the button's `data-action`. */
  id: string
  labelKey: string
  disabled: boolean
  /** Why the action is disabled - shown as visible text next to the button. */
  reason?: LocalizedMessage
  /** A failure of the last run - shown as an alert next to the button. */
  error?: LocalizedMessage
  run(): void
}

interface PrimaryActionStore {
  owner: string | null
  action: ContributedAction | null
  publish(owner: string, action: ContributedAction): void
  clear(owner: string): void
}

export const usePrimaryActionStore = create<PrimaryActionStore>((set, get) => ({
  owner: null,
  action: null,
  publish: (owner, action) => set({ owner, action }),
  clear: (owner) => {
    if (get().owner === owner) set({ owner: null, action: null })
  },
}))

/**
 * Publish `action` for `owner` (a route) while mounted; pass null to contribute nothing.
 * On unmount or when the contribution goes away, clear only if the store is still the caller's.
 */
export function usePrimaryActionContribution(
  owner: string,
  action: ContributedAction | null,
): void {
  useEffect(() => {
    if (!action) return
    usePrimaryActionStore.getState().publish(owner, action)
    return () => usePrimaryActionStore.getState().clear(owner)
  }, [owner, action])
}
