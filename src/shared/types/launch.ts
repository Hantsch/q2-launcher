/** State of the game process the launcher started. */
export type LaunchPhase = 'idle' | 'starting' | 'running' | 'exited' | 'failed'

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
}
