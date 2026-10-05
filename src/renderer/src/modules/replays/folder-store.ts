import { create } from 'zustand'
import type { FolderRef } from '@shared/replays/demo-folders'

interface FolderState {
  /** The folder whose contents the list shows; `null` is the top level (every source's root). */
  current: FolderRef | null
  open: (ref: FolderRef | null) => void
  /** Steps to the parent folder; a source root steps to the top level. */
  up: () => void
}

/** Module store, not view state: the open folder survives a route switch (like the demo selection
 * in `useDemoEditorStore`) but is not persisted across a restart. */
export const useFolderStore = create<FolderState>((set, get) => ({
  current: null,
  open: (ref) => set({ current: ref }),
  up: () => {
    const { current } = get()
    if (current === null) return
    set({
      current:
        current.path.length === 0
          ? null
          : { sourceKey: current.sourceKey, path: current.path.slice(0, -1) },
    })
  },
}))
