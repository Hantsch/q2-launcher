import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stubPlatform } from '../../../../test-support/platform'
import {
  installR1q2Notices,
  probeX86Runtime,
  resolveR1q2LicensePath,
  seedR1glConfig,
} from './r1q2-setup'

/**
 * Story 080 D3. `probeX86Runtime` is exercised with a fake `fileExists` (no real machine
 * dependency); `seedR1glConfig`/`installR1q2Notices` are real file I/O against real tmp dirs, the
 * same convention `assemble.test.ts` uses.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-r1q2-setup-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('probeX86Runtime', () => {
  // Story 100 D6 (AC6): the probe is a hard no-op off Windows (r1q2-setup.ts's own
  // belt-and-braces guard), so proving what it does *on* Windows needs `stubPlatform` - without
  // it, these two would only pass by accident on a Windows host and fail everywhere else.
  let restore: () => void
  beforeEach(() => {
    restore = stubPlatform('win32')
  })
  afterEach(() => {
    restore()
  })

  it('reports true when a candidate path exists', async () => {
    const present = await probeX86Runtime({ fileExists: () => Promise.resolve(true) })
    expect(present).toBe(true)
  })

  it('reports false when no candidate path exists', async () => {
    const present = await probeX86Runtime({ fileExists: () => Promise.resolve(false) })
    expect(present).toBe(false)
  })

  it('checks SysWOW64 before falling back to System32', async () => {
    const checked: string[] = []
    const present = await probeX86Runtime({
      fileExists: (path) => {
        checked.push(path)
        return Promise.resolve(path.toLowerCase().includes('system32'))
      },
    })
    expect(present).toBe(true)
    expect(checked[0]?.toLowerCase()).toContain('syswow64')
    expect(checked[1]?.toLowerCase()).toContain('system32')
  })
})

describe('seedR1glConfig', () => {
  // Story 100 D6 (AC6): a hard no-op off Windows (see the module comment on `seedR1glConfig`),
  // so proving it actually seeds the file needs `stubPlatform` - without it, these would only pass
  // by accident on a Windows host (the 'off Windows' describe block below covers the no-op case).
  let restore: () => void
  beforeEach(() => {
    restore = stubPlatform('win32')
  })
  afterEach(() => {
    restore()
  })

  it('writes baseq2/autoexec.cfg with the r1gl line when it does not exist', async () => {
    await seedR1glConfig(dir)
    const content = await readFile(join(dir, 'baseq2', 'autoexec.cfg'), 'utf8')
    expect(content).toBe('set vid_ref "r1gl"\n')
  })

  it('leaves an existing file untouched', async () => {
    await mkdir(join(dir, 'baseq2'), { recursive: true })
    await writeFile(join(dir, 'baseq2', 'autoexec.cfg'), 'bind x "+attack"\n')

    await seedR1glConfig(dir)

    const content = await readFile(join(dir, 'baseq2', 'autoexec.cfg'), 'utf8')
    expect(content).toBe('bind x "+attack"\n')
  })
})

describe('off Windows', () => {
  /**
   * Story 100 D6 (AC6): R1Q2 is Windows-only. D5 already keeps it from ever being pinned/offered
   * off Windows, but `probeX86Runtime`/`seedR1glConfig` also guard themselves, so calling either
   * directly on a non-Windows host is a hard no-op rather than a false "runtime present" or a
   * stray `baseq2/autoexec.cfg` write.
   */
  it('the runtime probe and the vid_ref seeding do nothing off Windows', async () => {
    const restore = stubPlatform('linux')
    try {
      const present = await probeX86Runtime({ fileExists: () => Promise.resolve(true) })
      expect(present).toBe(false)

      await seedR1glConfig(dir)
      await expect(access(join(dir, 'baseq2', 'autoexec.cfg'))).rejects.toThrow()
    } finally {
      restore()
    }
  })
})

describe('resolveR1q2LicensePath', () => {
  it('finds the real checked-in GPL-3.0.txt in dev mode by walking up to the repo root', async () => {
    const resolved = resolveR1q2LicensePath({ isPackaged: false })
    expect(existsSync(resolved)).toBe(true)
    expect(resolved.endsWith(join('resources', 'licenses', 'r1q2', 'GPL-3.0.txt'))).toBe(true)
    const content = await readFile(resolved, 'utf8')
    expect(content).toContain('GNU GENERAL PUBLIC LICENSE')
    expect(content).toContain('Version 3, 29 June 2007')
  })

  it('accepts an explicit repoRoot in dev mode, mirroring resolveExtractorPath', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'q2-launcher-r1q2-license-'))
    try {
      const resolved = resolveR1q2LicensePath({ isPackaged: false, repoRoot })
      expect(resolved).toBe(join(repoRoot, 'resources', 'licenses', 'r1q2', 'GPL-3.0.txt'))
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  it('resolves under resourcesPath when packaged', () => {
    const resolved = resolveR1q2LicensePath({
      isPackaged: true,
      resourcesPath: join('C:', 'fake', 'resources'),
    })
    expect(resolved).toBe(join('C:', 'fake', 'resources', 'licenses', 'r1q2', 'GPL-3.0.txt'))
  })
})

describe('installR1q2Notices', () => {
  it('copies the license source into the target', async () => {
    const sourcePath = join(dir, 'GPL-3.0.txt')
    await writeFile(sourcePath, 'GPLv3 license text\n')
    const targetRoot = join(dir, 'target')
    await mkdir(targetRoot, { recursive: true })

    await installR1q2Notices(targetRoot, sourcePath)

    const content = await readFile(join(targetRoot, 'LICENSE-r1q2-GPL-3.0.txt'), 'utf8')
    expect(content).toBe('GPLv3 license text\n')
  })

  it('resolves without throwing when the license source is missing', async () => {
    const targetRoot = join(dir, 'target')
    await mkdir(targetRoot, { recursive: true })

    await expect(
      installR1q2Notices(targetRoot, join(dir, 'no-such-license.txt')),
    ).resolves.toBeUndefined()
  })
})
