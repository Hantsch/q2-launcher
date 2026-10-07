import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/types'
import { makeJobRunner } from '../../test-support/job-runner'
import type { RunJobSpec } from './job-runner'
import { StateStore } from './state'

const INSTALLATION = 'inst-1'

const SPEC: RunJobSpec = {
  moduleId: 'downloads',
  kind: 'test-write',
  labelKey: 'jobs.simulatedWrite',
  installationId: INSTALLATION,
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function jobById(jobs: { list(): Job[] }, id: string): Job | undefined {
  return jobs.list().find((job) => job.id === id)
}

function started<T>(outcome: { ok: true; value: T } | { ok: false }): T {
  if (!outcome.ok) throw new Error('expected the job to start')
  return outcome.value
}

describe('JobRunner', () => {
  it('a succeeding body finishes the job once as succeeded', async () => {
    const { runner, jobs } = makeJobRunner()
    const finish = vi.spyOn(jobs, 'finish')

    const { jobId, settled } = started(
      runner.run(SPEC, async (ctx) => {
        ctx.report({ ratio: 0.5 })
        return { status: 'succeeded' }
      }),
    )

    await expect(settled).resolves.toEqual({ status: 'succeeded' })
    expect(jobById(jobs, jobId)?.status).toBe('succeeded')
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('a throwing body finishes as local failure', async () => {
    const { runner, jobs } = makeJobRunner()

    const { jobId, settled } = started(
      runner.run(SPEC, async () => {
        throw new Error('boom')
      }),
    )

    await expect(settled).resolves.toEqual({ status: 'failed', key: 'downloads.error.diskWrite' })
    const job = jobById(jobs, jobId)
    expect(job?.status).toBe('failed')
    expect(job?.error).toEqual({ key: 'downloads.error.diskWrite' })
  })

  it('a failing body carries its key and params onto the job', async () => {
    const { runner, jobs } = makeJobRunner()

    const { jobId, settled } = started(
      runner.run<'mods.remove.failed.locked'>(SPEC, async (ctx) =>
        ctx.fail('mods.remove.failed.locked', 'a file is open', { path: 'baseq2/pak9.pak' }),
      ),
    )

    await expect(settled).resolves.toEqual({
      status: 'failed',
      key: 'mods.remove.failed.locked',
      params: { path: 'baseq2/pak9.pak' },
    })
    expect(jobById(jobs, jobId)?.error).toEqual({
      key: 'mods.remove.failed.locked',
      params: { path: 'baseq2/pak9.pak' },
    })
  })

  it('cancel before write never calls fn and settles cancelled', async () => {
    const { runner, jobs, installations, launch } = makeJobRunner()
    launch.startGame(INSTALLATION)
    const fn = vi.fn(async () => {})

    const { jobId, settled } = started(
      runner.run(SPEC, async (ctx) => {
        if ((await ctx.write(INSTALLATION, fn)) === 'cancelled') return ctx.cancelled()
        return { status: 'succeeded' }
      }),
    )
    expect(jobById(jobs, jobId)?.status).toBe('waiting')

    expect(jobs.cancel(jobId).ok).toBe(true)

    await expect(settled).resolves.toEqual({ status: 'cancelled' })
    expect(fn).not.toHaveBeenCalled()
    expect(jobById(jobs, jobId)?.status).toBe('cancelled')
    expect(installations.validate).not.toHaveBeenCalled()

    // The deferred write is gone for good: the game exiting later does not run it.
    launch.exitGame()
    await Promise.resolve()
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel during write settles cancelled and does not overwrite the cancelled status', async () => {
    const { runner, jobs, installations } = makeJobRunner()
    const writing = deferred()
    let fnStarted = false

    const { jobId, settled } = started(
      runner.run(SPEC, async (ctx) => {
        await ctx.write(INSTALLATION, async () => {
          fnStarted = true
          await writing.promise
        })
        // Ignores the write's answer: the runner, not the body, keeps the user's cancel.
        return { status: 'succeeded' }
      }),
    )
    expect(fnStarted).toBe(true)

    expect(jobs.cancel(jobId).ok).toBe(true)
    writing.resolve()

    await expect(settled).resolves.toEqual({ status: 'cancelled' })
    expect(jobById(jobs, jobId)?.status).toBe('cancelled')
    // The write was entered, so the installation is re-inspected even though the job was cancelled.
    expect(installations.validate).toHaveBeenCalledTimes(1)
    expect(installations.validate).toHaveBeenCalledWith(INSTALLATION)
  })

  it('a write that observes the cancel answers cancelled', async () => {
    const { runner, jobs } = makeJobRunner()
    const writing = deferred()
    let answer: string | undefined

    const { jobId, settled } = started(
      runner.run(SPEC, async (ctx) => {
        answer = await ctx.write(INSTALLATION, async () => {
          await writing.promise
          if (ctx.signal.aborted) return
        })
        return answer === 'cancelled' ? ctx.cancelled() : { status: 'succeeded' }
      }),
    )
    jobs.cancel(jobId)
    writing.resolve()

    await expect(settled).resolves.toEqual({ status: 'cancelled' })
    expect(answer).toBe('cancelled')
  })

  it('a failing write still revalidates', async () => {
    const { runner, jobs, installations } = makeJobRunner()

    const { jobId, settled } = started(
      runner.run(SPEC, async (ctx) => {
        await ctx.write(INSTALLATION, async () => {
          throw new Error('disk full')
        })
        return { status: 'succeeded' }
      }),
    )

    await expect(settled).resolves.toEqual({ status: 'failed', key: 'downloads.error.diskWrite' })
    expect(jobById(jobs, jobId)?.status).toBe('failed')
    expect(installations.validate).toHaveBeenCalledTimes(1)
    expect(installations.validate).toHaveBeenCalledWith(INSTALLATION)
  })

  it('a revalidation that throws after the job is logged and leaves the outcome alone', async () => {
    const { runner, jobs } = makeJobRunner({
      validate: async () => {
        throw new Error('inspector crashed')
      },
    })

    const { jobId, settled } = started(
      runner.run(SPEC, async (ctx) => {
        await ctx.write(INSTALLATION, async () => {})
        return { status: 'succeeded' }
      }),
    )

    await expect(settled).resolves.toEqual({ status: 'succeeded' })
    expect(jobById(jobs, jobId)?.status).toBe('succeeded')
  })

  it("an exclusive job is refused while any module's job targets the installation", async () => {
    const { runner, jobs } = makeJobRunner()
    const other = jobs.create({
      moduleId: 'mods',
      kind: 'mods-remove',
      labelKey: 'mods.job.remove',
      installationId: INSTALLATION,
    })
    const exclusive: RunJobSpec = {
      ...SPEC,
      exclusive: 'installation',
      installationId: INSTALLATION,
    }
    const body = vi.fn(async () => ({ status: 'succeeded' as const }))

    const refused = runner.run(exclusive, body)
    expect(refused).toEqual({ ok: false, error: { key: 'jobs.error.installationBusy' } })
    expect(body).not.toHaveBeenCalled()
    expect(jobs.list().map((job) => job.id)).toEqual([other.id])
    expect(runner.isInstallationBusy(INSTALLATION)).toBe(true)

    jobs.finish(other.id, { status: 'succeeded' })
    const first = started(runner.run(exclusive, async () => new Promise(() => {})))
    // Started in the same turn as the first: its job already counts, so it is refused too.
    expect(runner.run(exclusive, body).ok).toBe(false)
    expect(
      jobs
        .list()
        .filter((job) => job.status === 'queued')
        .map((job) => job.id),
    ).toEqual([first.jobId])
  })

  it('a cancelled job still blocks its installation until its body has finished', async () => {
    const { runner, jobs } = makeJobRunner()
    const exclusive: RunJobSpec = {
      ...SPEC,
      exclusive: 'installation',
      installationId: INSTALLATION,
    }
    const hold = deferred()
    const first = started(
      runner.run(exclusive, async () => {
        await hold.promise
        return { status: 'succeeded' as const }
      }),
    )

    jobs.cancel(first.jobId)
    expect(jobById(jobs, first.jobId)?.status).toBe('cancelled')
    expect(runner.isInstallationBusy(INSTALLATION)).toBe(true)
    expect(runner.run(exclusive, async () => ({ status: 'succeeded' as const }))).toEqual({
      ok: false,
      error: { key: 'jobs.error.installationBusy' },
    })

    hold.resolve()
    await first.settled
    expect(runner.isInstallationBusy(INSTALLATION)).toBe(false)
    expect(runner.run(exclusive, async () => ({ status: 'succeeded' as const })).ok).toBe(true)
  })

  it('a body that revalidated after its write is not revalidated again', async () => {
    const { runner, installations } = makeJobRunner()

    const { settled } = started(
      runner.run(SPEC, async (ctx) => {
        await ctx.write(INSTALLATION, async () => {})
        const revalidated = await ctx.revalidate(INSTALLATION)
        return revalidated.ok ? { status: 'succeeded' } : ctx.fail('x', 'revalidation failed')
      }),
    )

    await expect(settled).resolves.toEqual({ status: 'succeeded' })
    expect(installations.validate).toHaveBeenCalledTimes(1)
  })

  it('cancel kills the registered extractor, and one registered after the cancel at once', async () => {
    const { runner, jobs } = makeJobRunner()
    const before = { kill: vi.fn() }
    const after = { kill: vi.fn() }
    const gate = deferred()

    const { jobId, settled } = started(
      runner.run(SPEC, async (ctx) => {
        ctx.setExtractor(before)
        await gate.promise
        ctx.setExtractor(after)
        return ctx.cancelled()
      }),
    )
    jobs.cancel(jobId)
    expect(before.kill).toHaveBeenCalledTimes(1)
    gate.resolve()

    await settled
    expect(after.kill).toHaveBeenCalledTimes(1)
  })
})

describe('module jobs', () => {
  const modulesDir = join(__dirname, '..', 'modules')

  function jobSources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return jobSources(path)
      const isJobSource =
        entry.name.includes('job') &&
        entry.name.endsWith('.ts') &&
        !/\.test(-helpers)?\.ts$/.test(entry.name)
      return isJobSource ? [path] : []
    })
  }

  it('a job that wrote waits for state to settle before it shows as finished', async () => {
    const settling = deferred()
    const settle = vi.fn(async () => {
      await settling.promise
      return { ok: true }
    })
    const { runner, jobs } = makeJobRunner({ state: { settle } })

    const { jobId, settled } = started(
      runner.run(SPEC, async (ctx) => {
        await ctx.write(INSTALLATION, async () => {})
        return { status: 'succeeded' }
      }),
    )
    await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(1))
    expect(jobById(jobs, jobId)?.status).toBe('running')

    settling.resolve()
    await settled
    expect(jobById(jobs, jobId)?.status).toBe('succeeded')
  })

  it("a job's state write is on disk when the job turns terminal", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'q2-job-state-'))
    try {
      const file = join(dir, 'state.json')
      const store = new StateStore(file, { migrations: 'none' })
      await store.load()
      const marker = store.section<{ marker: string }>({
        key: 'jobMarker',
        parse: () => ({ marker: 'none' }),
        defaults: () => ({ marker: 'none' }),
      })
      const { runner, jobs } = makeJobRunner({ state: store })
      let onDiskAtTerminal: string | undefined
      jobs.onChange((list) => {
        if (onDiskAtTerminal !== undefined) return
        if (list.some((job) => job.status === 'succeeded')) {
          onDiskAtTerminal = existsSync(file) ? readFileSync(file, 'utf8') : ''
        }
      })

      const { settled } = started(
        runner.run(SPEC, async (ctx) => {
          await ctx.write(INSTALLATION, async () => {
            marker.update(() => ({ marker: 'written-by-job' }))
          })
          return { status: 'succeeded' }
        }),
      )
      await settled

      expect(onDiskAtTerminal).toContain('written-by-job')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('a job that never wrote does not wait for state', async () => {
    const settle = vi.fn(async () => ({ ok: true }))
    const { runner, jobs } = makeJobRunner({ state: { settle } })

    const { jobId, settled } = started(runner.run(SPEC, async () => ({ status: 'succeeded' })))
    await settled

    expect(settle).not.toHaveBeenCalled()
    expect(jobById(jobs, jobId)?.status).toBe('succeeded')
  })

  it('a cancelled job that wrote does not wait for state', async () => {
    const settle = vi.fn(async () => ({ ok: true }))
    const { runner, jobs } = makeJobRunner({ state: { settle } })
    const writing = deferred()

    const { jobId, settled } = started(
      runner.run(SPEC, async (ctx) => {
        await ctx.write(INSTALLATION, async () => {
          await writing.promise
        })
        return { status: 'succeeded' }
      }),
    )
    await vi.waitFor(() => expect(jobById(jobs, jobId)?.status).toBe('running'))
    expect(jobs.cancel(jobId).ok).toBe(true)
    writing.resolve()

    await expect(settled).resolves.toEqual({ status: 'cancelled' })
    expect(settle).not.toHaveBeenCalled()
  })

  it('no module job builds its own lifecycle', () => {
    const files = jobSources(modulesDir)
    expect(files.length).toBeGreaterThan(0)

    const forbidden = [
      'new AbortController',
      'LOCAL_FAILURE =',
      'jobs.finish(',
      'inFlight',
      'BUSY_KINDS',
    ]
    const offences = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return forbidden
        .filter((needle) => source.includes(needle))
        .map((needle) => `${file}: ${needle}`)
    })
    expect(offences).toEqual([])
  })

  it('every job that runs through the runner is exclusive on its installation', () => {
    // Real call sites carry type arguments: `deps.runner.run<...>(`.
    const runnerCall = /\brunner\.run\s*(<[^(]*>)?\s*\(/
    const callSites = jobSources(modulesDir).filter((file) =>
      runnerCall.test(readFileSync(file, 'utf8')),
    )
    // Non-empty guard: a regex that matches nothing must not pass vacuously.
    expect(callSites.length).toBeGreaterThanOrEqual(8)
    const missing = callSites.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      // bootstrap's exclusivity is conditional on adopting a record, but still spelled out.
      const needle = "exclusive: 'installation'"
      return source.includes(needle) ? [] : [file]
    })
    expect(missing).toEqual([])
  })
})

describe('docs', () => {
  const docs = join(__dirname, '..', '..', '..', 'docs')

  it('the architecture doc describes the runner', () => {
    const architecture = readFileSync(join(docs, 'ARCHITECTURE.md'), 'utf8')
    expect(architecture).not.toContain('No module produces jobs yet')
    expect(architecture).toContain('JobRunner.run')
    expect(architecture).toContain('installationBusy')

    const roadmap = readFileSync(join(docs, 'ROADMAP.md'), 'utf8')
    expect(roadmap).not.toContain('A mid-copy `PACKAGE_INCOMPLETE` failure can leave')
    expect(roadmap).not.toContain('renders that placeholder unfilled')
  })
})
