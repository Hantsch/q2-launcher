import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stubPlatform } from '../../../../test-support/platform'
import { computeTargetVerdict, MAX_TARGET_VERDICT_ENTRIES, proposeBootstrapTarget } from './target'

/**
 * Story 074 D2. Covers the four scenarios the acceptance criterion names: a `ProgramFiles`-
 * prefixed path, a non-empty folder (`entries` populated and capped), a folder holding a `baseq2`
 * with paks (blocked as `alreadyInstalled`), and a plain empty target (all false/empty). Real temp
 * dirs throughout - same fixture style as `cache.test.ts`.
 */

let dir: string

beforeEach(async () => {
  // `realpath` on purpose: `computeTargetVerdict` canonicalizes the path it is handed, and on a CI
  // Windows runner `tmpdir()` comes back as an 8.3 short path (`C:\Users\RUNNER~1\...`) that
  // canonicalizing expands. Without this, the fixture paths this test compares against (expected
  // `targetPath`, the fake `ProgramFiles` roots, `protectedDirs`) would be the short form while the
  // verdict carries the long one, and the prefix checks would never match.
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-target-verdict-')))
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
    // Case-insensitive matching (`pathKey`, fs-utils.ts) is itself a Windows/macOS filesystem
    // property Linux does not share - `stubPlatform` proves the Windows behaviour this test
    // names, rather than asserting something only ever true by accident of the host running it.
    const restore = stubPlatform('win32')
    try {
      const programFilesX86 = join(dir, 'Program Files (x86)')
      const target = join(programFilesX86, 'Quake II')
      await mkdir(target, { recursive: true })

      const verdict = await computeTargetVerdict(target.toUpperCase(), {
        env: { 'ProgramFiles(x86)': programFilesX86 },
        protectedDirs: [],
      })

      expect(verdict.programFiles).toBe(true)
    } finally {
      restore()
    }
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

describe('proposeBootstrapTarget', () => {
  async function filledParent(): Promise<string> {
    const parent = join(dir, 'games')
    await mkdir(parent, { recursive: true })
    await writeFile(join(parent, 'other.txt'), 'x')
    return parent
  }

  it('proposes a subfolder named after the installation', async () => {
    const parent = await filledParent()

    const proposal = await proposeBootstrapTarget(parent, 'My Quake II', { userTyped: false })

    expect(proposal).toEqual({
      targetPath: join(parent, 'My Quake II'),
      folderName: 'My Quake II',
      installHere: false,
    })
  })

  it('a non-empty existing subfolder gets a free name', async () => {
    const parent = await filledParent()
    await mkdir(join(parent, 'Quake'), { recursive: true })
    await writeFile(join(parent, 'Quake', 'a.txt'), 'x')
    await writeFile(join(parent, 'Quake (2)'), 'a file blocks the name too')

    const proposal = await proposeBootstrapTarget(parent, 'Quake', { userTyped: false })

    expect(proposal.folderName).toBe('Quake (3)')
    expect(proposal.targetPath).toBe(join(parent, 'Quake (3)'))
  })

  it('an existing empty subfolder is reused', async () => {
    const parent = await filledParent()
    await mkdir(join(parent, 'Quake'), { recursive: true })

    const proposal = await proposeBootstrapTarget(parent, 'Quake', { userTyped: false })

    expect(proposal.folderName).toBe('Quake')
  })

  it('a typed folder name is not renumbered', async () => {
    const parent = await filledParent()
    await mkdir(join(parent, 'Quake'), { recursive: true })
    await writeFile(join(parent, 'Quake', 'a.txt'), 'x')

    const proposal = await proposeBootstrapTarget(parent, 'Quake', { userTyped: true })

    expect(proposal.folderName).toBe('Quake')
    expect(proposal.installHere).toBe(false)
  })

  it('an empty or missing parent installs right here', async () => {
    const empty = join(dir, 'empty')
    await mkdir(empty, { recursive: true })
    const missing = join(dir, 'missing')

    for (const parent of [empty, missing]) {
      expect(await proposeBootstrapTarget(parent, 'Quake', { userTyped: false })).toEqual({
        targetPath: parent,
        folderName: '',
        installHere: true,
      })
    }
  })

  it('a not-yet-existing subfolder under Program Files is warned', async () => {
    const programFilesRoot = join(dir, 'Program Files')
    await mkdir(programFilesRoot, { recursive: true })
    await writeFile(join(programFilesRoot, 'other.txt'), 'x')
    const proposal = await proposeBootstrapTarget(programFilesRoot, 'Quake', { userTyped: false })

    const verdict = await computeTargetVerdict(proposal.targetPath, {
      env: { ProgramFiles: programFilesRoot },
      protectedDirs: [],
    })

    expect(verdict.programFiles).toBe(true)
    expect(verdict.blocked).toBe(false)
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a subfolder of a non-writable parent is not writable',
    async () => {
      const parent = join(dir, 'readonly')
      await mkdir(parent, { recursive: true })
      await writeFile(join(parent, 'other.txt'), 'x')
      await chmod(parent, 0o555)
      try {
        const proposal = await proposeBootstrapTarget(parent, 'Quake', { userTyped: false })

        const verdict = await computeTargetVerdict(proposal.targetPath, {
          env: {},
          protectedDirs: [],
        })

        expect(verdict.notWritable).toBe(true)
      } finally {
        await chmod(parent, 0o755)
      }
    },
  )

  it('the final path of a registered installation is blocked', async () => {
    const parent = await filledParent()
    const baseq2 = join(parent, 'Quake', 'baseq2')
    await mkdir(baseq2, { recursive: true })
    await writeFile(join(baseq2, 'pak0.pak'), Buffer.alloc(1024))

    const proposal = await proposeBootstrapTarget(parent, 'Quake', { userTyped: true })
    const verdict = await computeTargetVerdict(proposal.targetPath, { env: {}, protectedDirs: [] })

    expect(verdict.blockedReason).toBe('alreadyInstalled')
  })
})
