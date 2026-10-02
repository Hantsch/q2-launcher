import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReplaysExtraFolder } from '@shared/modules/replays'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ZipDeps } from '../../lib/zip-entries'
import { resolveExtractorPath } from '../../lib/archive/7za-path'
import type { DiscoverableInstallation } from './discovery'
import { discoverDemos, effectiveWriteDirs, recogniseDemoFile } from './discovery'

/** No zip fixtures in most tests here - `extractorExists: false` fails closed, harmlessly. */
const ZIP_DEPS: ZipDeps = { extractorPath: 'unused', extractorExists: false }

/**
 * Story 141 D2: `discoverDemos` scans real temp directories - mirrors `inspector.test.ts`'s
 * `mkdtemp`-per-suite style - rather than mocking `fs`, since the whole point of this deliverable is
 * getting the on-disk case-folding, shadowing and dedup rules right.
 */

let dir: string

beforeEach(async () => {
  // Canonical: discovery reports realpaths, and a Windows runner's tmpdir() is an 8.3 short path
  // (C:\Users\RUNNER~1\...) that realpath expands.
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-discovery-')))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function installation(overrides: Partial<DiscoverableInstallation> = {}): DiscoverableInstallation {
  return {
    id: overrides.id ?? 'inst-1',
    name: overrides.name ?? 'Installation One',
    rootPath: overrides.rootPath ?? join(dir, 'root'),
    gameDirs: overrides.gameDirs ?? ['baseq2'],
    engineKind: overrides.engineKind ?? 'r1q2',
    recordedEngineKind: overrides.recordedEngineKind,
    writeDirPath: overrides.writeDirPath,
  }
}

async function writeDemo(demosDir: string, fileName: string, content = 'x'): Promise<void> {
  await mkdir(demosDir, { recursive: true })
  await writeFile(join(demosDir, fileName), content)
}

function extraFolder(
  path: string,
  overrides: Partial<ReplaysExtraFolder> = {},
): ReplaysExtraFolder {
  return {
    id: overrides.id ?? 'extra-1',
    path,
    addedAt: overrides.addedAt ?? '2024-01-01T00:00:00.000Z',
  }
}

describe('recogniseDemoFile', () => {
  it('matches every supported extension, case-insensitively', () => {
    expect(recogniseDemoFile('a.dm2')).toEqual({ format: 'dm2', gzip: false })
    expect(recogniseDemoFile('a.mvd2')).toEqual({ format: 'mvd2', gzip: false })
    expect(recogniseDemoFile('a.dm2.gz')).toEqual({ format: 'dm2', gzip: true })
    expect(recogniseDemoFile('a.mvd2.gz')).toEqual({ format: 'mvd2', gzip: true })
    expect(recogniseDemoFile('FINAL.DM2')).toEqual({ format: 'dm2', gzip: false })
    expect(recogniseDemoFile('Match.MVD2.GZ')).toEqual({ format: 'mvd2', gzip: true })
  })

  it('rejects sidecars and unrelated files', () => {
    expect(recogniseDemoFile('x.dm2.json')).toBeNull()
    expect(recogniseDemoFile('a.zip')).toBeNull()
    expect(recogniseDemoFile('notes.txt')).toBeNull()
  })
})

describe('effectiveWriteDirs', () => {
  it('yields ~/.q2pro only for a q2pro installation on linux', () => {
    const inst = installation({ engineKind: 'q2pro' })
    expect(
      effectiveWriteDirs(inst, { platform: 'linux', homeDir: '/home/x', zipDeps: ZIP_DEPS }),
    ).toEqual([join('/home/x', '.q2pro')])
  })

  it('honours recordedEngineKind as well as engineKind', () => {
    const inst = installation({ engineKind: 'unknown' as never, recordedEngineKind: 'q2pro' })
    expect(
      effectiveWriteDirs(inst, { platform: 'linux', homeDir: '/home/x', zipDeps: ZIP_DEPS }),
    ).toEqual([join('/home/x', '.q2pro')])
  })

  it('never reads writeDirPath', () => {
    const inst = installation({ engineKind: 'q2pro', writeDirPath: '/somewhere/else' })
    const dirs = effectiveWriteDirs(inst, {
      platform: 'linux',
      homeDir: '/home/x',
      zipDeps: ZIP_DEPS,
    })
    expect(dirs).not.toContain('/somewhere/else')
  })

  it('yields nothing on windows, for r1q2, or without a homedir match', () => {
    expect(
      effectiveWriteDirs(installation({ engineKind: 'q2pro' }), {
        platform: 'win32',
        homeDir: '/home/x',
        zipDeps: ZIP_DEPS,
      }),
    ).toEqual([])
    expect(
      effectiveWriteDirs(installation({ engineKind: 'r1q2' }), {
        platform: 'linux',
        homeDir: '/home/x',
        zipDeps: ZIP_DEPS,
      }),
    ).toEqual([])
  })
})

describe('discoverDemos', () => {
  it('finds every recognised demo in every detected game dir of every installation', async () => {
    const rootA = join(dir, 'instA')
    const rootB = join(dir, 'instB')
    await writeDemo(join(rootA, 'baseq2', 'demos'), 'one.dm2')
    await writeDemo(join(rootA, 'ctf', 'demos'), 'two.mvd2')
    await writeDemo(join(rootB, 'baseq2', 'demos'), 'three.dm2.gz')
    await writeDemo(join(rootB, 'ctf', 'demos'), 'four.mvd2.gz')

    const result = await discoverDemos(
      [
        installation({ id: 'a', rootPath: rootA, gameDirs: ['baseq2', 'ctf'] }),
        installation({ id: 'b', rootPath: rootB, gameDirs: ['baseq2', 'ctf'] }),
      ],
      [],
      { platform: 'win32', homeDir: join(dir, 'home'), zipDeps: ZIP_DEPS },
    )

    expect(result.demos.map((d) => d.fileName).sort()).toEqual([
      'four.mvd2.gz',
      'one.dm2',
      'three.dm2.gz',
      'two.mvd2',
    ])
  })

  it('extension matching is case-insensitive, including a capitalised Demos folder', async () => {
    const root = join(dir, 'inst')
    await writeDemo(join(root, 'baseq2', 'Demos'), 'FINAL.DM2')
    await writeDemo(join(root, 'baseq2', 'Demos'), 'Match.MVD2.GZ')

    const result = await discoverDemos([installation({ rootPath: root })], [], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })

    expect(result.demos.map((d) => d.fileName).sort()).toEqual(['FINAL.DM2', 'Match.MVD2.GZ'])
  })

  it('sidecars, _launcher and subfolders are never listed', async () => {
    const root = join(dir, 'inst')
    const demosDir = join(root, 'baseq2', 'demos')
    await writeDemo(demosDir, 'x.dm2.json')
    await writeDemo(join(demosDir, '_launcher'), 'y.dm2')
    await writeDemo(join(demosDir, 'sub'), 'z.dm2')
    await writeDemo(demosDir, 'notes.txt')
    await writeDemo(demosDir, 'a.zip')

    const result = await discoverDemos([installation({ rootPath: root })], [], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })

    expect(result.demos).toEqual([])
  })

  it('a Q2PRO installation on Linux also yields demos from ~/.q2pro/<gamedir>/demos', async () => {
    const root = join(dir, 'inst')
    const home = join(dir, 'home')
    await writeDemo(join(root, 'baseq2', 'demos'), 'root.dm2')
    await writeDemo(join(home, '.q2pro', 'baseq2', 'demos'), 'writedir.dm2')
    // A write-dir-only mod game dir, never in installation.gameDirs at all.
    await writeDemo(join(home, '.q2pro', 'somemod', 'demos'), 'mod.dm2')

    const result = await discoverDemos(
      [installation({ rootPath: root, gameDirs: ['baseq2'], engineKind: 'q2pro' })],
      [],
      { platform: 'linux', homeDir: home, zipDeps: ZIP_DEPS },
    )

    expect(result.demos.map((d) => d.fileName).sort()).toEqual([
      'mod.dm2',
      'root.dm2',
      'writedir.dm2',
    ])
  })

  it('no write dir is scanned on Windows, for r1q2, or from writeDirPath', async () => {
    const root = join(dir, 'inst')
    const home = join(dir, 'home')
    await writeDemo(join(root, 'baseq2', 'demos'), 'root.dm2')
    await writeDemo(join(home, '.q2pro', 'baseq2', 'demos'), 'writedir.dm2')
    const elsewhere = join(dir, 'elsewhere')
    await writeDemo(join(elsewhere, 'baseq2', 'demos'), 'elsewhere.dm2')

    const windowsResult = await discoverDemos(
      [installation({ rootPath: root, engineKind: 'q2pro' })],
      [],
      { platform: 'win32', homeDir: home, zipDeps: ZIP_DEPS },
    )
    expect(windowsResult.demos.map((d) => d.fileName)).toEqual(['root.dm2'])

    const r1q2Result = await discoverDemos(
      [installation({ rootPath: root, engineKind: 'r1q2' })],
      [],
      { platform: 'linux', homeDir: home, zipDeps: ZIP_DEPS },
    )
    expect(r1q2Result.demos.map((d) => d.fileName)).toEqual(['root.dm2'])

    const writeDirPathResult = await discoverDemos(
      [installation({ rootPath: root, engineKind: 'r1q2', writeDirPath: elsewhere })],
      [],
      { platform: 'win32', homeDir: home, zipDeps: ZIP_DEPS },
    )
    expect(writeDirPathResult.demos.map((d) => d.fileName)).toEqual(['root.dm2'])
  })

  it('a demo reachable through two paths is listed once', async () => {
    const root = join(dir, 'inst')
    const home = join(dir, 'home')
    await writeDemo(join(root, 'baseq2', 'demos'), 'shared.dm2')
    await mkdir(join(home, '.q2pro'), { recursive: true })
    try {
      await symlink(join(root, 'baseq2'), join(home, '.q2pro', 'baseq2'), 'junction')
    } catch {
      // Fallback for environments without junction support: mirror the same content instead, which
      // still proves dedup can't be trivially defeated (same fileName, same gameDir, same install).
      await writeDemo(join(home, '.q2pro', 'baseq2', 'demos'), 'shared.dm2')
    }

    const result = await discoverDemos(
      [installation({ rootPath: root, engineKind: 'q2pro' })],
      [],
      { platform: 'linux', homeDir: home, zipDeps: ZIP_DEPS },
    )

    expect(result.demos.filter((d) => d.fileName === 'shared.dm2')).toHaveLength(1)
  })

  it('a write-dir demo shadows the same-named root demo', async () => {
    const root = join(dir, 'inst')
    const home = join(dir, 'home')
    await writeDemo(join(root, 'baseq2', 'demos'), 'x.dm2', 'root-bytes')
    await writeDemo(join(home, '.q2pro', 'baseq2', 'demos'), 'x.dm2', 'writedir-bytes')

    const result = await discoverDemos(
      [installation({ rootPath: root, engineKind: 'q2pro' })],
      [],
      { platform: 'linux', homeDir: home, zipDeps: ZIP_DEPS },
    )

    const matches = result.demos.filter((d) => d.fileName === 'x.dm2')
    expect(matches).toHaveLength(1)
    expect(matches[0].absolutePath).toBe(join(home, '.q2pro', 'baseq2', 'demos', 'x.dm2'))
  })

  it('ids are stable across scans and differ per file', async () => {
    const root = join(dir, 'inst')
    await writeDemo(join(root, 'baseq2', 'demos'), 'one.dm2')
    await writeDemo(join(root, 'baseq2', 'demos'), 'two.dm2')

    const ctx = { platform: 'win32' as const, homeDir: join(dir, 'home'), zipDeps: ZIP_DEPS }
    const first = await discoverDemos([installation({ rootPath: root })], [], ctx)
    const second = await discoverDemos([installation({ rootPath: root })], [], ctx)

    const idOf = (list: typeof first, name: string) =>
      list.demos.find((d) => d.fileName === name)?.id
    expect(idOf(first, 'one.dm2')).toBe(idOf(second, 'one.dm2'))
    expect(idOf(first, 'one.dm2')).not.toBe(idOf(first, 'two.dm2'))
  })

  it('a missing root yields no demos and no error', async () => {
    const result = await discoverDemos(
      [installation({ rootPath: join(dir, 'does-not-exist') })],
      [],
      { platform: 'win32', homeDir: join(dir, 'home'), zipDeps: ZIP_DEPS },
    )

    expect(result.demos).toEqual([])
  })

  describe('zip expansion (story 143 D3)', () => {
    const realBinary = resolveExtractorPath({ isPackaged: false })

    it.skipIf(!realBinary.exists)('a scanned folder expands its zips into entry rows', async () => {
      const root = join(dir, 'inst')
      const demosDir = join(root, 'baseq2', 'demos')
      await writeDemo(demosDir, 'loose.dm2')

      const zipSrc = join(dir, 'zip-src')
      await mkdir(zipSrc, { recursive: true })
      await writeFile(join(zipSrc, 'a.dm2'), 'a-bytes')
      await writeFile(join(zipSrc, 'b.mvd2'), 'b-bytes')
      execFileSync(
        realBinary.path,
        ['a', '-tzip', '-y', '-spd', '--', join(demosDir, 'pack.zip'), 'a.dm2', 'b.mvd2'],
        { cwd: zipSrc },
      )

      const result = await discoverDemos([installation({ rootPath: root })], [], {
        platform: 'win32',
        homeDir: join(dir, 'home'),
        zipDeps: { extractorPath: realBinary.path, extractorExists: true },
      })

      expect(result.demos).toHaveLength(3)
      const zipRows = result.demos.filter((d) => d.archiveEntry !== null)
      expect(zipRows).toHaveLength(2)
      expect(zipRows.map((d) => d.fileName).sort()).toEqual(['a.dm2', 'b.mvd2'])
    })
  })
})

describe('discoverDemos - extra folders (story 142 D3)', () => {
  it('demos in an extra folder are listed with an extra-folder source', async () => {
    const extra = join(dir, 'my-demos')
    await writeDemo(extra, 'one.dm2')

    const result = await discoverDemos([], [extraFolder(extra)], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })

    expect(result.demos).toHaveLength(1)
    expect(result.demos[0].fileName).toBe('one.dm2')
    expect(result.demos[0].source).toEqual({ kind: 'extraFolder', path: extra })
  })

  it('an extra folder is scanned top-level only with the same formats and exclusions as installations', async () => {
    const extra = join(dir, 'my-demos')
    await writeDemo(join(extra, 'sub'), 'deep.dm2')
    await writeDemo(extra, 'x.dm2.json')
    await writeDemo(extra, 'FINAL.DM2')
    await writeDemo(extra, 'notes.txt')

    const result = await discoverDemos([], [extraFolder(extra)], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })

    expect(result.demos.map((d) => d.fileName)).toEqual(['FINAL.DM2'])
  })

  it("an extra folder that is an installation's demos folder yields no duplicate demos", async () => {
    const root = join(dir, 'inst')
    const demosDir = join(root, 'baseq2', 'demos')
    await writeDemo(demosDir, 'shared.dm2')

    const result = await discoverDemos(
      [installation({ rootPath: root })],
      [extraFolder(demosDir.toUpperCase())],
      { platform: 'win32', homeDir: join(dir, 'home'), zipDeps: ZIP_DEPS },
    )

    const matches = result.demos.filter((d) => d.fileName === 'shared.dm2')
    expect(matches).toHaveLength(1)
    expect(matches[0].source.kind).toBe('installation')
  })

  it('an extra folder listed twice under different spellings yields each demo once', async () => {
    const extra = join(dir, 'my-demos')
    await writeDemo(extra, 'one.dm2')

    const result = await discoverDemos(
      [],
      [
        extraFolder(extra, { id: 'extra-1' }),
        extraFolder(`${extra.toUpperCase()}\\`, { id: 'extra-2' }),
      ],
      { platform: 'win32', homeDir: join(dir, 'home'), zipDeps: ZIP_DEPS },
    )

    expect(result.demos.filter((d) => d.fileName === 'one.dm2')).toHaveLength(1)
  })

  it('a removed extra folder is no longer listed', async () => {
    const extra = join(dir, 'my-demos')
    await writeDemo(extra, 'one.dm2')

    const withFolder = await discoverDemos([], [extraFolder(extra)], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })
    expect(withFolder.demos.map((d) => d.fileName)).toEqual(['one.dm2'])

    const withoutFolder = await discoverDemos([], [], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })
    expect(withoutFolder.demos).toEqual([])
  })

  it('a missing extra folder does not fail the scan', async () => {
    const result = await discoverDemos([], [extraFolder(join(dir, 'does-not-exist'))], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })

    expect(result.demos).toEqual([])
  })
})

describe('discoverDemos - per-source errors (story 151 D1)', () => {
  it('a missing extra folder is reported and the other sources still list', async () => {
    const root = join(dir, 'inst')
    await writeDemo(join(root, 'baseq2', 'demos'), 'one.dm2')
    const missing = join(dir, 'does-not-exist')

    const result = await discoverDemos([installation({ rootPath: root })], [extraFolder(missing)], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })

    expect(result.demos.map((d) => d.fileName)).toEqual(['one.dm2'])
    expect(result.sourceErrors).toEqual([
      { source: { kind: 'extraFolder', path: missing }, archiveName: null, reason: 'missing' },
    ])
  })

  it('a file where an extra folder should be is reported as notAFolder', async () => {
    const extraAsFile = join(dir, 'extra-is-a-file')
    await writeFile(extraAsFile, 'not a folder')

    const result = await discoverDemos([], [extraFolder(extraAsFile)], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })

    expect(result.demos).toEqual([])
    expect(result.sourceErrors).toEqual([
      {
        source: { kind: 'extraFolder', path: extraAsFile },
        archiveName: null,
        reason: 'notAFolder',
      },
    ])
  })

  it('an installation game dir without a demos folder reports nothing', async () => {
    const root = join(dir, 'inst')
    await mkdir(join(root, 'baseq2'), { recursive: true })

    const result = await discoverDemos([installation({ rootPath: root })], [], {
      platform: 'win32',
      homeDir: join(dir, 'home'),
      zipDeps: ZIP_DEPS,
    })

    expect(result.demos).toEqual([])
    expect(result.sourceErrors).toEqual([])
  })

  describe('a broken zip (story 143 D3 extractor)', () => {
    const realBinary = resolveExtractorPath({ isPackaged: false })

    it.skipIf(!realBinary.exists)(
      "is reported with its archive name while its folder's loose demos still list",
      async () => {
        const root = join(dir, 'inst')
        const demosDir = join(root, 'baseq2', 'demos')
        await writeDemo(demosDir, 'loose.dm2')
        await writeFile(join(demosDir, 'broken.zip'), 'not actually a zip')

        const result = await discoverDemos([installation({ rootPath: root })], [], {
          platform: 'win32',
          homeDir: join(dir, 'home'),
          zipDeps: { extractorPath: realBinary.path, extractorExists: true },
        })

        expect(result.demos.map((d) => d.fileName)).toEqual(['loose.dm2'])
        expect(result.sourceErrors).toHaveLength(1)
        expect(result.sourceErrors[0].archiveName).toBe('broken.zip')
        expect(result.sourceErrors[0].source).toEqual({
          kind: 'installation',
          installationId: 'inst-1',
          installationName: 'Installation One',
          gameDir: 'baseq2',
        })
      },
    )
  })
})
