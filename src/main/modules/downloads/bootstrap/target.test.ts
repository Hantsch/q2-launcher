import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeTargetVerdict, MAX_TARGET_VERDICT_ENTRIES } from './target'

/**
 * Story 074 D2. Covers the four scenarios the acceptance criterion names: a `ProgramFiles`-
 * prefixed path, a non-empty folder (`entries` populated and capped), a folder holding a `baseq2`
 * with paks (blocked as `alreadyInstalled`), and a plain empty target (all false/empty). Real temp
 * dirs throughout - same fixture style as `cache.test.ts`.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-target-verdict-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('computeTargetVerdict', () => {
  it('an empty, writable, non-Program-Files target verdicts all-clear', async () => {
    const target = join(dir, 'fresh-target')
    await mkdir(target, { recursive: true })

    const verdict = await computeTargetVerdict(target, { env: {}, protectedDirs: [] })

    expect(verdict).toEqual({
      targetPath: target,
      programFiles: false,
      notWritable: false,
      entries: [],
      alreadyInstalled: false,
      blocked: false,
    })
  })

  it('a target that does not exist yet is still writable, via its nearest existing ancestor', async () => {
    const target = join(dir, 'does-not-exist-yet')

    const verdict = await computeTargetVerdict(target, { env: {}, protectedDirs: [] })

    expect(verdict.notWritable).toBe(false)
    expect(verdict.entries).toEqual([])
    expect(verdict.alreadyInstalled).toBe(false)
    expect(verdict.blocked).toBe(false)
  })

  it('a path prefixed with a fake ProgramFiles env value verdicts programFiles: true', async () => {
    const programFilesRoot = join(dir, 'Program Files')
    const target = join(programFilesRoot, 'Quake II')
    await mkdir(target, { recursive: true })

    const verdict = await computeTargetVerdict(target, {
      env: { ProgramFiles: programFilesRoot },
      protectedDirs: [],
    })

    expect(verdict.programFiles).toBe(true)
    // Program Files is expected to be unwritable without elevation, but that alone never blocks -
    // the remedy flow (a later deliverable) is what deals with it.
    expect(verdict.blocked).toBe(false)
  })

  it('the ProgramFiles(x86) variant also matches, and case-insensitively', async () => {
    const programFilesX86 = join(dir, 'Program Files (x86)')
    const target = join(programFilesX86, 'Quake II')
    await mkdir(target, { recursive: true })

    const verdict = await computeTargetVerdict(target.toUpperCase(), {
      env: { 'ProgramFiles(x86)': programFilesX86 },
      protectedDirs: [],
    })

    expect(verdict.programFiles).toBe(true)
  })

  it('a folder containing files reports them in entries, capped at MAX_TARGET_VERDICT_ENTRIES', async () => {
    const target = join(dir, 'cluttered')
    await mkdir(target, { recursive: true })
    const fileCount = MAX_TARGET_VERDICT_ENTRIES + 5
    for (let i = 0; i < fileCount; i++) {
      await writeFile(join(target, `file-${String(i).padStart(2, '0')}.txt`), '')
    }

    const verdict = await computeTargetVerdict(target, { env: {}, protectedDirs: [] })

    expect(verdict.entries).toHaveLength(MAX_TARGET_VERDICT_ENTRIES)
    expect(verdict.alreadyInstalled).toBe(false)
    // Merely non-empty is a warning only, never blocking on its own.
    expect(verdict.blocked).toBe(false)
  })

  it('a folder holding a baseq2 with paks is alreadyInstalled and blocked', async () => {
    const target = join(dir, 'existing-install')
    const baseq2 = join(target, 'baseq2')
    await mkdir(baseq2, { recursive: true })
    // inspectInstallation only needs pak0.pak to exist to consider base-game-dir satisfied; its
    // size just decides warn-vs-not, which does not affect "already installed".
    await writeFile(join(baseq2, 'pak0.pak'), Buffer.alloc(1024))

    const verdict = await computeTargetVerdict(target, { env: {}, protectedDirs: [] })

    expect(verdict.alreadyInstalled).toBe(true)
    expect(verdict.blocked).toBe(true)
    expect(verdict.blockedReason).toBe('alreadyInstalled')
  })

  it('a relative path is blocked as an unsafe path', async () => {
    const verdict = await computeTargetVerdict('relative/path', { env: {}, protectedDirs: [] })

    expect(verdict.blocked).toBe(true)
    expect(verdict.blockedReason).toBe('unsafePath')
  })

  it('a Windows device path is blocked as an unsafe path', async () => {
    const verdict = await computeTargetVerdict('\\\\.\\PhysicalDrive0', {
      env: {},
      protectedDirs: [],
    })

    expect(verdict.blocked).toBe(true)
    expect(verdict.blockedReason).toBe('unsafePath')
  })

  it('a reserved device name is blocked as an unsafe path', async () => {
    const target = join(dir, 'NUL')

    const verdict = await computeTargetVerdict(target, { env: {}, protectedDirs: [] })

    expect(verdict.blocked).toBe(true)
    expect(verdict.blockedReason).toBe('unsafePath')
  })

  it('a target inside a protected (the launcher own install) directory is blocked as unsafe', async () => {
    const appDir = join(dir, 'app-install')
    const target = join(appDir, 'resources', 'some-target')
    await mkdir(target, { recursive: true })

    const verdict = await computeTargetVerdict(target, {
      env: {},
      protectedDirs: [join(appDir, 'resources')],
    })

    expect(verdict.blocked).toBe(true)
    expect(verdict.blockedReason).toBe('unsafePath')
  })
})
