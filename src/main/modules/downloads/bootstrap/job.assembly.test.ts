import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { stubPlatform } from '../../../../test-support/platform'
import { IDLE_LAUNCH_STATE, type Job } from '@shared/types'
import { inspectInstallation } from '../../../services/inspector'
import { fakeManifest } from '../test-support'
import { buildBootstrapSummary, PLAYABLE_AT_RATIO, startBootstrap } from './job'
import {
  ENGINE_PACKAGE,
  DEMO_PACKAGE,
  R1Q2_ENGINE_PACKAGE,
  POINT_RELEASE_PACKAGE,
  DEFAULT_PACKAGES,
  FIXTURE_CONTENTS,
  waitFor,
  deferred,
  useBootstrapTempDirs,
  harness,
  recordFor,
  breakTargetBeforeValidate,
  breakTargetOnSecondValidate,
  exists,
  makeStoreInstallation,
  detectedSource,
  dir,
  userDataPath,
  targetPath,
} from './job.test-helpers'

useBootstrapTempDirs()

describe('startBootstrap', () => {
  it('fetches, extracts and assembles baseq2, and the job succeeds', async () => {
    const box = harness()

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome.status).toBe('succeeded')
    // All three packages, in the documented order: engine, demo, point release.
    expect(box.fetched).toEqual([
      'q2pro-1.0.0.zip',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
    // The allowlisted files landed where an installation expects them.
    expect(await exists(join(targetPath, 'q2pro.exe'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'pak0.pak'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'pak2.pak'))).toBe(true)
    // AC8's negative: the 3.20 archive's `ctf/` payload is not part of the allowlist.
    expect(await readdir(targetPath)).not.toContain('ctf')
    // No extras were asked for, so none were copied.
    expect(await exists(join(targetPath, 'baseq2', 'video'))).toBe(false)
    expect(await exists(join(targetPath, 'players'))).toBe(false)

    const job = box.jobs.list().find((entry) => entry.id === started.value.jobId)
    expect(job?.status).toBe('succeeded')
    expect(job?.installationId).toBe(started.value.installationId)
    // The extracted trees are gone; the verified archives stay in the cache for a cheap retry.
    expect(
      await exists(join(userDataPath, 'cache', 'downloads', 'extract', started.value.jobId)),
    ).toBe(false)
    expect(await readdir(join(userDataPath, 'cache', 'downloads'))).toContain('q2-314-demo-x86.exe')
  })

  it('copies the extras only after the installation is already playable', async () => {
    const box = harness()
    // What the disk looked like at the moment the marker was recorded - the point of AC6 is that
    // the marker precedes the optional extras rather than waiting for the whole job.
    const atMark = { core: false, extras: false }
    const record = box.jobs.markPlayable.bind(box.jobs)
    vi.spyOn(box.jobs, 'markPlayable').mockImplementation((id, ratio) => {
      // `existsSync`, not the async probe: the observation has to be of the disk at exactly this
      // moment, and this method is synchronous.
      atMark.core = existsSync(join(targetPath, 'baseq2', 'pak0.pak'))
      atMark.extras = existsSync(join(targetPath, 'baseq2', 'video', 'ntro.cin'))
      record(id, ratio)
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(atMark.core).toBe(true)
    expect(atMark.extras).toBe(false)
    expect(await exists(join(targetPath, 'baseq2', 'video', 'ntro.cin'))).toBe(true)
    // Story 076 D1 (AC4): sourced from `baseq2/players/`, landing at `baseq2/players/` - not at a
    // bare `players/` in the target root, which is where 074's guessed layout put it.
    expect(await exists(join(targetPath, 'baseq2', 'players', 'male', 'tris.md2'))).toBe(true)
  })

  it('takes the installation status from inspectInstallation and records playableAtRatio once', async () => {
    const box = harness()
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    await started.value.settled

    // Recorded exactly once, at the documented ratio, even though two revalidations ran.
    expect(markPlayable).toHaveBeenCalledTimes(1)
    expect(markPlayable).toHaveBeenCalledWith(started.value.jobId, PLAYABLE_AT_RATIO)
    expect(box.jobs.list()[0]?.playableAtRatio).toBe(PLAYABLE_AT_RATIO)

    // The stored status is exactly what the inspector says about that folder, re-derived here
    // independently - so it cannot have been hand-set to a literal "ok" anywhere in the job.
    const installation = box.installations.find(started.value.installationId)
    const inspected = await inspectInstallation(targetPath)
    expect(installation?.status).toBe(inspected.status)
    expect(installation?.status).not.toBe('invalid')
    expect(installation?.engineKind).toBe('q2pro')
  })

  it('fails and cleans up when the assembled folder is still not a usable installation', async () => {
    // Every package contributes every required file, so story 076 D3's missing-required check has
    // nothing to say - and the folder is still not usable when the inspector looks at it. The
    // verdict is the only thing that can notice, which is exactly what must decide the job's fate.
    const box = harness()
    breakTargetBeforeValidate(box)
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({
      status: 'failed',
      key: 'downloads.error.installationNotPlayable',
    })
    expect(markPlayable).not.toHaveBeenCalled()
    expect(box.jobs.list()[0]?.status).toBe('failed')
    expect(box.jobs.list()[0]?.error).toEqual({ key: 'downloads.error.installationNotPlayable' })
    // Story 077 D2: the half-built files are gone (the target root is empty again), and the library
    // entry the user made in the wizard is not - see the AC1/AC2 suite below.
    expect(await readdir(targetPath)).toEqual([])
    expect(box.installations.list()).toHaveLength(1)
  })

  it('cleans up baseq2/players fully when the run fails after the extras pass (F1 regression)', async () => {
    // Story 076 review finding F1: `PRUNABLE_TARGET_DIRS` still named the pre-076 root-level
    // `players` (074 D8's guessed layout), not `baseq2/players` where 076 D1's allowlist actually
    // lands it. `removeAssembled()`'s per-file loop deletes the copied leaf files/dirs, but the now-
    // empty `baseq2/players` directory itself only gets pruned by `PRUNABLE_TARGET_DIRS` - a stale
    // entry there means that directory (and, transitively, `baseq2` and the target root, since
    // `rmdir` refuses a non-empty directory) survives a failed cleanup instead of the target
    // disappearing like every other failure path.
    const box = harness()
    const observed = breakTargetOnSecondValidate(box)

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({
      status: 'failed',
      key: 'downloads.error.installationNotPlayable',
    })
    // The regression only exists once `baseq2/players/...` was actually copied by the extras pass
    // before the late failure - otherwise this test would pass even with the stale path.
    expect(observed.auxCopiedBeforeSecondValidate).toBe(true)
    // Everything inside the target, `baseq2/players` included, must be gone - not just the files,
    // leaving an empty directory tree behind. Since story 077 D2 the target root itself survives a
    // failure, so an empty root is what the stale-path bug would still fail: `rmdir` refuses a
    // non-empty directory, so an unpruned `baseq2/players` would leave `baseq2` here.
    expect(await readdir(targetPath)).toEqual([])
  })

  it('a package that contributes no required file fails the job naming that package', async () => {
    // The 2026-09-08 failure in miniature (AC5): the demo archive downloads, verifies and extracts
    // without a hitch, and holds neither of the two paths the allowlist accepts for
    // `baseq2/pak0.pak`. The other two packages are complete, so the demo is unambiguously the one
    // that came up empty.
    const box = harness({ contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: [] } })
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.packageIncomplete' })
    // The package id, not the role, and as `params` rather than prose - so `en.json`'s sentence
    // can name the archive.
    expect(box.jobs.list()[0]?.error).toEqual({
      key: 'downloads.error.packageIncomplete',
      params: { packageId: DEMO_PACKAGE.id },
    })
    // It failed before the verdict, so the run never got as far as calling anything playable.
    expect(markPlayable).not.toHaveBeenCalled()

    // The reason names every candidate path that was looked for, and story 075's diagnostics ring
    // carries that same line into a copied failure report.
    const failureLine = box.logLines.find((line) => line.includes('packageIncomplete'))
    expect(failureLine).toContain('baseq2/pak0.pak')
    expect(failureLine).toContain('Install/Data/baseq2/pak0.pak')
    const record = recordFor(box, started.value.jobId)
    expect(record?.errorKey).toBe('downloads.error.packageIncomplete')
    expect(record?.logTail.some((line) => line.includes('Install/Data/baseq2/pak0.pak'))).toBe(true)

    // Cleanup is what every other failure path does: no half-built files, and (story 077 D2) the
    // library entry kept, carrying this exit's own key.
    expect(await readdir(targetPath)).toEqual([])
    expect(box.installations.list()[0]?.lastFailure?.errorKey).toBe(
      'downloads.error.packageIncomplete',
    )
  })

  it('a cancel mid-job leaves no files and no registered installation', async () => {
    const reachedSecond = deferred()
    const held = deferred()
    const box = harness({
      onFetch: async (source) => {
        if (source.fileName !== 'q2-314-demo-x86.exe') return
        reachedSecond.resolve()
        // Sit inside the second package's download until the test has cancelled the job.
        await held.promise
      },
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    // The installation is registered from the first moment, before anything is downloaded.
    expect(box.installations.list().map((entry) => entry.id)).toEqual([
      started.value.installationId,
    ])
    expect(await exists(join(targetPath, 'baseq2'))).toBe(true)

    await reachedSecond.promise
    expect(box.jobs.cancel(started.value.jobId).ok).toBe(true)
    held.resolve()

    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'cancelled' })
    // The third package was never requested.
    expect(box.fetched).toEqual(['q2pro-1.0.0.zip', 'q2-314-demo-x86.exe'])
    expect(await exists(targetPath)).toBe(false)
    expect(box.installations.list()).toEqual([])
    expect(box.jobs.list()[0]?.status).toBe('cancelled')
    expect(box.jobs.list()[0]?.playableAtRatio).toBeUndefined()
    // The job's extract directory went with it.
    expect(
      await exists(join(userDataPath, 'cache', 'downloads', 'extract', started.value.jobId)),
    ).toBe(false)
  })

  it('never leaves a target folder the user already had', async () => {
    // D2's verdict treats a non-empty target as a warning, not a blocker - so a cancel must undo
    // only what the job itself wrote.
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'notes.txt'), 'mine')

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
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await reachedSecond.promise
    box.jobs.cancel(started.value.jobId)
    held.resolve()
    expect((await started.value.settled).status).toBe('cancelled')

    // The user's own file survived, and the empty skeleton the job created did not.
    expect(await readdir(targetPath)).toEqual(['notes.txt'])
  })

  it('fails before creating anything when a required package is missing', async () => {
    const box = harness({ manifest: fakeManifest([ENGINE_PACKAGE, DEMO_PACKAGE]) })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })

    expect(started.ok).toBe(false)
    if (!started.ok) expect(started.error.key).toBe('downloads.error.packageUnavailable')
    // No job, no library entry, no folder: nothing existed yet to clean up.
    expect(box.jobs.list()).toEqual([])
    expect(box.installations.list()).toEqual([])
    expect(await exists(targetPath)).toBe(false)
  })

  it('persists a picked write-dir remedy path onto the created installation (AC2)', async () => {
    const box = harness()
    const remedyDir = join(dir, 'remedy-write-dir')
    await mkdir(remedyDir, { recursive: true })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
      writeDirPath: remedyDir,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    const installation = box.installations.find(started.value.installationId)
    expect(installation?.writeDirPath).toBe(await realpath(remedyDir))
  })

  it('assigns the default shipped icon to a freshly bootstrapped installation', async () => {
    const box = harness()

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    const installation = box.installations.find(started.value.installationId)
    expect(installation?.icon).toEqual({ kind: 'shipped', id: 'q2pro-logo' })
  })

  it('never removes a pre-existing empty target folder on cancel', async () => {
    // Distinct from "never leaves a target folder the user already had" above: that folder was
    // non-empty and its own file survived. This one is empty, so the old (pre-fix) code path would
    // have happily `rmdir`ed it - the fix is to know the difference between "the job created this
    // directory" and "the user already had it, just empty".
    await mkdir(targetPath, { recursive: true })

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
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    await reachedSecond.promise
    box.jobs.cancel(started.value.jobId)
    held.resolve()
    expect((await started.value.settled).status).toBe('cancelled')

    // The pre-existing (now empty again) directory itself survives, unlike the job-created case.
    expect(await exists(targetPath)).toBe(true)
    expect(await readdir(targetPath)).toEqual([])
  })

  it('refuses a target the verdict blocks, whatever the renderer sent', async () => {
    // A folder the inspector already recognises as a Quake II installation - `blocked`, so the
    // job may not start even though the wizard's own target step should have caught it.
    await mkdir(join(targetPath, 'baseq2'), { recursive: true })
    await writeFile(join(targetPath, 'baseq2', 'pak0.pak'), 'paks')
    await writeFile(join(targetPath, 'q2pro.exe'), 'engine')
    const box = harness()

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })

    expect(started.ok).toBe(false)
    if (!started.ok) {
      expect(started.error.key).toBe('downloads.error.bootstrapTargetBlocked')
      expect(started.error.params).toEqual({ reason: 'alreadyInstalled' })
    }
    expect(box.jobs.list()).toEqual([])
    expect(box.installations.list()).toEqual([])
    // Untouched.
    expect((await readdir(targetPath)).sort()).toEqual(['baseq2', 'q2pro.exe'])
  })

  /**
   * Story 080 D2 (AC1/AC3/AC5/AC7): starting a bootstrap with `engine: 'r1q2'` resolves R1Q2's own
   * pinned package (not Q2PRO's), and assembles only R1Q2's three required files - never
   * `dedicated.exe` (present in the fixture archive, AC3's exclusion) and never a Q2PRO-only path.
   */
  it('assembles only the r1q2 required files when the wizard picks R1Q2', async () => {
    const box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
    })

    const started = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome.status).toBe('succeeded')
    expect(box.fetched).toEqual([
      'R1Q2-b8012-msvs2022.7z',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
    expect(await exists(join(targetPath, 'r1q2.exe'))).toBe(true)
    expect(await exists(join(targetPath, 'ref_r1gl.dll'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'gamex86.dll'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'pak0.pak'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'pak2.pak'))).toBe(true)
    // AC3's exclusions: never dedicated.exe (shipped in the same fixture archive) and never a
    // Q2PRO-only path.
    expect(await exists(join(targetPath, 'dedicated.exe'))).toBe(false)
    expect(await exists(join(targetPath, 'q2pro.exe'))).toBe(false)
    expect(await exists(join(targetPath, 'baseq2', 'gamex86_64.dll'))).toBe(false)

    const installation = box.installations.find(started.value.installationId)
    expect(installation?.engineKind).toBe('r1q2')
  })

  /**
   * Story 080 D3 (AC5): a machine without the x86 VC++ runtime gets an actionable failure instead
   * of a playable verdict, even though every required file assembled without a hitch - the runtime
   * gate fires strictly after `missingRequired` and before the first revalidation.
   */
  it('fails with downloads.error.missingRuntime when the x86 runtime is absent', async () => {
    const box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
      r1q2RuntimePresent: false,
    })

    const started = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.missingRuntime' })
    // The gate fires after assembly, not instead of it: the files themselves are untouched by the
    // check (`failed()`'s own cleanup removes them afterwards, same as every other failure).
    expect(box.fetched).toEqual([
      'R1Q2-b8012-msvs2022.7z',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
  })

  /**
   * Story 080 D3 (AC4). `seedR1glConfig` forces `vid_ref "r1gl"` into a fresh install so R1Q2 finds
   * its renderer on the very first launch. Its own "never overwrite an existing file" guarantee is
   * proven directly in `r1q2-setup.test.ts`; what this job-level test proves is the surrounding
   * wiring - the seeded file is tracked by this job's own cleanup (`copied`) exactly like every
   * other assembled file, so a failed run leaves `baseq2` genuinely empty again (never a stray file
   * that would make `computeTargetVerdict` call the folder `alreadyInstalled` and permanently block
   * the very retry story 077 D3 built adoption for) - and the adopted retry then seeds the file
   * again from scratch, correctly, rather than leaving it absent or wrongly reusing the failed run's
   * copy.
   */
  it('seeds baseq2/autoexec.cfg with the r1gl line, and an adopted retry can still seed it after a failure', async () => {
    // `seedR1glConfig` (the real implementation throughout this suite) is a hard no-op off
    // Windows (story 100 D6 AC6) - proving it actually seeds the file needs `stubPlatform`.
    const restorePlatform = stubPlatform('win32')
    try {
      const box = harness({
        manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
      })
      const cfgPath = join(targetPath, 'baseq2', 'autoexec.cfg')

      // First pass: the config is seeded, then the run fails at the inspector verdict (same
      // fixture as story 077 D3's own adoption tests). The failure's cleanup removes the seeded
      // file along with everything else this job assembled, leaving `baseq2` empty again.
      breakTargetBeforeValidate(box)
      const first = await startBootstrap(box.deps, {
        engine: 'r1q2',
        targetPath,
        name: 'My R1Q2',
        includeVideoAndPlayers: false,
      })
      if (!first.ok) throw new Error(`the first run refused to start: ${first.error.key}`)
      expect((await first.value.settled).status).toBe('failed')
      vi.restoreAllMocks()

      const retried = await startBootstrap(box.deps, {
        engine: 'r1q2',
        targetPath,
        name: 'My R1Q2 (retry)',
        includeVideoAndPlayers: false,
      })
      if (!retried.ok) throw new Error(`retry refused: ${JSON.stringify(retried.error)}`)
      expect((await retried.value.settled).status).toBe('succeeded')
      // The same installation adopted, not a duplicate refusal - the whole point of tracking the
      // seeded file in `copied`.
      expect(retried.value.installationId).toBe(first.value.installationId)
      expect(await readFile(cfgPath, 'utf8')).toBe('set vid_ref "r1gl"\n')
    } finally {
      restorePlatform()
    }
  })

  /**
   * Story 080 D3/D2 (AC6/AC7): the icon a bootstrap sets is engine-aware - R1Q2 gets its own
   * shipped icon, and an unaffected Q2PRO bootstrap keeps the existing default.
   */
  it('sets the r1q2-logo icon for R1Q2 and keeps q2pro-logo for Q2PRO', async () => {
    const r1q2Box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
    })
    const r1q2Started = await startBootstrap(r1q2Box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(r1q2Started.ok).toBe(true)
    if (!r1q2Started.ok) return
    expect((await r1q2Started.value.settled).status).toBe('succeeded')
    expect(r1q2Box.installations.find(r1q2Started.value.installationId)?.icon).toEqual({
      kind: 'shipped',
      id: 'r1q2-logo',
    })

    const q2proTargetPath = join(targetPath, '..', 'target-q2pro')
    const q2proBox = harness()
    const q2proStarted = await startBootstrap(q2proBox.deps, {
      engine: 'q2pro',
      targetPath: q2proTargetPath,
      includeVideoAndPlayers: false,
    })
    expect(q2proStarted.ok).toBe(true)
    if (!q2proStarted.ok) return
    expect((await q2proStarted.value.settled).status).toBe('succeeded')
    expect(q2proBox.installations.find(q2proStarted.value.installationId)?.icon).toEqual({
      kind: 'shipped',
      id: 'q2pro-logo',
    })
  })

  /**
   * Story 080 Acceptance Tests, AC5: "missing R1GL fails before playable" - a job-level proof, not
   * just `assemble.ts`'s unit-level one. The R1Q2 engine fixture's fake extraction is missing
   * `ref_r1gl.dll` entirely (present in `FIXTURE_CONTENTS` for every other test), so the run must
   * fail with `downloads.error.packageIncomplete` rather than ever reaching a playable verdict -
   * mirroring the Q2PRO-equivalent "a package that contributes no required file fails the job
   * naming that package" test above.
   */
  it('missing R1GL fails before playable', async () => {
    const box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
      contents: {
        ...FIXTURE_CONTENTS,
        [R1Q2_ENGINE_PACKAGE.id]: ['r1q2.exe', 'baseq2/gamex86.dll', 'dedicated.exe'],
      },
    })
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.packageIncomplete' })
    expect(box.jobs.list()[0]?.error).toEqual({
      key: 'downloads.error.packageIncomplete',
      params: { packageId: R1Q2_ENGINE_PACKAGE.id },
    })
    expect(markPlayable).not.toHaveBeenCalled()
    expect(await readdir(targetPath)).toEqual([])
    expect(box.installations.list()[0]?.lastFailure?.errorKey).toBe(
      'downloads.error.packageIncomplete',
    )
  })

  /**
   * Story 080 Acceptance Tests, AC5: "point-release DLL cannot replace missing R1Q2 game module" -
   * the cross-role hardening `assemble.ts` enforces, proven here at the job level. The point
   * release's fake extraction happens to contain a file at `baseq2/gamex86.dll` (the same
   * relative path R1Q2's own required engine DLL uses), while the R1Q2 engine's own extraction
   * genuinely lacks it. The job must still fail - a later-searched, wrong-role source is never
   * allowed to satisfy an earlier role's required entry.
   */
  it('point-release DLL cannot replace missing R1Q2 game module', async () => {
    const box = harness({
      manifest: fakeManifest([R1Q2_ENGINE_PACKAGE, DEMO_PACKAGE, POINT_RELEASE_PACKAGE]),
      contents: {
        ...FIXTURE_CONTENTS,
        [R1Q2_ENGINE_PACKAGE.id]: ['r1q2.exe', 'ref_r1gl.dll', 'dedicated.exe'],
        [POINT_RELEASE_PACKAGE.id]: [
          ...FIXTURE_CONTENTS[POINT_RELEASE_PACKAGE.id]!,
          'baseq2/gamex86.dll',
        ],
      },
    })
    const markPlayable = vi.spyOn(box.jobs, 'markPlayable')

    const started = await startBootstrap(box.deps, {
      engine: 'r1q2',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.packageIncomplete' })
    expect(box.jobs.list()[0]?.error).toEqual({
      key: 'downloads.error.packageIncomplete',
      params: { packageId: R1Q2_ENGINE_PACKAGE.id },
    })
    expect(markPlayable).not.toHaveBeenCalled()
    // Never installed via the wrong-role source: the target ends up empty, not holding the point
    // release's gamex86.dll under the guise of R1Q2's own required file.
    expect(await readdir(targetPath)).toEqual([])
  })

  /**
   * Story 091 D6/AC4: the one job with a download phase is the natural place to prove that "no job
   * writes into a running installation's folder" does not also mean "no job may touch the download
   * cache while that installation's game runs". `onFetch` marks the installation as running the
   * moment the job exists (before the first byte is fetched), so the whole download+extract loop
   * (step 5) runs with the guard blocked throughout - only the core assemble pass (step 6) should
   * ever notice.
   */
  it('download and extract run while the target installation is running; only the assemble pass waits', async () => {
    let markedRunning = false
    const box = harness({
      onFetch: async () => {
        if (markedRunning) return
        markedRunning = true
        const job = box.jobs.list()[0]
        box.launch.set({ phase: 'running', installationId: job!.installationId!, pid: 4242 })
      },
    })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const job = (): Job => box.jobs.list().find((entry) => entry.id === started.value.jobId)!
    await waitFor(
      () => job().status === 'waiting',
      'the assemble pass to wait for the game to exit',
    )

    // AC4: every package downloaded and extracted to completion despite the guard reporting the
    // installation busy the entire time.
    expect(box.fetched).toEqual([
      'q2pro-1.0.0.zip',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
    expect(
      await exists(join(userDataPath, 'cache', 'downloads', 'extract', started.value.jobId)),
    ).toBe(true)
    // Only the write into the installation's own folder deferred - nothing has been assembled yet.
    expect(await exists(join(targetPath, 'q2pro.exe'))).toBe(false)
    expect(await exists(join(targetPath, 'baseq2', 'pak0.pak'))).toBe(false)
    expect(job().waitingReason).toEqual({ key: 'jobs.waiting.gameRunning' })
    expect(job().writeLock).not.toBe(true)

    // AC3: the game exits and the deferred assemble pass runs on its own.
    box.launch.set(IDLE_LAUNCH_STATE)
    const outcome = await started.value.settled

    expect(outcome.status).toBe('succeeded')
    expect(job()).toMatchObject({ status: 'succeeded', writeLock: false })
    // Assembly ran exactly once: the allowlisted files landed, and nothing was re-fetched.
    expect(await exists(join(targetPath, 'q2pro.exe'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'pak0.pak'))).toBe(true)
    expect(box.fetched).toEqual([
      'q2pro-1.0.0.zip',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
  })
})

describe('buildBootstrapSummary', () => {
  it('sums the package sizes', async () => {
    const summary = await buildBootstrapSummary(
      { manifest: fakeManifest(DEFAULT_PACKAGES) },
      { engine: 'q2pro', targetPath, includeVideoAndPlayers: true },
    )

    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.value.packages).toEqual([
      { id: 'q2pro-1.0.0', version: '1.0.0', sizeBytes: 1000, role: 'engine' },
      { id: 'q2-demo-3.14', version: '3.14', sizeBytes: 2000, role: 'demo' },
      { id: 'q2-point-3.20', version: '3.20', sizeBytes: 4000, role: 'point-release' },
    ])
    expect(summary.value.totalSizeBytes).toBe(7000)
    expect(summary.value.targetPath).toBe(targetPath)
    expect(summary.value.includeVideoAndPlayers).toBe(true)
    // Story 088 D4: unchanged for the source that predates it, and saying so explicitly.
    expect(summary.value.dataSource).toBe('free-download')
    expect(summary.value.copySource).toBeUndefined()
  })

  it('the summary names the copy source and sums the engine package only', async () => {
    const sourceRoot = await makeStoreInstallation('store-gog')
    const summary = await buildBootstrapSummary(
      {
        manifest: fakeManifest(DEFAULT_PACKAGES),
        retailSources: () => Promise.resolve([detectedSource(sourceRoot, {}, 'gog')]),
      },
      {
        engine: 'q2pro',
        targetPath,
        includeVideoAndPlayers: false,
        dataSource: 'store-copy',
        copySourcePath: sourceRoot,
      },
    )

    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    // AC5: what is still downloaded (the engine only) and how large it is...
    expect(summary.value.packages).toEqual([
      { id: 'q2pro-1.0.0', version: '1.0.0', sizeBytes: 1000, role: 'engine' },
    ])
    expect(summary.value.totalSizeBytes).toBe(1000)
    // ...the copy source, by store and path, taken from main's own list, not from the caller...
    expect(summary.value.dataSource).toBe('store-copy')
    expect(summary.value.copySource).toEqual({ path: sourceRoot, store: 'gog' })
    // ...and the target.
    expect(summary.value.targetPath).toBe(targetPath)
  })

  it('a copy source main no longer lists is still named, without a store', async () => {
    // The summary reports; refusing the run is `startBootstrap`'s job (and it does - see the D4
    // suite above). A confirm step with no line at all about the source would be the worse answer.
    const sourceRoot = await makeStoreInstallation('store-gone')
    const summary = await buildBootstrapSummary(
      { manifest: fakeManifest(DEFAULT_PACKAGES), retailSources: () => Promise.resolve([]) },
      {
        engine: 'q2pro',
        targetPath,
        includeVideoAndPlayers: false,
        dataSource: 'store-copy',
        copySourcePath: sourceRoot,
      },
    )

    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.value.copySource).toEqual({ path: sourceRoot })
  })

  it('AC6: the summary names the picked folder, with no store, and sums the engine package only', async () => {
    const sourceRoot = join(dir, 'picked-folder')
    const summary = await buildBootstrapSummary(
      // No `retailSources` at all: a hand-picked folder is by definition not on that list, so
      // summarising this source must not depend on having one.
      { manifest: fakeManifest(DEFAULT_PACKAGES) },
      {
        engine: 'q2pro',
        targetPath,
        includeVideoAndPlayers: false,
        dataSource: 'existing-folder',
        copySourcePath: sourceRoot,
      },
    )

    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.value.packages).toEqual([
      { id: 'q2pro-1.0.0', version: '1.0.0', sizeBytes: 1000, role: 'engine' },
    ])
    expect(summary.value.totalSizeBytes).toBe(1000)
    expect(summary.value.dataSource).toBe('existing-folder')
    // The folder itself, and no `store` - "main did not detect this, the user pointed at it".
    expect(summary.value.copySource).toEqual({ path: sourceRoot })
    expect(summary.value.targetPath).toBe(targetPath)
  })

  it('review F2: the summary reports includeVideoAndPlayers as false for an existing-folder source even when asked for true', async () => {
    const sourceRoot = join(dir, 'picked-folder-extras')
    const summary = await buildBootstrapSummary(
      { manifest: fakeManifest(DEFAULT_PACKAGES) },
      {
        engine: 'q2pro',
        targetPath,
        includeVideoAndPlayers: true,
        dataSource: 'existing-folder',
        copySourcePath: sourceRoot,
      },
    )

    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.value.includeVideoAndPlayers).toBe(false)
  })

  it('fails when the manifest cannot produce all three packages', async () => {
    const summary = await buildBootstrapSummary(
      { manifest: fakeManifest([DEMO_PACKAGE, POINT_RELEASE_PACKAGE]) },
      { engine: 'q2pro', targetPath, includeVideoAndPlayers: false },
    )

    expect(summary.ok).toBe(false)
    if (!summary.ok) {
      expect(summary.error.key).toBe('downloads.error.packageUnavailable')
      expect(summary.error.params).toEqual({ role: 'engine' })
    }
  })
})
