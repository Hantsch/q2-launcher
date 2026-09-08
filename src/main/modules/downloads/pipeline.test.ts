import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PackageSource } from '@shared/modules/downloads'
import { fail, ok, type Job, type Outcome } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { JobsService } from '../../services/jobs'
import type { DownloadPackageResult } from './fetcher'
import {
  createDownloadPipeline,
  DOWNLOAD_JOB_KIND,
  DOWNLOAD_JOB_LABEL_KEY,
  getExtractDir,
  type DownloadFn,
  type DownloadPipelineDeps,
  type ExtractFn,
} from './pipeline'
import { PART_SUFFIX } from './paths'

/**
 * Story 071 D4, AC1 and AC6.
 *
 * Everything about the *job* is observed the way the renderer would see it: through a real
 * `JobsService` and the snapshots it emits. Nothing here asks the pipeline what it thinks its
 * status is - it has no such field, which is the point of AC1 ("no parallel progress mechanism").
 *
 * The cancel test (AC6) runs the **real** fetcher against a real `node:http` server on
 * `127.0.0.1` with a real temp `userData`, so the abort travels the actual signal chain
 * (`JobsService.cancel()` -> the job's `onCancel` -> the `AbortController` this pipeline owns ->
 * `downloadPackage`'s reader) and the `.part` file it has to remove is a real file with real
 * bytes in it. The extractor is the one thing faked there: D3's `extractArchive` spawns a
 * vendored `7za.exe` that is not in this checkout (`resources/bin/` holds only a README), and the
 * property under test is the *pipeline's* cleanup of `extract/<jobId>/`, not 7-Zip's. So the fake
 * extractor is given the real `ExtractFn` shape and writes real files into the real extract
 * directory - the cleanup is then proven against files on disk, not against a mock's call log.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let dir: string
let server: Server
let origin: string
const routes = new Map<string, Handler>()
const openResponses = new Set<ServerResponse>()

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-pipeline-'))
  routes.clear()
  openResponses.clear()

  server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    openResponses.add(res)
    res.on('close', () => openResponses.delete(res))
    const handler = routes.get(pathname)
    if (handler === undefined) {
      res.statusCode = 404
      res.end('no such route')
      return
    }
    handler(req, res)
  })
  server.keepAliveTimeout = 50
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  for (const res of openResponses) res.destroy()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function route(pathname: string, handler: Handler): string {
  routes.set(pathname, handler)
  return `${origin}${pathname}`
}

/** Serves `body` in one go with a truthful `content-length`. */
function serves(body: Buffer): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-length': String(body.byteLength) })
    res.end(body)
  }
}

/** Serves `body` in `chunkSize` pieces `gapMs` apart - slow enough to be cancelled mid-flight. */
function trickles(body: Buffer, chunkSize: number, gapMs: number): Handler {
  return (_req, res) => {
    res.writeHead(200)
    let offset = 0
    const push = (): void => {
      if (res.destroyed) return
      if (offset >= body.byteLength) {
        res.end()
        return
      }
      res.write(body.subarray(offset, offset + chunkSize))
      offset += chunkSize
      setTimeout(push, gapMs)
    }
    setTimeout(push, gapMs)
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function pkg(overrides: Partial<PackageSource> = {}): PackageSource {
  return {
    fileName: 'package.zip',
    url: 'http://127.0.0.1:1/unused.zip',
    mirrors: [],
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
    ...overrides,
  }
}

function finalPath(fileName: string): string {
  return join(dir, 'cache', 'downloads', fileName)
}

/** A `download` that succeeds after reporting two progress steps, without touching the network. */
function downloadSucceeds(fileName = 'package.zip'): DownloadFn {
  return (source, options) => {
    options.onProgress?.({ url: source.url, receivedBytes: 512, totalBytes: 1024 })
    options.onProgress?.({ url: source.url, receivedBytes: 1024, totalBytes: 1024 })
    return Promise.resolve({
      ok: true,
      path: finalPath(fileName),
      sizeBytes: 1024,
      sha256: source.sha256,
      url: source.url,
      attempts: [],
    })
  }
}

/** An `extract` that succeeds after reporting a ratio and an unparsable (indeterminate) line. */
function extractSucceeds(): ExtractFn {
  return (input) => {
    input.onProgress?.(0.5)
    input.onProgress?.(undefined)
    return { result: Promise.resolve(ok(undefined)), kill: () => {} }
  }
}

interface Recorder {
  jobs: JobsService
  /** One entry per emitted change, for the single job under test. */
  states: Array<{ status: Job['status']; ratio: number | null }>
  job(): Job | undefined
}

function recorder(): Recorder {
  const states: Array<{ status: Job['status']; ratio: number | null }> = []
  const jobs = new JobsService((list) => {
    const job = list[list.length - 1]
    if (job) states.push({ status: job.status, ratio: job.progress.ratio })
  })
  return { jobs, states, job: () => jobs.list()[0] }
}

function pipelineWith(
  jobs: JobsService,
  overrides: Partial<DownloadPipelineDeps> = {},
): ReturnType<typeof createDownloadPipeline> {
  return createDownloadPipeline({
    getJobs: () => jobs,
    getUserDataPath: () => dir,
    getConcurrency: () => 2,
    resolveExtractor: () => ({ path: join(dir, 'bin', '7za.exe'), exists: true }),
    download: downloadSucceeds(),
    extract: extractSucceeds(),
    ...overrides,
  })
}

async function waitFor(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('the downloads pipeline', () => {
  it('a download runs as one job created through JobsService', async () => {
    const { jobs, states, job } = recorder()
    const pipeline = pipelineWith(jobs)

    const started = pipeline.start(pkg({ fileName: 'package.zip' }))
    const outcome = await started.settled

    // Exactly one job, created through the shell's service, carrying an i18n key and no prose.
    expect(jobs.list()).toHaveLength(1)
    const only = job()!
    expect(only.id).toBe(started.jobId)
    expect(only.moduleId).toBe('downloads')
    expect(only.kind).toBe(DOWNLOAD_JOB_KIND)
    expect(only.labelKey).toBe(DOWNLOAD_JOB_LABEL_KEY)
    expect(only.labelParams).toEqual({ name: 'package.zip' })
    expect(only.cancellable).toBe(true)
    expect(only.status).toBe('succeeded')
    expect(only.error).toBeUndefined()

    // The whole life of the job, as the renderer sees it: created `queued`, moved to `running`
    // by the queue's admission (before the first byte), then a ratio from the download phase AND
    // one from the extract phase - `undefined` from the extractor arriving as the indeterminate
    // `null` - and finally `succeeded`. Nothing else reports anything anywhere.
    expect(states).toEqual([
      { status: 'queued', ratio: null },
      { status: 'running', ratio: null },
      { status: 'running', ratio: 0.5 },
      { status: 'running', ratio: 1 },
      { status: 'running', ratio: 0.5 },
      { status: 'running', ratio: null },
      { status: 'succeeded', ratio: null },
    ])

    expect(outcome).toEqual({
      status: 'succeeded',
      archivePath: finalPath('package.zip'),
      extractDir: getExtractDir(dir, started.jobId),
    })
    // The extract directory really was created before the extractor was called - 7za is spawned
    // with it as its cwd, so a missing directory would be a failed spawn in production.
    expect(await pathExists(getExtractDir(dir, started.jobId))).toBe(true)
  })

  it('cancelling removes the partial download and the extraction output', async () => {
    // --- Half one: cancelled while bytes are still arriving. Real server, real fetcher. ---
    const body = randomBytes(64 * 1024)
    const url = route('/slow.zip', trickles(body, 2048, 25))
    const { jobs } = recorder()
    let extractCalls = 0

    const pipeline = pipelineWith(jobs, {
      download: undefined,
      fetchImpl: (target, init) => fetch(target, init),
      extract: (input) => {
        extractCalls += 1
        return extractSucceeds()(input)
      },
    })

    const source = pkg({
      fileName: 'partial.zip',
      url,
      sizeBytes: body.byteLength,
      sha256: sha256(body),
    })
    const started = pipeline.start(source)
    const partial = `${finalPath('partial.zip')}${PART_SUFFIX}`

    // Cancel only once real bytes are on disk, so there is genuinely a partial file to remove.
    await waitFor(
      async () => (await pathExists(partial)) && (await readFile(partial)).byteLength > 0,
      'the .part file to hold bytes',
    )
    expect(jobs.list()[0].status).toBe('running')

    expect(jobs.cancel(started.jobId).ok).toBe(true)
    expect(await started.settled).toEqual({ status: 'cancelled' })

    // The job is cancelled and *stays* cancelled: a late progress callback from the aborting
    // reader must not flip it back to `running`, where it would hang forever.
    expect(jobs.list()[0].status).toBe('cancelled')
    // The partial download is gone, nothing was promoted into the cache, and extraction of a file
    // that was never verified never even started.
    expect(await pathExists(partial)).toBe(false)
    expect(await pathExists(finalPath('partial.zip'))).toBe(false)
    expect(await pathExists(getExtractDir(dir, started.jobId))).toBe(false)
    expect(extractCalls).toBe(0)

    // --- Half two: cancelled while extracting, with real files already written. ---
    const good = randomBytes(8 * 1024)
    const goodUrl = route('/good.zip', serves(good))
    const written = deferred<void>()
    const result = deferred<Outcome<void>>()
    let killed = false

    const extracting = pipelineWith(jobs, {
      download: undefined,
      fetchImpl: (target, init) => fetch(target, init),
      extract: (input) => {
        input.onProgress?.(0.25)
        void (async () => {
          await mkdir(join(input.extractDir, 'baseq2'), { recursive: true })
          await writeFile(join(input.extractDir, 'baseq2', 'pak0.pak'), 'half a pak file')
          written.resolve()
        })()
        return {
          result: result.promise,
          kill: () => {
            killed = true
            // What a killed 7za produces: a non-zero exit, i.e. a failed extraction.
            result.resolve(fail('downloads.error.extractionFailed'))
          },
        }
      },
    })

    const secondSource = pkg({
      fileName: 'extracted.zip',
      url: goodUrl,
      sizeBytes: good.byteLength,
      sha256: sha256(good),
    })
    const second = extracting.start(secondSource)
    const extractDir = getExtractDir(dir, second.jobId)

    await written.promise
    expect(await pathExists(join(extractDir, 'baseq2', 'pak0.pak'))).toBe(true)

    expect(jobs.cancel(second.jobId).ok).toBe(true)
    expect(await second.settled).toEqual({ status: 'cancelled' })

    expect(killed).toBe(true)
    const secondJob = jobs.list().find((entry) => entry.id === second.jobId)!
    expect(secondJob.status).toBe('cancelled')
    // The partially extracted output is gone, directory and all...
    expect(await pathExists(extractDir)).toBe(false)
    // ...while the *verified* archive stays in the cache: AC6 is about partial artefacts, and the
    // cache is the point (Decisions (Sprint), "Paths").
    expect(await readFile(finalPath('extracted.zip'))).toEqual(good)
  })

  it('a cancel that arrives between the finished download and the extraction never extracts', async () => {
    const { jobs } = recorder()
    const gate = deferred<void>()
    let extractCalls = 0

    const pipeline = pipelineWith(jobs, {
      // A download that has already produced its verified file, but whose promise resolves only
      // after the test has cancelled - the exact race the story leaves implicit.
      download: async (source, options) => {
        options.onProgress?.({ url: source.url, receivedBytes: 1024, totalBytes: 1024 })
        await gate.promise
        return {
          ok: true,
          path: finalPath('raced.zip'),
          sizeBytes: 1024,
          sha256: source.sha256,
          url: source.url,
          attempts: [],
        } satisfies DownloadPackageResult
      },
      extract: (input) => {
        extractCalls += 1
        return extractSucceeds()(input)
      },
    })

    const started = pipeline.start(pkg({ fileName: 'raced.zip' }))
    await waitFor(() => jobs.list()[0]?.status === 'running', 'the job to be admitted')

    jobs.cancel(started.jobId)
    gate.resolve()

    expect(await started.settled).toEqual({ status: 'cancelled' })
    expect(jobs.list()[0].status).toBe('cancelled')
    expect(extractCalls).toBe(0)
    // Not even the extract directory was created, so there is nothing to clean up later.
    expect(await pathExists(getExtractDir(dir, started.jobId))).toBe(false)
  })

  it('a job cancelled while it is still queued never starts at all', async () => {
    const { jobs } = recorder()
    const gate = deferred<void>()
    const downloaded: string[] = []

    const pipeline = pipelineWith(jobs, {
      getConcurrency: () => 1,
      download: async (source, options) => {
        downloaded.push(source.fileName)
        options.onProgress?.({ url: source.url, receivedBytes: 1024, totalBytes: 1024 })
        if (source.fileName === 'first.zip') await gate.promise
        return {
          ok: true,
          path: finalPath(source.fileName),
          sizeBytes: 1024,
          sha256: source.sha256,
          url: source.url,
          attempts: [],
        } satisfies DownloadPackageResult
      },
    })

    const first = pipeline.start(pkg({ fileName: 'first.zip' }))
    const second = pipeline.start(pkg({ fileName: 'second.zip' }))

    // The limit is 1, so the second job is created but not admitted: it is `queued`, and its work
    // has not run.
    const queued = jobs.list().find((entry) => entry.id === second.jobId)!
    expect(queued.status).toBe('queued')
    expect(downloaded).toEqual(['first.zip'])

    expect(jobs.cancel(second.jobId).ok).toBe(true)
    expect(await second.settled).toEqual({ status: 'cancelled' })

    // Releasing the running job frees the slot - and the cancelled one still never runs, rather
    // than starting a download nobody is waiting for any more.
    gate.resolve()
    expect(await first.settled).toMatchObject({ status: 'succeeded' })
    await waitFor(() => jobs.list().every((entry) => entry.status !== 'running'), 'all jobs to end')

    expect(downloaded).toEqual(['first.zip'])
    expect(jobs.list().find((entry) => entry.id === second.jobId)!.status).toBe('cancelled')
    expect(await pathExists(getExtractDir(dir, second.jobId))).toBe(false)
  })

  it('a failed download ends the job with its i18n key, not as a cancellation', async () => {
    const { jobs } = recorder()
    let extractCalls = 0

    const pipeline = pipelineWith(jobs, {
      download: () =>
        Promise.resolve({
          ok: false,
          key: 'downloads.error.allMirrorsFailed',
          reason: 'all 2 URL(s) failed, last: http://example.invalid: HTTP 404',
          cancelled: false,
          attempts: [],
        }),
      extract: (input) => {
        extractCalls += 1
        return extractSucceeds()(input)
      },
    })

    const started = pipeline.start(pkg())
    expect(await started.settled).toEqual({
      status: 'failed',
      key: 'downloads.error.allMirrorsFailed',
    })

    const job = jobs.list()[0]
    expect(job.status).toBe('failed')
    expect(job.error).toEqual({ key: 'downloads.error.allMirrorsFailed' })
    // A key, not the prose reason - that stays in the log (CLAUDE.md: main sends keys).
    expect(job.error!.key).not.toMatch(/\s/)
    expect(extractCalls).toBe(0)
  })

  it('a missing extractor fails the job through the real extractor and leaves no output', async () => {
    const { jobs } = recorder()
    // The real `extractArchive` (no `extract` override), told the vendored binary is absent -
    // which is the case in this checkout, where `resources/bin/` holds only a README.
    const pipeline = pipelineWith(jobs, {
      extract: undefined,
      resolveExtractor: () => ({ path: join(dir, 'bin', '7za.exe'), exists: false }),
    })

    const started = pipeline.start(pkg())
    expect(await started.settled).toEqual({
      status: 'failed',
      key: 'downloads.error.extractorMissing',
    })

    expect(jobs.list()[0].error).toEqual({ key: 'downloads.error.extractorMissing' })
    expect(await pathExists(getExtractDir(dir, started.jobId))).toBe(false)
  })
})
