import { useCallback, useState } from 'react'
import type { Job, LocalizedMessage, Outcome } from '@shared/types'
import { useLauncher } from '../../store/useLauncher'
import { useSubmitting } from '../ui/useSubmitting'

/**
 * Starts a job and follows it. A refusal is kept as `refusal` (the caller's dialog stays open and
 * shows it); a success sets `jobId`, and `job` is that id's live entry in the store's `jobs`
 * slice (undefined once the job has left the list). Re-entry while `starting` is a no-op.
 */
export function useStartJob<A extends unknown[]>(
  starter: (...args: A) => Promise<Outcome<{ jobId: string }>>,
): {
  start: (...args: A) => Promise<void>
  starting: boolean
  refusal: LocalizedMessage | null
  jobId: string | null
  job: Job | undefined
} {
  const { submitting, run } = useSubmitting()
  const [refusal, setRefusal] = useState<LocalizedMessage | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useLauncher((state) => state.jobs.find((candidate) => candidate.id === jobId))

  const start = useCallback(
    async (...args: A): Promise<void> => {
      await run(async () => {
        setRefusal(null)
        const result = await starter(...args)
        if (result.ok) setJobId(result.value.jobId)
        else setRefusal(result.error)
      })
    },
    [run, starter],
  )

  return { start, starting: submitting, refusal, jobId, job }
}
