import type { LocalizedMessage } from '@shared/types'
import { usePlaybackStore } from './playback-store'

/**
 * Story 173 D3: the shell's read of the demo session, so the action bar can turn "Running" into
 * "Stop demo" while a demo is playing. The session ends only on the engine's `state: ended`.
 */
export function useDemoStop(): {
  active: boolean
  stopping: boolean
  stop: () => Promise<LocalizedMessage | null>
} {
  const active = usePlaybackStore((s) => s.session !== null)
  const stopping = usePlaybackStore((s) => s.session?.stopping ?? false)
  const stop = usePlaybackStore((s) => s.requestStop)
  return { active, stopping, stop }
}
