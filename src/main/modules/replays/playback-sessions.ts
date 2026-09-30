/**
 * Story 157: which demo ids are currently mid-playback, so the rename guard can refuse to rename a
 * demo that is playing right now. Populated by playback in Sprint S28 story 159 - nothing registers
 * into it yet; it exists so story 157's rename guard has something to check.
 */
export interface PlaybackSessions {
  begin(id: string): void
  end(id: string): void
  isPlaying(id: string): boolean
}

export function createPlaybackSessions(): PlaybackSessions {
  const playing = new Set<string>()
  return {
    begin(id: string): void {
      playing.add(id)
    },
    end(id: string): void {
      playing.delete(id)
    },
    isPlaying(id: string): boolean {
      return playing.has(id)
    },
  }
}
