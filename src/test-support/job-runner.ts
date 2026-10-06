import { vi } from 'vitest'
import {
  IDLE_LAUNCH_STATE,
  ok,
  type Installation,
  type LaunchState,
  type Outcome,
} from '@shared/types'
import { JobRunner } from '../main/services/job-runner'
import { JobsService } from '../main/services/jobs'
import { InstallationWriteGuard, type LaunchHost } from '../main/services/write-guard'
import { makeInstallation } from './fixtures'

/** A launch host whose state the test sets; `set` notifies every subscriber like `LaunchService`. */
export interface ControllableLaunch {
  host: LaunchHost
  set(next: LaunchState): void
  /** Puts the installation's game into `running`, which defers every write into it. */
  startGame(installationId: string): void
  /** Ends the running game, which releases deferred writes. */
  exitGame(): void
}

function controllableLaunch(initial: LaunchState): ControllableLaunch {
  let state = initial
  const listeners = new Set<(next: LaunchState) => void>()
  const set = (next: LaunchState): void => {
    state = next
    for (const listener of [...listeners]) listener(next)
  }
  return {
    host: {
      getState: () => state,
      onStateChange: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    set,
    startGame: (installationId) =>
      set({ phase: 'running', installationId, startedAt: '2026-10-02T10:00:00.000Z' }),
    exitGame: () => {
      const installationId = state.installationId
      set({ phase: 'exited', installationId, exitedAt: '2026-10-02T10:30:00.000Z', exitCode: 0 })
    },
  }
}

export interface JobRunnerHarness {
  runner: JobRunner
  /** The real job list - assert job status through `jobs.list()`. */
  jobs: JobsService
  writeGuard: InstallationWriteGuard
  /** `validate` is a spy answering `ok(makeInstallation({ id }))` unless overridden. */
  installations: {
    validate: ReturnType<typeof vi.fn<(id: string) => Promise<Outcome<Installation>>>>
  }
  launch: ControllableLaunch
}

/**
 * A `JobRunner` over the real `JobsService` and `InstallationWriteGuard`, a launch host the test
 * drives, and a spy `validate` - so a test observes a job the way the UI does, through the job list.
 */
export function makeJobRunner(
  overrides: {
    launch?: LaunchState
    validate?: (id: string) => Promise<Outcome<Installation>>
    /** Stands in for the debounced state file's `settle`. */
    state?: { settle(): Promise<{ ok: boolean }> }
  } = {},
): JobRunnerHarness {
  const launch = controllableLaunch(overrides.launch ?? IDLE_LAUNCH_STATE)
  const jobs = new JobsService(() => {})
  const writeGuard = new InstallationWriteGuard({ launch: launch.host, jobs })
  const installations = {
    validate: vi.fn(overrides.validate ?? (async (id: string) => ok(makeInstallation({ id })))),
  }
  const runner = new JobRunner({
    jobs,
    writeGuard,
    installations,
    ...(overrides.state ? { state: overrides.state } : {}),
  })
  return { runner, jobs, writeGuard, installations, launch }
}
