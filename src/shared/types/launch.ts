/**
 * State of the game process the launcher started.
 *
 * Story 104 D4: `'handed-off'` means the launch was passed to another program (Steam) that
 * starts the game itself - there is no game process of ours to follow, so no exit, no playtime,
 * and it never counts as running.
 */
export type LaunchPhase = 'idle' | 'starting' | 'running' | 'handed-off' | 'exited' | 'failed'

export interface LaunchState {
  phase: LaunchPhase
  installationId: string | null
  pid?: number
  startedAt?: string
  exitedAt?: string
  exitCode?: number | null
  /** Set when `phase === 'failed'`. i18n key. */
  error?: { key: string; params?: Record<string, string | number> }
}

export const IDLE_LAUNCH_STATE: LaunchState = { phase: 'idle', installationId: null }

export interface LaunchInput {
  installationId: string
  /** Overrides the installation's `activeGameDir` for this launch only. */
  gameDir?: string
  /** `+connect <address>` - used later by a server browser. */
  connect?: string
  /** Extra arguments for this launch only, appended last. */
  extraArgs?: string[]
}

/**
 * What the launcher would run, without running it. Rendered in the UI so the
 * user can see exactly which command line an installation produces.
 */
export interface LaunchPlan {
  executablePath: string
  args: string[]
  workingDirectory: string
  /** Ready-to-read, shell-quoted preview of the command. Display only. */
  preview: string
  /**
   * Story 104 D4: the command hands the launch to Steam (`steam steam://launch/<appid>/client/<n>`)
   * instead of running the game - `start()` spawns it detached and does not track it.
   */
  handoff?: true
}
