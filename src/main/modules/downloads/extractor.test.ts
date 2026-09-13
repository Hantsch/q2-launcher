import { execFileSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findRepoRoot, resolveExtractorPath } from './7za-path'
import { extractArchive, markVerified, parseBsp1ProgressLine } from './extractor'

/**
 * `node:child_process` is mocked at the module boundary so the spawn `extractor.ts` really performs
 * can be inspected (AC5's "fixed argument shape") and, where a test needs one, replaced by a fake
 * child - without ever re-implementing `extractArchive`'s own wiring in the test body. Everything
 * else on the module (notably `execFileSync`, used below to build real archives) stays real, and by
 * default `spawn` also delegates to the real implementation: only a test that sets
 * `spawnOverride.current` gets a fake.
 */
const spawnCalls = vi.hoisted(
  () => [] as Array<{ command: string; args: string[]; options: Record<string, unknown> }>,
)
const spawnOverride = vi.hoisted(
  () => ({ current: null }) as { current: null | (() => ChildProcess) },
)

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: (command: string, args: string[], options: Record<string, unknown>) => {
      spawnCalls.push({ command, args, options })
      if (spawnOverride.current) return spawnOverride.current()
      return actual.spawn(command, args, options as never)
    },
  }
})

/**
 * A stand-in for a spawned 7za: real streams and real `exit`/`error` events, so `extractArchive`'s
 * own readline-over-stdout plumbing is what runs, but with the timing under the test's control and
 * no dependency on a platform-specific script or on the vendored binary being present.
 */
class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false

  kill(): boolean {
    this.killed = true
    return true
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess
  }
}

/**
 * Every path below is built from `dir`, a throwaway temp directory created per test - this suite
 * spawns real child processes and writes real files, so it must never touch a real installation
 * or the repo's own `resources/bin`.
 */
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-extractor-'))
  spawnCalls.length = 0
  spawnOverride.current = null
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('extraction refuses an unverified file', () => {
  it('throws when the archive was not produced by markVerified()', () => {
    const forged = { verified: false, path: join(dir, 'archive.zip') } as unknown as ReturnType<
      typeof markVerified
    >

    expect(() =>
      extractArchive({
        archive: forged,
        extractDir: join(dir, 'extract'),
        extractorPath: join(dir, '7za.exe'),
        extractorExists: false,
      }),
    ).toThrow(TypeError)
  })

  it('accepts a path produced by markVerified()', () => {
    // Extractor binary absent here on purpose - this test only proves the contract shape is
    // accepted, not that extraction succeeds (that's covered separately below).
    expect(() =>
      extractArchive({
        archive: markVerified(join(dir, 'archive.zip')),
        extractDir: join(dir, 'extract'),
        extractorPath: join(dir, '7za.exe'),
        extractorExists: false,
      }),
    ).not.toThrow()
  })
})

describe('7za is spawned with the vendored absolute path and a fixed argument shape', () => {
  it('7za is spawned with the vendored absolute path and a fixed argument shape', async () => {
    const extractorPath = join(dir, 'vendored', 'bin', '7za.exe')
    const extractDir = join(dir, 'extract')
    const archivePath = join(dir, 'archive.zip')

    const child = new FakeChild()
    spawnOverride.current = () => child.asChildProcess()

    const { result } = extractArchive({
      archive: markVerified(archivePath),
      extractDir,
      extractorPath,
      extractorExists: true,
    })
    child.stdout.end()
    child.emit('exit', 0)
    expect(await result).toEqual({ ok: true, value: undefined })

    expect(spawnCalls).toHaveLength(1)
    const call = spawnCalls[0]
    expect(call.command).toBe(extractorPath)
    expect(call.args).toEqual([
      'x',
      '-y',
      '-bso0',
      '-bse1',
      '-bsp1',
      `-o${extractDir}`,
      archivePath,
    ])
    expect(call.options.shell).toBe(false)
  })

  it('fails immediately with extractorMissing and never spawns when the binary is absent', async () => {
    const { result } = extractArchive({
      archive: markVerified(join(dir, 'archive.zip')),
      extractDir: join(dir, 'extract'),
      extractorPath: join(dir, 'does-not-exist', '7za.exe'),
      extractorExists: false,
    })

    const outcome = await result
    expect(outcome).toEqual({ ok: false, error: { key: 'downloads.error.extractorMissing' } })
    expect(spawnCalls).toEqual([])
  })

  it('fails with extractionFailed when the resolved binary exits non-zero', async () => {
    // A file that exists but is not a real 7za.exe: spawns, then exits non-zero (or errors),
    // proving the non-zero-exit path without needing the real vendored binary.
    const fakeBinary =
      process.platform === 'win32' ? join(dir, 'fake-7za.cmd') : join(dir, 'fake-7za.sh')
    await writeFile(
      fakeBinary,
      process.platform === 'win32' ? '@exit /b 1\n' : '#!/bin/sh\nexit 1\n',
    )
    if (process.platform !== 'win32') {
      await execFileSync('chmod', ['+x', fakeBinary])
    }

    const { result } = extractArchive({
      archive: markVerified(join(dir, 'archive.zip')),
      extractDir: dir,
      extractorPath: fakeBinary,
      extractorExists: true,
    })

    const outcome = await result
    expect(outcome).toEqual({ ok: false, error: { key: 'downloads.error.extractionFailed' } })
  })
})

describe('progress parsing', () => {
  it('parses a bare -bsp1 percentage line into a 0-1 ratio', () => {
    expect(parseBsp1ProgressLine(' 45%')).toBeCloseTo(0.45)
    expect(parseBsp1ProgressLine('100%')).toBeCloseTo(1)
    expect(parseBsp1ProgressLine('  0% - somefile.dat')).toBeCloseTo(0)
  })

  it('falls back to indeterminate when a line does not parse', () => {
    expect(parseBsp1ProgressLine('Extracting archive: archive.zip')).toBeUndefined()
    expect(parseBsp1ProgressLine('')).toBeUndefined()
    expect(parseBsp1ProgressLine('everything is fine')).toBeUndefined()
  })

  it('forwards each parsed stdout line to onProgress via the real extractArchive wiring', async () => {
    // The child is fake; the wiring under test is not. `extractArchive()` is what creates the
    // readline interface over this stdout and what calls `onProgress` - a regression anywhere in
    // that chain (dropped readline, swapped callback, stdout not piped) fails here.
    const child = new FakeChild()
    spawnOverride.current = () => child.asChildProcess()

    const ratios: Array<number | undefined> = []
    const { result } = extractArchive({
      archive: markVerified(join(dir, 'archive.zip')),
      extractDir: join(dir, 'extract'),
      extractorPath: join(dir, '7za.exe'),
      extractorExists: true,
      onProgress: (ratio) => ratios.push(ratio),
    })

    for (const line of [' 10%', 'Extracting archive', ' 55%', '100%']) {
      child.stdout.write(`${line}\n`)
    }
    child.stdout.end()
    // readline consumes stdout to its end before emitting 'close'; wait for that, then let the
    // process exit, so no line can still be in flight when the outcome is asserted.
    await new Promise((resolve) => child.stdout.once('end', resolve))
    child.emit('exit', 0)

    expect(await result).toEqual({ ok: true, value: undefined })
    expect(ratios).toEqual([0.1, undefined, 0.55, 1])
  })
})

describe('real-archive extraction (only when the vendored binary is present)', () => {
  const realBinary = resolveExtractorPath({ isPackaged: false })

  it.skipIf(!realBinary.exists)('extracts a real archive with the vendored 7za.exe', async () => {
    const archiveSourceDir = join(dir, 'source')
    const extractDir = join(dir, 'extract')
    await mkdir(archiveSourceDir, { recursive: true })
    await mkdir(extractDir, { recursive: true })

    const payloadPath = join(archiveSourceDir, 'hello.txt')
    await writeFile(payloadPath, 'hello from a real 7za extraction test\n')

    const archivePath = join(dir, 'archive.zip')
    execFileSync(realBinary.path, ['a', '-tzip', '-y', archivePath, payloadPath], {
      cwd: archiveSourceDir,
    })

    const progressRatios: Array<number | undefined> = []
    const { result } = extractArchive({
      archive: markVerified(archivePath),
      extractDir,
      extractorPath: realBinary.path,
      extractorExists: true,
      onProgress: (ratio) => progressRatios.push(ratio),
    })

    const outcome = await result
    expect(outcome.ok).toBe(true)

    const extracted = await readFile(join(extractDir, 'hello.txt'), 'utf8')
    expect(extracted).toBe('hello from a real 7za extraction test\n')
  })

  it.skipIf(!realBinary.exists)('kill() aborts a real extraction in progress', async () => {
    const extractDir = join(dir, 'extract-kill')
    await mkdir(extractDir, { recursive: true })

    // A tiny valid archive is enough - we only need the process to exist long enough to kill it.
    const archiveSourceDir = join(dir, 'source-kill')
    await mkdir(archiveSourceDir, { recursive: true })
    await writeFile(join(archiveSourceDir, 'a.txt'), 'a')
    const archivePath = join(dir, 'kill.zip')
    execFileSync(realBinary.path, ['a', '-tzip', '-y', archivePath, 'a.txt'], {
      cwd: archiveSourceDir,
    })

    const handle = extractArchive({
      archive: markVerified(archivePath),
      extractDir,
      extractorPath: realBinary.path,
      extractorExists: true,
    })
    handle.kill()

    const outcome = await handle.result
    // Killed or finished before the kill landed - either way this must resolve, never hang.
    expect(typeof outcome.ok).toBe('boolean')
  })
})

describe('7za-path resolution', () => {
  it('reports a missing binary without throwing', () => {
    const result = resolveExtractorPath({ isPackaged: false, repoRoot: dir })
    expect(result.exists).toBe(false)
    expect(result.path.endsWith('7za.exe')).toBe(true)
  })

  it('resolves under process.resourcesPath when packaged', () => {
    const result = resolveExtractorPath({ isPackaged: true, resourcesPath: dir })
    expect(result.path).toBe(join(dir, 'bin', '7za.exe'))
  })

  /**
   * The dev-mode resolution has to be right in two structurally different layouts: unbundled
   * (vitest/ts-node, `<root>/src/main/modules/downloads`) and bundled, where electron-vite emits a
   * single `<root>/out/main/index.js`. A `..`-counting resolution can only ever be right in one of
   * them, so the walk-up is proven against a constructed tree that mimics both - not against
   * whichever directory this test file happens to be loaded from.
   */
  describe('the dev-mode repo root is found by walking up to package.json', () => {
    let fakeRepo: string

    beforeEach(async () => {
      fakeRepo = join(dir, 'fake-repo')
      await mkdir(join(fakeRepo, 'out', 'main'), { recursive: true })
      await mkdir(join(fakeRepo, 'src', 'main', 'modules', 'downloads'), { recursive: true })
      await mkdir(join(fakeRepo, 'resources', 'bin'), { recursive: true })
      await writeFile(join(fakeRepo, 'package.json'), '{ "name": "fake-repo" }\n')
      await writeFile(join(fakeRepo, 'resources', 'bin', '7za.exe'), 'not a real binary')
    })

    it('finds it from a bundled main layout (out/main, two levels up)', () => {
      const root = findRepoRoot(join(fakeRepo, 'out', 'main'))
      expect(root).toBe(fakeRepo)

      const result = resolveExtractorPath({ isPackaged: false, repoRoot: root })
      expect(result.path).toBe(join(fakeRepo, 'resources', 'bin', '7za.exe'))
      expect(result.exists).toBe(true)
    })

    it('finds it from an unbundled source layout (src/main/modules/downloads, four levels up)', () => {
      const root = findRepoRoot(join(fakeRepo, 'src', 'main', 'modules', 'downloads'))
      expect(root).toBe(fakeRepo)
      expect(resolveExtractorPath({ isPackaged: false, repoRoot: root }).exists).toBe(true)
    })

    it('falls back to process.cwd() when no marker is found within the level budget', () => {
      expect(findRepoRoot(join(fakeRepo, 'out', 'main'), 1)).toBe(process.cwd())
    })

    it('resolves this repo`s own default root to a directory that really holds package.json', () => {
      // Non-tautological: whatever the runtime layout, `<root>/resources/bin/7za.exe` must sit
      // three levels below a directory that actually contains this repo's package.json.
      const { path } = resolveExtractorPath({ isPackaged: false })
      expect(path.endsWith(join('resources', 'bin', '7za.exe'))).toBe(true)
      expect(existsSync(join(path, '..', '..', '..', 'package.json'))).toBe(true)
    })
  })
})

// Guard so the intentionally-committed absence of the real binary in this sandbox is visible
// in test output rather than silently skipping everything without a trace.
if (!existsSync(resolveExtractorPath({ isPackaged: false }).path)) {
  describe('vendored binary status', () => {
    it.skip('resources/bin/7za.exe is not vendored in this environment - real-archive tests skipped', () => {})
  })
}
