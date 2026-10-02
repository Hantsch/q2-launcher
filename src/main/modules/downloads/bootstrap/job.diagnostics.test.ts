import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXTRACTION_LISTING_CAP } from '../diagnostics'
import { BOOTSTRAP_JOB_KIND, startBootstrap } from './job'
import {
  ENGINE_PACKAGE,
  DEMO_PACKAGE,
  POINT_RELEASE_PACKAGE,
  FIXTURE_CONTENTS,
  installBootstrapTempDirs,
  type Harness,
  harness,
  recordFor,
  breakTargetBeforeValidate,
  exists,
  dir,
  userDataPath,
  targetPath,
} from './job.test-helpers'

installBootstrapTempDirs()

/**
 * Story 075 D3. The collector itself (redaction, the ring, the registry) is D2's suite; what is
 * proved here is that *this* job hands it the right values at the right moments - and, just as
 * importantly, that handing them over changed nothing about what the job does.
 */
describe('startBootstrap diagnostics', () => {
  /** Stands in for a `mirrors` entry that fired: not the URL the manifest names. */
  const DEMO_MIRROR = 'https://mirror.example.net/q2/q2-314-demo-x86.exe'

  const run = async (box: Harness, includeVideoAndPlayers = false) => {
    const started = await startBootstrap(box.deps, {
      engine: 'q2pro',
      targetPath,
      includeVideoAndPlayers,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error(`bootstrap refused to start: ${started.error.key}`)
    const outcome = await started.value.settled
    return { jobId: started.value.jobId, outcome, record: recordFor(box, started.value.jobId) }
  }

  it('a failed run records every package it touched with its serving URL, size, verify and extract result', async () => {
    // The 2026-09-08 run in miniature: all three packages download and extract, and not one of
    // them contributes a required file. The demo came off a mirror. Since story 076 D3 that run
    // fails naming a package rather than only reporting the end-of-run verdict - what is asserted
    // here is unchanged either way: every package it touched is in the record.
    const box = harness({
      contents: {},
      servingUrl: (source) =>
        source.fileName === 'q2-314-demo-x86.exe' ? DEMO_MIRROR : source.url,
    })

    const { jobId, outcome, record } = await run(box)

    expect(outcome).toEqual({
      status: 'failed',
      key: 'downloads.error.packageIncomplete',
      params: { packageId: DEMO_PACKAGE.id },
    })
    expect(record?.jobId).toBe(jobId)
    expect(record?.kind).toBe(BOOTSTRAP_JOB_KIND)
    expect(record?.errorKey).toBe('downloads.error.packageIncomplete')
    // Every package, in processing order, with the URL that actually served it - the mirror for
    // the demo, not the manifest's primary. Story 078 D3: each also carries what its extraction
    // produced (here: nothing - these archives really were empty) and whether it went on to serve
    // an assembled file (here: none of them did).
    expect(record?.packages).toEqual([
      {
        id: ENGINE_PACKAGE.id,
        url: ENGINE_PACKAGE.url,
        sizeBytes: 1000,
        verified: true,
        extracted: true,
        contents: [],
        contributed: false,
      },
      {
        id: DEMO_PACKAGE.id,
        url: DEMO_MIRROR,
        sizeBytes: 2000,
        verified: true,
        extracted: true,
        contents: [],
        contributed: false,
      },
      {
        id: POINT_RELEASE_PACKAGE.id,
        url: POINT_RELEASE_PACKAGE.url,
        sizeBytes: 4000,
        verified: true,
        extracted: true,
        contents: [],
        contributed: false,
      },
    ])
  })

  it('a not-playable verdict records the target path, the verdict and the failing checks', async () => {
    // A complete package set, so the run reaches the verdict at all (story 076 D3 fails an
    // incomplete one earlier, before there is a target to record).
    const box = harness()
    breakTargetBeforeValidate(box)

    const { record } = await run(box)

    expect(record?.target?.targetPath).toBe(targetPath)
    expect(record?.target?.verdict).toBe('invalid')
    expect(record?.target?.missingChecks.map((check) => check.id)).toContain('base-paks')
    // i18n keys, never prose (AC7) - a sentence would have spaces in it.
    for (const check of record?.target?.missingChecks ?? []) {
      expect(check.messageKey).toMatch(/^[a-z][\w.]*$/)
    }
  })

  it('missingChecks carry basename params', async () => {
    const box = harness()
    breakTargetBeforeValidate(box)
    const brokenValidate = box.installations.validate.bind(box.installations)
    // Assigned, not spied: `breakTargetBeforeValidate` already spies this method.
    box.installations.validate = async (id) => {
      const result = await brokenValidate(id)
      if (!result.ok) return result
      return {
        ...result,
        value: {
          ...result.value,
          checks: [
            ...result.value.checks,
            {
              id: 'write-access' as const,
              severity: 'warn' as const,
              messageKey: 'validation.notWritable',
              params: {
                path: join(targetPath, 'baseq2'),
                windowsPath: 'C:\\Users\\jane\\Quake II',
                count: 3,
              },
            },
          ],
        },
      }
    }

    const { record } = await run(box)

    const check = record?.target?.missingChecks.find((entry) => entry.id === 'write-access')
    expect(check?.params).toEqual({ path: 'baseq2', windowsPath: 'Quake II', count: 3 })
    expect(JSON.stringify(record?.target)).not.toContain('jane')
  })

  it('a package that extracted nothing is identifiable in the diagnostics', async () => {
    // The demo archive "extracts" perfectly and still contributes no `baseq2/pak0.pak` (story
    // 076's real bug). Nothing about the demo's own row looks wrong - verified, extracted, off the
    // expected URL - so what names the package that brought nothing is the recorded error key and
    // the log tail's candidate paths, which is exactly what D3 added.
    const box = harness({ contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: [] } })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({
      status: 'failed',
      key: 'downloads.error.packageIncomplete',
      params: { packageId: DEMO_PACKAGE.id },
    })
    expect(record?.packages.map((pkg) => pkg.id)).toEqual([
      ENGINE_PACKAGE.id,
      DEMO_PACKAGE.id,
      POINT_RELEASE_PACKAGE.id,
    ])
    expect(record?.packages.every((pkg) => pkg.verified && pkg.extracted)).toBe(true)
    expect(record?.errorKey).toBe('downloads.error.packageIncomplete')
    expect(record?.logTail.some((line) => line.includes('Install/Data/baseq2/pak0.pak'))).toBe(true)
  })

  it('a run that fails while downloading still records the packages it got to', async () => {
    const box = harness({
      failFetchFor: 'q2-314-demo-x86.exe',
      servingUrl: (source) =>
        source.fileName === 'q2-314-demo-x86.exe' ? DEMO_MIRROR : source.url,
    })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.network' })
    // Partial, not nothing: the engine as it really went (with its extraction's top level), the
    // demo as far as it got (the URL last tried, and - story 078 D3 - no `contents` at all, since
    // it never extracted), and no row at all for the package that was never reached.
    expect(record?.packages).toEqual([
      {
        id: ENGINE_PACKAGE.id,
        url: ENGINE_PACKAGE.url,
        sizeBytes: 1000,
        verified: true,
        extracted: true,
        contents: ['baseq2', 'q2pro.exe'],
      },
      { id: DEMO_PACKAGE.id, url: DEMO_MIRROR, sizeBytes: 2000, verified: false, extracted: false },
    ])
    // No target verdict exists yet - the run never reached the install target stage.
    expect(record?.target).toBeUndefined()
    // Story 078 D3: and no assembly record either - the run failed before the first assemble pass,
    // so there is nothing to say about what assembly looked for.
    expect(record?.assembly).toBeUndefined()
  })

  it('a run that fails while extracting records that package as verified but not extracted', async () => {
    const box = harness({ failExtractFor: DEMO_PACKAGE.id })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({ status: 'failed', key: 'downloads.error.extractionFailed' })
    expect(record?.packages).toEqual([
      {
        id: ENGINE_PACKAGE.id,
        url: ENGINE_PACKAGE.url,
        sizeBytes: 1000,
        verified: true,
        extracted: true,
        contents: ['baseq2', 'q2pro.exe'],
      },
      // Story 078 D3 (AC8): a package whose extraction *failed* carries no `contents` key at all -
      // not an empty array, which would read as "the archive was empty". `toEqual` is what asserts
      // that here: an extra `contents: []` on this row would fail it.
      {
        id: DEMO_PACKAGE.id,
        url: DEMO_PACKAGE.url,
        sizeBytes: 2000,
        verified: true,
        extracted: false,
      },
    ])
    expect(record?.target).toBeUndefined()
    expect(record?.assembly).toBeUndefined()
  })

  it("captures the job's own log lines and redacts paths at capture time", async () => {
    // `homeDir` set to the suite's temp root, so every path the job logs or records sits inside it.
    const box = harness({ homeDir: dir })
    breakTargetBeforeValidate(box)

    const { record } = await run(box)

    expect(record?.target?.targetPath).toBe(join('<home>', 'target'))
    // Teed, not swallowed: the wrapped logger still saw the failure line...
    const failureLine = box.logLines.find((line) => line.includes('failed with'))
    expect(failureLine).toContain('downloads.error.installationNotPlayable')
    // ...and the ring holds it too, with the temp root redacted out of it.
    expect(record?.logTail.some((line) => line.includes('installationNotPlayable'))).toBe(true)
    expect(record?.logTail.join('\n')).not.toContain(dir)
  })

  it('the happy path is unchanged and records the target it succeeded with', async () => {
    const box = harness()

    const { jobId, outcome, record } = await run(box, true)

    expect(outcome.status).toBe('succeeded')
    expect(box.jobs.list().find((job) => job.id === jobId)?.status).toBe('succeeded')
    expect(await exists(join(targetPath, 'baseq2', 'pak0.pak'))).toBe(true)
    expect(box.installations.list()).toHaveLength(1)
    // Recorded before the verdict was branched on, so success and failure record the same thing.
    expect(record?.packages).toHaveLength(3)
    expect(record?.target?.targetPath).toBe(targetPath)
    expect(record?.target?.verdict).not.toBe('invalid')
  })

  it('cleans up exactly the same whether or not a collector is attached', async () => {
    // The capture calls sit before the `failed()` that runs `cleanUp()`, so the observable
    // outcome of a failed run must be byte-for-byte the same without one.
    const withCollector = harness({ contents: {} })
    const instrumented = await run(withCollector)

    expect(instrumented.outcome).toEqual({
      status: 'failed',
      key: 'downloads.error.packageIncomplete',
      params: { packageId: DEMO_PACKAGE.id },
    })
    expect(await readdir(targetPath)).toEqual([])
    expect(withCollector.installations.list()).toHaveLength(1)
    expect(instrumented.record).toBeDefined()

    // The second run re-uses the same (now empty, cleaned) target folder, which is exactly the
    // state story 077 D2 leaves behind - and `computeTargetVerdict` must still let a run start
    // there, since that is what a retry does.
    const plain = harness({ contents: {} })
    delete plain.deps.diagnostics
    const bare = await run(plain)

    expect(bare.outcome).toEqual(instrumented.outcome)
    expect(await readdir(targetPath)).toEqual([])
    expect(plain.installations.list()).toHaveLength(1)
    expect(await exists(join(userDataPath, 'cache', 'downloads', 'extract', bare.jobId))).toBe(
      false,
    )
    // Nothing was recorded for an uninstrumented job, and nothing broke for the want of it.
    expect(bare.record).toBeUndefined()
  })

  /**
   * Story 078 D3. The two records that were missing on 2026-09-08: what assembly looked for and
   * what served it (AC7/AC1), and what each extraction actually produced (AC8). Same harness, same
   * `run` helper - what changes is only what the finished record is asked about.
   */

  it('a run that assembles nothing marks every package as not contributed', async () => {
    // Literally the 2026-09-08 run: three packages that download, verify and extract, and an
    // assembly that finds none of the files it is looking for. Before this deliverable the record
    // ended at "still invalid after assembly"; now it says so entry by entry.
    const box = harness({ contents: {} })

    const { outcome, record } = await run(box)

    expect(outcome).toEqual({
      status: 'failed',
      key: 'downloads.error.packageIncomplete',
      params: { packageId: DEMO_PACKAGE.id },
    })
    // One entry per allowlist entry, each reporting the candidate it looked for and that nothing
    // served it - and no entry claiming a source.
    expect(record?.assembly?.length).toBeGreaterThan(0)
    expect(record?.assembly?.every((entry) => entry.found === false)).toBe(true)
    expect(record?.assembly?.every((entry) => entry.sourcePackageId === undefined)).toBe(true)
    // Story 078 review finding M3: both entries have more than one candidate, so a not-found row
    // records every candidate that was tried (joined by ` | `), not just the first.
    expect(record?.assembly).toContainEqual({
      from: 'baseq2/pak0.pak | Install/Data/baseq2/pak0.pak',
      to: 'baseq2/pak0.pak',
      found: false,
    })
    expect(record?.assembly).toContainEqual({
      from: 'q2pro.exe | q2pro64.exe',
      to: 'q2pro.exe',
      found: false,
    })
    // AC1: and the same fact said per package, which is what the card renders - every one of them
    // downloaded, none of them contributed.
    expect(
      record?.packages.map((pkg) => [pkg.id, pkg.verified, pkg.extracted, pkg.contributed]),
    ).toEqual([
      [ENGINE_PACKAGE.id, true, true, false],
      [DEMO_PACKAGE.id, true, true, false],
      [POINT_RELEASE_PACKAGE.id, true, true, false],
    ])
  })

  it('the assembly record reaches the diagnostics', async () => {
    // The healthy counterpart (post-076): every entry the fixture archives can satisfy is found,
    // and names the package whose extraction served it. The extras are on, so this also covers the
    // second assemble pass being concatenated after the first rather than replacing it.
    const box = harness()

    const { outcome, record } = await run(box, true)

    expect(outcome.status).toBe('succeeded')
    expect(record?.assembly).toContainEqual({
      from: 'baseq2/pak0.pak',
      to: 'baseq2/pak0.pak',
      found: true,
      sourcePackageId: DEMO_PACKAGE.id,
    })
    expect(record?.assembly).toContainEqual({
      from: 'q2pro.exe',
      to: 'q2pro.exe',
      found: true,
      sourcePackageId: ENGINE_PACKAGE.id,
    })
    expect(record?.assembly).toContainEqual({
      from: 'baseq2/pak2.pak',
      to: 'baseq2/pak2.pak',
      found: true,
      sourcePackageId: POINT_RELEASE_PACKAGE.id,
    })
    // An optional entry no archive carries is reported as looked-for-and-missing rather than
    // omitted - "we looked here and it wasn't there" is the half that makes the table useful.
    expect(record?.assembly).toContainEqual({
      from: 'baseq2/q2pro.menu',
      to: 'baseq2/q2pro.menu',
      found: false,
    })
    // Core pass first, extras last: the two glob dirs only exist in the second pass, and they sit
    // at the end of the one concatenated table.
    const globs = record?.assembly?.slice(-2)
    expect(globs).toEqual([
      {
        from: 'baseq2/players',
        to: 'baseq2/players',
        found: true,
        sourcePackageId: POINT_RELEASE_PACKAGE.id,
      },
      {
        from: 'baseq2/video',
        to: 'baseq2/video',
        found: true,
        sourcePackageId: POINT_RELEASE_PACKAGE.id,
      },
    ])
    // Every package served something, so every one of them says so.
    expect(record?.packages.every((pkg) => pkg.contributed === true)).toBe(true)
  })

  it("each package records its extraction's top-level entries, capped and sorted", async () => {
    // The point release gets more top-level entries than the cap allows, so both halves of AC8 are
    // exercised in one run: the ordinary packages' full listings and the capped one's flag.
    const extras = Array.from(
      { length: 25 },
      (_, index) => `extra-${String(index).padStart(2, '0')}.txt`,
    )
    const box = harness({
      contents: {
        ...FIXTURE_CONTENTS,
        [POINT_RELEASE_PACKAGE.id]: [...FIXTURE_CONTENTS[POINT_RELEASE_PACKAGE.id]!, ...extras],
      },
    })

    const { outcome, record } = await run(box)

    expect(outcome.status).toBe('succeeded')
    const byId = new Map(record?.packages.map((pkg) => [pkg.id, pkg]))
    // Top-level names only: `baseq2/gamex86_64.dll` shows up as `baseq2`, and sorted.
    expect(byId.get(ENGINE_PACKAGE.id)?.contents).toEqual(['baseq2', 'q2pro.exe'])
    expect(byId.get(ENGINE_PACKAGE.id)?.contentsTruncated).toBeUndefined()
    expect(byId.get(DEMO_PACKAGE.id)?.contents).toEqual(['baseq2'])

    const capped = byId.get(POINT_RELEASE_PACKAGE.id)
    // 27 top-level entries (`baseq2`, `ctf`, 25 extras) trimmed to the cap, in sorted order, and
    // saying that it was trimmed.
    expect(capped?.contents).toHaveLength(EXTRACTION_LISTING_CAP)
    expect(capped?.contentsTruncated).toBe(true)
    expect(capped?.contents?.slice(0, 3)).toEqual(['baseq2', 'ctf', 'extra-00.txt'])
    expect(capped?.contents).toEqual([...(capped?.contents ?? [])].sort())
  })

  it('a wrapper-nested archive is visible in its listing', async () => {
    // Story 076's real-world shape: the demo's payload sits under an `Install/Data/` wrapper. The
    // listing is top-level only, so what it shows is the wrapper itself - which is exactly the clue
    // that was missing from the 2026-09-08 report, and it is one line rather than a file tree.
    const box = harness({
      contents: { ...FIXTURE_CONTENTS, [DEMO_PACKAGE.id]: ['Install/Data/baseq2/pak0.pak'] },
    })

    const { outcome, record } = await run(box)

    expect(outcome.status).toBe('succeeded')
    const demo = record?.packages.find((pkg) => pkg.id === DEMO_PACKAGE.id)
    expect(demo?.contents).toEqual(['Install'])
    expect(demo?.contentsTruncated).toBeUndefined()
    // And the assembly table says which candidate that wrapper finally satisfied.
    expect(record?.assembly).toContainEqual({
      from: 'Install/Data/baseq2/pak0.pak',
      to: 'baseq2/pak0.pak',
      found: true,
      sourcePackageId: DEMO_PACKAGE.id,
    })
    expect(demo?.contributed).toBe(true)
  })
})
