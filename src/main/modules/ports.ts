import type { Installation, Outcome, ToastLevel } from '@shared/types'
import type { JobRunner } from '../services/job-runner'

/**
 * The shell surfaces module jobs are written against. Every module job reaches the
 * job lifecycle, installations, toasts and its log through these, so a job's deps read the same
 * in every module and a test fake fits all of them.
 */

export type {
  JobContext,
  JobLocalFailureKey,
  JobOutcome,
  KillableHandle,
  RunJobSpec,
  StartedJob,
} from '../services/job-runner'
export { JOB_INSTALLATION_BUSY, JOB_LOCAL_FAILURE } from '../services/job-runner'

/** `JobRunner` satisfies it; a job sees only admission and the lifecycle. */
export type JobRunnerHost = Pick<JobRunner, 'run' | 'isInstallationBusy'>

/**
 * The `InstallationsService` surface a job uses. Deliberately no status setter: an installation's
 * status is re-derived by the inspector on `validate`, never hand-set by a job.
 */
export interface InstallationsHost {
  find(id: string): Installation | undefined
  validate(id: string): Promise<Outcome<Installation>>
  setModuleData(id: string, moduleId: string, value: unknown): Outcome<Installation>
}

export interface ToastHost {
  toast(level: ToastLevel, messageKey: string, params?: Record<string, string | number>): void
}

export interface JobLogHost {
  info(message: string): void
  warn(message: string): void
}
