import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RETAIL_PAK_SIZES } from '@shared/constants'
import {
  DEFAULT_BOOTSTRAP_INSTALLATION_NAME,
  type GameDataSourceVerdict,
} from '@shared/modules/downloads'
import { fail } from '@shared/types'
import { inspectInstallation } from '../../../services/inspector'
import { PLAYABLE_AT_RATIO, startBootstrap } from './job'
import {
  installBootstrapTempDirs,
  type Harness,
  harness,
  exists,
  makeStoreInstallation,
  detectedSource,
  observeValidateOrder,
  dir,
  targetPath,
} from './job.test-helpers'

installBootstrapTempDirs()

/**
 * Story 088 D4. The second data source rewires a job that mutates a registered installation
 * mid-run, so what is asserted here is the *order and the gate*, not just the end state: the copy
 * lands before the first playability revalidation, the renderer's source path is re-resolved against
 * main's own fresh list before anything is registered, and the free-download path comes out of it
 * byte-for-byte unchanged (the last test).
 */
describe('startBootstrap from a detected retail source', () => {
  const startCopy = (
    box: Harness,
    copySourcePath: string,
    overrides: { name?: string; includeVideoAndPlayers?: boolean } = {},
  ) =>
    startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: overrides.includeVideoAndPlayers ?? false,
      dataSource: 'store-copy',
      copySourcePath,
      ...(overrides.name ? { name: overrides.name } : {}),
    })

  it('a store-copy run resolves the engine package only', async () => {
    const sourceRoot = await makeStoreInstallation('store-steam')
    const box = harness({ retailSources: [detectedSource(sourceRoot)] })

    const started = await startCopy(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    // AC4: the engine build is downloaded and verified exactly as [[074]] does - and it is the only
    // thing downloaded. The demo and the point release are not even resolved.
    expect(box.fetched).toEqual(['q2pro-1.0.0.zip'])
    expect(box.gameDataRequests).toEqual([])
    // The paks are real copies of the source's bytes, and the engine came from the archive.
    expect(await readFile(join(targetPath, 'baseq2', 'pak0.pak'), 'utf8')).toBe(
      await readFile(join(sourceRoot, 'baseq2', 'pak0.pak'), 'utf8'),
    )
    expect(await readFile(join(targetPath, 'baseq2', 'pak1.pak'), 'utf8')).toBe(
      await readFile(join(sourceRoot, 'baseq2', 'pak1.pak'), 'utf8'),
    )
    expect(await exists(join(targetPath, 'q2pro.exe'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'gamex86_64.dll'))).toBe(true)
    // AC7: the source's `ctf/` is not on the allowlist, so it cannot arrive.
    expect(await readdir(targetPath)).not.toContain('ctf')
    // Main re-listed its own sources for this run, exactly once.
    expect(box.retailSourceCalls.count).toBe(1)
  })

  it('the copy happens before the first playability revalidation', async () => {
    // The deliverable's named risk: a copy that landed *after* the first `validate()` would leave
    // the installation registered as unplayable at the moment the marker is decided - and the run
    // would then fail on a verdict about a folder the job had not finished filling.
    const sourceRoot = await makeStoreInstallation('store-steam')
    const box = harness({ retailSources: [detectedSource(sourceRoot)] })
    const pakAtValidate = observeValidateOrder(box)

    const started = await startCopy(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(pakAtValidate.length).toBeGreaterThan(0)
    expect(pakAtValidate[0]).toBe(true)
    expect(box.jobs.list()[0]?.playableAtRatio).toBe(PLAYABLE_AT_RATIO)
  })

  it('the status always comes from inspectInstallation and the default name is not the demo name', async () => {
    const sourceRoot = await makeStoreInstallation('store-steam')
    const box = harness({ retailSources: [detectedSource(sourceRoot)] })

    // No `name`, so the default applies - AC6/Decisions (Sprint): the engine's own label, since
    // this installation's base data is retail and "Q2PRO Demo" would outlive the missing badge.
    const started = await startCopy(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled
    expect(outcome.status).toBe('succeeded')

    const installation = box.installations.find(started.value.installationId)
    expect(installation?.name).toBe('Q2PRO')
    expect(installation?.name).not.toBe(DEFAULT_BOOTSTRAP_INSTALLATION_NAME)
    // Re-derived here, independently, from the folder the run produced - so no status in this run
    // can have been hand-set or derived from "this was a retail copy" anywhere in the job.
    const inspected = await inspectInstallation(targetPath)
    expect(installation?.status).toBe(inspected.status)
    expect(installation?.status).not.toBe('invalid')
    if (outcome.status === 'succeeded') {
      expect(outcome.installationStatus).toBe(inspected.status)
    }
  })

  it('the extras come from the retail source when the toggle is on', async () => {
    const sourceRoot = await makeStoreInstallation('store-steam', true)
    const box = harness({
      retailSources: [detectedSource(sourceRoot, { hasVideo: true, hasPlayers: true })],
    })

    const started = await startCopy(box, sourceRoot, { includeVideoAndPlayers: true })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(await exists(join(targetPath, 'baseq2', 'video', 'ntro.cin'))).toBe(true)
    expect(await exists(join(targetPath, 'baseq2', 'players', 'male', 'tris.md2'))).toBe(true)
    expect(await readdir(targetPath)).not.toContain('ctf')
  })

  it('a copySourcePath that is not among the freshly listed detected sources registers nothing', async () => {
    // The wizard may well have offered this very folder a minute ago; what decides is main's own
    // list *now* (Decisions (Sprint): "the picker list is a UI convenience, not an authorisation").
    const sourceRoot = await makeStoreInstallation('store-steam')
    const detectedElsewhere = await makeStoreInstallation('store-elsewhere')
    const box = harness({ retailSources: [detectedSource(detectedElsewhere)] })

    const started = await startCopy(box, sourceRoot)

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.error.key).toBe('downloads.error.retailSourceUnverified')
    expect(started.error.params).toEqual({ reason: 'notDetected' })
    // Nothing was created, on disk or in the library, and nothing was downloaded.
    expect(box.installations.list()).toEqual([])
    expect(box.jobs.list()).toEqual([])
    expect(box.fetched).toEqual([])
    expect(await exists(targetPath)).toBe(false)
    // The source itself was not touched either.
    expect((await readdir(join(sourceRoot, 'baseq2'))).sort()).toEqual(['pak0.pak', 'pak1.pak'])
  })

  it('a store-copy run whose source comes up empty at copy time fails with its own key, never packageIncomplete naming "retail" (review F1)', async () => {
    // Verified at the D4 pre-check (the fabricated `retailSources` answer below), but the folder
    // itself has no `baseq2` at all by the time the actual copy runs - the store installation was
    // moved or deleted in between. `PACKAGE_INCOMPLETE` would fall back to the literal string
    // `'retail'` as its `packageId` (there is no manifest package behind a `store-copy` run's
    // `'retail'` role - see `resolvePackages`), producing a nonsensical "the download \"retail\"
    // arrived intact" message for a run that downloaded nothing.
    const sourceRoot = join(dir, 'store-vanished')
    await mkdir(sourceRoot, { recursive: true })
    const box = harness({ retailSources: [detectedSource(sourceRoot)] })

    const started = await startCopy(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.retailCopyIncomplete' })
    // Never `packageIncomplete` falling back to the literal role name as its `packageId`.
    const jobError = box.jobs.list().find((job) => job.id === started.value.jobId)?.error
    expect(jobError).toEqual({ key: 'downloads.error.retailCopyIncomplete' })
    expect(box.installations.find(started.value.installationId)?.lastFailure?.errorKey).toBe(
      'downloads.error.retailCopyIncomplete',
    )
  })

  it('a detected source that no longer verifies registers nothing', async () => {
    // Listed, but its fresh inspection says the paks are not retail - the same refusal, carrying
    // the inspector's own reason key rather than a second opinion about why.
    const sourceRoot = await makeStoreInstallation('store-steam')
    const box = harness({
      retailSources: [
        detectedSource(sourceRoot, {
          verified: false,
          unverifiedReason: 'bootstrap.retailSource.pak0SizeMismatch',
        }),
      ],
    })

    const started = await startCopy(box, sourceRoot)

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.error.key).toBe('downloads.error.retailSourceUnverified')
    expect(started.error.params).toEqual({ reason: 'bootstrap.retailSource.pak0SizeMismatch' })
    expect(box.installations.list()).toEqual([])
    expect(box.jobs.list()).toEqual([])
    expect(box.fetched).toEqual([])
    expect(await exists(targetPath)).toBe(false)
  })

  it('a store-copy run with no source path at all is refused, never silently downloaded', async () => {
    // The schema refuses this payload over IPC; this is the in-process caller's equivalent, and the
    // one failure mode that would otherwise be invisible - a run falling back to the free download
    // would succeed, with demo data, under a retail run's name.
    const box = harness({ retailSources: [] })

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
      dataSource: 'store-copy',
    })

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.error.key).toBe('downloads.error.retailSourceUnverified')
    expect(started.error.params).toEqual({ reason: 'pathMissing' })
    expect(box.installations.list()).toEqual([])
    expect(box.fetched).toEqual([])
  })

  it('regression: the free-download path is untouched by this deliverable', async () => {
    // Same harness, a detected source available and deliberately ignored: a run that does not ask
    // for `store-copy` resolves and downloads all three packages, never consults the retail list,
    // assembles before the first revalidation and keeps [[074]]'s default name.
    const ignored = detectedSource(await makeStoreInstallation('store-steam'))
    const box = harness({ retailSources: [ignored] })
    const pakAtValidate = observeValidateOrder(box)

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(box.fetched).toEqual([
      'q2pro-1.0.0.zip',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
    expect(box.gameDataRequests).toEqual(['demo', 'point-release'])
    expect(box.retailSourceCalls.count).toBe(0)
    expect(pakAtValidate[0]).toBe(true)
    expect(box.installations.find(started.value.installationId)?.name).toBe(
      DEFAULT_BOOTSTRAP_INSTALLATION_NAME,
    )
  })
})

describe('startBootstrap from an existing folder', () => {
  /**
   * A folder the user hand-picked: a `baseq2` holding the named paks, plus everything AC7 forbids
   * from reaching the target - the `ctf`/`xatrix` payloads a real 3.20-patched folder carries, and
   * a loose file inside `baseq2` itself (the case a "copy baseq2, minus a denylist" implementation
   * would get wrong and an allowlist cannot).
   */
  async function makeFolderSource(
    name: string,
    paks: string[] = ['pak0.pak', 'pak1.pak'],
  ): Promise<string> {
    const root = join(dir, name)
    await mkdir(join(root, 'baseq2'), { recursive: true })
    for (const pak of paks) {
      await writeFile(join(root, 'baseq2', pak), `${name} ${pak}`)
    }
    await writeFile(join(root, 'baseq2', 'config.cfg'), 'a loose file of the user’s own')
    for (const modDir of ['ctf', 'xatrix', 'rogue']) {
      await mkdir(join(root, modDir), { recursive: true })
      await writeFile(join(root, modDir, 'pak0.pak'), modDir)
    }
    return root
  }

  /** A fabricated `retail` verdict over a fixture whose paks hold a few bytes - see the harness
   * option's own comment for why the sizes are not the real ones. */
  const retailVerdict =
    (names: string[] = ['pak0.pak', 'pak1.pak']) =>
    (rootPath: string): GameDataSourceVerdict => ({
      rootPath,
      kind: 'retail',
      paks: names.map((name) => ({ name, sizeBytes: RETAIL_PAK_SIZES[name] ?? 0, retail: true })),
    })

  const startFolder = (
    box: Harness,
    copySourcePath: string,
    overrides: { name?: string; targetPath?: string; includeVideoAndPlayers?: boolean } = {},
  ) =>
    startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath: overrides.targetPath ?? targetPath,
      includeVideoAndPlayers: overrides.includeVideoAndPlayers ?? false,
      dataSource: 'existing-folder',
      copySourcePath,
      ...(overrides.name ? { name: overrides.name } : {}),
    })

  it('AC5: an unusable source is refused before the installation is registered', async () => {
    // The real `inspectGameDataSource` against a real folder - no fabricated verdict here, because
    // the refusal is the thing under test and a faked verdict would be testing the fake.
    const empty = join(dir, 'nothing-here')
    await mkdir(empty, { recursive: true })
    const box = harness()

    const started = await startFolder(box, empty)

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.error.key).toBe('downloads.error.gameDataSourceUnusable')
    expect(started.error.params).toEqual({ reason: 'bootstrap.gameDataSource.baseDirMissing' })
    // Nothing was created, on disk or in the library, and nothing was downloaded - AC5's "before
    // the job starts, not partway through".
    expect(box.installations.list()).toEqual([])
    expect(box.jobs.list()).toEqual([])
    expect(box.fetched).toEqual([])
    expect(await exists(targetPath)).toBe(false)
  })

  it('AC5: a baseq2 without pak0 is refused with its own reason', async () => {
    const noPak0 = await makeFolderSource('folder-no-pak0', ['pak3.pak'])
    const box = harness()

    const started = await startFolder(box, noPak0)

    expect(started.ok).toBe(false)
    if (started.ok) return
    expect(started.error.key).toBe('downloads.error.gameDataSourceUnusable')
    expect(started.error.params).toEqual({ reason: 'bootstrap.gameDataSource.pak0Missing' })
    expect(box.installations.list()).toEqual([])
    expect(box.fetched).toEqual([])
  })

  it('a source that overlaps the target is refused the same way, in both directions', async () => {
    // "Copying a folder into itself is the one way this feature could destroy the user's data"
    // (Decisions (Sprint)). All three shapes are the same refusal, and each is checked *before*
    // the folder is even inspected - a source that is also the target would otherwise be inspected,
    // accepted and then assembled on top of itself.
    const nested = join(targetPath, 'game-data')
    for (const source of [targetPath, nested, dir]) {
      const box = harness()

      const started = await startFolder(box, source)

      expect(started.ok).toBe(false)
      if (started.ok) return
      expect(started.error.key).toBe('downloads.error.gameDataSourceUnusable')
      expect(started.error.params).toEqual({ reason: 'targetOverlap' })
      expect(box.installations.list()).toEqual([])
      expect(box.jobs.list()).toEqual([])
      expect(box.fetched).toEqual([])
      expect(await exists(targetPath)).toBe(false)
    }
  })

  it('AC3: an existing-folder run resolves the engine package only and copies exactly the folder’s paks', async () => {
    const sourceRoot = await makeFolderSource('picked-retail', ['pak0.pak', 'pak1.pak', 'pak2.pak'])
    const box = harness({
      gameDataSource: retailVerdict(['pak0.pak', 'pak1.pak', 'pak2.pak']),
      // Deliberately available and deliberately irrelevant: this source is not a detected store
      // install, so the job must never consult that list for it.
      retailSources: [detectedSource(await makeStoreInstallation('store-steam'))],
    })
    const pakAtValidate = observeValidateOrder(box)

    const started = await startFolder(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    // The engine build is downloaded and verified exactly as [[074]] does - and it is the only
    // thing downloaded; the demo and the point release are not even resolved.
    expect(box.fetched).toEqual(['q2pro-1.0.0.zip'])
    expect(box.gameDataRequests).toEqual([])
    expect(box.retailSourceCalls.count).toBe(0)
    // Real copies of the folder's own bytes, never links...
    for (const pak of ['pak0.pak', 'pak1.pak', 'pak2.pak']) {
      expect(await readFile(join(targetPath, 'baseq2', pak), 'utf8')).toBe(
        await readFile(join(sourceRoot, 'baseq2', pak), 'utf8'),
      )
    }
    // ...and AC7: exactly the allowlist, so neither the source's mod dirs nor the loose file in its
    // own `baseq2` can arrive.
    expect((await readdir(targetPath)).sort()).toEqual(['baseq2', 'q2pro.exe'])
    expect((await readdir(join(targetPath, 'baseq2'))).sort()).toEqual([
      'gamex86_64.dll',
      'pak0.pak',
      'pak1.pak',
      'pak2.pak',
    ])
    // The copy happens in the assemble phase, so it is on disk before the first playability
    // revalidation - the same phase-order property the other copy source is held to.
    expect(pakAtValidate[0]).toBe(true)
    expect(box.jobs.list()[0]?.playableAtRatio).toBe(PLAYABLE_AT_RATIO)
    // Not "Q2PRO Demo": neither copy source has a demo identity to draw a default name from.
    const installation = box.installations.find(started.value.installationId)
    expect(installation?.name).toBe('Q2PRO')
    // Re-derived independently from the folder the run produced, so no status here can have been
    // hand-set or inferred from "this was a folder copy".
    expect(installation?.status).toBe((await inspectInstallation(targetPath)).status)
  })

  it('review F2: includeVideoAndPlayers is forced false server-side for an existing-folder run, even when a scripted caller sends true', async () => {
    // Decisions: "no video/players toggle for this source in this story... the toggle is hidden
    // and includeVideoAndPlayers is forced false when the source is a folder." The renderer already
    // enforces that (BootstrapWizard.tsx), but main must not trust a caller that skips the renderer
    // and sends `includeVideoAndPlayers: true` directly - so the source folder here carries a
    // `baseq2/video` and `baseq2/players` (a real 3.20-patched folder would), and the assertion is
    // that neither ever reaches the target regardless of the input flag.
    const sourceRoot = await makeFolderSource('picked-with-extras', ['pak0.pak', 'pak1.pak'])
    await mkdir(join(sourceRoot, 'baseq2', 'video'), { recursive: true })
    await writeFile(join(sourceRoot, 'baseq2', 'video', 'ntro.cin'), 'ntro')
    await mkdir(join(sourceRoot, 'baseq2', 'players', 'male'), { recursive: true })
    await writeFile(join(sourceRoot, 'baseq2', 'players', 'male', 'tris.md2'), 'tris')
    const box = harness()

    const started = await startFolder(box, sourceRoot, { includeVideoAndPlayers: true })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(await exists(join(targetPath, 'baseq2', 'video'))).toBe(false)
    expect(await exists(join(targetPath, 'baseq2', 'players'))).toBe(false)
    expect((await readdir(join(targetPath, 'baseq2'))).sort()).toEqual([
      'gamex86_64.dll',
      'pak0.pak',
      'pak1.pak',
    ])
  })

  it('AC4: a demo-only folder installs with the one pak it has', async () => {
    // The real inspector again: a few-byte `pak0.pak` and no `pak1.pak` is exactly what makes this
    // verdict `demo`, and the plan must then require that one pak alone - a fixed retail list would
    // fail this run at `missingRequired` for a file the wizard already said was not there.
    const sourceRoot = await makeFolderSource('picked-demo', ['pak0.pak'])
    const box = harness()

    const started = await startFolder(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(await readFile(join(targetPath, 'baseq2', 'pak0.pak'), 'utf8')).toBe(
      await readFile(join(sourceRoot, 'baseq2', 'pak0.pak'), 'utf8'),
    )
    expect((await readdir(join(targetPath, 'baseq2'))).sort()).toEqual([
      'gamex86_64.dll',
      'pak0.pak',
    ])
    expect(box.fetched).toEqual(['q2pro-1.0.0.zip'])
  })

  it("a failed existing-folder run's cleanup removes the copied paks and leaves the source alone", async () => {
    // The failure exit this suite can reach with the copied paks still *on disk* (the verdict-based
    // one deletes them itself to provoke the verdict): the first revalidation answers a failed
    // `Outcome`, so cleanup runs against a target that really does hold everything this job copied.
    const sourceRoot = await makeFolderSource('picked-doomed', ['pak0.pak', 'pak1.pak'])
    const box = harness({ gameDataSource: retailVerdict() })
    vi.spyOn(box.installations, 'validate').mockImplementationOnce(async () =>
      fail('installations.error.notFound'),
    )

    const started = await startFolder(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const outcome = await started.value.settled
    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.diskWrite' })

    // The copied paks are in `copied` like any downloaded file, so the generic cleanup takes them
    // and then prunes the `baseq2` it made - the root the user picked survives, empty (077 AC1).
    expect(await exists(targetPath)).toBe(true)
    expect(await readdir(targetPath)).toEqual([])
    // And the user's own folder is untouched: the cleanup deletes copies, never originals.
    expect((await readdir(join(sourceRoot, 'baseq2'))).sort()).toEqual([
      'config.cfg',
      'pak0.pak',
      'pak1.pak',
    ])
    expect(box.installations.list().map((entry) => entry.id)).toEqual([
      started.value.installationId,
    ])
    expect(box.installations.find(started.value.installationId)?.lastFailure?.errorKey).toBe(
      'downloads.error.diskWrite',
    )
  })

  it('a folder that loses a pak between the check and the copy fails with its own key, never packageIncomplete naming "folder"', async () => {
    // Inspected as retail at step 1c (the fabricated verdict below), and by the time the copy runs
    // the folder only has `pak0.pak` - it was edited or emptied out from under the wizard. Nothing
    // was downloaded for the `'folder'` role, so `PACKAGE_INCOMPLETE` would fall back to the literal
    // string `'folder'` as its `packageId` and claim a download that never happened.
    const sourceRoot = await makeFolderSource('picked-vanishing', ['pak0.pak'])
    const box = harness({ gameDataSource: retailVerdict(['pak0.pak', 'pak1.pak']) })

    const started = await startFolder(box, sourceRoot)
    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(await started.value.settled).toEqual({
      status: 'failed',
      key: 'downloads.error.gameDataSourceUnusable',
    })
    const jobError = box.jobs.list().find((job) => job.id === started.value.jobId)?.error
    expect(jobError).toEqual({ key: 'downloads.error.gameDataSourceUnusable' })
  })

  it('regression: the free-download path is untouched by this deliverable', async () => {
    // Same harness, a fabricated folder verdict available and deliberately ignored: a run that does
    // not ask for `existing-folder` still resolves and downloads all three packages, assembles
    // before the first revalidation and keeps [[074]]'s default name.
    const box = harness({ gameDataSource: retailVerdict() })
    const pakAtValidate = observeValidateOrder(box)

    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect((await started.value.settled).status).toBe('succeeded')

    expect(box.fetched).toEqual([
      'q2pro-1.0.0.zip',
      'q2-314-demo-x86.exe',
      'q2-3.20-x86-full-ctf.exe',
    ])
    expect(box.gameDataRequests).toEqual(['demo', 'point-release'])
    expect(pakAtValidate[0]).toBe(true)
    expect(box.installations.find(started.value.installationId)?.name).toBe(
      DEFAULT_BOOTSTRAP_INSTALLATION_NAME,
    )
  })
})
