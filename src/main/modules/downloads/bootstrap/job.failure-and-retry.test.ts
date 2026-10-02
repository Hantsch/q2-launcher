import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fail } from '@shared/types'
import { inspectInstallation } from '../../../services/inspector'
import { startBootstrap } from './job'
import {
  DEMO_PACKAGE,
  FIXTURE_CONTENTS,
  type Deferred,
  deferred,
  useBootstrapTempDirs,
  type Harness,
  harness,
  breakTargetBeforeValidate,
  exists,
  dir,
  userDataPath,
  targetPath,
} from './job.test-helpers'

useBootstrapTempDirs()

/**
 * Story 077 D2. The one destructive path in this file now behaves differently for its two callers,
 * and both halves of that difference are silent when wrong - a cancel that spares a registration is
 * a library full of ghosts, a failure that deletes one is the 2026-09-08 bug this story exists for.
 * So the two are asserted against each other, from the same seams the rest of this suite uses.
 */
describe('startBootstrap failure and cancel', () => {
  const WIZARD_NAME = 'My Quake II'

  /**
   * Every exit that reaches `failed()`, each through a seam this suite already had. The list is the
   * story's own ("`packageUnavailable`/`allMirrorsFailed`, verification, extraction, disk write,
   * `installationNotPlayable`") minus `packageUnavailable`, which fails in `startBootstrap` itself
   * before any installation is registered - there is nothing there for a failure to keep, and the
   * existing "fails before creating anything when a required package is missing" test still owns it.
   */
  const FAILING_EXITS: Array<{ what: string; key: string; make: (root: string) => Harness }> = [
    {
      what: 'the download (transport, all mirrors exhausted)',
      key: 'downloads.error.network',
      make: () => harness({ failFetchFor: 'q2-314-demo-x86.exe' }),
    },
    {
      what: 'the extraction',
      key: 'downloads.error.extractionFailed',
      make: () => harness({ failExtractFor: DEMO_PACKAGE.id }),
    },
    {
      what: 'a package that contributed no required file',
      key: 'downloads.error.packageIncomplete',
      make: () => harness({ contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: [] } }),
    },
    {
      what: 'a local operation (the disk-write catch-all)',
      key: 'downloads.error.diskWrite',
      make: () => {
        const box = harness()
        // The job's own `LOCAL_FAILURE` exit, reached the one way this suite can reach it without
        // a real disk error: the first revalidation answers a failed `Outcome`. The *second* one -
        // the failure path's own, after cleanup - falls through to the real implementation, which
        // is what re-derives the surviving installation's status.
        vi.spyOn(box.installations, 'validate').mockImplementationOnce(async () =>
          fail('installations.error.notFound'),
        )
        return box
      },
    },
    {
      what: 'the inspector verdict',
      key: 'downloads.error.installationNotPlayable',
      make: (root) => {
        const box = harness()
        breakTargetBeforeValidate(box, root)
        return box
      },
    },
  ]

  const startFailing = async (
    box: Harness,
    root: string,
  ): Promise<{ jobId: string; installationId: string; key: string }> => {
    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath: root,
      name: WIZARD_NAME,
      includeVideoAndPlayers: false,
    })
    if (!started.ok) throw new Error(`bootstrap refused to start: ${started.error.key}`)
    const outcome = await started.value.settled
    if (outcome.status !== 'failed') throw new Error(`expected a failed run, got ${outcome.status}`)
    return {
      jobId: started.value.jobId,
      installationId: started.value.installationId,
      key: outcome.key,
    }
  }

  it("AC1: a failed run leaves the installation registered with the wizard's name, root path and engine", async () => {
    // Each exit gets its own target folder (and its own harness, so its own library), because the
    // point is that *every* one of them keeps what the user chose - not just the one a single
    // representative test happens to take.
    for (const [index, exit] of FAILING_EXITS.entries()) {
      const root = join(dir, `target-${index}`)
      const box = exit.make(root)

      const { installationId, key } = await startFailing(box, root)

      expect(`${exit.what}: ${key}`).toBe(`${exit.what}: ${exit.key}`)
      const list = box.installations.list()
      expect(list).toHaveLength(1)
      expect(list[0]?.id).toBe(installationId)
      expect(list[0]?.name).toBe(WIZARD_NAME)
      expect(list[0]?.rootPath).toBe(await realpath(root))
      // `applyInspection` re-derives `engineKind` on every `validate()` for anything but a `custom`
      // kind ([installations.ts:433](../../../../services/installations.ts)), and an emptied folder
      // classifies as `unknown` - but it keeps a previously-known engine kind rather than clobbering
      // it with `unknown`, so the wizard's choice survives the failure path.
      expect(list[0]?.engineKind).toBe('q2pro')
      // The folder the user picked is still there for the retry to point at - empty, not half-built.
      expect(await exists(root)).toBe(true)
      vi.restoreAllMocks()
    }
  })

  it('AC2: a cancelled run still removes the installation and its files', async () => {
    // The regression guard on the half of the split that did *not* change: cancel is still the
    // user's explicit "never mind", and still takes both the entry and the job-created folder.
    const reachedSecond = deferred()
    const held = deferred()
    const box = harness({
      onFetch: async (source) => {
        if (source.fileName !== 'q2-314-demo-x86.exe') return
        reachedSecond.resolve()
        await held.promise
      },
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: WIZARD_NAME,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await reachedSecond.promise
    expect(box.jobs.cancel(started.value.jobId).ok).toBe(true)
    held.resolve()

    expect((await started.value.settled).status).toBe('cancelled')
    expect(box.installations.list()).toEqual([])
    expect(await exists(targetPath)).toBe(false)
    expect(
      await exists(join(userDataPath, 'cache', 'downloads', 'extract', started.value.jobId)),
    ).toBe(false)
  })

  it('AC2: a failed run removes the files but not the registration', async () => {
    // The other half, from an exit that has genuinely copied files into the target first: the
    // engine binary and `baseq2/gamex86_64.dll` are on disk when the verdict fails the run.
    const box = harness()
    breakTargetBeforeValidate(box)

    const { installationId, jobId } = await startFailing(box, targetPath)

    // Assembled files gone, and the directories the job made with them - but the root the user
    // picked survives, so the surviving installation points at something that exists.
    expect(await exists(targetPath)).toBe(true)
    expect(await readdir(targetPath)).toEqual([])
    // The extract cache is gone too; the verified archives stay for a cheap retry.
    expect(await exists(join(userDataPath, 'cache', 'downloads', 'extract', jobId))).toBe(false)
    expect(await readdir(join(userDataPath, 'cache', 'downloads'))).toContain('q2-314-demo-x86.exe')
    expect(box.installations.list().map((entry) => entry.id)).toEqual([installationId])
  })

  it('AC3: the surviving installation carries the error key, the timestamp and the job id', async () => {
    const box = harness({ failFetchFor: 'q2-314-demo-x86.exe' })
    const before = Date.now()

    const { installationId, jobId, key } = await startFailing(box, targetPath)

    const failure = box.installations.find(installationId)?.lastFailure
    // The same key the job ended with - one failure, one key, in both places it is written.
    expect(failure?.errorKey).toBe(key)
    expect(failure?.errorKey).toBe('downloads.error.network')
    expect(failure?.jobId).toBe(jobId)
    expect(failure?.at).toBeGreaterThanOrEqual(before)
    expect(failure?.at).toBeLessThanOrEqual(Date.now())
    // The Downloads tab's own failure log is untouched by this: `Job.error` still carries the key.
    expect(box.jobs.list().find((job) => job.id === jobId)?.error).toEqual({
      key: 'downloads.error.network',
    })
    // A key whose sentence needs no interpolation records none - the record stays exactly the three
    // fields story 077 D1 defined.
    expect(failure?.params).toBeUndefined()
  })

  it('AC3 (finding fix): a templated error key records the params its sentence interpolates', async () => {
    // `downloads.error.packageIncomplete`'s `en.json` sentence reads `{{packageId}}`. Without the
    // params on the record, the library card renders that placeholder literally - so the record has
    // to carry the *same* values this exit already hands the Downloads tab's failure log.
    const box = harness({ contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: [] } })

    const { installationId, jobId, key } = await startFailing(box, targetPath)

    expect(key).toBe('downloads.error.packageIncomplete')
    const failure = box.installations.find(installationId)?.lastFailure
    expect(failure?.errorKey).toBe('downloads.error.packageIncomplete')
    expect(failure?.params).toEqual({ packageId: DEMO_PACKAGE.id })
    // One failure, one key *and* one set of params, in both places it is written: the library card
    // and the Downloads tab cannot render a differently-worded sentence.
    const jobError = box.jobs.list().find((job) => job.id === jobId)?.error
    expect(jobError).toEqual({
      key: 'downloads.error.packageIncomplete',
      params: { packageId: DEMO_PACKAGE.id },
    })
    expect(failure?.params).toEqual(jobError?.params)
  })

  it("AC6: the surviving installation's status comes from inspectInstallation and is not playable", async () => {
    const box = harness()
    breakTargetBeforeValidate(box)

    const { installationId } = await startFailing(box, targetPath)

    const installation = box.installations.find(installationId)
    expect(installation).toBeDefined()
    // Re-derived here, independently, from the folder as the failure left it - so the stored status
    // cannot have been hand-set anywhere in the job.
    const inspected = await inspectInstallation(installation?.rootPath ?? targetPath)
    expect(installation?.status).toBe(inspected.status)
    expect(['invalid', 'missing']).toContain(installation?.status)
    // AC4's negative: a verdict that is not playable keeps the record rather than clearing it.
    expect(installation?.lastFailure?.errorKey).toBe('downloads.error.installationNotPlayable')
  })
})

/**
 * Story 077 D3. Adoption is the one place this job is allowed past `create()`'s duplicate guard, so
 * what these tests are really about is the *predicate*: the same folder and a `lastFailure`, both
 * required. A too-wide match would be invisible here unless the negative is a genuine minimal pair -
 * hence "a duplicate without a lastFailure" below reuses the very installation the adoption test
 * adopts and changes nothing but that one field.
 */
describe('startBootstrap retry adoption', () => {
  const WIZARD_NAME = 'My Quake II'
  const RETRY_NAME = 'My Quake II (second try)'

  /**
   * A first run that fails at the inspector verdict, leaving exactly what a retry has to deal with:
   * one registered installation at `targetPath`, carrying a `lastFailure`, pointing at an emptied
   * folder. The `validate` spy stays in place afterwards - a caller that wants the retry to succeed
   * restores it, and the one that wants a second failure simply does not.
   */
  const runFailingFirstPass = async (
    box: Harness,
  ): Promise<{ installationId: string; jobId: string }> => {
    breakTargetBeforeValidate(box)
    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: WIZARD_NAME,
      includeVideoAndPlayers: false,
    })
    if (!started.ok) throw new Error(`the first run refused to start: ${started.error.key}`)
    const outcome = await started.value.settled
    if (outcome.status !== 'failed')
      throw new Error(`expected a failed first run: ${outcome.status}`)
    return { installationId: started.value.installationId, jobId: started.value.jobId }
  }

  it("AC7: a retry on a failed installation's folder adopts it instead of failing with installations.error.duplicate", async () => {
    const box = harness()
    const first = await runFailingFirstPass(box)
    expect(box.installations.find(first.installationId)?.lastFailure).toBeDefined()
    vi.restoreAllMocks()

    // `create()` is what would answer `installations.error.duplicate` here; adoption must not reach
    // it at all, rather than reach it and recover from its refusal.
    const createSpy = vi.spyOn(box.installations, 'create')
    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })
    if (!retry.ok) throw new Error(`the retry was refused with ${retry.error.key}`)

    expect(createSpy).not.toHaveBeenCalled()
    // The same installation, from the very first moment - not a second one, and not a new id.
    expect(retry.value.installationId).toBe(first.installationId)
    expect((await retry.value.settled).status).toBe('succeeded')

    const list = box.installations.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(first.installationId)
    expect(list[0]?.rootPath).toBe(await realpath(targetPath))
    // The wizard's new name went in; the engine kind and the id the library already showed did not
    // change (Decisions (Refine): "Adoption updates the name from the wizard, not the engine").
    expect(list[0]?.name).toBe(RETRY_NAME)
    expect(list[0]?.engineKind).toBe('q2pro')
    expect(list[0]?.lastFailure).toBeUndefined()
  })

  it('AC7: a duplicate without a lastFailure is still refused', async () => {
    const box = harness()
    const first = await runFailingFirstPass(box)
    vi.restoreAllMocks()
    // The minimal pair against the test above: same folder, same registration, same everything -
    // only the one field the adoption predicate reads is gone, which is what an ordinary duplicate
    // (a working or in-progress installation the user owns) looks like from here.
    expect(box.installations.setLastFailure(first.installationId, null).ok).toBe(true)

    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })

    expect(retry.ok).toBe(false)
    if (retry.ok) return
    expect(retry.error.key).toBe('installations.error.duplicate')
    // Nothing was started and nothing was taken over: the first run's job is the only one, and the
    // installation still carries the name its owner gave it.
    expect(box.jobs.list()).toHaveLength(1)
    const list = box.installations.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(first.installationId)
    expect(list[0]?.name).toBe(WIZARD_NAME)
  })

  it('AC4: an adopted retry clears the previous failure when it starts', async () => {
    // The retry parks inside its first download, so what is asserted below is the state *while the
    // job is running* - "cleared when it starts", not "cleared because it succeeded".
    let holdRetry: Deferred | undefined
    const box = harness({
      onFetch: async () => {
        if (holdRetry) await holdRetry.promise
      },
    })

    const first = await runFailingFirstPass(box)
    expect(box.installations.find(first.installationId)?.lastFailure?.jobId).toBe(first.jobId)
    vi.restoreAllMocks()

    holdRetry = deferred()
    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })
    if (!retry.ok) throw new Error(`the retry was refused with ${retry.error.key}`)

    expect(box.jobs.list().find((job) => job.id === retry.value.jobId)?.status).toBe('running')
    expect(box.installations.find(first.installationId)?.lastFailure).toBeUndefined()

    holdRetry.resolve()
    expect((await retry.value.settled).status).toBe('succeeded')
    expect(box.installations.find(first.installationId)?.lastFailure).toBeUndefined()
  })

  it('AC3: an adopted retry that fails again records a new failure on the same installation', async () => {
    // The `validate` spy from the first pass is deliberately left in place, so the adopted run takes
    // the same failure exit - D2's `failed()` now operating on an id it did not create.
    const box = harness()
    const first = await runFailingFirstPass(box)

    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })
    if (!retry.ok) throw new Error(`the retry was refused with ${retry.error.key}`)
    expect(retry.value.installationId).toBe(first.installationId)
    expect((await retry.value.settled).status).toBe('failed')

    const failure = box.installations.find(first.installationId)?.lastFailure
    expect(failure?.errorKey).toBe('downloads.error.installationNotPlayable')
    // A *new* record, naming the retry's own job - not the one the first run left behind.
    expect(failure?.jobId).toBe(retry.value.jobId)
    expect(failure?.jobId).not.toBe(first.jobId)
    expect(box.installations.list()).toHaveLength(1)
  })

  it('finding fix: cancelling an adopted retry keeps the installation registered', async () => {
    // The gap this test guards: install fails (survives, per this story) -> retry adopts it ->
    // user cancels the retry. Cancel is "never mind about the run I just started", not "delete an
    // installation that already existed before I clicked retry" - so unlike a cancelled fresh
    // create, the registration must survive here.
    let holdRetry: Deferred | undefined
    const box = harness({
      onFetch: async () => {
        if (holdRetry) await holdRetry.promise
      },
    })

    const first = await runFailingFirstPass(box)
    const firstFailure = box.installations.find(first.installationId)?.lastFailure
    // Guards the assertion below from passing vacuously (undefined === undefined) if the first pass
    // ever stopped recording a failure.
    expect(firstFailure).toBeDefined()
    vi.restoreAllMocks()

    holdRetry = deferred()
    const retry = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: RETRY_NAME,
      includeVideoAndPlayers: false,
    })
    if (!retry.ok) throw new Error(`the retry was refused with ${retry.error.key}`)
    expect(retry.value.installationId).toBe(first.installationId)
    // Adoption cleared it the moment the retry started (D3, AC4) - the baseline this test cancels
    // away from.
    expect(box.installations.find(first.installationId)?.lastFailure).toBeUndefined()

    expect(box.jobs.cancel(retry.value.jobId).ok).toBe(true)
    holdRetry.resolve()

    expect((await retry.value.settled).status).toBe('cancelled')

    // Still registered - the whole point of the fix - and still the same installation.
    const list = box.installations.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(first.installationId)
    // Files/root cleaned exactly like an ordinary cancel: the target pre-existed (it is the
    // surviving folder from the first failed run), so `removeRoot` stays false and only the
    // (here: none yet copied) files go, matching `removeAssembled`'s cancel behaviour elsewhere.
    expect(await exists(targetPath)).toBe(true)
    expect(await readdir(targetPath)).toEqual([])
    // Finding fix (F2): a cancel is the user's "never mind" about *this run*, not a verdict that the
    // installation is now failure-free - so the failure D3 cleared when the retry started is put
    // back, restoring exactly the state the installation was in before the user clicked retry (same
    // badge, same sentence). Leaving it cleared instead would pass the adoption predicate's
    // `lastFailure` check and dead-end every later retry on this folder at
    // `installations.error.duplicate` - the empty-library problem again, one door along.
    expect(list[0]?.lastFailure).toEqual(firstFailure)
  })

  it('finding fix: cancelling an ordinary (non-adopted) run is unchanged - still fully unregistered', async () => {
    // The regression guard: this fix must not widen past the adopted case. Mirrors the existing
    // "AC2: a cancelled run still removes the installation and its files" test in the D2 suite
    // above, kept here too so the D3 (adoption) and finding-fix tests sit side by side.
    const reachedSecond = deferred()
    const held = deferred()
    const box = harness({
      onFetch: async (source) => {
        if (source.fileName !== 'q2-314-demo-x86.exe') return
        reachedSecond.resolve()
        await held.promise
      },
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      name: WIZARD_NAME,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await reachedSecond.promise
    expect(box.jobs.cancel(started.value.jobId).ok).toBe(true)
    held.resolve()

    expect((await started.value.settled).status).toBe('cancelled')
    // Unregistered, and the job-created root removed entirely - byte-for-byte the pre-fix behaviour.
    expect(box.installations.list()).toEqual([])
    expect(await exists(targetPath)).toBe(false)
  })
})
