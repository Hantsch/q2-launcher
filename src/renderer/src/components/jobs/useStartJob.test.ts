// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Job, Outcome } from '@shared/types'
import { useLauncher } from '../../store/useLauncher'
import { useStartJob } from './useStartJob'

vi.hoisted(() => {
  ;(globalThis as unknown as { q2: unknown }).q2 = {
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => () => {}),
  }
})

describe('useStartJob', () => {
  it('a refusal keeps the dialog state and a success exposes the job', async () => {
    const refused: Outcome<{ jobId: string }> = {
      ok: false,
      error: { key: 'downloads.error.unknown', params: { a: 'b' } },
    }
    const accepted: Outcome<{ jobId: string }> = { ok: true, value: { jobId: 'job-1' } }
    const starter = vi.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce(accepted)
    const job = { id: 'job-1', status: 'running' } as unknown as Job
    useLauncher.setState({ jobs: [job] })

    const { result } = renderHook(() => useStartJob(starter))
    await act(async () => {
      await result.current.start('x')
    })
    expect(starter).toHaveBeenCalledWith('x')
    expect(result.current.refusal).toEqual(refused.ok ? null : refused.error)
    expect(result.current.jobId).toBeNull()
    expect(result.current.job).toBeUndefined()
    expect(result.current.starting).toBe(false)

    await act(async () => {
      await result.current.start('x')
    })
    expect(result.current.refusal).toBeNull()
    expect(result.current.jobId).toBe('job-1')
    expect(result.current.job).toBe(job)
  })
})
