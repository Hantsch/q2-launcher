import { create } from 'zustand'
import type { LocalizedMessage } from '@shared/types'
import { DEFAULT_PLAYER_MODE, type PlayerMode } from '@shared/replays/player-mode'
import { readPlaybackMode, setPlaybackMode } from './client'

interface PlaybackModeState {
  mode: PlayerMode
  loaded: boolean
  busy: boolean
  error: LocalizedMessage | null
  /** Reads main's mode once; calls while loaded or loading do nothing. */
  load: () => Promise<void>
  /** Takes the mode main answers with; a refusal leaves the old value and sets `error`. */
  set: (mode: PlayerMode) => Promise<void>
}

let loading = false

export const usePlaybackModeStore = create<PlaybackModeState>((set, get) => ({
  mode: DEFAULT_PLAYER_MODE,
  loaded: false,
  busy: false,
  error: null,
  load: async () => {
    if (get().loaded || loading) return
    loading = true
    try {
      const result = await readPlaybackMode()
      if (result.ok) set({ mode: result.value, loaded: true, error: null })
      else set({ error: result.error })
    } finally {
      loading = false
    }
  },
  set: async (mode) => {
    set({ busy: true })
    try {
      const result = await setPlaybackMode(mode)
      if (result.ok) set({ mode: result.value, loaded: true, error: null })
      else set({ error: result.error })
    } finally {
      set({ busy: false })
    }
  },
}))
