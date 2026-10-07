import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stubPlatform } from '../../test-support/platform'
import {
  dirReadFailureReason,
  hashFile,
  isInside,
  listDir,
  listFilesRecursive,
  looksExecutable,
  readBinaryArch,
  readBinaryKind,
} from './fs-utils'

/**
 * Story 100 D3, AC3. `looksExecutable` decides what `inspectInstallation` offers as the client
 * executable, so these run against real files in a real temp dir - a mocked `stat` would prove
 * nothing about the execute bit, which is the whole point of the non-Windows branch.
 *
 * Windows' `stat` never reports execute bits (libuv derives `st_mode` from the read-only
 * attribute alone, so `chmod(path, 0o755)` there leaves `mode & 0o111 === 0`). The cases that
 * need a genuinely `+x` file are therefore skipped on a Windows host and proven by the
 * `ubuntu-latest` CI leg (story 100 D1); everything that only needs a *non*-executable file, and
 * every stubbed-Windows case, runs on either host.
 */
const HOST_REPORTS_EXECUTE_BITS = process.platform !== 'win32'

let dir: string
let restorePlatform: (() => void) | undefined

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-fs-utils-')))
})

afterEach(async () => {
  restorePlatform?.()
  restorePlatform = undefined
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/**
 * The Quake II root of the acceptance criterion: three extension-less files that are not
 * programs, one extension-less file that is, and a game directory - which is not a file at all.
 */
async function writeLinuxShapedRoot(): Promise<string> {
  const root = join(dir, 'q2pro-linux')
  await mkdir(join(root, 'baseq2'), { recursive: true })
  for (const name of ['README', 'LICENSE', 'CHANGELOG']) {
    await writeFile(join(root, name), `${name} text`)
  }
  await writeFile(join(root, 'q2pro'), 'ELF stand-in')
  await chmod(join(root, 'q2pro'), 0o755)
  return root
}

/** What `rankExecutables` offers, minus the ranking: the root's entries that look executable. */
async function executablesIn(root: string): Promise<string[]> {
  const listing = await listDir(root)
  const found: string[] = []
  for (const name of listing.names) {
    if (await looksExecutable(root, name)) found.push(name)
  }
  return found
}

describe('looksExecutable', () => {
  it.skipIf(!HOST_REPORTS_EXECUTE_BITS)(
    'off Windows only a file with an execute bit is an executable',
    async () => {
      const root = await writeLinuxShapedRoot()
      restorePlatform = stubPlatform('linux')

      expect(await looksExecutable(root, 'q2pro')).toBe(true)
      expect(await looksExecutable(root, 'README')).toBe(false)
      // A directory carries `+x` too, and must never be offered as a program.
      expect(await looksExecutable(root, 'baseq2')).toBe(false)
      expect(await looksExecutable(root, 'does-not-exist')).toBe(false)

      expect(await executablesIn(root)).toEqual(['q2pro'])
    },
  )

  it('README and LICENSE in a Quake II root are not offered as engines', async () => {
    const root = await writeLinuxShapedRoot()
    restorePlatform = stubPlatform('linux')

    const executables = await executablesIn(root)
    expect(executables).not.toContain('README')
    expect(executables).not.toContain('LICENSE')
    expect(executables).not.toContain('CHANGELOG')
  })

  it('on Windows the same root offers nothing, because nothing is a .exe', async () => {
    const root = await writeLinuxShapedRoot()
    restorePlatform = stubPlatform('win32')

    expect(await executablesIn(root)).toEqual([])
    expect(await looksExecutable(root, 'q2pro')).toBe(false)
  })

  it('on Windows a root with q2pro.exe still offers it, execute bit or not', async () => {
    const root = join(dir, 'q2pro-windows')
    await mkdir(join(root, 'baseq2'), { recursive: true })
    await writeFile(join(root, 'README'), 'README text')
    await writeFile(join(root, 'q2pro.exe'), 'PE stand-in')
    restorePlatform = stubPlatform('win32')

    expect(await looksExecutable(root, 'q2pro.exe')).toBe(true)
    expect(await executablesIn(root)).toEqual(['q2pro.exe'])
  })
})

interface ContainmentCase {
  title: string
  root: string
  target: string
  inside: boolean
}

/**
 * Each platform gets its own path shapes: the stub switches `isInside` between `win32` and
 * `posix` path rules, so one host proves both.
 */
const CONTAINMENT_CASES: Record<'win32' | 'linux', ContainmentCase[]> = {
  win32: [
    {
      title: 'a direct child is inside',
      root: 'C:\\Quake2',
      target: 'C:\\Quake2\\x',
      inside: true,
    },
    { title: 'the root itself is inside', root: 'C:\\Quake2', target: 'C:\\Quake2', inside: true },
    {
      title: 'climbing out with .. is outside',
      root: 'C:\\Quake2',
      target: 'C:\\Quake2\\..\\x',
      inside: false,
    },
    {
      title: 'a .. that lands back under the root is inside',
      root: 'C:\\Quake2',
      target: 'C:\\Quake2\\a\\..\\b',
      inside: true,
    },
    {
      title: 'a sibling sharing the root as a name prefix is outside',
      root: 'C:\\Quake2',
      target: 'C:\\Quake2-other\\x',
      inside: false,
    },
    {
      title: 'a trailing separator on the root changes nothing',
      root: 'C:\\Quake2\\',
      target: 'C:\\Quake2\\x',
      inside: true,
    },
    {
      title: 'a trailing separator on the target changes nothing',
      root: 'C:\\Quake2',
      target: 'C:\\Quake2\\x\\',
      inside: true,
    },
    {
      title: 'the root with a trailing separator equals the root',
      root: 'C:\\Quake2',
      target: 'C:\\Quake2\\',
      inside: true,
    },
    { title: 'a drive root contains its children', root: 'C:\\', target: 'C:\\x', inside: true },
    { title: 'another drive is outside', root: 'C:\\Quake2', target: 'D:\\x', inside: false },
    {
      title: 'a child whose name starts with .. is inside',
      root: 'C:\\Quake2',
      target: 'C:\\Quake2\\..foo',
      inside: true,
    },
    {
      title: 'a child differing only in case is inside',
      root: 'C:\\Quake2',
      target: 'c:\\QUAKE2\\BaseQ2',
      inside: true,
    },
  ],
  linux: [
    {
      title: 'a direct child is inside',
      root: '/games/quake2',
      target: '/games/quake2/x',
      inside: true,
    },
    {
      title: 'the root itself is inside',
      root: '/games/quake2',
      target: '/games/quake2',
      inside: true,
    },
    {
      title: 'climbing out with .. is outside',
      root: '/games/quake2',
      target: '/games/quake2/../x',
      inside: false,
    },
    {
      title: 'a .. that lands back under the root is inside',
      root: '/games/quake2',
      target: '/games/quake2/a/../b',
      inside: true,
    },
    {
      title: 'a sibling sharing the root as a name prefix is outside',
      root: '/games/Quake2',
      target: '/games/Quake2-other/x',
      inside: false,
    },
    {
      title: 'a trailing separator on the root changes nothing',
      root: '/games/quake2/',
      target: '/games/quake2/x',
      inside: true,
    },
    {
      title: 'a trailing separator on the target changes nothing',
      root: '/games/quake2',
      target: '/games/quake2/x/',
      inside: true,
    },
    {
      title: 'the root with a trailing separator equals the root',
      root: '/games/quake2',
      target: '/games/quake2/',
      inside: true,
    },
    { title: 'the filesystem root contains its children', root: '/', target: '/x', inside: true },
    {
      title: 'a child whose name starts with .. is inside',
      root: '/games/quake2',
      target: '/games/quake2/..foo',
      inside: true,
    },
    {
      title: 'a child differing only in case is outside',
      root: '/games/quake2',
      target: '/games/QUAKE2/baseq2',
      inside: false,
    },
  ],
}

describe('isInside', () => {
  for (const platform of ['win32', 'linux'] as const) {
    describe(`on ${platform}`, () => {
      beforeEach(() => {
        restorePlatform = stubPlatform(platform)
      })

      for (const { title, root, target, inside } of CONTAINMENT_CASES[platform]) {
        it(title, () => {
          expect(isInside(root, target)).toBe(inside)
        })
      }

      if (platform === 'win32') {
        it('a UNC target under a drive-letter root is outside, though relative() is absolute', () => {
          const root = 'C:\\Quake2'
          const target = '\\\\server\\share\\Quake2\\x'
          // Pins the branch under test: across roots win32.relative returns the target itself,
          // which neither equals '..' nor starts with '..\' - only the isAbsolute check rejects it.
          expect(win32.isAbsolute(win32.relative(root, target))).toBe(true)
          expect(isInside(root, target)).toBe(false)
        })
      }
    })
  }
})

describe('readBinaryKind', () => {
  it('reads a PE header as pe and an ELF header as elf', async () => {
    const peFile = join(dir, 'app.exe')
    await writeFile(peFile, Buffer.from([0x4d, 0x5a, 0x90, 0x00]))

    const elfFile = join(dir, 'app')
    await writeFile(elfFile, Buffer.from([0x7f, 0x45, 0x4c, 0x46]))

    expect(await readBinaryKind(peFile)).toBe('pe')
    expect(await readBinaryKind(elfFile)).toBe('elf')
  })

  it('reads a shebang as script and a missing file as unknown', async () => {
    const scriptFile = join(dir, 'run.sh')
    await writeFile(scriptFile, '#!/bin/sh\necho hi\n')

    expect(await readBinaryKind(scriptFile)).toBe('script')
    expect(await readBinaryKind(join(dir, 'does-not-exist'))).toBe('unknown')
  })
})

describe('dirReadFailureReason', () => {
  it('classifies ENOENT, ENOTDIR, EACCES, EPERM and other codes', () => {
    expect(dirReadFailureReason('ENOENT')).toBe('missing')
    expect(dirReadFailureReason('ENOTDIR')).toBe('notAFolder')
    expect(dirReadFailureReason('EACCES')).toBe('permissionDenied')
    expect(dirReadFailureReason('EPERM')).toBe('permissionDenied')
    expect(dirReadFailureReason('EMFILE')).toBe('unreadable')
    expect(dirReadFailureReason(undefined)).toBe('unreadable')
  })
})

describe('readBinaryArch', () => {
  function pe(machine: number): Buffer {
    const b = Buffer.alloc(0x80)
    b.write('MZ', 0, 'latin1')
    b.writeUInt32LE(0x40, 0x3c)
    b.write('PE  ', 0x40, 'latin1')
    b.writeUInt16LE(machine, 0x44)
    return b
  }
  function elf(cls: number, machine: number): Buffer {
    const b = Buffer.alloc(64)
    b.set([0x7f, 0x45, 0x4c, 0x46, cls, 1, 1], 0)
    b.writeUInt16LE(machine, 18)
    return b
  }

  it('readBinaryArch reads x86 and x86_64 from PE and ELF headers', async () => {
    const files: Array<[string, Buffer, string]> = [
      ['pe32.exe', pe(0x14c), 'x86'],
      ['pe64.exe', pe(0x8664), 'x86_64'],
      ['elf32', elf(1, 3), 'x86'],
      ['elf64', elf(2, 62), 'x86_64'],
      ['arm.exe', pe(0xaa64), 'unknown'],
      ['truncated.exe', pe(0x14c).subarray(0, 0x42), 'unknown'],
      ['mz-only.exe', Buffer.from([0x4d, 0x5a]), 'unknown'],
    ]
    for (const [name, data, expected] of files) {
      const file = join(dir, name)
      await writeFile(file, data)
      expect(await readBinaryArch(file), name).toBe(expected)
    }
    expect(await readBinaryArch(join(dir, 'does-not-exist'))).toBe('unknown')
  })
})

describe('shared file helpers', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fs-utils-shared-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('listFilesRecursive lists nested files with forward slashes', async () => {
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'top.txt'), 'x')
    await writeFile(join(root, 'a', 'b', 'deep.txt'), 'y')
    const listed = await listFilesRecursive(root)
    expect(listed.map((e) => e.rel).sort()).toEqual(['a/b/deep.txt', 'top.txt'])
    expect(listed.every((e) => e.isFile)).toBe(true)
    expect(listed.find((e) => e.rel === 'a/b/deep.txt')?.abs).toBe(join(root, 'a', 'b', 'deep.txt'))
  })

  it('hashFile returns sha256 and size', async () => {
    const file = join(root, 'abc.txt')
    await writeFile(file, 'abc')
    expect(await hashFile(file)).toEqual({
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      sizeBytes: 3,
    })
  })
})
